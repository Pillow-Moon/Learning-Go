# ============================================================
# KataGo 下载脚本（Windows）
# 下载 KataGo CPU 二进制 + 神经网络权重到 backend/katago/
#
# 用法（在 backend 目录下）：
#   powershell -ExecutionPolicy Bypass -File scripts/download_katago.ps1
#
# 说明：全部从 GitHub 官方 release 下载（国内通常可达）。
#   - 二进制选用 eigenavx2 版（AVX2 SIMD 加速，需 CPU 支持 AVX2；
#     若 CPU 较老不支持 AVX2，请把下方 URL 中的 eigenavx2 改为 eigen）。
#   - 模型选用 b10c384h6（10 块 384 通道 6 头，CPU 上速度/棋力均衡），
#     保存为 models/b10c384h6.bin.gz。
# ============================================================

$ErrorActionPreference = "Stop"
# 启用 TLS 1.2（部分服务器强制要求，PowerShell 默认可能未开启）
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$KataGoVersion = "v1.17.0"
$KataGoZipUrl = "https://github.com/lightvector/KataGo/releases/download/$KataGoVersion/katago-$KataGoVersion-eigenavx2-windows-x64.zip"
$ModelUrl = "https://github.com/lightvector/KataGo/releases/download/$KataGoVersion/b10c384h6nbttflrs.bin.gz"
$ModelFileName = "b10c384h6.bin.gz"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$KatagoDir = Resolve-Path (Join-Path $ScriptDir "..\katago")
$ModelsDir = Join-Path $KatagoDir "models"
$ZipPath = Join-Path $env:TEMP "katago-eigenavx2.zip"

New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

# --- 下载 KataGo 二进制（eigenavx2）---
$ExePath = Join-Path $KatagoDir "katago.exe"
$needBinary = (-not (Test-Path $ExePath)) -or ((& $ExePath version 2>$null) -notmatch "1\.17")
if ($needBinary) {
    Write-Output "[下载] KataGo $KataGoVersion (eigenavx2 Windows)..."
    Invoke-WebRequest -Uri $KataGoZipUrl -OutFile $ZipPath -UseBasicParsing
    Expand-Archive -Path $ZipPath -DestinationPath $KatagoDir -Force
    Write-Output "[完成] 已解压到 $KatagoDir"
} else {
    Write-Output "[跳过] 已存在 KataGo v1.17 二进制"
}

# --- 下载神经网络权重 ---
$ModelPath = Join-Path $ModelsDir $ModelFileName
if (Test-Path $ModelPath) {
    Write-Output "[跳过] 已存在权重模型 $ModelFileName"
} else {
    Write-Output "[下载] 神经网络权重 b10c384h6（约 38MB）..."
    Invoke-WebRequest -Uri $ModelUrl -OutFile $ModelPath -UseBasicParsing
    Write-Output "[完成] 模型已保存到 $ModelPath"
}

Write-Output ""
Write-Output "=== 校验 ==="
Write-Output ("katago.exe      : " + (Test-Path $ExePath))
Write-Output ($ModelFileName + " : " + (Test-Path $ModelPath))
if ((Test-Path $ExePath) -and (Test-Path $ModelPath)) {
    Write-Output "两者就绪，可启动后端进行人机对弈与分析。"
} else {
    Write-Warning "仍有文件缺失，请检查网络后重试。"
}
