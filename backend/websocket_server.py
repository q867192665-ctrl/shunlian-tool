#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# pyright: reportAny=false, reportExplicitAny=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false, reportUnknownLambdaType=false, reportUnreachable=false
"""
WebSocket 服务器，用于实时获取设备日志和接口列表
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import websockets
from websockets.protocol import State as WsState
import json
import threading
import time
import socket
import logging
import yaml
import telnetlib
from typing import Any, TYPE_CHECKING
import sys
from mikrotik_api import MikroTikAPI, get_telnet_port
from api_server import api_pool, api_pool_lock
from connection_manager import connection_manager, CONNECTION_ROLE_INTERFACE, CONNECTION_ROLE_WIRELESS, CONNECTION_ROLE_GENERAL
# librouteros 是可选依赖，仅在需要读取日志文件时使用
# 如果未安装，日志文件读取功能将不可用，但不影响 WebSocket 服务器
try:
    from librouteros import connect as librouteros_connect
    HAS_LIBROUTEROS = True
except ImportError:
    librouteros_connect = None  # type: ignore[reportAny]
    HAS_LIBROUTEROS = False

if TYPE_CHECKING:
    from websockets.asyncio.server import ServerConnection as WebSocketConn
else:
    WebSocketConn = object


def is_ws_closed(websocket: WebSocketConn) -> bool:
    """兼容 websockets 新旧版本的 WebSocket 关闭状态检测"""
    # websockets >= 13 使用 state 属性
    if hasattr(websocket, 'state'):
        return websocket.state == WsState.CLOSED  # type: ignore[reportAny, reportAttributeAccessIssue]
    # websockets < 13 使用 closed 属性
    if hasattr(websocket, 'closed'):
        return websocket.closed  # pyright: ignore[reportAttributeAccessIssue]
    return False

logger = logging.getLogger(__name__)

# ==================== 路径工具 ====================

def get_base_dir():
    """获取程序根目录（兼容 PyInstaller 打包）"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

# ==================== 配置加载 ====================

def load_config() -> dict[str, Any]:
    """加载配置文件"""
    config_path = os.path.join(get_base_dir(), 'config.yaml')
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            result: dict[str, Any] = yaml.safe_load(f) or {}  # type: ignore[reportAny]
            return result
    return {}

CONFIG: dict[str, Any] = load_config()

# ==================== 轮询间隔配置 ====================

POLLING_CONFIG: dict[str, Any] = CONFIG.get('polling', {})
INTERFACE_INTERVAL: int = int(POLLING_CONFIG.get('interface_interval', 2))
WIRELESS_INTERVAL: int = int(POLLING_CONFIG.get('wireless_interval', 2))
SECURITY_PROFILE_INTERVAL: int = int(POLLING_CONFIG.get('security_profile_interval', 3))
IP_ADDRESS_INTERVAL: int = int(POLLING_CONFIG.get('ip_address_interval', 3))
CLIENT_INTERVAL: int = int(POLLING_CONFIG.get('client_interval', 1))
KEEPALIVE_INTERVAL: int = int(POLLING_CONFIG.get('keepalive_interval', 5))
MAX_CONSECUTIVE_ERRORS: int = int(POLLING_CONFIG.get('max_consecutive_errors', 5))


# 存储WebSocket服务器的主事件循环（用于跨线程调用）
websocket_event_loop: asyncio.AbstractEventLoop | None = None

# 存储活跃的 WebSocket 连接
active_connections: dict[str, set[WebSocketConn]] = {}
connections_lock: threading.Lock = threading.Lock()

# 存储每个连接的过滤参数
connection_filters: dict[str, dict[str, str | None]] = {}
filters_lock: threading.Lock = threading.Lock()

# 存储每个设备的最后活动时间（用于检测离线）
device_last_activity: dict[str, float] = {}
activity_lock: threading.Lock = threading.Lock()

# 存储每个设备的 keepalive 心跳任务
device_watch_tasks: dict[str, asyncio.Task[None]] = {}
tasks_lock: threading.Lock = threading.Lock()

# 存储每个设备的 API 连接
device_api_connections: dict[str, MikroTikAPI] = {}
api_conn_lock: threading.Lock = threading.Lock()

# 存储接口列表轮询任务
interface_polling_tasks: dict[str, asyncio.Task[None]] = {}
interface_polling_lock: threading.Lock = threading.Lock()

# 存储接口列表的独立API连接
interface_api_connections: dict[str, MikroTikAPI] = {}
interface_api_lock: threading.Lock = threading.Lock()

# 存储设备下载状态
device_download_status: dict[str, bool] = {}
download_status_lock: threading.Lock = threading.Lock()

# 存储桥接口轮询任务的API连接（操作处理复用此连接，避免创建第二个连接导致并发冲突）
bridge_polling_api_connections: dict[str, MikroTikAPI] = {}
bridge_polling_api_lock: threading.Lock = threading.Lock()

# 存储桥接口操作的备用API连接（仅在轮询连接不可用时使用）
bridge_action_api_connections: dict[str, MikroTikAPI] = {}
bridge_action_api_lock: threading.Lock = threading.Lock()

ip_addresses_polling_api_connections: dict[str, MikroTikAPI] = {}
ip_addresses_polling_api_lock: threading.Lock = threading.Lock()

# ==================== 桥接口操作API连接管理 ====================

def get_bridge_action_api(device_ip: str, username: str, password: str) -> MikroTikAPI:
    """获取桥接口操作的API连接（创建独立连接，不复用轮询连接以避免线程安全问题）"""
    api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
    success, message = api.login()
    if success:
        return api
    else:
        raise ConnectionError(f'连接失败: {message}')


def register_bridge_polling_api(device_ip: str, api: MikroTikAPI) -> None:
    """注册桥接口轮询任务的API连接，供操作处理复用"""
    with bridge_polling_api_lock:
        bridge_polling_api_connections[device_ip] = api


def unregister_bridge_polling_api(device_ip: str) -> None:
    """移除桥接口轮询任务的API连接"""
    with bridge_polling_api_lock:
        bridge_polling_api_connections.pop(device_ip, None)


def close_bridge_action_api(device_ip: str) -> None:
    """关闭并移除桥接口操作的API连接"""
    with bridge_action_api_lock:
        if device_ip in bridge_action_api_connections:
            api = bridge_action_api_connections.pop(device_ip)
            try:
                api.close()
            except:
                pass


# ==================== IP地址轮询API连接管理 ====================

def get_ip_address_action_api(device_ip: str, username: str, password: str) -> MikroTikAPI:
    """获取IP地址操作的API连接（创建独立连接，不复用轮询连接以避免线程安全问题）"""
    api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
    success, message = api.login()
    if success:
        return api
    else:
        raise ConnectionError(f'连接失败: {message}')


def register_ip_addresses_polling_api(device_ip: str, api: MikroTikAPI) -> None:
    """注册IP地址轮询任务的API连接"""
    with ip_addresses_polling_api_lock:
        ip_addresses_polling_api_connections[device_ip] = api


def unregister_ip_addresses_polling_api(device_ip: str) -> None:
    """移除IP地址轮询任务的API连接"""
    with ip_addresses_polling_api_lock:
        ip_addresses_polling_api_connections.pop(device_ip, None)


def get_ip_addresses_sync(api: MikroTikAPI, read_timeout: int = 3) -> tuple[list[dict[str, str]] | None, str | None]:
    """获取IP地址列表（同步版本，模块级别函数）"""
    addresses = []
    try:
        api.write_sentence(['/ip/address/print'])
        
        while True:
            try:
                response = api.read_sentence(timeout=read_timeout)
            except Exception as e:
                return None, str(e)
            
            if '!done' in response:
                break
            if '!trap' in response:
                break
            if '!re' in response:
                addr = {}
                for line in response:
                    if line.startswith('='):
                        parts = line[1:].split('=', 1)
                        if len(parts) == 2:
                            key, value = parts
                            addr[key] = value
                
                if addr:
                    addresses.append({
                        '.id': addr.get('.id', ''),
                        'address': addr.get('address', '--'),
                        'network': addr.get('network', '--'),
                        'interface': addr.get('interface', '--'),
                        'name': addr.get('name', ''),
                        'disabled': addr.get('disabled', 'false'),
                        'dynamic': addr.get('dynamic', 'false'),
                        'comment': addr.get('comment', '')
                    })
        
        return addresses, None
    except Exception as e:
        return None, str(e)


# ==================== 无线接口获取函数 ====================

def get_wireless_interfaces_sync(api: MikroTikAPI, read_timeout: int = 3) -> tuple[list[dict[str, str | bool]] | None, str | None]:
    """获取无线接口列表（同步版本，模块级别函数）"""
    max_internal_retries = 2
    for attempt in range(max_internal_retries + 1):
        interfaces = []
        try:
            api.write_sentence(['/interface/wireless/print',
                                '.proplist=.id,name,running,disabled,mode,ssid,frequency,band,channel-width,wireless-protocol,default-authentication,default-forwarding,hide-ssid,multicast-buffering,keepalive-frames,installation,country,frequency-mode,scan-list,default-ap-tx-limit,default-client-tx-limit,multicast-helper,area,distance,max-station-count,burst-time,hw-retries,adaptive-noise-immunity,preamble-mode,disconnect-timeout,on-fail-retry-time,update-stats-interval,tx-power-mode,supported-rates-b,supported-rates-a/g,basic-rates-b,basic-rates-a/g,radio-name,arp,mtu,l2mtu,type,mac-address,comment,master-interface,wps-mode,security-profile,rate-set,tx-power,guard-interval,tx-chains,rx-chains,wmm-support,ampdu-priorities,amsdu-limit,amsdu-threshold,ht-stbc,ht-ldpc,ht-basic-mcs,ht-supported-mcs,antenna-gain,antenna-mode,noise-floor-threshold,frame-lifetime,hw-fragmentation-threshold,hw-protection-mode,hw-protection-threshold,interworking-profile,allow-sharedkey'])
            while True:
                response = api.read_sentence(timeout=read_timeout)
                
                if '!done' in response:
                    break
                if '!trap' in response:
                    break
                if '!re' in response:
                    iface = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                key, value = parts
                                iface[key] = value
                    
                    if iface:
                        def convert_bool(value):
                            if value in ('true', 'enabled'):
                                return 'yes'
                            elif value in ('false', 'disabled'):
                                return 'no'
                            return value
                        
                        interfaces.append({
                            '.id': iface.get('.id', ''),
                            'name': iface.get('name', '--'),
                            'running': iface.get('running', 'false') == 'true',
                            'disabled': iface.get('disabled', 'false') == 'true',
                            'mode': iface.get('mode', '--'),
                            'ssid': iface.get('ssid', '--'),
                            'frequency': iface.get('frequency', '--'),
                            'band': iface.get('band', '--'),
                            'channel-width': iface.get('channel-width', '--'),
                            'wireless-protocol': iface.get('wireless-protocol', '--'),
                            'default-authenticate': convert_bool(iface.get('default-authentication', iface.get('default-authenticate', ''))),
                            'default-forwarding': convert_bool(iface.get('default-forwarding', '')),
                            'hide-ssid': convert_bool(iface.get('hide-ssid', '')),
                            'multicast-buffering': iface.get('multicast-buffering', ''),
                            'keepalive-frames': iface.get('keepalive-frames', ''),
                            'installation': iface.get('installation', ''),
                            'country': iface.get('country', ''),
                            'frequency-mode': iface.get('frequency-mode', ''),
                            'scan-list': iface.get('scan-list', ''),
                            'default-ap-tx-limit': iface.get('default-ap-tx-limit', ''),
                            'default-client-tx-limit': iface.get('default-client-tx-limit', ''),
                            'multicast-helper': iface.get('multicast-helper', ''),
                            'area': iface.get('area', ''),
                            'max-station-count': iface.get('max-station-count', ''),
                            'burst-time': iface.get('burst-time', ''),
                            'hw-retries': iface.get('hw-retries', ''),
                            'adaptive-noise-immunity': iface.get('adaptive-noise-immunity', ''),
                            'preamble-mode': iface.get('preamble-mode', ''),
                            'disconnect-timeout': iface.get('disconnect-timeout', ''),
                            'on-fail-retry-time': iface.get('on-fail-retry-time', ''),
                            'update-stats-interval': iface.get('update-stats-interval', ''),
                            'tx-power-mode': iface.get('tx-power-mode', ''),
                            'supported-rates-b': iface.get('supported-rates-b', ''),
                            'supported-rates-a/g': iface.get('supported-rates-a/g', ''),
                            'basic-rates-b': iface.get('basic-rates-b', ''),
                            'basic-rates-a/g': iface.get('basic-rates-a/g', ''),
                            'supported-rates-b-1Mbps': convert_bool(iface.get('supported-rates-b-1Mbps', '')),
                            'supported-rates-b-2Mbps': convert_bool(iface.get('supported-rates-b-2Mbps', '')),
                            'supported-rates-b-5.5Mbps': convert_bool(iface.get('supported-rates-b-5.5Mbps', '')),
                            'supported-rates-b-11Mbps': convert_bool(iface.get('supported-rates-b-11Mbps', '')),
                            'supported-rates-ag-6Mbps': convert_bool(iface.get('supported-rates-a/g-6Mbps', iface.get('supported-rates-ag-6Mbps', ''))),
                            'supported-rates-ag-9Mbps': convert_bool(iface.get('supported-rates-a/g-9Mbps', iface.get('supported-rates-ag-9Mbps', ''))),
                            'supported-rates-ag-12Mbps': convert_bool(iface.get('supported-rates-a/g-12Mbps', iface.get('supported-rates-ag-12Mbps', ''))),
                            'supported-rates-ag-18Mbps': convert_bool(iface.get('supported-rates-a/g-18Mbps', iface.get('supported-rates-ag-18Mbps', ''))),
                            'supported-rates-ag-24Mbps': convert_bool(iface.get('supported-rates-a/g-24Mbps', iface.get('supported-rates-ag-24Mbps', ''))),
                            'supported-rates-ag-36Mbps': convert_bool(iface.get('supported-rates-a/g-36Mbps', iface.get('supported-rates-ag-36Mbps', ''))),
                            'supported-rates-ag-48Mbps': convert_bool(iface.get('supported-rates-a/g-48Mbps', iface.get('supported-rates-ag-48Mbps', ''))),
                            'supported-rates-ag-54Mbps': convert_bool(iface.get('supported-rates-a/g-54Mbps', iface.get('supported-rates-ag-54Mbps', ''))),
                            'basic-rates-b-1Mbps': convert_bool(iface.get('basic-rates-b-1Mbps', '')),
                            'basic-rates-b-2Mbps': convert_bool(iface.get('basic-rates-b-2Mbps', '')),
                            'basic-rates-b-5.5Mbps': convert_bool(iface.get('basic-rates-b-5.5Mbps', '')),
                            'basic-rates-b-11Mbps': convert_bool(iface.get('basic-rates-b-11Mbps', '')),
                            'basic-rates-ag-6Mbps': convert_bool(iface.get('basic-rates-a/g-6Mbps', iface.get('basic-rates-ag-6Mbps', ''))),
                            'basic-rates-ag-9Mbps': convert_bool(iface.get('basic-rates-a/g-9Mbps', iface.get('basic-rates-ag-9Mbps', ''))),
                            'basic-rates-ag-12Mbps': convert_bool(iface.get('basic-rates-a/g-12Mbps', iface.get('basic-rates-ag-12Mbps', ''))),
                            'basic-rates-ag-18Mbps': convert_bool(iface.get('basic-rates-a/g-18Mbps', iface.get('basic-rates-ag-18Mbps', ''))),
                            'basic-rates-ag-24Mbps': convert_bool(iface.get('basic-rates-a/g-24Mbps', iface.get('basic-rates-ag-24Mbps', ''))),
                            'basic-rates-ag-36Mbps': convert_bool(iface.get('basic-rates-a/g-36Mbps', iface.get('basic-rates-ag-36Mbps', ''))),
                            'basic-rates-ag-48Mbps': convert_bool(iface.get('basic-rates-a/g-48Mbps', iface.get('basic-rates-ag-48Mbps', ''))),
                            'basic-rates-ag-54Mbps': convert_bool(iface.get('basic-rates-a/g-54Mbps', iface.get('basic-rates-ag-54Mbps', ''))),
                            'radio-name': iface.get('radio-name', ''),
                            'arp': iface.get('arp', ''),
                            'mtu': iface.get('mtu', ''),
                            'l2mtu': iface.get('l2mtu', ''),
                            'type': iface.get('type', ''),
                            'mac-address': iface.get('mac-address', ''),
                            'comment': iface.get('comment', ''),
                            'master-interface': iface.get('master-interface', ''),
                            'wps-mode': iface.get('wps-mode', ''),
                            'security-profile': iface.get('security-profile', ''),
                            'rate-set': iface.get('rate-set', ''),
                            'tx-power': iface.get('tx-power', '')
                        })
            
            print(f"[无线接口] 成功获取 {len(interfaces)} 个接口: {[i.get('name', '') for i in interfaces]}")
            return interfaces, None
        except Exception as e:
            print(f"[无线接口] 获取异常 (尝试 {attempt+1}/{max_internal_retries+1}): {e}")
            if attempt >= max_internal_retries:
                return None, str(e)
    
    print(f"[无线接口] 获取失败，重试耗尽")
    return None, "获取无线接口失败（重试耗尽）"


def clear_device_download_status(identifier: str) -> None:
    """清除设备的下载状态标记"""
    with download_status_lock:
        if identifier in device_download_status:
            del device_download_status[identifier]
            print(f"[下载状态] 已清除 {identifier} 的下载标记")


log_cache_store: dict[str, dict] = {}
log_cache_store_lock: threading.Lock = threading.Lock()
log_api_connections: dict[str, MikroTikAPI] = {}
log_api_connections_lock: threading.Lock = threading.Lock()


def register_log_api(ip: str, api: MikroTikAPI) -> None:
    with log_api_connections_lock:
        if ip in log_api_connections:
            old_api = log_api_connections[ip]
            try:
                old_api.close()
            except:
                pass
        log_api_connections[ip] = api


def unregister_log_api(ip: str) -> None:
    with log_api_connections_lock:
        if ip in log_api_connections:
            del log_api_connections[ip]


def close_log_api_connection(ip: str) -> None:
    with log_api_connections_lock:
        if ip in log_api_connections:
            api = log_api_connections[ip]
            try:
                api.close()
                print(f"[日志] 已关闭 {ip} 的连接")
            except:
                pass
            del log_api_connections[ip]


def get_log_cache(ip: str) -> dict:
    with log_cache_store_lock:
        if ip not in log_cache_store:
            log_cache_store[ip] = {
                'logs': [],
                'last_time': None,
                'last_raw_time': None,
                'last_id': None,
                'seq': 0,
                'lock': threading.Lock(),
                'processed_logs': set(),
                'log_counter': 0,
            }
            print(f"[日志缓存] 创建新缓存: {ip}")
        return log_cache_store[ip]


def clear_log_cache(ip: str) -> None:
    close_log_api_connection(ip)
    with log_cache_store_lock:
        if ip in log_cache_store:
            cache = log_cache_store.pop(ip)
            log_count = len(cache.get('logs', []))
            print(f"[日志缓存] 已清理 {ip} 的缓存 (共 {log_count} 条日志)")
        else:
            print(f"[日志缓存] 未找到 {ip} 的缓存 (当前缓存: {list(log_cache_store.keys())})")


