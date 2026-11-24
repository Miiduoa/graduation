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

tronclass_runtime_dir="${TRONCLASS_RUNTIME_DIR:-}"
while [ -n "$tronclass_runtime_dir" ] && [ "$tronclass_runtime_dir" != "/" ] && [ "${tronclass_runtime_dir%/}" != "$tronclass_runtime_dir" ]; do
  tronclass_runtime_dir="${tronclass_runtime_dir%/}"
done
tronclass_physical_dir() {
  local target="$1"
  case "$target" in
    /*) ;;
    *) target="$TRONCLASS_PROJECT_ROOT/$target" ;;
  esac
  local acc="/" part next rest="${target#/}"
  while [ -n "$rest" ]; do
    if [ "$rest" = "${rest#*/}" ]; then
      part="$rest"
      rest=""
    else
      part="${rest%%/*}"
      rest="${rest#*/}"
    fi
    [ -z "$part" ] && continue
    if [ "$part" = "." ]; then continue; fi
    if [ "$part" = ".." ]; then
      [ "$acc" = "/" ] && continue
      acc="${acc%/*}"
      [ -n "$acc" ] || acc="/"
      continue
    fi
    if [ "$acc" = "/" ]; then next="/$part"; else next="$acc/$part"; fi
    if [ -L "$next" ] || { [ -e "$next" ] && [ -L "$next" ]; }; then
      echo 'TRONCLASS_RUNTIME_DIR must be a directory owned by this user, not a symbolic link.' >&2
      return 1
    fi
    acc="$next"
  done
  if [ -L "$acc" ] || [ ! -d "$acc" ]; then
    echo 'TRONCLASS_RUNTIME_DIR must be a directory owned by this user, not a symbolic link.' >&2
    return 1
  fi
  printf '%s' "$acc"
}
if [ -n "$tronclass_runtime_dir" ]; then
  tronclass_runtime_dir="$(tronclass_physical_dir "$tronclass_runtime_dir")" || exit 1
  if [ "$(stat -c '%u' "$tronclass_runtime_dir")" != "$(id -u)" ]; then
    echo 'TRONCLASS_RUNTIME_DIR must be owned by the current user.' >&2
    exit 1
  fi
  chmod 700 "$tronclass_runtime_dir"
  TRONCLASS_RUNTIME_DIR="$tronclass_runtime_dir"
else
  TRONCLASS_RUNTIME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/campus-tronclass-emulator.XXXXXX")"
  chmod 700 "$TRONCLASS_RUNTIME_DIR"
fi
if [ -L "$TRONCLASS_RUNTIME_DIR" ]; then
  echo 'Refusing a symbolic link runtime directory.' >&2
  exit 1
fi
export TRONCLASS_RUNTIME_DIR
for TRONCLASS_KEY_NAME in bff-session tronclass-session; do
  node - "$TRONCLASS_RUNTIME_DIR" "$TRONCLASS_KEY_NAME.key" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const runtimeDir = process.argv[2];
const target = path.resolve(runtimeDir, process.argv[3]);

function assertNoSymlinkComponent(targetPath, missingOk) {
  const resolved = path.resolve(targetPath);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (missingOk && error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('Refusing a symbolic link key file.');
  }
  return resolved;
}

assertNoSymlinkComponent(path.dirname(target), false);
let existing;
try { existing = fs.lstatSync(target); }
catch (error) {
  if (!error || error.code !== 'ENOENT') throw error;
  existing = null;
}
if (existing) {
  assertNoSymlinkComponent(target, false);
  if (existing.isSymbolicLink() || !existing.isFile()) {
    throw new Error('Refusing a non-regular session key file.');
  }
  if (existing.uid !== process.getuid()) {
    throw new Error('Refusing a session key file owned by another user.');
  }
  if (existing.nlink !== 1) {
    throw new Error('Refusing a hard-linked session key file.');
  }
  if ((existing.mode & 0o777) !== 0o600) {
    throw new Error('Refusing a session key file that is not mode 0600.');
  }
} else {
  fs.writeFileSync(target, randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
}
assertNoSymlinkComponent(target, false);
const resolvedKey = fs.realpathSync(target);
const resolvedDir = fs.realpathSync(runtimeDir);
const prefix = resolvedDir.endsWith(path.sep) ? resolvedDir : resolvedDir + path.sep;
if (!resolvedKey.startsWith(prefix)) {
  throw new Error('Refusing a session key path outside the runtime directory.');
}
if (!/^[A-Za-z0-9_-]{64}$/.test(fs.readFileSync(resolvedKey, 'utf8'))) throw new Error('Invalid local session key file.');
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

tronclass_open_log() {
  node - "$1" <<'NODE'
const fs = require('node:fs');
const logPath = process.argv[2];
const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW;
try {
  const fd = fs.openSync(logPath, flags, 0o600);
  fs.closeSync(fd);
} catch (error) {
  throw new Error('Refusing a symbolic link or unusable log file.');
}
NODE
}

# Keep Firebase data in the running emulator; restarting Next retains it.
# Do not automatically export school sessions after a live binding test.
tronclass_open_log "$TRONCLASS_RUNTIME_DIR/emulators.log"
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

tronclass_open_log "$TRONCLASS_RUNTIME_DIR/seed.log"
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
tronclass_open_log "$TRONCLASS_RUNTIME_DIR/web.log"
node ../../node_modules/next/dist/bin/next dev --webpack -p "$TEST_WEB_PORT" -H "$TEST_HOST" \
  >"$TRONCLASS_RUNTIME_DIR/web.log" 2>&1 &
TRONCLASS_WEB_PID=$!
if [ "${TRONCLASS_VERIFY_RUNTIME:-}" = '1' ] && [ "$TRONCLASS_INTEGRATION_ENABLED" = true ]; then
  cd "$TRONCLASS_PROJECT_ROOT"
  tronclass_open_log "$TRONCLASS_RUNTIME_DIR/acceptance.log"
  node scripts/test-env/verify-tronclass.cjs >"$TRONCLASS_RUNTIME_DIR/acceptance.log" 2>&1
  echo "Verified real emulator authentication and Firestore persistence; see $TRONCLASS_RUNTIME_DIR/acceptance.json."
fi
if [ "${TRONCLASS_CHECK_HEALTH:-}" = '1' ]; then
  cd "$TRONCLASS_PROJECT_ROOT"
  tronclass_open_log "$TRONCLASS_RUNTIME_DIR/health.log"
  node scripts/test-env/health-tronclass.cjs >"$TRONCLASS_RUNTIME_DIR/health.log" 2>&1
  echo "Verified read-only health and login page requests; see $TRONCLASS_RUNTIME_DIR/health.json."
fi
wait "$TRONCLASS_WEB_PID"
}

main "$@"
