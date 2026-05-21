#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
瞬连调式工具 进程守护
- 持续监控后端进程健康状态
- 后端无响应或崩溃时自动重启
- 健康检测：端口检测 + API 心跳
- 退出时自动清理后端进程
"""

import os
import sys
import time
import socket
import signal
import logging
import codecs
import threading
import subprocess

try:
    import urllib.request
    import urllib.error
    HAS_URLLIB = True
except ImportError:
    HAS_URLLIB = False

HTTP_PORT = 32995
HEALTH_CHECK_INTERVAL = 10
HEALTH_CHECK_TIMEOUT = 5
MAX_CONSECUTIVE_FAILURES = 3
RESTART_COOLDOWN = 10
MAX_RESTART_COUNT = 5
RESTART_WINDOW = 300
BACKEND_STARTUP_TIMEOUT = 30
BACKEND_STARTUP_CHECK_INTERVAL = 0.5


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
    _log_file = os.path.join(get_log_dir(), 'guardian.log')
    _log_stream = codecs.open(_log_file, mode='a', encoding='utf-8')
    _handler = logging.StreamHandler(_log_stream)
    _handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
    logging.basicConfig(level=logging.INFO, handlers=[_handler])
else:
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('Guardian')


class ProcessGuardian:
    def __init__(self):
        self.base_dir = get_base_dir()
        self.backend_process = None
        self.consecutive_failures = 0
        self.restart_count = 0
        self.restart_times = []
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

    def is_port_open(self, port, host='127.0.0.1'):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(2)
                result = s.connect_ex((host, port))
                return result == 0
        except Exception:
            return False

    def check_health_api(self):
        if not HAS_URLLIB:
            return self.is_port_open(HTTP_PORT)
        try:
            url = f'http://127.0.0.1:{HTTP_PORT}/api/health'
            req = urllib.request.Request(url, method='GET')
            with urllib.request.urlopen(req, timeout=HEALTH_CHECK_TIMEOUT) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        return False

    def is_backend_process_alive(self):
        with self._lock:
            if self.backend_process is None:
                return False
            return self.backend_process.poll() is None

    def is_process_running_by_name(self, process_name):
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

    def kill_backend(self):
        with self._lock:
            if self.backend_process is not None:
                try:
                    self.backend_process.terminate()
                    try:
                        self.backend_process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self.backend_process.kill()
                        self.backend_process.wait(timeout=3)
                except Exception as e:
                    logger.warning(f"终止后端进程异常: {e}")
                self.backend_process = None

        proc_name = 'shunlian_backend.exe'
        if self.is_process_running_by_name(proc_name):
            logger.info(f"通过进程名终止残留后端进程: {proc_name}")
            try:
                subprocess.run(
                    ['taskkill', '/F', '/IM', proc_name],
                    capture_output=True,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    timeout=10
                )
            except Exception as e:
                logger.error(f"终止残留进程失败: {e}")
        time.sleep(2)

    def start_backend(self):
        backend_exe = os.path.join(self.base_dir, 'shunlian_backend.exe')
        if os.path.exists(backend_exe):
            logger.info(f"启动后端: {backend_exe}")
            with self._lock:
                self.backend_process = subprocess.Popen(
                    [backend_exe],
                    cwd=self.base_dir,
                    creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
                    close_fds=True
                )
        else:
            main_py = os.path.join(self.base_dir, 'main.py')
            python_exe = sys.executable
            logger.info(f"启动后端: {python_exe} {main_py}")
            with self._lock:
                self.backend_process = subprocess.Popen(
                    [python_exe, main_py],
                    cwd=self.base_dir,
                    creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
                    close_fds=True
                )

    def wait_for_backend_startup(self):
        logger.info(f"等待后端启动（端口 {HTTP_PORT}）...")
        elapsed = 0
        while elapsed < BACKEND_STARTUP_TIMEOUT:
            if self._stop_event.is_set():
                return False
            if self.is_port_open(HTTP_PORT):
                logger.info("后端已启动")
                return True
            time.sleep(BACKEND_STARTUP_CHECK_INTERVAL)
            elapsed += BACKEND_STARTUP_CHECK_INTERVAL
        logger.error(f"后端启动超时（{BACKEND_STARTUP_TIMEOUT}秒）")
        return False

    def restart_backend(self):
        now = time.time()
        self.restart_times = [t for t in self.restart_times if now - t < RESTART_WINDOW]
        if len(self.restart_times) >= MAX_RESTART_COUNT:
            logger.error(f"在 {RESTART_WINDOW} 秒内已重启 {MAX_RESTART_COUNT} 次，停止重启")
            return False

        logger.info("正在重启后端...")
        self.kill_backend()

        logger.info(f"等待 {RESTART_COOLDOWN} 秒后重启...")
        if self._stop_event.wait(RESTART_COOLDOWN):
            return False

        self.start_backend()
        if self.wait_for_backend_startup():
            self.restart_times.append(time.time())
            self.consecutive_failures = 0
            logger.info("后端重启成功")
            return True
        else:
            logger.error("后端重启失败")
            return False

    def health_check_loop(self):
        logger.info(f"健康检测已启动（间隔 {HEALTH_CHECK_INTERVAL} 秒）")
        while not self._stop_event.is_set():
            if self._stop_event.wait(HEALTH_CHECK_INTERVAL):
                break

            process_alive = self.is_backend_process_alive()
            port_open = self.is_port_open(HTTP_PORT)
            api_healthy = self.check_health_api() if port_open else False

            if process_alive and api_healthy:
                if self.consecutive_failures > 0:
                    logger.info("后端恢复正常")
                self.consecutive_failures = 0
                continue

            self.consecutive_failures += 1

            if not process_alive:
                logger.warning(f"后端进程已退出（连续失败 {self.consecutive_failures}/{MAX_CONSECUTIVE_FAILURES}）")
            elif not port_open:
                logger.warning(f"后端端口未监听（连续失败 {self.consecutive_failures}/{MAX_CONSECUTIVE_FAILURES}）")
            elif not api_healthy:
                logger.warning(f"后端 API 无响应（连续失败 {self.consecutive_failures}/{MAX_CONSECUTIVE_FAILURES}）")

            if self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                logger.warning(f"连续 {MAX_CONSECUTIVE_FAILURES} 次健康检测失败，触发重启")
                if not self.restart_backend():
                    logger.error("重启失败，将在下次检测周期重试")
                    self.consecutive_failures = 0

    def kill_old_processes(self):
        processes_to_kill = [
            'shunlian_backend.exe',
            'shunlian_frontend.exe',
        ]
        for proc_name in processes_to_kill:
            if self.is_process_running_by_name(proc_name):
                logger.info(f"检测到旧进程 {proc_name}，正在终止...")
                try:
                    subprocess.run(
                        ['taskkill', '/F', '/IM', proc_name],
                        capture_output=True,
                        creationflags=subprocess.CREATE_NO_WINDOW,
                        timeout=10
                    )
                    logger.info(f"已终止 {proc_name}")
                except Exception as e:
                    logger.error(f"终止 {proc_name} 失败: {e}")
        time.sleep(2)

    def start(self):
        logger.info("=" * 40)
        logger.info("瞬连调式工具 进程守护")
        logger.info("=" * 40)

        self.kill_old_processes()

        backend_running = self.is_port_open(HTTP_PORT)
        if backend_running:
            logger.info("后端已在运行")
            proc_name = 'shunlian_backend.exe'
            if self.is_process_running_by_name(proc_name):
                logger.info("后端进程已存在，进入监控模式")
            else:
                logger.info("端口已占用但非本程序后端，将重启")
                self.kill_backend()
                self.start_backend()
                if not self.wait_for_backend_startup():
                    logger.error("后端启动失败")
                    return
        else:
            logger.info("后端未运行，正在启动...")
            self.start_backend()
            if not self.wait_for_backend_startup():
                logger.error("后端启动失败")
                return

        self.health_check_loop()

    def stop(self):
        logger.info("进程守护正在停止...")
        self._stop_event.set()
        self.kill_backend()
        logger.info("进程守护已停止")


def main():
    guardian = ProcessGuardian()

    def signal_handler(signum, frame):
        guardian.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        guardian.start()
    except KeyboardInterrupt:
        guardian.stop()
    except Exception as e:
        logger.error(f"进程守护异常: {e}", exc_info=True)
        guardian.stop()


if __name__ == '__main__':
    main()
