@echo off
chcp 936 > nul
REM ============================================================
REM   Learning-Go One-Click Setup (downloaded from Settings page)
REM
REM   Double-click to run:
REM    1. Check git / python
REM    2. Clone/update repo to %%USERPROFILE%%\learning-go
REM    3. Call deploy\gpu-engine\launcher.bat
REM
REM   Repo: https://github.com/PillowMonth/Learning-Go
REM ============================================================

set "REPO_URL=https://github.com/PillowMonth/Learning-Go.git"
set "INSTALL_DIR=%USERPROFILE%\learning-go"

echo ========================================
echo   WeiQi AI JiaoXue - One-Click Setup
echo   Install dir: %INSTALL_DIR%
echo ========================================
echo.

REM --- Check git ---
where git >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Git not found. Install from:
    echo         https://git-scm.com/download/win
    pause
    exit /b 1
)

REM --- Check python ---
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ from:
    echo         https://www.python.org/downloads/
    echo         Check "Add Python to PATH" during install.
    pause
    exit /b 1
)

REM --- Clone or update repo ---
if exist "%INSTALL_DIR%\.git" (
    echo [1/2] Pulling latest code...
    git -C "%INSTALL_DIR%" pull --ff-only
    if errorlevel 1 echo [WARN] Pull failed, using local copy
) else (
    echo [1/2] Cloning repo to %INSTALL_DIR% ...
    if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"
    git clone "%REPO_URL%" "%INSTALL_DIR%"
    if errorlevel 1 (
        echo [ERROR] Clone failed. Check network.
        pause
        exit /b 1
    )
)

REM --- Launch ---
echo [2/2] Launching...
cd /d "%INSTALL_DIR%"
call "deploy\gpu-engine\launcher.bat"
