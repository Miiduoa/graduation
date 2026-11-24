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

if [ "${TRONCLASS_SIGNAL_SELFTEST:-}" != '1' ]; then
  node -e 'if (!process.versions.node.startsWith("22.")) throw new Error("Use the repository Node 22 runtime.")'
  command -v java >/dev/null || { echo 'Java 21 is required for the Firestore emulator.' >&2; exit 1; }
fi

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
TRONCLASS_RUN_ID="$(openssl rand -hex 16 2>/dev/null || true)"
if ! printf '%s' "$TRONCLASS_RUN_ID" | grep -Eq '^[0-9a-fA-F]{32}$'; then
  TRONCLASS_RUN_ID="$(od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')"
fi
if ! printf '%s' "$TRONCLASS_RUN_ID" | grep -Eq '^[0-9a-fA-F]{32}$'; then
  echo 'Unable to generate a random run id.' >&2
  exit 1
fi
export TRONCLASS_RUN_ID
# Globals: cleanup() may run from the EXIT trap after main returns.
web_log="$TRONCLASS_RUNTIME_DIR/web.log.$TRONCLASS_RUN_ID"
emulator_log="$TRONCLASS_RUNTIME_DIR/emulators.log.$TRONCLASS_RUN_ID"
selftest_log="$TRONCLASS_RUNTIME_DIR/selftest.log.$TRONCLASS_RUN_ID"
seed_log="$TRONCLASS_RUNTIME_DIR/seed.log.$TRONCLASS_RUN_ID"
acceptance_log="$TRONCLASS_RUNTIME_DIR/acceptance.log.$TRONCLASS_RUN_ID"
health_log="$TRONCLASS_RUNTIME_DIR/health.log.$TRONCLASS_RUN_ID"
echo "RUN_ID=$TRONCLASS_RUN_ID"
# Install signal traps before any leftover sidecar is opened. Full cleanup
# replaces these once the process-group helpers are defined.
tronclass_early_cleanup() {
  local sig="${1:-}"
  trap - EXIT INT TERM
  if [ "$sig" = INT ]; then exit 130; fi
  if [ "$sig" = TERM ]; then exit 143; fi
}
trap 'tronclass_early_cleanup' EXIT
trap 'tronclass_early_cleanup INT' INT
trap 'tronclass_early_cleanup TERM' TERM
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

function validateExistingKey() {
  assertNoSymlinkComponent(target, false);
  const existing = fs.lstatSync(target);
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
  const resolvedKey = fs.realpathSync(target);
  const resolvedDir = fs.realpathSync(runtimeDir);
  const prefix = resolvedDir.endsWith(path.sep) ? resolvedDir : resolvedDir + path.sep;
  if (!resolvedKey.startsWith(prefix)) {
    throw new Error('Refusing a session key path outside the runtime directory.');
  }
  const body = fs.readFileSync(resolvedKey, 'utf8');
  if (!/^[A-Za-z0-9_-]{64}$/.test(body)) {
    const err = new Error('Invalid local session key file.');
    err.code = 'TRONCLASS_KEY_INCOMPLETE';
    throw err;
  }
}

