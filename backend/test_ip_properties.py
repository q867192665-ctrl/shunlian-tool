#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试IP地址接口属性修改功能
设备IP: 192.168.5.144
用户名: admin
密码: 123456
测试内容: 禁用/启用、修改网络地址、修改接口绑定
"""

import sys
import os
import time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mikrotik_api import MikroTikAPI

def get_ip_addresses(api):
    """获取所有IP地址"""
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
    
    return addresses

def print_addresses(addresses, title="当前IP地址列表"):
    print(f"\n{title}:")
    print("-" * 80)
    for addr in addresses:
        iface = addr.get('interface', 'N/A')
        ip_addr = addr.get('address', 'N/A')
        addr_id = addr.get('.id', 'N/A')
        disabled = addr.get('disabled', 'false')
        network = addr.get('network', 'N/A')
        status = "禁用" if disabled == 'true' else "启用"
        print(f"ID: {addr_id:6s} | 接口: {iface:15s} | IP: {ip_addr:20s} | 网络: {network:20s} | 状态: {status}")
    print("-" * 80)

def test_disable_enable(api, target_id):
    """测试禁用和启用IP地址"""
    print(f"\n{'=' * 60}")
    print(f"测试1: 禁用/启用IP地址")
    print(f"{'=' * 60}")
    
    print(f"\n[步骤1] 禁用IP地址 ID={target_id}")
    command = ['/ip/address/set', f'=.id={target_id}', '=disabled=yes']
    print(f"执行命令: {' '.join(command)}")
    api.write_sentence(command)
    
    try:
        response = api.read_sentence(timeout=10)
        print(f"响应: {response}")
        
        if '!trap' in response:
            error_msg = ''.join([line for line in response if line.startswith('=message=')])
            error_msg = error_msg.replace('=message=', '') if error_msg else '禁用失败'
            print(f"❌ 禁用失败: {error_msg}")
            return False
        else:
            print(f"✅ 禁用成功")
            
            time.sleep(1)
            addresses = get_ip_addresses(api)
            print_addresses(addresses, "禁用后的IP地址列表")
            
            print(f"\n[步骤2] 重新启用IP地址 ID={target_id}")
            command = ['/ip/address/set', f'=.id={target_id}', '=disabled=no']
            print(f"执行命令: {' '.join(command)}")
            api.write_sentence(command)
            
            response = api.read_sentence(timeout=10)
            print(f"响应: {response}")
            
            if '!trap' in response:
                error_msg = ''.join([line for line in response if line.startswith('=message=')])
                error_msg = error_msg.replace('=message=', '') if error_msg else '启用失败'
                print(f"❌ 启用失败: {error_msg}")
                return False
            else:
                print(f"✅ 启用成功")
                
                time.sleep(1)
                addresses = get_ip_addresses(api)
                print_addresses(addresses, "启用后的IP地址列表")
                return True
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        return False

def test_change_network(api, target_id, new_network):
    """测试修改网络地址"""
    print(f"\n{'=' * 60}")
    print(f"测试2: 修改网络地址")
    print(f"{'=' * 60}")
    
    print(f"\n[步骤1] 获取当前配置")
    addresses = get_ip_addresses(api)
    target_addr = None
    for addr in addresses:
        if addr.get('.id') == target_id:
            target_addr = addr
            break
    
    if not target_addr:
        print(f"❌ 未找到ID={target_id}的IP地址")
        return False
    
    old_network = target_addr.get('network', 'N/A')
    print(f"当前网络地址: {old_network}")
    print(f"目标网络地址: {new_network}")
    
    print(f"\n[步骤2] 修改网络地址")
    command = ['/ip/address/set', f'=.id={target_id}', f'=network={new_network}']
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
            print(f"✅ 修改成功")
            
            time.sleep(1)
            addresses = get_ip_addresses(api)
            print_addresses(addresses, "修改后的IP地址列表")
            
            verify_addr = None
            for addr in addresses:
                if addr.get('.id') == target_id:
                    verify_addr = addr
                    break
            
            if verify_addr:
                updated_network = verify_addr.get('network', 'N/A')
                if updated_network == new_network:
                    print(f"\n✅ 验证成功: 网络地址已修改为 {new_network}")
                    return True
                else:
                    print(f"\n❌ 验证失败: 网络地址不匹配")
                    print(f"  期望: {new_network}")
                    print(f"  实际: {updated_network}")
                    return False
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        return False

def test_change_interface(api, target_id, new_interface):
    """测试修改接口绑定"""
    print(f"\n{'=' * 60}")
    print(f"测试3: 修改接口绑定")
    print(f"{'=' * 60}")
    
    print(f"\n[步骤1] 获取当前配置")
    addresses = get_ip_addresses(api)
    target_addr = None
    for addr in addresses:
        if addr.get('.id') == target_id:
            target_addr = addr
            break
    
    if not target_addr:
        print(f"❌ 未找到ID={target_id}的IP地址")
        return False
    
    old_interface = target_addr.get('interface', 'N/A')
    print(f"当前接口: {old_interface}")
    print(f"目标接口: {new_interface}")
    
    if old_interface == new_interface:
        print(f"⚠️ 接口已经是目标值，跳过测试")
        return True
    
    print(f"\n[步骤2] 修改接口绑定")
    command = ['/ip/address/set', f'=.id={target_id}', f'=interface={new_interface}']
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
            print(f"✅ 修改成功")
            
            time.sleep(1)
            addresses = get_ip_addresses(api)
            print_addresses(addresses, "修改后的IP地址列表")
            
            verify_addr = None
            for addr in addresses:
                if addr.get('.id') == target_id:
                    verify_addr = addr
                    break
            
            if verify_addr:
                updated_interface = verify_addr.get('interface', 'N/A')
                if updated_interface == new_interface:
                    print(f"\n✅ 验证成功: 接口已修改为 {new_interface}")
                    return True
                else:
                    print(f"\n❌ 验证失败: 接口不匹配")
                    print(f"  期望: {new_interface}")
                    print(f"  实际: {updated_interface}")
                    return False
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        return False

def main():
    device_ip = '192.168.5.144'
    username = 'admin'
    password = '123456'
    target_interface = 'ether3'
    
    print(f"=" * 60)
    print(f"IP地址接口属性修改测试")
    print(f"=" * 60)
    print(f"设备IP: {device_ip}")
    print(f"用户名: {username}")
    print(f"目标接口: {target_interface}")
    print(f"=" * 60)
    
    api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
    
    print("\n[初始化] 尝试登录设备...")
    success, message = api.login()
    if not success:
        print(f"❌ 登录失败: {message}")
        return False
    print(f"✅ 登录成功: {message}")
    
    print(f"\n[初始化] 获取当前IP地址列表...")
    addresses = get_ip_addresses(api)
    print_addresses(addresses)
    
    target_addr = None
    for addr in addresses:
        if addr.get('interface') == target_interface:
            target_addr = addr
            break
    
    if not target_addr:
        print(f"\n❌ 未找到接口 {target_interface} 的IP地址记录")
        api.close()
        return False
    
    target_id = target_addr.get('.id')
    print(f"\n目标IP地址 ID: {target_id}")
    
    results = []
    
    result1 = test_disable_enable(api, target_id)
    results.append(("禁用/启用测试", result1))
    
    result2 = test_change_network(api, target_id, '192.168.15.0')
    results.append(("修改网络地址测试", result2))
    
    result3 = test_change_interface(api, target_id, 'ether3')
    results.append(("修改接口绑定测试", result3))
    
    print(f"\n{'=' * 60}")
    print(f"测试结果汇总")
    print(f"{'=' * 60}")
    for test_name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        print(f"{test_name:30s}: {status}")
    
    all_passed = all(result for _, result in results)
    print(f"\n总体结果: {'✅ 所有测试通过' if all_passed else '❌ 部分测试失败'}")
    
    api.close()
    return all_passed

if __name__ == '__main__':
    try:
        result = main()
        print(f"\n{'=' * 60}")
        if result:
            print("测试完成: ✅ 成功")
        else:
            print("测试完成: ❌ 失败")
        print(f"{'=' * 60}")
    except Exception as e:
        print(f"\n{'=' * 60}")
        print(f"测试异常: {e}")
        import traceback
        traceback.print_exc()
        print(f"{'=' * 60}")
