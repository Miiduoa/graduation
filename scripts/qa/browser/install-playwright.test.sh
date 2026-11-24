#!/usr/bin/env bash
# No packages/network required: exercise the installer, including a real timeout.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mock_dir="$(mktemp -d)"
cleanup() {
  # The no-cleanup regression check below leaves a test-only child.
  # Kill only PIDs recorded by our own lock fixtures before removing their files.
  local pid_file
  for pid_file in "$mock_dir/"*.child-pid; do
    [[ -f "$pid_file" ]] || continue
    kill -KILL "$(cat "$pid_file")" 2>/dev/null || true
  done
  rm -rf "$mock_dir"
}
trap cleanup EXIT
mkdir -p "$mock_dir/bin"
export REAL_TIMEOUT="$(command -v timeout)"

cat > "$mock_dir/bin/python" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'python:%s\n' "$*" >> "$MOCK_LOG"
if [[ "$*" == '-m playwright install-deps chromium' ]]; then
  [[ "${MOCK_ROOT:-0}" == 1 ]]
  if [[ "${MOCK_SLOW_DEPS:-0}" == 1 ]]; then /bin/sleep 3.5; fi
  count="$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG" || true)"
  if [[ "${MOCK_PROCESS_TEST:-0}" == 1 ]]; then
    if (( count == 1 )); then
      # Simulate apt retaining its lock and ignoring TERM in sudo's session.
      exec flock --no-fork -n "$MOCK_LOCK" bash -c '
        # Keep the child in this process group even when SHELLOPTS inherits
        # job control. The fixture models the sudo session boundary only.
        set +m
        trap "" TERM
        touch "$MOCK_LOCK.interrupted"
        echo locked >> "$MOCK_LOG"
        /bin/sleep 30 &
        echo "$!" > "$MOCK_LOCK.child-pid"
        wait "$!"
      '
    fi
    flock -n "$MOCK_LOCK" true
    [[ ! -e "$MOCK_LOCK.interrupted" ]]
    echo recovered >> "$MOCK_LOG"
  fi
  (( count > MOCK_DEPS_FAILS ))
  exit
fi
[[ "$*" == '-m playwright install chromium' && "${MOCK_ROOT:-0}" == 0 ]]
count="$(grep -c '^python:-m playwright install chromium$' "$MOCK_LOG" || true)"
(( count > MOCK_PYTHON_FAILS ))
MOCK
cat > "$mock_dir/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == timeout || "$1" == kill ]]
export MOCK_ROOT=1
printf 'sudo:%s\n' "$*" >> "$MOCK_LOG"
if [[ "$1" == kill ]]; then
  # Only the installer's own survivor cleanup may signal a process group.
  [[ "$2" == -KILL && "$3" == -- && "$4" =~ ^-[1-9][0-9]*$ && $# == 4 ]]
  exec "$@"
fi
# Model sudo's session boundary without requiring root or touching system apt.
if [[ "${MOCK_PROCESS_TEST:-0}" == 1 ]]; then
  exec setsid --wait "$@"
fi
"$@"
MOCK
cat > "$mock_dir/bin/apt-get" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "${MOCK_ROOT:-0}" == 1 && "$*" == *'install -y fonts-noto-cjk' ]]
printf 'apt:%s\n' "$*" >> "$MOCK_LOG"
count="$(grep -c '^apt:' "$MOCK_LOG" || true)"
if [[ "${MOCK_SLOW_FONT:-0}" == 1 ]]; then
  /bin/sleep 1.5
fi
(( count > MOCK_APT_FAILS ))
MOCK
cat > "$mock_dir/bin/apt-cache" <<'MOCK'
#!/usr/bin/env bash
[[ "$*" == '--no-all-versions show fonts-noto-cjk' ]] || exit 1
printf 'Package: fonts-noto-cjk\nSHA256: %s\n' "${MOCK_APT_SHA:-other-candidate}"
MOCK
cat > "$mock_dir/bin/dpkg-query" <<'MOCK'
#!/usr/bin/env bash
[[ "${MOCK_NOBLE_INSTALLED:-0}" == 1 ]] || exit 1
printf 'install ok installed 1:20230817+repack1-3'
MOCK
cat > "$mock_dir/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -eu
[[ "${MOCK_ROOT:-0}" == 0 && "$*" == '--fail --silent --show-error --proto =https --connect-timeout 8 --max-time 75 --output '* ]]
[[ "${!#}" == 'https://archive.ubuntu.com/ubuntu/pool/main/f/fonts-noto-cjk/fonts-noto-cjk_20230817+repack1-3_all.deb' ]]
printf 'prefetch\n' >> "$MOCK_LOG"
case "${MOCK_ARCHIVE:-offline}" in
  ok) printf 'Noble font fixture' > "${@: -2:1}" ;;
  corrupt) printf 'corrupt' > "${@: -2:1}" ;;
  offline) exit 22 ;;
