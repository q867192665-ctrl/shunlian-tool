#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebSocket调试测试 - 详细跟踪IP地址修改流程
"""

import asyncio
import websockets
import json
import time

async def test_edit_ip_address_debug():
    uri = "ws://localhost:32996"
    
    print(f"=" * 60)
    print(f"WebSocket调试测试 - IP地址修改")
    print(f"=" * 60)
    
    try:
        async with websockets.connect(uri) as websocket:
            print(f"\n✅ WebSocket连接成功")
            
            # 步骤1：建立IP地址监控连接
            print(f"\n[步骤1] 建立IP地址监控连接...")
            connect_data = {
                'ip': '192.168.5.144',
                'username': 'admin',
                'password': '123456',
                'is_ip_addresses': True
            }
            
            print(f"发送: {json.dumps(connect_data, ensure_ascii=False)}")
            await websocket.send(json.dumps(connect_data))
            
            # 等待IP地址列表
            print(f"\n[步骤2] 等待IP地址列表...")
            response = await websocket.recv()
            result = json.loads(response)
            print(f"收到响应类型: {result.get('type')}")
            print(f"状态: {result.get('status')}")
            
            if result.get('type') == 'ip_addresses':
                addresses = result.get('addresses', [])
                print(f"\n找到 {len(addresses)} 个IP地址:")
                for addr in addresses:
                    print(f"  .id: {addr.get('.id')}")
                    print(f"  address: {addr.get('address')}")
                    print(f"  interface: {addr.get('interface')}")
                    print(f"  network: {addr.get('network')}")
                    print(f"  disabled: {addr.get('disabled')}")
                    print()
                
                if addresses:
                    target_addr = addresses[0]
                    
                    # 步骤2：发送修改请求
                    print(f"[步骤3] 发送IP修改请求...")
                    edit_data = {
                        'action': 'edit_ip_address',
                        'id': target_addr.get('.id'),
                        'address': '192.168.15.200/24',
                        'interface': target_addr.get('interface'),
                        'network': '192.168.15.0'
                    }
                    
                    print(f"发送: {json.dumps(edit_data, ensure_ascii=False)}")
                    await websocket.send(json.dumps(edit_data))
                    
                    # 等待响应
                    print(f"\n[步骤4] 等待修改结果...")
                    print(f"等待响应...")
                    
                    try:
                        response = await asyncio.wait_for(websocket.recv(), timeout=15)
                        result = json.loads(response)
                        print(f"\n收到响应:")
                        print(f"  类型: {result.get('type')}")
                        print(f"  状态: {result.get('status')}")
                        print(f"  消息: {result.get('message')}")
                        
                        if result.get('type') == 'ip_address_action':
                            if result.get('status') == 'success':
                                print(f"\n✅ 修改成功!")
                                
                                # 等待IP地址列表更新
                                print(f"\n[步骤5] 等待IP地址列表更新...")
                                try:
                                    response = await asyncio.wait_for(websocket.recv(), timeout=10)
                                    result = json.loads(response)
                                    if result.get('type') == 'ip_addresses':
                                        addresses = result.get('addresses', [])
                                        print(f"\n更新后的IP地址列表:")
                                        for addr in addresses:
                                            print(f"  .id: {addr.get('.id')} | address: {addr.get('address')}")
                                        
                                        # 验证修改结果
                                        for addr in addresses:
                                            if addr.get('.id') == target_addr.get('.id'):
                                                if addr.get('address') == '192.168.15.200/24':
                                                    print(f"\n✅ 验证成功: IP已修改为 192.168.15.200/24")
                                                else:
                                                    print(f"\n❌ 验证失败: IP未修改")
                                                    print(f"  期望: 192.168.15.200/24")
                                                    print(f"  实际: {addr.get('address')}")
                                                break
                                except asyncio.TimeoutError:
                                    print(f"⚠️ 未收到IP地址列表更新")
                            else:
                                print(f"\n❌ 修改失败: {result.get('message')}")
                        else:
                            print(f"\n⚠️ 收到非预期响应: {result.get('type')}")
                    except asyncio.TimeoutError:
                        print(f"\n❌ 等待响应超时")
                    
                    # 恢复原IP
                    print(f"\n[步骤6] 恢复原IP地址...")
                    restore_data = {
                        'action': 'edit_ip_address',
                        'id': target_addr.get('.id'),
                        'address': target_addr.get('address'),
                        'interface': target_addr.get('interface'),
                        'network': '192.168.15.0'
                    }
                    
                    await websocket.send(json.dumps(restore_data))
                    try:
                        response = await asyncio.wait_for(websocket.recv(), timeout=15)
                        result = json.loads(response)
                        print(f"恢复结果: {result.get('status')} - {result.get('message')}")
                    except asyncio.TimeoutError:
                        print(f"⚠️ 恢复操作超时")
            
            # 停止监控
            print(f"\n[步骤7] 停止监控...")
            await websocket.send(json.dumps({'action': 'stop'}))
            
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    try:
        asyncio.run(test_edit_ip_address_debug())
        print(f"\n{'=' * 60}")
        print("测试完成")
        print(f"{'=' * 60}")
    except KeyboardInterrupt:
        print(f"\n用户中断测试")