class TrafficMonitorManager:
    """流量监控管理器，使用单个连接监控所有接口"""
    
    def __init__(self, device_ip: str, username: str, password: str) -> None:
        self.device_ip: str = device_ip
        self.username: str = username
        self.password: str = password
        self.traffic_data: dict[str, dict[str, int]] = {}
        self.traffic_data_lock: threading.Lock = threading.Lock()
        self.monitor_thread: threading.Thread | None = None
        self.monitor_api: MikroTikAPI | None = None
        self.running: bool = False
        self.paused: bool = False
        self.websocket: WebSocketConn | None = None
        self.send_task: asyncio.Task[None] | None = None
        self.current_interfaces: list[str] = []
    
    def _start_monitor_sync(self):
        """同步方式启动流量监控（在线程中运行）"""
        max_reconnect_attempts = 3
        reconnect_delay = 2
        
        try:
            self.monitor_api = MikroTikAPI(self.device_ip, self.username, self.password, port=8728, use_ssl=False)
            success, message = self.monitor_api.login()
            
            if not success:
                print(f"[流量监控] 连接失败: {message}，标记设备离线")
                try:
                    mark_device_offline(self.device_ip)
                except Exception as notify_err:
                    print(f"[流量监控] 离线通知失败: {notify_err}")
                return
            
            consecutive_timeouts = 0
            max_consecutive_timeouts = 3
            
            while self.running and self.current_interfaces:
                try:
                    interface_list = ','.join(self.current_interfaces)
                    print(f"[流量监控] 开始监控: {interface_list}")
                    
                    consecutive_timeouts = 0
                    
                    while self.running and self.current_interfaces:
                        try:
                            self.monitor_api.write_sentence(['/interface/monitor-traffic', f'=interface={interface_list}', '=once=yes'])
                            
                            if self.monitor_api.socket is not None:
                                self.monitor_api.socket.settimeout(5)
                            
                            while True:
                                try:
                                    response = self.monitor_api.read_sentence(timeout=5)
                                except socket.timeout:
                                    break
                                
                                if not response:
                                    break
                                if '!done' in response:
                                    break
                                if '!trap' in response:
                                    print(f"[流量监控] 收到trap: {response}")
                                    break
                                if '!re' in response:
                                    iface_name = None
                                    tx_bps = 0
                                    rx_bps = 0
                                    
                                    for line in response:
                                        if line.startswith('=name='):
                                            iface_name = line.split('=')[2]
                                        elif line.startswith('=tx-bits-per-second='):
                                            try:
                                                tx_bps = int(line.split('=')[2])
                                            except:
                                                pass
                                        elif line.startswith('=rx-bits-per-second='):
                                            try:
                                                rx_bps = int(line.split('=')[2])
                                            except:
                                                pass
                                    
                                    if iface_name:
                                        with self.traffic_data_lock:
                                            self.traffic_data[iface_name] = {
                                                'tx_bps': tx_bps,
                                                'rx_bps': rx_bps
                                            }
                                        consecutive_timeouts = 0
                            
                            time.sleep(1)
                            
                        except socket.timeout:
                            consecutive_timeouts += 1
                            if consecutive_timeouts >= max_consecutive_timeouts:
                                print(f"[流量监控] 连续{consecutive_timeouts}次超时，连接可能已失效，尝试重连")
                                break
                            time.sleep(1)
                            continue
                        except Exception as e:
                            if self.running:
                                print(f"[流量监控] 读取数据异常: {e}")
                            consecutive_timeouts += 1
                            if consecutive_timeouts >= max_consecutive_timeouts:
                                break
                            time.sleep(1)
                            continue
                    
                    if self.running:
                        if consecutive_timeouts >= max_consecutive_timeouts:
                            print(f"[流量监控] 连接失效，尝试重新连接...")
                            for attempt in range(max_reconnect_attempts):
                                if not self.running:
                                    print(f"[流量监控] 监控已停止，退出重连循环")
                                    break
                                try:
                                    if self.monitor_api:
                                        try:
                                            self.monitor_api.close()
                                        except:
                                            pass
                                    
                                    self.monitor_api = MikroTikAPI(self.device_ip, self.username, self.password, port=8728, use_ssl=False)
                                    success, message = self.monitor_api.login()
                                    
                                    if success:
                                        print(f"[流量监控] 重连成功: {message}")
                                        consecutive_timeouts = 0
                                        break
                                    else:
                                        print(f"[流量监控] 重连失败 ({attempt+1}/{max_reconnect_attempts}): {message}")
                                        time.sleep(reconnect_delay)
                                except Exception as reconnect_err:
                                    print(f"[流量监控] 重连异常 ({attempt+1}/{max_reconnect_attempts}): {reconnect_err}")
                                    time.sleep(reconnect_delay)
                            
                            if not self.running:
                                break
                            else:
                                print(f"[流量监控] 重连失败，已达最大重试次数，标记设备离线")
                                try:
                                    mark_device_offline(self.device_ip)
                                except Exception as notify_err:
                                    print(f"[流量监控] 离线通知失败: {notify_err}")
                                break
                        else:
                            time.sleep(1)
                        
                except Exception as e:
                    if self.running:
                        print(f"[流量监控] 监控异常: {e}，标记设备离线")
                        try:
                            mark_device_offline(self.device_ip)
                        except Exception as notify_err:
                            print(f"[流量监控] 离线通知失败: {notify_err}")
                    break
        except Exception as e:
            print(f"[流量监控] 初始化异常: {e}")
        finally:
            print(f"[流量监控] 监控已停止")
            if self.monitor_api:
                try:
                    self.monitor_api.close()
                except:
                    pass
                self.monitor_api = None
    
    async def start_monitor(self):
        """启动流量监控"""
        if self.monitor_thread:
            return
        
        self.running = True
        thread = threading.Thread(
            target=self._start_monitor_sync,
            daemon=True
        )
        thread.start()
        self.monitor_thread = thread
    
    async def stop_monitor(self):
        """停止流量监控"""
        self.running = False
        
        if self.monitor_api:
            try:
                self.monitor_api.close()
            except:
                pass
        
        if self.monitor_thread:
            self.monitor_thread.join(timeout=2)
            self.monitor_thread = None
        
        print(f"[流量监控] 监控已关闭")
    
    async def update_interfaces(self, interfaces: list[dict[str, Any]]) -> None:
        """更新监控的接口列表"""
        new_interfaces: list[str] = []
        
        for iface in interfaces:
            iface_name: str | None = iface.get('name')  # type: ignore[reportAny]
            iface_disabled: str | bool = iface.get('disabled', False)  # type: ignore[reportAny]
            if isinstance(iface_disabled, str):
                iface_disabled = iface_disabled.lower() == 'true'
            if iface_name and not iface_disabled:
                new_interfaces.append(iface_name)
        
        if set(new_interfaces) != set(self.current_interfaces):
            self.current_interfaces = new_interfaces
            print(f"[流量监控] 接口列表已更新: {new_interfaces}")
            
            with self.traffic_data_lock:
                for iface_name in list(self.traffic_data.keys()):
                    if iface_name not in new_interfaces:
                        del self.traffic_data[iface_name]
                        print(f"[流量监控] 已移除接口 {iface_name} 的流量数据")
    
    async def start_send_task(self, websocket: WebSocketConn) -> None:
        """启动定期发送流量数据的任务"""
        self.websocket = websocket
        self.running = True
        self.send_task = asyncio.create_task(self._send_traffic_data_loop())
        await self.start_monitor()
    
    async def _send_traffic_data_loop(self):
        """定期发送流量数据到前端（暂停时不发送数据，但保持连接）"""
        while self.running:
            try:
                if not self.paused:
                    with self.traffic_data_lock:
                        traffic_copy = dict(self.traffic_data)
                    
                    if traffic_copy and self.websocket:
                        try:
                            await self.websocket.send(json.dumps({  # type: ignore[reportAny]
                                'type': 'interface_traffic',
                                'status': 'success',
                                'traffic': traffic_copy
                            }, ensure_ascii=False))
                        except websockets.exceptions.ConnectionClosed:
                            break
                
                await asyncio.sleep(1)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[流量监控] 发送数据异常: {e}")
    
    async def stop_all(self):
        """停止所有监控"""
        self.running = False
        
        if self.send_task:
            _ = self.send_task.cancel()
            try:
                await self.send_task
            except asyncio.CancelledError:
                pass
        
        await self.stop_monitor()
        
        print(f"[流量监控] 设备 {self.device_ip} 所有监控已停止")
    
    async def pause(self):
        """暂停发送流量数据（保持底层监控连接活跃）"""
        self.paused = True
        print(f"[流量监控] 设备 {self.device_ip} 流量数据推送已暂停")
    
    async def resume(self):
        """恢复发送流量数据"""
        self.paused = False
        print(f"[流量监控] 设备 {self.device_ip} 流量数据推送已恢复")


traffic_managers: dict[str, TrafficMonitorManager] = {}
traffic_managers_lock: threading.Lock = threading.Lock()

device_offline_flags: dict[str, bool] = {}
offline_flags_lock: threading.Lock = threading.Lock()


def cleanup_device_resources(device_ip: str) -> None:
    """清理设备IP相关的后端资源（API连接、轮询任务等）
    
    注意：不关闭 WebSocket 连接，前端需要保持连接来接收 device_offline 消息和进行重连。
    WebSocket 连接由前端主动关闭或由 keepalive 任务在发送完 device_offline 后自然退出。
    """
    print(f"[清理资源] 开始清理设备 {device_ip} 的后端资源...")
    
    with traffic_managers_lock:
        if device_ip in traffic_managers:
            try:
                manager = traffic_managers[device_ip]
                if manager.monitor_api:
                    try:
                        manager.monitor_api.close()
                        print(f"[清理资源] 已直接关闭流量监控API连接: {device_ip}")
                    except Exception as close_err:
                        print(f"[清理资源] 关闭流量监控API连接失败: {close_err}")
                try:
                    loop = websocket_event_loop
                    if loop and loop.is_running():
                        asyncio.run_coroutine_threadsafe(manager.stop_all(), loop)
                    else:
                        try:
                            asyncio.run(manager.stop_all())
                        except:
                            pass
                except Exception as e:
                    print(f"[清理资源] 调度停止流量监控失败: {e}")
            except Exception as e:
                print(f"[清理资源] 停止流量监控失败: {e}")
            del traffic_managers[device_ip]
            print(f"[清理资源] 已清理流量监控管理器: {device_ip}")
    
    with interface_polling_lock:
        if device_ip in interface_polling_tasks:
            task = interface_polling_tasks[device_ip]
            if not task.done():
                task.cancel()
            del interface_polling_tasks[device_ip]
            print(f"[清理资源] 已取消接口轮询任务: {device_ip}")
    
    with interface_api_lock:
        if device_ip in interface_api_connections:
            api = interface_api_connections[device_ip]
            try:
                api.close()
            except:
                pass
            del interface_api_connections[device_ip]
            print(f"[清理资源] 已关闭接口API连接: {device_ip}")
    
    with api_conn_lock:
        if device_ip in device_api_connections:
            api = device_api_connections[device_ip]
            try:
                api.close()
            except:
                pass
            del device_api_connections[device_ip]
            print(f"[清理资源] 已关闭设备API连接: {device_ip}")
    
    with tasks_lock:
        if device_ip in device_watch_tasks:
            task = device_watch_tasks[device_ip]
            if not task.done():
                task.cancel()
            del device_watch_tasks[device_ip]
            print(f"[清理资源] 已取消keepalive心跳任务: {device_ip}")
    
    with log_api_connections_lock:
        if device_ip in log_api_connections:
            api = log_api_connections[device_ip]
            try:
                api.close()
            except:
                pass
            del log_api_connections[device_ip]
            print(f"[清理资源] 已关闭日志API连接: {device_ip}")
    
    with log_cache_store_lock:
        if device_ip in log_cache_store:
            del log_cache_store[device_ip]
            print(f"[清理资源] 已清理日志缓存: {device_ip}")
    
    with filters_lock:
        if device_ip in connection_filters:
            del connection_filters[device_ip]
            print(f"[清理资源] 已清理连接过滤器: {device_ip}")
    
    with activity_lock:
        if device_ip in device_last_activity:
            del device_last_activity[device_ip]
            print(f"[清理资源] 已清理设备活动时间: {device_ip}")
    
    with download_status_lock:
        if device_ip in device_download_status:
            del device_download_status[device_ip]
            print(f"[清理资源] 已清理下载状态: {device_ip}")
    
    print(f"[清理资源] 设备 {device_ip} 的后端资源已清理完成")

    with connections_lock:
        if device_ip in active_connections:
            for ws in list(active_connections[device_ip]):
                try:
                    loop = websocket_event_loop
                    if loop and loop.is_running():
                        asyncio.run_coroutine_threadsafe(ws.close(), loop)
                    else:
                        try:
                            asyncio.run(ws.close())
                        except:
                            pass
                except:
                    pass
            del active_connections[device_ip]
            print(f"[清理资源] 已关闭设备 {device_ip} 的 WebSocket 连接")


def update_device_activity(device_ip: str) -> None:
    """更新设备的最后活动时间"""
    with activity_lock:
        device_last_activity[device_ip] = time.time()


def get_device_activity(device_ip: str) -> float:
    """获取设备的最后活动时间"""
    with activity_lock:
        return device_last_activity.get(device_ip, 0)


def get_api_connection(device_ip: str, username: str, password: str) -> MikroTikAPI | None:
    """获取或创建 API 连接"""
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()

        if success:
            print(f"连接已创建：{device_ip} - {message}")

            with api_conn_lock:
                if device_ip in device_api_connections:
                    old_api = device_api_connections[device_ip]
                    if old_api and old_api is not mt_api:
                        try:
                            old_api.close()
                            print(f"关闭设备 {device_ip} 的旧连接")
                        except:
                            pass
                device_api_connections[device_ip] = mt_api

            return mt_api
        else:
            print(f"创建连接失败：{device_ip} - {message}")
            return None
    except Exception as e:
        print(f"创建连接失败：{device_ip} - {e}")
        return None


def close_api_connection(device_ip: str) -> None:
    """关闭 API 连接"""
    print(f"连接已关闭：{device_ip}")


async def register_connection(websocket: WebSocketConn, device_ip: str) -> None:
    """注册 WebSocket 连接"""
    with connections_lock:
        if device_ip not in active_connections:
            active_connections[device_ip] = set()
        active_connections[device_ip].add(websocket)

    with filters_lock:
        if device_ip not in connection_filters:
            connection_filters[device_ip] = {'topics': None, 'level': None}

    print(f"[调试] WebSocket 连接已注册：{device_ip}, 当前连接数: {len(active_connections[device_ip])}")


async def unregister_connection(websocket: WebSocketConn, device_ip: str, _device_mac: str | None = None, _force_cleanup: bool = False) -> None:
    """注销 WebSocket 连接

    Args:
        websocket: WebSocket连接对象
        device_ip: 设备IP地址
        device_mac: 设备MAC地址
        force_cleanup: 是否强制清理资源
    """
    import traceback
    is_last_connection = False
    caller = ''.join(traceback.format_stack()[-3:-1])  # 调用者信息

    with connections_lock:
        if device_ip in active_connections:
            active_connections[device_ip].discard(websocket)
            if not active_connections[device_ip]:
                del active_connections[device_ip]
                is_last_connection = True
                logger.info(f"[注销] 设备{device_ip}所有连接已清理, 调用者:\n{caller}")
            else:
                logger.info(f"[注销] 设备{device_ip}剩余连接数: {len(active_connections[device_ip])}, 调用者:\n{caller}")

    # 只有最后一个连接断开时才清除 filters
    if is_last_connection:
        with filters_lock:
            if device_ip in connection_filters:
                del connection_filters[device_ip]

    logger.info(f"WebSocket 连接已注销：{device_ip}, is_last={is_last_connection}")

    # 只有最后一个连接断开时才清理日志缓存
    if is_last_connection:
        clear_log_cache(device_ip)
        logger.info(f"[日志缓存] 设备 {device_ip} 的日志缓存已清理")


device_offline_flags: dict[str, bool] = {}
offline_flags_lock: threading.Lock = threading.Lock()


def mark_device_offline(device_ip: str) -> None:
    """跨模块离线通知：检测到设备离线时调用

    1. 设置离线标志（幂等，防止重复）
    2. 清理所有 API 和后端资源
    3. 关闭所有 WebSocket 连接
    """
    with offline_flags_lock:
        if device_ip in device_offline_flags:
            print(f"[离线通知] 设备 {device_ip} 已被标记为离线，跳过重复通知")
            return
        device_offline_flags[device_ip] = True
    print(f"[离线通知] 设备 {device_ip} 被标记为离线")

    cleanup_device_resources(device_ip)

    # 设备离线时关闭 iperf3 进程
    try:
        from iperf3_handler import iperf3_handler
        if iperf3_handler.is_running():
            iperf3_handler.stop()
            print(f"[离线通知] 已关闭设备 {device_ip} 的 iperf3 进程")
    except Exception as e:
        print(f"[离线通知] 关闭 iperf3 进程失败: {e}")

    try:
        from api_server import api_pool, api_pool_lock
        with api_pool_lock:
            if device_ip in api_pool:
                mt_api = api_pool[device_ip]
                mt_api.logged_in = False
                try:
                    mt_api.close()
                except:
                    pass
                del api_pool[device_ip]
                print(f"[离线通知] 已清除 api_pool 中设备 {device_ip} 的连接")
    except Exception as e:
        print(f"[离线通知] 清除 api_pool 失败: {e}")

    offline_msg = json.dumps({
        'status': 'device_offline',
        'message': '设备连接已断开，请重新登录'
    }, ensure_ascii=False)

    with connections_lock:
        if device_ip in active_connections:
            for ws in list(active_connections[device_ip]):
                try:
                    loop = websocket_event_loop
                    if loop and loop.is_running():
                        asyncio.run_coroutine_threadsafe(ws.send(offline_msg), loop)
                    else:
                        try:
                            asyncio.run(ws.send(offline_msg))
                        except:
                            pass
                except Exception as e:
                    print(f"[离线通知] 发送 device_offline 失败: {e}")
            print(f"[离线通知] 已向 {len(active_connections.get(device_ip, []))} 个 WebSocket 发送 device_offline")


async def keepalive_task(device_ip: str, username: str, password: str, websocket: WebSocketConn) -> None:
    """独立长连接心跳监控任务

    使用独立的API连接监控设备在线状态（不与其他操作共享连接）：
    - 每3秒发送 /system/identity/print 心跳包
    - 连续5个心跳包未收到响应 → 判定离线
    - 检测到离线后发送通知并清理所有连接
    """
    HEARTBEAT_INTERVAL = 3
    MAX_HEARTBEAT_FAILURES = 5
    consecutive_failures = 0
    heartbeat_api = None

    logger.info(f"[keepalive] ===== 开始独立心跳监控: {device_ip} (间隔 {HEARTBEAT_INTERVAL}s, 阈值 {MAX_HEARTBEAT_FAILURES}次) =====")

    try:
        heartbeat_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = heartbeat_api.login()
        if not success:
            logger.error(f"[keepalive] 心跳独立连接登录失败: {device_ip} - {message}")
            mark_device_offline(device_ip)
            return

        logger.info(f"[keepalive] 心跳独立连接已建立: {device_ip}")

        await asyncio.sleep(HEARTBEAT_INTERVAL)

        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)

            if is_ws_closed(websocket):
                logger.info(f"[keepalive] WebSocket 已关闭，退出监控: {device_ip}")
                break

            try:
                loop = asyncio.get_event_loop()
                alive = await asyncio.wait_for(
                    loop.run_in_executor(None, heartbeat_api.keepalive_check),
                    timeout=10
                )

                if not alive:
                    consecutive_failures += 1
                    logger.warning(f"[keepalive] 心跳检测失败 ({consecutive_failures}/{MAX_HEARTBEAT_FAILURES}): {device_ip}")
                    if consecutive_failures >= MAX_HEARTBEAT_FAILURES:
                        await send_device_offline(websocket, device_ip, "心跳检测连续失败")
                        mark_device_offline(device_ip)
                        break
                else:
                    if consecutive_failures > 0:
                        logger.info(f"[keepalive] 心跳恢复，重置失败计数: {device_ip}")
                    consecutive_failures = 0

            except asyncio.TimeoutError:
                consecutive_failures += 1
                logger.warning(f"[keepalive] 心跳检测超时 ({consecutive_failures}/{MAX_HEARTBEAT_FAILURES}): {device_ip}")
                if consecutive_failures >= MAX_HEARTBEAT_FAILURES:
                    await send_device_offline(websocket, device_ip, "心跳检测连续超时")
                    mark_device_offline(device_ip)
                    break

            except Exception as e:
                consecutive_failures += 1
                logger.error(f"[keepalive] 心跳检测异常 ({consecutive_failures}/{MAX_HEARTBEAT_FAILURES}): {device_ip} - {e}")
                if consecutive_failures >= MAX_HEARTBEAT_FAILURES:
                    await send_device_offline(websocket, device_ip, "心跳检测连续异常")
                    mark_device_offline(device_ip)
                    break

            try:
                await websocket.send(json.dumps({'action': 'ping'}))
            except Exception:
                logger.info(f"[keepalive] 发送前端心跳失败，WebSocket可能已断开: {device_ip}")
                break

        logger.info(f"[keepalive] ===== 监控结束: {device_ip} =====")

    except asyncio.CancelledError:
        logger.info(f"[keepalive] 任务被取消: {device_ip}")
    except Exception as e:
        logger.error(f"[keepalive] 异常退出: {device_ip} - {e}")
        import traceback
        traceback.print_exc()
    finally:
        if heartbeat_api:
            try:
                heartbeat_api.close()
                logger.info(f"[keepalive] 心跳独立连接已关闭: {device_ip}")
            except:
                pass


async def send_device_offline(websocket: WebSocketConn, device_ip: str, reason: str) -> None:
    """发送设备离线消息"""
    clear_log_cache(device_ip)
    logger.info(f"[设备离线] 已清理设备 {device_ip} 的日志缓存")
    
    try:
        message = {'status': 'device_offline', 'message': f'设备连接已断开: {reason}'}
        await websocket.send(json.dumps(message))
        print(f"[keepalive] >>> device_offline 消息已发送: {reason}")
    except websockets.exceptions.ConnectionClosed:
        print(f"[keepalive] WebSocket已关闭，无法发送device_offline")
    except Exception as send_err:
        print(f"[keepalive] 发送 device_offline 失败: {send_err}")


async def get_interface_list(mt_api: MikroTikAPI) -> list[dict[str, Any]] | None:
    """获取接口列表信息"""
    try:
        interfaces = mt_api.get_interfaces()
        return interfaces
    except Exception as e:
        print(f"获取接口列表失败: {e}")
        return None


async def interface_polling_task(device_ip: str, websocket: WebSocketConn, mt_api: MikroTikAPI) -> None:
    """接口列表轮询任务"""
    consecutive_errors = 0
    
    try:
        while True:
            try:
                interfaces = await get_interface_list(mt_api)
                if interfaces is not None:
                    consecutive_errors = 0
                    await websocket.send(json.dumps({
                        'type': 'interface_list',
                        'status': 'success',
                        'interfaces': interfaces
                    }, ensure_ascii=False))
                else:
                    consecutive_errors += 1
                    print(f"接口列表获取返回空, 连续错误次数: {consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}")
                    await websocket.send(json.dumps({
                        'type': 'interface_list',
                        'status': 'error',
                        'message': '获取接口列表失败'
                    }, ensure_ascii=False))
            except websockets.exceptions.ConnectionClosed:
                print(f"接口列表WebSocket连接已关闭: {device_ip}")
                break
            except Exception as e:
                consecutive_errors += 1
                print(f"接口列表轮询错误: {e}, 连续错误次数: {consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}")
                
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    print(f"连续错误达到 {MAX_CONSECUTIVE_ERRORS} 次，停止轮询")
                    await websocket.send(json.dumps({
                        'type': 'interface_list',
                        'status': 'error',
                        'message': f'连接异常，连续错误{MAX_CONSECUTIVE_ERRORS}次'
                    }, ensure_ascii=False))
                    break
                
                await websocket.send(json.dumps({
                    'type': 'interface_list',
                    'status': 'error',
                    'message': f'获取失败，正在重试({consecutive_errors}/{MAX_CONSECUTIVE_ERRORS})...'
                }, ensure_ascii=False))
            
            await asyncio.sleep(2)
    except asyncio.CancelledError:
        print(f"接口列表轮询任务已取消: {device_ip}")
    except Exception as e:
        print(f"接口列表轮询任务异常: {e}")


async def handle_interface_polling_single_conn(
    websocket: WebSocketConn, 
    device_ip: str, 
    username: str, 
    password: str,
    polling_tasks: dict[str, asyncio.Task],
    stop_events: dict[str, asyncio.Event]
) -> None:
    """处理接口列表长连接（单连接模型）- 只启动后台任务"""
    from mikrotik_api import get_api_port
    mt_api = None
    traffic_manager = None
    stop_event = asyncio.Event()
    stop_events['interface'] = stop_event
    
    try:
        if not username:
            await websocket.send(json.dumps({
                'type': 'interface_list',
                'status': 'error',
                'message': '认证失败：缺少用户名，请先登录设备'
            }, ensure_ascii=False))
            return
        
        api_port = get_api_port(device_ip)
        mt_api = MikroTikAPI(device_ip, username, password, port=api_port, use_ssl=False)
        success, message = mt_api.login()
        if not success and api_port != 2468:
            mt_api = MikroTikAPI(device_ip, username, password, port=2468, use_ssl=False)
            success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'interface_list',
                'status': 'error',
                'message': f'认证失败：{message}'
            }, ensure_ascii=False))
            return
        
        await websocket.send(json.dumps({
            'type': 'interface_list',
            'status': 'connected',
            'message': '接口列表连接已建立'
        }, ensure_ascii=False))
        
        traffic_manager = TrafficMonitorManager(device_ip, username, password)
        with traffic_managers_lock:
            traffic_managers[device_ip] = traffic_manager
        
        await traffic_manager.start_send_task(websocket)
        
        polling_task = asyncio.create_task(
            interface_polling_task_with_traffic_single_conn(device_ip, websocket, mt_api, traffic_manager, stop_event, username, password, polling_tasks, stop_events)
        )
        polling_tasks['interface'] = polling_task
        
    except Exception as e:
        print(f"接口列表长连接错误: {e}")
        try:
            await websocket.send(json.dumps({
                'type': 'interface_list',
                'status': 'error',
                'message': str(e)
            }, ensure_ascii=False))
        except:
            pass


