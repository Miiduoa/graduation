#!/usr/bin/env bash
# 分批長訓：預設每批 5 分鐘 × 24 批 ≈ 2 小時。
# 在 apps/mobile 下執行（或由 pnpm script 自動 cd）。
#
# 環境變數（可選）：
#   AI_TRAINING_BATCH_MS     每批時間上限（毫秒），預設 300000（5 分鐘）
#   AI_TRAINING_BATCH_COUNT  批數，預設 24（24×5min=2h）
#   AI_TRAINING_CALIB_ROUNDS 每批開場校正輪數，預設 0（與單次 2h 長跑一致）
#   AI_TRAINING_SEED_BASE    種子基底，預設沿用專案內 ai-training-long.test.ts 的預設；每批會加偏移避免批與批完全同序
#
# 建議 tee 全記錄：
#   pnpm ai:train:long:2h:5m 2>&1 | tee ai-training-2h-batches.log

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BATCH_MS="${AI_TRAINING_BATCH_MS:-300000}"
BATCH_COUNT="${AI_TRAINING_BATCH_COUNT:-24}"
CALIB="${AI_TRAINING_CALIB_ROUNDS:-0}"
SEED_BASE="${AI_TRAINING_SEED_BASE:-411211325}"

if ! [[ "$BATCH_MS" =~ ^[0-9]+$ ]] || [ "$BATCH_MS" -le 0 ]; then
  echo "[分批長訓] AI_TRAINING_BATCH_MS 必須為正整數" >&2
  exit 1
fi
if ! [[ "$BATCH_COUNT" =~ ^[0-9]+$ ]] || [ "$BATCH_COUNT" -le 0 ]; then
  echo "[分批長訓] AI_TRAINING_BATCH_COUNT 必須為正整數" >&2
  exit 1
fi

total_min=$((BATCH_MS * BATCH_COUNT / 60000))
echo "[分批長訓] 根目錄: $ROOT"
echo "[分批長訓] 每批 ${BATCH_MS} ms（$((BATCH_MS / 60000)) 分鐘）× ${BATCH_COUNT} 批 ≈ ${total_min} 分鐘總時長"
echo "[分批長訓] AI_TRAINING_CALIB_ROUNDS=${CALIB}"
echo ""

for ((i = 1; i <= BATCH_COUNT; i++)); do
  seed=$((SEED_BASE + i * 100003))
  echo "========== 第 ${i}/${BATCH_COUNT} 批開始（AI_TRAINING_MS=${BATCH_MS} seed=${seed}）=========="
  AI_TRAINING_MS="${BATCH_MS}" \
    AI_TRAINING_CALIB_ROUNDS="${CALIB}" \
    AI_TRAINING_SEED="${seed}" \
    pnpm ai:train:long
  echo "========== 第 ${i}/${BATCH_COUNT} 批結束 =========="
  echo ""
done

echo "[分批長訓] 全部 ${BATCH_COUNT} 批已完成。"
