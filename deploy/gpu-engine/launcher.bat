@echo off
chcp 65001 > nul
REM ============================================================
REM 围棋AI教学平台 - 本地GPU引擎一键启动器（自安装版）
REM
REM 自动完成：
REM   1. 检查 Python
REM   2. 创建/复用虚拟环境 .venv
REM   3. 安装 Python 依赖
REM   4. 下载 KataGo 二进制 + 神经网络权重
REM   5. 生成 .env 配置文件
REM   6. 启动 FastAPI 服务（端口 8000）
REM
REM 启动后浏览器访问 http://localhost:5173
REM 前端设置中选择 "Local GPU" 引擎来源。
REM ============================================================

cd /d "%~dp0..\..\backend"
set "BACKEND_DIR=%CD%"

echo ========================================
echo   围棋AI教学平台 - 本地GPU引擎
echo   目录: %BACKEND_DIR%
echo ========================================
echo.

REM ===== 1. 检查 Python =====
where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装 Python 3.10+：
    echo        https://www.python.org/downloads/
    echo        安装时勾选 "Add Python to PATH"。
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set "PYVER=%%v"
echo [1/6] Python %PYVER% OK

REM ===== 2. 虚拟环境 =====
if not exist ".venv\Scripts\python.exe" (
    echo [2/6] 创建虚拟环境 .venv ...
    python -m venv .venv
    if errorlevel 1 (
        echo [错误] 创建虚拟环境失败
        pause
        exit /b 1
    )
) else (
    echo [2/6] 虚拟环境已存在
)
set "PY=.venv\Scripts\python.exe"
set "PIP=.venv\Scripts\pip.exe"

REM ===== 3. 安装依赖 =====
echo [3/6] 安装 Python 依赖（首次较慢）...
%PIP% install -r requirements.txt -q
if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络或 requirements.txt
    pause
    exit /b 1
)

REM ===== 4. 下载 KataGo =====
if exist "katago\katago.exe" (
    echo [4/6] KataGo 已就绪
) else (
    echo [4/6] 下载 KataGo 二进制 + 神经网络权重...
    powershell -ExecutionPolicy Bypass -File scripts\download_katago.ps1
    if errorlevel 1 (
        echo [错误] KataGo 下载失败
        pause
        exit /b 1
    )
)

REM ===== 5. 生成 .env =====
if exist ".env" (
    echo [5/6] .env 已存在
) else (
    echo [5/6] 从 .env.example 生成 .env ...
    copy .env.example .env >nul
)

REM ===== 6. 启动服务 =====
echo [6/6] 启动 FastAPI 服务...
echo.
echo ========================================
echo   后端:   http://localhost:8000
echo   文档:   http://localhost:8000/docs
echo   前端:   http://localhost:5173
echo   停止:   Ctrl+C
echo ========================================
echo.

REM 4 秒后自动打开浏览器
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:8000/docs"

%PY% -m uvicorn app.main:app --host 0.0.0.0 --port 8000

pause
