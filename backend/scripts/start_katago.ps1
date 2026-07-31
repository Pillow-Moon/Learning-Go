# ============================================================
# KataGo 本地启动/验证脚本（Windows）
#
# 说明：后端会在需要时自动以 subprocess 拉起 KataGo（GTP/Analysis），
#       通常无需手动启动。本脚本用于手动验证 KataGo 二进制与权重是否可用。
#
# 用法（在 backend 目录下）：
#   powershell -ExecutionPolicy Bypass -File scripts/start_katago.ps1
# ============================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$KatagoDir = Resolve-Path (Join-Path $ScriptDir "..\katago")
$Exe = Join-Path $KatagoDir "katago.exe"
$Model = Join-Path $KatagoDir "models\b18.bin.gz"
$Config = Join-Path $KatagoDir "katago.cfg"

Write-Output "=== KataGo 环境检查 ==="
Write-Output ("katago.exe : " + (Test-Path $Exe))
Write-Output ("b18.bin.gz : " + (Test-Path $Model))
Write-Output ("katago.cfg : " + (Test-Path $Config))

if (-not (Test-Path $Exe)) {
    Write-Warning "未找到 katago.exe，请先运行 scripts/download_katago.ps1 或手动下载。"
    exit 1
}
if (-not (Test-Path $Model)) {
    Write-Warning "未找到权重模型 b18.bin.gz，请先下载。"
    exit 1
}

Write-Output ""
Write-Output "=== 版本信息 ==="
& $Exe version

Write-Output ""
Write-Output "=== 快速 GTP 自检（boardsize + 退出）==="
# 向 GTP 发送 boardsize 与 quit，验证引擎可正常加载模型
$commands = "boardsize 9`nquit`n"
$commands | & $Exe gtp -model $Model -config $Config

Write-Output ""
Write-Output "若上方未报错，说明 KataGo 可用。后端启动后会自动管理 KataGo 进程，"
Write-Output "直接运行后端即可开始人机对弈与分析："
Write-Output "  cd backend; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000"
