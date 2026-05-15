#!/usr/bin/env bash
# 不依賴 AI：即時查看長時訓練狀態與 log。
#
#   chmod +x training/watch_training.sh
#   ./training/watch_training.sh           # 自動找最新 train_24h_*.log，印健康摘要後 tail -f
#   ./training/watch_training.sh path/to.log   # 指定檔案
#   ./training/watch_training.sh --status-only # 只看摘要，不 tail

set -euo pipefail
cd "$(dirname "$0")/.."

STATUS_ONLY=false
LOG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --status-only) STATUS_ONLY=true; shift ;;
    -*) echo "未知選項: $1"; exit 1 ;;
    *) LOG="$1"; shift ;;
  esac
done

if [[ -z "$LOG" ]]; then
  LOG="$(ls -t data/training/logs/train_24h_*.log 2>/dev/null | head -1 || true)"
fi

echo "=== Campus LoRA 訓練／除錯摘要 ($(date -Iseconds)) ==="

if pgrep -f "mlx_lm lora" >/dev/null 2>&1; then
  echo "[行程] mlx_lm lora 仍在跑："
  pgrep -f "mlx_lm lora" | while read -r p; do ps -p "$p" -o pid=,command= 2>/dev/null || true; done
else
  echo "[行程] 目前沒有 mlx_lm lora 行程（可能已結束或未啟動）。"
fi

echo ""
PID_FILE="$(ls -t data/training/logs/train_24h_*.pid 2>/dev/null | head -1 || true)"
if [[ -n "${PID_FILE:-}" && -f "$PID_FILE" ]]; then
  WRAPPER_PID="$(cat "$PID_FILE" | tr -d '[:space:]')"
  echo "[PID 檔] $PID_FILE → $WRAPPER_PID"
  if kill -0 "$WRAPPER_PID" 2>/dev/null; then
    echo "        wrapper 仍在（run.sh / train_timed 那一層）。"
  else
    echo "        wrapper 已結束。"
  fi
else
  echo "[PID 檔] 找不到 train_24h_*.pid（若手動開跑屬正常）。"
fi

echo ""
ADAPTER_DIR="data/lora_adapters/campus_lora"
if [[ -d "$ADAPTER_DIR" ]]; then
  echo "[Adapter] $ADAPTER_DIR"
  ls -lt "$ADAPTER_DIR"/*.safetensors 2>/dev/null | head -5 || echo "        （尚無 .safetensors）"
else
  echo "[Adapter] 目錄不存在: $ADAPTER_DIR"
fi

echo ""
if [[ -z "$LOG" || ! -f "$LOG" ]]; then
  echo "[Log] 找不到 log。請："
  echo "      ls -lt data/training/logs/"
  echo "      或 ./training/watch_training.sh data/training/logs/train_24h_YYYYMMDD_HHMMSS.log"
  exit 1
fi

echo "[Log] $LOG （最近錯誤／警告關鍵字）"
grep -n -i -E 'error|exception|traceback|failed|nan|oom|out of memory|cuda|metal' "$LOG" | tail -15 || echo "        （此檔內尚無匹配列）"

echo ""
echo "--- 最後 25 行 ---"
tail -n 25 "$LOG"

if "$STATUS_ONLY"; then
  exit 0
fi

echo ""
echo "--- tail -f（Ctrl+C 離開；不中斷訓練）---"
tail -f "$LOG"
