@echo off
chcp 936 > nul
REM ============================================================
REM   Learning-Go Local GPU Engine Launcher (self-installing)
REM
REM   Auto-completes:
REM    1. Check Python
REM    2. Create/reuse venv .venv
REM    3. Install Python deps
REM    4. Download KataGo binary + neural net weights
REM    5. Generate .env config
REM    6. Start FastAPI server (port 8000)
REM
REM   After startup, open http://localhost:5173
REM   Select "Local GPU" engine in frontend Settings.
REM ============================================================

cd /d "%~dp0..\..\backend"
set "BACKEND_DIR=%CD%"

echo ========================================
echo   WeiQi AI - Local GPU Engine
echo   Dir: %BACKEND_DIR%
echo ========================================
echo.

REM ===== 1. Check Python =====
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ from:
    echo         https://www.python.org/downloads/
    echo         Check "Add Python to PATH" during install.
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set "PYVER=%%v"
echo [1/6] Python %PYVER% OK

REM ===== 2. Virtual env =====
if not exist ".venv\Scripts\python.exe" (
    echo [2/6] Creating venv .venv ...
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create venv
        pause
        exit /b 1
    )
) else (
    echo [2/6] venv already exists
)
set "PY=.venv\Scripts\python.exe"
set "PIP=.venv\Scripts\pip.exe"

REM ===== 3. Install deps =====
echo [3/6] Installing Python deps (slow first time)...
%PIP% install -r requirements.txt -q
if errorlevel 1 (
    echo [ERROR] Dep install failed. Check network or requirements.txt
    pause
    exit /b 1
)

REM ===== 4. Download KataGo =====
if exist "katago\katago.exe" (
    echo [4/6] KataGo ready
) else (
    echo [4/6] Downloading KataGo + weights...
    powershell -ExecutionPolicy Bypass -File scripts\download_katago.ps1
    if errorlevel 1 (
        echo [ERROR] KataGo download failed
        pause
        exit /b 1
    )
)

REM ===== 5. Generate .env =====
if exist ".env" (
    echo [5/6] .env exists
) else (
    echo [5/6] Generating .env from .env.example ...
    copy .env.example .env >nul
)

REM ===== 6. Start server =====
echo [6/6] Starting FastAPI server...
echo.
echo ========================================
echo   Backend:  http://localhost:8000
echo   API docs: http://localhost:8000/docs
echo   Frontend: http://localhost:5173
echo   Stop:     Ctrl+C
echo ========================================
echo.

REM Auto-open browser after 4s
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:8000/docs"

%PY% -m uvicorn app.main:app --host 0.0.0.0 --port 8000

pause