const keyDeadline = Date.now() + 1000;
for (;;) {
  let existing;
  try { existing = fs.lstatSync(target); }
  catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
    existing = null;
  }
  try {
    if (existing) {
      validateExistingKey();
      break;
    }
    fs.writeFileSync(target, randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
    validateExistingKey();
    break;
  } catch (error) {
    const retry = error && (error.code === 'EEXIST' || error.code === 'ENOENT' ||
      error.code === 'TRONCLASS_KEY_INCOMPLETE');
    if (!retry || Date.now() >= keyDeadline) throw error;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
NODE
done
export BFF_SESSION_SECRET="$(<"$TRONCLASS_RUNTIME_DIR/bff-session.key")"
export TRONCLASS_SESSION_SECRET="$(<"$TRONCLASS_RUNTIME_DIR/tronclass-session.key")"

TRONCLASS_EMULATOR_PID=''
TRONCLASS_WEB_PID=''
TRONCLASS_SELFTEST_WRAPPER=''
TRONCLASS_SEED_PID=''
TRONCLASS_ACCEPTANCE_PID=''
TRONCLASS_HEALTH_PID=''
unset TRONCLASS_LAUNCHING_LOG
tronclass_proc_starttime() {
  local pid="$1"
  [ -r "/proc/$pid/stat" ] || return 1
  awk '{
    start = index($0, "(");
    rest = substr($0, start);
    closepos = 0;
    for (i = length(rest); i > 0; i--) if (substr(rest, i, 1) == ")") { closepos = i; break; }
    n = split(substr(rest, closepos + 1), f, /[[:space:]]+/);
    # fields after comm: 3=state ... 22=starttime => index 20 after leading empty split
    idx = 0;
    for (i = 1; i <= n; i++) if (f[i] != "") {
      idx++;
      if (idx == 20) { print f[i]; exit 0; }
    }
    exit 1;
  }' "/proc/$pid/stat"
}

tronclass_parse_record() {
  local raw="$1"
  local expected_run="$2"
  local pattern='^([0-9a-fA-F]{32})[[:blank:]]+([1-9][0-9]*)[[:blank:]]+([0-9]+)$'
  [[ "$raw" =~ $pattern ]] || return 1
  [ -z "$expected_run" ] || [ "${BASH_REMATCH[1]}" = "$expected_run" ] || return 1
  printf '%s %s %s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
}

tronclass_record_matches() {
  local pid="$1"
  local start="$2"
  # Reject PID 0 (kill -- -0 signals the caller's group), PID 1, and records
  # that never stored a start-time.
  case "$pid" in
    ''|0|1) return 1 ;;
  esac
  [ -n "$start" ] || return 1
  local live
  live="$(tronclass_proc_starttime "$pid" 2>/dev/null || true)"
  if [ -n "$live" ]; then
    [ "$live" = "$start" ]
    return $?
  fi
  # Leader is gone. Only signal the leftover group if this PID number is
  # unused (not reused by a new process).
  [ ! -e "/proc/$pid" ]
}

tronclass_read_record_file() {
  local file="$1"
  [ -n "$file" ] && [ -f "$file" ] && [ ! -L "$file" ] || return 1
  local raw
  raw="$(tronclass_read_regular_file "$file")" || return 1
  tronclass_parse_record "$raw" "${2-$TRONCLASS_RUN_ID}"
}

tronclass_capture_child_record() {
  local wrapper="$1"
  local i child start
  for i in $(seq 1 40); do
    child="$(ps -o pid= --ppid "$wrapper" 2>/dev/null | awk 'NF { print $1; exit }')"
    if [ -n "$child" ]; then
      start="$(tronclass_proc_starttime "$child" 2>/dev/null || true)"
      if [ -n "$start" ]; then
        if [ -z "${TRONCLASS_RUN_ID:-}" ]; then continue; fi
        printf '%s %s %s' "$TRONCLASS_RUN_ID" "$child" "$start"
        return 0
      fi
    fi
    sleep 0.05
  done
  return 1
}

tronclass_signal_record() {
  local record="$1"
  local sig="$2"
  local parsed run pid start
  parsed="$(tronclass_parse_record "$record" "$TRONCLASS_RUN_ID" 2>/dev/null || true)"
  [ -n "$parsed" ] || return 0
  run="$(printf '%s' "$parsed" | awk '{print $1}')"
  pid="$(printf '%s' "$parsed" | awk '{print $2}')"
  start="$(printf '%s' "$parsed" | awk '{print $3}')"
  [ "$run" = "${TRONCLASS_RUN_ID:-}" ] || return 0
  tronclass_record_matches "$pid" "$start" || return 0
  kill "-$sig" -- "-$pid" 2>/dev/null || true
  kill "-$sig" "$pid" 2>/dev/null || true
}