esac
MOCK
cat > "$mock_dir/bin/dpkg" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == --install ]]; then
  [[ "${MOCK_ROOT:-0}" == 1 && "$#" == 2 && "$2" == */fonts-noto-cjk.deb ]]
  [[ "$(cat "$2")" == 'Noble font fixture' ]]
  printf 'dpkg:%s\n' "$*" >> "$MOCK_LOG"
  exit "${MOCK_LOCAL_DPKG_FAIL:-0}"
fi
[[ "$*" == '--configure -a' && "${MOCK_ROOT:-0}" == 1 ]]
printf 'dpkg:%s\n' "$*" >> "$MOCK_LOG"
if [[ "${MOCK_REPAIR_FAIL:-0}" == 1 ]]; then exit 1; fi
if [[ "${MOCK_DPKG_HANG:-0}" == 1 ]]; then
  count="$(grep -c '^dpkg:--configure -a$' "$MOCK_LOG" || true)"
  if (( count == 1 )); then
    # Simulate a recovery command whose helper keeps the lock and ignores TERM.
    exec flock --no-fork -n "$MOCK_LOCK" bash -c '
      trap "" TERM
      touch "$MOCK_LOCK.interrupted"
      echo dpkg-hung >> "$MOCK_LOG"
      /bin/sleep 30 &
      echo "$!" > "$MOCK_LOCK.child-pid"
      wait "$!"
    '
  fi
fi
if [[ "${MOCK_DELAY_LOCK_RELEASE:-0}" == 1 ]]; then
  count="$(grep -c '^dpkg:--configure -a$' "$MOCK_LOG" || true)"
  if (( count == 1 )); then
    # Deterministically retain a real lock beyond the first recovery attempt.
    # The next bounded backoff lets it release; no success is fabricated.
    flock --no-fork -n "$MOCK_LOCK" bash -c '
      touch "$MOCK_LOCK.release-pending"
      while [[ ! -e "$MOCK_LOCK.release-request" ]]; do /bin/sleep 0.01; done
      /bin/sleep 0.2
    ' &
    echo "$!" > "$MOCK_LOCK.child-pid"
    "$REAL_TIMEOUT" --kill-after=0.2s 5s bash -c '
      while [[ ! -e "$MOCK_LOCK.release-pending" ]]; do /bin/sleep 0.01; done
    '
    if flock -n "$MOCK_LOCK" true; then
      echo 'Delayed release fixture did not retain its lock' >&2
      exit 2
    fi
    touch "$MOCK_LOCK.release-request"
    exit 1
  fi
fi
if [[ "${MOCK_PROCESS_TEST:-0}" == 1 || "${MOCK_DELAY_LOCK_RELEASE:-0}" == 1 ]]; then
  flock -n "$MOCK_LOCK" true
  rm -f "$MOCK_LOCK.interrupted"
fi
MOCK
cat > "$mock_dir/bin/sleep" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'sleep:%s\n' "$*" >> "$MOCK_LOG"
if [[ "$1" == 1 || "$1" == 2 ]]; then
  if [[ "${MOCK_PROCESS_TEST:-0}" == 1 || "${MOCK_DELAY_LOCK_RELEASE:-0}" == 1 ]]; then
    /bin/sleep "$1"
  fi
fi
MOCK
cat > "$mock_dir/bin/timeout" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == '--kill-after=5s' ]]
shift
limit="$1"; shift
printf 'timeout:%s\n' "$limit" >> "$MOCK_LOG"
printf 'timeout-command:%s:%s\n' "$limit" "$*" >> "$MOCK_LOG"
# Privileged attempts run through the installer's process-group recorder.
inner="$1"
if [[ "$1" == bash && "${4:-}" == record-process-group ]]; then inner="${6:-}"; fi
if [[ ( "${MOCK_SLOW_FONT:-0}" == 1 && "$inner" == apt-get ) ||
      ( "${MOCK_SLOW_DEPS:-0}" == 1 && "$inner" == */python ) ]]; then
  # Scale one minute to one second for a slow font download or dependency unpack.
  exec "$REAL_TIMEOUT" --kill-after=0.2s "$((${limit%s} / 60))s" "$@"
