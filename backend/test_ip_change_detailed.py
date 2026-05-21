#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试IP地址修改功能 - 详细版本
设备IP: 192.168.5.144
用户名: admin
密码: 123456
目标: 修改 ether3 接口的 IP 为 192.168.5.108/24
"""

import sys
import os
import time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mikrotik_api import MikroTikAPI
import re

def get_ip_addresses(api):
    """获取所有IP地址"""
    api.write_sentence(['/ip/address/print'])
    
    addresses = []
    while True:
        try:
            response = api.read_sentence(timeout=10)
        except Exception as e:
            print(f"❌ 读取响应失败: {e}")
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

def test_ip_change():
    device_ip = '192.168.5.144'
    username = 'admin'
    password = '123456'
    target_interface = 'ether3'
    new_ip = '192.168.5.108/24'
    
    print(f"=" * 60)
    print(f"测试IP地址修改功能")
    print(f"=" * 60)
    print(f"设备IP: {device_ip}")
    print(f"用户名: {username}")
    print(f"目标接口: {target_interface}")
    print(f"新IP地址: {new_ip}")
    print(f"=" * 60)
    
    api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
    
    print("\n[步骤1] 尝试登录设备...")
    success, message = api.login()
    if not success:
        print(f"❌ 登录失败: {message}")
        return False
    print(f"✅ 登录成功: {message}")
    
    print(f"\n[步骤2] 获取当前IP地址列表...")
    addresses = get_ip_addresses(api)
    
    print(f"\n找到 {len(addresses)} 个IP地址:")
    print("-" * 60)
    for addr in addresses:
        iface = addr.get('interface', 'N/A')
        ip_addr = addr.get('address', 'N/A')
        addr_id = addr.get('.id', 'N/A')
        disabled = addr.get('disabled', 'false')
        status = "禁用" if disabled == 'true' else "启用"
        print(f"ID: {addr_id:10s} | 接口: {iface:15s} | IP: {ip_addr:20s} | 状态: {status}")
    print("-" * 60)
    
    target_addr = None
    for addr in addresses:
        if addr.get('interface') == target_interface:
            target_addr = addr
            break
    
    if not target_addr:
        print(f"\n❌ 未找到接口 {target_interface} 的IP地址记录")
        return False
    
    print(f"\n✅ 找到目标接口 {target_interface} 的IP地址记录:")
    print(f"  ID: {target_addr.get('.id')}")
    print(f"  当前IP: {target_addr.get('address')}")
    print(f"  接口: {target_addr.get('interface')}")
    
    old_ip = target_addr.get('address')
    if old_ip == new_ip:
        print(f"\n⚠️ IP地址已经是目标值 {new_ip}，无需修改")
        return True
    
    print(f"\n[步骤3] 修改IP地址...")
    addr_id = target_addr.get('.id')
    command = ['/ip/address/set', f'=.id={addr_id}', f'=address={new_ip}']
    print(f"执行命令: {' '.join(command)}")
    api.write_sentence(command)
    
    try:
        response = api.read_sentence(timeout=10)
        print(f"响应: {response}")
        
        if '!trap' in response:
            error_msg = ''.join([line for line in response if line.startswith('=message=')])
            error_msg = error_msg.replace('=message=', '') if error_msg else '修改失败'
            print(f"❌ 修改失败: {error_msg}")
            return False
        else:
            print(f"✅ 修改命令执行成功")
            
            print(f"\n[步骤4] 等待设备更新...")
            time.sleep(2)
            
            print(f"\n[步骤5] 验证修改结果...")
            verify_addresses = get_ip_addresses(api)
            
            print(f"\n当前IP地址列表:")
            print("-" * 60)
            for addr in verify_addresses:
                iface = addr.get('interface', 'N/A')
                ip_addr = addr.get('address', 'N/A')
                addr_id = addr.get('.id', 'N/A')
                disabled = addr.get('disabled', 'false')
                status = "禁用" if disabled == 'true' else "启用"
                print(f"ID: {addr_id:10s} | 接口: {iface:15s} | IP: {ip_addr:20s} | 状态: {status}")
            print("-" * 60)
            
            verify_addr = None
            for addr in verify_addresses:
                if addr.get('interface') == target_interface:
                    verify_addr = addr
                    break
            
            if verify_addr:
                updated_ip = verify_addr.get('address')
                print(f"\n验证结果:")
                print(f"  接口: {target_interface}")
                print(f"  原IP: {old_ip}")
                print(f"  新IP: {updated_ip}")
                print(f"  期望: {new_ip}")
                
                if updated_ip == new_ip:
                    print(f"\n✅ 验证成功: IP地址已正确修改为 {new_ip}")
                    return True
                else:
                    print(f"\n❌ 验证失败: IP地址不匹配")
                    return False
            else:
                print(f"\n❌ 验证失败: 未找到接口 {target_interface} 的IP地址")
                return False
    except Exception as e:
        print(f"❌ 修改失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        api.close()

if __name__ == '__main__':
    try:
        result = test_ip_change()
        print(f"\n{'=' * 60}")
        if result:
            print("测试结果: ✅ 成功")
        else:
            print("测试结果: ❌ 失败")
        print(f"{'=' * 60}")
    except Exception as e:
        print(f"\n{'=' * 60}")
        print(f"测试异常: {e}")
        import traceback
        traceback.print_exc()
        print(f"{'=' * 60}")
