#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
iperf3 带宽测速处理器
管理 iperf3 进程的启动、停止、输出解析
"""

from __future__ import annotations

import os
import sys
import re
import subprocess
import threading
import json
import time
import logging
from typing import Optional, Callable, Any, Dict, List

logger = logging.getLogger(__name__)


def get_base_dir() -> str:
    """获取程序根目录（兼容 PyInstaller 打包）"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def get_iperf3_path() -> str:
    """获取 iperf3 可执行文件路径"""
    base_dir = get_base_dir()
    if sys.platform == 'win32':
        exe_path = os.path.join(base_dir, 'iperf3', 'iperf3.exe')
    else:
        exe_path = os.path.join(base_dir, 'iperf3', 'iperf3')
    return exe_path


def is_iperf3_available() -> bool:
    """检查 iperf3 是否可用"""
    path = get_iperf3_path()
    return os.path.isfile(path)


class Iperf3Result:
    """iperf3 测速结果汇总"""

    def __init__(self):
        self.mode: str = ''  # server / client
        self.protocol: str = 'TCP'  # TCP / UDP
        self.duration: float = 0.0
        self.total_sent_bits: float = 0.0
        self.total_received_bits: float = 0.0
        self.sent_bps: float = 0.0
        self.received_bps: float = 0.0
        self.sent_bps_human: str = ''
        self.received_bps_human: str = ''
        self.sent_transfer_human: str = ''
        self.received_transfer_human: str = ''
        self.retransmits: int = 0
        self.jitter_ms: float = 0.0
        self.lost_percent: float = 0.0
        self.packets: int = 0
        self.lost_packets: int = 0
        self.raw_output: str = ''
        self.error: str = ''

    def to_dict(self) -> Dict[str, Any]:
        return {
            'mode': self.mode,
            'protocol': self.protocol,
            'duration': self.duration,
            'total_sent_bits': self.total_sent_bits,
            'total_received_bits': self.total_received_bits,
            'sent_bps': self.sent_bps,
            'received_bps': self.received_bps,
            'sent_bps_human': self.sent_bps_human,
            'received_bps_human': self.received_bps_human,
            'sent_transfer_human': self.sent_transfer_human,
            'received_transfer_human': self.received_transfer_human,
            'retransmits': self.retransmits,
            'jitter_ms': self.jitter_ms,
            'lost_percent': self.lost_percent,
            'packets': self.packets,
            'lost_packets': self.lost_packets,
            'error': self.error,
        }