tronclass_group_alive_record() {
  local record="$1"
  local parsed pid start
  parsed="$(tronclass_parse_record "$record" "$TRONCLASS_RUN_ID" 2>/dev/null || true)"
  [ -n "$parsed" ] || return 1
  pid="$(printf '%s' "$parsed" | awk '{print $2}')"
  start="$(printf '%s' "$parsed" | awk '{print $3}')"
  tronclass_record_matches "$pid" "$start" || return 1
  if [ -e "/proc/$pid" ]; then
    return 0
  fi
  kill -0 -- "-$pid" 2>/dev/null
}

tronclass_stop_logged() {
  local wrapper="$1"
  local log="$2"
  local sig="${3:-TERM}"
  local memory="$4"
  # Keep this run's discovered groups for the later wait and KILL rounds.
  local memory_record=""
  [ -n "$memory" ] && memory_record="$(tronclass_parse_record "$memory" "$TRONCLASS_RUN_ID" 2>/dev/null || true)"
  local records=()
  [ -n "$memory_record" ] && records+=("$memory_record")
  local sidecar_record="" launcher_pgid
  read -r launcher_pgid < <(ps -o pgid= -p "$$")
  [ -n "$launcher_pgid" ] || return 1
  tronclass_discover_groups() {
    local child pgid group_start child_record existing run pid start
    local parents=() walk_pid
    # A detached leader can exit before ps sees it. Its wrapper recorded the
    # identity at spawn, and the group may still contain descendants.
    if [ -z "$sidecar_record" ] && [ -n "$log" ] &&
      child_record="$(tronclass_read_record_file "$log.pgid.$TRONCLASS_RUN_ID" 2>/dev/null)"; then
      read -r run pid start <<< "$child_record"
      if tronclass_record_matches "$pid" "$start" && kill -0 -- "-$pid" 2>/dev/null; then
        sidecar_record="$child_record"
        if [[ " ${records[*]} " != *" $sidecar_record "* ]]; then
          records+=("$sidecar_record")
        fi
      fi
    fi
    [ -n "$wrapper" ] || return 0
    parents+=("$wrapper")
    while [ "${#parents[@]}" -gt 0 ]; do
      walk_pid="${parents[0]}"
      parents=("${parents[@]:1}")
      while read -r child pgid; do
        [ -n "$child" ] || continue
        [ "$child" = "$wrapper" ] || parents+=("$child")
        [ "$pgid" != "$launcher_pgid" ] || continue
        group_start="$(tronclass_proc_starttime "$pgid" 2>/dev/null || true)"
        if [ -z "$group_start" ]; then
          [ ! -e "/proc/$pgid" ] || continue
          group_start=0
        fi
        child_record="$TRONCLASS_RUN_ID $pgid $group_start"
        for existing in "${records[@]}"; do
          [ "$existing" = "$child_record" ] && continue 2
        done
        records+=("$child_record")
      done < <(
        if [ "$walk_pid" = "$wrapper" ]; then
          ps -o pid=,pgid= -p "$wrapper" 2>/dev/null
        fi
        ps -o pid=,pgid= --ppid "$walk_pid" 2>/dev/null
      )
    done
  }
  # Give a late detached child time to appear before signalling the wrapper.
  local spawn_deadline=$((SECONDS + 6))
  tronclass_discover_groups
  if [ -z "$wrapper" ] && [ "${#records[@]}" -eq 0 ]; then return 0; fi
  while [ "${#records[@]}" -eq 0 ] && [ -n "$wrapper" ] &&
    [ "$SECONDS" -lt "$spawn_deadline" ] && kill -0 "$wrapper" 2>/dev/null; do
    sleep 0.1
    tronclass_discover_groups
  done
  tronclass_discover_groups
  local record
  for record in "${records[@]+"${records[@]}"}"; do
    tronclass_signal_record "$record" "$sig"
  done
  [ -n "$wrapper" ] && kill "-$sig" "$wrapper" 2>/dev/null || true
  local i
  for i in $(seq 1 20); do
    tronclass_discover_groups
    local wrapper_alive=0 group_alive=0
    [ -n "$wrapper" ] && kill -0 "$wrapper" 2>/dev/null && wrapper_alive=1
    for record in "${records[@]+"${records[@]}"}"; do
      tronclass_group_alive_record "$record" && group_alive=1
    done
    if [ "$wrapper_alive" -eq 0 ] && [ "$group_alive" -eq 0 ]; then
      return 0
    fi
    sleep 0.1
  done
  tronclass_discover_groups
  for record in "${records[@]+"${records[@]}"}"; do
    tronclass_signal_record "$record" KILL
  done
  [ -n "$wrapper" ] && kill -KILL "$wrapper" 2>/dev/null || true
  [ -n "$wrapper" ] && wait "$wrapper" 2>/dev/null || true
}

