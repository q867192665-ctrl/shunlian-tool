#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebSocket测试客户端 - 已登录状态下的IP地址修改
模拟前端在已登录状态下发送IP修改请求（不需要重复发送设备IP、用户名、密码）
"""

import asyncio
import websockets
import json

async def test_edit_ip_address_logged_in():
    uri = "ws://localhost:32996"
    
    print(f"=" * 60)
    print(f"WebSocket测试 - 已登录状态下的IP修改")
    print(f"=" * 60)
    print(f"连接地址: {uri}")
    print(f"=" * 60)
    
    try:
        async with websockets.connect(uri) as websocket:
            print(f"\n✅ WebSocket连接成功")
            
            print(f"\n[步骤1] 发送登录请求并启动IP地址监控...")
            connect_data = {
                'ip': '192.168.5.144',
                'username': 'admin',
                'password': '123456',
                'is_ip_addresses': True  # 启动IP地址监控
            }
            
            print(f"发送数据: {json.dumps(connect_data, indent=2, ensure_ascii=False)}")
            await websocket.send(json.dumps(connect_data))
            
            print(f"\n[步骤2] 等待IP地址列表...")
            response = await websocket.recv()
            result = json.loads(response)
            print(f"收到响应类型: {result.get('type')}")
            
            if result.get('type') == 'ip_addresses':
                addresses = result.get('addresses', [])
                print(f"\n找到 {len(addresses)} 个IP地址:")
                for addr in addresses:
                    print(f"  ID: {addr.get('.id'):6s} | 接口: {addr.get('interface'):15s} | IP: {addr.get('address')}")
                
                if addresses:
                    target_addr = addresses[0]
                    print(f"\n[步骤3] 发送IP地址修改请求（已登录状态）...")
                    print(f"⚠️ 注意：不需要发送设备IP、用户名、密码")
                    
                    edit_data = {
                        'action': 'edit_ip_address',
                        'id': target_addr.get('.id'),
                        'address': '192.168.15.200/24',
                        'interface': target_addr.get('interface'),
                        'network': '192.168.15.0'
                    }
                    
                    print(f"\n发送数据（简化格式）:")
                    print(f"{json.dumps(edit_data, indent=2, ensure_ascii=False)}")
                    await websocket.send(json.dumps(edit_data))
                    
                    print(f"\n[步骤4] 等待修改结果...")
                    response = await websocket.recv()
                    result = json.loads(response)
                    print(f"收到响应: {json.dumps(result, indent=2, ensure_ascii=False)}")
                    
                    if result.get('status') == 'success':
                        print(f"\n✅ 修改成功: {result.get('message')}")
                        
                        print(f"\n[步骤5] 等待IP地址列表更新...")
                        response = await websocket.recv()
                        result = json.loads(response)
                        if result.get('type') == 'ip_addresses':
                            addresses = result.get('addresses', [])
                            print(f"\n更新后的IP地址列表:")
                            for addr in addresses:
                                print(f"  ID: {addr.get('.id'):6s} | 接口: {addr.get('interface'):15s} | IP: {addr.get('address')}")
                        
                        print(f"\n[步骤6] 恢复原IP地址...")
                        restore_data = {
                            'action': 'edit_ip_address',
                            'id': target_addr.get('.id'),
                            'address': target_addr.get('address'),
                            'interface': target_addr.get('interface'),
                            'network': '192.168.15.0'
                        }
                        
                        await websocket.send(json.dumps(restore_data))
                        response = await websocket.recv()
                        result = json.loads(response)
                        print(f"恢复结果: {result.get('status')} - {result.get('message')}")
                    else:
                        print(f"\n❌ 修改失败: {result.get('message')}")
            
            print(f"\n[步骤7] 发送停止命令...")
            stop_data = {'action': 'stop'}
            await websocket.send(json.dumps(stop_data))
            
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    try:
        asyncio.run(test_edit_ip_address_logged_in())
        print(f"\n{'=' * 60}")
        print("测试完成")
        print(f"{'=' * 60}")
    except KeyboardInterrupt:
        print(f"\n用户中断测试")
