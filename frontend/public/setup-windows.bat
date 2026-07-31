@echo off
chcp 65001 > nul
REM ============================================================
REM 围棋AI教学平台 - Windows 一键安装启动器（下载自前端设置页）
REM
REM 双击运行即可：
REM   1. 检查 git / python
REM   2. 克隆项目到 %USERPROFILE%\learning-go（已存在则更新）
REM   3. 调用项目内置 launcher.bat 完成依赖安装、KataGo 下载、
REM      数据库迁移并启动服务
REM
REM 仓库地址: https://github.com/PillowMonth/Learning-Go
REM ============================================================

set "REPO_URL=https://github.com/PillowMonth/Learning-Go.git"
set "INSTALL_DIR=%USERPROFILE%\learning-go"

echo ========================================
echo   围棋AI教学平台 - 一键安装
echo   安装位置: %INSTALL_DIR%
echo ========================================
echo.

REM --- 检查 git ---
where git >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 git，请先安装：
    echo        https://git-scm.com/download/win
    pause
    exit /b 1
)

REM --- 检查 python ---
where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装 Python 3.10+：
    echo        https://www.python.org/downloads/
    echo        安装时勾选 "Add Python to PATH"。
    pause
    exit /b 1
)

REM --- 克隆或更新仓库 ---
if exist "%INSTALL_DIR%\.git" (
    echo [1/2] 仓库已存在，拉取最新代码...
    git -C "%INSTALL_DIR%" pull --ff-only
    if errorlevel 1 echo [警告] 拉取失败，继续使用本地版本
) else (
    echo [1/2] 克隆仓库到 %INSTALL_DIR% ...
    if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"
    git clone "%REPO_URL%" "%INSTALL_DIR%"
    if errorlevel 1 (
        echo [错误] 克隆失败，请检查网络
        pause
        exit /b 1
    )
)

REM --- 调用项目内启动器 ---
echo [2/2] 调用项目启动器...
cd /d "%INSTALL_DIR%"
call "deploy\gpu-engine\launcher.bat"
