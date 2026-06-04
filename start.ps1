# ========================================
#   Ainovr 启动器 (PowerShell)
# ========================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Ainovr 启动器" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 杀掉占用 3000 端口的旧进程
Write-Host "[1/2] 清理旧进程..." -ForegroundColor Yellow
$ports = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
foreach ($conn in $ports) {
    Write-Host "      关闭旧进程 PID $($conn.OwningProcess)"
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
}
Write-Host "      完成"
Write-Host ""

# 启动服务并自动打开浏览器
Write-Host "[2/2] 启动服务..." -ForegroundColor Yellow
Start-Job -Name 'open-browser' -ScriptBlock {
    Start-Sleep -Seconds 3
    Start-Process 'http://localhost:3000'
} | Out-Null
Write-Host "      浏览器将自动打开..."
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  服务运行中" -ForegroundColor Green
Write-Host "  地址: http://localhost:3000" -ForegroundColor Green
Write-Host "  关闭此窗口 = 停止服务" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

npm run dev