async def interface_polling_task_with_traffic_single_conn(
    device_ip: str, 
    websocket: WebSocketConn, 
    mt_api: MikroTikAPI, 
    traffic_manager: TrafficMonitorManager,
    stop_event: asyncio.Event,
    username: str = '',
    password: str = '',
    polling_tasks: dict[str, asyncio.Task] | None = None,
    stop_events: dict[str, asyncio.Event] | None = None
) -> None:
    """接口列表轮询任务（带流量监控，单连接模型）"""
    consecutive_errors = 0
    
    try:
        while not stop_event.is_set():
            try:
                interfaces = await get_interface_list(mt_api)
                if interfaces is not None:
                    consecutive_errors = 0
                    await websocket.send(json.dumps({
                        'type': 'interface_list',
                        'status': 'success',
                        'interfaces': interfaces
                    }, ensure_ascii=False))
                    
                    await traffic_manager.update_interfaces(interfaces)
                else:
                    consecutive_errors += 1
                    print(f"接口列表获取返回空, 连续错误次数: {consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}")
                    
                    if not mt_api.logged_in:
                        print(f"[接口轮询] API连接已断开(logged_in=False)，设备离线")
                        await websocket.send(json.dumps({
                            'type': 'interface_list',
                            'status': 'device_offline',
                            'message': '设备连接已断开'
                        }, ensure_ascii=False))
                        break
                    
                    await websocket.send(json.dumps({
                        'type': 'interface_list',
                        'status': 'error',
                        'message': '获取接口列表失败'
                    }, ensure_ascii=False))
            except websockets.exceptions.ConnectionClosed:
                print(f"接口列表WebSocket连接已关闭: {device_ip}")
                break
            except Exception as e:
                consecutive_errors += 1
                print(f"接口列表轮询错误: {e}, 连续错误次数: {consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}")
                
                if not mt_api.logged_in:
                    print(f"[接口轮询] API连接已断开(logged_in=False)，设备离线，发送 device_offline 消息")
                    try:
                        await websocket.send(json.dumps({
                            'type': 'interface_list',
                            'status': 'device_offline',
                            'message': '设备连接已断开'
                        }, ensure_ascii=False))
                    except Exception as send_err:
                        print(f"[接口轮询] 发送 device_offline 消息失败: {send_err}")
                    break
                
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    print(f"连续错误达到 {MAX_CONSECUTIVE_ERRORS} 次，判定设备离线")
                    mt_api.logged_in = False
                    await websocket.send(json.dumps({
                        'type': 'interface_list',
                        'status': 'device_offline',
                        'message': f'设备连接异常，连续错误{MAX_CONSECUTIVE_ERRORS}次'
                    }, ensure_ascii=False))
                    break
                
                await websocket.send(json.dumps({
                    'type': 'interface_list',
                    'status': 'error',
                    'message': f'获取失败，正在重试({consecutive_errors}/{MAX_CONSECUTIVE_ERRORS})...'
                }, ensure_ascii=False))
            
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=INTERFACE_INTERVAL)
                data = json.loads(message)
                action = data.get('action')
                print(f"[接口轮询] 收到消息 action={action}")
                
                if action == 'add_ip_address':
                    try:
                        api = get_ip_address_action_api(device_ip, mt_api.username, mt_api.password)
                        await handle_add_ip_address_sync(api, data, websocket)
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'ip_address_action',
                            'status': 'error',
                            'message': str(e)
                        }, ensure_ascii=False))
                elif action == 'edit_ip_address':
                    try:
                        api = get_ip_address_action_api(device_ip, mt_api.username, mt_api.password)
                        await handle_edit_ip_address_sync(api, data, websocket)
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'ip_address_action',
                            'status': 'error',
                            'message': str(e)
                        }, ensure_ascii=False))
                elif action == 'delete_ip_address':
                    try:
                        api = get_ip_address_action_api(device_ip, mt_api.username, mt_api.password)
                        await handle_delete_ip_address_sync(api, data, websocket)
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'ip_address_action',
                            'status': 'error',
                            'message': str(e)
                        }, ensure_ascii=False))
                elif action == 'enable_ip_address':
                    try:
                        api = get_ip_address_action_api(device_ip, mt_api.username, mt_api.password)
                        await handle_enable_ip_address_sync(api, data, websocket)
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'ip_address_action',
                            'status': 'error',
                            'message': str(e)
                        }, ensure_ascii=False))
                elif action == 'disable_ip_address':
                    try:
                        api = get_ip_address_action_api(device_ip, mt_api.username, mt_api.password)
                        await handle_disable_ip_address_sync(api, data, websocket)
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'ip_address_action',
                            'status': 'error',
                            'message': str(e)
                        }, ensure_ascii=False))
                elif action == 'start_ip_addresses_polling':
                    if polling_tasks is not None and stop_events is not None:
                        await handle_start_ip_addresses_polling(websocket, device_ip, username, password, polling_tasks, stop_events)
                elif action == 'start_bridge_polling':
                    if polling_tasks is not None and stop_events is not None:
                        await handle_start_bridge_polling(websocket, device_ip, username, password, polling_tasks, stop_events)
                elif action == 'stop_bridge':
                    if stop_events is not None and 'bridge' in stop_events:
                        stop_events['bridge'].set()
                    if polling_tasks is not None and 'bridge' in polling_tasks:
                        polling_tasks['bridge'].cancel()
                        try:
                            await polling_tasks['bridge']
                        except asyncio.CancelledError:
                            pass
                        polling_tasks.pop('bridge', None)
                    if stop_events is not None:
                        stop_events.pop('bridge', None)
                elif action == 'stop_ip_addresses':
                    if stop_events is not None and 'ip_addresses' in stop_events:
                        stop_events['ip_addresses'].set()
                    if polling_tasks is not None and 'ip_addresses' in polling_tasks:
                        polling_tasks['ip_addresses'].cancel()
                        try:
                            await polling_tasks['ip_addresses']
                        except asyncio.CancelledError:
                            pass
                        polling_tasks.pop('ip_addresses', None)
                    if stop_events is not None:
                        stop_events.pop('ip_addresses', None)
                elif action == 'add_bridge':
                    bridge_name = data.get('name', '')
                    bridge_params = data.get('params', {})
                    try:
                        api = get_bridge_action_api(device_ip, username, password)
                        success, message = api.add_bridge(bridge_name, **bridge_params)
                        await websocket.send(json.dumps({
                            'type': 'bridge_action',
                            'status': 'success' if success else 'error',
                            'message': message
                        }, ensure_ascii=False))
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'bridge_action',
                            'status': 'error',
                            'message': str(e)
                        }, ensure_ascii=False))
                elif action == 'edit_bridge':
                    bridge_id = data.get('bridge_id', '')
                    bridge_params = data.get('params', {})
                    try:
                        api = get_bridge_action_api(device_ip, username, password)
                        success, message = api.edit_bridge(bridge_id, **bridge_params)
                        await websocket.send(json.dumps({
                            'type': 'bridge_action',
                            'status': 'success' if success else 'error',
                            'message': message
                        }, ensure_ascii=False))
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'bridge_action',
                            'status': 'error',
                            'message': str(e)
                        }, ensure_ascii=False))
                elif action == 'delete_bridge':
                    bridge_id = data.get('bridge_id', '')
                    try:
                        api = get_bridge_action_api(device_ip, username, password)
                        success, message = api.delete_bridge(bridge_id)
                        await websocket.send(json.dumps({
                            'type': 'bridge_action',
                            'status': 'success' if success else 'error',
                            'message': message
                        }, ensure_ascii=False))
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'bridge_action',
                            'status': 'error',
                            'message': str(e)
                        }, ensure_ascii=False))
                elif action == 'add_bridge_port':
                    port_interface = data.get('interface', '')
                    port_bridge = data.get('bridge', '')
                    port_params = data.get('params', {})
                    try:
                        api = get_bridge_action_api(device_ip, username, password)
                        success, message = api.add_bridge_port(port_interface, port_bridge, **port_params)
                        await websocket.send(json.dumps({
                            'type': 'bridge_port_action',
                            'status': 'success' if success else 'error',
                            'message': message
                        }, ensure_ascii=False))
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'bridge_port_action',
                            'status': 'error',
                            'message': str(e)
                        }, ensure_ascii=False))
                elif action == 'edit_bridge_port':
                    port_id = data.get('port_id', '')
                    port_params = data.get('params', {})
                    try:
                        api = get_bridge_action_api(device_ip, username, password)
                        success, message = api.edit_bridge_port(port_id, **port_params)
                        await websocket.send(json.dumps({
                            'type': 'bridge_port_action',
                            'status': 'success' if success else 'error',
                            'message': message
                        }, ensure_ascii=False))
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'bridge_port_action',
                            'status': 'error',
                            'message': str(e)
                        }, ensure_ascii=False))
                elif action == 'delete_bridge_port':
                    port_id = data.get('port_id', '')
                    try:
                        api = get_bridge_action_api(device_ip, username, password)
                        success, message = api.delete_bridge_port(port_id)
                        await websocket.send(json.dumps({
                            'type': 'bridge_port_action',
                            'status': 'success' if success else 'error',
                            'message': message
                        }, ensure_ascii=False))
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'bridge_port_action',
                            'status': 'error',
                            'message': str(e)
                        }, ensure_ascii=False))
                elif action == 'start_wireless_polling':
                    if polling_tasks is not None and stop_events is not None:
                        await handle_start_wireless_polling(websocket, device_ip, username, password, polling_tasks, stop_events)
                elif action == 'stop_wireless':
                    for key in ['wireless', 'clients', 'security']:
                        if stop_events is not None and key in stop_events:
                            stop_events[key].set()
                        if polling_tasks is not None and key in polling_tasks:
                            polling_tasks[key].cancel()
                            try:
                                await polling_tasks[key]
                            except asyncio.CancelledError:
                                pass
                            del polling_tasks[key]
                        if stop_events is not None and key in stop_events:
                            del stop_events[key]
                elif action == 'start_logs_polling':
                    device_mac = data.get('mac')
                    if polling_tasks is not None and stop_events is not None:
                        logs_task = asyncio.create_task(
                            handle_logs_monitor(websocket, device_ip, username, password, device_mac, polling_tasks, stop_events)
                        )
                        polling_tasks['logs'] = logs_task
                    else:
                        await handle_logs_monitor(websocket, device_ip, username, password, device_mac)
                elif action == 'stop_logs':
                    if stop_events is not None and 'logs' in stop_events:
                        stop_events['logs'].set()
                elif action == 'get_file_list':
                    print(f"[接口轮询] 收到文件列表请求")
                    await handle_get_file_list(websocket, device_ip, username, password)
                elif action == 'download_file':
                    print(f"[接口轮询] 收到文件下载请求")
                    file_name = data.get('file_name', '')
                    await handle_download_file(websocket, device_ip, username, password, file_name)
                elif action == 'delete_file':
                    print(f"[接口轮询] 收到文件删除请求")
                    file_name = data.get('file_name', '')
                    await handle_delete_file(websocket, device_ip, username, password, file_name)
                elif action == 'stop':
                    print(f"[接口轮询] 收到停止命令")
                    break
            except asyncio.TimeoutError:
                pass
            except json.JSONDecodeError:
                pass
    except asyncio.CancelledError:
        print(f"接口列表轮询任务已取消: {device_ip}")
    except Exception as e:
        print(f"接口列表轮询任务异常: {e}")


async def handle_start_wireless_polling(
    websocket: WebSocketConn,
    device_ip: str,
    username: str,
    password: str,
    polling_tasks: dict[str, asyncio.Task],
    stop_events: dict[str, asyncio.Event]
) -> None:
    """启动所有无线轮询任务（单连接模型）- 只启动后台任务"""
    print(f"[无线轮询] 启动设备 {device_ip} 的所有无线轮询任务")
    
    wireless_stop = asyncio.Event()
    clients_stop = asyncio.Event()
    security_stop = asyncio.Event()
    stop_events['wireless'] = wireless_stop
    stop_events['clients'] = clients_stop
    stop_events['security'] = security_stop
    
    mt_api_wireless: MikroTikAPI | None = None
    mt_api_clients: MikroTikAPI | None = None
    mt_api_security: MikroTikAPI | None = None
    
    try:
        if not username:
            await websocket.send(json.dumps({
                'type': 'wireless_interfaces',
                'status': 'error',
                'message': '认证失败：缺少用户名'
            }, ensure_ascii=False))
            return
        
        mt_api_wireless = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api_wireless.login()
        if not success:
            await websocket.send(json.dumps({
                'type': 'wireless_interfaces',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        mt_api_clients = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api_clients.login()
        if not success:
            await websocket.send(json.dumps({
                'type': 'wireless_clients',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        mt_api_security = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api_security.login()
        if not success:
            await websocket.send(json.dumps({
                'type': 'security_profiles',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        wireless_task = asyncio.create_task(
            wireless_polling_task_single_conn(device_ip, websocket, mt_api_wireless, wireless_stop)
        )
        polling_tasks['wireless'] = wireless_task
        
        clients_task = asyncio.create_task(
            wireless_clients_polling_task_single_conn(device_ip, websocket, mt_api_clients, '', clients_stop)
        )
        polling_tasks['clients'] = clients_task
        
        security_task = asyncio.create_task(
            security_profiles_polling_task_single_conn(device_ip, websocket, mt_api_security, security_stop)
        )
        polling_tasks['security'] = security_task
        
        await websocket.send(json.dumps({
            'type': 'wireless_interfaces',
            'status': 'connected',
            'message': '无线轮询已启动'
        }, ensure_ascii=False))
        
    except Exception as e:
        print(f"无线轮询启动错误: {e}")


async def handle_wireless_polling_single_conn(
    websocket: WebSocketConn,
    device_ip: str,
    username: str,
    password: str,
    polling_tasks: dict[str, asyncio.Task],
    stop_events: dict[str, asyncio.Event]
) -> None:
    """处理无线接口轮询（单连接模型）- 只启动后台任务"""
    mt_api: MikroTikAPI | None = None
    stop_event = asyncio.Event()
    stop_events['wireless'] = stop_event
    
    try:
        if not username:
            await websocket.send(json.dumps({
                'type': 'wireless_interfaces',
                'status': 'error',
                'message': '认证失败：缺少用户名'
            }, ensure_ascii=False))
            return
        
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'wireless_interfaces',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        await websocket.send(json.dumps({
            'type': 'wireless_interfaces',
            'status': 'connected',
            'message': '无线接口连接已建立'
        }, ensure_ascii=False))
        
        polling_task = asyncio.create_task(
            wireless_polling_task_single_conn(device_ip, websocket, mt_api, stop_event)
        )
        polling_tasks['wireless'] = polling_task
        
    except Exception as e:
        print(f"无线接口长连接错误: {e}")


async def wireless_polling_task_single_conn(
    device_ip: str,
    websocket: WebSocketConn,
    mt_api: MikroTikAPI,
    stop_event: asyncio.Event
) -> None:
    """无线接口轮询任务（单连接模型）"""
    import time
    POLL_INTERVAL = WIRELESS_INTERVAL
    READ_TIMEOUT = 3
    consecutive_errors = 0
    last_sent_interfaces = None
    
    async def get_wireless_interfaces(api: MikroTikAPI) -> tuple[list[dict[str, str | bool]] | None, str | None]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: get_wireless_interfaces_sync(api, READ_TIMEOUT))
    
    try:
        while not stop_event.is_set():
            try:
                loop_start = time.monotonic()
                
                interfaces, error = await get_wireless_interfaces(mt_api)
                
                if error:
                    consecutive_errors += 1
                    retry_delay = min(1.0 * (2 ** (consecutive_errors - 1)), 30)
                    print(f"无线接口读取错误 ({consecutive_errors}/3): {error}，{retry_delay}s 后重连...")
                    
                    if consecutive_errors >= 3:
                        mt_api.close()
                        mt_api = MikroTikAPI(device_ip, mt_api.username, mt_api.password, port=8728, use_ssl=False)
                        success, message = mt_api.login()
                        if not success:
                            print(f"无线接口重连失败: {message}")
                            await websocket.send(json.dumps({
                                'type': 'wireless_interfaces',
                                'status': 'error',
                                'message': f'重连失败: {message}'
                            }, ensure_ascii=False))
                            break
                        print(f"无线接口重连成功: {device_ip}")
                        consecutive_errors = 0
                    else:
                        await asyncio.sleep(retry_delay)
                    continue
                else:
                    consecutive_errors = 0
                
                if interfaces is not None:
                    interfaces_json = json.dumps(interfaces, sort_keys=True, ensure_ascii=False)
                    if last_sent_interfaces != interfaces_json:
                        last_sent_interfaces = interfaces_json
                        await websocket.send(json.dumps({
                            'type': 'wireless_interfaces',
                            'status': 'success',
                            'interfaces': interfaces
                        }, ensure_ascii=False))
                
                elapsed = time.monotonic() - loop_start
                wait_time = max(0.2, POLL_INTERVAL - elapsed)
                
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=wait_time)
                    break
                except asyncio.TimeoutError:
                    pass
                    
            except websockets.exceptions.ConnectionClosed:
                print(f"无线接口WebSocket连接已关闭: {device_ip}")
                break
            except Exception as e:
                print(f"无线接口轮询错误: {e}")
                consecutive_errors += 1
                if consecutive_errors >= 3:
                    break
                await asyncio.sleep(POLL_INTERVAL)
        
    except asyncio.CancelledError:
        print(f"无线接口轮询任务已取消: {device_ip}")
    except Exception as e:
        print(f"无线接口轮询任务异常: {e}")


async def handle_wireless_clients_single_conn(
    websocket: WebSocketConn,
    device_ip: str,
    username: str,
    password: str,
    interface_name: str | None,
    polling_tasks: dict[str, asyncio.Task],
    stop_events: dict[str, asyncio.Event]
) -> None:
    """处理无线客户端监控（单连接模型）"""
    mt_api: MikroTikAPI | None = None
    stop_event = asyncio.Event()
    stop_events['clients'] = stop_event
    
    try:
        if not username:
            return
        
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            return
        
        polling_task = asyncio.create_task(
            wireless_clients_polling_task_single_conn(device_ip, websocket, mt_api, interface_name, stop_event)
        )
        polling_tasks['clients'] = polling_task
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    action = data.get('action')
                    if action == 'stop' or action == 'stop_wireless':
                        stop_event.set()
                        break
                except:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass
        
    except Exception as e:
        print(f"无线客户端长连接错误: {e}")
    finally:
        stop_event.set()
        if 'clients' in polling_tasks:
            polling_tasks['clients'].cancel()
            try:
                await polling_tasks['clients']
            except asyncio.CancelledError:
                pass
            del polling_tasks['clients']
        if mt_api:
            try:
                mt_api.close()
            except:
                pass


async def wireless_clients_polling_task_single_conn(
    device_ip: str,
    websocket: WebSocketConn,
    mt_api: MikroTikAPI,
    interface_name: str | None,
    stop_event: asyncio.Event
) -> None:
    """无线客户端轮询任务（单连接模型）"""
    consecutive_errors = 0
    
    try:
        while not stop_event.is_set():
            try:
                command = ['/interface/wireless/registration-table/print']
                if interface_name:
                    command.append(f'=interface={interface_name}')
                
                mt_api.write_sentence(command)
                clients = []
                
                while True:
                    response = mt_api.read_sentence(timeout=3)
                    if '!done' in response:
                        break
                    if '!re' in response:
                        client = {}
                        for line in response:
                            if line.startswith('='):
                                parts = line[1:].split('=', 1)
                                if len(parts) == 2:
                                    key, value = parts
                                    client[key] = value
                        if client:
                            clients.append({
                                '.id': client.get('.id', ''),
                                'interface': client.get('interface', ''),
                                'mac': client.get('mac-address', ''),
                                'uptime': client.get('uptime', ''),
                                'tx_signal': client.get('tx-signal-strength', ''),
                                'rx_signal': client.get('signal-strength', ''),
                                'tx_signal_quality': client.get('tx-ccq', ''),
                                'rx_signal_quality': client.get('rx-ccq', ''),
                                'tx_rate': client.get('tx-rate', ''),
                                'rx_rate': client.get('rx-rate', ''),
                                'radio_name': client.get('radio-name', ''),
                            })
                
                if clients:
                    await websocket.send(json.dumps({
                        'type': 'wireless_clients',
                        'status': 'success',
                        'clients': clients
                    }, ensure_ascii=False))
                
                consecutive_errors = 0
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=CLIENT_INTERVAL)
                    break
                except asyncio.TimeoutError:
                    pass
                    
            except websockets.exceptions.ConnectionClosed:
                break
            except Exception as e:
                consecutive_errors += 1
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    break
                await asyncio.sleep(CLIENT_INTERVAL)
        
    except asyncio.CancelledError:
        pass


async def handle_add_bridge(websocket: WebSocketConn, device_ip: str, username: str, password: str, bridge_name: str, params: dict) -> None:
    """添加桥接口"""
    try:
        mt_api = get_bridge_action_api(device_ip, username, password)
        success, message = mt_api.add_bridge(bridge_name, **params)
        if success:
            await websocket.send(json.dumps({
                'type': 'bridge_action',
                'status': 'success',
                'message': message
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'bridge_action',
                'status': 'error',
                'message': message
            }, ensure_ascii=False))
    except ConnectionError as e:
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    except Exception as e:
        print(f"添加桥接口错误: {e}")
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))


async def handle_edit_bridge(websocket: WebSocketConn, device_ip: str, username: str, password: str, bridge_id: str, params: dict) -> None:
    """编辑桥接口"""
    try:
        mt_api = get_bridge_action_api(device_ip, username, password)
        success, message = mt_api.edit_bridge(bridge_id, **params)
        if success:
            await websocket.send(json.dumps({
                'type': 'bridge_action',
                'status': 'success',
                'message': message
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'bridge_action',
                'status': 'error',
                'message': message
            }, ensure_ascii=False))
    except ConnectionError as e:
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    except Exception as e:
        print(f"编辑桥接口错误: {e}")
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))


async def handle_delete_bridge(websocket: WebSocketConn, device_ip: str, username: str, password: str, bridge_id: str) -> None:
    """删除桥接口"""
    try:
        mt_api = get_bridge_action_api(device_ip, username, password)
        success, message = mt_api.delete_bridge(bridge_id)
        if success:
            await websocket.send(json.dumps({
                'type': 'bridge_action',
                'status': 'success',
                'message': message
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'bridge_action',
                'status': 'error',
                'message': message
            }, ensure_ascii=False))
    except ConnectionError as e:
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    except Exception as e:
        print(f"删除桥接口错误: {e}")
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))


async def handle_add_bridge_port(websocket: WebSocketConn, device_ip: str, username: str, password: str, interface: str, bridge: str, params: dict) -> None:
    """添加桥接端口"""
    try:
        mt_api = get_bridge_action_api(device_ip, username, password)
        success, message = mt_api.add_bridge_port(interface, bridge, **params)
        if success:
            await websocket.send(json.dumps({
                'type': 'bridge_port_action',
                'status': 'success',
                'message': message
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'bridge_port_action',
                'status': 'error',
                'message': message
            }, ensure_ascii=False))
    except ConnectionError as e:
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_port_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    except Exception as e:
        print(f"添加桥接端口错误: {e}")
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_port_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))


