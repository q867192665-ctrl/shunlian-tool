@echo off
chcp 65001 >nul
echo ========================================
echo   瞬联调试工具 - 更新服务
echo   端口: 32999
echo ========================================
echo.

cd /d "%~dp0"

if not exist "venv" (
    echo 正在创建虚拟环境...
    python -m venv venv
    call venv\Scripts\activate.bat
    echo 正在安装依赖...
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

echo.
echo 启动更新服务 (端口: 32999)...
python server.py

pause
