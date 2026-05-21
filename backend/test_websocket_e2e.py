#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
端到端WebSocket测试 - 模拟前端完整流程
1. 连接WebSocket并启动接口轮询（模拟前端onopen）
2. 在同一个连接上发送is_ip_addresses请求（模拟切换到地址标签页）
3. 验证IP地址数据是否正确返回
"""

import asyncio
import websockets
import json
import sys
import io

# 强制UTF-8输出，避免GBK编码问题
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

async def test_e2e():
    uri = "ws://localhost:32996"

    print("=" * 60)
    print("端到端测试 - 模拟前端完整流程")
    print("=" * 60)

    try:
        async with websockets.connect(uri) as websocket:
            print("\n[OK] WebSocket连接成功")

            print("\n[步骤1] 模拟前端启动接口轮询...")
            interface_msg = {
                'ip': '192.168.5.144',
                'username': 'admin',
                'password': '123456',
                'action': 'start_interface_polling'
            }
            print("发送: action=start_interface_polling")
            await websocket.send(json.dumps(interface_msg))

            response = await asyncio.wait_for(websocket.recv(), timeout=10)
            result = json.loads(response)
            print(f"收到: type={result.get('type')}, status={result.get('status')}")

            print("\n[步骤2] 模拟切换到地址标签页 - 发送is_ip_addresses...")
            ip_msg = {
                'ip': '192.168.5.144',
                'username': 'admin',
                'password': '123456',
                'is_ip_addresses': True
            }
            print("发送: is_ip_addresses=true")
            await websocket.send(json.dumps(ip_msg))

            print("\n[步骤3] 等待IP地址数据...")
            ip_received = False
            max_wait = 15
            start = asyncio.get_event_loop().time()

            while (asyncio.get_event_loop().time() - start) < max_wait:
                try:
                    response = await asyncio.wait_for(websocket.recv(), timeout=5)
                    result = json.loads(response)

                    msg_type = result.get('type', '')
                    if msg_type == 'ip_addresses':
                        status = result.get('status', '')
                        addresses = result.get('addresses', [])
                        print(f"\n收到IP地址数据:")
                        print(f"  状态: {status}")
                        print(f"  数量: {len(addresses)}")
                        for addr in addresses:
                            print(f"    .id={addr.get('.id')} address={addr.get('address')} interface={addr.get('interface')}")
                        ip_received = True
                        break
                    elif msg_type == 'interface_list':
                        pass
                    elif msg_type == 'interface_traffic':
                        pass
                    else:
                        print(f"  其他消息: type={msg_type}, status={result.get('status')}")

                except asyncio.TimeoutError:
                    print(f"  等待中... ({int(asyncio.get_event_loop().time() - start)}s)")
                    continue

            if ip_received:
                print("\n[OK] 测试成功: 成功接收到IP地址数据!")
            else:
                print("\n[FAIL] 测试失败: 未接收到IP地址数据")
                print("可能原因: 主消息循环未正确处理is_ip_addresses标志")

            print("\n[步骤4] 发送stop停止所有轮询...")
            await websocket.send(json.dumps({'action': 'stop'}))

    except Exception as e:
        print(f"\n[FAIL] 测试异常: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    try:
        asyncio.run(test_e2e())
        print("\n" + "=" * 60)
        print("端到端测试完成")
        print("=" * 60)
    except KeyboardInterrupt:
        print("\n用户中断")
