#!/usr/bin/env bash
# 啟動本機測試環境：Firebase 模擬器（demo-campus-one）＋測試帳號＋網頁。
# 用法：pnpm test-env:start        （網頁開在 http://127.0.0.1:3291）
#       pnpm test-env:start mobile （另外開 Expo，手機版也接模擬器）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/test-env/env.sh

if ! command -v java >/dev/null 2>&1; then
  echo "需要 Java 21（或 17）才能跑 Firebase 模擬器。"
  echo "  Ubuntu：sudo apt-get install -y openjdk-21-jre-headless"
  echo "  macOS ：brew install openjdk@21"
  exit 1
fi

LOG_DIR="${TEST_ENV_LOG_DIR:-$ROOT/.test-env}"
mkdir -p "$LOG_DIR"

echo "啟動 Firebase 模擬器（$TEST_PROJECT_ID）…"
pnpm --filter functions run build:shared >/dev/null
npx firebase emulators:start --project "$TEST_PROJECT_ID" --config firebase.test.json \
  --only auth,firestore,functions >"$LOG_DIR/emulators.log" 2>&1 &
EMU_PID=$!
echo "$EMU_PID" >"$LOG_DIR/emulators.pid"

for _ in $(seq 1 90); do
  if grep -q "All emulators ready" "$LOG_DIR/emulators.log" 2>/dev/null; then break; fi
  if ! kill -0 "$EMU_PID" 2>/dev/null; then
    echo "模擬器沒有起來，看 $LOG_DIR/emulators.log"
    exit 1
  fi
  sleep 2
done

node scripts/test-env/seed.cjs

if [ "${1:-}" = "mobile" ]; then
  echo "啟動 Expo（手機版接模擬器）…"
  (cd apps/mobile && npx expo start >"$LOG_DIR/mobile.log" 2>&1 &)
fi

echo "啟動網頁 http://$TEST_HOST:$TEST_WEB_PORT …"
cd apps/web
exec npx next dev -p "$TEST_WEB_PORT" -H "$TEST_HOST"