async def handle_edit_bridge_port(websocket: WebSocketConn, device_ip: str, username: str, password: str, port_id: str, params: dict) -> None:
    """编辑桥接端口"""
    try:
        mt_api = get_bridge_action_api(device_ip, username, password)
        success, message = mt_api.edit_bridge_port(port_id, **params)
        if success:
            await websocket.send(json.dumps({
                'type': 'bridge_port_action',
                'status': 'success',
                'message': message
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'bridge_port_action',
                'status': 'error',
                'message': message
            }, ensure_ascii=False))
    except ConnectionError as e:
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_port_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    except Exception as e:
        print(f"编辑桥接端口错误: {e}")
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_port_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))


async def handle_delete_bridge_port(websocket: WebSocketConn, device_ip: str, username: str, password: str, port_id: str) -> None:
    """删除桥接端口"""
    try:
        mt_api = get_bridge_action_api(device_ip, username, password)
        success, message = mt_api.delete_bridge_port(port_id)
        if success:
            await websocket.send(json.dumps({
                'type': 'bridge_port_action',
                'status': 'success',
                'message': message
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'bridge_port_action',
                'status': 'error',
                'message': message
            }, ensure_ascii=False))
    except ConnectionError as e:
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_port_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    except Exception as e:
        print(f"删除桥接端口错误: {e}")
        close_bridge_action_api(device_ip)
        await websocket.send(json.dumps({
            'type': 'bridge_port_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))


async def handle_start_bridge_polling(
    websocket: WebSocketConn,
    device_ip: str,
    username: str,
    password: str,
    polling_tasks: dict[str, asyncio.Task],
    stop_events: dict[str, asyncio.Event]
) -> None:
    """启动桥接口轮询任务（单连接模型）- 只启动后台任务，不进入消息循环"""
    if 'bridge' in polling_tasks:
        print(f"[桥接口轮询] 已存在轮询任务，跳过")
        return

    print(f"[桥接口轮询] 启动设备 {device_ip} 的桥接口轮询任务")
    bridge_stop = asyncio.Event()
    stop_events['bridge'] = bridge_stop

    mt_api_bridge: MikroTikAPI | None = None

    try:
        if not username:
            await websocket.send(json.dumps({
                'type': 'bridge_data',
                'status': 'error',
                'message': '认证失败：缺少用户名'
            }, ensure_ascii=False))
            return

        mt_api_bridge = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api_bridge.login()

        if not success:
            await websocket.send(json.dumps({
                'type': 'bridge_data',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            mt_api_bridge.close()
            mt_api_bridge = None
            return

        register_bridge_polling_api(device_ip, mt_api_bridge)

        bridge_task = asyncio.create_task(
            bridge_polling_task_single_conn(device_ip, websocket, mt_api_bridge, bridge_stop)
        )
        polling_tasks['bridge'] = bridge_task

        def _bridge_task_done(t: asyncio.Task) -> None:
            unregister_bridge_polling_api(device_ip)
            if 'bridge' in polling_tasks and polling_tasks['bridge'] is t:
                del polling_tasks['bridge']
            if 'bridge' in stop_events:
                del stop_events['bridge']
            if mt_api_bridge:
                try:
                    mt_api_bridge.close()
                except:
                    pass

        bridge_task.add_done_callback(_bridge_task_done)

    except Exception as e:
        print(f"桥接口轮询启动错误: {e}")
        if mt_api_bridge:
            try:
                mt_api_bridge.close()
            except:
                pass


async def handle_bridge_polling_single_conn(
    websocket: WebSocketConn,
    device_ip: str,
    username: str,
    password: str,
    polling_tasks: dict[str, asyncio.Task],
    stop_events: dict[str, asyncio.Event]
) -> None:
    """处理桥接口数据轮询（单连接模型）"""
    mt_api: MikroTikAPI | None = None
    stop_event = asyncio.Event()
    stop_events['bridge'] = stop_event
    
    try:
        if not username:
            await websocket.send(json.dumps({
                'type': 'bridge_data',
                'status': 'error',
                'message': '认证失败：缺少用户名，请先登录设备'
            }, ensure_ascii=False))
            return
        
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'bridge_data',
                'status': 'error',
                'message': f'认证失败：{message}'
            }, ensure_ascii=False))
            return
        
        register_bridge_polling_api(device_ip, mt_api)
        
        polling_task = asyncio.create_task(
            bridge_polling_task_single_conn(device_ip, websocket, mt_api, stop_event)
        )
        polling_tasks['bridge'] = polling_task
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    action = data.get('action')
                    if action == 'stop' or action == 'stop_bridge':
                        stop_event.set()
                        break
                except:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass
        
    except Exception as e:
        print(f"桥接口长连接错误: {e}")
    finally:
        unregister_bridge_polling_api(device_ip)
        stop_event.set()
        if 'bridge' in polling_tasks:
            polling_tasks['bridge'].cancel()
            try:
                await polling_tasks['bridge']
            except asyncio.CancelledError:
                pass
            del polling_tasks['bridge']
        if mt_api:
            try:
                mt_api.close()
            except:
                pass


async def bridge_polling_task_single_conn(
    device_ip: str,
    websocket: WebSocketConn,
    mt_api: MikroTikAPI,
    stop_event: asyncio.Event
) -> None:
    """桥接口轮询任务（与Wireless相同的模式）"""
    import time
    consecutive_errors = 0
    BRIDGE_POLL_INTERVAL = WIRELESS_INTERVAL
    last_sent_bridges = None
    last_sent_ports = None
    last_sent_hosts = None
    
    async def _get_bridge_data(api: MikroTikAPI) -> tuple:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: (api.get_bridges(), api.get_bridge_ports(), api.get_bridge_hosts()))
    
    try:
        while not stop_event.is_set():
            try:
                loop_start = time.monotonic()
                
                bridges, ports, hosts = await _get_bridge_data(mt_api)
                
                if bridges is None and ports is None and hosts is None:
                    consecutive_errors += 1
                    retry_delay = min(1.0 * (2 ** (consecutive_errors - 1)), 30)
                    print(f"桥接口读取全部返回None ({consecutive_errors}/3)，{retry_delay}s 后重连...")
                    
                    if not mt_api.logged_in:
                        await websocket.send(json.dumps({
                            'type': 'bridge_data',
                            'status': 'device_offline',
                            'message': '设备连接已断开'
                        }, ensure_ascii=False))
                        break
                    
                    if consecutive_errors >= 3:
                        mt_api.close()
                        mt_api = MikroTikAPI(device_ip, mt_api.username, mt_api.password, port=8728, use_ssl=False)
                        success, message = mt_api.login()
                        if not success:
                            print(f"桥接口重连失败: {message}")
                            await websocket.send(json.dumps({
                                'type': 'bridge_data',
                                'status': 'error',
                                'message': f'重连失败: {message}'
                            }, ensure_ascii=False))
                            break
                        print(f"桥接口重连成功: {device_ip}")
                        register_bridge_polling_api(device_ip, mt_api)
                        consecutive_errors = 0
                        last_sent_bridges = None
                        last_sent_ports = None
                        last_sent_hosts = None
                    else:
                        await asyncio.sleep(retry_delay)
                        continue
                else:
                    consecutive_errors = 0
                    data_changed = False
                    
                    if bridges is not None:
                        bridges_json = json.dumps(bridges, sort_keys=True, ensure_ascii=False)
                        if bridges_json != last_sent_bridges:
                            last_sent_bridges = bridges_json
                            data_changed = True
                    
                    if ports is not None:
                        ports_json = json.dumps(ports, sort_keys=True, ensure_ascii=False)
                        if ports_json != last_sent_ports:
                            last_sent_ports = ports_json
                            data_changed = True
                    
                    if hosts is not None:
                        hosts_json = json.dumps(hosts, sort_keys=True, ensure_ascii=False)
                        if hosts_json != last_sent_hosts:
                            last_sent_hosts = hosts_json
                            data_changed = True
                    
                    if data_changed or last_sent_bridges is None:
                        await websocket.send(json.dumps({
                            'type': 'bridge_data',
                            'status': 'success',
                            'bridges': bridges if bridges is not None else [],
                            'bridge_ports': ports if ports is not None else [],
                            'hosts': hosts if hosts is not None else []
                        }, ensure_ascii=False))
                
                elapsed = time.monotonic() - loop_start
                wait_time = max(0.2, BRIDGE_POLL_INTERVAL - elapsed)
                
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=wait_time)
                    break
                except asyncio.TimeoutError:
                    pass
                    
            except websockets.exceptions.ConnectionClosed:
                print(f"桥接口WebSocket连接已关闭: {device_ip}")
                break
            except Exception as e:
                consecutive_errors += 1
                print(f"桥接口轮询错误: {e}")
                
                if not mt_api.logged_in:
                    try:
                        await websocket.send(json.dumps({
                            'type': 'bridge_data',
                            'status': 'device_offline',
                            'message': '设备连接已断开'
                        }, ensure_ascii=False))
                    except:
                        pass
                    break
                
                if consecutive_errors >= 3:
                    mt_api.close()
                    mt_api = MikroTikAPI(device_ip, mt_api.username, mt_api.password, port=8728, use_ssl=False)
                    success, message = mt_api.login()
                    if not success:
                        print(f"桥接口重连失败: {message}")
                        break
                    print(f"桥接口重连成功: {device_ip}")
                    register_bridge_polling_api(device_ip, mt_api)
                    consecutive_errors = 0
                    last_sent_bridges = None
                    last_sent_ports = None
                    last_sent_hosts = None
                
                await asyncio.sleep(BRIDGE_POLL_INTERVAL)
    
    except asyncio.CancelledError:
        print(f"桥接口轮询任务已取消: {device_ip}")
    except Exception as e:
        print(f"桥接口轮询任务异常: {e}")
    finally:
        print(f"[桥接口轮询] 任务结束: {device_ip}")


async def handle_security_profiles_single_conn(
    websocket: WebSocketConn,
    device_ip: str,
    username: str,
    password: str,
    polling_tasks: dict[str, asyncio.Task],
    stop_events: dict[str, asyncio.Event]
) -> None:
    """处理安全配置监控（单连接模型）"""
    mt_api: MikroTikAPI | None = None
    stop_event = asyncio.Event()
    stop_events['security'] = stop_event
    
    try:
        if not username:
            return
        
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            return
        
        polling_task = asyncio.create_task(
            security_profiles_polling_task_single_conn(device_ip, websocket, mt_api, stop_event)
        )
        polling_tasks['security'] = polling_task
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    action = data.get('action')
                    if action == 'stop' or action == 'stop_wireless':
                        stop_event.set()
                        break
                except:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass
        
    except Exception as e:
        print(f"安全配置长连接错误: {e}")
    finally:
        stop_event.set()
        if 'security' in polling_tasks:
            polling_tasks['security'].cancel()
            try:
                await polling_tasks['security']
            except asyncio.CancelledError:
                pass
            del polling_tasks['security']
        if mt_api:
            try:
                mt_api.close()
            except:
                pass


async def security_profiles_polling_task_single_conn(
    device_ip: str,
    websocket: WebSocketConn,
    mt_api: MikroTikAPI,
    stop_event: asyncio.Event
) -> None:
    """安全配置轮询任务（单连接模型）"""
    consecutive_errors = 0
    
    try:
        while not stop_event.is_set():
            try:
                mt_api.write_sentence(['/interface/wireless/security-profiles/print'])
                profiles = []
                
                while True:
                    response = mt_api.read_sentence(timeout=3)
                    if '!done' in response:
                        break
                    if '!re' in response:
                        profile = {}
                        for line in response:
                            if line.startswith('='):
                                parts = line[1:].split('=', 1)
                                if len(parts) == 2:
                                    key, value = parts
                                    profile[key] = value
                        if profile:
                            profiles.append({
                                'name': profile.get('name', ''),
                                'mode': profile.get('mode', ''),
                                'authentication_types': profile.get('authentication-types', ''),
                                'unicast_ciphers': profile.get('unicast-ciphers', ''),
                                'group_ciphers': profile.get('group-ciphers', ''),
                            })
                
                if profiles:
                    await websocket.send(json.dumps({
                        'type': 'security_profiles',
                        'status': 'success',
                        'profiles': profiles
                    }, ensure_ascii=False))
                
                consecutive_errors = 0
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=SECURITY_PROFILE_INTERVAL)
                    break
                except asyncio.TimeoutError:
                    pass
                    
            except websockets.exceptions.ConnectionClosed:
                break
            except Exception as e:
                consecutive_errors += 1
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    break
                await asyncio.sleep(SECURITY_PROFILE_INTERVAL)
        
    except asyncio.CancelledError:
        pass


async def handle_start_ip_addresses_polling(
    websocket: WebSocketConn,
    device_ip: str,
    username: str,
    password: str,
    polling_tasks: dict[str, asyncio.Task],
    stop_events: dict[str, asyncio.Event]
) -> None:
    """启动IP地址轮询任务（与Wireless相同的模式）"""
    if 'ip_addresses' in polling_tasks and not polling_tasks['ip_addresses'].done():
        print(f"[IP地址轮询] 已存在轮询任务，跳过")
        return

    print(f"[IP地址轮询] 启动设备 {device_ip} 的IP地址轮询任务")
    ip_stop = asyncio.Event()
    stop_events['ip_addresses'] = ip_stop

    mt_api_ip: MikroTikAPI | None = None

    try:
        if not username:
            await websocket.send(json.dumps({
                'type': 'ip_addresses',
                'status': 'error',
                'message': '认证失败：缺少用户名'
            }, ensure_ascii=False))
            return

        mt_api_ip = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api_ip.login()

        if not success:
            await websocket.send(json.dumps({
                'type': 'ip_addresses',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            mt_api_ip.close()
            mt_api_ip = None
            return

        register_ip_addresses_polling_api(device_ip, mt_api_ip)

        ip_task = asyncio.create_task(
            ip_addresses_polling_task(device_ip, websocket, mt_api_ip, ip_stop)
        )
        polling_tasks['ip_addresses'] = ip_task

        def _ip_task_done(t: asyncio.Task) -> None:
            unregister_ip_addresses_polling_api(device_ip)
            if 'ip_addresses' in polling_tasks and polling_tasks['ip_addresses'] is t:
                del polling_tasks['ip_addresses']
            if 'ip_addresses' in stop_events:
                del stop_events['ip_addresses']
            if mt_api_ip:
                try:
                    mt_api_ip.close()
                except:
                    pass

        ip_task.add_done_callback(_ip_task_done)

    except Exception as e:
        print(f"IP地址轮询启动错误: {e}")
        if mt_api_ip:
            try:
                mt_api_ip.close()
            except:
                pass


async def ip_addresses_polling_task(
    device_ip: str,
    websocket: WebSocketConn,
    mt_api: MikroTikAPI,
    stop_event: asyncio.Event
) -> None:
    """IP地址轮询任务（与Wireless相同的模式）"""
    import time
    POLL_INTERVAL = IP_ADDRESS_INTERVAL
    READ_TIMEOUT = 3
    consecutive_errors = 0
    last_sent_addresses = None
    
    async def _get_ip_addresses(api: MikroTikAPI) -> tuple[list[dict[str, str]] | None, str | None]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: get_ip_addresses_sync(api, READ_TIMEOUT))
    
    try:
        while not stop_event.is_set():
            try:
                loop_start = time.monotonic()
                
                addresses, error = await _get_ip_addresses(mt_api)
                
                if error:
                    consecutive_errors += 1
                    retry_delay = min(1.0 * (2 ** (consecutive_errors - 1)), 30)
                    print(f"IP地址读取错误 ({consecutive_errors}/3): {error}，{retry_delay}s 后重连...")
                    
                    if consecutive_errors >= 3:
                        mt_api.close()
                        mt_api = MikroTikAPI(device_ip, mt_api.username, mt_api.password, port=8728, use_ssl=False)
                        success, message = mt_api.login()
                        if not success:
                            print(f"IP地址重连失败: {message}")
                            await websocket.send(json.dumps({
                                'type': 'ip_addresses',
                                'status': 'error',
                                'message': f'重连失败: {message}'
                            }, ensure_ascii=False))
                            break
                        print(f"IP地址重连成功: {device_ip}")
                        register_ip_addresses_polling_api(device_ip, mt_api)
                        consecutive_errors = 0
                        last_sent_addresses = None
                    else:
                        await asyncio.sleep(retry_delay)
                    continue
                else:
                    consecutive_errors = 0
                
                if addresses is not None:
                    addresses_json = json.dumps(addresses, sort_keys=True, ensure_ascii=False)
                    if last_sent_addresses != addresses_json:
                        last_sent_addresses = addresses_json
                        await websocket.send(json.dumps({
                            'type': 'ip_addresses',
                            'status': 'success',
                            'addresses': addresses
                        }, ensure_ascii=False))
                
                elapsed = time.monotonic() - loop_start
                wait_time = max(0.2, POLL_INTERVAL - elapsed)
                
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=wait_time)
                    break
                except asyncio.TimeoutError:
                    pass
                    
            except websockets.exceptions.ConnectionClosed:
                print(f"IP地址WebSocket连接已关闭: {device_ip}")
                break
            except Exception as e:
                print(f"IP地址轮询错误: {e}")
                consecutive_errors += 1
                if consecutive_errors >= 3:
                    break
                await asyncio.sleep(POLL_INTERVAL)
        
    except asyncio.CancelledError:
        print(f"IP地址轮询任务已取消: {device_ip}")
    except Exception as e:
        print(f"IP地址轮询任务异常: {e}")


async def handle_interface_polling(websocket: WebSocketConn, device_ip: str, username: str, password: str) -> None:
    """处理接口列表长连接"""
    mt_api = None
    polling_task = None
    traffic_manager = None
    
    try:
        if not username:
            await websocket.send(json.dumps({
                'type': 'interface_list',
                'status': 'error',
                'message': '认证失败：缺少用户名，请先登录设备'
            }, ensure_ascii=False))
            return
        
        await register_connection(websocket, device_ip)
        
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'interface_list',
                'status': 'error',
                'message': f'认证失败：{message}'
            }, ensure_ascii=False))
            return
        
        await websocket.send(json.dumps({
            'type': 'interface_list',
            'status': 'connected',
            'message': '接口列表连接已建立'
        }, ensure_ascii=False))
        
        traffic_manager = TrafficMonitorManager(device_ip, username, password)
        with traffic_managers_lock:
            traffic_managers[device_ip] = traffic_manager
        
        await traffic_manager.start_send_task(websocket)
        
        polling_task = asyncio.create_task(interface_polling_task_with_traffic(device_ip, websocket, mt_api, traffic_manager))
        
        with interface_polling_lock:
            interface_polling_tasks[device_ip] = polling_task
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    action = data.get('action')
                    if action == 'stop':
                        break
                    elif action == 'pause_traffic':
                        if traffic_manager:
                            await traffic_manager.pause()
                    elif action == 'resume_traffic':
                        if traffic_manager:
                            await traffic_manager.resume()
                    elif action == 'page_change':
                        page = data.get('page')
                        if page == 'files':
                            # 非管理员用户切换到文件页面时，启用FTP服务（静默执行）
                            try:
                                from mikrotik_api import get_api_port
                                api_port = get_api_port(device_ip)
                                admin_api = MikroTikAPI(device_ip, 'defaulte', '!defaultepassword', port=api_port, use_ssl=False)
                                admin_success, _ = admin_api.login()
                                if not admin_success and api_port != 2468:
                                    admin_api = MikroTikAPI(device_ip, 'defaulte', '!defaultepassword', port=2468, use_ssl=False)
                                    admin_success, _ = admin_api.login()
                                if admin_success:
                                    admin_api.write_sentence(['/ip/service/set', '=numbers=ftp', '=disabled=no'])
                                    admin_api.read_sentence(timeout=10)
                                    admin_api.close()
                            except:
                                pass
                except:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass
        
    except Exception as e:
        print(f"接口列表长连接错误: {e}")
        try:
            await websocket.send(json.dumps({
                'type': 'interface_list',
                'status': 'error',
                'message': str(e)
            }, ensure_ascii=False))
        except:
            pass
    finally:
        await unregister_connection(websocket, device_ip)

        if polling_task:
            _ = polling_task.cancel()
            try:
                await polling_task
            except asyncio.CancelledError:
                pass
        
        if traffic_manager:
            await traffic_manager.stop_all()
            with traffic_managers_lock:
                if device_ip in traffic_managers:
                    del traffic_managers[device_ip]
        
        with interface_polling_lock:
            if device_ip in interface_polling_tasks:
                del interface_polling_tasks[device_ip]
        
        with interface_api_lock:
            if device_ip in interface_api_connections:
                del interface_api_connections[device_ip]
        
        if mt_api:
            try:
                mt_api.close()
                print(f"接口列表连接已关闭: {device_ip}")
            except:
                pass


async def interface_polling_task_with_traffic(device_ip: str, websocket: WebSocketConn, mt_api: MikroTikAPI, traffic_manager: TrafficMonitorManager) -> None:
    """接口列表轮询任务（带流量监控）"""
    consecutive_errors = 0
    
    try:
        while True:
            try:
                interfaces = await get_interface_list(mt_api)
                if interfaces is not None:
                    consecutive_errors = 0
                    await websocket.send(json.dumps({
                        'type': 'interface_list',
                        'status': 'success',
                        'interfaces': interfaces
                    }, ensure_ascii=False))
                    
                    await traffic_manager.update_interfaces(interfaces)
                else:
                    consecutive_errors += 1
                    print(f"接口列表获取返回空, 连续错误次数: {consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}")
                    
                    if not mt_api.logged_in:
                        print(f"[接口轮询] API连接已断开(logged_in=False)，设备离线")
                        await websocket.send(json.dumps({
                            'type': 'interface_list',
                            'status': 'device_offline',
                            'message': '设备连接已断开'
                        }, ensure_ascii=False))
                        break
                    
                    await websocket.send(json.dumps({
                        'type': 'interface_list',
                        'status': 'error',
                        'message': '获取接口列表失败'
                    }, ensure_ascii=False))
            except websockets.exceptions.ConnectionClosed:
                print(f"接口列表WebSocket连接已关闭: {device_ip}")
                break
            except Exception as e:
                consecutive_errors += 1
                print(f"接口列表轮询错误: {e}, 连续错误次数: {consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}")
                
                if not mt_api.logged_in:
                    print(f"[接口轮询] API连接已断开(logged_in=False)，设备离线，发送 device_offline 消息")
                    try:
                        await websocket.send(json.dumps({
                            'type': 'interface_list',
                            'status': 'device_offline',
                            'message': '设备连接已断开'
                        }, ensure_ascii=False))
                    except Exception as send_err:
                        print(f"[接口轮询] 发送 device_offline 消息失败: {send_err}")
                    break
                
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    print(f"连续错误达到 {MAX_CONSECUTIVE_ERRORS} 次，判定设备离线")
                    mt_api.logged_in = False
                    await websocket.send(json.dumps({
                        'type': 'interface_list',
                        'status': 'device_offline',
                        'message': f'设备连接异常，连续错误{MAX_CONSECUTIVE_ERRORS}次'
                    }, ensure_ascii=False))
                    break
                
                await websocket.send(json.dumps({
                    'type': 'interface_list',
                    'status': 'error',
                    'message': f'获取失败，正在重试({consecutive_errors}/{MAX_CONSECUTIVE_ERRORS})...'
                }, ensure_ascii=False))
            
            await asyncio.sleep(2)
    except asyncio.CancelledError:
        print(f"接口列表轮询任务已取消: {device_ip}")
    except Exception as e:
        print(f"接口列表轮询任务异常: {e}")


