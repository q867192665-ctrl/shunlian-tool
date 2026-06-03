@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  瞬连调式工具 Build Script
echo ========================================

REM Clean old build
if exist build rd /s /q build
if exist dist rd /s /q dist

echo.
echo [1/4] Building backend...
pyinstaller --noconfirm --onefile --noconsole --name "shunlian_backend" --icon "logo.ico" --collect-all asyncio --hidden-import "uvicorn.logging" --hidden-import "uvicorn.loops" --hidden-import "uvicorn.loops.auto" --hidden-import "uvicorn.protocols" --hidden-import "uvicorn.protocols.http" --hidden-import "uvicorn.protocols.http.auto" --hidden-import "uvicorn.protocols.websockets" --hidden-import "uvicorn.protocols.websockets.auto" --hidden-import "uvicorn.lifespan" --hidden-import "uvicorn.lifespan.on" --hidden-import "yaml" --hidden-import "routeros_api" --hidden-import "routeros_api.api_structure" --hidden-import "routeros_api.resource" --hidden-import "websockets" --hidden-import "websockets.legacy" --hidden-import "websockets.legacy.server" --hidden-import "psutil" --hidden-import "PIL" main.py
if errorlevel 1 (
    echo [ERROR] Backend build failed
    pause
    exit /b 1
)

echo.
echo [2/4] Building launcher...
pyinstaller --noconfirm --onefile --noconsole --name "ShunLianTool" --icon "logo.ico" --hidden-import "yaml" launcher.py
if errorlevel 1 (
    echo [ERROR] Launcher build failed
    pause
    exit /b 1
)

echo.
echo [3/4] Building guardian...
pyinstaller --noconfirm --onefile --noconsole --name "shunlian_guardian" --icon "logo.ico" guardian.py
if errorlevel 1 (
    echo [ERROR] Guardian build failed
    pause
    exit /b 1
)

echo.
echo [4/4] Organizing files and building installer...
if not exist "dist\setup_files" mkdir "dist\setup_files"
copy /Y "dist\shunlian_backend.exe" "dist\setup_files\"
copy /Y "dist\ShunLianTool.exe" "dist\setup_files\"
copy /Y "dist\shunlian_guardian.exe" "dist\setup_files\"
copy /Y "config.yaml" "dist\setup_files\"
if exist "logo.ico" copy /Y "logo.ico" "dist\setup_files\"
if exist "Logo.jpg" copy /Y "Logo.jpg" "dist\setup_files\"
if exist "SLSCtools.exe" copy /Y "SLSCtools.exe" "dist\setup_files\ct_helper.exe" >nul
if exist "dist\setup_files\static" rd /s /q "dist\setup_files\static"
xcopy /E /I /Y "static" "dist\setup_files\static"
if exist "更新日志.md" copy /Y "更新日志.md" "dist\setup_files\"

REM 验证更新日志版本号
echo.
echo [VERIFY] Checking version in 更新日志.md...
findstr /B "## v" "dist\setup_files\更新日志.md" >nul
if errorlevel 1 (
    echo [WARNING] 更新日志.md 版本号未正确复制！
) else (
    for /f "tokens=2" %%i in ('findstr /B "## v" "dist\setup_files\更新日志.md"') do echo  Version: %%i
)

"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" "%~dp0setup.iss"

echo.
echo ========================================
echo  Done! Installer in installer_output\
echo ========================================
pause
