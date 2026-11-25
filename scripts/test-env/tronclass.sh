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
source scripts/process-identity.sh

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
# Keep the verifier alive until Bash has taken its own reference to the same
# directory. The path is only used to identify and verify the directory entry.
coproc TRONCLASS_RUNTIME_SETUP {
  python3 -I - "$tronclass_runtime_dir" "${TMPDIR:-/tmp}" 3<&0 <<'PYTHON'
import os
import secrets
import stat
import sys
import tempfile

specified = bool(sys.argv[1])
requested = sys.argv[1] or sys.argv[2]
flags = os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW
fds = []
bindings = []

def identity(info):
    return info.st_dev, info.st_ino

def open_directory(name):
    parent_fd = fds[-1]
    fd = os.open(name, flags, dir_fd=parent_fd)
    fds.append(fd)
    opened = os.fstat(fd)
    bindings.append((parent_fd, name, identity(opened), opened.st_uid))
    return opened

def verify_bindings():
    # Walk back to the root so a renamed ancestor cannot hide a replacement
    # from the check relative to the pinned parent.
    for parent_fd, name, expected, owner in reversed(bindings):
        current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if (not stat.S_ISDIR(current.st_mode) or identity(current) != expected
                or current.st_uid != owner):
            raise OSError("replaced runtime directory")

try:
    fds.append(os.open("/", flags))
    absolute = requested if requested.startswith("/") else os.getcwd() + "/" + requested
    opened = os.fstat(fds[-1])
    unresolved = 0
    for name in absolute.split("/"):
        if not specified:
            if name not in ("", "."):
                opened = open_directory(name)
            continue
        if name in ("", "."):
            continue
        if name == "..":
            if unresolved:
                unresolved -= 1
            elif bindings:
                bindings.pop()
                os.close(fds.pop())
                opened = os.fstat(fds[-1])
        elif unresolved:
            unresolved += 1
        else:
            try:
                opened = open_directory(name)
            except (FileNotFoundError, NotADirectoryError, PermissionError):
                # Preserve lexical '..' for a component that cannot be walked.
                # A symbolic link is still invalid even if '..' cancels it.
                try:
                    entry = os.stat(name, dir_fd=fds[-1], follow_symlinks=False)
                except (FileNotFoundError, PermissionError):
                    pass
                else:
                    if stat.S_ISLNK(entry.st_mode):
                        raise OSError("symbolic link runtime component")
                unresolved = 1
    if unresolved:
        raise OSError("unresolved runtime directory")

    if specified and (opened.st_uid != os.getuid() or not opened.st_ino):
        raise OSError("invalid runtime directory")
    verify_bindings()

    # Each pinned parent must protect entries owned by the launcher.
    share = specified and stat.S_IMODE(opened.st_mode) in (0o700, 0o2700)
    for fd in (fds[:-1] if share else fds):
        directory = os.fstat(fd)
        if (directory.st_uid not in (os.getuid(), 0)
                or (directory.st_mode & 0o022 and not directory.st_mode & stat.S_ISVTX)):
            sys.exit("TronClass runtime parent must be owned by the current user or root and must have the sticky bit if writable by others.")

    # Other modes and the default location get a private child.
    if not share:
        prefix = "run-" if specified else "campus-tronclass-emulator."
        os.umask(0o077)
        while True:
            name = prefix + secrets.token_hex(16)
            try:
                os.mkdir(name, 0o700, dir_fd=fds[-1])
            except FileExistsError:
                continue
            opened = open_directory(name)
            break
        # setgid inheritance does not grant group access.
        if opened.st_uid != os.getuid() or stat.S_IMODE(opened.st_mode) not in (0o700, 0o2700):
            raise OSError("invalid newly created runtime directory")

    verify_bindings()
    target = os.readlink(f"/proc/self/fd/{fds[-1]}")
    descriptor = f"/proc/{os.getpid()}/fd/{fds[-1]}".encode()
    # mkstemp creates and opens the same inode. The pathname is used only
    # to unlink our entry; a replacement, including a symlink, is ignored.
    journal_fd, journal_name = tempfile.mkstemp(prefix="tronclass-groups.", dir="/tmp")
    fds.append(journal_fd)
    journal = os.fstat(journal_fd)
    if not stat.S_ISREG(journal.st_mode) or journal.st_uid != os.getuid():
        raise OSError("invalid group journal")
    try:
        named = os.lstat(journal_name)
    except FileNotFoundError:
        pass
    else:
        if stat.S_ISREG(named.st_mode) and identity(named) == identity(journal):
            os.unlink(journal_name)
    journal_descriptor = f"/proc/{os.getpid()}/fd/{journal_fd}".encode()
    sys.stdout.buffer.write(os.fsencode(target) + b"\0" + descriptor + b"\0" + journal_descriptor + b"\0")
    sys.stdout.buffer.flush()
    if os.read(3, 1) != b"1":
        raise OSError("runtime directory descriptor was not transferred")
    verify_bindings()
except OSError:
    sys.exit("TRONCLASS_RUNTIME_DIR must be a directory owned by the current user, not a symbolic link or replaced directory.")
finally:
    for fd in reversed(fds):
        os.close(fd)
PYTHON
}
runtime_setup_pid="${TRONCLASS_RUNTIME_SETUP_PID:-}"
if ! { IFS= read -r -d '' TRONCLASS_RUNTIME_DIR &&
       IFS= read -r -d '' runtime_descriptor &&
       IFS= read -r -d '' journal_descriptor &&
       exec {runtime_fd}<"$runtime_descriptor" &&
       exec {group_journal_fd}<>"$journal_descriptor"; } <&"${TRONCLASS_RUNTIME_SETUP[0]:-}" ||
   ! printf 1 >&"${TRONCLASS_RUNTIME_SETUP[1]:-}"; then
  exit 1
