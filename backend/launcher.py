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

HTTP_PORT = 32995
MAX_WAIT_SECONDS = 30
CHECK_INTERVAL = 0.5
HEALTH_CHECK_INTERVAL = 10
HEALTH_CHECK_TIMEOUT = 5
MAX_CONSECUTIVE_FAILURES = 3
RESTART_COOLDOWN = 10
MAX_RESTART_COUNT = 5
RESTART_WINDOW = 300

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
        url = f'http://127.0.0.1:{HTTP_PORT}/api/health'
        req = urllib.request.Request(url, method='GET')
        with urllib.request.urlopen(req, timeout=HEALTH_CHECK_TIMEOUT) as resp:
            if resp.status == 200:
                return True
    except Exception:
        pass
    return False


def is_process_running(process_name):
    try:
        result = subprocess.run(
            ['wmic', 'process', 'where', f'name="{process_name}"', 'get', 'name', '/format:list'],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
            timeout=5
        )
        output = result.stdout.decode('utf-8', errors='ignore').strip()
        return process_name.lower() in output.lower()
    except Exception:
        return False


def kill_old_backend_processes():
    processes_to_kill = [
        'shunlian_backend.exe',
        'shunlian_frontend.exe',
    ]
    for proc_name in processes_to_kill:
        if is_process_running(proc_name):
            logger.info(f"检测到旧进程 {proc_name}，正在终止...")
            try:
                subprocess.run(
                    ['taskkill', '/F', '/IM', proc_name],
                    capture_output=True,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    timeout=10
                )
                logger.info(f"已终止 {proc_name}")
            except subprocess.TimeoutExpired:
                logger.error(f"终止 {proc_name} 超时")
            except Exception as e:
                logger.error(f"终止 {proc_name} 失败: {e}")
    time.sleep(2)


def start_backend():
    base_dir = get_base_dir()
    backend_exe = os.path.join(base_dir, 'shunlian_backend.exe')
    if os.path.exists(backend_exe):
        logger.info(f"启动后端: {backend_exe}")
        proc = subprocess.Popen(
            [backend_exe],
            cwd=base_dir,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
            close_fds=True
        )
        return proc
    else:
        main_py = os.path.join(base_dir, 'main.py')
        python_exe = sys.executable
        logger.info(f"启动后端: {python_exe} {main_py}")
        proc = subprocess.Popen(
            [python_exe, main_py],
            cwd=base_dir,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
            close_fds=True
        )
        return proc


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
    url = f'http://localhost:{HTTP_PORT}'
    logger.info(f"打开浏览器: {url}")
    webbrowser.open(url)


def kill_backend():
    proc_name = 'shunlian_backend.exe'
    if is_process_running(proc_name):
        logger.info(f"终止后端进程: {proc_name}")
        try:
            subprocess.run(
                ['taskkill', '/F', '/IM', proc_name],
                capture_output=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
                timeout=10
            )
        except Exception as e:
            logger.error(f"终止后端失败: {e}")
    time.sleep(2)


def restart_backend():
    logger.info("正在重启后端...")
    kill_backend()
    proc = start_backend()
    elapsed = 0
    while elapsed < MAX_WAIT_SECONDS:
        if is_port_open(HTTP_PORT):
            logger.info("后端重启成功")
            return True
        time.sleep(CHECK_INTERVAL)
        elapsed += CHECK_INTERVAL
    logger.error("后端重启超时")
    return False


def guardian_loop():
    logger.info(f"进程守护已启动（检测间隔 {HEALTH_CHECK_INTERVAL} 秒）")
    consecutive_failures = 0
    restart_times = []

    while True:
        time.sleep(HEALTH_CHECK_INTERVAL)

        port_open = is_port_open(HTTP_PORT)
        api_healthy = check_health_api() if port_open else False
        process_alive = is_process_running('shunlian_backend.exe')

        if process_alive and api_healthy:
            if consecutive_failures > 0:
                logger.info("后端恢复正常")
            consecutive_failures = 0
            continue

        consecutive_failures += 1

        if not process_alive:
            logger.warning(f"后端进程已退出（连续失败 {consecutive_failures}/{MAX_CONSECUTIVE_FAILURES}）")
        elif not port_open:
            logger.warning(f"后端端口未监听（连续失败 {consecutive_failures}/{MAX_CONSECUTIVE_FAILURES}）")
        elif not api_healthy:
            logger.warning(f"后端 API 无响应（连续失败 {consecutive_failures}/{MAX_CONSECUTIVE_FAILURES}）")

        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
            now = time.time()
            restart_times = [t for t in restart_times if now - t < RESTART_WINDOW]
            if len(restart_times) >= MAX_RESTART_COUNT:
                logger.error(f"在 {RESTART_WINDOW} 秒内已重启 {MAX_RESTART_COUNT} 次，暂停重启")
                consecutive_failures = 0
                continue

            logger.warning(f"连续 {MAX_CONSECUTIVE_FAILURES} 次健康检测失败，触发重启")
            if restart_backend():
                restart_times.append(time.time())
                consecutive_failures = 0
            else:
                logger.error("重启失败，将在下个检测周期重试")
                consecutive_failures = 0


def main():
    logger.info("=" * 40)
    logger.info("瞬连调式工具 启动器")
    logger.info("=" * 40)

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
