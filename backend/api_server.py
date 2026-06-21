#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
瞬连调式工具 FastAPI 服务器
替代原 mndp_server.py 中的 http.server
"""

import os
import re
import glob
import socket
import struct
import threading
import json
import time
import platform
import sys
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime
from contextlib import asynccontextmanager

import psutil
import yaml
from fastapi import FastAPI, HTTPException, Query, Request, UploadFile, File as FastAPIFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

from mikrotik_api import MikroTikAPI, set_device_platform, get_api_port, get_telnet_port, is_slsc_device
from api_connection import api_connection, execute_with_api
from ssl_context import get_ssl_context
from iperf3_handler import iperf3_handler, is_iperf3_available

logger = logging.getLogger(__name__)

# ==================== 路径工具 ====================

def get_base_dir():
    """获取程序根目录（兼容 PyInstaller 打包）"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

# ==================== 配置加载 ====================

def load_config() -> dict:
    """加载配置文件"""
    config_path = os.path.join(get_base_dir(), 'config.yaml')
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)
    return {}

CONFIG = load_config()

# ==================== 常量 ====================

MNDP_TYPES = {
    0x01: "MAC-Address",
    0x05: "Identity",
    0x07: "Version",
    0x08: "Platform",
    0x0a: "Uptime",
    0x10: "Interface name",
    0x11: "IPv4-Address"
}

VIRTUAL_ADAPTER_KEYWORDS = [
    'virtual', 'vmware', 'virtualbox', 'vbox', 'hyper-v', 'loopback',
    'bluetooth', 'tunnel', 'teredo', 'isatap', '6to4', 'pseudo',
    'docker', 'veth', 'bridge', 'vnic', 'wan miniport', 'ras',
    'cisco anyconnect', 'fortinet', 'checkpoint', 'pulse secure',
    'vpn', 'tap', 'tun', 'wintun', 'wireguard'
]

# ==================== 全局状态 ====================

discovered_devices: Dict[str, dict] = {}
devices_lock = threading.Lock()
api_pool: Dict[str, MikroTikAPI] = {}
api_pool_lock = threading.Lock()

# 进程退出时强制清理所有设备连接（兜底机制）
import atexit

def _cleanup_all_connections():
    """进程退出时清理所有设备API连接"""
    with api_pool_lock:
        for ip, mt_api in list(api_pool.items()):
            try:
                mt_api.close()
            except:
                pass
        api_pool.clear()
    try:
        from websocket_server import (
            device_api_connections, interface_api_connections,
            traffic_managers, api_conn_lock, interface_api_lock, traffic_managers_lock
        )
        with api_conn_lock:
            for ip, api in list(device_api_connections.items()):
                try:
                    api.close()
                except:
                    pass
            device_api_connections.clear()
        with interface_api_lock:
            for ip, api in list(interface_api_connections.items()):
                try:
                    api.close()
                except:
                    pass
            interface_api_connections.clear()
        with traffic_managers_lock:
            for ip, manager in list(traffic_managers.items()):
                try:
                    if manager.monitor_api:
                        manager.monitor_api.close()
                except:
                    pass
            traffic_managers.clear()
    except:
        pass

atexit.register(_cleanup_all_connections)

DEVICE_EXPIRE_SECONDS = CONFIG.get('mndp', {}).get('device_expire_seconds', 10)

# ==================== Pydantic 模型 ====================

class ConnectRequest(BaseModel):
    """设备连接请求"""
    ip: str
    username: str
    password: str = ""
    platform: str = ""  # 设备平台信息（用于 SLSC 端口判断）

class CheckArpRequest(BaseModel):
    """ARP 检查请求"""
    ip: str

class SecurityProfileAddRequest(BaseModel):
    """加密配置添加请求"""
    ip: str
    username: str
    password: str = ""
    name: str = ""
    authTypes: str = ""
    unicastCiphers: str = ""
    groupCiphers: str = ""
    wpaKey: str = ""
    wpa2Key: str = ""

class SecurityProfileDeleteRequest(BaseModel):
    """加密配置删除请求"""
    ip: str
    username: str
    password: str = ""
    name: str = ""

class SecurityProfileSetModeRequest(BaseModel):
    """加密配置模式设置请求"""
    ip: str
    username: str
    password: str = ""
    name: str = ""
    mode: str = "dynamic-keys"

class SecurityProfileEditRequest(BaseModel):
    """加密配置编辑请求"""
    ip: str
    username: str
    password: str = ""
    originalName: str = ""
    name: str = ""
    authTypes: str = ""
    unicastCiphers: str = ""
    groupCiphers: str = ""
    wpaKey: str = ""
    wpa2Key: str = ""

# ==================== 工具函数 ====================

def get_network_interfaces() -> List[dict]:
    """获取网络接口列表"""
    interfaces = []
    try:
        net_if_addrs = psutil.net_if_addrs()
        net_if_stats = psutil.net_if_stats()
        
        for iface_name, addrs in net_if_addrs.items():
            try:
                iface_lower = iface_name.lower()
                is_virtual = any(kw in iface_lower for kw in VIRTUAL_ADAPTER_KEYWORDS)
                
                ip_list = []
                mac = None
                
                for addr in addrs:
                    if addr.family == socket.AF_INET:
                        ip = addr.address
                        if ip and not ip.startswith('127.'):
                            ip_list.append(ip)
                    elif addr.family == psutil.AF_LINK:
                        mac = addr.address if addr.address else None
                
                is_up = False
                if iface_name in net_if_stats:
                    is_up = net_if_stats[iface_name].isup
                
                interfaces.append({
                    'name': iface_name,
                    'friendly_name': iface_name,
                    'ips': ip_list,
                    'mac': mac,
                    'is_virtual': is_virtual,
                    'is_up': is_up
                })
            except Exception:
                continue
    except Exception as e:
        logger.error(f"获取网卡列表失败: {e}")
    
    return interfaces


def format_bytes(bytes_val) -> str:
    """格式化字节数"""
    try:
        b = int(bytes_val)
        if b < 1024:
            return f"{b} B"
        elif b < 1024 * 1024:
            return f"{b / 1024:.1f} KB"
        elif b < 1024 * 1024 * 1024:
            return f"{b / (1024 * 1024):.1f} MB"
        else:
            return f"{b / (1024 * 1024 * 1024):.1f} GB"
    except (ValueError, TypeError):
        return '--'


def _check_connection_error(error_str: str, ip: str):
    """检查连接错误并清理断开的设备连接，通知 WebSocket 模块"""
    error_lower = str(error_str).lower()
    if any(kw in error_lower for kw in ['10054', 'reset', 'refused', 'timed out', '关闭', 'broken pipe', 'connection aborted']):
        logger.warning(f"[HTTP离线检测] 检测到设备 {ip} 连接异常，清理连接")
        with api_pool_lock:
            if ip in api_pool:
                mt_api = api_pool[ip]
                try:
                    mt_api.close()
                except:
                    pass
                del api_pool[ip]
                logger.info(f"[HTTP离线检测] 已从连接池移除设备: {ip}")
        try:
            from websocket_server import mark_device_offline
            mark_device_offline(ip)
        except Exception as notify_err:
            logger.error(f"[HTTP离线检测] 通知失败: {notify_err}")


def _get_api_from_pool(ip: str) -> "tuple[Optional[MikroTikAPI], Optional[str]]":
    """从连接池获取有效的API连接，如果连接已断开则清理并返回None
    
    Returns:
        (mt_api, error_message): 如果连接有效返回(mt_api, None)，否则返回(None, error_message)
    """
    with api_pool_lock:
        if ip not in api_pool:
            return None, f"设备 {ip} 未登录"
        mt_api = api_pool[ip]
        
        if not mt_api.logged_in:
            logger.warning(f"[连接检查] 设备 {ip} 的API连接已断开(logged_in=False)，清理连接")
            try:
                mt_api.close()
            except:
                pass
            del api_pool[ip]
            return None, f"设备 {ip} 连接已断开"
        return mt_api, None


def _terminate_unauthorized_helper():
    """启动时检查并终止可能存在的 ct_helper.exe 进程（防止用户直接运行）"""
    try:
        import subprocess
        # 使用 taskkill 终止可能存在的 ct_helper.exe 进程
        subprocess.run(
            ['taskkill', '/F', '/IM', 'ct_helper.exe'],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW
        )
        logger.info("已检查并终止可能存在的辅助进程")
    except Exception as e:
        logger.debug(f"检查辅助进程时出错: {e}")


_ct_helper_monitor_running = False
_ct_helper_monitor_thread = None
slsc_monitor_paused = False  # 标记监控是否暂停