fi
wait "$runtime_setup_pid"
unset runtime_descriptor journal_descriptor TRONCLASS_REPORT_DIR_FD TRONCLASS_WRITE_RUNTIME_REPORT
export TRONCLASS_RUNTIME_DIR
# Bash reopens the private inode through procfs. Keep this reference for
# shell utilities and Node (which has no openat API); the original path is
# display metadata only.
runtime_anchor="/proc/self/fd/$runtime_fd"
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
web_log="$runtime_anchor/web.log.$TRONCLASS_RUN_ID"
emulator_log="$runtime_anchor/emulators.log.$TRONCLASS_RUN_ID"
selftest_log="$runtime_anchor/selftest.log.$TRONCLASS_RUN_ID"
seed_log="$runtime_anchor/seed.log.$TRONCLASS_RUN_ID"
acceptance_log="$runtime_anchor/acceptance.log.$TRONCLASS_RUN_ID"
health_log="$runtime_anchor/health.log.$TRONCLASS_RUN_ID"
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
# All journal writers share this append descriptor. Readers use positional I/O
# so concurrent cleanup passes do not move its offset.
python3 -I -c 'import fcntl, os
fcntl.fcntl(3, fcntl.F_SETFL, fcntl.fcntl(3, fcntl.F_GETFL) | os.O_APPEND)' 3<&"$group_journal_fd"

tronclass_read_group_journal() {
  python3 -I -c 'import os, sys
offset = 0
remaining = os.fstat(3).st_size
while remaining:
    data = os.pread(3, min(remaining, 65536), offset)
    if not data:
        break
    sys.stdout.buffer.write(data)
    offset += len(data)
    remaining -= len(data)' 3<&"$group_journal_fd"
}
tronclass_read_session_key() {
  node - /proc/self/fd/4 "$1.key" 4<&"$runtime_fd" <<'NODE'
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const target = `${process.argv[2]}/${process.argv[3]}`;

function readExistingKey() {
  const named = fs.lstatSync(target, { bigint: true });
  if (named.isSymbolicLink()) throw new Error('Refusing a symbolic link key file.');
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const existing = fs.fstatSync(fd, { bigint: true });
    if (existing.dev !== named.dev || existing.ino !== named.ino) {
      throw new Error('Session key file changed while opening it.');
    }
    validateKeyIdentity(existing);
    const buffer = Buffer.alloc(65);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const body = buffer.toString('utf8', 0, length);
    if (length !== 64 || !/^[A-Za-z0-9_-]{64}$/.test(body)) {
      const err = new Error('Invalid local session key file.');
      err.code = 'TRONCLASS_KEY_INCOMPLETE';
      throw err;
    }
    return body;
  } finally {
    fs.closeSync(fd);
  }
}

function validateKeyIdentity(existing) {
  if (!existing.isFile()) {
    throw new Error('Refusing a non-regular session key file.');
  }
  if (existing.uid !== BigInt(process.getuid())) {
    throw new Error('Refusing a session key file owned by another user.');
  }
  if (existing.nlink !== 1n) {
    throw new Error('Refusing a hard-linked session key file.');
  }
  if ((existing.mode & 0o777n) !== 0o600n) {
    throw new Error('Refusing a session key file that is not mode 0600.');
  }
}

