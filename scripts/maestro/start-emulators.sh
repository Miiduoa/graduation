#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/test-env/env.sh
export NODE_PATH="$ROOT/backend/functions/node_modules"
node --experimental-strip-types -e "import('./scripts/maestro/emulator-env.mjs').then(m => m.emulatorEnvironment())"
LOG_DIR="${RUNNER_TEMP:-$ROOT/.test-env}/maestro-emulators"
mkdir -p "$LOG_DIR"
pnpm exec firebase emulators:start --project "$TEST_PROJECT_ID" --config firebase.test.json \
  --only auth,firestore >"$LOG_DIR/emulators.log" 2>&1 &
EMU_PID=$!
echo "$EMU_PID" > "$LOG_DIR/emulators.pid"
ready=false
for _ in $(seq 1 90); do
  if grep -q 'All emulators ready' "$LOG_DIR/emulators.log"; then ready=true; break; fi
  if ! kill -0 "$EMU_PID" 2>/dev/null; then
    echo "Firebase emulator startup failed; inspect $LOG_DIR/emulators.log" >&2
    exit 1
  fi
  sleep 2
done
if [ "$ready" != true ]; then
  kill "$EMU_PID" 2>/dev/null || true
  echo 'Firebase emulator readiness timed out' >&2
  exit 1
fi
node scripts/test-env/seed.cjs
node --experimental-strip-types scripts/maestro/seed-content.mjs
node --experimental-strip-types scripts/maestro/verify-emulator.mjs
if [ -n "${GITHUB_ENV:-}" ]; then
  # Expo reads these while embedding the Release JS bundle. Only public demo
  # settings are exported; no Firebase admin key or production credential.
  env | LC_ALL=C sort | while IFS='=' read -r key value; do
    case "$key" in
      EXPO_PUBLIC_FIREBASE_*|EXPO_PUBLIC_USE_FIREBASE_EMULATOR|FIREBASE_AUTH_EMULATOR_HOST|FIRESTORE_EMULATOR_HOST|TEST_PROJECT_ID)
        echo "$key=$value" >> "$GITHUB_ENV" ;;
    esac
  done
fi