cleanup() {
  local sig="${1:-}"
  trap - EXIT INT TERM
  local child launch_signal=TERM pending_cleaned=''
  if [ -n "${TRONCLASS_LAUNCHING_LOG:-}" ]; then
    [ "$TRONCLASS_LAUNCHING_LOG" != "$emulator_log" ] || launch_signal=INT
    # The trap can run after fork and before the assignment of $!. At this
    # point only one launch is in flight. Exclude the already recorded jobs.
    for child in $(exec pgrep -P "$$"); do
      case "$child" in
        "$TRONCLASS_WEB_PID"|"$TRONCLASS_EMULATOR_PID"|"$TRONCLASS_SELFTEST_WRAPPER"|"$TRONCLASS_SEED_PID"|"$TRONCLASS_ACCEPTANCE_PID"|"$TRONCLASS_HEALTH_PID") continue ;;
      esac
      tronclass_stop_logged "$child" "$TRONCLASS_LAUNCHING_LOG" "$launch_signal" ""
      pending_cleaned="$TRONCLASS_LAUNCHING_LOG"
    done
  fi
  [ "$pending_cleaned" = "$web_log" ] || tronclass_stop_logged "$TRONCLASS_WEB_PID" "$web_log" TERM "${TRONCLASS_WEB_RECORD:-}"
  [ "$pending_cleaned" = "$emulator_log" ] || tronclass_stop_logged "$TRONCLASS_EMULATOR_PID" "$emulator_log" INT "${TRONCLASS_EMULATOR_RECORD:-}"
  [ "$pending_cleaned" = "$selftest_log" ] || tronclass_stop_logged "$TRONCLASS_SELFTEST_WRAPPER" "$selftest_log" TERM "${TRONCLASS_SELFTEST_RECORD:-}"
  [ "$pending_cleaned" = "$seed_log" ] || tronclass_stop_logged "$TRONCLASS_SEED_PID" "$seed_log" TERM "${TRONCLASS_SEED_RECORD:-}"
  [ "$pending_cleaned" = "$acceptance_log" ] || tronclass_stop_logged "$TRONCLASS_ACCEPTANCE_PID" "$acceptance_log" TERM "${TRONCLASS_ACCEPTANCE_RECORD:-}"
  [ "$pending_cleaned" = "$health_log" ] || tronclass_stop_logged "$TRONCLASS_HEALTH_PID" "$health_log" TERM "${TRONCLASS_HEALTH_RECORD:-}"
  if [ "$sig" = INT ]; then exit 130; fi
  if [ "$sig" = TERM ]; then exit 143; fi
}
trap 'cleanup' EXIT
trap 'cleanup INT' INT
trap 'cleanup TERM' TERM

tronclass_read_regular_file() {
  local file="$1"
  node - "$file" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
let fd;
try {
  fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
} catch (error) {
  process.exit(1);
}
try {
  const info = fs.fstatSync(fd);
  if (!info.isFile() || info.nlink !== 1) process.exit(1);
  const buf = Buffer.alloc(4096);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  process.stdout.write(buf.subarray(0, n));
} finally {
  fs.closeSync(fd);
}
NODE
}