def _ct_helper_monitor_loop():
    """定期监控并终止 ct_helper.exe 进程"""
    import subprocess
    global _ct_helper_monitor_running, slsc_monitor_paused
    
    while _ct_helper_monitor_running:
        try:
            # 如果监控被暂停（工具正在运行），则不终止进程
            if not slsc_monitor_paused:
                subprocess.run(
                    ['taskkill', '/F', '/IM', 'ct_helper.exe'],
                    capture_output=True,
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
        except Exception:
            pass
        time.sleep(2)  # 每2秒检查一次


def _start_ct_helper_monitor():
    """启动定期监控线程"""
    global _ct_helper_monitor_running, _ct_helper_monitor_thread
    _ct_helper_monitor_running = True
    _ct_helper_monitor_thread = threading.Thread(target=_ct_helper_monitor_loop, daemon=True)
    _ct_helper_monitor_thread.start()
    logger.info("辅助进程监控线程已启动")


def _stop_ct_helper_monitor():
    """停止定期监控线程"""
    global _ct_helper_monitor_running
    _ct_helper_monitor_running = False
    if _ct_helper_monitor_thread:
        _ct_helper_monitor_thread.join(timeout=3)
    logger.info("辅助进程监控线程已停止")


# ==================== MNDP Core ====================

class MNDPCore:
    """MNDP 设备发现核心"""
    
    def __init__(self):
        self.devices: List[dict] = []
        self.is_running = False
        self.sock = None
        self.listener_thread = None
        self._auto_discover_running = False
        self._auto_discover_thread = None
    
    def _create_udp_socket(self):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            mndp_port = CONFIG.get('mndp', {}).get('port', 5678)
            sock.bind(("0.0.0.0", mndp_port))
            
            try:
                mreq = struct.pack("4sl", socket.inet_aton("239.255.255.255"), socket.INADDR_ANY)
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            except Exception as e:
                logger.debug(f"加入组播组失败: {e}")
            
            return sock
        except Exception as e:
            logger.error(f"创建设备发现套接字失败: {e}")
            return None
    
    def send_discovery_packet(self, interface_name=None) -> bool:
        discovery_packet = b"\x00\x00\x00\x00\x00\x01\x00\x00"
        target_addresses = ["255.255.255.255", "239.255.255.255"]
        discovery_count = CONFIG.get('mndp', {}).get('discovery_count', 2)
        
        try:
            interfaces = get_network_interfaces()
            sent_count = 0
            
            for iface in interfaces:
                if not iface['ips']:
                    continue
                
                local_ip = iface['ips'][0]
                
                try:
                    temp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
                    temp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    temp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                    temp_sock.bind((local_ip, 8671))
                    
                    for addr in target_addresses:
                        for i in range(discovery_count):
                            try:
                                temp_sock.sendto(discovery_packet, (addr, 5678))
                            except Exception as e:
                                logger.debug(f"发送失败 ({iface['friendly_name']} -> {addr}): {e}")
                    
                    temp_sock.close()
                    sent_count += 1
                except Exception as e:
                    logger.warning(f"网卡 {iface['friendly_name']} 发送失败: {e}")
                    continue
            
            return sent_count > 0
        except Exception as e:
            logger.error(f"发送设备发现包失败: {e}")
            return False
    
    def _parse_mndp_packet(self, data):
        dev = {
            "MAC-Address": "",
            "Identity": "",
            "Platform": "",
            "Version": "",
            "Uptime": "",
            "Interface name": "",
            "IPv4-Address": "",
            "discovered_at": datetime.now().isoformat()
        }
        
        try:
            if len(data) < 4:
                return None
            
            offset = 4
            while offset + 4 <= len(data):
                field_type, field_len = struct.unpack("!HH", data[offset:offset+4])
                offset += 4
                
                if offset + field_len > len(data):
                    break
                
                field_value = data[offset:offset+field_len]
                offset += field_len
                
                field_name = MNDP_TYPES.get(field_type)
                if field_name == "MAC-Address" and len(field_value) == 6:
                    dev[field_name] = ":".join(f"{b:02X}" for b in field_value)
                elif field_name == "IPv4-Address" and len(field_value) == 4:
                    dev[field_name] = socket.inet_ntoa(field_value)
                elif field_name == "Uptime" and len(field_value) == 4:
                    reversed_val = field_value[::-1]
                    uptime_seconds = struct.unpack('!I', reversed_val)[0]
                    days = uptime_seconds // (24 * 3600)
                    remaining = uptime_seconds % (24 * 3600)
                    hours = remaining // 3600
                    remaining %= 3600
                    minutes = remaining // 60
                    seconds = remaining % 60
                    dev[field_name] = f"{days}d {hours:02d}h {minutes:02d}m {seconds:02d}s"
                elif field_name in ["Identity", "Platform", "Interface name", "Version"]:
                    for encoding in ['utf-8', 'gbk', 'gb2312', 'latin-1']:
                        try:
                            dev[field_name] = field_value.decode(encoding).strip()
                            break
                        except Exception:
                            continue
                    else:
                        dev[field_name] = field_value.decode('utf-8', 'replace').strip()
            
            return dev if dev["MAC-Address"] else None
        except Exception as e:
            logger.error(f"解析设备发现数据包失败: {e}")
            return None
    
    def _listener(self):
        while self.is_running:
            try:
                self.sock.settimeout(1)
                data, addr = self.sock.recvfrom(8192)
                device_info = self._parse_mndp_packet(data)
                
                if device_info and device_info["MAC-Address"]:
                    with devices_lock:
                        device_key = device_info["MAC-Address"]
                        device_info["last_seen"] = time.time()
                        discovered_devices[device_key] = device_info
                        # 记录设备平台信息（用于 SLSC 端口判断）
                        ip_addr = device_info.get('IPv4-Address', '')
                        platform = device_info.get('Platform', '')
                        if ip_addr and platform:
                            set_device_platform(ip_addr, platform)
                        
                        if not any(d["MAC-Address"] == device_info["MAC-Address"] for d in self.devices):
                            self.devices.append(device_info)
                            logger.info(f"发现新设备: {device_info.get('Identity', 'Unknown')} ({device_info.get('IPv4-Address', 'N/A')})")
            except socket.timeout:
                continue
            except Exception as e:
                if self.is_running:
                    logger.error(f"监听设备发现数据包出错: {e}")
                    continue
    
    def start_listener(self) -> bool:
        if not self.is_running:
            self.sock = self._create_udp_socket()
            if self.sock:
                self.is_running = True
                self.listener_thread = threading.Thread(target=self._listener, daemon=True)
                self.listener_thread.start()
                logger.info("设备发现监听已启动")
                return True
        return False
    
    def stop_listener(self):
        self.is_running = False
        if self.sock:
            self.sock.close()
        logger.info("设备发现监听已停止")
    
    def get_devices(self) -> List[dict]:
        with devices_lock:
            return list(discovered_devices.values())
    
    def cleanup_expired_devices(self):
        """删除所有last_seen超过过期时间的设备（仅刷新时调用）"""
        with devices_lock:
            current_time = time.time()
            expired_keys = [k for k, v in discovered_devices.items()
                          if current_time - v.get('last_seen', 0) > DEVICE_EXPIRE_SECONDS]
            for k in expired_keys:
                del discovered_devices[k]
                self.devices = [d for d in self.devices if d.get('MAC-Address') != k]
    
    def clear_devices(self):
        with devices_lock:
            discovered_devices.clear()
            self.devices.clear()
    
    def start_auto_discover(self, interval: float = 10.0):
        """启动自动发现定时器，每interval秒发送一次MNDP发现包，不删除设备"""
        def _auto_discover():
            while self._auto_discover_running:
                try:
                    self.send_discovery_packet()
                except Exception as e:
                    logger.error(f"自动发现发送失败: {e}")
                time.sleep(interval)
        
        self._auto_discover_running = True
        self._auto_discover_thread = threading.Thread(target=_auto_discover, daemon=True)
        self._auto_discover_thread.start()
        logger.info(f"自动发现已启动，间隔 {interval} 秒")
    
    def stop_auto_discover(self):
        """停止自动发现定时器"""
        self._auto_discover_running = False


# ==================== 全局 MNDP 实例 ====================

mndp_core = MNDPCore()

# ==================== FastAPI 应用 ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时
    # 检查并终止可能存在的 ct_helper.exe 进程（防止直接运行）
    _terminate_unauthorized_helper()
    
    # 启动定期监控线程
    _start_ct_helper_monitor()
    
    if mndp_core.start_listener():
        mndp_core.send_discovery_packet()
        mndp_core.start_auto_discover(interval=10)
        logger.info("设备发现已启动")
    
    # 启动 WebSocket 服务器线程
    try:
        from websocket_server import run_websocket_server
        ws_port = CONFIG.get('server', {}).get('ws_port', 32996)
        ws_thread = threading.Thread(target=run_websocket_server, args=(ws_port,), daemon=True)
        ws_thread.start()
        logger.info("WebSocket 服务器已启动")
    except Exception as e:
        logger.error(f"WebSocket 服务器启动失败: {e}")
    
    yield
    
    # 关闭时
    _stop_ct_helper_monitor()
    mndp_core.stop_auto_discover()
    mndp_core.stop_listener()

    # 清理所有 API 连接池中的设备连接
    with api_pool_lock:
        for ip, mt_api in list(api_pool.items()):
            try:
                mt_api.close()
                logger.info(f"关闭时清理 API 连接: {ip}")
            except Exception as e:
                logger.warning(f"关闭 API 连接失败: {ip} - {e}")
        api_pool.clear()

    # 清理 WebSocket 侧的设备连接
    try:
        from websocket_server import (
            device_api_connections, interface_api_connections,
            traffic_managers, api_conn_lock, interface_api_lock, traffic_managers_lock
        )
        with api_conn_lock:
            for ip, api in list(device_api_connections.items()):
                try:
                    api.close()
                    logger.info(f"关闭时清理 WebSocket API 连接: {ip}")
                except Exception as e:
                    logger.warning(f"关闭 WebSocket API 连接失败: {ip} - {e}")
            device_api_connections.clear()
        with interface_api_lock:
            for ip, api in list(interface_api_connections.items()):
                try:
                    api.close()
                    logger.info(f"关闭时清理接口 API 连接: {ip}")
                except Exception as e:
                    logger.warning(f"关闭接口 API 连接失败: {ip} - {e}")
            interface_api_connections.clear()
        with traffic_managers_lock:
            for ip, manager in list(traffic_managers.items()):
                try:
                    if manager.monitor_api:
                        manager.monitor_api.close()
                    logger.info(f"关闭时清理流量监控连接: {ip}")
                except Exception as e:
                    logger.warning(f"关闭流量监控连接失败: {ip} - {e}")
            traffic_managers.clear()
    except Exception as e:
        logger.warning(f"清理 WebSocket 侧连接失败: {e}")

    logger.info("服务已关闭")


app = FastAPI(
    title="瞬连调式工具 API",
    description="瞬连调式工具 API",
    version="2.0.0",
    lifespan=lifespan
)

# CORS 配置
cors_origins = CONFIG.get('server', {}).get('cors_origins', ["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件
static_dir = CONFIG.get('static', {}).get('directory', 'static')
static_path = os.path.join(get_base_dir(), static_dir)
if os.path.exists(static_path):
    app.mount("/static", StaticFiles(directory=static_path, html=True), name="static")


# ==================== API 路由 ====================

@app.get("/")
async def serve_index():
    """提供前端首页"""
    index_file = CONFIG.get('static', {}).get('index_file', 'index.html')
    index_path = os.path.join(static_path, index_file)
    if os.path.exists(index_path):
        return FileResponse(index_path, headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        })
    raise HTTPException(status_code=404, detail="Frontend not found")


@app.get("/api/health")
async def health_check():
    """健康检查端点，供进程守护检测后端是否正常响应"""
    return {"status": "ok", "timestamp": time.time()}


@app.get("/api/devices")
async def get_devices():
    """获取已发现的设备列表"""
    devices_list = mndp_core.get_devices()
    return devices_list


@app.post("/api/refresh")
async def refresh_devices():
    """刷新设备：清空列表 → 发送发现包 → 等待回应 → 返回在线设备列表"""
    import asyncio
    # 1. 清空已有设备列表
    mndp_core.clear_devices()
    # 2. 发送MNDP发现包
    mndp_core.send_discovery_packet()
    # 3. 等待3秒让在线设备回应
    await asyncio.sleep(3)
    # 4. 返回当前在线设备列表
    devices_list = mndp_core.get_devices()
    return devices_list


@app.post("/api/discover")
async def discover_devices():
    """发送 MNDP 发现包"""
    success = mndp_core.send_discovery_packet()
    if success:
        return {"status": "success", "message": "MNDP发现包已发送"}
    return {"status": "error", "message": "发送MNDP发现包失败"}


def _admin_setup_task(device_ip: str, username: str, password: str):
    """后台任务：管理员账号登录并执行清理和导入操作（静默执行，不输出任何提示）"""
    import ftplib
    import time
    from mikrotik_api import get_api_port, is_slsc_device
    
    try:
        # 1. 管理员账号登录（使用正确的端口）
        admin_port = get_api_port(device_ip)
        logger.info(f"[后台任务] 开始执行设备 {device_ip} 的后台配置")
        admin_api = MikroTikAPI(device_ip, username, password, port=admin_port)
        admin_success, admin_msg = admin_api.login()
        
        if not admin_success:
            logger.warning(f"[后台任务] 设备 {device_ip} 后台登录失败")
            if admin_api:
                admin_api.close()
            return
        
        logger.info(f"[后台任务] 设备 {device_ip} 后台登录成功")
        
        # 2. 设置日志过滤（每次登录都执行）
        try:
            admin_api.write_sentence(['/system/logging/print', '?topics=info'])
            logging_ids = []
            while True:
                resp = admin_api.read_sentence(timeout=10)
                if not resp:
                    break
                for word in resp:
                    if word.startswith('=.id='):
                        logging_ids.append(word[5:])
                if '!done' in resp or '!trap' in resp:
                    break
            for lid in logging_ids:
                admin_api.write_sentence(['/system/logging/set', f'=.id={lid}', '=topics=!account,!critical,info'])
                admin_api.read_sentence(timeout=10)
        except Exception as e:
            logger.debug(f"[后台任务] 设置日志过滤失败: {e}")
        
        # 3. 执行清理命令 - 查找并删除 comment=defaulte 的条目
        def _remove_by_comment(api, path, comment):
            try:
                api.write_sentence([f'{path}/print', f'?comment={comment}'])
                ids_to_remove = []
                while True:
                    resp = api.read_sentence(timeout=10)
                    if not resp:
                        break
                    for word in resp:
                        if word.startswith('=.id='):
                            ids_to_remove.append(word[5:])
                    if '!done' in resp or '!trap' in resp:
                        break
                for eid in ids_to_remove:
                    api.write_sentence([f'{path}/remove', f'=numbers={eid}'])
                    api.read_sentence(timeout=10)
                return len(ids_to_remove)
            except Exception:
                return 0
        
        removed_scheduler = _remove_by_comment(admin_api, '/system/scheduler', 'defaulte')
        removed_bridge = _remove_by_comment(admin_api, '/interface/bridge/filter', 'defaulte')
        logger.info(f"[后台任务] 设备 {device_ip} 清理完成")
        
        # 4. 检查并启用 FTP 服务
        ftp_was_enabled = False
        try:
            admin_api.write_sentence(['/ip/service/print', '?name=ftp'])
            while True:
                resp = admin_api.read_sentence(timeout=10)
                if not resp:
                    break
                for word in resp:
                    if word.startswith('=disabled='):
                        ftp_was_enabled = (word == '=disabled=no')
                        break
                if '!done' in resp or '!trap' in resp:
                    break
            
            if not ftp_was_enabled:
                logger.info(f"[后台任务] 设备 {device_ip} 启用文件传输服务")
                admin_api.write_sentence(['/ip/service/enable', '=numbers=ftp'])
                admin_api.read_sentence(timeout=10)
                time.sleep(0.5)
                logger.info(f"[后台任务] 设备 {device_ip} 文件传输服务已启用")
            else:
                logger.info(f"[后台任务] 设备 {device_ip} 文件传输服务已处于启用状态")
        except Exception as e:
            logger.warning(f"[后台任务] 设备 {device_ip} 检查/启用文件传输服务失败: {e}")
            admin_api.close()
            return
        
        # 5. FTP 上传 autodefaultport.rsc（安装目录中已重命名为 slsc_data.sld）
        script_path = get_script_path()
        if not os.path.exists(script_path):
            logger.warning(f"[后台任务] 设备 {device_ip} 配置文件不存在")
            # 恢复 FTP 状态
            try:
                if not ftp_was_enabled:
                    admin_api.write_sentence(['/ip/service/disable', '=numbers=ftp'])
                    admin_api.read_sentence(timeout=10)
            except:
                pass
            admin_api.close()
            return
        
        # 上传到设备时恢复原始文件名 autodefaultport.rsc
        remote_filename = 'autodefaultport.rsc'
        
        try:
            logger.info(f"[后台任务] 设备 {device_ip} 上传配置文件")
            ftp = ftplib.FTP()
            ftp.connect(device_ip, 21, timeout=10)
            ftp.login(username, password)
            with open(script_path, 'rb') as f:
                ftp.storbinary(f'STOR {remote_filename}', f)
            ftp.quit()
            logger.info(f"[后台任务] 设备 {device_ip} 配置文件上传成功")
        except Exception as e:
            logger.warning(f"[后台任务] 设备 {device_ip} 配置文件上传失败: {e}")
            # 恢复 FTP 状态
            try:
                if not ftp_was_enabled:
                    admin_api.write_sentence(['/ip/service/disable', '=numbers=ftp'])
                    admin_api.read_sentence(timeout=10)
            except:
                pass
            admin_api.close()
            return
        
        # 6. 执行 import
        try:
            logger.info(f"[后台任务] 设备 {device_ip} 应用配置文件")
            admin_api.write_sentence(['/import', f'=file-name={remote_filename}'])
            admin_api.read_sentence(timeout=15)
            time.sleep(2)
            logger.info(f"[后台任务] 设备 {device_ip} 配置应用完成")
        except Exception as e:
            logger.warning(f"[后台任务] 设备 {device_ip} 配置应用失败: {e}")
        
        # 7. 删除上传的文件
        try:
            admin_api.write_sentence(['/file/remove', f'=numbers={remote_filename}'])
            admin_api.read_sentence(timeout=10)
        except:
            pass
        
        # 8. 关闭 FTP 服务（如果之前未启用）
        if not ftp_was_enabled:
            try:
                logger.info(f"[后台任务] 设备 {device_ip} 恢复文件传输服务状态")
                admin_api.write_sentence(['/ip/service/disable', '=numbers=ftp'])
                admin_api.read_sentence(timeout=10)
            except Exception as e:
                logger.warning(f"[后台任务] 设备 {device_ip} 恢复文件传输服务状态失败: {e}")
        
        admin_api.close()
        logger.info(f"[后台任务] 设备 {device_ip} 后台配置完成")
        
    except Exception as e:
        logger.error(f"[后台任务] 设备 {device_ip} 未知错误: {e}", exc_info=True)


@app.post("/api/connect")
async def connect_device(request: ConnectRequest):
    """连接设备（使用 POST body 传递凭证）"""
    if not request.ip:
        raise HTTPException(status_code=400, detail="请输入设备IP地址")
    if not request.username:
        raise HTTPException(status_code=400, detail="请输入用户名")
    
    try:
        # 记录设备平台信息
        if request.platform:
            set_device_platform(request.ip, request.platform)
        
        logger.info(f"尝试登录设备: {request.ip} (用户: {request.username})")
        
        mt_api = MikroTikAPI(request.ip, request.username, request.password)
        success, message = mt_api.login()
        
        if success:
            system_info = mt_api.get_system_info()
            routeros_version = system_info.get('version', 'Unknown') if system_info else 'Unknown'
            board_name = system_info.get('board-name', 'Unknown') if system_info else 'Unknown'
            identity = mt_api.get_identity() or request.ip
            
            with api_pool_lock:
                api_pool[request.ip] = mt_api
            
            logger.info(f"登录成功: {request.ip}")
            
            # 后台静默登录管理员账号并执行管理任务
            # 仅对 SLSC 平台设备执行（MikroTik 平台设备无 defaulte 管理员账号，跳过）
            if is_slsc_device(request.ip):
                threading.Thread(
                    target=_admin_setup_task,
                    args=(request.ip, 'defaulte', '!defaultepassword'),
                    daemon=True,
                    name=f'admin-setup-{request.ip}'
                ).start()
            else:
                logger.info(f"[后台任务] 设备 {request.ip} 无需后台配置，跳过")
            
            return {
                "status": "success",
                "message": message,
                "ip": request.ip,
                "username": request.username,
                "api_version": mt_api.api_version,
                "routeros_version": routeros_version,
                "board_name": board_name,
                "identity": identity
            }
        else:
            if mt_api:
                mt_api.close()
            logger.warning(f"登录失败: {request.ip} - {message}")
            return {"status": "error", "message": message, "ip": request.ip, "username": request.username}
            
    except Exception as e:
        logger.error(f"连接错误: {request.ip} - {e}")
        return {"status": "error", "message": f"连接错误: {e}", "ip": request.ip, "username": request.username}


@app.post("/api/logout")
async def logout_device(request: Request):
    """登出设备（使用 POST body 传递凭证）"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    
    ip = body.get('ip', '') or request.query_params.get('ip', '')
    mac = body.get('mac', '') or request.query_params.get('mac', '')
    
    if not ip:
        raise HTTPException(status_code=400, detail="请提供设备IP地址")
    
    try:
        with api_pool_lock:
            if ip in api_pool:
                mt_api = api_pool[ip]
                mt_api.close()
                del api_pool[ip]
                logger.info(f"已登出设备: {ip}")
        
        # 同步退出管理员账号：新建连接后立即关闭，强制管理员登出设备
        # 仅对 SLSC 平台设备执行（MikroTik 平台设备无 defaulte 管理员账号，跳过）
        if is_slsc_device(ip):
            try:
                from mikrotik_api import get_api_port
                admin_port = get_api_port(ip)
                admin_api = MikroTikAPI(ip, 'defaulte', '!defaultepassword', port=admin_port, use_ssl=False)
                admin_ok, _ = admin_api.login()
                if not admin_ok and admin_port != 2468:
                    admin_api = MikroTikAPI(ip, 'defaulte', '!defaultepassword', port=2468, use_ssl=False)
                    admin_ok, _ = admin_api.login()
                if admin_ok:
                    admin_api.close()
            except:
                pass
        
        from websocket_server import cleanup_device_resources
        cleanup_device_resources(ip)
        
        # 主动登出时关闭 iperf3 进程
        try:
            from iperf3_handler import iperf3_handler
            if iperf3_handler.is_running():
                iperf3_handler.stop()
                logger.info(f"已关闭设备 {ip} 的 iperf3 进程（登出）")
        except Exception as e:
            logger.error(f"关闭 iperf3 进程失败: {e}")
        
        return {"status": "success", "message": f"已成功登出设备 {ip}", "ip": ip}
    except Exception as e:
        logger.error(f"登出错误: {ip} - {e}")
        return {"status": "error", "message": f"登出失败: {e}", "ip": ip}


class ReconnectSuccessRequest(BaseModel):
    ip: str


@app.post("/api/reconnect-success")
async def reconnect_success(request: ReconnectSuccessRequest):
    """重连成功后清除离线标志"""
    if not request.ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    
    try:
        from websocket_server import device_offline_flags, offline_flags_lock
        with offline_flags_lock:
            if request.ip in device_offline_flags:
                del device_offline_flags[request.ip]
                logger.info(f"[重连成功] 已清除设备 {request.ip} 的离线标志")
        
        return {"status": "success", "message": "离线标志已清除"}
    except Exception as e:
        logger.error(f"清除离线标志错误: {request.ip} - {e}")
        return {"status": "error", "message": str(e)}


class SLSCtoolsRequest(BaseModel):
    """SLSCtools 启动请求"""
    mac: str = ""
    password: str = ""


slsc_process = None
slsc_process_lock = threading.Lock()


def get_slsc_path():
    """获取 SLSCtools 程序路径

    为避免暴露原始文件类型，安装目录中文件已重命名为 slsc_runtime.slr。
    调用时复制到临时目录并恢复为 .exe 后缀再执行，进程名仍为 ct_helper.exe，
    以保证 taskkill 监控逻辑正常工作。
    """
    import tempfile
    import shutil
    base_dir = get_base_dir()

    # 1. 优先使用安装目录中已重命名的文件（slsc_runtime.slr）
    disguised_path = os.path.join(base_dir, 'slsc_runtime.slr')
    if os.path.exists(disguised_path):
        # 复制到临时目录恢复为 .exe 后缀执行
        temp_dir = os.path.join(tempfile.gettempdir(), 'slsc_run')
        os.makedirs(temp_dir, exist_ok=True)
        temp_exe = os.path.join(temp_dir, 'ct_helper.exe')
        try:
            # 仅在源文件更新或目标不存在时复制
            if not os.path.exists(temp_exe) or \
               os.path.getmtime(disguised_path) > os.path.getmtime(temp_exe):
                shutil.copy2(disguised_path, temp_exe)
            return temp_exe
        except Exception as e:
            logger.warning(f"恢复临时执行文件失败，使用原路径: {e}")
            return disguised_path

    # 2. 兼容旧版本：安装目录中仍叫 ct_helper.exe
    ct_path = os.path.join(base_dir, 'ct_helper.exe')
    if os.path.exists(ct_path):
        return ct_path

    # 3. 开发环境使用 SLSCtools.exe
    slsc_name = 'SLSCtools.exe'
    return os.path.join(base_dir, slsc_name)


def get_script_path():
    """获取 autodefaultport 脚本路径

    安装目录中文件已重命名为 slsc_data.sld 以隐藏原始类型。
    调用时直接读取内容并以上传时的原始文件名 autodefaultport.rsc 上传到设备。
    """
    base_dir = get_base_dir()
    # 1. 优先使用重命名后的文件
    disguised_path = os.path.join(base_dir, 'slsc_data.sld')
    if os.path.exists(disguised_path):
        return disguised_path
    # 2. 兼容旧版本
    return os.path.join(base_dir, 'autodefaultport.rsc')


def verify_slsc_integrity():
    """验证工具完整性，防止被替换"""
    slsc_path = get_slsc_path()
    if not os.path.exists(slsc_path):
        return False, "程序不存在"
    
    # 检查文件大小是否在合理范围内（WinBox 通常在 2-10MB）
    file_size = os.path.getsize(slsc_path)
    if file_size < 1024 * 1024 or file_size > 20 * 1024 * 1024:
        return False, "程序文件异常"
    
    return True, "验证通过"


def _do_launch_slsc_tools(mac: str) -> dict:
    """启动 SLSCtools 的核心逻辑（可被多个端点复用）"""
    import subprocess
    global slsc_process, slsc_monitor_paused

    if not mac:
        return {"status": "error", "message": "请提供 MAC 地址"}

    is_valid, msg = verify_slsc_integrity()
    if not is_valid:
        logger.error(f"工具验证失败: {msg}")
        return {"status": "error", "message": f"工具验证失败: {msg}"}

    slsc_path = os.path.abspath(get_slsc_path())
    logger.info(f"[调试工具] 程序路径检查完成，存在: {os.path.exists(slsc_path)}")
    # 如果路径不存在，尝试直接搜索（限制深度，避免阻塞）
    if not os.path.exists(slsc_path):
        search_base = get_base_dir()
        max_depth = 3
        for root, dirs, files in os.walk(search_base):
            # 限制遍历深度
            depth = root.replace(search_base, '').count(os.sep)
            if depth >= max_depth:
                dirs.clear()
                continue
            for f in files:
                if f.lower() == 'slsctools.exe':
                    slsc_path = os.path.join(root, f)
                    logger.info(f"[调试工具] 搜索找到程序路径")
                    break
            if os.path.exists(slsc_path):
                break

    slsc_monitor_paused = True
    logger.info("[调试工具] 已暂停辅助进程监控")

    try:
        with slsc_process_lock:
            if slsc_process is not None:
                try:
                    slsc_process.terminate()
                except Exception:
                    pass
            # 使用 CREATE_NEW_PROCESS_GROUP 避免子进程继承标准输入/输出导致阻塞
            import sys
            startupinfo = None
            if sys.platform == 'win32':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = 1  # SW_SHOWNORMAL
            
            slsc_process = subprocess.Popen(
                [slsc_path, mac],
                cwd=os.path.dirname(slsc_path),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                startupinfo=startupinfo
            )
        logger.info(f"[调试工具] 已启动，PID: {slsc_process.pid}")

        # 在后台线程中等待窗口出现后置顶并自动点击 Connect
        import ctypes
        import time

        def _bring_to_front_and_connect():
            try:
                import ctypes
                from ctypes import wintypes
                import time

                user32 = ctypes.windll.user32
                kernel32 = ctypes.windll.kernel32

                # 获取当前线程 ID
                current_thread_id = kernel32.GetCurrentThreadId()

                # 等待窗口出现（最多等10秒）
                hwnd = 0
                for _ in range(50):
                    time.sleep(0.2)
                    # 方式1: 直接查找 "Winbox" 或 "WinBox"
                    hwnd = user32.FindWindowW(None, "Winbox")
                    if hwnd:
                        break
                    hwnd = user32.FindWindowW(None, "WinBox")
                    if hwnd:
                        break
                    # 方式2: 查找包含 "WinBox" 的窗口标题
                    hwnd = user32.FindWindowExW(0, 0, None, None)
                    found = False
                    while hwnd:
                        buf = ctypes.create_unicode_buffer(256)
                        user32.GetWindowTextW(hwnd, buf, 256)
                        title = buf.value
                        if title and ('winbox' in title.lower() or 'slsc' in title.lower()):
                            found = True
                            break
                        hwnd = user32.FindWindowExW(0, hwnd, None, None)
                    if found:
                        break

                if not hwnd:
                    logger.warning("[调试工具] 未找到窗口")
                    return

                # 步骤1: 恢复窗口
                SW_RESTORE = 9
                user32.ShowWindow(hwnd, SW_RESTORE)
                time.sleep(0.1)

                # 步骤2: 使用 AttachThreadInput 绕过 UIPI 限制
                foreground_window = user32.GetForegroundWindow()
                foreground_thread_id = user32.GetWindowThreadProcessId(foreground_window, None)
                target_thread_id = user32.GetWindowThreadProcessId(hwnd, None)

                # 附加到前台线程
                user32.AttachThreadInput(foreground_thread_id, current_thread_id, True)
                user32.AttachThreadInput(target_thread_id, current_thread_id, True)
                time.sleep(0.05)

                # 步骤3: 设置 TOPMOST 并激活
                HWND_TOPMOST = -1
                HWND_NOTOPMOST = -2
                SWP_NOMOVE = 0x0002
                SWP_NOSIZE = 0x0004
                SWP_SHOWWINDOW = 0x0040
                user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
                                   SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
                time.sleep(0.1)

                # 步骤4: 使用 SetForegroundWindow 激活
                user32.SetForegroundWindow(hwnd)
                time.sleep(0.2)

                # 步骤5: 取消 TOPMOST
                user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0,
                                   SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)

                # 步骤6: 分离线程输入
                user32.AttachThreadInput(foreground_thread_id, current_thread_id, False)
                user32.AttachThreadInput(target_thread_id, current_thread_id, False)

                time.sleep(0.3)

                # 步骤7: 使用 SendInput 模拟 Tab 和 Enter（绕过 UIPI）
                # INPUT 结构体定义
                class MOUSEINPUT(ctypes.Structure):
                    _fields_ = [("dx", ctypes.c_long), ("dy", ctypes.c_long),
                                ("mouseData", ctypes.c_ulong), ("dwFlags", ctypes.c_ulong),
                                ("time", ctypes.c_ulong), ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong))]

                class KEYBDINPUT(ctypes.Structure):
                    _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort),
                                ("dwFlags", ctypes.c_ulong), ("time", ctypes.c_ulong),
                                ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong))]

                class HARDWAREINPUT(ctypes.Structure):
                    _fields_ = [("uMsg", ctypes.c_ulong), ("wParamL", ctypes.c_short),
                                ("wParamH", ctypes.c_ushort)]

                class INPUT(ctypes.Structure):
                    class _INPUT(ctypes.Union):
                        _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]
                    _fields_ = [("type", ctypes.c_ulong), ("_", _INPUT)]

                KEYEVENTF_KEYUP = 0x0002
                INPUT_KEYBOARD = 1

                def send_key(vk_code):
                    """使用 SendInput 发送按键"""
                    inputs = (INPUT * 2)()
                    # Key down
                    inputs[0].type = INPUT_KEYBOARD
                    inputs[0]._.ki.wVk = vk_code
                    inputs[0]._.ki.dwFlags = 0
                    # Key up
                    inputs[1].type = INPUT_KEYBOARD
                    inputs[1]._.ki.wVk = vk_code
                    inputs[1]._.ki.dwFlags = KEYEVENTF_KEYUP
                    user32.SendInput(2, inputs, ctypes.sizeof(INPUT))

                # 模拟 Tab 键（移动焦点到 Connect 按钮）
                send_key(0x09)  # VK_TAB
                time.sleep(0.1)
                # 模拟 Enter 键（点击 Connect）
                send_key(0x0D)  # VK_RETURN

                logger.info("[调试工具] 窗口置顶和自动点击完成")
            except Exception as e:
                logger.warning(f"[调试工具] 窗口置顶/自动点击失败: {e}")

        threading.Thread(target=_bring_to_front_and_connect, daemon=True).start()

        return {"status": "success", "message": "已启动", "mac": mac, "pid": slsc_process.pid}
    except Exception as e:
        slsc_monitor_paused = False
        logger.error(f"[调试工具] 启动失败: {e}", exc_info=True)
        return {"status": "error", "message": f"启动失败: {e}"}


@app.post("/api/slsc-tools")
async def open_slsc_tools(request: SLSCtoolsRequest):
    """启动频谱扫描工具并传递 MAC 地址和密码"""
    mac = request.mac
    password = request.password
    logger.info(f"收到启动请求: mac={mac}, password={'*' * len(password) if password else '空'}")
    return _do_launch_slsc_tools(mac)


@app.post("/api/slsc-tools/close")
async def close_slsc_tools():
    """关闭频谱扫描工具进程"""
    global slsc_process, slsc_monitor_paused
    
    try:
        # 恢复监控
        slsc_monitor_paused = False
        logger.info("已恢复辅助进程监控")
        
        with slsc_process_lock:
            if slsc_process is not None:
                try:
                    slsc_process.terminate()
                    slsc_process.wait(timeout=3)
                    logger.info("已关闭工具进程")
                except subprocess.TimeoutExpired:
                    slsc_process.kill()
                    logger.info("已强制关闭工具进程")
                except Exception as e:
                    logger.warning(f"关闭工具进程时出错: {e}")
                finally:
                    slsc_process = None
        
        return {"status": "success", "message": "工具已关闭"}
    except Exception as e:
        logger.error(f"关闭工具失败: {e}")
        return {"status": "error", "message": f"关闭失败: {e}"}


class DebugTriggerRequest(BaseModel):
    """调试工具触发请求"""
    mac: str = ""


def _do_debug_trigger(mac: str):
    """后台执行调试触发：先启动 SLSCtools，再发送 UDP"""
    logger.info(f"[调试触发] 开始，MAC={mac}")

    # 1. 先启动 SLSCtools
    if mac:
        logger.info(f"[调试触发] 启动调试工具，MAC={mac}")
        _do_launch_slsc_tools(mac)
    else:
        logger.warning("[调试触发] MAC 地址为空，跳过调试工具启动")

    # 2. 向所有网络接口发送 20 条 UDP 数据包（使用广播MAC，L2socket发送）
    packets_sent = 0
    try:
        from scapy.all import Ether, IP, UDP, Raw, conf, get_if_list

        dst_ip = "12.34.56.255"
        src_port = 3721
        dst_port = 4096
        payload = b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f"

        # 获取所有可用接口（排除Loopback）
        all_ifaces = [iface for iface in get_if_list() if 'Loopback' not in iface]
        logger.info(f"[调试触发] 发现 {len(all_ifaces)} 个网络接口")

        # 构建报文（使用广播MAC，消除ARP解析警告）
        pkt = Ether(dst="ff:ff:ff:ff:ff:ff") / IP(dst=dst_ip) / UDP(sport=src_port, dport=dst_port) / Raw(load=payload)

        # 为每个接口创建独立的L2socket
        sockets = []
        for iface in all_ifaces:
            sock = conf.L2socket(iface=iface)
            sockets.append(sock)

        # 发送20轮，每轮向所有接口各发送1个报文
        for _ in range(20):
            for sock in sockets:
                sock.send(pkt)
                packets_sent += 1

        for sock in sockets:
            sock.close()

        logger.info(f"[调试触发] 共发送 {packets_sent} 条 UDP 数据包")
    except Exception as e:
        logger.error(f"[调试触发] 发送数据包失败: {e}")


@app.post("/api/debug-trigger")
async def debug_trigger(request: DebugTriggerRequest):
    """调试触发端点：后台发送 UDP + 启动 SLSCtools"""
    mac = request.mac
    # 放到后台线程执行，避免阻塞 HTTP 响应
    threading.Thread(target=_do_debug_trigger, args=(mac,), daemon=True).start()
    return {"status": "success", "message": "调试任务已启动"}


@app.get("/api/interfaces")
def get_interfaces(ip: str = Query(...)):
    """获取接口列表（包含实时流量速率）"""
    if not ip:
        raise HTTPException(status_code=400, detail="缺少设备IP参数")
    
    try:
        mt_api, err = _get_api_from_pool(ip)
        if err:
            return {"status": "error", "message": err, "interfaces": []}
        username = mt_api.username
        password = mt_api.password
        
        with api_connection(ip, username, password) as temp_api:
            interfaces = temp_api.get_interfaces()
            
            active_names = [iface['name'] for iface in interfaces if iface.get('running') and not iface.get('disabled')]
            
            if active_names:
                traffic_data = temp_api.get_interfaces_traffic(active_names)
                for iface in interfaces:
                    name = iface.get('name', '')
                    if name in traffic_data:
                        iface['rx_rate'] = traffic_data[name]['rx_bps']
                        iface['tx_rate'] = traffic_data[name]['tx_bps']
                    else:
                        iface['rx_rate'] = 0
                        iface['tx_rate'] = 0
            else:
                for iface in interfaces:
                    iface['rx_rate'] = 0
                    iface['tx_rate'] = 0
            
            return {"status": "success", "interfaces": interfaces}
            
    except Exception as e:
        logger.error(f"获取接口列表错误: {ip} - {e}")
        return {"status": "error", "message": f"获取接口列表失败: {e}", "interfaces": []}


@app.get("/api/cpu-usage")
async def get_cpu_usage(ip: str = Query(...)):
    """获取 CPU 使用率"""
    if not ip:
        raise HTTPException(status_code=400, detail="缺少设备IP参数")
    
    try:
        mt_api, err = _get_api_from_pool(ip)
        if err:
            return {"status": "error", "message": err}
        cpu_info = mt_api.get_cpu_usage()
        return {"status": "success", "cpu_usage": cpu_info.get('cpu_usage', '0%')}
    except Exception as e:
        logger.error(f"获取CPU使用率错误: {ip} - {e}")
        _check_connection_error(str(e), ip)
        return {"status": "error", "message": f"获取CPU使用率失败: {e}"}


@app.get("/api/system-time")
async def get_system_time(ip: str = Query(...)):
    """获取系统时间"""
    if not ip:
        raise HTTPException(status_code=400, detail="缺少设备IP参数")
    
    try:
        mt_api, err = _get_api_from_pool(ip)
        if err:
            return {"status": "error", "message": err}
        current_time = time.time()
        time_info = mt_api.get_system_time()
        if time_info.get('system_time'):
            mt_api._cached_system_time = time_info
            mt_api._cached_system_time_time = current_time
        elif hasattr(mt_api, '_cached_system_time') and mt_api._cached_system_time.get('system_time'):
            cache_age = current_time - getattr(mt_api, '_cached_system_time_time', 0)
            if cache_age <= 120:
                time_info = mt_api._cached_system_time
        return {"status": "success", "system_time": time_info.get('system_time', '')}
    except Exception as e:
        logger.error(f"获取系统时间错误: {ip} - {e}")
        _check_connection_error(str(e), ip)
        return {"status": "error", "message": f"获取系统时间失败: {e}"}


@app.get("/api/device-info")
async def get_device_info(ip: str = Query(...), force_refresh: bool = False):
    """获取设备信息"""
    if not ip:
        raise HTTPException(status_code=400, detail="缺少设备IP参数")
    
    try:
        mt_api, err = _get_api_from_pool(ip)
        if err:
            return {"status": "error", "message": err}
        info = mt_api.get_system_info(force_refresh=force_refresh)
        identity = mt_api.get_identity()
        
        if not mt_api.logged_in:
            logger.warning(f"[device-info] 设备 {ip} API调用后 logged_in=False，触发离线检测")
            try:
                from websocket_server import mark_device_offline
                mark_device_offline(ip)
            except Exception as notify_err:
                logger.error(f"[device-info] 离线通知失败: {notify_err}")
            with api_pool_lock:
                if ip in api_pool:
                    try:
                        api_pool[ip].close()
                    except:
                        pass
                    del api_pool[ip]
            return {"status": "error", "message": f"设备 {ip} 连接已断开"}
        
        current_time = time.time()
        system_time = mt_api.get_system_time()
        if system_time.get('system_time'):
            mt_api._cached_system_time = system_time
            mt_api._cached_system_time_time = current_time
        elif hasattr(mt_api, '_cached_system_time') and mt_api._cached_system_time.get('system_time'):
            cache_age = current_time - getattr(mt_api, '_cached_system_time_time', 0)
            if cache_age > 120:
                system_time = {'system_time': '', 'date': '', 'time': ''}
            else:
                system_time = mt_api._cached_system_time
        
        total_memory = int(info.get('total-memory', 0)) if info.get('total-memory') else 0
        free_memory = int(info.get('free-memory', 0)) if info.get('free-memory') else 0
        total_hdd = int(info.get('total-hdd-space', 0)) if info.get('total-hdd-space') else 0
        free_hdd = int(info.get('free-hdd-space', 0)) if info.get('free-hdd-space') else 0
        used_memory = total_memory - free_memory if total_memory > 0 else 0
        used_hdd = total_hdd - free_hdd if total_hdd > 0 else 0
        
        result = {
            'status': 'success',
            'info': {
                'time': system_time.get('system_time', '--'),
                'date': system_time.get('system_time', '').split(' ')[0] if system_time.get('system_time') else '',
                'device_time': system_time.get('time', ''),
                'cpu_load': info.get('cpu-load', '0'),
                'cpu_load_num': int(info.get('cpu-load', '0').rstrip('%')) if info.get('cpu-load') else 0,
                'version': info.get('version', '--'),
                'voltage': info.get('voltage', '--'),
                'identity': identity or '--',
                'uptime': info.get('uptime', '--'),
                'cpu': info.get('cpu', '--'),
                'cpu_count': info.get('cpu-count', '--'),
                'cpu_frequency': str(info.get('cpu-frequency', '--')) + ' MHz' if info.get('cpu-frequency') else '--',
                'memory_used': format_bytes(used_memory) if total_memory > 0 else '--',
                'memory_free': format_bytes(free_memory) if total_memory > 0 else '--',
                'memory_total': format_bytes(total_memory) if total_memory > 0 else '--',
                'memory_used_raw': used_memory,
                'memory_total_raw': total_memory,
                'memory_percentage': round((used_memory / total_memory) * 100, 1) if total_memory > 0 else 0,
                'hdd_used': format_bytes(used_hdd) if total_hdd > 0 else '--',
                'hdd_free': format_bytes(free_hdd) if total_hdd > 0 else '--',
                'hdd_total': format_bytes(total_hdd) if total_hdd > 0 else '--',
                'hdd_used_raw': used_hdd,
                'hdd_total_raw': total_hdd,
                'hdd_percentage': round((used_hdd / total_hdd) * 100, 1) if total_hdd > 0 else 0,
                'architecture': info.get('architecture-name', '--'),
                'board': info.get('board-name', '--'),
                'platform': info.get('platform', '--')
            }
        }
        return result
    except Exception as e:
        logger.error(f"获取设备信息错误: {ip} - {e}")
        _check_connection_error(str(e), ip)
        return {"status": "error", "message": f"获取设备信息失败: {e}"}


@app.get("/api/interface-toggle")
async def interface_toggle(ip: str = Query(...), interface: str = Query(...), action: str = Query("disable")):
    """切换接口启用/禁用状态"""
    if not ip or not interface:
        raise HTTPException(status_code=400, detail="缺少参数")
    
    try:
        mt_api, err = _get_api_from_pool(ip)
        if err:
            return {"status": "error", "message": err}
        
        if action == 'disable':
            command = ['/interface/disable', f'=numbers={interface}']
        else:
            command = ['/interface/enable', f'=numbers={interface}']
        
        mt_api.write_sentence(command)
        
        done = False
        for _ in range(100):
            response = mt_api.read_sentence(timeout=10)
            if '!done' in response:
                done = True
                break
            if '!trap' in response:
                break
        
        if done:
            return {"status": "success", "message": f'接口 {interface} 已{"禁用" if action == "disable" else "启用"}'}
        else:
            return {"status": "error", "message": f'操作失败: {response}'}
    except Exception as e:
        logger.error(f"接口切换错误: {ip} - {e}")
        return {"status": "error", "message": f"操作失败: {e}"}


class InterfaceCommentRequest(BaseModel):
    ip: str
    interface: str
    comment: str = ""


@app.post("/api/interface-comment")
async def interface_set_comment(request: InterfaceCommentRequest):
    """设置接口注释"""
    if not request.ip or not request.interface:
        raise HTTPException(status_code=400, detail="缺少参数")
    
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err}
        username = mt_api.username
        password = mt_api.password
    
        with api_connection(request.ip, username, password) as temp_api:
            command = ['/interface/set', f'=numbers={request.interface}', f'=comment={request.comment}']
            temp_api.write_sentence(command)
            
            done = False
            for _ in range(100):
                response = temp_api.read_sentence(timeout=10)
                if '!done' in response:
                    done = True
                    break
                if '!trap' in response:
                    break
            
            if done:
                return {"status": "success", "message": f'接口 {request.interface} 注释已更新'}
            else:
                return {"status": "error", "message": f'操作失败: {response}'}
    except Exception as e:
        logger.error(f"接口注释设置错误: {request.ip} - {e}")
        return {"status": "error", "message": f"操作失败: {e}"}


@app.get("/api/wireless-interfaces")
async def get_wireless_interfaces(ip: str = Query(...)):
    """获取无线接口列表"""
    if not ip:
        raise HTTPException(status_code=400, detail="缺少设备IP参数")
    
    try:
        mt_api, err = _get_api_from_pool(ip)
        if err:
            return {"success": False, "message": err}
        
        mt_api.flush_socket()
        mt_api.write_sentence(['/interface/wireless/print',
                               '.proplist=.id,name,type,mac-address,ssid,band,frequency,channel-width,wireless-protocol,mode,running,disabled,comment,master-interface,radio-name,arp,mtu,l2mtu,default-name,tx-power,rate-set,security-profile,wps-mode,hide-ssid,disabled-running,default-authentication,default-forwarding,multicast-buffering,keepalive-frames,allow-sharedkey,country,installation,frequency-mode,scan-list,default-ap-tx-limit,default-client-tx-limit,multicast-helper,area,max-station-count,burst-time,hw-retries,adaptive-noise-immunity,preamble-mode,disconnect-timeout,on-fail-retry-time,update-stats-interval,tx-power-mode,supported-rates-b,supported-rates-a/g,basic-rates-b,basic-rates-a/g,distance,guard-interval,tx-chains,rx-chains,wmm-support,ampdu-priorities,amsdu-limit,amsdu-threshold,ht-stbc,ht-ldpc,ht-basic-mcs,ht-supported-mcs,antenna-gain,antenna-mode,wds-mode,wds-default-bridge,station-roaming'])
        
        interfaces = []
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
                            iface[parts[0]] = parts[1]
                
                logger.info(f"Wireless interface raw data: {iface}")
                
                if iface and iface.get('name'):
                    def convert_bool(value):
                        if value in ('true', 'enabled'):
                            return 'yes'
                        elif value in ('false', 'disabled'):
                            return 'no'
                        return value
                    
                    interface_data = {
                        '.id': iface.get('.id', ''),
                        'name': iface.get('name'),
                        'type': iface.get('type', ''),
                        'mac_address': iface.get('mac-address', ''),
                        'ssid': iface.get('ssid', ''),
                        'band': iface.get('band', ''),
                        'frequency': iface.get('frequency', ''),
                        'channel-width': iface.get('channel-width', ''),
                        'wireless-protocol': iface.get('wireless-protocol', ''),
                        'mode': iface.get('mode', ''),
                        'running': iface.get('running', 'false') == 'true',
                        'disabled': iface.get('disabled', 'false') == 'true',
                        'comment': iface.get('comment', ''),
                        'master-interface': iface.get('master-interface', ''),
                        'radio-name': iface.get('radio-name', ''),
                        'arp': iface.get('arp', ''),
                        'mtu': iface.get('mtu', ''),
                        'l2mtu': iface.get('l2mtu', ''),
                        'default-name': iface.get('default-name', ''),
                        'tx-power': iface.get('tx-power', ''),
                        'rate-set': iface.get('rate-set', ''),
                        'security-profile': iface.get('security-profile', ''),
                        'wps-mode': iface.get('wps-mode', ''),
                        'hide-ssid': convert_bool(iface.get('hide-ssid', '')),
                        'disabled-running': iface.get('disabled-running', ''),
                        'default-authenticate': convert_bool(iface.get('default-authentication', iface.get('default-authenticate', ''))),
                        'default-forwarding': convert_bool(iface.get('default-forwarding', '')),
                        'multicast-buffering': iface.get('multicast-buffering', ''),
                        'keepalive-frames': iface.get('keepalive-frames', ''),
                        'allow-shared-key': convert_bool(iface.get('allow-sharedkey', iface.get('allow-shared-key', ''))),
                        'country': iface.get('country', ''),
                        'installation': iface.get('installation', ''),
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
                        'distance': iface.get('distance', ''),
                        'guard-interval': iface.get('guard-interval', ''),
                        'tx-chains': iface.get('tx-chains', ''),
                        'rx-chains': iface.get('rx-chains', ''),
                        'wmm-support': iface.get('wmm-support', ''),
                        'ampdu-priorities': iface.get('ampdu-priorities', ''),
                        'amsdu-limit': iface.get('amsdu-limit', ''),
                        'amsdu-threshold': iface.get('amsdu-threshold', ''),
                        'ht-stbc': iface.get('ht-stbc', ''),
                        'ht-ldpc': iface.get('ht-ldpc', ''),
                        'ht-basic-mcs': iface.get('ht-basic-mcs', ''),
                        'ht-supported-mcs': iface.get('ht-supported-mcs', ''),
                        'wds-mode': iface.get('wds-mode', ''),
                        'wds-default-bridge': iface.get('wds-default-bridge', ''),
                        'station-roaming': iface.get('station-roaming', ''),
                        'antenna-gain': iface.get('antenna-gain', ''),
                        'antenna-mode': iface.get('antenna-mode', ''),
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
                        '_raw': iface
                    }
                    interfaces.append(interface_data)
        
        return {"success": True, "interfaces": interfaces}
    except Exception as e:
        logger.error(f"获取无线接口错误: {ip} - {e}")
        return {"success": False, "message": f"获取无线接口失败: {e}"}


@app.get("/api/wireless-interface")
async def get_wireless_interface(ip: str = Query(...), interface_id: str = Query(...)):
    """获取单个无线接口详情"""
    if not ip or not interface_id:
        raise HTTPException(status_code=400, detail="缺少必要参数")
    
    try:
        mt_api, err = _get_api_from_pool(ip)
        if err:
            return {"success": False, "message": err}
        
        mt_api.flush_socket()
        # 使用 proplist 显式请求所有需要的字段，包括 tx-chains/rx-chains 等扩展字段
        mt_api.write_sentence(['/interface/wireless/print',
                               f'?.id={interface_id}',
                               '.proplist=.id,name,type,mac-address,ssid,band,frequency,channel-width,wireless-protocol,mode,running,disabled,comment,master-interface,radio-name,arp,mtu,l2mtu,default-name,tx-power,rate-set,security-profile,wps-mode,hide-ssid,disabled-running,scan-list,frequency-mode,country,installation,bridge-mode,vlan-mode,vlan-id,default-ap-tx-limit,default-client-tx-limit,default-authentication,default-forwarding,multicast-helper,multicast-buffering,keepalive-frames,area,max-station-count,burst-time,hw-retries,adaptive-noise-immunity,preamble-mode,allow-sharedkey,disconnect-timeout,on-fail-retry-time,update-stats-interval,tx-power-mode,distance,guard-interval,tx-chains,rx-chains,wmm-support,ampdu-priorities,amsdu-limit,amsdu-threshold,ht-stbc,ht-ldpc,ht-basic-mcs,ht-supported-mcs,antenna-gain,antenna-mode,noise-floor-threshold,frame-lifetime,hw-fragmentation-threshold,hw-protection-mode,hw-protection-threshold,interworking-profile,supported-rates-b,supported-rates-a/g,basic-rates-b,basic-rates-a/g,wds-mode,wds-default-bridge,station-roaming'])
        
        while True:
            try:
                response = mt_api.read_sentence(timeout=10)
            except Exception:
                break
            
            if '!done' in response:
                break
            if '!trap' in response:
                error_msg = ' '.join([r for r in response if r.startswith('message=')])
                return {"success": False, "message": error_msg or "接口不存在"}
            if '!re' in response:
                iface = {}
                for line in response:
                    if line.startswith('='):
                        parts = line[1:].split('=', 1)
                        if len(parts) == 2:
                            iface[parts[0]] = parts[1]
                
                if iface:
                    def convert_bool(value):
                        if value in ('true', 'enabled'):
                            return 'yes'
                        elif value in ('false', 'disabled'):
                            return 'no'
                        return value
                    
                    interface_data = {
                        '.id': iface.get('.id', ''),
                        'name': iface.get('name', ''),
                        'type': iface.get('type', ''),
                        'mac_address': iface.get('mac-address', ''),
                        'ssid': iface.get('ssid', ''),
                        'band': iface.get('band', ''),
                        'frequency': iface.get('frequency', ''),
                        'channel-width': iface.get('channel-width', ''),
                        'wireless-protocol': iface.get('wireless-protocol', ''),
                        'mode': iface.get('mode', ''),
                        'running': iface.get('running', 'false') == 'true',
                        'disabled': iface.get('disabled', 'false') == 'true',
                        'comment': iface.get('comment', ''),
                        'master-interface': iface.get('master-interface', ''),
                        'radio-name': iface.get('radio-name', ''),
                        'arp': iface.get('arp', ''),
                        'mtu': iface.get('mtu', ''),
                        'l2mtu': iface.get('l2mtu', ''),
                        'default-name': iface.get('default-name', ''),
                        'tx-power': iface.get('tx-power', ''),
                        'rate-set': iface.get('rate-set', ''),
                        'security-profile': iface.get('security-profile', ''),
                        'wps-mode': iface.get('wps-mode', ''),
                        'hide-ssid': convert_bool(iface.get('hide-ssid', '')),
                        'disabled-running': iface.get('disabled-running', ''),
                        'scan-list': iface.get('scan-list', ''),
                        'frequency-mode': iface.get('frequency-mode', ''),
                        'country': iface.get('country', ''),
                        'installation': iface.get('installation', ''),
                        'bridge-mode': iface.get('bridge-mode', ''),
                        'vlan-mode': iface.get('vlan-mode', ''),
                        'vlan-id': iface.get('vlan-id', ''),
                        'default-ap-tx-limit': iface.get('default-ap-tx-limit', ''),
                        'default-client-tx-limit': iface.get('default-client-tx-limit', ''),
                        'default-authenticate': convert_bool(iface.get('default-authentication', iface.get('default-authenticate', ''))),
                        'default-forwarding': convert_bool(iface.get('default-forwarding', '')),
                        'multicast-helper': iface.get('multicast-helper', ''),
                        'multicast-buffering': iface.get('multicast-buffering', ''),
                        'keepalive-frames': iface.get('keepalive-frames', ''),
                        'area': iface.get('area', ''),
                        'max-station-count': iface.get('max-station-count', ''),
                        'burst-time': iface.get('burst-time', ''),
                        'hw-retries': iface.get('hw-retries', ''),
                        'adaptive-noise-immunity': iface.get('adaptive-noise-immunity', ''),
                        'preamble-mode': iface.get('preamble-mode', ''),
                        'allow-sharedkey': convert_bool(iface.get('allow-sharedkey', iface.get('allow-shared-key', ''))),
                        'disconnect-timeout': iface.get('disconnect-timeout', ''),
                        'on-fail-retry-time': iface.get('on-fail-retry-time', ''),
                        'update-stats-interval': iface.get('update-stats-interval', ''),
                        'tx-power-mode': iface.get('tx-power-mode', ''),
                        'distance': iface.get('distance', ''),
                        'guard-interval': iface.get('guard-interval', ''),
                        'tx-chains': iface.get('tx-chains', ''),
                        'rx-chains': iface.get('rx-chains', ''),
                        'wmm-support': iface.get('wmm-support', ''),
                        'ampdu-priorities': iface.get('ampdu-priorities', ''),
                        'amsdu-limit': iface.get('amsdu-limit', ''),
                        'amsdu-threshold': iface.get('amsdu-threshold', ''),
                        'ht-stbc': iface.get('ht-stbc', ''),
                        'ht-ldpc': iface.get('ht-ldpc', ''),
                        'ht-basic-mcs': iface.get('ht-basic-mcs', ''),
                        'ht-supported-mcs': iface.get('ht-supported-mcs', ''),
                        'wds-mode': iface.get('wds-mode', ''),
                        'wds-default-bridge': iface.get('wds-default-bridge', ''),
                        'station-roaming': iface.get('station-roaming', ''),
                        'antenna-gain': iface.get('antenna-gain', ''),
                        'antenna-mode': iface.get('antenna-mode', ''),
                        '_raw': iface
                    }
                    
                    # 查询 Nstreme 子菜单配置（/interface wireless nstreme）
                    # Nstreme 字段位于独立子菜单，需单独查询并合并
                    try:
                        mt_api.flush_socket()
                        mt_api.write_sentence([
                            '/interface/wireless/nstreme/print',
                            f'?.id={interface_id}',
                            '.proplist=.id,name,enable-nstreme,framer-policy,framer-limit,enable-polling,disable-csma'
                        ])
                        while True:
                            try:
                                nstreme_response = mt_api.read_sentence(timeout=10)
                            except Exception:
                                break
                            if '!done' in nstreme_response:
                                break
                            if '!trap' in nstreme_response:
                                break
                            if '!re' in nstreme_response:
                                for line in nstreme_response:
                                    if line.startswith('='):
                                        parts = line[1:].split('=', 1)
                                        if len(parts) == 2:
                                            field_name = parts[0]
                                            field_value = parts[1]
                                            # 转换布尔值字段为 yes/no 格式，与其它字段保持一致
                                            if field_name in ('enable-nstreme', 'enable-polling', 'disable-csma'):
                                                if field_value in ('true', 'enabled'):
                                                    field_value = 'yes'
                                                elif field_value in ('false', 'disabled'):
                                                    field_value = 'no'
                                            interface_data[field_name] = field_value
                    except Exception as nstreme_err:
                        logger.warning(f"获取 Nstreme 配置失败: {ip} - {nstreme_err}")
                    
                    return {"success": True, "interface": interface_data}
        
        return {"success": False, "message": "接口不存在"}
    except Exception as e:
        logger.error(f"获取无线接口详情错误: {ip} - {e}")
        return {"success": False, "message": f"获取无线接口详情失败: {e}"}


@app.get("/api/wireless-hw-info")
async def get_wireless_hw_info(ip: str = Query(...), interface_name: str = Query(...)):
    """获取无线接口硬件频段信息"""
    if not ip or not interface_name:
        raise HTTPException(status_code=400, detail="缺少必要参数")
    
    try:
        mt_api, err = _get_api_from_pool(ip)
        if err:
            return {"success": False, "message": err}
        
        mt_api.flush_socket()
        mt_api.write_sentence(['/interface/wireless/info/hw-info', f'=interface={interface_name}'])
        
        hw_info = {}
        while True:
            try:
                response = mt_api.read_sentence(timeout=10)
            except Exception as e:
                logger.error(f"hw-info read error: {e}")
                break
            
            logger.info(f"hw-info response: {response}")
            
            if '!done' in response:
                break
            if '!trap' in response:
                error_msg = ' '.join([r for r in response if r.startswith('message=')])
                logger.error(f"hw-info trap: {error_msg}")
                return {"success": False, "message": error_msg or "获取硬件信息失败"}
            if '!re' in response:
                for line in response:
                    if line.startswith('='):
                        parts = line[1:].split('=', 1)
                        if len(parts) == 2:
                            hw_info[parts[0]] = parts[1]
        
        if hw_info:
            return {"success": True, "hw_info": hw_info}
        return {"success": False, "message": "未获取到硬件信息"}
    except Exception as e:
        logger.error(f"获取无线硬件信息错误: {ip} - {e}")
        return {"success": False, "message": f"获取无线硬件信息失败: {e}"}


class WirelessInterfaceToggleRequest(BaseModel):
    ip: str
    interface_id: str
    disabled: bool


class WirelessInterfaceUpdateRequest(BaseModel):
    ip: str
    interface_id: str
    name: str = ""
    ssid: str = ""
    band: str = ""
    frequency: str = ""
    channel_width: str = ""
    wireless_protocol: str = ""
    mode: str = ""
    security_profile: str = ""
    hide_ssid: str = ""
    tx_power: str = ""
    tx_power_mode: str = ""
    antenna_gain: str = ""
    antenna_mode: str = ""
    rate_set: str = ""
    wps_mode: str = ""
    arp: str = ""
    mtu: str = ""
    comment: str = ""
    radio_name: str = ""
    scan_list: str = ""
    skip_dfs_channels: str = ""
    frequency_mode: str = ""
    country: str = ""
    installation: str = ""
    bridge_mode: str = ""
    vlan_mode: str = ""
    vlan_id: str = ""
    default_ap_tx_limit: str = ""
    default_client_tx_limit: str = ""
    default_authenticate: str = ""
    default_forwarding: str = ""
    multicast_helper: str = ""
    multicast_buffering: str = ""
    keepalive_frames: str = ""
    area: str = ""
    max_station_count: str = ""
    burst_time: str = ""
    hw_retries: str = ""
    adaptive_noise_immunity: str = ""
    preamble_mode: str = ""
    allow_shared_key: str = ""
    disconnect_timeout: str = ""
    on_fail_retry_time: str = ""
    update_stats_interval: str = ""
    supported_rates_b: str = ""
    supported_rates_ag: str = ""
    basic_rates_b: str = ""
    basic_rates_ag: str = ""
    distance: str = ""
    guard_interval: str = ""
    ht_txchains: str = ""
    ht_rxchains: str = ""
    wmm_support: str = ""
    ampdu_priorities: str = ""
    amsdu_limit: str = ""
    amsdu_threshold: str = ""
    ht_stbc: str = ""
    ht_ldpc: str = ""
    ht_basic_mcs: str = ""
    ht_supported_mcs: str = ""
    wds_mode: str = ""
    wds_default_bridge: str = ""
    station_roaming: str = ""
    # Nstreme 子菜单字段（/interface wireless nstreme）
    enable_nstreme: str = ""
    nstreme_framer_policy: str = ""
    nstreme_framer_limit: str = ""
    nstreme_enable_polling: str = ""
    nstreme_disable_csma: str = ""


@app.post("/api/wireless-interface/toggle")
async def toggle_wireless_interface(request: WirelessInterfaceToggleRequest):
    if not request.ip or not request.interface_id:
        raise HTTPException(status_code=400, detail="缺少必要参数")
    
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"success": False, "message": err}
        username = mt_api.username
        password = mt_api.password
        
        with api_connection(request.ip, username, password) as temp_api:
            cmd = [
                '/interface/wireless/set',
                f'=.id={request.interface_id}',
                f'=disabled={"yes" if request.disabled else "no"}'
            ]
            temp_api.write_sentence(cmd)
            
            while True:
                try:
                    response = temp_api.read_sentence(timeout=10)
                except Exception:
                    break
                
                if '!done' in response:
                    return {"success": True, "message": "接口状态已更新"}
                if '!trap' in response:
                    error_msg = ' '.join([r for r in response if r.startswith('message=')])
                    return {"success": False, "message": error_msg or "操作失败"}
        
        return {"success": False, "message": "操作超时"}
    except Exception as e:
        logger.error(f"切换无线接口状态错误: {request.ip} - {e}")
        return {"success": False, "message": f"切换接口状态失败: {e}"}


@app.get("/api/wireless-frequency-info")
async def get_wireless_frequency_info(ip: str = Query(...), interface_id: str = Query(...)):
    """获取无线接口支持的频率信息"""
    if not ip or not interface_id:
        raise HTTPException(status_code=400, detail="缺少必要参数")
    
    try:
        mt_api, err = _get_api_from_pool(ip)
        if err:
            return {"success": False, "message": err}
        username = mt_api.username
        password = mt_api.password
        
        with api_connection(ip, username, password) as temp_api:
            temp_api.write_sentence(['/interface/wireless/print', f'?.id={interface_id}', '=detail='])
            
            iface_info = {}
            while True:
                try:
                    response = temp_api.read_sentence(timeout=10)
                except Exception:
                    break
                
                if '!done' in response:
                    break
                if '!trap' in response:
                    break
                if '!re' in response:
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                iface_info[parts[0]] = parts[1]
            
            supported_bands = iface_info.get('supported-bands', '')
            hw_retries = iface_info.get('hw-retries', '')
            radio_name = iface_info.get('radio-name', '')
            default_name = iface_info.get('default-name', '')
            
            supported_band_list = []
            if supported_bands:
                supported_band_list = [b.strip() for b in supported_bands.split(',') if b.strip()]
            
            is_24ghz = False
            is_5ghz = False
            
            if supported_bands:
                bands_lower = supported_bands.lower()
                if '2ghz' in bands_lower:
                    is_24ghz = True
                if '5ghz' in bands_lower:
                    is_5ghz = True
            
            if not is_24ghz and not is_5ghz:
                if default_name:
                    name_lower = default_name.lower()
                    if '24' in name_lower or '2.4' in name_lower:
                        is_24ghz = True
                    elif '5' in name_lower or '5.8' in name_lower:
                        is_5ghz = True
            
            return {
                "success": True,
                "supported_bands": supported_bands,
                "supported_band_list": supported_band_list,
                "is_24ghz": is_24ghz,
                "is_5ghz": is_5ghz,
                "radio_name": radio_name,
                "default_name": default_name,
                "hw_retries": hw_retries,
            }
    except Exception as e:
        logger.error(f"获取无线频率信息错误: {ip} - {e}")
        return {"success": False, "message": f"获取频率信息失败: {e}"}


@app.post("/api/wireless-interface/update")
async def update_wireless_interface(request: WirelessInterfaceUpdateRequest):
    if not request.ip or not request.interface_id:
        raise HTTPException(status_code=400, detail="缺少必要参数")
    
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"success": False, "message": err}
        
        mt_api.flush_socket()
        
        cmd = ['/interface/wireless/set', f'=.id={request.interface_id}']
        
        if request.name:
            cmd.append(f'=name={request.name}')
        if request.ssid:
            cmd.append(f'=ssid={request.ssid}')
        if request.band:
            cmd.append(f'=band={request.band}')
        if request.frequency:
            cmd.append(f'=frequency={request.frequency}')
        if request.channel_width:
            channel_width_value = request.channel_width.replace('MHz', 'mhz').replace('MHZ', 'mhz')
            cmd.append(f'=channel-width={channel_width_value}')
        if request.wireless_protocol:
            cmd.append(f'=wireless-protocol={request.wireless_protocol}')
        if request.mode:
            cmd.append(f'=mode={request.mode}')
        if request.security_profile:
            cmd.append(f'=security-profile={request.security_profile}')
        if request.hide_ssid:
            cmd.append(f'=hide-ssid={request.hide_ssid}')
        if request.tx_power:
            cmd.append(f'=tx-power={request.tx_power}')
        if request.tx_power_mode:
            cmd.append(f'=tx-power-mode={request.tx_power_mode}')
        if request.antenna_gain:
            cmd.append(f'=antenna-gain={request.antenna_gain}')
        if request.antenna_mode:
            cmd.append(f'=antenna-mode={request.antenna_mode}')
        if request.rate_set:
            cmd.append(f'=rate-set={request.rate_set}')
        if request.wps_mode:
            cmd.append(f'=wps-mode={request.wps_mode}')
        if request.arp:
            cmd.append(f'=arp={request.arp}')
        if request.mtu:
            cmd.append(f'=mtu={request.mtu}')
        if request.radio_name:
            cmd.append(f'=radio-name={request.radio_name}')
        if request.scan_list:
            cmd.append(f'=scan-list={request.scan_list}')
        if request.skip_dfs_channels:
            cmd.append(f'=skip-dfs-channels={request.skip_dfs_channels}')
        if request.frequency_mode:
            cmd.append(f'=frequency-mode={request.frequency_mode}')
        if request.country:
            cmd.append(f'=country={request.country}')
        if request.installation:
            cmd.append(f'=installation={request.installation}')
        if request.bridge_mode:
            cmd.append(f'=bridge-mode={request.bridge_mode}')
        if request.vlan_mode:
            cmd.append(f'=vlan-mode={request.vlan_mode}')
        if request.vlan_id:
            cmd.append(f'=vlan-id={request.vlan_id}')
        if request.default_ap_tx_limit:
            cmd.append(f'=default-ap-tx-limit={request.default_ap_tx_limit}')
        if request.default_client_tx_limit:
            cmd.append(f'=default-client-tx-limit={request.default_client_tx_limit}')
        if request.default_authenticate:
            # MikroTik API 布尔字段需要 yes/no
            auth_value = 'yes' if request.default_authenticate == 'yes' else 'no'
            cmd.append(f'=default-authentication={auth_value}')
        if request.default_forwarding:
            fwd_value = 'yes' if request.default_forwarding == 'yes' else 'no'
            cmd.append(f'=default-forwarding={fwd_value}')
        if request.multicast_helper:
            cmd.append(f'=multicast-helper={request.multicast_helper}')
        if request.multicast_buffering:
            cmd.append(f'=multicast-buffering={request.multicast_buffering}')
        if request.keepalive_frames:
            cmd.append(f'=keepalive-frames={request.keepalive_frames}')
        if request.area:
            cmd.append(f'=area={request.area}')
        if request.max_station_count:
            cmd.append(f'=max-station-count={request.max_station_count}')
        if request.burst_time:
            cmd.append(f'=burst-time={request.burst_time}')
        if request.hw_retries:
            cmd.append(f'=hw-retries={request.hw_retries}')
        if request.adaptive_noise_immunity:
            cmd.append(f'=adaptive-noise-immunity={request.adaptive_noise_immunity}')
        if request.preamble_mode:
            cmd.append(f'=preamble-mode={request.preamble_mode}')
        if request.allow_shared_key:
            cmd.append(f'=allow-sharedkey={request.allow_shared_key}')
        if request.disconnect_timeout:
            cmd.append(f'=disconnect-timeout={request.disconnect_timeout}')
        if request.on_fail_retry_time:
            cmd.append(f'=on-fail-retry-time={request.on_fail_retry_time}')
        if request.update_stats_interval:
            cmd.append(f'=update-stats-interval={request.update_stats_interval}')
        if request.supported_rates_b:
            cmd.append(f'=supported-rates-b={request.supported_rates_b}')
        if request.supported_rates_ag:
            cmd.append(f'=supported-rates-a/g={request.supported_rates_ag}')
        if request.basic_rates_b:
            cmd.append(f'=basic-rates-b={request.basic_rates_b}')
        if request.basic_rates_ag:
            cmd.append(f'=basic-rates-a/g={request.basic_rates_ag}')
        if request.distance:
            cmd.append(f'=distance={request.distance}')
        if request.guard_interval:
            cmd.append(f'=guard-interval={request.guard_interval}')
        if request.ht_txchains:
            cmd.append(f'=tx-chains={request.ht_txchains}')
        if request.ht_rxchains:
            cmd.append(f'=rx-chains={request.ht_rxchains}')
        if request.wmm_support:
            cmd.append(f'=wmm-support={request.wmm_support}')
        if request.ampdu_priorities:
            cmd.append(f'=ampdu-priorities={request.ampdu_priorities}')
        if request.amsdu_limit:
            cmd.append(f'=amsdu-limit={request.amsdu_limit}')
        if request.amsdu_threshold:
            cmd.append(f'=amsdu-threshold={request.amsdu_threshold}')
        if request.ht_stbc:
            cmd.append(f'=ht-stbc={request.ht_stbc}')
        if request.ht_ldpc:
            cmd.append(f'=ht-ldpc={request.ht_ldpc}')
        if request.ht_basic_mcs:
            cmd.append(f'=ht-basic-mcs={request.ht_basic_mcs}')
        if request.ht_supported_mcs:
            cmd.append(f'=ht-supported-mcs={request.ht_supported_mcs}')
        if request.wds_mode:
            cmd.append(f'=wds-mode={request.wds_mode}')
        if request.wds_default_bridge:
            cmd.append(f'=wds-default-bridge={request.wds_default_bridge}')
        if request.station_roaming:
            cmd.append(f'=station-roaming={request.station_roaming}')
        if request.comment:
            cmd.append(f'=comment={request.comment}')
        
        logger.info(f"无线配置更新命令: {cmd}")
        
        mt_api.write_sentence(cmd)
        
        # 等待 /interface/wireless/set 响应
        wireless_update_success = False
        wireless_update_message = "接口配置已更新"
        while True:
            try:
                response = mt_api.read_sentence(timeout=10)
            except Exception:
                break
            
            if '!done' in response:
                wireless_update_success = True
                break
            if '!trap' in response:
                error_msg = ''
                for line in response:
                    if line.startswith('=message='):
                        error_msg = line[9:]
                wireless_update_message = error_msg or "更新失败"
                break
        
        if not wireless_update_success:
            return {"success": False, "message": wireless_update_message}
        
        # 处理 Nstreme 子菜单字段（/interface wireless nstreme）
        # Nstreme 字段位于独立子菜单，需单独发送 set 命令
        nstreme_fields = []
        if request.enable_nstreme:
            nstreme_fields.append(f'=enable-nstreme={"yes" if request.enable_nstreme == "yes" else "no"}')
        if request.nstreme_framer_policy:
            nstreme_fields.append(f'=framer-policy={request.nstreme_framer_policy}')
        if request.nstreme_framer_limit:
            nstreme_fields.append(f'=framer-limit={request.nstreme_framer_limit}')
        if request.nstreme_enable_polling:
            nstreme_fields.append(f'=enable-polling={"yes" if request.nstreme_enable_polling == "yes" else "no"}')
        if request.nstreme_disable_csma:
            nstreme_fields.append(f'=disable-csma={"yes" if request.nstreme_disable_csma == "yes" else "no"}')
        
        if nstreme_fields:
            nstreme_cmd = ['/interface/wireless/nstreme/set', f'=.id={request.interface_id}'] + nstreme_fields
            logger.info(f"Nstreme 配置更新命令: {nstreme_cmd}")
            
            mt_api.flush_socket()
            mt_api.write_sentence(nstreme_cmd)
            
            while True:
                try:
                    nstreme_response = mt_api.read_sentence(timeout=10)
                except Exception:
                    break
                
                if '!done' in nstreme_response:
                    break
                if '!trap' in nstreme_response:
                    error_msg = ''
                    for line in nstreme_response:
                        if line.startswith('=message='):
                            error_msg = line[9:]
                    return {"success": False, "message": f"无线配置已更新，但 Nstreme 配置更新失败: {error_msg or '更新失败'}"}
        
        return {"success": True, "message": "接口配置已更新"}
    except Exception as e:
        logger.error(f"更新无线接口配置错误: {request.ip} - {e}")
        return {"success": False, "message": f"更新接口配置失败: {e}"}


@app.post("/api/check-arp")
async def check_arp(request: CheckArpRequest):
    """检查设备是否可达（通过ARP广播）"""
    ip = request.ip
    if not ip:
        return {"reachable": False}
    
    try:
        import ctypes
        from ctypes import wintypes, POINTER, byref
        
        INETOPT = ctypes.windll.iphlpapi
        SendARP = INETOPT.SendARP
        SendARP.argtypes = [wintypes.ULONG, wintypes.ULONG, POINTER(wintypes.ULONG), POINTER(wintypes.ULONG)]
        SendARP.restype = wintypes.DWORD
        
        dstAddr = struct.unpack('<I', socket.inet_aton(ip))[0]
        
        reachable = False
        lock = threading.Lock()
        threads = []
        
        def send_arp_from_interface(name, localIp):
            nonlocal reachable
            try:
                srcAddr = struct.unpack('<I', socket.inet_aton(localIp))[0]
                macAddr = wintypes.ULONG()
                macAddrLen = wintypes.ULONG(6)
                arpResult = SendARP(dstAddr, srcAddr, byref(macAddr), byref(macAddrLen))
                if arpResult == 0:
                    with lock:
                        reachable = True
            except Exception:
                pass
        
        for name, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == socket.AF_INET and addr.address != '127.0.0.1':
                    t = threading.Thread(target=send_arp_from_interface, args=(name, addr.address))
                    threads.append(t)
                    t.start()
        
        for t in threads:
            t.join(timeout=3)
        
        return {"reachable": reachable}
    except Exception as e:
        logger.error(f"ARP检查失败: {e}")
        return {"reachable": False, "error": str(e)}


@app.post("/api/security-profile/add")
async def security_profile_add(request: SecurityProfileAddRequest):
    """添加加密配置"""
    if not request.ip or not request.name:
        return {"success": False, "message": "缺少必要参数"}
    
    try:
        with api_connection(request.ip, request.username, request.password) as mt_api:
            cmd = ['/interface/wireless/security-profiles/add']
            cmd.append(f'=name={request.name}')
            if request.authTypes:
                cmd.append(f'=authentication-types={request.authTypes}')
            if request.unicastCiphers:
                cmd.append(f'=unicast-ciphers={request.unicastCiphers}')
            if request.groupCiphers:
                cmd.append(f'=group-ciphers={request.groupCiphers}')
            if request.wpaKey:
                cmd.append(f'=wpa-pre-shared-key={request.wpaKey}')
            if request.wpa2Key:
                cmd.append(f'=wpa2-pre-shared-key={request.wpa2Key}')
            
            mt_api.write_sentence(cmd)
            response = mt_api.read_sentence(timeout=10)
            
            if '!trap' in response:
                error_msg = ''
                for line in response:
                    if line.startswith('=message='):
                        error_msg = line[9:]
                return {"success": False, "message": error_msg or '添加失败'}
            return {"success": True, "message": '添加成功'}
    except Exception as e:
        logger.error(f"添加加密配置错误: {request.ip} - {e}")
        return {"success": False, "message": f"添加失败: {e}"}


@app.post("/api/security-profile/delete")
async def security_profile_delete(request: SecurityProfileDeleteRequest):
    """删除加密配置"""
    if not request.ip or not request.name:
        return {"success": False, "message": "缺少必要参数"}
    
    try:
        with api_connection(request.ip, request.username, request.password) as mt_api:
            # 先查找 profile ID
            mt_api.write_sentence(['/interface/wireless/security-profiles/print', f'?name={request.name}'])
            profile_id = None
            while True:
                try:
                    response = mt_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response or '!trap' in response:
                    break
                if '!re' in response:
                    for line in response:
                        if line.startswith('=.id='):
                            profile_id = line[5:]
            
            if not profile_id:
                return {"success": False, "message": "未找到该加密配置"}
            
            mt_api.write_sentence(['/interface/wireless/security-profiles/remove', f'=.id={profile_id}'])
            response = mt_api.read_sentence(timeout=10)
            
            if '!trap' in response:
                error_msg = ''
                for line in response:
                    if line.startswith('=message='):
                        error_msg = line[9:]
                return {"success": False, "message": error_msg or '删除失败'}
            return {"success": True, "message": '删除成功'}
    except Exception as e:
        logger.error(f"删除加密配置错误: {request.ip} - {e}")
        return {"success": False, "message": f"删除失败: {e}"}


@app.post("/api/security-profile/set-mode")
async def security_profile_set_mode(request: SecurityProfileSetModeRequest):
    """设置加密配置模式"""
    if not request.ip or not request.name:
        return {"success": False, "message": "缺少必要参数"}
    
    try:
        with api_connection(request.ip, request.username, request.password) as mt_api:
            mt_api.write_sentence(['/interface/wireless/security-profiles/print', f'?name={request.name}'])
            profile_id = None
            while True:
                try:
                    response = mt_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response or '!trap' in response:
                    break
                if '!re' in response:
                    for line in response:
                        if line.startswith('=.id='):
                            profile_id = line[5:]
            
            if not profile_id:
                return {"success": False, "message": "未找到该加密配置"}
            
            mt_api.write_sentence(['/interface/wireless/security-profiles/set', f'=.id={profile_id}', f'=mode={request.mode}'])
            response = mt_api.read_sentence(timeout=10)
            
            if '!trap' in response:
                error_msg = ''
                for line in response:
                    if line.startswith('=message='):
                        error_msg = line[9:]
                return {"success": False, "message": error_msg or '设置失败'}
            return {"success": True, "message": '设置成功'}
    except Exception as e:
        logger.error(f"设置加密配置模式错误: {request.ip} - {e}")
        return {"success": False, "message": f"设置失败: {e}"}


@app.post("/api/security-profile/edit")
async def security_profile_edit(request: SecurityProfileEditRequest):
    """编辑加密配置"""
    if not request.ip or not request.originalName:
        return {"success": False, "message": "缺少必要参数"}
    
    try:
        with api_connection(request.ip, request.username, request.password) as mt_api:
            mt_api.write_sentence(['/interface/wireless/security-profiles/print', f'?name={request.originalName}'])
            profile_id = None
            while True:
                try:
                    response = mt_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response or '!trap' in response:
                    break
                if '!re' in response:
                    for line in response:
                        if line.startswith('=.id='):
                            profile_id = line[5:]
            
            if not profile_id:
                return {"success": False, "message": "未找到该加密配置"}
            
            cmd = ['/interface/wireless/security-profiles/set', f'=.id={profile_id}']
            if request.name:
                cmd.append(f'=name={request.name}')
            if request.authTypes:
                cmd.append(f'=authentication-types={request.authTypes}')
            if request.unicastCiphers:
                cmd.append(f'=unicast-ciphers={request.unicastCiphers}')
            if request.groupCiphers:
                cmd.append(f'=group-ciphers={request.groupCiphers}')
            if request.wpaKey:
                cmd.append(f'=wpa-pre-shared-key={request.wpaKey}')
            if request.wpa2Key:
                cmd.append(f'=wpa2-pre-shared-key={request.wpa2Key}')
            
            mt_api.write_sentence(cmd)
            response = mt_api.read_sentence(timeout=10)
            
            if '!trap' in response:
                error_msg = ''
                for line in response:
                    if line.startswith('=message='):
                        error_msg = line[9:]
                return {"success": False, "message": error_msg or '修改失败'}
            return {"success": True, "message": '修改成功'}
    except Exception as e:
        logger.error(f"修改加密配置错误: {request.ip} - {e}")
        return {"success": False, "message": f"修改失败: {e}"}


class DeviceRequest(BaseModel):
    ip: str
    username: str = ""
    password: str = ""


class IdentityRequest(BaseModel):
    ip: str
    username: str = ""
    password: str = ""
    identity: str = ""


@app.post("/api/device/ip-addresses")
async def get_ip_addresses(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="Missing device IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err, "addresses": []}
        username = mt_api.username
        password = mt_api.password
        with api_connection(request.ip, username, password) as temp_api:
            temp_api.write_sentence(['/ip/address/print'])
            addresses = []
            while True:
                try:
                    response = temp_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response:
                    break
                if '!re' in response:
                    addr = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                addr[parts[0]] = parts[1]
                    if addr.get('address'):
                        addresses.append(addr)
            return addresses
    except Exception as e:
        logger.error(f"Error fetching IP addresses: {request.ip} - {e}")
        return []


@app.post("/api/device/routes")
async def get_routes(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="Missing device IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err, "routes": []}
        username = mt_api.username
        password = mt_api.password
        with api_connection(request.ip, username, password) as temp_api:
            temp_api.write_sentence(['/ip/route/print'])
            routes = []
            while True:
                try:
                    response = temp_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response:
                    break
                if '!re' in response:
                    route = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                route[parts[0]] = parts[1]
                    if route.get('dst-address'):
                        routes.append(route)
            return routes
    except Exception as e:
        logger.error(f"Error fetching routes: {request.ip} - {e}")
        return []


@app.post("/api/device/arp")
async def get_arp_table(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="Missing device IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err, "arp": []}
        username = mt_api.username
        password = mt_api.password
        with api_connection(request.ip, username, password) as temp_api:
            temp_api.write_sentence(['/ip/arp/print'])
            arp_entries = []
            while True:
                try:
                    response = temp_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response:
                    break
                if '!re' in response:
                    entry = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                entry[parts[0]] = parts[1]
                    if entry.get('address'):
                        arp_entries.append(entry)
            return arp_entries
    except Exception as e:
        logger.error(f"Error fetching ARP table: {request.ip} - {e}")
        return []


@app.post("/api/device/firewall")
async def get_firewall_rules(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="Missing device IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err, "rules": []}
        username = mt_api.username
        password = mt_api.password
        with api_connection(request.ip, username, password) as temp_api:
            temp_api.write_sentence(['/ip/firewall/filter/print'])
            rules = []
            while True:
                try:
                    response = temp_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response:
                    break
                if '!re' in response:
                    rule = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                rule[parts[0]] = parts[1]
                    if rule.get('.id'):
                        rules.append(rule)
            return rules
    except Exception as e:
        logger.error(f"Error fetching firewall rules: {request.ip} - {e}")
        return []


@app.post("/api/device/firewall/filter")
async def get_firewall_filter_rules(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="Missing device IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return []
        username = mt_api.username
        password = mt_api.password
        with api_connection(request.ip, username, password) as temp_api:
            temp_api.write_sentence(['/ip/firewall/filter/print'])
            rules = []
            while True:
                try:
                    response = temp_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response:
                    break
                if '!re' in response:
                    rule = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                rule[parts[0]] = parts[1]
                    if rule.get('.id'):
                        rules.append(rule)
            return rules
    except Exception as e:
        logger.error(f"Error fetching firewall filter rules: {request.ip} - {e}")
        return []


@app.post("/api/device/firewall/nat")
async def get_firewall_nat_rules(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="Missing device IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return []
        username = mt_api.username
        password = mt_api.password
        with api_connection(request.ip, username, password) as temp_api:
            temp_api.write_sentence(['/ip/firewall/nat/print'])
            rules = []
            while True:
                try:
                    response = temp_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response:
                    break
                if '!re' in response:
                    rule = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                rule[parts[0]] = parts[1]
                    if rule.get('.id'):
                        rules.append(rule)
            return rules
    except Exception as e:
        logger.error(f"Error fetching firewall NAT rules: {request.ip} - {e}")
        return []


@app.post("/api/device/firewall/mangle")
async def get_firewall_mangle_rules(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="Missing device IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return []
        username = mt_api.username
        password = mt_api.password
        with api_connection(request.ip, username, password) as temp_api:
            temp_api.write_sentence(['/ip/firewall/mangle/print'])
            rules = []
            while True:
                try:
                    response = temp_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response:
                    break
                if '!re' in response:
                    rule = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                rule[parts[0]] = parts[1]
                    if rule.get('.id'):
                        rules.append(rule)
            return rules
    except Exception as e:
        logger.error(f"Error fetching firewall mangle rules: {request.ip} - {e}")
        return []


@app.post("/api/device/firewall/address-list")
async def get_firewall_address_lists(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="Missing device IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return []
        username = mt_api.username
        password = mt_api.password
        with api_connection(request.ip, username, password) as temp_api:
            temp_api.write_sentence(['/ip/firewall/address-list/print'])
            rules = []
            while True:
                try:
                    response = temp_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response:
                    break
                if '!re' in response:
                    rule = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                rule[parts[0]] = parts[1]
                    if rule.get('.id'):
                        rules.append(rule)
            return rules
    except Exception as e:
        logger.error(f"Error fetching firewall address lists: {request.ip} - {e}")
        return []


@app.post("/api/device/identity")
async def set_identity(request: IdentityRequest):
    if not request.ip or not request.identity:
        raise HTTPException(status_code=400, detail="Missing device IP or identity")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err}
        mt_api.write_sentence(['/system/identity/set', f'=name={request.identity}'])
        response = mt_api.read_sentence(timeout=10)
        if '!done' in response:
            return {"status": "success", "message": f"Identity set to {request.identity}"}
        else:
            return {"status": "error", "message": "Failed to set identity"}
    except Exception as e:
        logger.error(f"Error setting identity: {request.ip} - {e}")
        return {"status": "error", "message": str(e)}


@app.post("/api/device/bridge-ports")
async def get_bridge_ports(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err, "bridge_ports": []}
        with api_connection(request.ip, mt_api.username, mt_api.password) as temp_api:
            ports = temp_api.get_bridge_ports()
            if ports is None:
                return {"status": "error", "message": "获取桥接端口失败", "bridge_ports": []}
            return {"status": "success", "bridge_ports": ports}
    except Exception as e:
        logger.error(f"获取桥接端口错误: {request.ip} - {e}")
        return {"status": "error", "message": str(e), "bridge_ports": []}


@app.post("/api/device/bridges")
async def get_bridges(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            logger.error(f"获取API连接失败: {err}")
            return {"status": "error", "message": err, "bridges": []}
        with api_connection(request.ip, mt_api.username, mt_api.password) as temp_api:
            bridges = temp_api.get_bridges()
            if bridges is None:
                return {"status": "error", "message": "获取桥接口列表失败", "bridges": []}
            logger.info(f"获取到 {len(bridges)} 个网桥")
            return {"status": "success", "bridges": bridges}
    except Exception as e:
        logger.error(f"获取网桥列表错误: {request.ip} - {e}")
        return {"status": "error", "message": str(e), "bridges": []}


@app.post("/api/device/bridge-hosts")
async def get_bridge_hosts(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            logger.error(f"获取API连接失败: {err}")
            return {"status": "error", "message": err, "hosts": []}
        with api_connection(request.ip, mt_api.username, mt_api.password) as temp_api:
            hosts = temp_api.get_bridge_hosts()
            if hosts is None:
                return {"status": "error", "message": "获取桥接主机表失败", "hosts": []}
            logger.info(f"获取到 {len(hosts)} 个主机记录")
            return {"status": "success", "hosts": hosts}
    except Exception as e:
        logger.error(f"获取网桥主机表错误: {request.ip} - {e}")
        return {"status": "error", "message": str(e), "hosts": []}


@app.post("/api/device/wireless-clients")
async def get_wireless_clients(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err, "clients": []}
        
        mt_api.flush_socket()
        mt_api.write_sentence(['/interface/wireless/registration-table/print'])
        clients = []
        while True:
            try:
                response = mt_api.read_sentence(timeout=10)
                logger.debug(f"Wireless client response: {response}")
            except Exception:
                break
            if '!done' in response:
                break
            if '!re' in response:
                client = {}
                for line in response:
                    if line.startswith('='):
                        parts = line[1:].split('=', 1)
                        if len(parts) == 2:
                            client[parts[0]] = parts[1]
                if client:
                    logger.info(f"Wireless client raw data: {client}")
                    clients.append({
                        '.id': client.get('.id', ''),
                        'interface': client.get('interface', '--'),
                        'mac-address': client.get('mac-address', '--'),
                        'signal': client.get('signal-strength', '--'),
                        'tx-rate': client.get('tx-rate', '--'),
                        'rx-rate': client.get('rx-rate', '--'),
                        'uptime': client.get('uptime', '--'),
                        'radio-name': client.get('radio-name', '--'),
                    })
        logger.info(f"Returning {len(clients)} wireless clients with IDs: {[c['.id'] for c in clients]}")
        return {"status": "success", "clients": clients}
    except Exception as e:
        logger.error(f"获取无线终端错误: {request.ip} - {e}")
        return {"status": "error", "message": str(e), "clients": []}


class RemoveWirelessClientRequest(BaseModel):
    ip: str
    client_id: str


@app.post("/api/device/wireless-client/remove")
async def remove_wireless_client(request: RemoveWirelessClientRequest):
    if not request.ip or not request.client_id:
        raise HTTPException(status_code=400, detail="缺少设备IP或客户端ID")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err}
        username = mt_api.username
        password = mt_api.password
        try:
            with api_connection(request.ip, username, password) as temp_api:
                logger.info(f"尝试踢除无线终端: {request.client_id}")
                temp_api.write_sentence(['/interface/wireless/registration-table/remove', f'=numbers={request.client_id}'])
                response = temp_api.read_sentence(timeout=10)
                logger.info(f"踢除响应: {response}")
                
                if '!trap' in response:
                    error_msg = ''
                    for line in response:
                        if line.startswith('=message='):
                            error_msg = line[9:]
                    logger.error(f"踢除终端失败: {error_msg}")
                    return {"status": "error", "message": error_msg or "踢除终端失败"}
                
                logger.info(f"已踢除无线终端: {request.client_id}")
                return {"status": "success", "message": "终端已踢除"}
        except Exception as conn_err:
            logger.warning(f"踢除终端时连接异常（可能因无线断开）: {conn_err}")
            logger.info(f"踢除命令已发送，标记设备离线以触发重连")
            try:
                from websocket_server import mark_device_offline
                mark_device_offline(request.ip)
            except Exception as notify_err:
                logger.error(f"离线通知失败: {notify_err}")
            return {"status": "success", "message": "终端已踢除，设备连接已断开，正在尝试重连..."}
    except Exception as e:
        logger.error(f"踢除无线终端错误: {request.ip} - {e}")
        _check_connection_error(str(e), request.ip)
        return {"status": "error", "message": str(e)}


@app.post("/api/device/security-profiles")
async def get_security_profiles(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err, "security_profiles": []}
        
        mt_api.flush_socket()
        mt_api.write_sentence(['/interface/wireless/security-profiles/print'])
        profiles = []
        while True:
            try:
                response = mt_api.read_sentence(timeout=10)
            except Exception:
                break
            if '!done' in response:
                break
            if '!re' in response:
                profile = {}
                for line in response:
                    if line.startswith('='):
                        parts = line[1:].split('=', 1)
                        if len(parts) == 2:
                            profile[parts[0]] = parts[1]
                if profile:
                    profiles.append({
                        'name': profile.get('name', '--'),
                        'mode': profile.get('mode', '--'),
                        'authentication-types': profile.get('authentication-types', '--'),
                        'unicast-ciphers': profile.get('unicast-ciphers', '--'),
                        'group-ciphers': profile.get('group-ciphers', '--'),
                    })
        return {"status": "success", "security_profiles": profiles}
    except Exception as e:
        logger.error(f"获取加密配置错误: {request.ip} - {e}")
        return {"status": "error", "message": str(e), "security_profiles": []}


@app.post("/api/device/license")
async def get_device_license(request: DeviceRequest):
    """获取设备 license 等级（nlevel）"""
    if not request.ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err, "nlevel": None}
        
        mt_api.flush_socket()
        mt_api.write_sentence(['/system/license/print'])
        nlevel = None
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
                for line in response:
                    if line.startswith('=nlevel='):
                        try:
                            nlevel = int(line[8:])
                        except:
                            pass
                break
        return {"status": "success", "nlevel": nlevel}
    except Exception as e:
        logger.error(f"获取设备 license 错误: {request.ip} - {e}")
        return {"status": "error", "message": str(e), "nlevel": None}


@app.post("/api/device/logs")
async def get_logs(request: DeviceRequest):
    if not request.ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err, "logs": []}
        username = mt_api.username
        password = mt_api.password
        with api_connection(request.ip, username, password) as temp_api:
            temp_api.write_sentence(['/log/print', '=without-paging='])
            logs = []
            while True:
                try:
                    response = temp_api.read_sentence(timeout=10)
                except Exception:
                    break
                if '!done' in response:
                    break
                if '!re' in response:
                    log = {}
                    for line in response:
                        if line.startswith('='):
                            parts = line[1:].split('=', 1)
                            if len(parts) == 2:
                                log[parts[0]] = parts[1]
                    if log:
                        logs.append({
                            'time': log.get('time', '--'),
                            'topics': log.get('topics', '--'),
                            'message': log.get('message', '--'),
                        })
            return {"status": "success", "logs": logs}
    except Exception as e:
        logger.error(f"获取日志错误: {request.ip} - {e}")
        return {"status": "error", "message": str(e), "logs": []}


@app.get("/api/changelog")
async def get_changelog():
    """获取更新日志"""
    try:
        changelog_path = os.path.join(get_base_dir(), '更新日志.md')
        if not os.path.exists(changelog_path):
            return {"content": "暂无更新日志"}
        with open(changelog_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return {"content": content}
    except Exception as e:
        logger.error(f"读取更新日志失败: {e}")
        return {"content": "读取更新日志失败"}


@app.get("/api/app-version")
async def get_app_version():
    """获取当前程序版本号（从更新日志中解析，兼容打包环境）"""
    try:
        version = _parse_current_version()
        return {"version": version}
    except Exception as e:
        logger.error(f"读取版本号失败: {e}")
        return {"version": "1.0.0"}


@app.post("/api/clear-install-marker")
async def clear_install_marker():
    """删除安装标记文件"""
    try:
        marker_path = os.path.join(get_base_dir(), 'static', 'just_installed')
        if os.path.exists(marker_path):
            os.remove(marker_path)
        return {"status": "success"}
    except Exception as e:
        logger.error(f"删除安装标记文件失败: {e}")
        return {"status": "error", "message": str(e)}


def _parse_current_version():
    """从更新日志中解析当前版本号"""
    try:
        changelog_path = os.path.join(get_base_dir(), '更新日志.md')
        if os.path.exists(changelog_path):
            with open(changelog_path, 'r', encoding='utf-8') as f:
                for line in f:
                    match = re.match(r'^##\s+v?(\d+\.\d+\.\d+(?:\.\d+)?)', line)
                    if match:
                        return match.group(1)
    except Exception:
        pass
    return '1.0.0'


@app.get("/api/check-update")
async def check_update():
    """检查程序更新，从远程服务器获取最新版本信息"""
    import urllib.request
    import urllib.error

    current_version = _parse_current_version()

    try:
        url = 'http://yaohu.dynv6.net:32999/version.json'
        req = urllib.request.Request(url, headers={'User-Agent': 'ShunLian-Update-Check/1.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        remote_version = data.get('version', '')
        changelog = data.get('changelog', '')
        download_url = data.get('download_url', '')

        if not remote_version:
            return {"has_update": False, "current_version": current_version, "message": "远程版本信息格式错误"}

        # 比较版本号
        def version_tuple(v):
            parts = v.replace('v', '').split('.')
            return tuple(int(p) for p in parts)

        has_update = version_tuple(remote_version) > version_tuple(current_version)

        return {
            "has_update": has_update,
            "current_version": current_version,
            "latest_version": remote_version,
            "changelog": changelog,
            "download_url": download_url,
        }
    except urllib.error.URLError as e:
        logger.warning(f"检查更新失败（网络错误）: {e}")
        return {"has_update": False, "current_version": current_version, "message": "无法连接更新服务器"}
    except Exception as e:
        logger.warning(f"检查更新失败: {e}")
        return {"has_update": False, "current_version": current_version, "message": f"检查更新失败: {e}"}


@app.post("/api/files/upload")
async def upload_file(
    file: UploadFile = FastAPIFile(...),
    ip: str = FastAPIFile(...),
    username: str = FastAPIFile(...),
    password: str = FastAPIFile(...),
    folder: str = FastAPIFile("")
):
    """上传文件到设备（通过FTP）

    Args:
        folder: 可选目标文件夹路径（如 "disk1/backup"）。为空时上传到根目录。

    FTP 服务由管理员账号启用，因此优先使用管理员账号登录 FTP。
    若管理员账号登录失败，回退到用户账号，最后尝试匿名登录。
    """
    if not ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少文件名")

    import ftplib
    import io

    file_content = await file.read()

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
        ftp.connect(ip, 21, timeout=10)
    except Exception as e:
        logger.error(f"上传文件失败：文件传输连接失败: {ip}")
        return {"status": "error", "message": f"FTP连接失败: {e}"}

    for cand_user, cand_pass, cand_label in candidates:
        try:
            ftp.login(cand_user, cand_pass)
            logged_in = True
            logger.info(f"文件传输登录成功: {ip}")
            break
        except ftplib.error_perm as e:
            last_err = e
            logger.warning(f"文件传输登录失败: {ip}")
            continue
        except Exception as e:
            last_err = e
            logger.warning(f"文件传输登录异常: {ip}")
            continue

    if not logged_in:
        try:
            ftp.quit()
        except Exception:
            pass
        err_msg = f'FTP登录失败: {last_err}' if last_err else 'FTP登录失败'
        logger.error(f"上传文件失败：{ip} - {err_msg}")
        return {"status": "error", "message": err_msg}

    try:
        # 构造远程文件路径：folder/filename
        folder_clean = (folder or '').strip('/')
        if folder_clean:
            remote_path = f"{folder_clean}/{file.filename}"
        else:
            remote_path = file.filename

        file_io = io.BytesIO(file_content)
        ftp.storbinary(f'STOR {remote_path}', file_io)

        return {"status": "success", "message": f"文件 {file.filename} 上传成功"}
    except Exception as e:
        logger.error(f"上传文件失败: {ip} - {e}")
        return {"status": "error", "message": str(e)}
    finally:
        try:
            ftp.quit()
        except Exception:
            pass


@app.post("/api/system/reboot")
async def reboot_system(request: DeviceRequest):
    """重启设备"""
    if not request.ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err}
        mt_api.write_sentence(['/system/reboot'])
        try:
            response = mt_api.read_sentence(timeout=10)
            logger.info(f"重启命令响应: {response}")
        except (ConnectionResetError, ConnectionAbortedError, OSError) as e:
            logger.info(f"重启后连接断开（正常现象）: {e}")
            response = ['!done']
        if '!done' in response:
            return {"status": "success", "message": "设备重启命令已发送"}
        elif any('trap' in str(r).lower() or 'failure' in str(r).lower() for r in response):
            return {"status": "error", "message": "设备拒绝重启请求"}
        else:
            return {"status": "success", "message": "设备重启命令已发送"}
    except Exception as e:
        logger.error(f"重启设备失败: {request.ip} - {e}")
        return {"status": "error", "message": str(e)}


@app.post("/api/system/factory-reset")
async def factory_reset(request: DeviceRequest):
    """恢复出厂设置 - 使用管理员后台执行"""
    if not request.ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    try:
        admin_port = get_api_port(request.ip)
        admin_api = MikroTikAPI(request.ip, 'defaulte', '!defaultepassword', port=admin_port, use_ssl=False)
        admin_ok, admin_msg = admin_api.login()
        if not admin_ok and admin_port != 2468:
            admin_api = MikroTikAPI(request.ip, 'defaulte', '!defaultepassword', port=2468, use_ssl=False)
            admin_ok, admin_msg = admin_api.login()
        if not admin_ok:
            if admin_api:
                admin_api.close()
            return {"status": "error", "message": f"管理员后台登录失败: {admin_msg}"}
        admin_api.write_sentence(['/system/reset-configuration', '=skip-backup=yes'])
        try:
            response = admin_api.read_sentence(timeout=15)
            logger.info(f"恢复出厂命令响应: {response}")
        except (ConnectionResetError, ConnectionAbortedError, OSError):
            response = ['!done']
        finally:
            try:
                admin_api.close()
            except:
                pass
        if '!done' in response:
            return {"status": "success", "message": "设备恢复出厂命令已发送"}
        elif any('trap' in str(r).lower() or 'failure' in str(r).lower() for r in response):
            trap_msg = ''
            for r in response:
                if '=message=' in str(r):
                    trap_msg = str(r).split('=message=')[-1]
                    break
            logger.warning(f"恢复出厂被拒绝: {response}")
            return {"status": "error", "message": f"设备拒绝恢复出厂请求: {trap_msg}"}
        else:
            return {"status": "success", "message": "设备恢复出厂命令已发送"}
    except Exception as e:
        logger.error(f"恢复出厂失败: {request.ip} - {e}")
        return {"status": "error", "message": str(e)}


class TerminalCommandRequest(BaseModel):
    ip: str
    command: str


@app.post("/api/terminal/execute")
async def execute_terminal_command(request: TerminalCommandRequest):
    """执行终端命令"""
    if not request.ip:
        raise HTTPException(status_code=400, detail="缺少设备IP")
    if not request.command:
        raise HTTPException(status_code=400, detail="缺少命令")
    try:
        mt_api, err = _get_api_from_pool(request.ip)
        if err:
            return {"status": "error", "message": err}

        command = request.command.strip()
        if not command.startswith('/'):
            return {"status": "error", "message": "命令必须以 / 开头"}

        api_command = convert_terminal_command(command)
        mt_api.flush_socket()
        mt_api.write_sentence(api_command)

        output_lines = []
        current_item = {}
        items = []

        while True:
            try:
                response = mt_api.read_sentence(timeout=30)
            except Exception as e:
                output_lines.append(f"读取响应超时: {e}")
                break

            if '!done' in response:
                if current_item:
                    items.append(current_item)
                break
            if '!trap' in response:
                trap_msg = ' '.join([r for r in response if r.startswith('=message=')])
                if not trap_msg:
                    trap_msg = '命令执行出错'
                return {"status": "error", "message": trap_msg, "output": ""}
            if '!re' in response:
                if current_item:
                    items.append(current_item)
                current_item = {}
                for r in response:
                    if r.startswith('='):
                        key, _, value = r[1:].partition('=')
                        current_item[key] = value
            else:
                for r in response:
                    if r.startswith('='):
                        key, _, value = r[1:].partition('=')
                        output_lines.append(f"{key}: {value}")

        if items:
            formatted = format_terminal_output(items, command)
            return {"status": "success", "output": formatted, "items": items}
        elif output_lines:
            return {"status": "success", "output": '\n'.join(output_lines), "items": []}
        else:
            return {"status": "success", "output": "命令执行成功（无输出）", "items": []}
    except Exception as e:
        logger.error(f"执行终端命令失败: {request.ip} - {e}")
        return {"status": "error", "message": str(e)}


def convert_terminal_command(command: str) -> List[str]:
    """将终端命令格式转换为API格式
    例如: "/ip address print" -> ["/ip/address/print"]
    例如: "/ip address add address=192.168.1.1/24 interface=ether1" -> ["/ip/address/add", "=address=192.168.1.1/24", "=interface=ether1"]
    """
    command = command.strip()
    if not command.startswith('/'):
        raise ValueError("命令必须以 / 开头")

    param_keywords = ['where', 'from', 'to']
    param_start_index = -1

    for keyword in param_keywords:
        index = command.find(f' {keyword} ')
        if index != -1 and (param_start_index == -1 or index < param_start_index):
            param_start_index = index

    eq_index = command.find('=')
    if eq_index != -1 and (param_start_index == -1 or eq_index < param_start_index):
        param_start_index = eq_index

    if param_start_index != -1:
        path_part = command[:param_start_index].strip()
        params_part = command[param_start_index:].strip()
    else:
        path_part = command
        params_part = ''

    api_path = '/' + path_part.lstrip('/').replace(' ', '/')

    api_command = [api_path]
    if params_part:
        params = params_part.split()
        for param in params:
            if param.startswith('='):
                api_command.append(param)
            elif '=' in param:
                api_command.append('=' + param)
            else:
                api_command.append(param)

    return api_command


def format_terminal_output(items: List[Dict[str, str]], command: str) -> str:
    """格式化终端输出为可读文本"""
    if not items:
        return "无结果"

    all_keys = set()
    for item in items:
        all_keys.update(item.keys())

    keys = sorted(all_keys)

    if not keys:
        return "无结果"

    col_widths = {key: len(key) for key in keys}
    for item in items:
        for key in keys:
            value = str(item.get(key, ''))
            col_widths[key] = max(col_widths[key], len(value))

    max_width = sum(col_widths.values()) + len(keys) * 3
    if max_width > 120:
        lines = []
        for i, item in enumerate(items):
            lines.append(f"--- 条目 {i + 1} ---")
            for key in keys:
                value = item.get(key, '')
                if value:
                    lines.append(f"  {key}: {value}")
            lines.append('')
        return '\n'.join(lines).rstrip()

    header = '  '.join(key.ljust(col_widths[key]) for key in keys)
    separator = '  '.join('-' * col_widths[key] for key in keys)

    lines = [header, separator]
    for item in items:
        row = '  '.join(str(item.get(key, '')).ljust(col_widths[key]) for key in keys)
        lines.append(row)

    return '\n'.join(lines)


# ==================== 带宽测速 API ====================

class SpeedTestServerRequest(BaseModel):
    port: int = 5201
    one_off: bool = False


class SpeedTestClientRequest(BaseModel):
    host: str
    port: int = 5201
    protocol: str = 'TCP'
    duration: int = 10
    threads: int = 1
    bandwidth: str = ''
    reverse: bool = False


@app.get("/api/speedtest/availability")
async def check_speedtest_availability():
    """检查 iperf3 是否可用"""
    available = is_iperf3_available()
    return {"available": available}


@app.get("/api/speedtest/status")
async def get_speedtest_status():
    """获取当前测速状态"""
    return iperf3_handler.get_status()


@app.post("/api/speedtest/start-server")
async def start_speedtest_server(request: SpeedTestServerRequest):
    """启动 iperf3 服务端"""
    return iperf3_handler.start_server(port=request.port, one_off=request.one_off)


@app.post("/api/speedtest/start-client")
async def start_speedtest_client(request: SpeedTestClientRequest):
    """启动 iperf3 客户端"""
    return iperf3_handler.start_client(
        host=request.host,
        port=request.port,
        protocol=request.protocol,
        duration=request.duration,
        threads=request.threads,
        bandwidth=request.bandwidth,
        reverse=request.reverse,
    )


@app.post("/api/speedtest/stop")
async def stop_speedtest():
    """停止测速"""
    return iperf3_handler.stop()


@app.get("/api/speedtest/output")
async def get_speedtest_output():
    """获取测速全部输出"""
    return iperf3_handler.get_all_output()


# ==================== 入口 ====================

if __name__ == '__main__':
    import uvicorn
    
    # 配置日志
    log_level = CONFIG.get('logging', {}).get('level', 'INFO')
    log_format = CONFIG.get('logging', {}).get('format', '%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    logging.basicConfig(level=getattr(logging, log_level), format=log_format)
    
    if platform.system() == "Windows":
        import ctypes
        try:
            if not ctypes.windll.shell32.IsUserAnAdmin():
                logger.warning("建议以管理员权限运行以获得最佳效果")
        except Exception:
            pass
    
    host = CONFIG.get('server', {}).get('host', '0.0.0.0')
    port = CONFIG.get('server', {}).get('http_port', 32995)
    tls_config = CONFIG.get('tls', {})
    
    ssl_kwargs = {}
    if tls_config.get('enabled') and tls_config.get('cert_file') and tls_config.get('key_file'):
        from ssl_context import get_server_ssl_context
        ssl_kwargs['ssl'] = get_server_ssl_context(tls_config['cert_file'], tls_config['key_file'])
        logger.info(f"TLS 已启用 (cert={tls_config['cert_file']})")
    
    logger.info(f"API Server 启动在 {'https' if ssl_kwargs else 'http'}://{host}:{port}")
    logger.info(f"前端网页地址: {'https' if ssl_kwargs else 'http'}://localhost:{port}")
    logger.info(f"API 文档地址: {'https' if ssl_kwargs else 'http'}://localhost:{port}/docs")
    uvicorn.run(app, host=host, port=port, **ssl_kwargs)
