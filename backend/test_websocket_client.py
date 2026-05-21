#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebSocket测试客户端 - 模拟前端发送IP地址修改请求
"""

import asyncio
import websockets
import json

async def test_edit_ip_address():
    uri = "ws://localhost:32996"
    
    print(f"=" * 60)
    print(f"WebSocket测试客户端 - IP地址修改")
    print(f"=" * 60)
    print(f"连接地址: {uri}")
    print(f"=" * 60)
    
    try:
        async with websockets.connect(uri) as websocket:
            print(f"\n✅ WebSocket连接成功")
            
            print(f"\n[步骤1] 发送连接请求...")
            connect_data = {
                'ip': '192.168.5.144',
                'username': 'admin',
                'password': '123456',
                'action': 'get_interfaces_list'
            }
            
            print(f"发送数据: {json.dumps(connect_data, indent=2, ensure_ascii=False)}")
            await websocket.send(json.dumps(connect_data))
            
            print(f"\n[步骤2] 等待响应...")
            response = await websocket.recv()
            print(f"收到响应: {response[:200]}...")
            
            print(f"\n[步骤3] 发送IP地址修改请求...")
            edit_data = {
                'ip': '192.168.5.144',
                'username': 'admin',
                'password': '123456',
                'action': 'edit_ip_address',
                'id': '*2',
                'address': '192.168.15.200/24',
                'interface': 'ether3',
                'network': '192.168.15.0'
            }
            
            print(f"发送数据: {json.dumps(edit_data, indent=2, ensure_ascii=False)}")
            await websocket.send(json.dumps(edit_data))
            
            print(f"\n[步骤4] 等待修改结果...")
            response = await websocket.recv()
            print(f"收到响应: {response}")
            
            result = json.loads(response)
            if result.get('status') == 'success':
                print(f"\n✅ 修改成功: {result.get('message')}")
            else:
                print(f"\n❌ 修改失败: {result.get('message')}")
            
            print(f"\n[步骤5] 恢复原IP地址...")
            restore_data = {
                'ip': '192.168.5.144',
                'username': 'admin',
                'password': '123456',
                'action': 'edit_ip_address',
                'id': '*2',
                'address': '192.168.15.108/24',
                'interface': 'ether3',
                'network': '192.168.15.0'
            }
            
            await websocket.send(json.dumps(restore_data))
            response = await websocket.recv()
            print(f"恢复响应: {response}")
            
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    try:
        asyncio.run(test_edit_ip_address())
        print(f"\n{'=' * 60}")
        print("测试完成")
        print(f"{'=' * 60}")
    except KeyboardInterrupt:
        print(f"\n用户中断测试")
