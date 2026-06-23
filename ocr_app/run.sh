#!/usr/bin/env bash
# 一键创建虚拟环境、安装依赖并启动桌面 OCR 工具。
set -e

cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
VENV=".venv"

if [ ! -d "$VENV" ]; then
  echo "[1/3] 创建虚拟环境 $VENV ..."
  "$PY" -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

echo "[2/3] 安装依赖 ..."
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo "[3/3] 启动应用 ..."
python -m ocr_app