const createFlags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
const keyDeadline = Date.now() + 1000;
for (;;) {
  try {
    let key;
    try {
      key = readExistingKey();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.writeFileSync(target, randomBytes(48).toString('base64url'), { mode: 0o600, flag: createFlags });
      key = readExistingKey();
    }
    process.stdout.write(key);
    break;
  } catch (error) {
    const retry = error && (error.code === 'EEXIST' || error.code === 'ENOENT' ||
      error.code === 'TRONCLASS_KEY_INCOMPLETE');
    if (!retry || Date.now() >= keyDeadline) throw error;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
NODE
}
# Capture the bytes from the verified descriptor before exporting them.
BFF_SESSION_SECRET="$(tronclass_read_session_key bff-session)"
TRONCLASS_SESSION_SECRET="$(tronclass_read_session_key tronclass-session)"
export BFF_SESSION_SECRET TRONCLASS_SESSION_SECRET

TRONCLASS_EMULATOR_PID=''
TRONCLASS_WEB_PID=''
TRONCLASS_SELFTEST_WRAPPER=''
TRONCLASS_SEED_PID=''
TRONCLASS_ACCEPTANCE_PID=''
TRONCLASS_HEALTH_PID=''
unset TRONCLASS_LAUNCHING_LOG
tronclass_proc_starttime() {
  local pid="$1"
  local proc_group proc_start proc_state
  proc_identity "$pid" || return 1
  printf '%s' "$proc_start"
}

tronclass_parse_record() {
  local raw="$1"
  local expected_run="$2"
  local pattern='^([0-9a-fA-F]{32})[[:blank:]]+([1-9][0-9]*)[[:blank:]]+([0-9]+)([[:blank:]]+([1-9][0-9]*))?$'
  [[ "$raw" =~ $pattern ]] || return 1
  [ -z "$expected_run" ] || [ "${BASH_REMATCH[1]}" = "$expected_run" ] || return 1
  # Legacy sidecars imply PID == PGID and are only consulted for staleness.
  [ -z "$expected_run" ] || [ -n "${BASH_REMATCH[5]}" ] || return 1
  local group="${BASH_REMATCH[5]:-${BASH_REMATCH[2]}}"
  [ "$group" = "${BASH_REMATCH[2]}" ] || return 1
  printf '%s %s %s %s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "$group"
}

tronclass_record_matches() {
  local pid="$1"
  local start="$2"
  [[ "$pid" =~ ^([2-9]|[1-9][0-9]+)$ && "$start" =~ ^[0-9]+$ ]] || return 1
  local live
  live="$(tronclass_proc_starttime "$pid" 2>/dev/null)" && [ "$live" = "$start" ]
}

tronclass_signal_wrapper() {
  local pid="$1" start="$2" sig="$3"
  tronclass_record_matches "$pid" "$start" || return 0
  local proc_group proc_start proc_state deadline=$((EPOCHSECONDS + 3))
  local delivered=0
  if proc_send_signal "$pid" "$start" "" "" "$sig"; then
    [[ "$sig" == KILL ]] || return 0
    delivered=1
  fi
  while proc_identity "$pid" && [[ "$proc_start" == "$start" && "$proc_state" != Z && "$proc_state" != X ]]; do
    if (( !delivered || EPOCHSECONDS >= deadline )); then
      echo "Could not stop launcher wrapper $pid." >&2
      return 1
    fi
    sleep 0.01
  done
}

tronclass_read_record_file() {
  local file="$1"
  [ -n "$file" ] && [ -f "$file" ] && [ ! -L "$file" ] || return 1
  local raw
  raw="$(tronclass_read_regular_file "$file")" || return 1
  tronclass_parse_record "$raw" "${2-$TRONCLASS_RUN_ID}"
}

tronclass_signal_record() {
  local record="$1"
  local sig="$2"
  local parsed run pid start group
  parsed="$(tronclass_parse_record "$record" "$TRONCLASS_RUN_ID" 2>/dev/null || true)"
  [ -n "$parsed" ] || return 0
  read -r run pid start group <<< "$parsed"
  [ "$run" = "${TRONCLASS_RUN_ID:-}" ] || return 0
  proc_signal_marked_group "$pid" "$start" "$group" "TRONCLASS_LAUNCHED_RUN=$run" "$sig"
}

tronclass_group_alive_record() {
  local record="$1"
  local parsed run pid start group
  parsed="$(tronclass_parse_record "$record" "$TRONCLASS_RUN_ID" 2>/dev/null || true)"
  [ -n "$parsed" ] || return 1
  read -r run pid start group <<< "$parsed"
  proc_signal_marked_group "$pid" "$start" "$group" "TRONCLASS_LAUNCHED_RUN=$run"
}

tronclass_stop_logged() {
  local wrapper="$1"
  local log="$2"
  local sig="${3:-TERM}"
  local wrapper_start="$4"
  local records=()
  local launcher_pgid
  read -r launcher_pgid < <(ps -o pgid= -p "$$")
  [ -n "$launcher_pgid" ] || return 1
  tronclass_discover_groups() {
    local child pgid group_start child_record existing journal_log
    local parents=() walk_pid
    # A detached leader can exit before ps sees it. Its wrapper recorded the
    # identity at spawn, and the group may still contain descendants.
    while read -r journal_log child_record; do
      [ "$journal_log" = "${log##*/}" ] || continue
      for existing in "${records[@]}"; do
        [ "$existing" = "$child_record" ] && continue 2
      done
      records+=("$child_record")
    done < <(tronclass_read_group_journal)
    tronclass_record_matches "$wrapper" "$wrapper_start" || return 0
    parents+=("$wrapper")
    while [ "${#parents[@]}" -gt 0 ]; do
      walk_pid="${parents[0]}"
      parents=("${parents[@]:1}")
      while read -r child pgid; do
        [ -n "$child" ] || continue
        [ "$child" = "$wrapper" ] || parents+=("$child")
        [ "$pgid" != "$launcher_pgid" ] || continue
        group_start="$(tronclass_proc_starttime "$pgid" 2>/dev/null || true)"
        [ -n "$group_start" ] || continue
        child_record="$TRONCLASS_RUN_ID $pgid $group_start $pgid"
        for existing in "${records[@]}"; do
          [ "$existing" = "$child_record" ] && continue 2
        done
        proc_group_leader_matches "$pgid" "$group_start" "$pgid" "TRONCLASS_LAUNCHED_RUN=$TRONCLASS_RUN_ID" || continue
        records+=("$child_record")
        # The parent can escalate while this helper is still discovering groups.
        printf '%s %s\n' "${log##*/}" "$child_record" >&"$group_journal_fd"
      done < <(
        if [ "$walk_pid" = "$wrapper" ]; then
          ps -o pid=,pgid= -p "$wrapper" 2>/dev/null
        fi
        ps -o pid=,pgid= --ppid "$walk_pid" 2>/dev/null
      )
    done
  }
  # Give a late detached child time to appear before signalling the wrapper.
  # Cleanup may share one deadline across every group so they run in parallel.
  # Leave one second to TERM/KILL the wrapper; otherwise a stalled spawn can
  # spend the whole deadline waiting for a group that never appears.
  local spawn_deadline="${TRONCLASS_CLEANUP_DEADLINE:-$((EPOCHSECONDS + 6))}"
  # Wait long enough for a late detached spawn (the 3s delayed-spawn case)
  # while still leaving time to TERM, poll, and KILL before the shared deadline.
  local records_deadline=$((EPOCHSECONDS + 4))
  if [ "$records_deadline" -gt $((spawn_deadline - 1)) ]; then
    records_deadline=$((spawn_deadline - 1))
  fi
  tronclass_discover_groups
  if [ -z "$wrapper" ] && [ "${#records[@]}" -eq 0 ]; then return 0; fi
  while [ "${#records[@]}" -eq 0 ] && [ -n "$wrapper" ] &&
    [ "$EPOCHSECONDS" -lt "$records_deadline" ] && tronclass_record_matches "$wrapper" "$wrapper_start"; do
    sleep 0.1
    tronclass_discover_groups
  done
  tronclass_discover_groups
  local record failed=0
  for record in "${records[@]+"${records[@]}"}"; do
    tronclass_signal_record "$record" "$sig" || { [[ "$sig" != KILL ]] || failed=1; }
  done
  tronclass_signal_wrapper "$wrapper" "$wrapper_start" "$sig" || { [[ "$sig" != KILL ]] || failed=1; }
  local orphan_deadline=0 current_time
  while :; do
    tronclass_discover_groups
    local wrapper_alive=0 group_alive=0 leader_alive=0 run pid start group
    [ -n "$wrapper" ] && kill -0 "$wrapper" 2>/dev/null &&
      tronclass_record_matches "$wrapper" "$wrapper_start" && wrapper_alive=1
    for record in "${records[@]+"${records[@]}"}"; do
      if tronclass_group_alive_record "$record"; then
        group_alive=1
        read -r run pid start group <<< "$record"
        if proc_group_leader_matches "$pid" "$start" "$group" "TRONCLASS_LAUNCHED_RUN=$run"; then leader_alive=1; fi
      fi
    done
    if [ "$wrapper_alive" -eq 0 ] && [ "$group_alive" -eq 0 ]; then
      break
    fi
    [ "$EPOCHSECONDS" -lt "$spawn_deadline" ] || break
    # Preserve the short grace period for orphaned group descendants.
    if [ "$wrapper_alive" -eq 0 ] && [ "$leader_alive" -eq 0 ]; then
      current_time="${EPOCHREALTIME/./}"
      [ "$orphan_deadline" -ne 0 ] || orphan_deadline=$((current_time + 1900000))
      [ "$current_time" -lt "$orphan_deadline" ] || break
    fi
    sleep 0.1
  done
  tronclass_discover_groups
  for record in "${records[@]+"${records[@]}"}"; do
    tronclass_signal_record "$record" KILL || failed=1
  done
  if tronclass_signal_wrapper "$wrapper" "$wrapper_start" KILL; then
    [ -n "$wrapper" ] && wait "$wrapper" 2>/dev/null || true
  else
    failed=1
  fi
  return "$failed"
}

cleanup() {
  local exit_status=$? sig="${1:-}" failed=0
  # Keep the first signal's exit status and finish reaping detached groups.
  trap '' INT TERM
  trap - EXIT
  local child launch_signal=TERM pending_cleaned='' jobs=() job child_start
  tronclass_kill_discovered_groups() {
    local journal_log record
    local -A signalled=()
    while read -r journal_log record; do
      [[ -n "$record" && -z "${signalled[$record]:-}" ]] || continue
      signalled["$record"]=1
      tronclass_signal_record "$record" KILL || failed=1
    done < <(tronclass_read_group_journal)
  }
  TRONCLASS_CLEANUP_DEADLINE=$((EPOCHSECONDS + 6))
  local pid start entry
  local wrappers=(
    "$TRONCLASS_WEB_PID ${TRONCLASS_WEB_START:-}"
    "$TRONCLASS_EMULATOR_PID ${TRONCLASS_EMULATOR_START:-}"
    "$TRONCLASS_SELFTEST_WRAPPER ${TRONCLASS_SELFTEST_START:-}"
    "$TRONCLASS_SEED_PID ${TRONCLASS_SEED_START:-}"
    "$TRONCLASS_ACCEPTANCE_PID ${TRONCLASS_ACCEPTANCE_START:-}"
    "$TRONCLASS_HEALTH_PID ${TRONCLASS_HEALTH_START:-}"
  )
  if [ -n "${TRONCLASS_LAUNCHING_LOG:-}" ]; then
    [ "$TRONCLASS_LAUNCHING_LOG" != "$emulator_log" ] || launch_signal=INT
    # A trap can run between fork and start-time registration. Only an
    # immediate child of this launcher can be registered in that window.
    for child in $(exec pgrep -P "$$"); do
      for entry in "${wrappers[@]}"; do
        read -r pid start <<< "$entry"
        if [ "$child" = "$pid" ] && [ -n "$start" ]; then continue 2; fi
      done
      child_start="$(tronclass_proc_starttime "$child" 2>/dev/null)" || continue
      tronclass_stop_logged "$child" "$TRONCLASS_LAUNCHING_LOG" "$launch_signal" "$child_start" &
      jobs+=("$!")
      pending_cleaned="$TRONCLASS_LAUNCHING_LOG"
    done
  fi
  [ "$pending_cleaned" = "$web_log" ] || { tronclass_stop_logged "$TRONCLASS_WEB_PID" "$web_log" TERM "${TRONCLASS_WEB_START:-}" & jobs+=("$!"); }
  [ "$pending_cleaned" = "$emulator_log" ] || { tronclass_stop_logged "$TRONCLASS_EMULATOR_PID" "$emulator_log" INT "${TRONCLASS_EMULATOR_START:-}" & jobs+=("$!"); }
  [ "$pending_cleaned" = "$selftest_log" ] || { tronclass_stop_logged "$TRONCLASS_SELFTEST_WRAPPER" "$selftest_log" TERM "${TRONCLASS_SELFTEST_START:-}" & jobs+=("$!"); }
  [ "$pending_cleaned" = "$seed_log" ] || { tronclass_stop_logged "$TRONCLASS_SEED_PID" "$seed_log" TERM "${TRONCLASS_SEED_START:-}" & jobs+=("$!"); }
  [ "$pending_cleaned" = "$acceptance_log" ] || { tronclass_stop_logged "$TRONCLASS_ACCEPTANCE_PID" "$acceptance_log" TERM "${TRONCLASS_ACCEPTANCE_START:-}" & jobs+=("$!"); }
  [ "$pending_cleaned" = "$health_log" ] || { tronclass_stop_logged "$TRONCLASS_HEALTH_PID" "$health_log" TERM "${TRONCLASS_HEALTH_START:-}" & jobs+=("$!"); }
  local deadline_reached=0
  for job in "${jobs[@]}"; do
    while kill -0 "$job" 2>/dev/null; do
      if [ "$EPOCHSECONDS" -ge "$TRONCLASS_CLEANUP_DEADLINE" ]; then
        deadline_reached=1
        break 2
      fi
      sleep 0.05
    done
    wait "$job" || failed=1
  done
  if [ "$deadline_reached" -eq 1 ] || [ "$EPOCHSECONDS" -ge "$TRONCLASS_CLEANUP_DEADLINE" ]; then
    tronclass_kill_discovered_groups
    # Let helpers finish discovery, including groups found during escalation.
    for job in "${jobs[@]}"; do
      wait "$job" || failed=1
    done
  fi
  unset TRONCLASS_CLEANUP_DEADLINE
  for entry in "${wrappers[@]}"; do
    read -r pid start <<< "$entry"
    [ -n "$pid" ] || continue
    tronclass_signal_wrapper "$pid" "$start" KILL || { failed=1; continue; }
    # Reap here: stop_logged now runs in a subshell and cannot wait(2) these
    # children, so a just-killed wrapper would otherwise remain a zombie
    # visible to kill -0 after the launcher exits.
    wait "$pid" 2>/dev/null || true
  done
  # Catch a record written after the last discovery, including during escalation.
  tronclass_kill_discovered_groups
  if (( failed )); then
    echo 'TronClass launcher cleanup failed.' >&2
    exit_status=1
  fi
  if [ "$sig" = INT ]; then exit 130; fi
  if [ "$sig" = TERM ]; then exit 143; fi
  exit "$exit_status"
}
trap 'cleanup' EXIT
trap 'cleanup INT' INT
trap 'cleanup TERM' TERM

tronclass_read_regular_file() {
  local file="$1"
  node - "${file##*/}" 4<&"$runtime_fd" <<'NODE'
const fs = require('node:fs');
const directory = '/proc/self/fd/4';
const file = `${directory}/${process.argv[2]}`;
const uid = BigInt(process.getuid());
const isPrivateDir = info => info.isDirectory() && info.uid === uid && (info.mode & 0o777n) === 0o700n;
const isRecord = info => info.isFile() && info.nlink === 1n && info.uid === uid && (info.mode & 0o777n) === 0o600n;
const sameInode = (left, right) => left.dev === right.dev && left.ino === right.ino;
const sameRecord = (left, right) => isRecord(right) && sameInode(left, right) &&
  left.ctimeNs === right.ctimeNs && left.mtimeNs === right.mtimeNs;
const statOptions = { bigint: true };
let fd;
let before;
let parent;
try {
  parent = fs.statSync(directory, statOptions);
  before = fs.lstatSync(file, statOptions);
  if (!isPrivateDir(parent) || !isRecord(before)) process.exit(1);
  fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
} catch (error) {
  process.exit(1);
}
try {
  const info = fs.fstatSync(fd, statOptions);
  if (!sameRecord(before, info)) process.exit(1);
  const buf = Buffer.alloc(4096);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  const currentParent = fs.statSync(directory, statOptions);
  if (n === buf.length || !sameRecord(info, fs.lstatSync(file, statOptions)) ||
    !isPrivateDir(currentParent) || !sameInode(parent, currentParent)) process.exit(1);
  process.stdout.write(buf.subarray(0, n));
} catch (error) {
  process.exitCode = 1;
} finally {
  fs.closeSync(fd);
}
NODE
}

# A wrapper can be between open and rename. Keep regular temporary files
# while their writer PID exists, including when the PID may have been reused.
stale_tmp_pattern='^\.pgid-([1-9][0-9]*)-[[:xdigit:]]+\.tmp$'
for stale_tmp in "$runtime_anchor"/.pgid-*.tmp; do
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
for stale_sidecar in "$runtime_anchor"/*.log.pgid "$runtime_anchor"/*.log.pgid.* "$runtime_anchor"/*.log.*.pgid.*; do
  if [ -L "$stale_sidecar" ] || [ ! -f "$stale_sidecar" ]; then
    rm -f -- "$stale_sidecar" 2>/dev/null || true
    continue
  fi
  if ! stale_record="$(tronclass_read_record_file "$stale_sidecar" '' 2>/dev/null)"; then
    rm -f -- "$stale_sidecar" 2>/dev/null || true
    continue
  fi
  read -r stale_run stale_pid stale_start stale_group <<< "$stale_record"
  # Legacy names have no run-id suffix (web.log.pgid). Always delete those
  # leftovers, even if the recorded group is still alive, and never signal it.
  if [[ "$stale_sidecar" == *.log.pgid ]]; then
    rm -f -- "$stale_sidecar" 2>/dev/null || true
    continue
  fi
  if [ "$stale_run" = "$TRONCLASS_RUN_ID" ] ||
    proc_signal_marked_group "$stale_pid" "$stale_start" "$stale_group" "TRONCLASS_LAUNCHED_RUN=$stale_run"; then
    continue
  fi
  rm -f -- "$stale_sidecar" 2>/dev/null || true
done

tronclass_run_logged() {
  local log="$1"
  shift
  # Backgrounded calls exec so $! is this Node wrapper, not a Bash function
  # subshell that can ignore INT and leave the child holding the port.
  local -a command=(node)
  if [ "${TRONCLASS_RUN_LOGGED_EXEC:-}" = '1' ]; then command=(exec node); fi
  "${command[@]}" - "$log" "$TRONCLASS_PROJECT_ROOT/scripts/process-identity.sh" "$@" 3>&"$group_journal_fd" 4<&"$runtime_fd" <<'NODE'
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const logName = path.basename(process.argv[2]);
const logPath = `/proc/self/fd/4/${logName}`;
const identityHelper = process.argv[3];
const argv = process.argv.slice(4);
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
const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
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
let childIdentity;
let pendingSignal = null;
const stop = (signal) => {
  if (!child) { pendingSignal = signal; return; }
  const result = childIdentity && spawnSync('bash', ['-c', 'source "$1" && shift && proc_signal_marked_group "$@"',
    'signal-process-group', identityHelper, String(child.pid), childIdentity.start, childIdentity.group,
    `TRONCLASS_LAUNCHED_RUN=${runId}`, signal.slice(3)], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (result?.status !== 0) {
    process.stderr.write('Unable to forward the signal to the verified child process group.\n');
    // Let the launcher's cleanup retry using its verified group record.
    process.exit(1);
  }
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
const delayMs = Number(process.env.TRONCLASS_TEST_DELAY_SPAWN_MS || 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}
const runId = process.env.TRONCLASS_RUN_ID || '';
const stdio = ['inherit', fd, fd, 'ignore', 'pipe'];
const env = { ...process.env, TRONCLASS_LAUNCHED_RUN: runId };
if (process.env.TRONCLASS_WRITE_RUNTIME_REPORT === '1') {
  // The wrapper has the directory on fd 4. Pass it as fd 3 to the report process.
  stdio[3] = 4;
  env.TRONCLASS_REPORT_DIR_FD = '3';
}
// The detached bootstrap is the session leader and waits on a private pipe.
// exec keeps its PID/start time. EOF without a release leaves no workload
// behind if the wrapper dies before appending the journal record.
child = spawn('python3', ['-I', '-c', `
import os
import signal
import sys

if os.read(4, 1) != b"1":
    sys.exit(1)
os.close(4)
# Restore the dispositions Python changes before exec.
for name in ("SIGPIPE", "SIGXFZ", "SIGXFSZ"):
    if hasattr(signal, name):
        signal.signal(getattr(signal, name), signal.SIG_DFL)
os.execvp(sys.argv[1], sys.argv[1:])
`, ...argv], { stdio, detached: true, env });
fs.closeSync(fd);
child.on('error', () => process.exit(1));
const gate = child.stdio[4];
gate.on('error', () => process.exit(1));
const crypto = require('node:crypto');
function readIdentity(pid) {
  const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const rest = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/);
  return { group: rest[2], start: rest[19] };
}
const pgidPath = `${logPath}.pgid.${runId}`;
try {
  const identity = readIdentity(child.pid);
  const startTime = identity.start;
  if (!/^\d+$/.test(startTime) || identity.group !== String(child.pid)) throw new Error('group identity');
  if (!/^[0-9a-fA-F]{32}$/.test(runId)) throw new Error('run-id');
  const record = `${runId} ${child.pid} ${startTime} ${identity.group}\n`;
  // One append writes the full record before attempting filesystem publication.
  const journalEntry = `${logName} ${record}`;
  if (fs.writeSync(3, journalEntry) !== Buffer.byteLength(journalEntry)) throw new Error('journal append');
  childIdentity = identity;
  gate.end('1');
  const tmpPath = path.join(path.dirname(pgidPath), `.pgid-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
  const tmpFd = fs.openSync(tmpPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const tmpStat = fs.fstatSync(tmpFd);
    if (!tmpStat.isFile() || tmpStat.nlink !== 1 || tmpStat.uid !== process.getuid()) throw new Error('tmp');
    fs.writeSync(tmpFd, record);
    fs.fsyncSync(tmpFd);
    // Publish without replacing an existing record, including symlinks.
    const namedTmp = fs.lstatSync(tmpPath);
    if (namedTmp.dev !== tmpStat.dev || namedTmp.ino !== tmpStat.ino) throw new Error('replaced tmp');
    // Linux renameat2 makes the completed record visible with one link.
    const publication = spawnSync('python3', ['-I', '-c', `
import ctypes
import os
import sys

rename = ctypes.CDLL(None, use_errno=True).renameat2
rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
runtime_fd = 4
RENAME_NOREPLACE = 1
if rename(runtime_fd, os.fsencode(sys.argv[1]), runtime_fd, os.fsencode(sys.argv[2]), RENAME_NOREPLACE):
    sys.exit(1)
`, path.basename(tmpPath), path.basename(pgidPath)], { stdio: ['ignore', 'ignore', 'ignore', 'ignore', 4] });
    if (publication.status !== 0) throw new Error('record publication');
  } finally {
    fs.closeSync(tmpFd);
    fs.rmSync(tmpPath, { force: true });
  }
} catch (error) {
  if (!childIdentity) gate.destroy();
  process.stderr.write('Unable to record the logged child process group.\n');
}
if (pendingSignal) stop(pendingSignal);
child.on('exit', (code, signal) => {
  if (signal) {
    const signalNumber = require('node:os').constants.signals[signal];
    process.exit(signalNumber ? 128 + signalNumber : 1);
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
  TRONCLASS_SELFTEST_START="$(tronclass_proc_starttime "$TRONCLASS_SELFTEST_WRAPPER" 2>/dev/null || true)"
  unset TRONCLASS_LAUNCHING_LOG
  echo "WRAPPER_PID=$TRONCLASS_SELFTEST_WRAPPER"
  unset TRONCLASS_RUN_LOGGED_EXEC
  if [ -n "${TRONCLASS_TEST_PAUSE_BEFORE_CAPTURE:-}" ]; then
    sleep "$TRONCLASS_TEST_PAUSE_BEFORE_CAPTURE"
  fi
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
TRONCLASS_EMULATOR_START="$(tronclass_proc_starttime "$TRONCLASS_EMULATOR_PID" 2>/dev/null || true)"
unset TRONCLASS_LAUNCHING_LOG
unset TRONCLASS_RUN_LOGGED_EXEC
TRONCLASS_EMULATOR_READY=false
for _ in $(seq 1 90); do
  if ! kill -0 "$TRONCLASS_EMULATOR_PID" 2>/dev/null; then
    echo "Emulator startup failed; inspect $TRONCLASS_RUNTIME_DIR/${emulator_log##*/}" >&2
    exit 1
  fi
  if python3 -I -c '
