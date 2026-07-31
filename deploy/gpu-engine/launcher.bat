@echo off
REM ============================================================
REM 围棋AI教学平台 - 本地GPU引擎一键启动器
REM
REM 双击此文件即可启动本地KataGo后端服务。
REM 启动后在浏览器打开 http://localhost:5173 使用。
REM 前端设置中选择 "Local GPU" 引擎来源。
REM
REM 前置条件：
REM   - Python 3.10+ 已安装
REM   - backend/.venv/ 已创建（运行过一次 pip install -r requirements.txt）
REM   - KataGo二进制 + 模型已下载到 backend/katago/
REM ============================================================

cd /d "%~dp0..\backend"

echo ========================================
echo   围棋AI教学平台 - 本地GPU引擎
echo ========================================
echo.
echo 正在启动后端服务...
echo 浏览器访问 http://localhost:5173
echo 按 Ctrl+C 停止服务
echo.

.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000

pause
