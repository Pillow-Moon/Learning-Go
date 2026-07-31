# ============================================================
# KataGo 下载脚本（Windows）
# 下载 KataGo CPU(Eigen) 二进制 + b18 权重模型到 backend/katago/
#
# 用法（在 backend 目录下）：
#   powershell -ExecutionPolicy Bypass -File scripts/download_katago.ps1
#
# 若因网络问题下载失败，请手动下载后放到对应位置：
#   1. KataGo 程序（Windows Eigen 版 zip）：
#      https://github.com/lightvector/KataGo/releases
#      解压出 katago.exe 放到 backend/katago/katago.exe
#   2. b18 权重模型（.bin.gz）：
#      https://katago.ai/models.html  （选 b18c384nbt 系列）
#      放到 backend/katago/models/b18.bin.gz
# ============================================================

$ErrorActionPreference = "Stop"

# 版本与下载地址（如失效请到上面官方页面获取最新链接）
$KataGoVersion = "v1.15.3"
$KataGoZipUrl = "https://github.com/lightvector/KataGo/releases/download/$KataGoVersion/katago-$KataGoVersion-eigen-windows-x64.zip"
$ModelUrl = "https://media.katago.ai/models/b18c384nbt/b18c384nbt-uec-b18nbt-2024.bin.gz"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$KatagoDir = Resolve-Path (Join-Path $ScriptDir "..\katago")
$ModelsDir = Join-Path $KatagoDir "models"
$ZipPath = Join-Path $env:TEMP "katago-eigen.zip"

New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

# --- 下载 KataGo 二进制 ---
$ExePath = Join-Path $KatagoDir "katago.exe"
if (Test-Path $ExePath) {
    Write-Output "[跳过] 已存在 katago.exe"
} else {
    Write-Output "[下载] KataGo $KataGoVersion (Eigen)..."
    try {
        Invoke-WebRequest -Uri $KataGoZipUrl -OutFile $ZipPath -UseBasicParsing
        Expand-Archive -Path $ZipPath -DestinationPath $KatagoDir -Force
        Write-Output "[完成] 已解压到 $KatagoDir"
    } catch {
        Write-Warning "自动下载失败：$_"
        Write-Warning "请手动从 https://github.com/lightvector/KataGo/releases 下载 Eigen Windows 版，"
        Write-Warning "解压 katago.exe 到 $ExePath"
    }
}

# --- 下载 b18 权重模型 ---
$ModelPath = Join-Path $ModelsDir "b18.bin.gz"
if (Test-Path $ModelPath) {
    Write-Output "[跳过] 已存在 b18.bin.gz"
} else {
    Write-Output "[下载] b18 权重模型（约 100MB，请耐心等待）..."
    try {
        Invoke-WebRequest -Uri $ModelUrl -OutFile $ModelPath -UseBasicParsing
        Write-Output "[完成] 模型已保存到 $ModelPath"
    } catch {
        Write-Warning "自动下载失败：$_"
        Write-Warning "请手动从 https://katago.ai/models.html 下载 b18c384nbt 模型，"
        Write-Warning "保存为 $ModelPath"
    }
}

Write-Output ""
Write-Output "=== 校验 ==="
Write-Output ("katago.exe : " + (Test-Path $ExePath))
Write-Output ("b18.bin.gz : " + (Test-Path $ModelPath))
Write-Output "两者都为 True 即可启动后端进行人机对弈。"