# A wrapper can be between open and rename. Keep regular temporary files
# while their writer PID exists, including when the PID may have been reused.
stale_tmp_pattern='^\.pgid-([1-9][0-9]*)-[[:xdigit:]]+\.tmp$'
for stale_tmp in "$TRONCLASS_RUNTIME_DIR"/.pgid-*.tmp; do
  if [ ! -L "$stale_tmp" ] && [ -f "$stale_tmp" ] &&
    [[ "${stale_tmp##*/}" =~ $stale_tmp_pattern ]]; then
    writer_proc="/proc/${BASH_REMATCH[1]}"
    if [ -d "$writer_proc" ]; then
      # The state follows the final ')' even when the process name contains one.
      if ! IFS= read -r writer_stat 2>/dev/null < "$writer_proc/stat"; then
        continue
      fi
      case "${writer_stat##*) }" in
        'Z '*|'X '*) ;;
        *) continue ;;
      esac
    fi
  fi
  rm -f -- "$stale_tmp" 2>/dev/null || true
done
# Other runs' records are only inspected for staleness, never for signalling.
# A group can outlive its leader, so keep a matching record while it exists.
# Unreadable or unparseable leftovers are not live-run records; just remove them.
for stale_sidecar in "$TRONCLASS_RUNTIME_DIR"/*.log.pgid "$TRONCLASS_RUNTIME_DIR"/*.log.pgid.* "$TRONCLASS_RUNTIME_DIR"/*.log.*.pgid.*; do
  if [ -L "$stale_sidecar" ] || [ ! -f "$stale_sidecar" ]; then
    rm -f -- "$stale_sidecar" 2>/dev/null || true
    continue
  fi
  if ! stale_record="$(tronclass_read_record_file "$stale_sidecar" '' 2>/dev/null)"; then
    rm -f -- "$stale_sidecar" 2>/dev/null || true
    continue
  fi
  read -r stale_run stale_pid stale_start <<< "$stale_record"
  if [ "$stale_run" = "$TRONCLASS_RUN_ID" ] ||
    { tronclass_record_matches "$stale_pid" "$stale_start" && kill -0 -- "-$stale_pid" 2>/dev/null; }; then
    continue
  fi
  rm -f -- "$stale_sidecar" 2>/dev/null || true
done

tronclass_run_logged() {
  local log="$1"
  shift
  # Backgrounded calls exec so $! is this Node wrapper, not a Bash function
  # subshell that can ignore INT and leave the child holding the port.
  if [ "${TRONCLASS_RUN_LOGGED_EXEC:-}" = '1' ]; then
    exec node - "$log" "$@" <<'NODE'
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const logPath = process.argv[2];
const argv = process.argv.slice(3);
function refuseLog() {
  process.stderr.write('Refusing a symbolic link or unusable log file.\n');
  process.exit(1);
}
try {
  const existing = fs.lstatSync(logPath);
  if (!existing.isFile() || existing.nlink !== 1 || existing.uid !== process.getuid()) refuseLog();
} catch (error) {
  if (error && error.code !== 'ENOENT') refuseLog();
}
const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW;
let fd;
try {
  fd = fs.openSync(logPath, flags, 0o600);
} catch (error) {
  refuseLog();
}
const info = fs.fstatSync(fd);
if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid()) {
  fs.closeSync(fd);
  refuseLog();
}
fs.ftruncateSync(fd, 0);
let child = null;
let pendingSignal = null;
const stop = (signal) => {
  if (!child) { pendingSignal = signal; return; }
  try { process.kill(-child.pid, signal); } catch (error) { /* the group may already have exited */ }
  try { child.kill(signal); } catch (error) { /* the child may have already exited */ }
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
const delayMs = Number(process.env.TRONCLASS_TEST_DELAY_SPAWN_MS || 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}
child = spawn(argv[0], argv.slice(1), { stdio: ['inherit', fd, fd], detached: true });
fs.closeSync(fd);
const path = require('node:path');
const crypto = require('node:crypto');
function readStartTime(pid) {
  const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const rest = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/);
  return rest[19];
}
const runId = process.env.TRONCLASS_RUN_ID || '';
const pgidPath = `${logPath}.pgid.${runId}`;
try {
  const startTime = readStartTime(child.pid);
  if (!startTime) throw new Error('starttime');
  if (!/^[0-9a-fA-F]{32}$/.test(runId)) throw new Error('run-id');
  try {
    if (fs.lstatSync(pgidPath).isSymbolicLink()) throw new Error('symlink target');
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  const tmpPath = path.join(path.dirname(pgidPath), `.pgid-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
  const tmpFd = fs.openSync(tmpPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const tmpStat = fs.fstatSync(tmpFd);
    if (!tmpStat.isFile() || tmpStat.nlink !== 1 || tmpStat.uid !== process.getuid()) throw new Error('tmp');
    fs.writeSync(tmpFd, `${runId} ${child.pid} ${startTime}\n`);
    fs.fsyncSync(tmpFd);
  } finally {
    fs.closeSync(tmpFd);
  }
  try {
    if (fs.lstatSync(pgidPath).isSymbolicLink()) throw new Error('symlink target');
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  fs.renameSync(tmpPath, pgidPath);
  const verifyFd = fs.openSync(pgidPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(verifyFd);
    if (!info.isFile() || info.nlink !== 1) throw new Error('nlink');
  } finally {
    fs.closeSync(verifyFd);
  }
} catch (error) {
  process.stderr.write('Unable to record the logged child process group.\n');
}
if (pendingSignal) stop(pendingSignal);
child.on('exit', (code, signal) => {
  if (signal) {
    try { process.kill(process.pid, signal); } catch (error) { process.exit(1); }
    return;
  }
  process.exit(code ?? 1);
});
NODE
  fi
  node - "$log" "$@" <<'NODE'
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const logPath = process.argv[2];
const argv = process.argv.slice(3);
function refuseLog() {
  process.stderr.write('Refusing a symbolic link or unusable log file.\n');
  process.exit(1);
}
try {
  const existing = fs.lstatSync(logPath);
  if (!existing.isFile() || existing.nlink !== 1 || existing.uid !== process.getuid()) refuseLog();
} catch (error) {
  if (error && error.code !== 'ENOENT') refuseLog();
}
const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW;
let fd;
try {
  fd = fs.openSync(logPath, flags, 0o600);
} catch (error) {
  refuseLog();
}
const info = fs.fstatSync(fd);
if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid()) {
  fs.closeSync(fd);
  refuseLog();
}
fs.ftruncateSync(fd, 0);
let child = null;
let pendingSignal = null;
const stop = (signal) => {
  if (!child) { pendingSignal = signal; return; }
  try { process.kill(-child.pid, signal); } catch (error) { /* the group may already have exited */ }
  try { child.kill(signal); } catch (error) { /* the child may have already exited */ }
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
const delayMs = Number(process.env.TRONCLASS_TEST_DELAY_SPAWN_MS || 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}
child = spawn(argv[0], argv.slice(1), { stdio: ['inherit', fd, fd], detached: true });
fs.closeSync(fd);
const path = require('node:path');
const crypto = require('node:crypto');
function readStartTime(pid) {
  const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const rest = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/);
  return rest[19];
}
const runId = process.env.TRONCLASS_RUN_ID || '';
const pgidPath = `${logPath}.pgid.${runId}`;
try {
  const startTime = readStartTime(child.pid);
  if (!startTime) throw new Error('starttime');
  if (!/^[0-9a-fA-F]{32}$/.test(runId)) throw new Error('run-id');
  try {
    if (fs.lstatSync(pgidPath).isSymbolicLink()) throw new Error('symlink target');
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  const tmpPath = path.join(path.dirname(pgidPath), `.pgid-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
  const tmpFd = fs.openSync(tmpPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const tmpStat = fs.fstatSync(tmpFd);
    if (!tmpStat.isFile() || tmpStat.nlink !== 1 || tmpStat.uid !== process.getuid()) throw new Error('tmp');
    fs.writeSync(tmpFd, `${runId} ${child.pid} ${startTime}\n`);
    fs.fsyncSync(tmpFd);
  } finally {
    fs.closeSync(tmpFd);
  }
  try {
    if (fs.lstatSync(pgidPath).isSymbolicLink()) throw new Error('symlink target');
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  fs.renameSync(tmpPath, pgidPath);
  const verifyFd = fs.openSync(pgidPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(verifyFd);
    if (!info.isFile() || info.nlink !== 1) throw new Error('nlink');
  } finally {
    fs.closeSync(verifyFd);
  }
} catch (error) {
  process.stderr.write('Unable to record the logged child process group.\n');
}
if (pendingSignal) stop(pendingSignal);
child.on('exit', (code, signal) => {
  if (signal) {
    try { process.kill(process.pid, signal); } catch (error) { process.exit(1); }
    return;
  }
  process.exit(code ?? 1);
});
NODE
}

if [ "${TRONCLASS_SIGNAL_SELFTEST:-}" = '1' ]; then
  TRONCLASS_LAUNCHING_LOG="$selftest_log"
  TRONCLASS_RUN_LOGGED_EXEC=1 tronclass_run_logged "$selftest_log" \
    node -e 'const fs=require("node:fs"); const {spawn}=require("node:child_process"); const g=spawn(process.execPath,["-e","process.on(\"SIGTERM\",()=>{});process.on(\"SIGINT\",()=>{});require(\"node:fs\").writeFileSync(process.env.TRONCLASS_SELFTEST_GRANDCHILD,String(process.pid));setInterval(()=>{},1000);"],{stdio:"ignore"}); fs.writeFileSync(process.env.TRONCLASS_SELFTEST_CHILD,String(process.pid)); process.on("SIGTERM",()=>process.exit(0)); process.on("SIGINT",()=>process.exit(0)); setInterval(()=>{},1000);' &
  TRONCLASS_SELFTEST_WRAPPER=$!
  unset TRONCLASS_LAUNCHING_LOG
  echo "WRAPPER_PID=$TRONCLASS_SELFTEST_WRAPPER"
  unset TRONCLASS_RUN_LOGGED_EXEC
  if [ -n "${TRONCLASS_TEST_PAUSE_BEFORE_CAPTURE:-}" ]; then
    sleep "$TRONCLASS_TEST_PAUSE_BEFORE_CAPTURE"
  fi
  TRONCLASS_SELFTEST_RECORD="$(tronclass_capture_child_record "$TRONCLASS_SELFTEST_WRAPPER" || true)"
  wait "$TRONCLASS_SELFTEST_WRAPPER"
  exit 0
fi

# Keep Firebase data in the running emulator; restarting Next retains it.
# Do not automatically export school sessions after a live binding test.
TRONCLASS_LAUNCHING_LOG="$emulator_log"
TRONCLASS_RUN_LOGGED_EXEC=1 tronclass_run_logged "$emulator_log" \
  node node_modules/firebase-tools/lib/bin/firebase.js emulators:start \
  --project "$TEST_PROJECT_ID" --config firebase.test.json --only auth,firestore &
TRONCLASS_EMULATOR_PID=$!
unset TRONCLASS_LAUNCHING_LOG
unset TRONCLASS_RUN_LOGGED_EXEC
TRONCLASS_EMULATOR_RECORD="$(tronclass_capture_child_record "$TRONCLASS_EMULATOR_PID" || true)"
TRONCLASS_EMULATOR_READY=false
for _ in $(seq 1 90); do
  if ! kill -0 "$TRONCLASS_EMULATOR_PID" 2>/dev/null; then
    echo "Emulator startup failed; inspect $emulator_log" >&2
    exit 1
  fi
  if grep -q 'All emulators ready' "$emulator_log"; then
    TRONCLASS_EMULATOR_READY=true
    break
  fi
  sleep 1
done
if [ "$TRONCLASS_EMULATOR_READY" != true ]; then
  echo "Emulator startup timed out; inspect $emulator_log" >&2
  exit 1
fi

TRONCLASS_LAUNCHING_LOG="$seed_log"
TRONCLASS_RUN_LOGGED_EXEC=1 tronclass_run_logged "$seed_log" node scripts/test-env/seed.cjs --missing-only &
TRONCLASS_SEED_PID=$!
unset TRONCLASS_LAUNCHING_LOG
unset TRONCLASS_RUN_LOGGED_EXEC
TRONCLASS_SEED_RECORD="$(tronclass_capture_child_record "$TRONCLASS_SEED_PID" || true)"
wait "$TRONCLASS_SEED_PID"
TRONCLASS_SEED_PID=''
unset TRONCLASS_SEED_RECORD
node scripts/build-functions-shared.cjs
node scripts/import-ai/prepare-assets.mjs
echo "Full Web: $WEB_PUBLIC_ORIGIN/login?returnUrl=%2Ftronclass&schoolId=pu&reconnect=school"
echo "Use the local test student sign-in button."
echo "Logs: $TRONCLASS_RUNTIME_DIR (suffix: .$TRONCLASS_RUN_ID)."
if [ "$TRONCLASS_INTEGRATION_ENABLED" = true ]; then
  echo 'School binding is for single-user local use only. Enter school credentials in the TronClass form.'
else
  echo 'School binding is disabled. Use synthetic fixtures only.'
fi
cd apps/web
TRONCLASS_LAUNCHING_LOG="$web_log"
TRONCLASS_RUN_LOGGED_EXEC=1 tronclass_run_logged "$web_log" \
  node ../../node_modules/next/dist/bin/next dev --webpack -p "$TEST_WEB_PORT" -H "$TEST_HOST" &
TRONCLASS_WEB_PID=$!
unset TRONCLASS_LAUNCHING_LOG
unset TRONCLASS_RUN_LOGGED_EXEC
TRONCLASS_WEB_RECORD="$(tronclass_capture_child_record "$TRONCLASS_WEB_PID" || true)"
if [ "${TRONCLASS_VERIFY_RUNTIME:-}" = '1' ] && [ "$TRONCLASS_INTEGRATION_ENABLED" = true ]; then
  cd "$TRONCLASS_PROJECT_ROOT"
  TRONCLASS_LAUNCHING_LOG="$acceptance_log"
  TRONCLASS_RUN_LOGGED_EXEC=1 tronclass_run_logged "$acceptance_log" node scripts/test-env/verify-tronclass.cjs &
  TRONCLASS_ACCEPTANCE_PID=$!
  unset TRONCLASS_LAUNCHING_LOG
  unset TRONCLASS_RUN_LOGGED_EXEC
  TRONCLASS_ACCEPTANCE_RECORD="$(tronclass_capture_child_record "$TRONCLASS_ACCEPTANCE_PID" || true)"
  wait "$TRONCLASS_ACCEPTANCE_PID"
  TRONCLASS_ACCEPTANCE_PID=''
  unset TRONCLASS_ACCEPTANCE_RECORD
  echo "Verified real emulator authentication and Firestore persistence; see $TRONCLASS_RUNTIME_DIR/acceptance.json."
fi
if [ "${TRONCLASS_CHECK_HEALTH:-}" = '1' ]; then
  cd "$TRONCLASS_PROJECT_ROOT"
  TRONCLASS_LAUNCHING_LOG="$health_log"
  TRONCLASS_RUN_LOGGED_EXEC=1 tronclass_run_logged "$health_log" node scripts/test-env/health-tronclass.cjs &
  TRONCLASS_HEALTH_PID=$!
  unset TRONCLASS_LAUNCHING_LOG
  unset TRONCLASS_RUN_LOGGED_EXEC
  TRONCLASS_HEALTH_RECORD="$(tronclass_capture_child_record "$TRONCLASS_HEALTH_PID" || true)"
  wait "$TRONCLASS_HEALTH_PID"
  TRONCLASS_HEALTH_PID=''
  unset TRONCLASS_HEALTH_RECORD
  echo "Verified read-only health and login page requests; see $TRONCLASS_RUNTIME_DIR/health.json."
fi
wait "$TRONCLASS_WEB_PID"
}

main "$@"
