#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
证书导入工具
将自签名SSL证书导入到Windows受信任的根证书存储
"""

import subprocess
import sys
import os

def import_certificate(cert_path: str) -> bool:
    """
    将证书导入到Windows受信任的根证书存储
    
    Args:
        cert_path: 证书文件路径
        
    Returns:
        bool: 是否成功
    """
    if not os.path.exists(cert_path):
        print(f"错误: 证书文件不存在: {cert_path}")
        return False
    
    try:
        # 使用certutil工具将证书导入到"受信任的根证书颁发机构"存储
        # -addstore "Root" 表示导入到根证书存储
        cmd = [
            'certutil',
            '-addstore',
            'Root',
            cert_path
        ]
        
        print(f"正在导入证书: {cert_path}")
        print("这可能需要管理员权限...")
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
        )
        
        if result.returncode == 0:
            print("✓ 证书导入成功！")
            print("  证书已添加到'受信任的根证书颁发机构'")
            print("  请重启浏览器以生效")
            return True
        else:
            print(f"✗ 证书导入失败:")
            print(f"  错误代码: {result.returncode}")
            print(f"  错误信息: {result.stderr}")
            
            # 如果因为权限问题失败，提示用户
            if 'access denied' in result.stderr.lower() or '拒绝访问' in result.stderr:
                print("\n提示: 请以管理员身份运行此程序")
            
            return False
            
    except FileNotFoundError:
        print("错误: 找不到certutil工具")
        return False
    except Exception as e:
        print(f"错误: 导入证书时发生异常: {e}")
        return False


def main():
    """主函数"""
    # 获取程序目录（兼容PyInstaller打包）
    if getattr(sys, 'frozen', False):
        base_dir = os.path.dirname(sys.executable)
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 默认证书路径
    cert_path = os.path.join(base_dir, 'certs', 'server-cert.pem')
    
    # 支持命令行参数指定证书路径
    if len(sys.argv) > 1:
        cert_path = sys.argv[1]
    
    print("=" * 50)
    print("瞬联调试工具 - 证书导入工具")
    print("=" * 50)
    print(f"证书路径: {cert_path}")
    print()
    
    success = import_certificate(cert_path)
    
    print()
    if success:
        print("下一步操作:")
        print("1. 关闭所有浏览器窗口")
        print("2. 重新打开浏览器")
        print("3. 访问 https://localhost:32995/")
        print("4. 此时应该不会再显示安全警告")
        
        # 自动打开浏览器
        import webbrowser
        try:
            webbrowser.open('https://localhost:32995/')
            print("\n已自动打开浏览器...")
        except:
            pass
    else:
        print("如果导入失败（权限不足），请尝试以下方法：")
        print()
        print("方法1: 以管理员身份运行此工具")
        print(f"  右键点击此程序 -> 以管理员身份运行")
        print()
        print("方法2: 手动导入证书")
        print(f"  1. 双击打开证书文件: {cert_path}")
        print('  2. 点击"安装证书"')
        print('  3. 选择"本地计算机"，点击下一步')
        print('  4. 选择"将所有的证书都放入下列存储"')
        print('  5. 点击浏览，选择"受信任的根证书颁发机构"')
        print('  6. 完成向导')
        print()
        print("方法3: 在浏览器中添加安全例外")
        print("  Chrome/Edge: 点击高级 -> 继续前往 localhost (不安全)")
        print("  Firefox: 点击高级 -> 接受风险并继续")
    
    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())
