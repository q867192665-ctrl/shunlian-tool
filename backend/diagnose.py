#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
诊断脚本 - 检查设备连接状态
"""

import sys
import os
import socket
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def check_port(host, port, timeout=3):
    """检查端口是否开放"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception:
        return False

def diagnose():
    device_ip = '192.168.5.144'
    
    print(f"=" * 60)
    print(f"设备诊断")
    print(f"=" * 60)
    print(f"设备IP: {device_ip}")
    print(f"=" * 60)
    
    print(f"\n[检查1] Ping测试...")
    import subprocess
    try:
        result = subprocess.run(['ping', '-n', '2', device_ip], 
                              capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print(f"✅ 设备可以ping通")
        else:
            print(f"❌ 设备无法ping通")
            print(f"输出: {result.stdout}")
    except Exception as e:
        print(f"❌ Ping测试失败: {e}")
    
    print(f"\n[检查2] 端口扫描...")
    ports = {
        22: 'SSH',
        23: 'Telnet',
        80: 'HTTP',
        443: 'HTTPS (REST API)',
        8728: 'Legacy API',
        8729: 'Legacy SSL API',
        8291: 'WinBox'
    }
    
    for port, service in ports.items():
        if check_port(device_ip, port):
            print(f"✅ 端口 {port:5d} 开放 ({service})")
        else:
            print(f"❌ 端口 {port:5d} 关闭 ({service})")
    
    print(f"\n[检查3] 尝试连接Legacy API...")
    from mikrotik_api import MikroTikAPI
    
    for use_ssl in [False, True]:
        port = 8729 if use_ssl else 8728
        ssl_str = "SSL" if use_ssl else "非SSL"
        print(f"\n尝试 {ssl_str} 连接 (端口 {port})...")
        
        try:
            api = MikroTikAPI(device_ip, 'admin', '123456', port=port, use_ssl=use_ssl)
            success, message = api.login()
            
            if success:
                print(f"✅ {ssl_str} 连接成功: {message}")
                
                print(f"\n获取系统信息...")
                sys_info = api.get_system_info()
                if sys_info:
                    print(f"  版本: {sys_info.get('version', 'N/A')}")
                    print(f"  板卡: {sys_info.get('board-name', 'N/A')}")
                    print(f"  正常运行时间: {sys_info.get('uptime', 'N/A')}")
                
                print(f"\n获取IP地址列表...")
                api.write_sentence(['/ip/address/print'])
                
                addresses = []
                while True:
                    try:
                        response = api.read_sentence(timeout=10)
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
                
                print(f"\n当前IP地址配置:")
                print("-" * 60)
                for addr in addresses:
                    iface = addr.get('interface', 'N/A')
                    ip_addr = addr.get('address', 'N/A')
                    addr_id = addr.get('.id', 'N/A')
                    disabled = addr.get('disabled', 'false')
                    status = "禁用" if disabled == 'true' else "启用"
                    print(f"ID: {addr_id:10s} | 接口: {iface:15s} | IP: {ip_addr:20s} | 状态: {status}")
                print("-" * 60)
                
                api.close()
                return True
            else:
                print(f"❌ {ssl_str} 连接失败: {message}")
        except Exception as e:
            print(f"❌ {ssl_str} 连接异常: {e}")
    
    return False

if __name__ == '__main__':
    try:
        result = diagnose()
        print(f"\n{'=' * 60}")
        if result:
            print("诊断结果: ✅ 设备连接正常")
        else:
            print("诊断结果: ❌ 设备无法连接")
        print(f"{'=' * 60}")
    except Exception as e:
        print(f"\n{'=' * 60}")
        print(f"诊断异常: {e}")
        import traceback
        traceback.print_exc()
        print(f"{'=' * 60}")