fi
if [[ "${MOCK_PROCESS_TEST:-0}" == 1 ]]; then
  if [[ "${MOCK_CHILD_ONLY_TIMEOUT:-0}" == 1 ]]; then
    # Model timeout implementations that signal only their direct child (such
    # as uutils' final SIGKILL), independent of the host's own timeout.
    exec "$REAL_TIMEOUT" --foreground --kill-after=0.2s 1s "$@"
  fi
  exec "$REAL_TIMEOUT" --kill-after=0.2s 1s "$@"
fi
if [[ "$inner" == dpkg ]]; then exec "$@"; fi
echo install-attempt >> "$MOCK_LOG"
count="$(grep -c '^install-attempt$' "$MOCK_LOG" || true)"
if (( count <= ${MOCK_TIMEOUT_FAILS:-0} )); then exit 124; fi
"$@"
MOCK
chmod +x "$mock_dir/bin/"*
export PATH="$mock_dir/bin:$PATH" MOCK_LOG="$mock_dir/install.log"

assert_recovery_deadlines() {
  local expected="$1" line deadline
  local pattern='^sudo:timeout --kill-after=5s ([0-9]+)s bash -c .* record-process-group [^ ]*/process-group dpkg --configure -a$'
  local -a commands=()
  mapfile -t commands < <(grep '^sudo:.* dpkg --configure -a$' "$MOCK_LOG")
  (( ${#commands[@]} == expected ))
  for line in "${commands[@]}"; do
    [[ "$line" =~ $pattern ]]
    deadline="${BASH_REMATCH[1]}"
    (( deadline > 0 && deadline <= 180 ))
  done
}

# Transient browser, dependency and font failures all recover.
export MOCK_PYTHON_FAILS=1 MOCK_APT_FAILS=1 MOCK_DEPS_FAILS=1
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1
[[ "$(grep -c '^python:-m playwright install chromium$' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^apt:' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^timeout:' "$MOCK_LOG")" -eq 8 ]]
[[ "$(grep -c '^timeout-command:180s:python -m playwright install chromium$' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^dpkg:--configure -a$' "$MOCK_LOG")" -eq 2 ]]
assert_recovery_deadlines 2
# Both privileged commands must place timeout inside sudo, preserving Python's path.
[[ "$(grep -c "^sudo:timeout --kill-after=5s 360s bash -c .* record-process-group [^ ]*/process-group $mock_dir/bin/python -m playwright install-deps chromium\$" "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^sudo:timeout --kill-after=5s 180s bash -c .* record-process-group [^ ]*/process-group apt-get ' "$MOCK_LOG")" -eq 2 ]]
# Ordinary failures never signal any process group.
[[ "$(grep -c '^sudo:kill' "$MOCK_LOG" || true)" -eq 0 ]]

# Both first and second attempts may time out; the third success is still valid.
export MOCK_PYTHON_FAILS=0 MOCK_APT_FAILS=0 MOCK_DEPS_FAILS=0 MOCK_TIMEOUT_FAILS=2
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1
[[ "$(grep -c '^timeout:' "$MOCK_LOG")" -eq 7 ]]
assert_recovery_deadlines 2
[[ "$(grep -c '^python:' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG")" -eq 2 ]]
export MOCK_TIMEOUT_FAILS=0

# A persistent failure stays a red CI job: never quietly skip browser QA.
export MOCK_PYTHON_FAILS=3
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" >/dev/null 2>&1; then
  echo 'Persistent Chromium installation failure was silently accepted' >&2
  exit 1
fi
[[ "$(grep -c '^python:' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^sudo:' "$MOCK_LOG" || true)" -eq 0 ]]
[[ "$(grep -c 'install-deps' "$MOCK_LOG" || true)" -eq 0 ]]

# Campus continues to the browser check after all system dependency attempts fail.
export MOCK_PYTHON_FAILS=0 MOCK_DEPS_FAILS=3
: > "$MOCK_LOG"
(
  set -e
  bash "$script_dir/install-playwright.sh"
  echo 'browser-check' >> "$MOCK_LOG"
) > "$mock_dir/campus-output.log" 2>&1
grep -q '^python:-m playwright install chromium$' "$MOCK_LOG"
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^timeout:90s$' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG")" -eq 2 ]]
grep -q '^browser-check$' "$MOCK_LOG"
grep -q 'continuing with actual browser checks' "$mock_dir/campus-output.log"

# Admin requires system dependencies before downloading Chromium or fonts.
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1; then
  echo 'Persistent Admin dependency failure was silently accepted' >&2
  exit 1
fi
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^python:-m playwright install chromium$' "$MOCK_LOG" || true)" -eq 0 ]]
[[ "$(grep -c '^apt:' "$MOCK_LOG" || true)" -eq 0 ]]

# Admin must also fail if Chromium cannot be downloaded after dependencies pass.
export MOCK_DEPS_FAILS=0 MOCK_PYTHON_FAILS=3
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1; then
  echo 'Persistent Admin Chromium failure was silently accepted' >&2
  exit 1
fi
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 1 ]]
[[ "$(grep -c '^python:-m playwright install chromium$' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^apt:' "$MOCK_LOG" || true)" -eq 0 ]]

# Fonts are also required for visual QA. Do not let three apt failures pass.
export MOCK_PYTHON_FAILS=0 MOCK_APT_FAILS=3
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1; then
  echo 'Persistent font installation failure was silently accepted' >&2
  exit 1
fi
[[ "$(grep -c '^python:' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^apt:' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^timeout:' "$MOCK_LOG")" -eq 7 ]]
assert_recovery_deadlines 2

# A slow, successful font transfer must finish instead of restarting three times.
export MOCK_APT_FAILS=0 MOCK_SLOW_FONT=1
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1
[[ "$(grep -c '^apt:' "$MOCK_LOG")" -eq 1 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG" || true)" -eq 0 ]]
export MOCK_SLOW_FONT=0
: > "$MOCK_LOG"
MOCK_SLOW_DEPS=1 bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 1 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG" || true)" -eq 0 ]]

# Exercise the real SHA-256 check on a small local fixture. Ordinary scenarios
# above simulate a different candidate without using network or APT metadata.
official_sha=7d64b985f6fe128c99eae5610d5c047338e572bdcfb2bb09736be01b824a7f6c
fixture_sha="$(printf 'Noble font fixture' | sha256sum | cut -d' ' -f1)"
sed "s/$official_sha/$fixture_sha/" "$script_dir/install-playwright.sh" > "$mock_dir/fixture-install.sh"
export MOCK_APT_SHA="$fixture_sha"
for mode in ok corrupt offline; do
  export MOCK_ARCHIVE="$mode"
  : > "$MOCK_LOG"
  bash "$mock_dir/fixture-install.sh" --fonts-noto-cjk >/dev/null 2>&1
  [[ "$(grep -c '^prefetch$' "$MOCK_LOG")" -eq 1 ]]
  if [[ "$mode" == ok ]]; then
    grep -q '^dpkg:--install /.*/fonts-noto-cjk.deb$' "$MOCK_LOG"
    [[ "$(grep -c '^apt:' "$MOCK_LOG" || true)" -eq 0 ]]
  else
    grep -q '^apt:.*install -y fonts-noto-cjk$' "$MOCK_LOG"
    [[ "$(grep -c '^dpkg:--install' "$MOCK_LOG" || true)" -eq 0 ]]
  fi
done
: > "$MOCK_LOG"
MOCK_NOBLE_INSTALLED=1 bash "$mock_dir/fixture-install.sh" --fonts-noto-cjk >/dev/null 2>&1
[[ "$(grep -c '^prefetch$' "$MOCK_LOG" || true)" -eq 0 ]]
grep -q '^apt:.*install -y fonts-noto-cjk$' "$MOCK_LOG"
: > "$MOCK_LOG"
if MOCK_ARCHIVE=ok MOCK_LOCAL_DPKG_FAIL=1 bash "$mock_dir/fixture-install.sh" --fonts-noto-cjk >/dev/null 2>&1; then
  echo 'A persistent verified-package installation failure was silently accepted' >&2
  exit 1
fi
[[ "$(grep -c '^dpkg:--install' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^apt:' "$MOCK_LOG" || true)" -eq 0 ]]
unset MOCK_APT_SHA MOCK_ARCHIVE

# Bad parameters fail before any installation attempt.
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --unsupported >/dev/null 2>&1; then
  echo 'Unsupported argument did not fail' >&2
  exit 1
fi
[[ ! -s "$MOCK_LOG" ]]

# A real timeout must kill the lock holder across the simulated sudo session,
# then repair interrupted dpkg state before the next apt attempt can succeed.
# Run with the host's timeout and with a modelled child-only timeout, so the
# result does not depend on which timeout implementation the runner ships.
for child_only in 0 1; do
export MOCK_APT_FAILS=0 MOCK_PROCESS_TEST=1 MOCK_CHILD_ONLY_TIMEOUT="$child_only" MOCK_LOCK="$mock_dir/apt-$child_only.lock"
: > "$MOCK_LOG"
if ! bash "$script_dir/install-playwright.sh" --fonts-noto-cjk > "$mock_dir/process-output.log" 2>&1; then
  cat "$mock_dir/process-output.log" "$MOCK_LOG" >&2
  exit 1
fi
grep -q '^locked$' "$MOCK_LOG"
grep -q '^recovered$' "$MOCK_LOG"
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 2 ]]
recovery_attempts="$(grep -c '^dpkg:--configure -a$' "$MOCK_LOG")"
(( recovery_attempts >= 1 && recovery_attempts <= 3 ))
assert_recovery_deadlines "$recovery_attempts"
[[ ! -e "$MOCK_LOCK.interrupted" ]]
flock -n "$MOCK_LOCK" true
[[ "$(grep -c '^sudo:kill -KILL -- -[1-9][0-9]*$' "$MOCK_LOG")" -eq 1 ]]
done
export MOCK_CHILD_ONLY_TIMEOUT=0

