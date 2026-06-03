@echo off
chcp 65001 >nul
title Ainovr - AI 小说风格仿写

echo ========================================
echo   Ainovr 启动器
echo ========================================
echo.

:: 杀掉占用 3000 端口的旧进程
echo [1/2] 清理旧进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING 2^>nul') do (
    echo       关闭旧进程 PID %%a
    taskkill /PID %%a /F >nul 2>&1
)
echo       完成
echo.

:: 3 秒后自动打开浏览器（后台等待，不阻塞服务）
echo [2/2] 启动服务...
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
echo       浏览器将自动打开...
echo.

echo ========================================
echo   服务运行中
echo   地址: http://localhost:3000
echo   关闭此窗口 = 停止服务
echo ========================================
echo.

:: 前台运行开发服务器（关闭窗口即停止）
npm run dev
