#!/usr/bin/env bash
# APP 離線情境「訓練」馬拉松 — 在周邊時間內重複跑滿整套 AI／代理 Jest。
#
#   DURATION_SECONDS 預設 3600（一小時）。
#   用法（專案根目錄）：
#     bash scripts/ai-app-scenario-marathon.sh
#     bash scripts/ai-app-scenario-marathon.sh 1800
#   或從 apps/mobile：
#     pnpm test:ai:marathon

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT/apps/mobile"

DURATION="${1:-${DURATION_SECONDS:-3600}}"
LOG="${AI_MARATHON_LOG:-$ROOT/tmp/ai-marathon.log}"
mkdir -p "$(dirname "$LOG")"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
export EXPO_PUBLIC_AI_PROVIDER="${EXPO_PUBLIC_AI_PROVIDER:-offline}"
export EXPO_PUBLIC_AI_TEST_FAST="${EXPO_PUBLIC_AI_TEST_FAST:-1}"

# 每輪大量口語種子回放（可自行調整）
export AI_SELF_TEST_ROUNDS="${AI_SELF_TEST_ROUNDS:-2500}"
AI_SELF_TEST_BASE_SEED="${AI_SELF_TEST_BASE_SEED:-411211325}"

JEST_MOBILE=(
  "src/__tests__/services/aiConversationSim.test.ts"
  "src/__tests__/services/aiConversationMarathon.test.ts"
  "src/__tests__/services/aiOpenEndedNaturalLanguage.test.ts"
  "src/__tests__/services/aiSelfDialogMultiTurn.test.ts"
  "src/__tests__/services/aiConversationQuality.test.ts"
  "src/__tests__/services/aiAgentWideCoverage.test.ts"
  "src/__tests__/services/aiAgentSafetyHardening.test.ts"
  "src/__tests__/services/aiSelfDialog.test.ts"
  "src/__tests__/services/aiAssistantProfile.test.ts"
  "src/__tests__/services/aiAppContext.test.ts"
  "src/__tests__/services/aiToolLayer.test.ts"
  "src/__tests__/services/aiAgentRouting.test.ts"
  "src/__tests__/services/aiActionExecutor.test.ts"
  "src/__tests__/services/aiToolRegistry.test.ts"
  "src/__tests__/services/aiReflexion.test.ts"
  "src/__tests__/services/proactiveAI.test.ts"
)

run_backend_intent_matrix() {
  echo ""
  echo "──────── $(date -Iseconds) backend agent selfTrainingScenarios (jest) ────────" | tee -a "$LOG"
  if ! ( cd "$ROOT/backend/functions" && pnpm exec jest agent/selfTrainingScenarios.test.js --runInBand >>"$LOG" 2>&1 ); then
    echo "!!! FAIL $(date -Iseconds) selfTrainingScenarios (jest) !!!" | tee -a "$LOG"
  fi
}

run_one() {
  local path="$1"
  echo ""
  echo "──────── $(date -Iseconds)  $path ────────" | tee -a "$LOG"
  if ! npx jest "$path" --runInBand >>"$LOG" 2>&1; then
    echo "!!! FAIL $(date -Iseconds) $path !!!" | tee -a "$LOG"
  fi
}

END_TS=$(( $(date +%s) + DURATION ))
iter=0

{
  echo "AI marathon start $(date -Iseconds) duration=${DURATION}s log=$LOG"
  echo "PWD=$(pwd)"
} | tee -a "$LOG"

while (( $(date +%s) < END_TS )); do
  iter=$((iter + 1))
  export AI_SELF_TEST_SEED="$(( AI_SELF_TEST_BASE_SEED + iter * 7919 ))"
  rem=$(( END_TS - $(date +%s) ))
  echo "" | tee -a "$LOG"
  echo "════ Iteration #$iter ▶ remaining ~${rem}s seed=${AI_SELF_TEST_SEED} ($(date -Iseconds)) ════" | tee -a "$LOG"

  suite_count="${#JEST_MOBILE[@]}"
  for ((offset = 0; offset < suite_count; offset++)); do
    path="${JEST_MOBILE[$(((offset + iter - 1) % suite_count))]}"
    run_one "$path"
  done

  if [[ -d "$ROOT/backend/functions" ]] && [[ -f "$ROOT/backend/functions/agent/selfTrainingScenarios.test.js" ]]; then
    run_backend_intent_matrix
  fi

  echo "–– end iteration #$iter ($(date -Iseconds)) ––" >>"$LOG"
done

echo ""
echo "AI marathon finished $(date -Iseconds) after ${DURATION}s log=$LOG" | tee -a "$LOG"
