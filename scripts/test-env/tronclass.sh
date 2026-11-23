#!/usr/bin/env bash
# Full Next.js + real local Auth/Firestore emulators. School binding still uses
# the normal TronClass form; this script never imports a browser session.
# Parse the launcher completely before starting long-lived child processes so
# edits during a preview cannot change Bash's remaining input stream.
main() {
set -euo pipefail
umask 077
TRONCLASS_PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$TRONCLASS_PROJECT_ROOT"

# env.sh pins the listeners to loopback. Check the requested host before
# sourcing it so a non-loopback request still disables school binding.
TRONCLASS_LOCAL_BINDING=true
for requested_host in "${TEST_HOST:-127.0.0.1}" "${HOST:-127.0.0.1}"; do
  case "$requested_host" in
    127.0.0.1|localhost) ;;
    *) TRONCLASS_LOCAL_BINDING=false ;;
  esac
done
if [[ -n "${CI:-}${TRONCLASS_MANAGED_PREVIEW:-}${VERCEL:-}${NETLIFY:-}${CODESPACES:-}${GITPOD_WORKSPACE_ID:-}" ]]; then
  TRONCLASS_LOCAL_BINDING=false
fi
source scripts/test-env/env.sh

for TRONCLASS_ENV_FILE in .env .env.local .env.development .env.development.local \
  apps/web/.env apps/web/.env.local apps/web/.env.development apps/web/.env.development.local; do
  if [ -f "$TRONCLASS_ENV_FILE" ]; then
    echo 'Use a clean checkout for this isolated emulator runtime; application environment files must not be loaded.' >&2
    exit 1
  fi
done

if [ "${TRONCLASS_MANAGED_PREVIEW:-}" = '1' ]; then
  export TEST_WEB_PORT="${PORT:-4173}"
  export NEXT_PUBLIC_FIREBASE_EMULATOR_SAME_ORIGIN=true
fi

# Test identities and their tokens must never use a production Firebase app.
unset FIREBASE_SERVICE_ACCOUNT_JSON GOOGLE_APPLICATION_CREDENTIALS FIREBASE_CONFIG GOOGLE_CLOUD_PROJECT
unset NEXT_PUBLIC_FUNCTIONS_BASE_URL PLATFORM_GOOGLE_CLIENT_SECRET CAMPUS_BACKEND
# Next instrumentation and file/assistant stores also run in development. Never
# inherit their production persistence, credentials, or background-worker flags.
unset TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL
unset FILE_STORAGE_BACKEND NEXT_PUBLIC_FILE_STORAGE_BACKEND
unset SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_STORAGE_BUCKET
unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
unset DATABASE_URL ASSIGNMENT_FILE_DATABASE_URL PLATFORM_ASSISTANT_DATABASE_URL
unset ASSIGNMENT_FILE_SIGNING_SECRET ASSIGNMENT_FILE_STORE_DIR
export NODE_ENV=development
export NEXT_PUBLIC_ENABLE_UNIVERSAL_DEV_ACCOUNTS=false
export NEXT_PUBLIC_ALLOW_LOCAL_MOCK_AUTH=false
export SCHOOL_STUDENT_ID_LOGIN_ENABLED=true
export NUNI_CLASSROOM_ENABLED=false
export PLATFORM_GOOGLE_LOGIN_ENABLED=false
export CAMPUS_LEGACY_ENABLED=false
export TRONCLASS_INTEGRATION_ENABLED="$TRONCLASS_LOCAL_BINDING"
export TRONCLASS_RETENTION_ENABLED=true
export TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED=false
export NEXT_PUBLIC_LMS_V2=false
export NUNI_API_BASE_URL=http://127.0.0.1:9
export WEB_PUBLIC_ORIGIN="http://$TEST_HOST:$TEST_WEB_PORT"
export NEXT_PUBLIC_SITE_URL="$WEB_PUBLIC_ORIGIN"
export NO_PROXY="${NO_PROXY:-},127.0.0.1,localhost"

node -e 'if (!process.versions.node.startsWith("22.")) throw new Error("Use the repository Node 22 runtime.")'
command -v java >/dev/null || { echo 'Java 21 is required for the Firestore emulator.' >&2; exit 1; }

