#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试IP编辑后: 1)不弹窗重连 2)IP列表及时更新
"""
import asyncio
import websockets
import json
import sys
import io

if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

async def test():
    uri = "ws://localhost:32996"
    print("=" * 60)
    print("IP编辑测试 - 验证不弹窗重连 + IP列表更新")
    print("=" * 60)

    async with websockets.connect(uri) as ws:
        # Step 1: start interface polling
        print("\n[1] 启动接口轮询...")
        await ws.send(json.dumps({
            'ip': '192.168.5.144', 'username': 'admin', 'password': '123456',
            'action': 'start_interface_polling'
        }))
        resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        print(f"  收到: type={resp.get('type')}, status={resp.get('status')}")

        # Step 2: start IP monitoring
        print("\n[2] 启动IP监控...")
        await ws.send(json.dumps({
            'ip': '192.168.5.144', 'username': 'admin', 'password': '123456',
            'is_ip_addresses': True
        }))
        # Wait for IP data
        addr_before = None
        start = asyncio.get_event_loop().time()
        while (asyncio.get_event_loop().time() - start) < 10:
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            if resp.get('type') == 'ip_addresses' and resp.get('status') == 'success':
                addr_before = resp.get('addresses', [])
                break
        if addr_before:
            print(f"  修改前IP列表: {[(a.get('address'), a.get('interface')) for a in addr_before]}")

        # Step 3: edit IP (change ether3 IP slightly)
        target = next((a for a in addr_before if a.get('interface') == 'ether3'), None)
        if not target:
            print("  [SKIP] ether3 not found")
            return
        
        old_addr = target.get('address', '')
        old_id = target.get('.id', '')
        # Change last octet slightly
        parts = old_addr.split('/')
        ip_parts = parts[0].split('.')
        new_last = str((int(ip_parts[3]) + 1) % 254 + 1)
        new_addr = f"{ip_parts[0]}.{ip_parts[1]}.{ip_parts[2]}.{new_last}/{parts[1]}"

        print(f"\n[3] 编辑IP: {old_addr} -> {new_addr} (id={old_id})")
        await ws.send(json.dumps({
            'action': 'edit_ip_address',
            'id': old_id,
            'address': new_addr,
            'interface': 'ether3',
            'network': target.get('network', '')
        }))

        # Step 4: check responses
        print("\n[4] 检查响应...")
        edit_ok = False
        ip_updated = False
        device_offline = False
        start = asyncio.get_event_loop().time()
        while (asyncio.get_event_loop().time() - start) < 15:
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            msg_type = resp.get('type', '')
            status = resp.get('status', '')
            
            if msg_type == 'ip_address_action':
                print(f"  [action] status={status}, message={resp.get('message')}")
                if status == 'success':
                    edit_ok = True
            elif msg_type == 'ip_addresses' and status == 'success':
                addrs = resp.get('addresses', [])
                for a in addrs:
                    if a.get('.id') == old_id:
                        current = a.get('address', '')
                        if current == new_addr:
                            print(f"  [IP更新] IP已更新为: {current}")
                            ip_updated = True
                        else:
                            print(f"  [IP更新] IP仍为: {current}")
                if ip_updated:
                    break
            elif status == 'device_offline':
                print(f"  [OFFLINE!] {resp.get('message')}")
                device_offline = True
                break
            elif msg_type == 'interface_list' or msg_type == 'interface_traffic':
                pass  # ignore
            else:
                print(f"  [other] type={msg_type}, status={status}")

        # Step 5: restore original IP
        if ip_updated:
            print(f"\n[5] 恢复原IP: {old_addr}")
            await ws.send(json.dumps({
                'action': 'edit_ip_address',
                'id': old_id,
                'address': old_addr,
                'interface': 'ether3',
                'network': target.get('network', '')
            }))
            try:
                resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                print(f"  恢复: type={resp.get('type')}, status={resp.get('status')}")
            except:
                pass

        # Results
        print("\n" + "=" * 60)
        if device_offline:
            print("[FAIL] 设备弹窗重连!")
        else:
            print("[OK] 没有弹窗重连")
        if edit_ok:
            print("[OK] 编辑操作成功")
        else:
            print("[FAIL] 编辑操作未确认")
        if ip_updated:
            print("[OK] IP列表及时更新")
        else:
            print("[FAIL] IP列表未及时更新")
        print("=" * 60)

        await ws.send(json.dumps({'action': 'stop'}))

if __name__ == '__main__':
    asyncio.run(test())
