#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试前端发送的IP地址修改数据格式
模拟前端发送的数据，验证后端处理逻辑
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mikrotik_api import MikroTikAPI
import json

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

def test_data_format():
    device_ip = '192.168.5.144'
    username = 'admin'
    password = '123456'
    
    print(f"=" * 60)
    print(f"测试前端数据格式")
    print(f"=" * 60)
    
    api = MikroTikAPI(device_ip, username, password, port=8728, use_ssl=False)
    
    print("\n[步骤1] 登录设备...")
    success, message = api.login()
    if not success:
        print(f"❌ 登录失败: {message}")
        return False
    print(f"✅ 登录成功")
    
    print(f"\n[步骤2] 获取IP地址列表...")
    addresses = get_ip_addresses(api)
    
    print(f"\n找到 {len(addresses)} 个IP地址:")
    print("-" * 80)
    for addr in addresses:
        print(f"完整记录: {json.dumps(addr, indent=2, ensure_ascii=False)}")
        print(f"  .id字段: {addr.get('.id', 'N/A')}")
        print(f"  id字段: {addr.get('id', 'N/A')}")
        print(f"  address字段: {addr.get('address', 'N/A')}")
        print(f"  interface字段: {addr.get('interface', 'N/A')}")
        print("-" * 80)
    
    if addresses:
        target_addr = addresses[0]
        print(f"\n[步骤3] 模拟前端发送的数据格式...")
        
        print(f"\n方案1: 使用 '.id' 字段（RouterOS原始格式）")
        data1 = {
            'id': target_addr.get('.id', ''),
            'address': '192.168.15.200/24',
            'interface': target_addr.get('interface', ''),
            'network': target_addr.get('network', '')
        }
        print(f"数据: {json.dumps(data1, indent=2, ensure_ascii=False)}")
        print(f"  data.get('id'): {data1.get('id', '')}")
        
        print(f"\n方案2: 使用 'id' 字段（前端可能发送的格式）")
        data2 = {
            'id': target_addr.get('.id', '').replace('*', ''),
            'address': '192.168.15.200/24',
            'interface': target_addr.get('interface', ''),
            'network': target_addr.get('network', '')
        }
        print(f"数据: {json.dumps(data2, indent=2, ensure_ascii=False)}")
        print(f"  data.get('id'): {data2.get('id', '')}")
        
        print(f"\n[步骤4] 测试修改命令...")
        
        print(f"\n测试1: 使用完整ID（包含*号）")
        id_val1 = data1.get('id', '')
        command1 = ['/ip/address/set', f'=.id={id_val1}', '=address=192.168.15.200/24']
        print(f"命令: {' '.join(command1)}")
        api.write_sentence(command1)
        
        try:
            response1 = api.read_sentence(timeout=10)
            print(f"响应: {response1}")
            
            if '!trap' in response1:
                error_msg = ''.join([line for line in response1 if line.startswith('=message=')])
                error_msg = error_msg.replace('=message=', '') if error_msg else '修改失败'
                print(f"❌ 修改失败: {error_msg}")
            else:
                print(f"✅ 修改成功")
                
                time.sleep(1)
                verify_addresses = get_ip_addresses(api)
                for addr in verify_addresses:
                    if addr.get('.id') == id_val1:
                        print(f"验证结果: {addr.get('address')}")
                        break
        except Exception as e:
            print(f"❌ 测试失败: {e}")
        
        print(f"\n测试2: 恢复原IP")
        command2 = ['/ip/address/set', f'=.id={id_val1}', f'=address={target_addr.get("address")}']
        print(f"命令: {' '.join(command2)}")
        api.write_sentence(command2)
        
        try:
            response2 = api.read_sentence(timeout=10)
            print(f"响应: {response2}")
            
            if '!trap' in response2:
                print(f"❌ 恢复失败")
            else:
                print(f"✅ 恢复成功")
        except Exception as e:
            print(f"❌ 恢复失败: {e}")
    
    api.close()
    return True

if __name__ == '__main__':
    import time
    try:
        result = test_data_format()
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