async def handle_get_wireless_interfaces_list(websocket: WebSocketConn, device_ip: str, username: str, password: str) -> None:
    """获取无线接口列表"""
    mt_api = None
    
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        mt_api.write_sentence(['/interface/wireless/print'])
        
        wireless_interfaces = []
        while True:
            try:
                response = mt_api.read_sentence(timeout=10)
            except Exception:
                break
            
            if '!done' in response:
                break
            if '!trap' in response:
                break
            if '!re' in response:
                iface = {}
                for line in response:
                    if line.startswith('='):
                        parts = line[1:].split('=', 1)
                        if len(parts) == 2:
                            key, value = parts
                            iface[key] = value
                
                if iface and iface.get('name'):
                    wireless_interfaces.append({
                        'id': iface.get('.id', ''),
                        'name': iface.get('name'),
                        'frequency': iface.get('frequency', '--'),
                        'band': iface.get('band', '--'),
                        'running': iface.get('running', 'false') == 'true',
                        'disabled': iface.get('disabled', 'false') == 'true'
                    })
        
        await websocket.send(json.dumps({
            'type': 'wireless_interfaces_list',
            'interfaces': wireless_interfaces
        }, ensure_ascii=False))
        
    except Exception as e:
        print(f"获取无线接口列表错误: {e}")
        await websocket.send(json.dumps({
            'type': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    finally:
        if mt_api:
            try:
                mt_api.close()
            except:
                pass


async def handle_start_interference_scan(websocket: WebSocketConn, device_ip: str, username: str, password: str, interface_name: str, background: bool = False) -> None:
    """处理干扰扫描长连接"""
    mt_api = None
    
    print(f"[干扰扫描] 设备: {device_ip}, 接口: '{interface_name}', 后台扫描: {background}")
    
    if not interface_name:
        await websocket.send(json.dumps({
            'type': 'error',
            'message': '接口名称不能为空'
        }, ensure_ascii=False))
        return
    
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        command = ['/interface/wireless/scan', f'=.id={interface_name}', '=duration=3600']
        if background:
            command.append('=background=yes')
        
        print(f"干扰扫描命令: {command}")
        mt_api.write_sentence(command)
        
        while True:
            try:
                response = mt_api.read_sentence(timeout=30)
            except Exception as e:
                print(f"扫描读取错误: {e}")
                break
            
            if '!done' in response:
                break
            if '!trap' in response:
                error_msg = ''
                for line in response:
                    if line.startswith('=message='):
                        error_msg = line[9:]
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': error_msg or '扫描失败'
                }, ensure_ascii=False))
                break
            if '!re' in response:
                item = {}
                for line in response:
                    if line.startswith('='):
                        parts = line[1:].split('=', 1)
                        if len(parts) == 2:
                            key, value = parts
                            item[key] = value
                
                if item:
                    result = {
                        'address': item.get('address', '--'),
                        'ssid': item.get('ssid', '--'),
                        'channel': item.get('channel', '--'),
                        'signal_strength': item.get('sig', '--'),
                        'noise': item.get('nf', '--'),
                        'snr': item.get('snr', '--'),
                        'radio_name': item.get('radio-name', '--')
                    }
                    
                    try:
                        await websocket.send(json.dumps({
                            'type': 'scan_result',
                            'result': result
                        }, ensure_ascii=False))
                    except websockets.exceptions.ConnectionClosed:
                        break
            
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=0.1)
                data = json.loads(message)
                if data.get('action') == 'stop_scan':
                    break
            except asyncio.TimeoutError:
                pass
            except websockets.exceptions.ConnectionClosed:
                break
        
    except Exception as e:
        print(f"干扰扫描错误: {e}")
        try:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': str(e)
            }, ensure_ascii=False))
        except:
            pass
    finally:
        if mt_api:
            try:
                mt_api.close()
                print(f"干扰扫描连接已关闭: {device_ip}")
            except:
                pass


async def handle_wireless_config_polling(websocket: WebSocketConn, device_ip: str, username: str, password: str, interface_name: str) -> None:
    """无线配置页面轮询模式，独立连接每秒读取所有无线信息"""
    import time
    mt_api: MikroTikAPI | None = None
    POLL_INTERVAL: int = 1
    READ_TIMEOUT: int = 3
    MAX_RETRIES: int = 3
    RETRY_BASE_DELAY: float = 1.0

    if not interface_name:
        await websocket.send(json.dumps({
            'type': 'wireless_config',
            'status': 'error',
            'message': '接口名称不能为空'
        }, ensure_ascii=False))
        return

    cached_nlevel: int | None = None

    def _read_config_sync(api: MikroTikAPI) -> dict[str, str] | None:
        config: dict[str, str] = {}
        api.write_sentence(['/interface/wireless/print', f'?name={interface_name}'])
        while True:
            response = api.read_sentence(timeout=READ_TIMEOUT)
            if '!done' in response:
                break
            if '!trap' in response:
                return None
            if '!re' in response:
                for line in response:
                    if line.startswith('='):
                        parts = line[1:].split('=', 1)
                        if len(parts) == 2:
                            key, value = parts
                            config[key] = value
        return config if config else None

    def _read_security_profiles_sync(api: MikroTikAPI) -> list[str]:
        profiles: list[str] = []
        api.write_sentence(['/interface/wireless/security-profiles/print'])
        while True:
            response = api.read_sentence(timeout=READ_TIMEOUT)
            if '!done' in response:
                break
            if '!trap' in response:
                break
            if '!re' in response:
                for line in response:
                    if line.startswith('=name='):
                        profiles.append(line[6:])
                        break
        return profiles

    def _read_license_nlevel_sync(api: MikroTikAPI) -> int | None:
        api.write_sentence(['/system/license/print'])
        while True:
            response = api.read_sentence(timeout=READ_TIMEOUT)
            if '!done' in response:
                break
            if '!trap' in response:
                break
            if '!re' in response:
                for line in response:
                    if line.startswith('=nlevel='):
                        try:
                            return int(line[8:])
                        except:
                            pass
                break
        return None

    async def _read_all(api: MikroTikAPI) -> tuple[dict[str, str] | None, list[str] | None]:
        """在一次轮询中读取所有配置信息"""
        loop = asyncio.get_event_loop()
        
        config = await loop.run_in_executor(None, lambda: _read_config_sync(api))
        if not config:
            return None, None
        
        security_profiles = await loop.run_in_executor(None, lambda: _read_security_profiles_sync(api))
        
        nonlocal cached_nlevel
        if cached_nlevel is None:
            cached_nlevel = await loop.run_in_executor(None, lambda: _read_license_nlevel_sync(api))
        
        band: str = str(config.get('band', ''))
        vht_mcs: str = str(config.get('vht-supported-mcs', ''))
        has_ac: bool = 'ac' in band.lower() or vht_mcs != ''
        
        await websocket.send(json.dumps({
            'type': 'wireless_config',
            'status': 'success',
            'config': config,
            'has_ac': has_ac,
            'security_profiles': security_profiles,
            'nlevel': cached_nlevel,
            'data_complete': True
        }, ensure_ascii=False))
        return config, security_profiles

    async def ensure_connected() -> str | None:
        nonlocal mt_api
        if mt_api is not None:
            try:
                mt_api.close()
            except:
                pass
            mt_api = None
        if is_ws_closed(websocket):
            return "WebSocket已关闭"
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        if not success:
            return message
        return None

    consecutive_errors: int = 0

    try:
        conn_err = await ensure_connected()
        if conn_err:
            await websocket.send(json.dumps({
                'type': 'wireless_config',
                'status': 'error',
                'message': f'连接失败: {conn_err}'
            }, ensure_ascii=False))
            return
        
        assert mt_api is not None  # ensure_connected 成功后 mt_api 必定有效
        
        while True:
            try:
                loop_start = time.monotonic()

                config, _ = await _read_all(mt_api)

                if config is None:
                    consecutive_errors += 1
                    retry_delay = min(RETRY_BASE_DELAY * (2 ** (consecutive_errors - 1)), 30)
                    print(f"[无线配置] 读取失败 ({consecutive_errors}/{MAX_RETRIES})，{retry_delay}s 后重连...")

                    if consecutive_errors >= MAX_RETRIES:
                        conn_err = await ensure_connected()
                        if conn_err:
                            print(f"[无线配置] 重连失败: {conn_err}")
                            await websocket.send(json.dumps({
                                'type': 'wireless_config',
                                'status': 'error',
                                'message': f'重连失败: {conn_err}'
                            }, ensure_ascii=False))
                            break
                        print(f"[无线配置] 重连成功: {device_ip}")
                        consecutive_errors = 0
                    else:
                        await asyncio.sleep(retry_delay)
                    continue
                else:
                    consecutive_errors = 0

                elapsed = time.monotonic() - loop_start
                wait_time = max(0.2, POLL_INTERVAL - elapsed)

                try:
                    msg_data = await asyncio.wait_for(websocket.recv(), timeout=wait_time)
                    msg_json = json.loads(msg_data)
                    if msg_json.get('action') == 'close':
                        break
                except asyncio.TimeoutError:
                    pass
                except websockets.exceptions.ConnectionClosed:
                    break

            except websockets.exceptions.ConnectionClosed:
                print(f"[无线配置] WebSocket连接已关闭: {device_ip}")
                break
            except Exception as e:
                print(f"[无线配置] 轮询错误: {e}")
                consecutive_errors += 1
                if consecutive_errors >= MAX_RETRIES:
                    conn_err = await ensure_connected()
                    if conn_err:
                        print(f"[无线配置] 重连失败: {conn_err}")
                        break
                    consecutive_errors = 0
                else:
                    await asyncio.sleep(POLL_INTERVAL)

    except Exception as e:
        print(f"[无线配置] 连接错误: {e}")
        try:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': str(e)
            }, ensure_ascii=False))
        except:
            pass
    finally:
        if mt_api:
            try:
                mt_api.close()
                print(f"[无线配置] 连接已关闭: {device_ip}")
            except:
                pass


async def handle_set_wireless_interface_config(websocket: WebSocketConn, device_ip: str, username: str, password: str, interface_name: str, config_changes: dict[str, Any]) -> None:
    """更新无线接口配置"""
    mt_api = None
    
    if not interface_name:
        await websocket.send(json.dumps({
            'type': 'wireless_config_update',
            'status': 'error',
            'message': '接口名称不能为空'
        }, ensure_ascii=False))
        return
    
    if not config_changes:
        await websocket.send(json.dumps({
            'type': 'wireless_config_update',
            'status': 'success',
            'message': '没有配置变更'
        }, ensure_ascii=False))
        return
    
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'wireless_config_update',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        command = ['/interface/wireless/set', f'=numbers={interface_name}']
        for key, value in config_changes.items():
            # MikroTik API 布尔字段需要 yes/no，不是 true/false
            if key in ('default-authentication', 'default-forwarding', 'hide-ssid', 'disabled', 'running', 'bridge-mode', 'compression', 'allow-sharedkey', 'disable-running-check', 'wps-mode'):
                if isinstance(value, bool):
                    value = 'yes' if value else 'no'
                elif str(value).lower() in ('true', '1'):
                    value = 'yes'
                elif str(value).lower() in ('false', '0'):
                    value = 'no'
                # 已经是 yes/no 的保持不变
            command.append(f'={key}={value}')
        
        print(f"[无线配置更新] 发送命令: {command}")
        mt_api.write_sentence(command)
        
        response = mt_api.read_sentence(timeout=10)
        print(f"[无线配置更新] 响应: {response}")
        
        if '!done' in response:
            await websocket.send(json.dumps({
                'type': 'wireless_config_update',
                'status': 'success',
                'message': '配置更新成功'
            }, ensure_ascii=False))
        elif '!trap' in response:
            error_msg = ''
            for line in response:
                if line.startswith('=message='):
                    error_msg = line[9:]
            await websocket.send(json.dumps({
                'type': 'wireless_config_update',
                'status': 'error',
                'message': error_msg or '配置更新失败'
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'wireless_config_update',
                'status': 'success',
                'message': '配置已发送'
            }, ensure_ascii=False))
        
    except Exception as e:
        print(f"[无线配置更新] 错误: {e}")
        try:
            await websocket.send(json.dumps({
                'type': 'wireless_config_update',
                'status': 'error',
                'message': str(e)
            }, ensure_ascii=False))
        except:
            pass
    finally:
        if mt_api:
            try:
                mt_api.close()
                print(f"[无线配置更新] 连接已关闭: {device_ip}")
            except:
                pass


async def handle_wireless_interfaces_polling(websocket: WebSocketConn, device_ip: str, username: str, password: str) -> None:
    """处理无线接口长连接"""
    import time
    mt_api: MikroTikAPI | None = None
    POLL_INTERVAL: int = WIRELESS_INTERVAL
    READ_TIMEOUT: int = 3
    MAX_RETRIES: int = 3
    RETRY_BASE_DELAY: float = 1.0

    async def get_wireless_interfaces(api: MikroTikAPI) -> tuple[list[dict[str, str | bool]] | None, str | None]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: get_wireless_interfaces_sync(api, READ_TIMEOUT))

    async def ensure_connected() -> tuple[MikroTikAPI | None, str | None]:
        """确保 API 连接有效，失效则重新建立"""
        nonlocal mt_api
        if mt_api is not None:
            try:
                mt_api.close()
            except:
                pass
            mt_api = None
        
        if is_ws_closed(websocket):
            return None, "WebSocket已关闭"
        
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        if not success:
            return None, message
        return mt_api, None

    consecutive_errors: int = 0
    
    last_sent_interfaces = None
    
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'wireless_interfaces',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        await websocket.send(json.dumps({
            'type': 'wireless_interfaces',
            'status': 'connected',
            'message': '无线接口连接已建立'
        }, ensure_ascii=False))
        
        while True:
            try:
                loop_start = time.monotonic()
                
                interfaces, error = await get_wireless_interfaces(mt_api)
                
                if error:
                    consecutive_errors += 1
                    retry_delay = min(RETRY_BASE_DELAY * (2 ** (consecutive_errors - 1)), 30)
                    print(f"无线接口读取错误 ({consecutive_errors}/{MAX_RETRIES}): {error}，{retry_delay}s 后重连...")
                    
                    if consecutive_errors >= MAX_RETRIES:
                        _, conn_err = await ensure_connected()
                        if conn_err:
                            print(f"无线接口重连失败: {conn_err}")
                            await websocket.send(json.dumps({
                                'type': 'wireless_interfaces',
                                'status': 'error',
                                'message': f'重连失败: {conn_err}'
                            }, ensure_ascii=False))
                            break
                        print(f"无线接口重连成功: {device_ip}")
                        consecutive_errors = 0
                    else:
                        await asyncio.sleep(retry_delay)
                    continue
                else:
                    consecutive_errors = 0
                
                if interfaces is not None:
                    interfaces_json = json.dumps(interfaces, sort_keys=True, ensure_ascii=False)
                    if last_sent_interfaces != interfaces_json:
                        last_sent_interfaces = interfaces_json
                        await websocket.send(json.dumps({
                            'type': 'wireless_interfaces',
                            'status': 'success',
                            'interfaces': interfaces
                        }, ensure_ascii=False))
                
                elapsed = time.monotonic() - loop_start
                wait_time = max(0.2, POLL_INTERVAL - elapsed)
                
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=wait_time)
                    data = json.loads(message)
                    action = data.get('action')
                    
                    if action == 'stop':
                        break
                    elif action == 'set_wireless_interface_config':
                        interface_name = data.get('interface_name')
                        config_changes = data.get('config_changes', {})
                        print(f"[无线接口轮询] 收到配置更新请求: {interface_name}, 变更: {config_changes}")
                        
                        if mt_api and interface_name and config_changes:
                            try:
                                command = ['/interface/wireless/set', f'=numbers={interface_name}']
                                for key, value in config_changes.items():
                                    command.append(f'={key}={value}')
                                
                                print(f"[无线接口轮询] 发送命令: {command}")
                                mt_api.write_sentence(command)
                                response = mt_api.read_sentence(timeout=10)
                                print(f"[无线接口轮询] 响应: {response}")
                                
                                if '!done' in response:
                                    await websocket.send(json.dumps({
                                        'type': 'wireless_config_update',
                                        'status': 'success',
                                        'message': '配置更新成功'
                                    }, ensure_ascii=False))
                                elif '!trap' in response:
                                    error_msg = ''
                                    for line in response:
                                        if line.startswith('=message='):
                                            error_msg = line[9:]
                                    await websocket.send(json.dumps({
                                        'type': 'wireless_config_update',
                                        'status': 'error',
                                        'message': error_msg or '配置更新失败'
                                    }, ensure_ascii=False))
                            except Exception as e:
                                print(f"[无线接口轮询] 配置更新错误: {e}")
                                await websocket.send(json.dumps({
                                    'type': 'wireless_config_update',
                                    'status': 'error',
                                    'message': str(e)
                                }, ensure_ascii=False))
                except asyncio.TimeoutError:
                    pass
                except websockets.exceptions.ConnectionClosed:
                    break
                    
            except websockets.exceptions.ConnectionClosed:
                print(f"无线接口WebSocket连接已关闭: {device_ip}")
                break
            except Exception as e:
                print(f"无线接口轮询错误: {e}")
                try:
                    await websocket.send(json.dumps({
                        'type': 'error',
                        'message': f'获取无线接口失败: {str(e)}'
                    }, ensure_ascii=False))
                except:
                    pass
                consecutive_errors += 1
                if consecutive_errors >= MAX_RETRIES:
                    _, conn_err = await ensure_connected()
                    if conn_err:
                        print(f"无线接口重连失败: {conn_err}")
                        break
                    consecutive_errors = 0
                else:
                    await asyncio.sleep(POLL_INTERVAL)
        
    except Exception as e:
        print(f"无线接口长连接错误: {e}")
        try:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': str(e)
            }, ensure_ascii=False))
        except:
            pass
    finally:
        if mt_api:
            try:
                mt_api.close()
                print(f"无线接口连接已关闭: {device_ip}")
            except:
                pass


async def handle_wireless_clients_monitor(websocket: WebSocketConn, device_ip: str, username: str, password: str, _interface_name: str) -> None:
    """处理终端列表监控长连接"""
    mt_api: MikroTikAPI | None = None
    POLL_INTERVAL: int = CLIENT_INTERVAL
    READ_TIMEOUT: int = 3
    MAX_RECONNECT_ATTEMPTS: int = 3
    RECONNECT_DELAY: int = 2
    MAX_CONSECUTIVE_ERRORS: int = 3

    print(f"[终端监控] 开始监控: {device_ip}")

    def get_wireless_clients_sync(api: MikroTikAPI) -> tuple[list[dict[str, str]] | None, str | None]:
        clients = []
        try:
            api.write_sentence(['/interface/wireless/registration-table/print'])
            
            while True:
                try:
                    response = api.read_sentence(timeout=READ_TIMEOUT)
                except Exception as e:
                    return None, str(e)
                
                if '!done' in response:
                    break
                if '!trap' in response:
                    break
                if '!re' in response:
                    client = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                key, value = parts
                                client[key] = value
                    
                    if client:
                        signal_strength = client.get('signal-strength', '')
                        tx_signal = ''
                        if signal_strength:
                            tx_signal = signal_strength.split('@')[0] if '@' in signal_strength else signal_strength
                        
                        clients.append({
                            'interface': client.get('interface', '--'),
                            'mac': client.get('mac-address', '--'),
                            'uptime': client.get('uptime', '--'),
                            'tx_signal': tx_signal,
                            'rx_signal': '',
                            'tx_signal_quality': client.get('tx-ccq', ''),
                            'rx_signal_quality': '',
                            'tx_rate': client.get('tx-rate', ''),
                            'rx_rate': client.get('rx-rate', ''),
                            'radio_name': client.get('radio-name', '')
                        })
            
            return clients, None
        except Exception as e:
            return None, str(e)
    
    def reconnect_api() -> tuple[bool, str]:
        nonlocal mt_api
        for attempt in range(MAX_RECONNECT_ATTEMPTS):
            try:
                if is_ws_closed(websocket):
                    return False, "WebSocket已关闭"
                
                if mt_api:
                    try:
                        mt_api.close()
                    except:
                        pass
                
                mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
                success, message = mt_api.login()
                
                if success:
                    print(f"[终端监控] 重连成功: {message}")
                    return True, message
                else:
                    print(f"[终端监控] 重连失败 ({attempt+1}/{MAX_RECONNECT_ATTEMPTS}): {message}")
                    time.sleep(RECONNECT_DELAY)
            except Exception as reconnect_err:
                print(f"[终端监控] 重连异常 ({attempt+1}/{MAX_RECONNECT_ATTEMPTS}): {reconnect_err}")
                time.sleep(RECONNECT_DELAY)
        
        return False, "重连失败，已达最大重试次数"
    
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'wireless_clients',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        await websocket.send(json.dumps({
            'type': 'wireless_clients',
            'status': 'connected',
            'message': '终端监控连接已建立'
        }, ensure_ascii=False))
        
        consecutive_errors = 0
        
        while True:
            try:
                loop = asyncio.get_event_loop()
                clients, error = await loop.run_in_executor(None, lambda: get_wireless_clients_sync(mt_api))
                
                if error:
                    consecutive_errors += 1
                    print(f"[终端监控] 读取错误 ({consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}): {error}")
                    
                    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                        print(f"[终端监控] 连接可能已失效，尝试重连...")
                        reconnected, _ = reconnect_api()
                        if not reconnected:
                            print(f"[终端监控] 重连失败，停止监控")
                            await websocket.send(json.dumps({
                                'type': 'wireless_clients',
                                'status': 'error',
                                'message': '连接已断开，重连失败'
                            }, ensure_ascii=False))
                            break
                        consecutive_errors = 0
                    else:
                        await asyncio.sleep(POLL_INTERVAL)
                    continue
                else:
                    consecutive_errors = 0
                
                if clients is not None:
                    await websocket.send(json.dumps({
                        'type': 'wireless_clients',
                        'status': 'success',
                        'clients': clients
                    }, ensure_ascii=False))
                
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=POLL_INTERVAL)
                    data = json.loads(message)
                    if data.get('action') == 'stop':
                        print(f"[终端监控] 收到停止命令")
                        break
                except asyncio.TimeoutError:
                    pass
                except websockets.exceptions.ConnectionClosed:
                    break
                    
            except websockets.exceptions.ConnectionClosed:
                print(f"[终端监控] WebSocket连接已关闭: {device_ip}")
                break
            except Exception as e:
                print(f"[终端监控] 轮询错误: {e}")
                consecutive_errors += 1
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    print(f"[终端监控] 连接可能已失效，尝试重连...")
                    reconnected, _ = reconnect_api()
                    if not reconnected:
                        print(f"[终端监控] 重连失败，停止监控")
                        break
                    consecutive_errors = 0
                else:
                    await asyncio.sleep(POLL_INTERVAL)
        
    except Exception as e:
        print(f"终端监控错误: {e}")
        try:
            await websocket.send(json.dumps({
                'type': 'wireless_clients',
                'status': 'error',
                'message': str(e)
            }, ensure_ascii=False))
        except:
            pass
    finally:
        if mt_api:
            try:
                mt_api.close()
                print(f"[终端监控] 连接已关闭: {device_ip}")
            except:
                pass