# The dpkg recovery command is bounded like an install attempt: when its own
# timeout only kills the direct child, the installer must remove the lock-holding
# survivors in the recovery's process group before the next recovery attempt.
export MOCK_PROCESS_TEST=1 MOCK_CHILD_ONLY_TIMEOUT=1 MOCK_DPKG_HANG=1 MOCK_APT_FAILS=0 MOCK_LOCK="$mock_dir/dpkg-hang.lock"
: > "$MOCK_LOG"
if ! bash "$script_dir/install-playwright.sh" --fonts-noto-cjk > "$mock_dir/dpkg-hang-output.log" 2>&1; then
  cat "$mock_dir/dpkg-hang-output.log" "$MOCK_LOG" >&2
  exit 1
fi
grep -q '^dpkg-hung$' "$MOCK_LOG"
[[ "$(grep -c '^dpkg:--configure -a$' "$MOCK_LOG")" -eq 2 ]]
assert_recovery_deadlines 2
# One cleanup for the timed-out install attempt and one for the timed-out recovery.
[[ "$(grep -c '^sudo:kill -KILL -- -[1-9][0-9]*$' "$MOCK_LOG")" -eq 2 ]]
flock -n "$MOCK_LOCK" true

# Without the recovery cleanup, the surviving dpkg helper keeps the lock and
# recovery stays failed after every bounded retry.
export MOCK_LOCK="$mock_dir/dpkg-hang-no-cleanup.lock"
grep -q '^          kill_timed_out_group "${elevation\[@\]}"$' "$script_dir/install-playwright.sh"
sed 's/^          kill_timed_out_group "${elevation\[@\]}"$/          :/' \
  "$script_dir/install-playwright.sh" > "$mock_dir/no-recovery-cleanup.sh"
