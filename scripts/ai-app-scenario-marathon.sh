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
FAIL_FAST="${AI_MARATHON_FAIL_FAST:-1}"
MAX_ITERATIONS="${AI_MARATHON_MAX_ITERATIONS:-0}"
TYPECHECK_EVERY="${AI_MARATHON_TYPECHECK_EVERY:-24}"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
export EXPO_PUBLIC_AI_PROVIDER="${EXPO_PUBLIC_AI_PROVIDER:-offline}"
export EXPO_PUBLIC_AI_TEST_FAST="${EXPO_PUBLIC_AI_TEST_FAST:-1}"

# 每輪大量口語種子回放（可自行調整）
export AI_SELF_TEST_ROUNDS="${AI_SELF_TEST_ROUNDS:-2500}"
SEED_HISTORY="${AI_SELF_TEST_SEED_HISTORY:-$ROOT/tmp/ai-marathon-seeds-used.log}"
mkdir -p "$(dirname "$SEED_HISTORY")"

if [[ -n "${AI_SELF_TEST_BASE_SEED:-}" ]]; then
  AI_SELF_TEST_SEED_SOURCE="env"
else
  AI_SELF_TEST_SEED_SOURCE="generated"
  seed_material="$(date +%s)-$$-${RANDOM:-0}-${RANDOM:-0}-$LOG"
  AI_SELF_TEST_BASE_SEED="$(printf '%s' "$seed_material" | cksum | awk '{print $1}')"
  while [[ -f "$SEED_HISTORY" ]] && grep -qx "$AI_SELF_TEST_BASE_SEED" "$SEED_HISTORY"; do
    seed_material="${seed_material}-${RANDOM:-0}"
    AI_SELF_TEST_BASE_SEED="$(printf '%s' "$seed_material" | cksum | awk '{print $1}')"
  done
fi

AI_SELF_TEST_SEED_STEP="${AI_SELF_TEST_SEED_STEP:-104729}"

next_unique_seed() {
  local iter="$1"
  local proposed="$(( AI_SELF_TEST_BASE_SEED + iter * AI_SELF_TEST_SEED_STEP ))"

  while [[ -f "$SEED_HISTORY" ]] && grep -qx "$proposed" "$SEED_HISTORY"; do
    proposed="$(( proposed + AI_SELF_TEST_SEED_STEP + iter + 1 ))"
  done

  printf '%s\n' "$proposed" >>"$SEED_HISTORY"
  printf '%s\n' "$proposed"
}

JEST_MOBILE=(
  "src/__tests__/aiContextBuilder.test.ts"
  "src/__tests__/aiDataInventory.test.ts"
  "src/__tests__/aiOrchestrator.test.ts"
  "src/__tests__/aiStudyBuddyMatcher.test.ts"
  "src/__tests__/aiThinkingLearning.test.ts"
  "src/__tests__/aiTrustCard.test.ts"
  "src/__tests__/assistantReplySupervisor.test.ts"
  "src/__tests__/companionDeepIntegration.test.ts"
  "src/__tests__/data/campusAgentSource.test.ts"
  "src/__tests__/feedbackDrafter.test.ts"
  "src/__tests__/gradePredictionFromScoreRows.test.ts"
  "src/__tests__/gradePredictor.test.ts"
  "src/__tests__/mistakeRepertoire.test.ts"
  "src/__tests__/notificationPlanner.test.ts"
  "src/__tests__/recommendLunch.test.ts"
  "src/__tests__/socraticCoach.test.ts"
  "src/__tests__/studentRiskEngine.test.ts"
  "src/__tests__/studyPlanner.test.ts"
  "src/__tests__/vendorPredictor.test.ts"
  "src/__tests__/services/aiConversationSim.test.ts"
  "src/__tests__/services/aiConversationMarathon.test.ts"
  "src/__tests__/services/aiDynamicTraining.test.ts"
  "src/__tests__/services/aiOpenEndedNaturalLanguage.test.ts"
  "src/__tests__/services/aiAgentProcessTraining.test.ts"
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
  "src/__tests__/services/aiWebSearchIntegration.test.ts"
  "src/__tests__/services/diningAgentData.test.ts"
  "src/__tests__/services/aiReflexion.test.ts"
  "src/__tests__/services/proactiveAI.test.ts"
  "src/__tests__/services/webLearning.test.ts"
  "src/__tests__/services/webSearch.test.ts"
)

