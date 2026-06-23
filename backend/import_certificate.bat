@echo off
chcp 65001 >nul
:: 瞬联调试工具 - 证书导入工具（管理员权限）
:: 此脚本会以管理员身份运行证书导入程序

echo ==================================================
echo 瞬联调试工具 - 证书导入工具
echo ==================================================
echo.
echo 正在请求管理员权限...

:: 检查是否已经有管理员权限
net session >nul 2>&1
if %errorLevel% == 0 (
    echo 已拥有管理员权限
    goto :run_import
)

:: 请求管理员权限
echo Set UAC = CreateObject("Shell.Application") > "%temp%\getadmin.vbs"
echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
"%temp%\getadmin.vbs"
exit /B

:run_import
echo.
echo 正在导入SSL证书到系统受信任存储...
echo.

:: 获取脚本所在目录
cd /d "%~dp0"

:: 运行Python导入脚本
python import_cert.py

echo.
pause
