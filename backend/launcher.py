#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
瞬连调式工具 启动器
- 检测后端程序是否运行
- 未运行则启动后端
- 打开前端网页
- 启动进程守护，监控后端健康状态
- 后端无响应时自动重启
"""

import os
import sys
import time
import socket
import signal
import subprocess
import webbrowser
import logging
import codecs
import platform

HTTP_PORT = 32995
MAX_WAIT_SECONDS = 30
CHECK_INTERVAL = 0.3

# ==================== 守护程序参数 ====================
HEALTH_CHECK_INTERVAL = 10        # 健康检测周期（秒）
HEALTH_CHECK_TIMEOUT = 5          # 健康检测 API 超时（秒）
MAX_CONSECUTIVE_FAILURES = 3      # 连续失败多少次触发重启
STARTUP_GRACE_PERIOD = 20         # 后端启动后宽限期（秒），期间不累计失败
MAX_RESTART_COUNT = 5             # 频率限制窗口内最大重启次数
RESTART_WINDOW = 300              # 频率限制窗口（秒）
RESTART_BACKOFF_BASE = 5          # 重启退避基准间隔（秒），每次翻倍
RESTART_BACKOFF_MAX = 60          # 重启退避最大间隔（秒）

# 保存后端进程引用，用于精准终止（避免全局 taskkill 误杀其他实例启动的进程）
_backend_process = None

try:
    import urllib.request
    import urllib.error
    HAS_URLLIB = True
except ImportError:
    HAS_URLLIB = False


def get_base_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def ensure_single_instance():
    """确保只有一个启动器实例运行（Windows 命名互斥锁）。

    防止用户多次双击图标导致多个 ShunLianTool.exe 同时运行，
    多个实例的守护循环会互相 kill 对方启动的后端，导致后端不断重启。
    """
    if platform.system() != 'Windows':
        return True
    try:
        import ctypes
        mutex_name = 'Global\\ShunLianTool_Launcher_SingleInstance'
        kernel32 = ctypes.windll.kernel32
        mutex = kernel32.CreateMutexW(None, False, mutex_name)
        if kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
            logger.warning("检测到启动器已在运行，退出当前实例")
            return False
        # 保持互斥锁句柄不被 GC 回收（进程退出时自动释放）
        ensure_single_instance._mutex_handle = mutex
        return True
    except Exception as e:
        logger.warning(f"单实例检测失败: {e}，继续启动")
        return True


def get_log_dir():
    local_app = os.environ.get('LOCALAPPDATA', '')
    if local_app:
        log_dir = os.path.join(local_app, 'ShunLianTool')
    else:
        log_dir = get_base_dir()
    os.makedirs(log_dir, exist_ok=True)
    return log_dir


if getattr(sys, 'frozen', False):
    _log_file = os.path.join(get_log_dir(), 'launcher.log')
    _log_stream = codecs.open(_log_file, mode='a', encoding='utf-8')
    _handler = logging.StreamHandler(_log_stream)
    _handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
    logging.basicConfig(level=logging.INFO, handlers=[_handler])
else:
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('ShunLianTool Launcher')


def is_port_open(port, host='127.0.0.1'):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            result = s.connect_ex((host, port))
            return result == 0
    except Exception:
        return False


def check_health_api():
    if not HAS_URLLIB:
        return is_port_open(HTTP_PORT)
    try:
        # 优先尝试 HTTPS（TLS 已启用时）
        import ssl
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        url = f'https://127.0.0.1:{HTTP_PORT}/api/health'
        req = urllib.request.Request(url, method='GET')
        with urllib.request.urlopen(req, timeout=HEALTH_CHECK_TIMEOUT, context=ssl_context) as resp:
            if resp.status == 200:
                return True
    except Exception:
        pass
    # 回退到 HTTP
    try:
        url = f'http://127.0.0.1:{HTTP_PORT}/api/health'
        req = urllib.request.Request(url, method='GET')
        with urllib.request.urlopen(req, timeout=HEALTH_CHECK_TIMEOUT) as resp:
            if resp.status == 200:
                return True
    except Exception:
        pass
    return False


def is_process_running(process_name):
    """检测指定进程是否运行（使用 tasklist，比 wmic 快 10 倍以上且更兼容）。"""
    try:
        result = subprocess.run(
            ['tasklist', '/FI', f'IMAGENAME eq {process_name}', '/NH'],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
            timeout=5
        )
        output = result.stdout.decode('utf-8', errors='ignore').lower()
        return process_name.lower() in output
    except Exception:
        return False


def kill_old_backend_processes():
    """启动前清理可能残留的旧进程。

    优化点：
    1. 单次 tasklist 获取全部进程列表，避免逐个进程名调用（wmic 单次可达数秒~十几秒）。
    2. 仅在确实终止了进程时才短暂等待（0.5秒），无残留进程时零等待。
    """
    processes_to_kill = [
        'shunlian_backend.exe',
        'shunlian_frontend.exe',
    ]
    # 单次 tasklist 调用获取全部进程名（小写），供后续匹配
    try:
        result = subprocess.run(
            ['tasklist', '/NH', '/FO', 'CSV'],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
            timeout=5
        )
        proc_list = result.stdout.decode('utf-8', errors='ignore').lower()
    except Exception:
        proc_list = ''

    killed_any = False
    for proc_name in processes_to_kill:
        if proc_name.lower() in proc_list:
            logger.info(f"检测到旧进程 {proc_name}，正在终止...")
            try:
                subprocess.run(
                    ['taskkill', '/F', '/IM', proc_name],
                    capture_output=True,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    timeout=5
                )
                logger.info(f"已终止 {proc_name}")
                killed_any = True
            except subprocess.TimeoutExpired:
                logger.error(f"终止 {proc_name} 超时")
            except Exception as e:
                logger.error(f"终止 {proc_name} 失败: {e}")
    # 仅在确实终止了进程时短暂等待，确保句柄释放；无残留进程时零等待
    if killed_any:
        time.sleep(0.5)


def start_backend():
    global _backend_process
    base_dir = get_base_dir()
    backend_exe = os.path.join(base_dir, 'shunlian_backend.exe')
    if os.path.exists(backend_exe):
        logger.info(f"启动后端: {backend_exe}")
        _backend_process = subprocess.Popen(
            [backend_exe],
            cwd=base_dir,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
            close_fds=True
        )
        return _backend_process
    else:
        main_py = os.path.join(base_dir, 'main.py')
        python_exe = sys.executable
        logger.info(f"启动后端: {python_exe} {main_py}")
        _backend_process = subprocess.Popen(
            [python_exe, main_py],
            cwd=base_dir,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
            close_fds=True
        )
        return _backend_process


def wait_for_backend():
    logger.info(f"等待后端启动（端口 {HTTP_PORT}）...")
    elapsed = 0
    while elapsed < MAX_WAIT_SECONDS:
        if is_port_open(HTTP_PORT):
            logger.info("后端已启动")
            return True
        time.sleep(CHECK_INTERVAL)
        elapsed += CHECK_INTERVAL
    logger.error(f"后端启动超时（{MAX_WAIT_SECONDS}秒）")
    return False


def open_browser():
    # 优先使用 HTTPS（TLS 已启用时），回退到 HTTP
    url_https = f'https://localhost:{HTTP_PORT}'
    url_http = f'http://localhost:{HTTP_PORT}'
    
    # 检测 TLS 是否启用：尝试 HTTPS 连接
    use_https = False
    try:
        import ssl
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        with socket.create_connection(('127.0.0.1', HTTP_PORT), timeout=3) as sock:
            ssock = ssl_context.wrap_socket(sock, server_hostname='localhost')
            ssock.close()
            use_https = True
    except Exception:
        pass
    
    url = url_https if use_https else url_http
    logger.info(f"打开浏览器: {url}")
    webbrowser.open(url)


def kill_backend():
    """终止后端进程。

    优先通过保存的进程引用（PID）精准终止自己启动的后端，
    仅当残留同名进程时才用全局 taskkill 兜底清理。
    """
    global _backend_process
    killed_any = False
    if _backend_process is not None:
        try:
            _backend_process.kill()
            _backend_process.wait(timeout=5)
            logger.info(f"已终止后端进程 (PID: {_backend_process.pid})")
            killed_any = True
        except subprocess.TimeoutExpired:
            logger.warning("终止后端进程超时，尝试强制清理同名进程")
        except Exception as e:
            logger.warning(f"终止后端进程异常: {e}")
        _backend_process = None
    # fallback: 清理可能残留的同名进程（如旧版本遗留、崩溃残留等）
    proc_name = 'shunlian_backend.exe'
    if is_process_running(proc_name):
        logger.info(f"清理残留后端进程: {proc_name}")
        try:
            subprocess.run(
                ['taskkill', '/F', '/IM', proc_name],
                capture_output=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
                timeout=10
            )
            killed_any = True
        except Exception as e:
            logger.error(f"终止后端失败: {e}")
    # 仅在确实终止了进程时短暂等待端口释放；无残留时零等待
    if killed_any:
        time.sleep(0.5)


def _is_backend_alive():
    """判断后端进程是否存活（优先用进程引用，兼容旧版本进程名检测）。"""
    global _backend_process
    if _backend_process is not None:
        return _backend_process.poll() is None
    return is_process_running('shunlian_backend.exe')


def restart_backend():
    """重启后端：终止旧进程 → 等待端口释放 → 启动新进程 → 等待就绪。"""
    logger.info("正在重启后端...")
    kill_backend()
    # 确保旧端口已释放，避免新进程绑定失败
    _wait_port_release(HTTP_PORT, timeout=10)
    start_backend()
    return wait_for_backend()


def _wait_port_release(port, timeout=10):
    """等待端口释放（被旧进程释放），最多等待 timeout 秒。"""
    elapsed = 0
    while elapsed < timeout:
        if not is_port_open(port):
            return True
        time.sleep(0.5)
        elapsed += 0.5
    logger.warning(f"端口 {port} 在 {timeout} 秒内未释放")
    return False


def guardian_loop():
    """进程守护主循环。

    设计要点：
    1. 启动宽限期：后端刚启动后 STARTUP_GRACE_PERIOD 秒内不累计失败，
       避免后端正常初始化耗时被误判为故障。
    2. 三重健康检测：进程存活 + 端口监听 + API 响应，全部通过才视为健康。
    3. 连续失败阈值：连续 MAX_CONSECUTIVE_FAILURES 次失败才触发重启，
       避免偶发抖动导致误重启。
    4. 指数退避：每次重启后等待间隔翻倍（上限 RESTART_BACKOFF_MAX），
       避免后端持续崩溃时快速循环重启。
    5. 频率限制：RESTART_WINDOW 秒内最多 MAX_RESTART_COUNT 次重启，
       超限后暂停重启，等待下个检测周期。
    """
    logger.info(f"进程守护已启动（检测间隔 {HEALTH_CHECK_INTERVAL} 秒）")
    consecutive_failures = 0
    restart_times = []
    consecutive_restart = 0  # 连续重启次数（用于退避），后端恢复后清零
    last_backend_start = time.time()  # 后端本次启动时间戳

    while True:
        time.sleep(HEALTH_CHECK_INTERVAL)

        # 启动宽限期：后端刚启动后给一段缓冲，期间不累计失败
        in_grace = (time.time() - last_backend_start) < STARTUP_GRACE_PERIOD

        port_open = is_port_open(HTTP_PORT)
        api_healthy = check_health_api() if port_open else False
        process_alive = _is_backend_alive()

        if process_alive and api_healthy:
            if consecutive_failures > 0:
                logger.info("后端恢复正常")
            consecutive_failures = 0
            consecutive_restart = 0
            continue

        # 宽限期内不累计失败，仅记录调试信息
        if in_grace:
            logger.debug(f"后端启动宽限期内（进程存活={process_alive}, 端口={port_open}, API={api_healthy}）")
            continue

        consecutive_failures += 1

        if not process_alive:
            logger.warning(f"后端进程已退出（连续失败 {consecutive_failures}/{MAX_CONSECUTIVE_FAILURES}）")
        elif not port_open:
            logger.warning(f"后端端口未监听（连续失败 {consecutive_failures}/{MAX_CONSECUTIVE_FAILURES}）")
        elif not api_healthy:
            logger.warning(f"后端 API 无响应（连续失败 {consecutive_failures}/{MAX_CONSECUTIVE_FAILURES}）")

        if consecutive_failures < MAX_CONSECUTIVE_FAILURES:
            continue

        # 频率限制：窗口期内重启次数超限则暂停
        now = time.time()
        restart_times = [t for t in restart_times if now - t < RESTART_WINDOW]
        if len(restart_times) >= MAX_RESTART_COUNT:
            logger.error(f"在 {RESTART_WINDOW} 秒内已重启 {MAX_RESTART_COUNT} 次，暂停重启")
            consecutive_failures = 0
            continue

        # 指数退避：连续重启时拉长等待间隔
        backoff = min(RESTART_BACKOFF_BASE * (2 ** consecutive_restart), RESTART_BACKOFF_MAX)
        if consecutive_restart > 0:
            logger.info(f"连续第 {consecutive_restart + 1} 次重启，退避等待 {backoff} 秒")
            time.sleep(backoff)

        logger.warning(f"连续 {MAX_CONSECUTIVE_FAILURES} 次健康检测失败，触发重启")
        if restart_backend():
            restart_times.append(time.time())
            consecutive_failures = 0
            consecutive_restart += 1
            last_backend_start = time.time()
        else:
            logger.error("重启失败，将在下个检测周期重试")
            consecutive_failures = 0
            consecutive_restart += 1
            last_backend_start = time.time()


def main():
    logger.info("=" * 40)
    logger.info("瞬连调式工具 启动器")
    logger.info("=" * 40)

    # 单实例检测：防止多个启动器同时运行导致守护循环互相干扰
    if not ensure_single_instance():
        sys.exit(0)

    kill_old_backend_processes()

    backend_running = is_port_open(HTTP_PORT)

    if backend_running:
        if is_process_running('shunlian_backend.exe'):
            logger.info("后端已在运行，进入守护模式")
        else:
            logger.info("端口已占用但非本程序后端，将重启")
            kill_backend()
            start_backend()
            if not wait_for_backend():
                logger.error("后端启动失败，请检查日志")
                input("按回车键退出...")
                sys.exit(1)
    else:
        logger.info("后端未运行，正在启动...")
        start_backend()
        if not wait_for_backend():
            logger.error("后端启动失败，请检查日志")
            input("按回车键退出...")
            sys.exit(1)

    open_browser()
    logger.info("启动完成，进入进程守护模式")

    try:
        guardian_loop()
    except KeyboardInterrupt:
        logger.info("收到退出信号，正在停止...")
    finally:
        kill_backend()
        logger.info("启动器已退出")


if __name__ == '__main__':
    main()