TRONCLASS_RUNTIME_DIR="${TRONCLASS_RUNTIME_DIR:-${TMPDIR:-/tmp}/campus-tronclass-emulator-$UID}"
export TRONCLASS_RUNTIME_DIR
mkdir -p "$TRONCLASS_RUNTIME_DIR"
chmod 700 "$TRONCLASS_RUNTIME_DIR"
for TRONCLASS_KEY_NAME in bff-session tronclass-session; do
  node - "$TRONCLASS_RUNTIME_DIR/$TRONCLASS_KEY_NAME.key" <<'NODE'
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const target = process.argv[2];
if (!fs.existsSync(target)) fs.writeFileSync(target, randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
if (!/^[A-Za-z0-9_-]{64}$/.test(fs.readFileSync(target, 'utf8'))) throw new Error('Invalid local session key file.');
fs.chmodSync(target, 0o600);
NODE
done
export BFF_SESSION_SECRET="$(<"$TRONCLASS_RUNTIME_DIR/bff-session.key")"
export TRONCLASS_SESSION_SECRET="$(<"$TRONCLASS_RUNTIME_DIR/tronclass-session.key")"

TRONCLASS_EMULATOR_PID=''
TRONCLASS_WEB_PID=''
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$TRONCLASS_WEB_PID" ]; then kill "$TRONCLASS_WEB_PID" 2>/dev/null || true; fi
  if [ -n "$TRONCLASS_EMULATOR_PID" ]; then
    kill -INT "$TRONCLASS_EMULATOR_PID" 2>/dev/null || true
    wait "$TRONCLASS_EMULATOR_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Keep Firebase data in the running emulator; restarting Next retains it.
# Do not automatically export school sessions after a live binding test.
node node_modules/firebase-tools/lib/bin/firebase.js emulators:start \
  --project "$TEST_PROJECT_ID" --config firebase.test.json --only auth,firestore \
  >"$TRONCLASS_RUNTIME_DIR/emulators.log" 2>&1 &
TRONCLASS_EMULATOR_PID=$!
TRONCLASS_EMULATOR_READY=false
for _ in $(seq 1 90); do
  if ! kill -0 "$TRONCLASS_EMULATOR_PID" 2>/dev/null; then
    echo "Emulator startup failed; inspect $TRONCLASS_RUNTIME_DIR/emulators.log" >&2
    exit 1
  fi
  if grep -q 'All emulators ready' "$TRONCLASS_RUNTIME_DIR/emulators.log"; then
    TRONCLASS_EMULATOR_READY=true
    break
  fi
  sleep 1
done
if [ "$TRONCLASS_EMULATOR_READY" != true ]; then
  echo "Emulator startup timed out; inspect $TRONCLASS_RUNTIME_DIR/emulators.log" >&2
  exit 1
fi

node scripts/test-env/seed.cjs --missing-only >"$TRONCLASS_RUNTIME_DIR/seed.log" 2>&1
node scripts/build-functions-shared.cjs
node scripts/import-ai/prepare-assets.mjs
echo "Full Web: $WEB_PUBLIC_ORIGIN/login?returnUrl=%2Ftronclass&schoolId=pu&reconnect=school"
echo "Use the local test student sign-in button."
echo "Logs: $TRONCLASS_RUNTIME_DIR."
if [ "$TRONCLASS_INTEGRATION_ENABLED" = true ]; then
  echo 'School binding is for single-user local use only. Enter school credentials in the TronClass form.'
else
  echo 'School binding is disabled. Use synthetic fixtures only.'
fi
cd apps/web
node ../../node_modules/next/dist/bin/next dev --webpack -p "$TEST_WEB_PORT" -H "$TEST_HOST" \
  >"$TRONCLASS_RUNTIME_DIR/web.log" 2>&1 &
TRONCLASS_WEB_PID=$!
if [ "${TRONCLASS_VERIFY_RUNTIME:-}" = '1' ] && [ "$TRONCLASS_INTEGRATION_ENABLED" = true ]; then
  cd "$TRONCLASS_PROJECT_ROOT"
  node scripts/test-env/verify-tronclass.cjs >"$TRONCLASS_RUNTIME_DIR/acceptance.log" 2>&1
  echo "Verified real emulator authentication and Firestore persistence; see $TRONCLASS_RUNTIME_DIR/acceptance.json."
fi
if [ "${TRONCLASS_CHECK_HEALTH:-}" = '1' ]; then
  cd "$TRONCLASS_PROJECT_ROOT"
  node scripts/test-env/health-tronclass.cjs >"$TRONCLASS_RUNTIME_DIR/health.log" 2>&1
  echo "Verified read-only health and login page requests; see $TRONCLASS_RUNTIME_DIR/health.json."
fi
wait "$TRONCLASS_WEB_PID"
}

main "$@"
