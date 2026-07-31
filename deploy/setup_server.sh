#!/usr/bin/env bash
# ============================================================
# 云服务器一键环境搭建脚本（Ubuntu 22.04）
#
# 用法（在项目根目录 Learning-Go/ 下）：
#   bash deploy/setup_server.sh
#
# 完成内容：
#   1. 安装 Python3 / Node.js 等系统依赖
#   2. 创建后端虚拟环境并安装依赖
#   3. 下载 KataGo（Linux 版）+ b18 权重
#   4. 构建前端静态文件
#   5. 初始化数据库 + 导入种子数据
#   6. 安装并启动 systemd 服务
# ============================================================
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

KATAGO_VERSION="v1.15.3"
KATAGO_ZIP_URL="https://github.com/lightvector/KataGo/releases/download/${KATAGO_VERSION}/katago-${KATAGO_VERSION}-linux-x64.zip"
MODEL_URL="https://media.katago.ai/models/b18c384nbt/b18c384nbt-uec-b18nbt-2024.bin.gz"

echo "==> [1/6] 安装系统依赖"
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip nodejs npm wget unzip

echo "==> [2/6] 后端虚拟环境与依赖"
python3 -m venv backend/.venv
backend/.venv/bin/pip install --upgrade pip
backend/.venv/bin/pip install -r backend/requirements.txt

echo "==> [3/6] 下载 KataGo 与权重"
mkdir -p backend/katago/models
if [ ! -f backend/katago/katago ]; then
  wget -O /tmp/katago.zip "$KATAGO_ZIP_URL" || echo "!! KataGo 下载失败，请手动下载 Linux 版放到 backend/katago/katago"
  [ -f /tmp/katago.zip ] && unzip -o /tmp/katago.zip -d backend/katago/ && chmod +x backend/katago/katago
fi
if [ ! -f backend/katago/models/b18.bin.gz ]; then
  wget -O backend/katago/models/b18.bin.gz "$MODEL_URL" || echo "!! 权重下载失败，请手动下载到 backend/katago/models/b18.bin.gz"
fi
# Linux 下二进制名为 katago（无 .exe），同步配置
sed -i 's#katago.exe#katago#g' backend/.env 2>/dev/null || true

echo "==> [4/6] 构建前端"
cd frontend
npm install
npm run build
cd "$PROJECT_DIR"

echo "==> [5/6] 初始化数据库与种子数据"
cd backend
cp -n .env.example .env || true
.venv/bin/python -m app.core.init_db
cd "$PROJECT_DIR"

echo "==> [6/6] 安装 systemd 服务"
sudo cp deploy/learning-go.service /etc/systemd/system/learning-go.service
sudo sed -i "s#__PROJECT_DIR__#$PROJECT_DIR#g" /etc/systemd/system/learning-go.service
sudo systemctl daemon-reload
sudo systemctl enable learning-go
sudo systemctl restart learning-go

echo ""
echo "=== 部署完成 ==="
echo "服务状态： sudo systemctl status learning-go"
echo "访问地址： http://<服务器公网IP>:8000"
echo "（记得在云控制台安全组开放 8000 端口）"
