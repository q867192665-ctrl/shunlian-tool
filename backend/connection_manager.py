#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网络设备 API 连接管理器
解决多连接并发、连接复用、Tag 隔离、心跳保活等问题
"""

from __future__ import annotations

import asyncio
import threading
import time
import logging
from typing import Any, Callable, Optional
from mikrotik_api import MikroTikAPI

logger = logging.getLogger(__name__)

# 连接角色定义
CONNECTION_ROLE_INTERFACE = 'interface'
CONNECTION_ROLE_WIRELESS = 'wireless'
CONNECTION_ROLE_GENERAL = 'general'

# 命令优先级
PRIORITY_USER_ACTION = 0
PRIORITY_POLLING = 1
PRIORITY_KEEPALIVE = 2

# 配置常量
MAX_CONNECTIONS_PER_DEVICE = 3
HEARTBEAT_INTERVAL = 20
HEARTBEAT_TIMEOUT = 10
COMMAND_TIMEOUT = 15
MAX_RECONNECT_ATTEMPTS = 3
RECONNECT_DELAY = 2
IDLE_TIMEOUT = 300


class TagRouter:
    """Tag 路由器：将响应分发到正确的处理函数"""
    
    def __init__(self):
        self._handlers: dict[str, Callable] = {}
        self._lock = threading.Lock()
        self._seq = 0
    
    def generate_tag(self, prefix: str) -> str:
        """生成唯一 tag"""
        self._seq += 1
        return f"{prefix}_{int(time.time())}_{self._seq}"
    
    def register(self, tag: str, handler: Callable) -> None:
        """注册响应处理器"""
        with self._lock:
            self._handlers[tag] = handler
    
    def unregister(self, tag: str) -> Optional[Callable]:
        """注销响应处理器"""
        with self._lock:
            return self._handlers.pop(tag, None)
    
    def dispatch(self, tag: str, response: list[str]) -> bool:
        """分发响应到处理器，返回是否找到处理器"""
        with self._lock:
            handler = self._handlers.get(tag)
        if handler:
            try:
                handler(response)
                return True
            except Exception as e:
                logger.error(f"Tag 处理器异常 [{tag}]: {e}")
                return False
        return False


class CommandQueue:
    """命令队列：支持优先级调度"""
    
    def __init__(self):
        self._queue: list[tuple[int, float, dict]] = []
        self._lock = threading.Lock()
        self._event = threading.Event()
    
    def enqueue(self, command: dict, priority: int) -> None:
        """添加命令到队列"""
        with self._lock:
            self._queue.append((priority, time.time(), command))
            self._queue.sort(key=lambda x: (x[0], x[1]))
            self._event.set()
    
    def dequeue(self) -> Optional[dict]:
        """获取最高优先级的命令"""
        with self._lock:
            if self._queue:
                _, _, command = self._queue.pop(0)
                if not self._queue:
                    self._event.clear()
                return command
            return None
    
    def wait(self, timeout: float = 1.0) -> bool:
        """等待队列中有命令"""
        return self._event.wait(timeout)
    
    def clear(self) -> None:
        """清空队列"""
        with self._lock:
            self._queue.clear()
            self._event.clear()
    
    @property
    def size(self) -> int:
        with self._lock:
            return len(self._queue)


class DeviceConnection:
    """设备 API 连接封装"""
    
    def __init__(self, role: str, device_ip: str, username: str, password: str):
        self.role = role
        self.device_ip = device_ip
        self.username = username
        self.password = password
        self.api: Optional[MikroTikAPI] = None
        self.write_lock = asyncio.Lock()
        self.tag_router = TagRouter()
        self.command_queue = CommandQueue()
        self.ref_count = 0
        self.last_activity = time.time()
        self.is_connected = False
        self.is_reconnecting = False
        self.processor_task: Optional[asyncio.Task] = None
    
    async def connect(self) -> tuple[bool, str]:
        """建立 API 连接"""
        try:
            self.api = MikroTikAPI(self.device_ip, self.username, self.password, port=8728, use_ssl=False)
            success, message = self.api.login()
            if success:
                self.is_connected = True
                self.last_activity = time.time()
                logger.info(f"[连接管理器] {self.role} 连接已建立: {self.device_ip}")
                return True, message
            else:
                logger.error(f"[连接管理器] {self.role} 连接失败: {self.device_ip} - {message}")
                return False, message
        except Exception as e:
            logger.error(f"[连接管理器] {self.role} 连接异常: {self.device_ip} - {e}")
            return False, str(e)
    
    async def disconnect(self) -> None:
        """关闭 API 连接"""
        self.is_connected = False
        if self.processor_task:
            self.processor_task.cancel()
            try:
                await self.processor_task
            except asyncio.CancelledError:
                pass
            self.processor_task = None
        if self.api:
            try:
                self.api.close()
                logger.info(f"[连接管理器] {self.role} 连接已关闭: {self.device_ip}")
            except Exception as e:
                logger.error(f"[连接管理器] 关闭连接失败: {e}")
            self.api = None
        self.command_queue.clear()
    
    async def send_command(self, command: list[str], tag: str) -> None:
        """发送命令（带 tag）"""
        if not self.api or not self.is_connected:
            raise ConnectionError(f"连接未建立: {self.device_ip}")
        
        async with self.write_lock:
            try:
                tagged_command = command + [f'=.tag={tag}']
                self.api.write_sentence(tagged_command)
                self.last_activity = time.time()
            except Exception as e:
                logger.error(f"[连接管理器] 发送命令失败 [{tag}]: {e}")
                raise
    
    def process_response(self, response: list[str]) -> bool:
        """处理响应，根据 tag 分发"""
        tag = None
        for line in response:
            if line.startswith('=.tag='):
                tag = line[6:]
                break
        
        if tag:
            return self.tag_router.dispatch(tag, response)
        return False
    
    async def reconnect(self) -> bool:
        """重连"""
        if self.is_reconnecting:
            return False
        self.is_reconnecting = True
        
        try:
            await self.disconnect()
            for attempt in range(MAX_RECONNECT_ATTEMPTS):
                logger.info(f"[连接管理器] 重连尝试 ({attempt + 1}/{MAX_RECONNECT_ATTEMPTS}): {self.device_ip}")
                success, _ = await self.connect()
                if success:
                    self.is_reconnecting = False
                    return True
                await asyncio.sleep(RECONNECT_DELAY)
            logger.error(f"[连接管理器] 重连失败: {self.device_ip}")
            self.is_reconnecting = False
            return False
        except Exception as e:
            logger.error(f"[连接管理器] 重连异常: {e}")
            self.is_reconnecting = False
            return False


class ConnectionManager:
    """全局连接管理器"""
    
    def __init__(self):
        self._devices: dict[str, dict[str, DeviceConnection]] = {}
        self._lock = threading.Lock()
        self._write_locks: dict[str, asyncio.Lock] = {}
        self._heartbeat_tasks: dict[str, asyncio.Task] = {}
    
    def _get_device_connections(self, device_ip: str) -> dict[str, DeviceConnection]:
        """获取设备的所有连接"""
        with self._lock:
            if device_ip not in self._devices:
                self._devices[device_ip] = {}
            return self._devices[device_ip]
    
    async def acquire(self, device_ip: str, role: str, username: str, password: str) -> DeviceConnection:
        """获取或创建连接（引用计数 +1）"""
        connections = self._get_device_connections(device_ip)
        
        if role in connections:
            conn = connections[role]
            conn.ref_count += 1
            conn.last_activity = time.time()
            logger.debug(f"[连接管理器] 复用连接: {device_ip}/{role} (ref={conn.ref_count})")
            return conn
        
        # 创建新连接
        conn = DeviceConnection(role, device_ip, username, password)
        success, _ = await conn.connect()
        if not success:
            raise ConnectionError(f"无法建立 {role} 连接: {device_ip}")
        
        connections[role] = conn
        conn.ref_count = 1
        logger.info(f"[连接管理器] 创建连接: {device_ip}/{role}")
        return conn
    
    def release(self, device_ip: str, role: str) -> None:
        """释放连接（引用计数 -1）"""
        connections = self._get_device_connections(device_ip)
        
        if role not in connections:
            return
        
        conn = connections[role]
        conn.ref_count -= 1
        conn.last_activity = time.time()
        logger.debug(f"[连接管理器] 释放连接: {device_ip}/{role} (ref={conn.ref_count})")
        
        if conn.ref_count <= 0:
            # 引用计数为 0，标记为可清理
            logger.info(f"[连接管理器] 连接空闲: {device_ip}/{role}")
    
    async def cleanup_idle(self) -> None:
        """清理空闲连接"""
        now = time.time()
        to_remove = []
        
        with self._lock:
            for device_ip, connections in self._devices.items():
                for role, conn in list(connections.items()):
                    if conn.ref_count <= 0 and (now - conn.last_activity) > IDLE_TIMEOUT:
                        to_remove.append((device_ip, role))
        
        for device_ip, role in to_remove:
            connections = self._get_device_connections(device_ip)
            if role in connections:
                conn = connections[role]
                await conn.disconnect()
                del connections[role]
                logger.info(f"[连接管理器] 清理空闲连接: {device_ip}/{role}")
    
    async def cleanup_device(self, device_ip: str) -> None:
        """清理设备的所有连接"""
        with self._lock:
            connections = self._devices.pop(device_ip, {})
        
        for role, conn in connections.items():
            await conn.disconnect()
            logger.info(f"[连接管理器] 清理设备连接: {device_ip}/{role}")
        
        if device_ip in self._heartbeat_tasks:
            self._heartbeat_tasks[device_ip].cancel()
            del self._heartbeat_tasks[device_ip]
    
    def get_connection(self, device_ip: str, role: str) -> Optional[DeviceConnection]:
        """获取连接（不增加引用计数）"""
        connections = self._get_device_connections(device_ip)
        return connections.get(role)
    
    def get_active_connection_count(self, device_ip: str) -> int:
        """获取设备的活跃连接数"""
        connections = self._get_device_connections(device_ip)
        return sum(1 for conn in connections.values() if conn.ref_count > 0)


# 全局单例
connection_manager = ConnectionManager()
