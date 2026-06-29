#!/usr/bin/env python3
"""一键构建脚本"""
import subprocess
import sys
import os
import shutil

os.chdir(r'e:\程序\mikrotik-manager\backend')

# 清理
for d in ['build', 'dist']:
    if os.path.exists(d):
        shutil.rmtree(d, True)
print('[1/6] 已清理旧构建')

# 打包后端
print('[2/6] 打包后端...')
r = subprocess.run([
    sys.executable, '-m', 'PyInstaller',
    '--noconfirm', '--onefile', '--noconsole',
    '--name', 'shunlian_backend',
    '--icon', 'logo.ico',
    '--hidden-import', 'uvicorn.logging',
    '--hidden-import', 'uvicorn.loops',
    '--hidden-import', 'uvicorn.loops.auto',
    '--hidden-import', 'uvicorn.protocols',
    '--hidden-import', 'uvicorn.protocols.http',
    '--hidden-import', 'uvicorn.protocols.http.auto',
    '--hidden-import', 'uvicorn.protocols.websockets',
    '--hidden-import', 'uvicorn.protocols.websockets.auto',
    '--hidden-import', 'uvicorn.lifespan',
    '--hidden-import', 'uvicorn.lifespan.on',
    '--hidden-import', 'yaml',
    '--hidden-import', 'routeros_api',
    '--hidden-import', 'routeros_api.api_structure',
    '--hidden-import', 'routeros_api.resource',
    '--hidden-import', 'routeros_api.socket_api',
    '--hidden-import', 'routeros_api.communication',
    '--hidden-import', 'routeros_api.api_communication',
    '--hidden-import', 'websockets',
    '--hidden-import', 'websockets.legacy',
    '--hidden-import', 'websockets.legacy.server',
    '--hidden-import', 'psutil',
    '--hidden-import', 'PIL',
    'main.py'
], capture_output=False)
if r.returncode != 0:
    print('[错误] 后端打包失败')
    sys.exit(1)
print('[2/6] 后端打包完成')

# 打包启动器
print('[3/6] 打包启动器...')
r = subprocess.run([
    sys.executable, '-m', 'PyInstaller',
    '--noconfirm', '--onefile', '--noconsole',
    '--name', 'ShunLianTool',
    '--icon', 'logo.ico',
    '--hidden-import', 'yaml',
    'launcher.py'
], capture_output=False)
if r.returncode != 0:
    print('[错误] 启动器打包失败')
    sys.exit(1)
print('[3/6] 启动器打包完成')

# 整理文件
print('[4/5] 整理文件...')
setup_dir = os.path.join('dist', 'setup_files')
os.makedirs(setup_dir, exist_ok=True)
for f in ['dist/shunlian_backend.exe', 'dist/ShunLianTool.exe', 'config.yaml', 'logo.ico', 'Logo.jpg', '更新日志.md']:
    src = f
    if os.path.exists(src):
        shutil.copy2(src, setup_dir)
        print(f'  复制：{f}')
    else:
        print(f'  警告：{f} 不存在')

# 复制并重命名 SLSCtools.exe（隐藏原始文件类型）
slsc_src = 'SLSCtools.exe'
slsc_dst = os.path.join(setup_dir, 'slsc_runtime.slr')
if os.path.exists(slsc_src):
    shutil.copy2(slsc_src, slsc_dst)
    print(f'  复制并重命名：SLSCtools.exe -> slsc_runtime.slr')
else:
    print('  警告：SLSCtools.exe 不存在，请确保该文件位于项目根目录下')

# 复制并重命名 autodefaultport.rsc（隐藏原始文件类型）
rsc_src = 'autodefaultport.rsc'
rsc_dst = os.path.join(setup_dir, 'slsc_data.sld')
if os.path.exists(rsc_src):
    shutil.copy2(rsc_src, rsc_dst)
    print(f'  复制并重命名：autodefaultport.rsc -> slsc_data.sld')
else:
    print('  警告：autodefaultport.rsc 不存在')
static_dst = os.path.join(setup_dir, 'static')
if os.path.exists(static_dst):
    shutil.rmtree(static_dst)
shutil.copytree('static', static_dst)
print('  复制: static/')

# 复制 TLS 证书目录（Inno Setup 安装包需要）
certs_dst = os.path.join(setup_dir, 'certs')
if os.path.exists('certs'):
    if os.path.exists(certs_dst):
        shutil.rmtree(certs_dst)
    shutil.copytree('certs', certs_dst)
    print('  复制: certs/')
else:
    print('  警告：certs 目录不存在，首次启动时将自动生成证书')

# 复制 iperf3 带宽测速工具
iperf3_dst = os.path.join(setup_dir, 'iperf3')
if os.path.exists('iperf3'):
    if os.path.exists(iperf3_dst):
        shutil.rmtree(iperf3_dst)
    shutil.copytree('iperf3', iperf3_dst)
    print('  复制: iperf3/')
else:
    print('  警告：iperf3 目录不存在')

# Inno Setup
print('[5/5] 编译安装包...')
iscc = r'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
r = subprocess.run([iscc, r'e:\程序\mikrotik-manager\backend\setup.iss'], capture_output=True)
if r.returncode != 0:
    print('[错误] Inno Setup 编译失败')
    print(r.stdout.decode('gbk', errors='replace')[-2000:])
    print(r.stderr.decode('gbk', errors='replace'))
    sys.exit(1)

print()
print('=' * 40)
print('全部完成！')
print(f'安装包: installer_output/')
print('=' * 40)