: > "$MOCK_LOG"
if bash "$mock_dir/no-recovery-cleanup.sh" --fonts-noto-cjk > "$mock_dir/no-recovery-cleanup-output.log" 2>&1; then
  echo 'A timed-out dpkg recovery without survivor cleanup incorrectly passed' >&2
  exit 1
fi
grep -q 'could not recover interrupted package configuration' "$mock_dir/no-recovery-cleanup-output.log"
if flock -n "$MOCK_LOCK" true; then
  echo 'dpkg recovery cleanup test did not retain its child-held lock' >&2
  exit 1
fi
kill -KILL "$(cat "$MOCK_LOCK.child-pid")" 2>/dev/null || true
rm -f "$MOCK_LOCK.child-pid"
export MOCK_PROCESS_TEST=0 MOCK_CHILD_ONLY_TIMEOUT=0 MOCK_DPKG_HANG=0

# Inherited Bash job control must not move the fixture child to an unrelated
# process group. The same actual timeout still has to release the real lock.
export MOCK_PROCESS_TEST=1 MOCK_LOCK="$mock_dir/monitor.lock"
: > "$MOCK_LOG"
if ! bash -c 'set -m; export SHELLOPTS; bash "$1" --fonts-noto-cjk' _ \
  "$script_dir/install-playwright.sh" > "$mock_dir/monitor-output.log" 2>&1; then
  cat "$mock_dir/monitor-output.log" "$MOCK_LOG" >&2
  exit 1