class Iperf3Handler:
    """iperf3 进程管理器"""

    def __init__(self):
        self._process: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._running = False
        self._mode: str = ''  # server / client
        self._output_lines: List[str] = []
        self._output_version: int = 0  # 输出版本号，每次清空时递增
        self._result: Optional[Iperf3Result] = None
        self._on_output: Optional[Callable[[str], None]] = None
        self._reader_thread: Optional[threading.Thread] = None

    @property
    def running(self) -> bool:
        return self._running

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def output_lines(self) -> List[str]:
        return self._output_lines.copy()

    @property
    def result(self) -> Optional[Iperf3Result]:
        return self._result

    def set_output_callback(self, callback: Callable[[str], None]):
        """设置实时输出回调"""
        self._on_output = callback

    def start_server(self, port: int = 5201, one_off: bool = False) -> Dict[str, Any]:
        """启动 iperf3 服务端"""
        with self._lock:
            if not is_iperf3_available():
                return {'status': 'error', 'message': 'iperf3 可执行文件未找到，请确保 iperf3 目录存在'}

            # 如果已有任务运行，先停止
            if self._running:
                self._kill_process()
                self._running = False
                if self._reader_thread and self._reader_thread.is_alive():
                    self._reader_thread.join(timeout=2)

            # 启动前清理残留的 iperf3 进程，避免端口占用
            self._kill_orphan_iperf3()

            exe_path = get_iperf3_path()
            cmd = [exe_path, '-s', '-p', str(port), '--forceflush']
            if one_off:
                cmd.append('--one-off')

            self._mode = 'server'
            self._output_lines = []
            self._result = None

            try:
                self._process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    bufsize=0,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
                )
                self._running = True
                self._start_reader()
                return {'status': 'success', 'message': f'iperf3 服务端已启动，端口 {port}'}
            except Exception as e:
                logger.error(f'启动 iperf3 服务端失败: {e}')
                return {'status': 'error', 'message': f'启动失败: {str(e)}'}

    def start_client(
        self,
        host: str,
        port: int = 5201,
        protocol: str = 'TCP',
        duration: int = 10,
        threads: int = 1,
        bandwidth: str = '',
        reverse: bool = False,
    ) -> Dict[str, Any]:
        """启动 iperf3 客户端"""
        with self._lock:
            if not is_iperf3_available():
                return {'status': 'error', 'message': 'iperf3 可执行文件未找到，请确保 iperf3 目录存在'}

            # 如果已有任务运行，先停止
            if self._running:
                self._kill_process()
                self._running = False
                if self._reader_thread and self._reader_thread.is_alive():
                    self._reader_thread.join(timeout=2)

            # 启动前清理残留的 iperf3 进程，避免端口占用
            self._kill_orphan_iperf3()

            exe_path = get_iperf3_path()
            cmd = [
                exe_path,
                '-c', host,
                '-p', str(port),
                '-t', str(duration),
                '-P', str(threads),
            ]

            if protocol.upper() == 'UDP':
                cmd.extend(['-u'])
                if bandwidth:
                    cmd.extend(['-b', bandwidth])

            if reverse:
                cmd.append('-R')

            # 强制实时刷新输出
            cmd.append('--forceflush')

            self._mode = 'client'
            self._output_lines = []
            self._result = Iperf3Result()
            self._result.mode = 'client'
            self._result.protocol = protocol.upper()
            self._result.duration = duration

            try:
                self._process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    bufsize=0,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
                )
                self._running = True
                self._start_reader()
                return {'status': 'success', 'message': f'iperf3 客户端已启动，连接 {host}:{port}'}
            except Exception as e:
                logger.error(f'启动 iperf3 客户端失败: {e}')
                return {'status': 'error', 'message': f'启动失败: {str(e)}'}

    def _kill_process(self):
        """强制终止 iperf3 进程"""
        if self._process is not None:
            try:
                self._process.terminate()
                try:
                    self._process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    self._process.wait(timeout=3)
            except Exception as e:
                logger.error(f'停止 iperf3 进程异常: {e}')
            finally:
                self._process = None
        self._running = False

    def _kill_orphan_iperf3(self):
        """清理残留的 iperf3 进程"""
        try:
            exe_name = 'iperf3.exe' if sys.platform == 'win32' else 'iperf3'
            subprocess.run(
                ['taskkill', '/F', '/IM', exe_name] if sys.platform == 'win32' else ['pkill', '-f', 'iperf3'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
            )
        except Exception:
            pass

    def stop(self) -> Dict[str, Any]:
        """停止 iperf3 进程"""
        with self._lock:
            if not self._running or self._process is None:
                # 即使没有记录的进程，也尝试清理残留
                self._kill_orphan_iperf3()
                return {'status': 'error', 'message': '没有正在运行的测速任务'}

            self._kill_process()
            self._parse_text_result()
            return {'status': 'success', 'message': '测速已停止'}

    def get_status(self) -> Dict[str, Any]:
        """获取当前测速状态"""
        if not self._running:
            result_dict = self._result.to_dict() if self._result else None
            return {
                'status': 'idle',
                'running': False,
                'mode': self._mode,
                'result': result_dict,
            }

        # 检查进程是否已结束
        if self._process and self._process.poll() is not None:
            self._running = False
            self._parse_text_result()
            result_dict = self._result.to_dict() if self._result else None
            self._process = None
            return {
                'status': 'completed',
                'running': False,
                'mode': self._mode,
                'result': result_dict,
            }

        # 进程仍在运行，但可能已有结果（服务端模式下客户端测试完成）
        result_dict = self._result.to_dict() if self._result else None
        return {
            'status': 'running',
            'running': True,
            'mode': self._mode,
            'result': result_dict,
        }

    def get_all_output(self) -> Dict[str, Any]:
        """获取全部输出行及版本号"""
        return {
            'lines': self._output_lines.copy(),
            'version': self._output_version,
        }

    def _start_reader(self):
        """启动输出读取线程"""
        self._reader_thread = threading.Thread(
            target=self._read_output,
            daemon=True,
        )
        self._reader_thread.start()

    def _read_output(self):
        """读取 iperf3 进程输出"""
        if self._process is None or self._process.stdout is None:
            return

        try:
            for line in iter(self._process.stdout.readline, b''):
                if not line:
                    break
                decoded = line.decode('utf-8', errors='replace').rstrip('\r\n')
                if decoded:
                    # 服务端模式：检测到新客户端连接时，清空旧输出和结果，避免多次测试数据混合
                    if self._mode == 'server' and 'Accepted connection' in decoded:
                        self._output_lines = []
                        self._output_version += 1
                        self._result = None

                    self._output_lines.append(decoded)
                    if self._on_output:
                        try:
                            self._on_output(decoded)
                        except Exception:
                            pass
                    # 服务端模式：检测汇总行，实时更新结果
                    if self._mode == 'server' and self._is_summary_line(decoded):
                        self._parse_text_result()
        except Exception as e:
            logger.error(f'读取 iperf3 输出异常: {e}')
        finally:
            if self._process and self._process.poll() is not None:
                self._running = False
                self._parse_text_result()

    @staticmethod
    def _is_summary_line(line: str) -> bool:
        """判断是否为 iperf3 汇总行"""
        if not re.search(r'\[\s*\d+\]', line):
            return False
        if 'sender' in line or 'receiver' in line:
            return True
        if re.search(r'\d+/\d+\s+\(', line):
            return True
        return False

    def _parse_text_result(self):
        """解析 iperf3 文本输出，提取测速汇总数据"""
        # 每次解析都重置结果，避免上一次测试数据残留
        self._result = Iperf3Result()

        if not self._output_lines:
            self._result.error = '无输出数据'
            return

        self._result.mode = self._mode
        self._result.raw_output = '\n'.join(self._output_lines)

        # 检查连接错误
        for line in self._output_lines:
            lower = line.lower()
            if 'error' in lower and ('connect' in lower or 'refused' in lower or 'timeout' in lower):
                self._result.error = line.strip()
                return
            if 'unable to connect' in lower:
                self._result.error = line.strip()
                return

        # 检测协议
        is_udp = any(
            'Datagrams' in line or re.search(r'\d+/\d+\s+\(', line)
            for line in self._output_lines
        )
        self._result.protocol = 'UDP' if is_udp else 'TCP'

        # TCP 汇总行正则
        # 格式: [  5]   0.00-10.00  sec  1.10 GBytes   941 Mbits/sec    sender
        # 或:   [  5]   0.00-10.00  sec  1.10 GBytes   941 Mbits/sec  123 sender
        tcp_sender_re = re.compile(
            r'\[\s*\d+\]\s+[\d.]+-[\d.]+\s+sec\s+'
            r'([\d.]+)\s+([KMGT]?Bytes)\s+'
            r'([\d.]+)\s+([KMGT]?bits/sec)\s+(\d+)?\s*sender',
            re.IGNORECASE
        )
        tcp_receiver_re = re.compile(
            r'\[\s*\d+\]\s+[\d.]+-[\d.]+\s+sec\s+'
            r'([\d.]+)\s+([KMGT]?Bytes)\s+'
            r'([\d.]+)\s+([KMGT]?bits/sec)\s+receiver',
            re.IGNORECASE
        )

        # UDP 汇总行正则
        # 格式: [  5]   0.00-10.00  sec  1.12 GBytes   962 Mbits/sec  0.023 ms  0/802891 (0%)
        udp_summary_re = re.compile(
            r'\[\s*\d+\]\s+[\d.]+-[\d.]+\s+sec\s+'
            r'([\d.]+)\s+([KMGT]?Bytes)\s+'
            r'([\d.]+)\s+([KMGT]?bits/sec)\s+([\d.]+)\s+ms\s+(\d+)/(\d+)\s+\(([\d.]+)%\)',
            re.IGNORECASE
        )

        if is_udp:
            for line in reversed(self._output_lines):
                m = udp_summary_re.search(line)
                if m:
                    self._result.sent_transfer_human = f'{m.group(1)} {self._format_bps_unit(m.group(2))}'
                    self._result.sent_bps = self._parse_bps_value(float(m.group(3)), m.group(4))
                    self._result.received_bps = self._result.sent_bps
                    self._result.sent_bps_human = f'{m.group(3)} {self._format_bps_unit(m.group(4))}'
                    self._result.received_bps_human = self._result.sent_bps_human
                    self._result.received_transfer_human = self._result.sent_transfer_human
                    self._result.jitter_ms = float(m.group(5))
                    self._result.lost_packets = int(m.group(6))
                    self._result.packets = int(m.group(7))
                    self._result.lost_percent = float(m.group(8))
                    break
        else:
            # 找最后的 sender 和 receiver 行
            for line in reversed(self._output_lines):
                if not self._result.sent_bps:
                    m = tcp_sender_re.search(line)
                    if m:
                        self._result.sent_transfer_human = f'{m.group(1)} {self._format_bps_unit(m.group(2))}'
                        self._result.sent_bps = self._parse_bps_value(float(m.group(3)), m.group(4))
                        self._result.sent_bps_human = f'{m.group(3)} {self._format_bps_unit(m.group(4))}'
                        if m.group(5):
                            self._result.retransmits = int(m.group(5))
                if not self._result.received_bps:
                    m = tcp_receiver_re.search(line)
                    if m:
                        self._result.received_transfer_human = f'{m.group(1)} {self._format_bps_unit(m.group(2))}'
                        self._result.received_bps = self._parse_bps_value(float(m.group(3)), m.group(4))
                        self._result.received_bps_human = f'{m.group(3)} {self._format_bps_unit(m.group(4))}'

        # 解析测速时长
        for line in reversed(self._output_lines):
            m = re.search(r'([\d.]+)-([\d.]+)\s+sec', line)
            if m and ('sender' in line or 'receiver' in line or '%' in line):
                self._result.duration = round(float(m.group(2)) - float(m.group(1)), 1)
                break

    @staticmethod
    def _parse_bps_value(value: float, unit: str) -> float:
        """将带单位的比特率转换为 bps"""
        unit_lower = unit.lower()
        if unit_lower.startswith('g'):
            return value * 1e9
        elif unit_lower.startswith('m'):
            return value * 1e6
        elif unit_lower.startswith('k'):
            return value * 1e3
        else:
            return value

    @staticmethod
    def _format_bps_unit(unit: str) -> str:
        """将 iperf3 原始单位转为简洁格式，如 Mbits/sec -> Mbit/s"""
        return unit.replace('bits/sec', 'bit/s').replace('Bytes/sec', 'B/s')

    @staticmethod
    def _format_bps(bps: float) -> str:
        """格式化比特率"""
        if bps <= 0:
            return '0 bps'
        units = ['bps', 'Kbps', 'Mbps', 'Gbps']
        unit_index = 0
        value = bps
        while value >= 1000 and unit_index < len(units) - 1:
            value /= 1000
            unit_index += 1
        return f'{value:.2f} {units[unit_index]}'


# 全局单例
iperf3_handler = Iperf3Handler()
