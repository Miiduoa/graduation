#!/usr/bin/env bash
# No packages/network required: exercise the installer, including a real timeout.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mock_dir="$(mktemp -d)"
trap 'rm -rf "$mock_dir"' EXIT
mkdir -p "$mock_dir/bin"
export REAL_TIMEOUT="$(command -v timeout)"

cat > "$mock_dir/bin/python" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'python:%s\n' "$*" >> "$MOCK_LOG"
if [[ "$*" == '-m playwright install-deps chromium' ]]; then
  [[ "${MOCK_ROOT:-0}" == 1 ]]
  count="$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG" || true)"
  if [[ "${MOCK_PROCESS_TEST:-0}" == 1 ]]; then
    if (( count == 1 )); then
      # Simulate apt retaining its lock and ignoring TERM in sudo's session.
      exec flock --no-fork -n "$MOCK_LOCK" bash -c '
        trap "" TERM
        touch "$MOCK_LOCK.interrupted"
        echo locked >> "$MOCK_LOG"
        while :; do /bin/sleep 1; done
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
[[ "$1" == timeout ]]
export MOCK_ROOT=1
printf 'sudo:%s\n' "$*" >> "$MOCK_LOG"
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
cat > "$mock_dir/bin/dpkg" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == '--configure -a' && "${MOCK_ROOT:-0}" == 1 ]]
printf 'dpkg:%s\n' "$*" >> "$MOCK_LOG"
if [[ "${MOCK_REPAIR_FAIL:-0}" == 1 ]]; then exit 1; fi
if [[ "${MOCK_PROCESS_TEST:-0}" == 1 ]]; then
  # timeout can exit before the killed process group releases its lock FDs.
  # Recovery must follow the retry backoff, even when cleanup happens quickly.
  if ! grep -q '^sleep:15$' "$MOCK_LOG"; then
    echo 'Package recovery started before the lock-release backoff' >&2
    exit 1
  fi
  flock -n "$MOCK_LOCK" true
  rm -f "$MOCK_LOCK.interrupted"
fi
MOCK
cat > "$mock_dir/bin/sleep" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'sleep:%s\n' "$*" >> "$MOCK_LOG"
if [[ "${MOCK_PROCESS_TEST:-0}" == 1 ]]; then
  # Preserve the real delay only for the process/lock test; a no-op sleep
  # would reintroduce the race between timeout exiting and child cleanup.
  /bin/sleep "$@"
fi
MOCK
cat > "$mock_dir/bin/timeout" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == '--kill-after=5s' ]]
shift
limit="$1"; shift
printf 'timeout:%s\n' "$limit" >> "$MOCK_LOG"
if [[ "${MOCK_SLOW_FONT:-0}" == 1 && "$1" == apt-get ]]; then
  # Scale one minute to one second: a 90-second font transfer outlasts the
  # former 60-second deadline but fits within the 180-second deadline.
  exec "$REAL_TIMEOUT" --kill-after=0.2s "$((${limit%s} / 60))s" "$@"
fi
if [[ "${MOCK_PROCESS_TEST:-0}" == 1 ]]; then
  exec "$REAL_TIMEOUT" --kill-after=0.2s 1s "$@"
fi
if [[ "$1" == dpkg ]]; then exec "$@"; fi
echo install-attempt >> "$MOCK_LOG"
count="$(grep -c '^install-attempt$' "$MOCK_LOG" || true)"
if (( count <= ${MOCK_TIMEOUT_FAILS:-0} )); then exit 124; fi
"$@"
MOCK
chmod +x "$mock_dir/bin/"*
export PATH="$mock_dir/bin:$PATH" MOCK_LOG="$mock_dir/install.log"

# Transient browser, dependency and font failures all recover.
export MOCK_PYTHON_FAILS=1 MOCK_APT_FAILS=1 MOCK_DEPS_FAILS=1
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1
[[ "$(grep -c '^python:-m playwright install chromium$' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^apt:' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^timeout:180s' "$MOCK_LOG")" -eq 8 ]]
[[ "$(grep -c '^dpkg:--configure -a$' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^sudo:timeout --kill-after=5s 180s dpkg --configure -a$' "$MOCK_LOG")" -eq 2 ]]
# Both privileged commands must place timeout inside sudo, preserving Python's path.
[[ "$(grep -Fc "sudo:timeout --kill-after=5s 180s $mock_dir/bin/python -m playwright install-deps chromium" "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^sudo:timeout --kill-after=5s 180s apt-get ' "$MOCK_LOG")" -eq 2 ]]

# Both first and second attempts may time out; the third success is still valid.
export MOCK_PYTHON_FAILS=0 MOCK_APT_FAILS=0 MOCK_DEPS_FAILS=0 MOCK_TIMEOUT_FAILS=2
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1
[[ "$(grep -c '^timeout:180s' "$MOCK_LOG")" -eq 7 ]]
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
[[ "$(grep -c '^timeout:180s' "$MOCK_LOG")" -eq 7 ]]

# A slow, successful font transfer must finish instead of restarting three times.
export MOCK_APT_FAILS=0 MOCK_SLOW_FONT=1
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1
[[ "$(grep -c '^apt:' "$MOCK_LOG")" -eq 1 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG" || true)" -eq 0 ]]
export MOCK_SLOW_FONT=0

# Bad parameters fail before any installation attempt.
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --unsupported >/dev/null 2>&1; then
  echo 'Unsupported argument did not fail' >&2
  exit 1
fi
[[ ! -s "$MOCK_LOG" ]]

# A real timeout must kill the lock holder across the simulated sudo session,
# then repair interrupted dpkg state before the next apt attempt can succeed.
export MOCK_APT_FAILS=0 MOCK_PROCESS_TEST=1 MOCK_LOCK="$mock_dir/apt.lock"
: > "$MOCK_LOG"
if ! bash "$script_dir/install-playwright.sh" --fonts-noto-cjk > "$mock_dir/process-output.log" 2>&1; then
  cat "$mock_dir/process-output.log" "$MOCK_LOG" >&2
  exit 1
fi
grep -q '^locked$' "$MOCK_LOG"
grep -q '^recovered$' "$MOCK_LOG"
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^dpkg:--configure -a$' "$MOCK_LOG")" -eq 1 ]]
[[ ! -e "$MOCK_LOCK.interrupted" ]]
flock -n "$MOCK_LOCK" true

# Failed recovery must stop before retrying apt or running browser checks.
export MOCK_PROCESS_TEST=0 MOCK_DEPS_FAILS=1 MOCK_REPAIR_FAIL=1
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --fonts-noto-cjk > "$mock_dir/repair-output.log" 2>&1; then
  echo 'Failed package recovery was silently accepted' >&2
  exit 1
fi
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 1 ]]
[[ "$(grep -c '^dpkg:--configure -a$' "$MOCK_LOG")" -eq 1 ]]
[[ "$(grep -c '^python:-m playwright install chromium$' "$MOCK_LOG" || true)" -eq 0 ]]
grep -q 'could not recover interrupted package configuration' "$mock_dir/repair-output.log"

echo 'Browser installation bounded retry tests: 11/11 passed'