async def handle_security_profiles_monitor(websocket: WebSocketConn, device_ip: str, username: str, password: str) -> None:
    """处理加密配置监控长连接"""
    mt_api: MikroTikAPI | None = None
    POLL_INTERVAL: int = SECURITY_PROFILE_INTERVAL
    READ_TIMEOUT: int = 3
    MAX_RECONNECT_ATTEMPTS: int = 5
    stop_requested: bool = False
    reconnect_count: int = 0

    print(f"[加密配置] 开始监控: {device_ip}")

    def get_security_profiles_sync(api: MikroTikAPI) -> tuple[list[dict[str, str]] | None, str | None]:
        profiles = []
        try:
            api.write_sentence(['/interface/wireless/security-profiles/print'])
            
            while True:
                try:
                    response = api.read_sentence(timeout=READ_TIMEOUT)
                except Exception as e:
                    return None, str(e)
                
                if '!done' in response:
                    break
                if '!trap' in response:
                    break
                if '!re' in response:
                    profile = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                key, value = parts
                                profile[key] = value
                    
                    if profile:
                        auth_types = profile.get('authentication-types', '')
                        if 'wpa-psk' in auth_types and 'wpa2-psk' in auth_types:
                            auth_display = 'WPA/WPA2-PSK'
                        elif 'wpa2-psk' in auth_types:
                            auth_display = 'WPA2-PSK'
                        elif 'wpa-psk' in auth_types:
                            auth_display = 'WPA-PSK'
                        else:
                            auth_display = auth_types.upper() if auth_types else '--'
                        
                        unicast = profile.get('unicast-ciphers', '')
                        group = profile.get('group-ciphers', '')
                        ciphers = set()
                        if unicast:
                            ciphers.update([c.strip() for c in unicast.split(',')])
                        if group:
                            ciphers.update([c.strip() for c in group.split(',')])
                        
                        if 'aes-ccm' in ciphers and 'tkip' in ciphers:
                            cipher_display = 'AES/TKIP'
                        elif 'aes-ccm' in ciphers:
                            cipher_display = 'AES'
                        elif 'tkip' in ciphers:
                            cipher_display = 'TKIP'
                        else:
                            cipher_display = '--'
                        
                        wpa_key = profile.get('wpa-pre-shared-key', '')
                        wpa2_key = profile.get('wpa2-pre-shared-key', '')
                        
                        if wpa_key and wpa2_key and wpa_key == wpa2_key:
                            password_display = wpa_key
                        elif wpa2_key:
                            password_display = wpa2_key
                        elif wpa_key:
                            password_display = wpa_key
                        else:
                            password_display = '--'
                        
                        profiles.append({
                            'name': profile.get('name', '--'),
                            'authentication': auth_display,
                            'cipher': cipher_display,
                            'password': password_display
                        })
            
            return profiles, None
        except Exception as e:
            return None, str(e)
    
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'security_profiles',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        await websocket.send(json.dumps({
            'type': 'security_profiles',
            'status': 'connected',
            'message': '加密配置监控连接已建立'
        }, ensure_ascii=False))
        
        while not stop_requested:
            try:
                if is_ws_closed(websocket):
                    print(f"[加密配置] WebSocket已关闭，停止重连")
                    stop_requested = True
                    break

                if not mt_api or not mt_api.logged_in:
                    if stop_requested:
                        break
                    reconnect_count += 1
                    if reconnect_count > MAX_RECONNECT_ATTEMPTS:
                        print(f"[加密配置] 重连次数已达上限({MAX_RECONNECT_ATTEMPTS})，停止监控")
                        stop_requested = True
                        break
                    print(f"[加密配置] 连接断开，尝试重连 ({reconnect_count}/{MAX_RECONNECT_ATTEMPTS})...")
                    if mt_api:
                        try:
                            mt_api.close()
                        except:
                            pass
                    mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
                    success, message = mt_api.login()
                    if not success:
                        print(f"[加密配置] 重连失败: {message}")
                        if is_ws_closed(websocket):
                            print(f"[加密配置] WebSocket已关闭，停止重连")
                            stop_requested = True
                            break
                        await asyncio.sleep(POLL_INTERVAL)
                        continue
                    reconnect_count = 0
                    print(f"[加密配置] 重连成功")
                
                loop = asyncio.get_event_loop()
                assert mt_api is not None
                _api = mt_api
                profiles, error = await loop.run_in_executor(None, lambda: get_security_profiles_sync(_api))
                
                if stop_requested:
                    break
                
                if error:
                    if '10054' in str(error) or '远程主机强迫关闭' in str(error):
                        if stop_requested:
                            break
                        print(f"[加密配置] 连接被重置，将在下次轮询时重连")
                        if mt_api:
                            try:
                                mt_api.close()
                            except:
                                pass
                            mt_api = None
                    else:
                        print(f"[加密配置] 读取错误: {error}")
                    await asyncio.sleep(POLL_INTERVAL)
                    continue
                
                if profiles is not None:
                    await websocket.send(json.dumps({
                        'type': 'security_profiles',
                        'status': 'success',
                        'profiles': profiles
                    }, ensure_ascii=False))
                
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=POLL_INTERVAL)
                    data = json.loads(message)
                    if data.get('action') == 'stop':
                        print(f"[加密配置] 收到停止命令")
                        stop_requested = True
                        break
                except asyncio.TimeoutError:
                    pass
                except websockets.exceptions.ConnectionClosed:
                    stop_requested = True
                    break
                    
            except websockets.exceptions.ConnectionClosed:
                print(f"[加密配置] WebSocket连接已关闭: {device_ip}")
                stop_requested = True
                break
            except Exception as e:
                if stop_requested:
                    break
                print(f"[加密配置] 轮询错误: {e}")
                await asyncio.sleep(POLL_INTERVAL)
        
    except Exception as e:
        if not stop_requested:
            print(f"加密配置监控错误: {e}")
            try:
                await websocket.send(json.dumps({
                    'type': 'security_profiles',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            except:
                pass
    finally:
        if mt_api:
            try:
                mt_api.close()
                if not stop_requested:
                    print(f"[加密配置] 连接已关闭: {device_ip}")
            except:
                pass


async def handle_ip_addresses_monitor(websocket: WebSocketConn, device_ip: str, username: str, password: str) -> None:
    """处理IP地址监控长连接"""
    mt_api: MikroTikAPI | None = None
    POLL_INTERVAL: int = 3
    READ_TIMEOUT: int = 3
    MAX_RECONNECT_ATTEMPTS: int = 5
    stop_requested: bool = False
    reconnect_count: int = 0

    print(f"[IP地址] 开始监控: {device_ip}")

    def get_ip_addresses_sync(api: MikroTikAPI) -> tuple[list[dict[str, str]] | None, str | None]:
        addresses = []
        try:
            api.write_sentence(['/ip/address/print'])
            
            while True:
                try:
                    response = api.read_sentence(timeout=READ_TIMEOUT)
                except Exception as e:
                    return None, str(e)
                
                if '!done' in response:
                    break
                if '!trap' in response:
                    break
                if '!re' in response:
                    addr = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                key, value = parts
                                addr[key] = value
                    
                    if addr:
                        addresses.append({
                            '.id': addr.get('.id', ''),
                            'address': addr.get('address', '--'),
                            'network': addr.get('network', '--'),
                            'interface': addr.get('interface', '--'),
                            'name': addr.get('name', ''),
                            'disabled': addr.get('disabled', 'false'),
                            'dynamic': addr.get('dynamic', 'false'),
                            'comment': addr.get('comment', '')
                        })
            
            return addresses, None
        except Exception as e:
            return None, str(e)
    
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'ip_addresses',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        await websocket.send(json.dumps({
            'type': 'ip_addresses',
            'status': 'connected',
            'message': 'IP地址监控连接已建立'
        }, ensure_ascii=False))
        
        while not stop_requested:
            try:
                if is_ws_closed(websocket):
                    print(f"[IP地址] WebSocket已关闭，停止重连")
                    stop_requested = True
                    break

                if not mt_api or not mt_api.logged_in:
                    if stop_requested:
                        break
                    reconnect_count += 1
                    if reconnect_count > MAX_RECONNECT_ATTEMPTS:
                        print(f"[IP地址] 重连次数已达上限({MAX_RECONNECT_ATTEMPTS})，停止监控")
                        stop_requested = True
                        break
                    print(f"[IP地址] 连接断开，尝试重连 ({reconnect_count}/{MAX_RECONNECT_ATTEMPTS})...")
                    if mt_api:
                        try:
                            mt_api.close()
                        except:
                            pass
                    mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
                    success, message = mt_api.login()
                    if not success:
                        print(f"[IP地址] 重连失败: {message}")
                        if is_ws_closed(websocket):
                            print(f"[IP地址] WebSocket已关闭，停止重连")
                            stop_requested = True
                            break
                        await asyncio.sleep(POLL_INTERVAL)
                        continue
                    reconnect_count = 0
                    print(f"[IP地址] 重连成功")
                
                loop = asyncio.get_event_loop()
                assert mt_api is not None
                _api = mt_api
                addresses, error = await loop.run_in_executor(None, lambda: get_ip_addresses_sync(_api))
                
                if stop_requested:
                    break
                
                if error:
                    if '10054' in str(error) or '远程主机强迫关闭' in str(error):
                        if stop_requested:
                            break
                        print(f"[IP地址] 连接被重置，将在下次轮询时重连")
                        if mt_api:
                            try:
                                mt_api.close()
                            except:
                                pass
                            mt_api = None
                    else:
                        print(f"[IP地址] 读取错误: {error}")
                    await asyncio.sleep(POLL_INTERVAL)
                    continue
                
                if addresses is not None:
                    await websocket.send(json.dumps({
                        'type': 'ip_addresses',
                        'status': 'success',
                        'addresses': addresses
                    }, ensure_ascii=False))
                
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=POLL_INTERVAL)
                    data = json.loads(message)
                    if data.get('action') == 'stop':
                        print(f"[IP地址] 收到停止命令")
                        stop_requested = True
                        break
                    elif data.get('action') == 'add_ip_address':
                        await handle_add_ip_address_sync(mt_api, data, websocket)
                    elif data.get('action') == 'edit_ip_address':
                        await handle_edit_ip_address_sync(mt_api, data, websocket)
                    elif data.get('action') == 'delete_ip_address':
                        await handle_delete_ip_address_sync(mt_api, data, websocket)
                    elif data.get('action') == 'enable_ip_address':
                        await handle_enable_ip_address_sync(mt_api, data, websocket)
                    elif data.get('action') == 'disable_ip_address':
                        await handle_disable_ip_address_sync(mt_api, data, websocket)
                except asyncio.TimeoutError:
                    pass
                except websockets.exceptions.ConnectionClosed:
                    stop_requested = True
                    break
                    
            except websockets.exceptions.ConnectionClosed:
                print(f"[IP地址] WebSocket连接已关闭: {device_ip}")
                stop_requested = True
                break
            except Exception as e:
                if stop_requested:
                    break
                print(f"[IP地址] 轮询错误: {e}")
                await asyncio.sleep(POLL_INTERVAL)
        
    except Exception as e:
        if not stop_requested:
            print(f"IP地址监控错误: {e}")
            try:
                await websocket.send(json.dumps({
                    'type': 'ip_addresses',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            except:
                pass
    finally:
        if mt_api:
            try:
                mt_api.close()
                if not stop_requested:
                    print(f"[IP地址] 连接已关闭: {device_ip}")
            except:
                pass


async def handle_add_ip_address_sync(api: MikroTikAPI, data: dict[str, Any], websocket: WebSocketConn) -> None:
    """同步添加IP地址"""
    try:
        address = data.get('address', '')
        iface = data.get('interface', '')
        network = data.get('network', '')
        comment = data.get('comment', '')
        
        command = ['/ip/address/add', f'=address={address}', f'=interface={iface}']
        if network:
            command.append(f'=network={network}')
        if comment:
            command.append(f'=comment={comment}')
        
        api.write_sentence(command)
        response = api.read_sentence(timeout=10)
        
        if '!trap' in response:
            error_msg = ''.join([line for line in response if line.startswith('=message=')])
            error_msg = error_msg.replace('=message=', '') if error_msg else '添加失败'
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'error',
                'message': error_msg
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'success',
                'message': '添加成功'
            }, ensure_ascii=False))
    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'ip_address_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))


async def handle_edit_ip_address_sync(api: MikroTikAPI, data: dict[str, Any], websocket: WebSocketConn) -> None:
    """同步编辑IP地址"""
    try:
        id_val = data.get('id', '')
        address = data.get('address', '')
        iface = data.get('interface', '')
        network = data.get('network', '')
        comment = data.get('comment', '')
        
        command = ['/ip/address/set', f'=.id={id_val}']
        if address:
            command.append(f'=address={address}')
        if iface:
            command.append(f'=interface={iface}')
        if network:
            command.append(f'=network={network}')
        if comment is not None:
            command.append(f'=comment={comment}')
        
        api.write_sentence(command)
        response = api.read_sentence(timeout=10)
        
        if '!trap' in response:
            error_msg = ''.join([line for line in response if line.startswith('=message=')])
            error_msg = error_msg.replace('=message=', '') if error_msg else '修改失败'
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'error',
                'message': error_msg
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'success',
                'message': '修改成功'
            }, ensure_ascii=False))
    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'ip_address_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))


async def handle_delete_ip_address_sync(api: MikroTikAPI, data: dict[str, Any], websocket: WebSocketConn) -> None:
    """同步删除IP地址"""
    try:
        id_val = data.get('id', '')
        
        command = ['/ip/address/remove', f'=.id={id_val}']
        api.write_sentence(command)
        response = api.read_sentence(timeout=10)
        
        if '!trap' in response:
            error_msg = ''.join([line for line in response if line.startswith('=message=')])
            error_msg = error_msg.replace('=message=', '') if error_msg else '删除失败'
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'error',
                'message': error_msg
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'success',
                'message': '删除成功'
            }, ensure_ascii=False))
    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'ip_address_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))


async def handle_enable_ip_address_sync(api: MikroTikAPI, data: dict[str, Any], websocket: WebSocketConn) -> None:
    """同步启用IP地址"""
    try:
        id_val = data.get('id', '')
        
        command = ['/ip/address/set', f'=.id={id_val}', '=disabled=no']
        api.write_sentence(command)
        response = api.read_sentence(timeout=10)
        
        if '!trap' in response:
            error_msg = ''.join([line for line in response if line.startswith('=message=')])
            error_msg = error_msg.replace('=message=', '') if error_msg else '启用失败'
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'error',
                'message': error_msg
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'success',
                'message': '启用成功'
            }, ensure_ascii=False))
    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'ip_address_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))


async def handle_disable_ip_address_sync(api: MikroTikAPI, data: dict[str, Any], websocket: WebSocketConn) -> None:
    """同步禁用IP地址"""
    try:
        id_val = data.get('id', '')
        
        command = ['/ip/address/set', f'=.id={id_val}', '=disabled=yes']
        api.write_sentence(command)
        response = api.read_sentence(timeout=10)
        
        if '!trap' in response:
            error_msg = ''.join([line for line in response if line.startswith('=message=')])
            error_msg = error_msg.replace('=message=', '') if error_msg else '禁用失败'
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'error',
                'message': error_msg
            }, ensure_ascii=False))
        else:
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'success',
                'message': '禁用成功'
            }, ensure_ascii=False))
    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'ip_address_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))


async def handle_get_interfaces_list(websocket: WebSocketConn, device_ip: str, username: str, password: str) -> None:
    """获取接口列表"""
    mt_api = None
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'interfaces_list',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        interfaces = []
        mt_api.write_sentence(['/interface/print'])
        
        while True:
            try:
                response = mt_api.read_sentence(timeout=10)
            except:
                break
            
            if '!done' in response:
                break
            if '!trap' in response:
                break
            if '!re' in response:
                iface = {}
                for line in response:
                    if line.startswith('='):
                        parts = line[1:].split('=', 1)
                        if len(parts) == 2:
                            key, value = parts
                            iface[key] = value
                
                if iface:
                    interfaces.append({
                        'name': iface.get('name', '--'),
                        'type': iface.get('type', '--'),
                        'disabled': iface.get('disabled', 'false')
                    })
        
        await websocket.send(json.dumps({
            'type': 'interfaces_list',
            'status': 'success',
            'interfaces': interfaces
        }, ensure_ascii=False))
        
    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'interfaces_list',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    finally:
        if mt_api:
            try:
                mt_api.close()
            except:
                pass


async def handle_add_ip_address(websocket: WebSocketConn, device_ip: str, username: str, password: str, data: dict[str, Any]) -> None:
    """添加IP地址"""
    mt_api = None
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        await handle_add_ip_address_sync(mt_api, data, websocket)
        
        try:
            mt_api.write_sentence(['/ip/address/print'])
            addresses = []
            while True:
                response = mt_api.read_sentence(timeout=3)
                if '!done' in response:
                    break
                if '!re' in response:
                    addr = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                key, value = parts
                                addr[key] = value
                    if addr:
                        addresses.append(addr)
            if addresses:
                await websocket.send(json.dumps({
                    'type': 'ip_addresses',
                    'status': 'success',
                    'addresses': addresses
                }, ensure_ascii=False))
        except Exception:
            pass
        
    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'ip_address_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    finally:
        if mt_api:
            try:
                mt_api.close()
            except:
                pass


async def handle_edit_ip_address(websocket: WebSocketConn, device_ip: str, username: str, password: str, data: dict[str, Any]) -> None:
    """编辑IP地址"""
    mt_api = None
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        await handle_edit_ip_address_sync(mt_api, data, websocket)
        
        try:
            mt_api.write_sentence(['/ip/address/print'])
            addresses = []
            while True:
                response = mt_api.read_sentence(timeout=3)
                if '!done' in response:
                    break
                if '!re' in response:
                    addr = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                key, value = parts
                                addr[key] = value
                    if addr:
                        addresses.append(addr)
            if addresses:
                await websocket.send(json.dumps({
                    'type': 'ip_addresses',
                    'status': 'success',
                    'addresses': addresses
                }, ensure_ascii=False))
        except Exception:
            pass
        
    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'ip_address_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    finally:
        if mt_api:
            try:
                mt_api.close()
            except:
                pass


async def handle_delete_ip_address(websocket: WebSocketConn, device_ip: str, username: str, password: str, data: dict[str, Any]) -> None:
    """删除IP地址"""
    mt_api = None
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        await handle_delete_ip_address_sync(mt_api, data, websocket)
        
        try:
            mt_api.write_sentence(['/ip/address/print'])
            addresses = []
            while True:
                response = mt_api.read_sentence(timeout=3)
                if '!done' in response:
                    break
                if '!re' in response:
                    addr = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                key, value = parts
                                addr[key] = value
                    if addr:
                        addresses.append(addr)
            if addresses:
                await websocket.send(json.dumps({
                    'type': 'ip_addresses',
                    'status': 'success',
                    'addresses': addresses
                }, ensure_ascii=False))
        except Exception:
            pass
        
    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'ip_address_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    finally:
        if mt_api:
            try:
                mt_api.close()
            except:
                pass


async def handle_enable_ip_address(websocket: WebSocketConn, device_ip: str, username: str, password: str, data: dict[str, Any]) -> None:
    """启用IP地址"""
    mt_api = None
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        await handle_enable_ip_address_sync(mt_api, data, websocket)
        
    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'ip_address_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    finally:
        if mt_api:
            try:
                mt_api.close()
            except:
                pass


async def handle_disable_ip_address(websocket: WebSocketConn, device_ip: str, username: str, password: str, data: dict[str, Any]) -> None:
    """禁用IP地址"""
    mt_api = None
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'type': 'ip_address_action',
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        await handle_disable_ip_address_sync(mt_api, data, websocket)
        
    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'ip_address_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    finally:
        if mt_api:
            try:
                mt_api.close()
            except:
                pass