JEST_BACKEND_AGENT=(
  "assistantAgent.test.js"
  "agent/runtime.safety.test.js"
  "agent/intentWritePlan.test.js"
  "agent/learning/breakthroughPlanner.test.js"
  "agent/selfTrainingScenarios.test.js"
  "agent/classifyIntent.test.js"
  "agent/safety.test.js"
  "agent/tools/searchCampusDocs.test.js"
  "agent/tools/getLibraryLoans.test.js"
  "agent/tools/submitLeaveRequest.test.js"
  "agent/tools/reflectOnGap.test.js"
  "agent/tools/getPrioritySummary.test.js"
  "agent/tools/registry.test.js"
  "agent/tools/getLeaveRequestStatus.test.js"
)

maybe_fail_fast() {
  if [[ "$FAIL_FAST" != "0" && "$FAIL_FAST" != "false" ]]; then
    echo "AI marathon stopped after first failure $(date -Iseconds) log=$LOG" | tee -a "$LOG"
    exit 1
  fi
}

run_mobile_typecheck() {
  echo ""
  echo "──────── $(date -Iseconds) mobile typecheck ────────" | tee -a "$LOG"
  if ! pnpm run typecheck >>"$LOG" 2>&1; then
    echo "!!! FAIL $(date -Iseconds) mobile typecheck !!!" | tee -a "$LOG"
    maybe_fail_fast
  fi
}

run_backend_one() {
  local path="$1"
  echo ""
  echo "──────── $(date -Iseconds) backend $path (jest) ────────" | tee -a "$LOG"
  if ! ( cd "$ROOT/backend/functions" && pnpm exec jest "$path" --runInBand >>"$LOG" 2>&1 ); then
    echo "!!! FAIL $(date -Iseconds) backend $path !!!" | tee -a "$LOG"
    maybe_fail_fast
  fi
}

run_one() {
  local path="$1"
  echo ""
  echo "──────── $(date -Iseconds)  $path ────────" | tee -a "$LOG"
  if ! npx jest "$path" --runInBand >>"$LOG" 2>&1; then
    echo "!!! FAIL $(date -Iseconds) $path !!!" | tee -a "$LOG"
    maybe_fail_fast
  fi
}

END_TS=$(( $(date +%s) + DURATION ))
iter=0

{
  echo "AI marathon start $(date -Iseconds) duration=${DURATION}s log=$LOG"
  echo "PWD=$(pwd)"
  echo "AI_SELF_TEST_BASE_SEED=${AI_SELF_TEST_BASE_SEED} source=${AI_SELF_TEST_SEED_SOURCE} step=${AI_SELF_TEST_SEED_STEP} seed_history=${SEED_HISTORY}"
  echo "AI_MARATHON_FAIL_FAST=${FAIL_FAST}"
  echo "AI_MARATHON_MAX_ITERATIONS=${MAX_ITERATIONS}"
  echo "AI_MARATHON_TYPECHECK_EVERY=${TYPECHECK_EVERY}"
  echo "MOBILE_AI_SUITE_COUNT=${#JEST_MOBILE[@]}"
  echo "BACKEND_AGENT_SUITE_COUNT=${#JEST_BACKEND_AGENT[@]}"
} | tee -a "$LOG"

while (( $(date +%s) < END_TS )); do
  if (( MAX_ITERATIONS > 0 && iter >= MAX_ITERATIONS )); then
    break
  fi

  iter=$((iter + 1))
  export AI_SELF_TEST_SEED="$(next_unique_seed "$iter")"
  rem=$(( END_TS - $(date +%s) ))
  echo "" | tee -a "$LOG"
  echo "════ Iteration #$iter ▶ remaining ~${rem}s seed=${AI_SELF_TEST_SEED} ($(date -Iseconds)) ════" | tee -a "$LOG"

  suite_count="${#JEST_MOBILE[@]}"
  for ((offset = 0; offset < suite_count; offset++)); do
    path="${JEST_MOBILE[$(((offset + iter - 1) % suite_count))]}"
    run_one "$path"
  done

  backend_suite_count="${#JEST_BACKEND_AGENT[@]}"
  if [[ -d "$ROOT/backend/functions" ]]; then
    for ((offset = 0; offset < backend_suite_count; offset++)); do
      path="${JEST_BACKEND_AGENT[$(((offset + iter - 1) % backend_suite_count))]}"
      if [[ -f "$ROOT/backend/functions/$path" ]]; then
        run_backend_one "$path"
      fi
    done
  fi

  if (( TYPECHECK_EVERY > 0 && iter % TYPECHECK_EVERY == 0 )); then
    run_mobile_typecheck
  fi

  echo "–– end iteration #$iter ($(date -Iseconds)) ––" >>"$LOG"
done

echo ""
echo "AI marathon finished $(date -Iseconds) after ${DURATION}s log=$LOG" | tee -a "$LOG"