fi
grep -q '^locked$' "$MOCK_LOG"
grep -q '^recovered$' "$MOCK_LOG"
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 2 ]]
[[ ! -e "$MOCK_LOCK.interrupted" ]]
flock -n "$MOCK_LOCK" true

# A delayed lock release after timeout gets a bounded retry, not an apt retry
# while the database is still locked. Keep actual lock acquisition in dpkg.
export MOCK_PROCESS_TEST=0 MOCK_TIMEOUT_FAILS=1 MOCK_DELAY_LOCK_RELEASE=1 MOCK_LOCK="$mock_dir/delayed.lock"
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk > "$mock_dir/delayed-output.log" 2>&1
[[ "$(grep -c '^dpkg:--configure -a$' "$MOCK_LOG")" -eq 2 ]]
assert_recovery_deadlines 2
mapfile -t repair_limits < <(sed -n 's/^sudo:timeout --kill-after=5s \([0-9]*\)s bash -c .* record-process-group [^ ]*\/process-group dpkg --configure -a$/\1/p' "$MOCK_LOG")
(( repair_limits[1] < repair_limits[0] ))
[[ "$(grep -c '^sleep:1$' "$MOCK_LOG")" -eq 1 ]]
flock -n "$MOCK_LOCK" true
export MOCK_DELAY_LOCK_RELEASE=0 MOCK_TIMEOUT_FAILS=0

# Without the installer's own survivor cleanup, a child-only timeout leaves the
# TERM-ignoring lock holder alive. Recovery must then stay failed after all
# short retries, never proceeding to apt/browser.
export MOCK_PROCESS_TEST=1 MOCK_CHILD_ONLY_TIMEOUT=1 MOCK_LOCK="$mock_dir/no-cleanup.lock"
grep -q '^      kill_timed_out_group "${elevation\[@\]}"$' "$script_dir/install-playwright.sh"
sed 's/^      kill_timed_out_group "${elevation\[@\]}"$/      :/' \
  "$script_dir/install-playwright.sh" > "$mock_dir/no-cleanup.sh"
: > "$MOCK_LOG"
if bash "$mock_dir/no-cleanup.sh" --fonts-noto-cjk > "$mock_dir/no-cleanup-output.log" 2>&1; then
  echo 'Child-only timeout without survivor cleanup incorrectly passed live lock recovery' >&2
  exit 1
fi
grep -q '^locked$' "$MOCK_LOG"
[[ "$(grep -c '^dpkg:--configure -a$' "$MOCK_LOG")" -eq 3 ]]
assert_recovery_deadlines 3
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 1 ]]
[[ "$(grep -c '^python:-m playwright install chromium$' "$MOCK_LOG" || true)" -eq 0 ]]
[[ "$(grep -c '^apt:' "$MOCK_LOG" || true)" -eq 0 ]]
grep -q 'could not recover interrupted package configuration' "$mock_dir/no-cleanup-output.log"
if flock -n "$MOCK_LOCK" true; then
  echo 'No-cleanup test did not retain its child-held lock' >&2
  exit 1
fi
kill -KILL "$(cat "$MOCK_LOCK.child-pid")" 2>/dev/null || true
rm -f "$MOCK_LOCK.child-pid"
export MOCK_CHILD_ONLY_TIMEOUT=0

# Failed recovery must stop before retrying apt or running browser checks.
export MOCK_PROCESS_TEST=0 MOCK_DEPS_FAILS=1 MOCK_REPAIR_FAIL=1
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --fonts-noto-cjk > "$mock_dir/repair-output.log" 2>&1; then
  echo 'Failed package recovery was silently accepted' >&2
  exit 1
fi
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 1 ]]
[[ "$(grep -c '^dpkg:--configure -a$' "$MOCK_LOG")" -eq 1 ]]
assert_recovery_deadlines 1
[[ "$(grep -c '^python:-m playwright install chromium$' "$MOCK_LOG" || true)" -eq 0 ]]
grep -q 'could not recover interrupted package configuration' "$mock_dir/repair-output.log"

echo 'Browser installation bounded retry tests: 23/23 passed'
