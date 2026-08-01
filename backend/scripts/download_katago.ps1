# ============================================================
# KataGo 下载脚本（Windows）
# 下载 KataGo 二进制 + 神经网络权重到 backend/katago/
#
# 用法（在 backend 目录下）：
#   powershell -ExecutionPolicy Bypass -File scripts/download_katago.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/download_katago.ps1 -Model b18c384
#   powershell -ExecutionPolicy Bypass -File scripts/download_katago.ps1 -Model b10c384h6,b20c256,b28c512
#
# 说明：全部从 GitHub 官方 release 下载（国内通常可达）。
#   发布页：https://github.com/lightvector/KataGo/releases/tag/v1.17.0
#   本脚本固定使用 v1.17.0：该版本附带的模型资产与本项目兼容；
#   后续版本可能移除/改名这些资产，升级版本时若 404 请回到此发布页核对文件名。
#   - 二进制选用 eigenavx2 版（AVX2 SIMD 加速，需 CPU 支持 AVX2；
#     若 CPU 较老不支持 AVX2，请把下方 URL 中的 eigenavx2 改为 eigen）。
#   - 默认下载 b10c384h6（10 块 384 通道 6 头，速度/棋力均衡）；
#     可用 -Model 指定其他规格（GPU 越强可选越大模型）。
#     v1.17.0 附带的模型规格：
#       b10c384h6（38MB）/ b10c512h8（94MB）/ b11c768h12（212MB，最强）
# ============================================================

param(
    # 要下载的模型 id 列表（用逗号分隔多个）
    [string[]]$Model = @("b10c384h6")
)

$ErrorActionPreference = "Stop"
# 启用 TLS 1.2（部分服务器强制要求，PowerShell 默认可能未开启）
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$KataGoVersion = "v1.17.0"
$KataGoZipUrl = "https://github.com/lightvector/KataGo/releases/download/$KataGoVersion/katago-$KataGoVersion-eigenavx2-windows-x64.zip"

# 模型 id → release 资产文件名。
# 注意：v1.17.0 只附带 3 个模型资产（nbt 系列），
# 旧版本的 b6c96/b18c384/b20c256 等简单名模型在 v1.17.0 不存在（会 404）。
$ModelAssets = @{
    "b10c384h6"  = "b10c384h6nbttflrs.bin.gz"
    "b10c512h8"  = "b10c512h8nbt3tflrs-fson-silu-rsnh.bin.gz"
    "b11c768h12" = "b11c768h12nbt3tflrs-fson-silu.bin.gz"
}

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

# --- 下载神经网络权重（可多个）---
foreach ($id in $Model) {
    $asset = $ModelAssets[$id]
    if (-not $asset) {
        Write-Warning "[跳过] 未知模型 id: $id（可用: $($ModelAssets.Keys -join ', ')）"
        continue
    }
    $ModelPath = Join-Path $ModelsDir "$id.bin.gz"
    if (Test-Path $ModelPath) {
        Write-Output "[跳过] 已存在权重模型 $id"
    } else {
        $url = "https://github.com/lightvector/KataGo/releases/download/$KataGoVersion/$asset"
        Write-Output "[下载] 模型 $id ..."
        Invoke-WebRequest -Uri $url -OutFile $ModelPath -UseBasicParsing
        Write-Output "[完成] 模型已保存到 $ModelPath"
    }
}

Write-Output ""
Write-Output "=== 校验 ==="
Write-Output ("katago.exe      : " + (Test-Path $ExePath))
foreach ($id in $Model) {
    if ($ModelAssets[$id]) {
        Write-Output ("$id : " + (Test-Path (Join-Path $ModelsDir "$id.bin.gz")))
    }
}
if (Test-Path $ExePath) {
    Write-Output "二进制就绪。模型切换可在设置页「Local GPU → KataGo 模型」中进行。"
} else {
    Write-Warning "仍有文件缺失，请检查网络后重试。"
}