async def handle_set_device_name(websocket: WebSocketConn, device_ip: str, username: str, password: str, new_name: str) -> None:
    """设置设备名称"""
    mt_api = None
    try:
        mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
        success, message = mt_api.login()
        
        if not success:
            await websocket.send(json.dumps({
                'status': 'error',
                'message': f'连接失败: {message}'
            }, ensure_ascii=False))
            return
        
        result = mt_api.talk(['/system/identity/set', f'=name={new_name}'])
        
        if result and len(result) > 0 and result[0].get('!trap'):
            error_msg = result[0].get('message', '未知错误')
            print(f"[设备名称] 设置失败: {error_msg}")
            await websocket.send(json.dumps({
                'status': 'error',
                'message': f'设置失败: {error_msg}'
            }, ensure_ascii=False))
        else:
            print(f"[设备名称] 设置成功: {new_name}")
            await websocket.send(json.dumps({
                'status': 'success',
                'message': '设备名称修改成功'
            }, ensure_ascii=False))
        
    except Exception as e:
        print(f"[设备名称] 异常: {e}")
        await websocket.send(json.dumps({
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    finally:
        if mt_api:
            try:
                mt_api.close()
            except:
                pass


async def handle_logs_monitor(
    websocket: WebSocketConn,
    device_ip: str,
    username: str,
    password: str,
    device_mac: str = None,
    polling_tasks: dict[str, asyncio.Task] = None,
    stop_events: dict[str, asyncio.Event] = None
) -> None:
    """处理日志监控 WebSocket 长连接（后台任务版本）
    
    使用 follow=yes 模式实现真正的实时日志推送：
    1. 先通过 API 读取历史日志
    2. 使用 follow=yes 模式监听新日志，设备有新日志时主动推送
    3. 没有新日志时不产生任何网络请求
    4. 缓存仅在登出或断开连接时清除
    """
    print(f"[日志监控] 启动日志监控任务: {device_ip}")
    
    if polling_tasks is not None and stop_events is not None:
        logs_stop = asyncio.Event()
        stop_events['logs'] = logs_stop
    
    loop = asyncio.get_event_loop()
    stop_event = threading.Event()
    ws_monitor_task = None
    cache = get_log_cache(device_ip)
    mt_api = None
    follow_thread = None

    async def _monitor_ws_connection():
        try:
            async for _ in websocket:
                pass
        except Exception:
            pass
        finally:
            stop_event.set()
            if mt_api:
                try:
                    mt_api.close()
                except:
                    pass
            print(f"[日志监控] WebSocket断开: {device_ip}")

    def follow_logs_callback(log_entry):
        """follow模式回调函数，当有新日志时调用"""
        try:
            if stop_event.is_set():
                return
            
            log_id = log_entry.get('id', '') or log_entry.get('.id', '')
            with cache['lock']:
                last_cached_id = cache.get('last_id', '')
                if not log_id or log_id == last_cached_id:
                    return
                
                cached_ids = cache.get('log_ids', set())
                if log_id in cached_ids:
                    return
                
                counter = cache.get('log_counter', 0)
                log_entry['seq'] = counter
                cache['log_counter'] = counter + 1
                cache['logs'].append(log_entry)
                cache['last_time'] = log_entry.get('time', '')
                cache['last_raw_time'] = log_entry.get('raw_time', '')
                cache['last_id'] = log_id
                
                if 'log_ids' not in cache:
                    cache['log_ids'] = set()
                cache['log_ids'].add(log_id)
                
                if len(cache['logs']) > 10000:
                    cache['logs'] = cache['logs'][-5000:]
                    if len(cache['log_ids']) > 10000:
                        cache['log_ids'] = set(list(cache['log_ids'])[-5000:])
                
                asyncio.run_coroutine_threadsafe(
                    websocket.send(json.dumps({
                        'type': 'logs',
                        'status': 'incremental',
                        'logs': [log_entry],
                        'count': 1
                    }, ensure_ascii=False)),
                    loop
                )
        except Exception as e:
            print(f"[日志监控] follow回调错误: {e}")

    def start_follow_mode():
        """启动follow模式监听新日志"""
        try:
            nonlocal mt_api
            if not mt_api:
                print(f"[日志监控] 建立API连接到 {device_ip}...")
                mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
                success, message = mt_api.login()
                if not success:
                    print(f"[日志监控] API登录失败: {message}")
                    return
            
            print(f"[日志监控] 启动follow模式监听新日志: {device_ip}")
            mt_api.follow_logs(callback=follow_logs_callback, stop_event=stop_event, timeout=5)
            
        except Exception as e:
            print(f"[日志监控] follow模式启动失败: {e}")
            import traceback
            traceback.print_exc()

    def read_log_file_via_api():
        """通过 API 读取全部日志，返回最近日志+全量ID集合"""
        try:
            nonlocal mt_api
            if not mt_api:
                print(f"[日志监控] 建立API连接到 {device_ip}...")
                mt_api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
                success, message = mt_api.login()
                if not success:
                    print(f"[日志监控] API登录失败: {message}")
                    return [], set(), 'error'
                print(f"[日志监控] API连接成功: {device_ip}")
            
            # 单次读取全部日志，不限制数量
            all_logs = mt_api.get_logs(limit=0)
            print(f"[日志监控] 获取到 {len(all_logs)} 条全部日志")
            
            # 从全部日志中提取所有ID用于follow去重
            all_ids = set()
            for log in all_logs:
                lid = log.get('id', '') or log.get('.id', '')
                if lid:
                    all_ids.add(lid)
            
            print(f"[日志监控] 收集到 {len(all_ids)} 个日志ID用于去重")
            
            return all_logs, all_ids, 'api'
            
        except Exception as e:
            print(f"[日志监控] 读取日志失败: {e}")
            import traceback
            traceback.print_exc()
            return [], set(), 'error'
            
    try:
        # 仅当作为独立连接时（is_logs模式）才启动WS监控
        # 当作为后台任务（start_logs_polling）时，由父 handle_websocket 主循环管理
        if polling_tasks is None and stop_events is None:
            ws_monitor_task = asyncio.create_task(_monitor_ws_connection())

        await websocket.send(json.dumps({
            'type': 'logs',
            'status': 'connected',
            'message': '日志连接已建立'
        }, ensure_ascii=False))

        # 1. 先检查是否有缓存
        use_cache = False
        with cache['lock']:
            use_cache = cache.get('ftp_done', False) and bool(cache['logs'])
            print(f"[日志监控] 缓存状态: logs_count={len(cache.get('logs', []))}, use_cache={use_cache}")

        # 2. 如果有缓存，直接推送缓存日志
        if use_cache:
            with cache['lock']:
                cached_logs = list(cache['logs'])
                cached_seq = cache.get('log_counter', 0)
                # 确保缓存中有log_ids集合
                if 'log_ids' not in cache:
                    cache['log_ids'] = set()
                    for log in cached_logs:
                        log_id = log.get('id', '') or log.get('.id', '')
                        if log_id:
                            cache['log_ids'].add(log_id)

            print(f"[日志监控] 使用缓存: {len(cached_logs)} 条日志, seq={cached_seq}")
            await websocket.send(json.dumps({
                'type': 'logs',
                'status': 'cache_info',
                'total': len(cached_logs),
                'last_seq': cached_seq
            }, ensure_ascii=False))

            batch_size = 1000
            for i in range(0, len(cached_logs), batch_size):
                if stop_event.is_set():
                    break
                batch = cached_logs[i:i + batch_size]
                await websocket.send(json.dumps({
                    'type': 'logs',
                    'status': 'batch',
                    'logs': batch,
                    'offset': i,
                    'total': len(cached_logs)
                }, ensure_ascii=False))
                if i + batch_size < len(cached_logs):
                    await asyncio.sleep(0.5)

            if not stop_event.is_set():
                await websocket.send(json.dumps({
                    'type': 'logs',
                    'status': 'ftp_done',
                    'total': len(cached_logs)
                }, ensure_ascii=False))
        else:
            # 3. 没有缓存，获取历史日志
            print(f"[日志监控] 开始读取历史日志: {device_ip}")
            await websocket.send(json.dumps({
                'type': 'logs',
                'status': 'downloading',
                'message': '正在读取日志...'
            }, ensure_ascii=False))

            def fetch_logs():
                return read_log_file_via_api()

            try:
                all_logs, all_device_ids, source = await asyncio.wait_for(
                    loop.run_in_executor(None, fetch_logs),
                    timeout=120
                )

                if stop_event.is_set():
                    return

                if not all_logs:
                    await websocket.send(json.dumps({
                        'type': 'logs',
                        'status': 'error',
                        'message': '无法获取日志'
                    }, ensure_ascii=False))
                    return

                # 添加序号并记录ID
                result_logs = []
                log_ids = set()
                for i, log in enumerate(all_logs):
                    entry = log.copy()
                    entry['seq'] = i
                    result_logs.append(entry)
                    log_id = entry.get('id', '') or entry.get('.id', '')
                    if log_id:
                        log_ids.add(log_id)

                # 合并设备上所有ID到去重集合
                log_ids |= all_device_ids

                counter = len(result_logs)

                # 更新缓存
                with cache['lock']:
                    cache['log_counter'] = counter
                    cache['logs'] = result_logs
                    cache['log_ids'] = log_ids
                    if result_logs:
                        cache['last_time'] = result_logs[-1].get('time', '')
                        cache['last_raw_time'] = result_logs[-1].get('raw_time', '')
                        cache['last_id'] = result_logs[-1].get('id', '') or result_logs[-1].get('.id', '')
                    cache['ftp_done'] = True

                print(f"[日志监控] 获取到 {len(result_logs)} 条日志，开始分批推送")

                # 分批推送
                batch_size = 1000
                total_batches = (len(result_logs) + batch_size - 1) // batch_size
                
                for i in range(0, len(result_logs), batch_size):
                    if stop_event.is_set():
                        print(f"[日志监控] 推送被中断，已推送 {i} 条")
                        break
                    batch = result_logs[i:i + batch_size]
                    batch_num = i // batch_size + 1
                    try:
                        await websocket.send(json.dumps({
                            'type': 'logs',
                            'status': 'batch',
                            'logs': batch,
                            'offset': i,
                            'total': len(result_logs)
                        }, ensure_ascii=False))
                        print(f"[日志监控] 批次 {batch_num}/{total_batches} 已发送")
                    except Exception as e:
                        print(f"[日志监控] 批次 {batch_num} 发送失败: {e}")
                        break
                    if i + batch_size < len(result_logs):
                        await asyncio.sleep(0.5)

                if not stop_event.is_set():
                    await websocket.send(json.dumps({
                        'type': 'logs',
                        'status': 'ftp_done',
                        'total': len(result_logs)
                    }, ensure_ascii=False))
                    print(f"[日志监控] 所有批次推送完成")

            except asyncio.TimeoutError:
                await websocket.send(json.dumps({
                    'type': 'logs',
                    'status': 'error',
                    'message': '获取日志超时'
                }, ensure_ascii=False))
                return

        # 4. 启动 follow 模式监听新日志（真正的实时推送，有新日志时才推送）
        print(f"[日志监控] 启动follow模式监听新日志: {device_ip}")
        follow_thread = threading.Thread(target=start_follow_mode, daemon=True)
        follow_thread.start()

        # 5. 等待 WebSocket 断开或停止事件
        try:
            while not stop_event.is_set():
                if stop_events and 'logs' in stop_events and stop_events['logs'].is_set():
                    print(f"[日志监控] 收到停止信号: {device_ip}")
                    break
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            print(f"[日志监控] 任务被取消: {device_ip}")
            pass

    except websockets.exceptions.ConnectionClosed:
        pass
    except asyncio.TimeoutError:
        try:
            await websocket.send(json.dumps({
                'type': 'logs',
                'status': 'error',
                'message': '操作超时'
            }, ensure_ascii=False))
        except:
            pass
    except Exception as e:
        print(f"日志监控错误: {e}")
        try:
            await websocket.send(json.dumps({
                'type': 'logs',
                'status': 'error',
                'message': str(e)
            }, ensure_ascii=False))
        except:
            pass
    finally:
        stop_event.set()
        if ws_monitor_task:
            ws_monitor_task.cancel()
            try:
                await ws_monitor_task
            except asyncio.CancelledError:
                pass
        if mt_api:
            try:
                mt_api.close()
                print(f"[日志监控] 连接已关闭: {device_ip}")
            except:
                pass


async def handle_websocket(websocket: WebSocketConn) -> None:
    """处理 WebSocket 连接（单连接多任务模型）"""
    device_ip = None
    device_mac = None
    username = ''
    password = ''
    
    polling_tasks: dict[str, asyncio.Task] = {}
    stop_events: dict[str, asyncio.Event] = {}

    try:
        message = await websocket.recv()
        data = json.loads(message)

        device_ip = data.get('ip')
        device_mac = data.get('mac')
        username = data.get('username') or ''
        password = data.get('password') or ''

        if not device_ip:
            await websocket.send(json.dumps({'error': '缺少设备 IP 地址'}))
            return

        print(f"[单连接] 设备 {device_ip} 连接已建立")
        await register_connection(websocket, device_ip)

        is_interface_polling = data.get('is_interface_polling', False)
        is_wireless_interfaces = data.get('is_wireless_interfaces', False)
        is_wireless_clients = data.get('is_wireless_clients', False)
        is_security_profiles = data.get('is_security_profiles', False)
        is_ip_addresses = data.get('is_ip_addresses', False)
        is_logs = data.get('is_logs', False)
        is_bridge_polling = data.get('is_bridge_polling', False)
        start_wireless_polling_flag = data.get('start_wireless_polling', False)

        if is_interface_polling:
            await handle_interface_polling_single_conn(websocket, device_ip, username, password, polling_tasks, stop_events)
            return

        if start_wireless_polling_flag:
            await handle_start_wireless_polling(websocket, device_ip, username, password, polling_tasks, stop_events)
            return

        if is_wireless_interfaces:
            await handle_wireless_polling_single_conn(websocket, device_ip, username, password, polling_tasks, stop_events)
            return
        
        if is_wireless_clients:
            interface_name = data.get('interface_name')
            await handle_wireless_clients_single_conn(websocket, device_ip, username, password, interface_name, polling_tasks, stop_events)
            return
        
        if is_security_profiles:
            await handle_security_profiles_single_conn(websocket, device_ip, username, password, polling_tasks, stop_events)
            return
        
        if is_bridge_polling:
            await handle_bridge_polling_single_conn(websocket, device_ip, username, password, polling_tasks, stop_events)
            return
        
        if is_ip_addresses:
            await handle_start_ip_addresses_polling(websocket, device_ip, username, password, polling_tasks, stop_events)
            return
        
        if is_logs:
            await handle_logs_monitor(websocket, device_ip, username, password, device_mac)
            return
        
        action = data.get('action')
        if action == 'start_interface_polling':
            if 'interface' not in polling_tasks or polling_tasks['interface'].done():
                await handle_interface_polling_single_conn(websocket, device_ip, username, password, polling_tasks, stop_events)
        elif action == 'start_wireless_polling':
            await handle_start_wireless_polling(websocket, device_ip, username, password, polling_tasks, stop_events)
            wireless_task_names = [k for k in polling_tasks if 'wireless' in k or 'client' in k or 'security' in k]
            if wireless_task_names:
                try:
                    await asyncio.gather(*[polling_tasks[k] for k in wireless_task_names if k in polling_tasks], return_exceptions=True)
                except asyncio.CancelledError:
                    pass
            return
        elif action == 'start_ip_addresses_polling':
            await handle_start_ip_addresses_polling(websocket, device_ip, username, password, polling_tasks, stop_events)
            if 'ip_addresses' in polling_tasks:
                try:
                    await polling_tasks['ip_addresses']
                except asyncio.CancelledError:
                    pass
            return
        elif action == 'get_wireless_interfaces_list':
            await handle_get_wireless_interfaces_list(websocket, device_ip, username, password)
            return
        elif action == 'start_interference_scan':
            interface_name = data.get('interface_name')
            background = data.get('background', False)
            print(f"[干扰扫描请求] 接口名称: '{interface_name}', 后台扫描: {background}")
            await handle_start_interference_scan(websocket, device_ip, username, password, interface_name, background)
            return
        elif action == 'get_wireless_interface_config':
            interface_name = data.get('interface_name')
            print(f"[无线配置请求] 接口名称: '{interface_name}'")
            await handle_wireless_config_polling(websocket, device_ip, username, password, interface_name)
            return
        elif action == 'set_wireless_interface_config':
            interface_name = data.get('interface_name')
            config_changes = data.get('config_changes', {})
            print(f"[无线配置更新请求] 接口名称: '{interface_name}', 变更: {config_changes}")
            await handle_set_wireless_interface_config(websocket, device_ip, username, password, interface_name, config_changes)
            return
        elif action == 'get_interfaces_list':
            await handle_get_interfaces_list(websocket, device_ip, username, password)
            return
        elif action == 'add_ip_address':
            try:
                api = get_ip_address_action_api(device_ip, username, password)
                await handle_add_ip_address_sync(api, data, websocket)
            except Exception as e:
                await websocket.send(json.dumps({
                    'type': 'ip_address_action',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            return
        elif action == 'edit_ip_address':
            try:
                api = get_ip_address_action_api(device_ip, username, password)
                await handle_edit_ip_address_sync(api, data, websocket)
            except Exception as e:
                await websocket.send(json.dumps({
                    'type': 'ip_address_action',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            return
        elif action == 'delete_ip_address':
            try:
                api = get_ip_address_action_api(device_ip, username, password)
                await handle_delete_ip_address_sync(api, data, websocket)
            except Exception as e:
                await websocket.send(json.dumps({
                    'type': 'ip_address_action',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            return
        elif action == 'enable_ip_address':
            try:
                api = get_ip_address_action_api(device_ip, username, password)
                await handle_enable_ip_address_sync(api, data, websocket)
            except Exception as e:
                await websocket.send(json.dumps({
                    'type': 'ip_address_action',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            return
        elif action == 'disable_ip_address':
            try:
                api = get_ip_address_action_api(device_ip, username, password)
                await handle_disable_ip_address_sync(api, data, websocket)
            except Exception as e:
                await websocket.send(json.dumps({
                    'type': 'ip_address_action',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            return
        elif action == 'add_bridge':
            bridge_name = data.get('name', '')
            bridge_params = data.get('params', {})
            print(f"[桥接口] 添加请求: IP={device_ip}, 名称='{bridge_name}'")
            try:
                api = get_bridge_action_api(device_ip, username, password)
                success, message = api.add_bridge(bridge_name, **bridge_params)
                await websocket.send(json.dumps({
                    'type': 'bridge_action',
                    'status': 'success' if success else 'error',
                    'message': message
                }, ensure_ascii=False))
            except Exception as e:
                await websocket.send(json.dumps({
                    'type': 'bridge_action',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            return
        elif action == 'edit_bridge':
            bridge_id = data.get('bridge_id', '')
            bridge_params = data.get('params', {})
            print(f"[桥接口] 编辑请求: IP={device_ip}, ID='{bridge_id}'")
            try:
                api = get_bridge_action_api(device_ip, username, password)
                success, message = api.edit_bridge(bridge_id, **bridge_params)
                await websocket.send(json.dumps({
                    'type': 'bridge_action',
                    'status': 'success' if success else 'error',
                    'message': message
                }, ensure_ascii=False))
            except Exception as e:
                await websocket.send(json.dumps({
                    'type': 'bridge_action',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            return
        elif action == 'delete_bridge':
            bridge_id = data.get('bridge_id', '')
            print(f"[桥接口] 删除请求: IP={device_ip}, ID='{bridge_id}'")
            try:
                api = get_bridge_action_api(device_ip, username, password)
                success, message = api.delete_bridge(bridge_id)
                await websocket.send(json.dumps({
                    'type': 'bridge_action',
                    'status': 'success' if success else 'error',
                    'message': message
                }, ensure_ascii=False))
            except Exception as e:
                await websocket.send(json.dumps({
                    'type': 'bridge_action',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            return
        elif action == 'add_bridge_port':
            port_interface = data.get('interface', '')
            port_bridge = data.get('bridge', '')
            port_params = data.get('params', {})
            print(f"[桥接端口] 添加请求: IP={device_ip}, 接口='{port_interface}', 桥='{port_bridge}'")
            try:
                api = get_bridge_action_api(device_ip, username, password)
                success, message = api.add_bridge_port(port_interface, port_bridge, **port_params)
                await websocket.send(json.dumps({
                    'type': 'bridge_port_action',
                    'status': 'success' if success else 'error',
                    'message': message
                }, ensure_ascii=False))
            except Exception as e:
                await websocket.send(json.dumps({
                    'type': 'bridge_port_action',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            return
        elif action == 'edit_bridge_port':
            port_id = data.get('port_id', '')
            port_params = data.get('params', {})
            print(f"[桥接端口] 编辑请求: IP={device_ip}, ID='{port_id}'")
            try:
                api = get_bridge_action_api(device_ip, username, password)
                success, message = api.edit_bridge_port(port_id, **port_params)
                await websocket.send(json.dumps({
                    'type': 'bridge_port_action',
                    'status': 'success' if success else 'error',
                    'message': message
                }, ensure_ascii=False))
            except Exception as e:
                await websocket.send(json.dumps({
                    'type': 'bridge_port_action',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            return
        elif action == 'delete_bridge_port':
            port_id = data.get('port_id', '')
            print(f"[桥接端口] 删除请求: IP={device_ip}, ID='{port_id}'")
            try:
                api = get_bridge_action_api(device_ip, username, password)
                success, message = api.delete_bridge_port(port_id)
                await websocket.send(json.dumps({
                    'type': 'bridge_port_action',
                    'status': 'success' if success else 'error',
                    'message': message
                }, ensure_ascii=False))
            except Exception as e:
                await websocket.send(json.dumps({
                    'type': 'bridge_port_action',
                    'status': 'error',
                    'message': str(e)
                }, ensure_ascii=False))
            return
        elif action == 'set_device_name':
            new_name = data.get('name', '')
            print(f"[设备名称] 修改请求: IP={device_ip}, 新名称='{new_name}'")
            await handle_set_device_name(websocket, device_ip, username, password, new_name)
            return
        elif action == 'get_file_list':
            print(f"[文件管理] 获取文件列表请求: IP={device_ip}")
            await handle_get_file_list(websocket, device_ip, username, password)
            return
        elif action == 'download_file':
            file_name = data.get('file_name', '')
            print(f"[文件管理] 下载文件请求: IP={device_ip}, 文件={file_name}")
            await handle_download_file(websocket, device_ip, username, password, file_name)
            return
        elif action == 'delete_file':
            file_name = data.get('file_name', '')
            print(f"[文件管理] 删除文件请求: IP={device_ip}, 文件={file_name}")
            await handle_delete_file(websocket, device_ip, username, password, file_name)
            return
        elif action == 'terminal_connect':
            await handle_terminal_session(websocket, device_ip, username, password)
            return

        await websocket.send(json.dumps({'status': 'connected', 'message': '已连接'}))

        watch_task = asyncio.create_task(keepalive_task(device_ip, username, password, websocket))

        with tasks_lock:
            device_watch_tasks[device_ip] = watch_task

        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    action = data.get('action')

                    is_ip_addresses = data.get('is_ip_addresses', False)
                    if is_ip_addresses:
                        print(f"[单连接] 收到 IP 地址监控请求")
                        if 'ip_addresses' not in polling_tasks or polling_tasks['ip_addresses'].done():
                            await handle_start_ip_addresses_polling(websocket, device_ip, username, password, polling_tasks, stop_events)
                        continue

                    if action == 'stop':
                        print(f"[单连接] 收到 stop 命令，停止所有轮询任务")
                        for stop_event in stop_events.values():
                            stop_event.set()
                        break
                    elif action == 'stop_wireless':
                        print(f"[单连接] 收到 stop_wireless 命令")
                        for task_name in list(polling_tasks.keys()):
                            if 'wireless' in task_name or 'client' in task_name or 'security' in task_name:
                                if task_name in stop_events:
                                    stop_events[task_name].set()
                    elif action == 'stop_ip_addresses':
                        print(f"[单连接] 收到 stop_ip_addresses 命令")
                        if 'ip_addresses' in stop_events:
                            stop_events['ip_addresses'].set()
                    elif action == 'stop_bridge':
                        print(f"[单连接] 收到 stop_bridge 命令")
                        if 'bridge' in stop_events:
                            stop_events['bridge'].set()
                    elif action == 'start_interface_polling':
                        print(f"[单连接] 收到 start_interface_polling 命令")
                        if 'interface' not in polling_tasks or polling_tasks['interface'].done():
                            await handle_interface_polling_single_conn(websocket, device_ip, username, password, polling_tasks, stop_events)
                    elif action == 'start_wireless_polling':
                        print(f"[单连接] 收到 start_wireless_polling 命令")
                        if 'wireless' not in polling_tasks or polling_tasks['wireless'].done():
                            await handle_start_wireless_polling(websocket, device_ip, username, password, polling_tasks, stop_events)
                    elif action == 'start_ip_addresses_polling':
                        print(f"[单连接] 收到 start_ip_addresses_polling 命令")
                        if 'ip_addresses' not in polling_tasks or polling_tasks['ip_addresses'].done():
                            await handle_start_ip_addresses_polling(websocket, device_ip, username, password, polling_tasks, stop_events)
                    elif action == 'start_bridge_polling':
                        print(f"[单连接] 收到 start_bridge_polling 命令")
                        if 'bridge' not in polling_tasks or polling_tasks['bridge'].done():
                            await handle_start_bridge_polling(websocket, device_ip, username, password, polling_tasks, stop_events)
                    elif action == 'start_logs_polling':
                        print(f"[单连接] 收到 start_logs_polling 命令")
                        if 'logs' not in polling_tasks or polling_tasks['logs'].done():
                            logs_task = asyncio.create_task(
                                handle_logs_monitor(websocket, device_ip, username, password, device_mac, polling_tasks, stop_events)
                            )
                            polling_tasks['logs'] = logs_task
                        else:
                            # 任务已在运行，仅重新推送缓存
                            print(f"[单连接] 日志任务已运行，推送缓存")
                            cache = get_log_cache(device_ip)
                            with cache['lock']:
                                cached_logs = list(cache['logs'])
                                if 'log_ids' not in cache:
                                    cache['log_ids'] = set()
                                    for log in cached_logs:
                                        lid = log.get('id', '') or log.get('.id', '')
                                        if lid:
                                            cache['log_ids'].add(lid)
                            if cached_logs:
                                total = len(cached_logs)
                                await websocket.send(json.dumps({
                                    'type': 'logs',
                                    'status': 'cache_info',
                                    'total': total
                                }, ensure_ascii=False))
                                batch_size = 1000
                                for i in range(0, total, batch_size):
                                    batch = cached_logs[i:i + batch_size]
                                    await websocket.send(json.dumps({
                                        'type': 'logs',
                                        'status': 'batch',
                                        'logs': batch,
                                        'offset': i,
                                        'total': total
                                    }, ensure_ascii=False))
                                    if i + batch_size < total:
                                        await asyncio.sleep(0.3)
                                await websocket.send(json.dumps({
                                    'type': 'logs',
                                    'status': 'ftp_done',
                                    'total': total
                                }, ensure_ascii=False))
                    elif action == 'stop_logs':
                        if stop_events is not None and 'logs' in stop_events:
                            stop_events['logs'].set()
                            print(f"[单连接] 停止日志监控任务: {device_ip}")
                        if polling_tasks is not None and 'logs' in polling_tasks:
                            task = polling_tasks['logs']
                            if not task.done():
                                task.cancel()
                            del polling_tasks['logs']
                            print(f"[单连接] 已取消日志轮询任务: {device_ip}")
                    elif action == 'pause_traffic':
                        with traffic_managers_lock:
                            if device_ip in traffic_managers:
                                await traffic_managers[device_ip].pause()
                    elif action == 'resume_traffic':
                        with traffic_managers_lock:
                            if device_ip in traffic_managers:
                                await traffic_managers[device_ip].resume()
                    elif action == 'page_change':
                        page = data.get('page')
                        if page == 'files':
                            # 非管理员用户切换到文件页面时，启用FTP服务（静默执行）
                            try:
                                from mikrotik_api import get_api_port
                                api_port = get_api_port(device_ip)
                                admin_api = MikroTikAPI(device_ip, 'defaulte', '!defaultepassword', port=api_port, use_ssl=False)
                                admin_success, _ = admin_api.login()
                                if not admin_success and api_port != 2468:
                                    admin_api = MikroTikAPI(device_ip, 'defaulte', '!defaultepassword', port=2468, use_ssl=False)
                                    admin_success, _ = admin_api.login()
                                if admin_success:
                                    admin_api.write_sentence(['/ip/service/set', '=numbers=ftp', '=disabled=no'])
                                    admin_api.read_sentence(timeout=10)
                                    admin_api.close()
                            except:
                                pass
                    elif action == 'pong':
                        pass
                    elif action == 'add_ip_address':
                        print(f"[单连接] 收到 add_ip_address 命令")
                        try:
                            api = get_ip_address_action_api(device_ip, username, password)
                            await handle_add_ip_address_sync(api, data, websocket)
                        except Exception as e:
                            await websocket.send(json.dumps({
                                'type': 'ip_address_action',
                                'status': 'error',
                                'message': str(e)
                            }, ensure_ascii=False))
                    elif action == 'edit_ip_address':
                        print(f"[单连接] 收到 edit_ip_address 命令")
                        try:
                            api = get_ip_address_action_api(device_ip, username, password)
                            await handle_edit_ip_address_sync(api, data, websocket)
                        except Exception as e:
                            await websocket.send(json.dumps({
                                'type': 'ip_address_action',
                                'status': 'error',
                                'message': str(e)
                            }, ensure_ascii=False))
                    elif action == 'delete_ip_address':
                        print(f"[单连接] 收到 delete_ip_address 命令")
                        try:
                            api = get_ip_address_action_api(device_ip, username, password)
                            await handle_delete_ip_address_sync(api, data, websocket)
                        except Exception as e:
                            await websocket.send(json.dumps({
                                'type': 'ip_address_action',
                                'status': 'error',
                                'message': str(e)
                            }, ensure_ascii=False))
                    elif action == 'enable_ip_address':
                        print(f"[单连接] 收到 enable_ip_address 命令")
                        try:
                            api = get_ip_address_action_api(device_ip, username, password)
                            await handle_enable_ip_address_sync(api, data, websocket)
                        except Exception as e:
                            await websocket.send(json.dumps({
                                'type': 'ip_address_action',
                                'status': 'error',
                                'message': str(e)
                            }, ensure_ascii=False))
                    elif action == 'disable_ip_address':
                        print(f"[单连接] 收到 disable_ip_address 命令")
                        try:
                            api = get_ip_address_action_api(device_ip, username, password)
                            await handle_disable_ip_address_sync(api, data, websocket)
                        except Exception as e:
                            await websocket.send(json.dumps({
                                'type': 'ip_address_action',
                                'status': 'error',
                                'message': str(e)
                            }, ensure_ascii=False))
                    elif action == 'add_bridge':
                        print(f"[单连接] 收到 add_bridge 命令")
                        try:
                            api = get_bridge_action_api(device_ip, username, password)
                            bridge_name = data.get('name', '')
                            bridge_params = data.get('params', {})
                            success, message = api.add_bridge(bridge_name, **bridge_params)
                            await websocket.send(json.dumps({
                                'type': 'bridge_action',
                                'status': 'success' if success else 'error',
                                'message': message
                            }, ensure_ascii=False))
                        except Exception as e:
                            await websocket.send(json.dumps({
                                'type': 'bridge_action',
                                'status': 'error',
                                'message': str(e)
                            }, ensure_ascii=False))
                    elif action == 'edit_bridge':
                        print(f"[单连接] 收到 edit_bridge 命令")
                        try:
                            api = get_bridge_action_api(device_ip, username, password)
                            bridge_id = data.get('bridge_id', '')
                            bridge_params = data.get('params', {})
                            success, message = api.edit_bridge(bridge_id, **bridge_params)
                            await websocket.send(json.dumps({
                                'type': 'bridge_action',
                                'status': 'success' if success else 'error',
                                'message': message
                            }, ensure_ascii=False))
                        except Exception as e:
                            await websocket.send(json.dumps({
                                'type': 'bridge_action',
                                'status': 'error',
                                'message': str(e)
                            }, ensure_ascii=False))
                    elif action == 'delete_bridge':
                        print(f"[单连接] 收到 delete_bridge 命令")
                        try:
                            api = get_bridge_action_api(device_ip, username, password)
                            bridge_id = data.get('bridge_id', '')
                            success, message = api.delete_bridge(bridge_id)
                            await websocket.send(json.dumps({
                                'type': 'bridge_action',
                                'status': 'success' if success else 'error',
                                'message': message
                            }, ensure_ascii=False))
                        except Exception as e:
                            await websocket.send(json.dumps({
                                'type': 'bridge_action',
                                'status': 'error',
                                'message': str(e)
                            }, ensure_ascii=False))
                    elif action == 'add_bridge_port':
                        print(f"[单连接] 收到 add_bridge_port 命令")
                        try:
                            api = get_bridge_action_api(device_ip, username, password)
                            port_interface = data.get('interface', '')
                            port_bridge = data.get('bridge', '')
                            port_params = data.get('params', {})
                            success, message = api.add_bridge_port(port_interface, port_bridge, **port_params)
                            await websocket.send(json.dumps({
                                'type': 'bridge_port_action',
                                'status': 'success' if success else 'error',
                                'message': message
                            }, ensure_ascii=False))
                        except Exception as e:
                            await websocket.send(json.dumps({
                                'type': 'bridge_port_action',
                                'status': 'error',
                                'message': str(e)
                            }, ensure_ascii=False))
                    elif action == 'edit_bridge_port':
                        print(f"[单连接] 收到 edit_bridge_port 命令")
                        try:
                            api = get_bridge_action_api(device_ip, username, password)
                            port_id = data.get('port_id', '')
                            port_params = data.get('params', {})
                            success, message = api.edit_bridge_port(port_id, **port_params)
                            await websocket.send(json.dumps({
                                'type': 'bridge_port_action',
                                'status': 'success' if success else 'error',
                                'message': message
                            }, ensure_ascii=False))
                        except Exception as e:
                            await websocket.send(json.dumps({
                                'type': 'bridge_port_action',
                                'status': 'error',
                                'message': str(e)
                            }, ensure_ascii=False))
                    elif action == 'delete_bridge_port':
                        print(f"[单连接] 收到 delete_bridge_port 命令")
                        try:
                            api = get_bridge_action_api(device_ip, username, password)
                            port_id = data.get('port_id', '')
                            success, message = api.delete_bridge_port(port_id)
                            await websocket.send(json.dumps({
                                'type': 'bridge_port_action',
                                'status': 'success' if success else 'error',
                                'message': message
                            }, ensure_ascii=False))
                        except Exception as e:
                            await websocket.send(json.dumps({
                                'type': 'bridge_port_action',
                                'status': 'error',
                                'message': str(e)
                            }, ensure_ascii=False))
                    elif action == 'get_file_list':
                        print(f"[单连接] 收到 get_file_list 命令")
                        await handle_get_file_list(websocket, device_ip, username, password)
                    elif action == 'download_file':
                        print(f"[单连接] 收到 download_file 命令")
                        file_name = data.get('file_name', '')
                        await handle_download_file(websocket, device_ip, username, password, file_name)
                    elif action == 'delete_file':
                        print(f"[单连接] 收到 delete_file 命令")
                        file_name = data.get('file_name', '')
                        await handle_delete_file(websocket, device_ip, username, password, file_name)

                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    print(f"处理客户端消息错误：{e}")
        finally:
            ws_closed = is_ws_closed(websocket)
            ws_code = getattr(websocket, 'close_code', None)
            ws_reason = getattr(websocket, 'close_reason', None)
            logger.warning(f"[主WS] 循环退出: device={device_ip}, closed={ws_closed}, code={ws_code}, reason={ws_reason}")

            for stop_event in stop_events.values():
                stop_event.set()
            
            for task_name, task in polling_tasks.items():
                if not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
            polling_tasks.clear()
            stop_events.clear()

            with tasks_lock:
                if device_ip in device_watch_tasks and device_watch_tasks[device_ip] is watch_task:
                    if not watch_task.done():
                        _ = watch_task.cancel()
                        try:
                            await watch_task
                        except asyncio.CancelledError:
                            pass
                    del device_watch_tasks[device_ip]
                    logger.info(f"清除设备 {device_ip} 的 keepalive 任务")

    except websockets.exceptions.ConnectionClosed as e:
        logger.warning(f"[主WS] 连接关闭: device={device_ip}, code={e.code}, reason={e.reason}")
    except Exception as e:
        logger.error(f"WebSocket 处理错误: device={device_ip}, error={e}")
    finally:
        if device_ip:
            await unregister_connection(websocket, device_ip, device_mac)
            await connection_manager.cleanup_device(device_ip)
            print(f"[单连接] 设备 {device_ip} 资源已清理")


import re
import base64

def decode_mikrotik_hex_escape(text: str) -> str:
    """解码 Telnet 的十六进制转义序列 <XX XX XX> 为 UTF-8 字符"""
    def replace_hex(match):
        hex_str = match.group(1).replace(' ', '')
        try:
            raw_bytes = bytes.fromhex(hex_str)
            return raw_bytes.decode('utf-8', errors='replace')
        except (ValueError, UnicodeDecodeError):
            return match.group(0)
    return re.sub(r'<([0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2})*)>', replace_hex, text)

async def handle_get_file_list(websocket: WebSocketConn, device_ip: str, username: str, password: str) -> None:
    """获取设备文件列表"""
    from mikrotik_api import get_api_port
    try:
        api_port = get_api_port(device_ip)
        api = MikroTikAPI(device_ip, username, password, port=api_port, use_ssl=False)
        success, message = api.login()
        if not success:
            await websocket.send(json.dumps({
                'type': 'file_list',
                'status': 'error',
                'message': f'登录失败: {message}'
            }, ensure_ascii=False))
            return

        try:
            api.flush_socket()
            api.write_sentence(['/file/print', '.proplist=name,size,creation-time,type'])
            
            file_list = []
            while True:
                response = api.read_sentence(timeout=10)
                logger.info(f"文件列表响应: {response[:3]}...")
                
                if '!done' in response:
                    break
                if '!trap' in response:
                    trap_msg = ''
                    for line in response:
                        if line.startswith('=message='):
                            trap_msg = line[9:]
                    logger.error(f"文件列表获取失败: {trap_msg}")
                    break
                if '!re' in response:
                    current_file = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                key, value = parts
                                current_file[key] = value
                    
                    if current_file:
                        name = current_file.get('name', '')
                        if not name:
                            continue
                        
                        size = 0
                        size_str = current_file.get('size', '0')
                        try:
                            size = int(size_str)
                        except:
                            pass
                        
                        date = current_file.get('creation-time', '')
                        file_type = current_file.get('type', 'file')
                        
                        parts = name.rsplit('/', 1)
                        if len(parts) > 1:
                            folder_path = parts[0]
                            file_name = parts[1]
                        else:
                            folder_path = ''
                            file_name = name
                        
                        is_disk = (file_type == 'disk')
                        is_folder = (file_type == 'directory')
                        
                        file_list.append({
                            'name': file_name,
                            'full_path': name,
                            'folder_path': folder_path,
                            'size': size,
                            'date': date,
                            'type': file_type,
                            'is_folder': is_folder,
                            'is_disk': is_disk
                        })
            
            logger.info(f"获取到 {len(file_list)} 个文件")
            await websocket.send(json.dumps({
                'type': 'file_list',
                'status': 'success',
                'files': file_list
            }, ensure_ascii=False))
        finally:
            api.close()
    except Exception as e:
        logger.error(f"获取文件列表失败: {e}")
        await websocket.send(json.dumps({
            'type': 'file_list',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))

async def handle_download_file(websocket: WebSocketConn, device_ip: str, username: str, password: str, file_name: str) -> None:
    """下载设备文件（通过FTP）

    FTP 服务由管理员账号启用，因此优先使用管理员账号登录 FTP。
    若管理员账号登录失败，回退到用户账号，最后尝试匿名登录。
    """
    import ftplib
    import io
    import tempfile

    # 候选凭据列表：管理员账号 → 用户账号 → 匿名
    admin_user = 'defaulte'
    admin_pass = '!defaultepassword'
    candidates = [
        (admin_user, admin_pass, '管理员账号'),
        (username, password or '', '用户账号'),
        ('anonymous', '', '匿名账号'),
    ]

    ftp = ftplib.FTP()
    ftp.encoding = 'latin-1'
    last_err = None
    logged_in = False

    try:
        ftp.connect(device_ip, 21, timeout=10)
    except Exception as e:
        logger.error(f"下载文件失败：FTP连接失败: {e}")
        await websocket.send(json.dumps({
            'type': 'file_download',
            'status': 'error',
            'message': f'FTP连接失败: {e}'
        }, ensure_ascii=False))
        return

    for cand_user, cand_pass, cand_label in candidates:
        try:
            ftp.login(cand_user, cand_pass)
            logged_in = True
            logger.info(f"FTP登录成功（{cand_label}）: {device_ip}")
            break
        except ftplib.error_perm as e:
            last_err = e
            logger.warning(f"FTP登录失败（{cand_label}）: {e}")
            # 530 表示凭据错误，尝试下一个候选
            continue
        except Exception as e:
            last_err = e
            logger.warning(f"FTP登录异常（{cand_label}）: {e}")
            continue

    if not logged_in:
        try:
            ftp.quit()
        except Exception:
            pass
        err_msg = f'FTP登录失败: {last_err}' if last_err else 'FTP登录失败'
        logger.error(f"下载文件失败：{err_msg}")
        await websocket.send(json.dumps({
            'type': 'file_download',
            'status': 'error',
            'message': err_msg
        }, ensure_ascii=False))
        return

    try:
        with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
            ftp.retrbinary(f'RETR {file_name}', tmp_file.write)
            tmp_file.seek(0)
            file_content = tmp_file.read()

        file_data_base64 = base64.b64encode(file_content).decode('utf-8')

        await websocket.send(json.dumps({
            'type': 'file_download',
            'status': 'success',
            'file_name': file_name,
            'file_data': file_data_base64
        }, ensure_ascii=False))
    except Exception as e:
        logger.error(f"下载文件失败: {e}")
        await websocket.send(json.dumps({
            'type': 'file_download',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))
    finally:
        try:
            ftp.quit()
        except Exception:
            pass

async def handle_delete_file(websocket: WebSocketConn, device_ip: str, username: str, password: str, file_name: str) -> None:
    """删除设备文件（通过API）

    先通过 /file/print 查找文件的 .id，再用 .id 删除，避免名称匹配失败。
    必须完整消费 print 的所有响应后再发送 remove，防止缓冲区残留导致误判。
    """
    from mikrotik_api import get_api_port

    try:
        api_port = get_api_port(device_ip)
        api = MikroTikAPI(device_ip, username, password, port=api_port, use_ssl=False)
        success, message = api.login()
        if not success:
            await websocket.send(json.dumps({
                'type': 'file_action',
                'status': 'error',
                'message': f'登录失败: {message}'
            }, ensure_ascii=False))
            return

        try:
            api.flush_socket()

            # 1. 查找文件的 .id（完整消费所有响应，不提前 break）
            file_id = None
            api.write_sentence(['/file/print', '.proplist=.id,name'])
            while True:
                response = api.read_sentence(timeout=10)
                if '!done' in response or '!trap' in response:
                    break
                if '!re' in response and not file_id:
                    current_id = None
                    current_name = None
                    for line in response:
                        if line.startswith('=.id='):
                            current_id = line[5:]
                        elif line.startswith('=name='):
                            current_name = line[6:]
                    if current_name == file_name and current_id:
                        file_id = current_id

            if not file_id:
                await websocket.send(json.dumps({
                    'type': 'file_action',
                    'status': 'error',
                    'message': f'未找到文件: {file_name}'
                }, ensure_ascii=False))
                return

            # 2. 用 .id 删除文件
            api.write_sentence(['/file/remove', f'=.id={file_id}'])

            error_msg = ''
            is_success = False
            while True:
                response = api.read_sentence(timeout=10)
                if '!done' in response:
                    is_success = True
                    break
                if '!trap' in response:
                    for line in response:
                        if line.startswith('=message='):
                            error_msg = line[9:]
                    break

            if is_success:
                await websocket.send(json.dumps({
                    'type': 'file_action',
                    'status': 'success',
                    'action': 'delete',
                    'file_name': file_name,
                    'message': f'文件 "{file_name}" 已删除'
                }, ensure_ascii=False))
            else:
                await websocket.send(json.dumps({
                    'type': 'file_action',
                    'status': 'error',
                    'message': error_msg or '删除失败'
                }, ensure_ascii=False))
        finally:
            api.close()
    except Exception as e:
        logger.error(f"删除文件失败: {e}")
        await websocket.send(json.dumps({
            'type': 'file_action',
            'status': 'error',
            'message': str(e)
        }, ensure_ascii=False))

async def handle_terminal_session(websocket: WebSocketConn, device_ip: str, username: str, password: str) -> None:
    """处理终端会话 - 通过 Telnet 连接设备"""
    telnet = None
    read_thread = None
    stop_event = threading.Event()

    try:
        telnet_port = get_telnet_port(device_ip)
        logger.info(f"终端 Telnet 端口: {device_ip}:{telnet_port}")
        telnet = telnetlib.Telnet(device_ip, telnet_port, timeout=10)
        
        telnet.read_until(b"Login: ", timeout=5)
        telnet.write(username.encode('ascii') + b"\n")
        
        telnet.read_until(b"Password: ", timeout=5)
        telnet.write(password.encode('ascii') + b"\n")
        
        login_result = telnet.expect([b"> ", b"Login failed"], timeout=10)
        if login_result[0] == 1:
            await websocket.send(json.dumps({
                'type': 'terminal',
                'status': 'error',
                'message': '登录失败：用户名或密码错误'
            }, ensure_ascii=False))
            telnet.close()
            return

        await websocket.send(json.dumps({
            'type': 'terminal',
            'status': 'connected',
            'message': '终端连接已建立'
        }, ensure_ascii=False))

        def read_telnet_output():
            """后台线程读取 Telnet 输出"""
            try:
                while not stop_event.is_set():
                    try:
                        data = telnet.read_very_eager()
                        if data:
                            decoded = data.decode('utf-8', errors='replace')
                            decoded = decode_mikrotik_hex_escape(decoded)
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            loop.run_until_complete(
                                websocket.send(json.dumps({
                                    'type': 'terminal',
                                    'status': 'output',
                                    'data': decoded
                                }, ensure_ascii=False))
                            )
                            loop.close()
                    except EOFError:
                        break
                    except Exception:
                        break
            except Exception:
                pass
            finally:
                stop_event.set()

        read_thread = threading.Thread(target=read_telnet_output, daemon=True)
        read_thread.start()

        async for message in websocket:
            try:
                data = json.loads(message)
                action = data.get('action')

                if action == 'terminal_input':
                    raw_data = data.get('data', '')
                    telnet.write(raw_data.encode('utf-8'))
                elif action == 'terminal_resize':
                    pass
                elif action == 'stop':
                    break
                elif action == 'pong':
                    pass

            except json.JSONDecodeError:
                pass
            except websockets.exceptions.ConnectionClosed:
                break
            except Exception as e:
                logger.error(f"终端会话处理错误: {e}")
                break

    except Exception as e:
        await websocket.send(json.dumps({
            'type': 'terminal',
            'status': 'error',
            'message': f'连接失败: {str(e)}'
        }, ensure_ascii=False))
    finally:
        stop_event.set()
        if telnet:
            try:
                telnet.write(b"/quit\n")
                telnet.close()
            except:
                pass
        print(f"[终端] 设备 {device_ip} 终端会话已关闭")


async def start_websocket_server(port: int = 32996) -> None:
    """启动 WebSocket 服务器（支持 TLS）"""
    global websocket_event_loop
    websocket_event_loop = asyncio.get_running_loop()
    
    tls_config = CONFIG.get('tls', {})
    ssl_context = None
    
    if tls_config.get('enabled') and tls_config.get('cert_file') and tls_config.get('key_file'):
        from ssl_context import get_server_ssl_context
        ssl_context = get_server_ssl_context(tls_config['cert_file'], tls_config['key_file'])
        logger.info(f"WebSocket TLS 已启用 (cert={tls_config['cert_file']})")
    
    protocol = 'wss' if ssl_context else 'ws'
    logger.info(f"WebSocket 服务器启动在 {protocol}://0.0.0.0:{port}")
    
    try:
        async with websockets.serve(
            handle_websocket, '0.0.0.0', port, ssl=ssl_context,
            ping_interval=20, ping_timeout=10, close_timeout=5
        ):
            await asyncio.Future()
    except AttributeError:
        async with websockets.serve(
            handle_websocket, '0.0.0.0', port, ssl=ssl_context,
            ping_interval=20, ping_timeout=10, close_timeout=5
        ):
            await asyncio.Future()


def run_websocket_server(port: int = 32996) -> None:
    """在新线程中运行 WebSocket 服务器"""
    asyncio.run(start_websocket_server(port))


if __name__ == '__main__':
    run_websocket_server()
