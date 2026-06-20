# 瞬联调试工具 - 一键启动脚本
# 启动前后端服务

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "瞬联调试工具 - 启动中..."

# 颜色输出函数
function Write-Info { param($msg) Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Error { param($msg) Write-Host "[ERROR] $msg" -ForegroundColor Red }

# 获取脚本所在目录
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"

Write-Info "项目目录: $projectRoot"

# 检查后端目录
if (-not (Test-Path $backendDir)) {
    Write-Error "后端目录不存在: $backendDir"
    Read-Host "按回车键退出"
    exit 1
}

# 检查前端目录
if (-not (Test-Path $frontendDir)) {
    Write-Error "前端目录不存在: $frontendDir"
    Read-Host "按回车键退出"
    exit 1
}

# 启动后端
Write-Info "正在启动后端服务..."
$pythonCmd = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $pythonCmd) {
    Write-Error "未找到 python 命令，请检查 Python 是否已安装并添加到 PATH"
    Read-Host "按回车键退出"
    exit 1
}
$backendProcess = Start-Process -FilePath $pythonCmd -ArgumentList "main.py" -WorkingDirectory $backendDir -PassThru -WindowStyle Normal
Write-Success "后端已启动 (PID: $($backendProcess.Id))"

# 等待后端启动
Write-Info "等待后端初始化..."
Start-Sleep -Seconds 3

# 启动前端
Write-Info "正在启动前端服务..."
# 优先使用 npm.cmd（可直接调用），避免子 PowerShell 进程 PATH 丢失问题
$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCmd) {
    $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue).Source
}
if (-not $npmCmd) {
    Write-Error "未找到 npm 命令，请检查 Node.js 是否已安装并添加到 PATH"
    Read-Host "按回车键退出"
    exit 1
}
if ($npmCmd -like "*.cmd") {
    # npm.cmd 可直接调用
    $frontendProcess = Start-Process -FilePath $npmCmd -ArgumentList "run", "dev" -WorkingDirectory $frontendDir -PassThru -WindowStyle Normal
} else {
    # npm.ps1 需要通过 powershell 调用
    $frontendProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontendDir'; npm run dev" -PassThru -WindowStyle Normal
}
Write-Success "前端已启动 (PID: $($frontendProcess.Id))"

# 完成
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  瞬联调试工具启动完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Info "后端: http://localhost:32995"
Write-Info "前端: http://localhost:5173"
Write-Host ""
Write-Warn "关闭此窗口将停止所有服务"
Write-Host ""
Write-Host "按任意键退出并关闭所有服务..." -ForegroundColor Gray

# 等待用户按键
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# 清理进程
Write-Info "正在关闭服务..."
if ($backendProcess -and -not $backendProcess.HasExited) {
    Stop-Process -Id $backendProcess.Id -Force
    Write-Info "后端已停止"
}
if ($frontendProcess -and -not $frontendProcess.HasExited) {
    Stop-Process -Id $frontendProcess.Id -Force
    Write-Info "前端已停止"
}
Write-Success "所有服务已关闭"
