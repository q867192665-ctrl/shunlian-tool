@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  瞬连调式工具 Win7 Build Script
echo ========================================
echo.
echo 注意：此脚本需要在 Python 3.8.x 环境下运行
echo 以确保打包出的程序支持 Windows 7 SP1
echo ========================================
echo.

REM Check Python version
python --version 2>nul | findstr "3.8." >nul
if errorlevel 1 (
    echo [警告] 当前 Python 版本不是 3.8.x
    echo 打包出的程序可能无法在 Windows 7 上运行
    echo.
    choice /C YN /M "是否继续打包"
    if errorlevel 2 exit /b 1
)

REM Clean old build
if exist build rd /s /q build
if exist dist rd /s /q dist

echo.
echo [1/3] Building backend (Win7 compatible)...
pyinstaller --noconfirm --onefile --noconsole --name "shunlian_backend" --icon "logo.ico" --collect-all asyncio --hidden-import "uvicorn.logging" --hidden-import "uvicorn.loops" --hidden-import "uvicorn.loops.auto" --hidden-import "uvicorn.protocols" --hidden-import "uvicorn.protocols.http" --hidden-import "uvicorn.protocols.http.auto" --hidden-import "uvicorn.protocols.websockets" --hidden-import "uvicorn.protocols.websockets.auto" --hidden-import "uvicorn.lifespan" --hidden-import "uvicorn.lifespan.on" --hidden-import "yaml" --hidden-import "routeros_api" --hidden-import "routeros_api.api_structure" --hidden-import "routeros_api.resource" --hidden-import "websockets" --hidden-import "websockets.legacy" --hidden-import "websockets.legacy.server" --hidden-import "psutil" --hidden-import "PIL" main.py
if errorlevel 1 (
    echo [ERROR] Backend build failed
    pause
    exit /b 1
)

echo.
echo [2/3] Building launcher (Win7 compatible)...
pyinstaller --noconfirm --onefile --noconsole --name "ShunLianTool" --icon "logo.ico" --hidden-import "yaml" launcher.py
if errorlevel 1 (
    echo [ERROR] Launcher build failed
    pause
    exit /b 1
)

echo.
echo [3/3] Organizing files and building installer...
if not exist "dist\setup_files" mkdir "dist\setup_files"
copy /Y "dist\shunlian_backend.exe" "dist\setup_files\"
copy /Y "dist\ShunLianTool.exe" "dist\setup_files\"
copy /Y "config.yaml" "dist\setup_files\"
if exist "logo.ico" copy /Y "logo.ico" "dist\setup_files\"
if exist "Logo.jpg" copy /Y "Logo.jpg" "dist\setup_files\"
if exist "SLSCtools.exe" copy /Y "SLSCtools.exe" "dist\setup_files\slsc_runtime.slr" >nul
if exist "dist\setup_files\static" rd /s /q "dist\setup_files\static"
xcopy /E /I /Y "static" "dist\setup_files\static"
if exist "更新日志.md" copy /Y "更新日志.md" "dist\setup_files\"
if exist "iperf3" xcopy /E /I /Y "iperf3" "dist\setup_files\iperf3"
if exist "autodefaultport.rsc" copy /Y "autodefaultport.rsc" "dist\setup_files\slsc_data.sld"

"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" "%~dp0setup.iss"

echo.
echo ========================================
echo  Done! Installer in installer_output\
echo ========================================
pause