import os
import stat
import sys

try:
    fd = os.open(sys.argv[1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=4)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
        sys.exit(1)
    if fd != 0:
        os.dup2(fd, 0)
        os.close(fd)
    else:
        os.set_inheritable(fd, True)
    os.execvp("grep", ["grep", "-q", "All emulators ready"])
except OSError:
    sys.exit(1)
' "${emulator_log##*/}" 4<&"$runtime_fd"; then
    TRONCLASS_EMULATOR_READY=true
    break
  fi
  sleep 1
done
if [ "$TRONCLASS_EMULATOR_READY" != true ]; then
  echo "Emulator startup timed out; inspect $TRONCLASS_RUNTIME_DIR/${emulator_log##*/}" >&2
  exit 1
fi

TRONCLASS_LAUNCHING_LOG="$seed_log"
TRONCLASS_RUN_LOGGED_EXEC=1 tronclass_run_logged "$seed_log" node scripts/test-env/seed.cjs --missing-only &
TRONCLASS_SEED_PID=$!
TRONCLASS_SEED_START="$(tronclass_proc_starttime "$TRONCLASS_SEED_PID" 2>/dev/null || true)"
unset TRONCLASS_LAUNCHING_LOG
unset TRONCLASS_RUN_LOGGED_EXEC
wait "$TRONCLASS_SEED_PID"
TRONCLASS_SEED_PID=''
unset TRONCLASS_SEED_START
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
TRONCLASS_WEB_START="$(tronclass_proc_starttime "$TRONCLASS_WEB_PID" 2>/dev/null || true)"
unset TRONCLASS_LAUNCHING_LOG
unset TRONCLASS_RUN_LOGGED_EXEC
if [ "${TRONCLASS_VERIFY_RUNTIME:-}" = '1' ] && [ "$TRONCLASS_INTEGRATION_ENABLED" = true ]; then
  cd "$TRONCLASS_PROJECT_ROOT"
  TRONCLASS_LAUNCHING_LOG="$acceptance_log"
  TRONCLASS_WRITE_RUNTIME_REPORT=1 TRONCLASS_RUN_LOGGED_EXEC=1 tronclass_run_logged "$acceptance_log" node scripts/test-env/verify-tronclass.cjs &
  TRONCLASS_ACCEPTANCE_PID=$!
  TRONCLASS_ACCEPTANCE_START="$(tronclass_proc_starttime "$TRONCLASS_ACCEPTANCE_PID" 2>/dev/null || true)"
  unset TRONCLASS_LAUNCHING_LOG
  unset TRONCLASS_RUN_LOGGED_EXEC
  wait "$TRONCLASS_ACCEPTANCE_PID"
  TRONCLASS_ACCEPTANCE_PID=''
  unset TRONCLASS_ACCEPTANCE_START
  unset TRONCLASS_ACCEPTANCE_RECORD
  echo "Verified real emulator authentication and Firestore persistence; see $TRONCLASS_RUNTIME_DIR/acceptance.json."
fi
if [ "${TRONCLASS_CHECK_HEALTH:-}" = '1' ]; then
  cd "$TRONCLASS_PROJECT_ROOT"
  TRONCLASS_LAUNCHING_LOG="$health_log"
  TRONCLASS_WRITE_RUNTIME_REPORT=1 TRONCLASS_RUN_LOGGED_EXEC=1 tronclass_run_logged "$health_log" node scripts/test-env/health-tronclass.cjs &
  TRONCLASS_HEALTH_PID=$!
  TRONCLASS_HEALTH_START="$(tronclass_proc_starttime "$TRONCLASS_HEALTH_PID" 2>/dev/null || true)"
  unset TRONCLASS_LAUNCHING_LOG
  unset TRONCLASS_RUN_LOGGED_EXEC
  wait "$TRONCLASS_HEALTH_PID"
  TRONCLASS_HEALTH_PID=''
  unset TRONCLASS_HEALTH_START
  unset TRONCLASS_HEALTH_RECORD
  echo "Verified read-only health and login page requests; see $TRONCLASS_RUNTIME_DIR/health.json."
fi
wait "$TRONCLASS_WEB_PID"
}

main "$@"
