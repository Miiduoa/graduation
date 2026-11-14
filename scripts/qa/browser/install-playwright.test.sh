#!/usr/bin/env bash
# No packages/network required: exercise the actual bounded retry script with mock tools.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mock_dir="$(mktemp -d)"
trap 'rm -rf "$mock_dir"' EXIT
mkdir -p "$mock_dir/bin"

cat > "$mock_dir/bin/python" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'python:%s\n' "$*" >> "$MOCK_LOG"
if [[ "$*" == '-m playwright install-deps chromium' ]]; then
  count="$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG" || true)"
  (( count > MOCK_DEPS_FAILS ))
  exit
fi
count="$(grep -c '^python:' "$MOCK_LOG" || true)"
(( count > MOCK_PYTHON_FAILS ))
MOCK
cat > "$mock_dir/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo:%s\n' "$*" >> "$MOCK_LOG"
count="$(grep -c '^sudo:' "$MOCK_LOG" || true)"
(( count > MOCK_SUDO_FAILS ))
MOCK
cat > "$mock_dir/bin/sleep" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'sleep:%s\n' "$*" >> "$MOCK_LOG"
MOCK
cat > "$mock_dir/bin/timeout" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == '--kill-after=5s' ]]
shift
limit="$1"; shift
printf 'timeout:%s\n' "$limit" >> "$MOCK_LOG"
count="$(grep -c '^timeout:' "$MOCK_LOG" || true)"
if (( count <= ${MOCK_TIMEOUT_FAILS:-0} )); then exit 124; fi
"$@"
MOCK
chmod +x "$mock_dir/bin/"*
export PATH="$mock_dir/bin:$PATH" MOCK_LOG="$mock_dir/install.log"

# A transient DNS/apt failure recovers without skipping the Chromium check.
export MOCK_PYTHON_FAILS=1 MOCK_SUDO_FAILS=1 MOCK_DEPS_FAILS=0
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1
[[ "$(grep -c '^python:' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^sudo:' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^timeout:180s' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^timeout:60s' "$MOCK_LOG")" -eq 2 ]]

# Both first and second attempts may time out; the third success is still valid.
export MOCK_PYTHON_FAILS=0 MOCK_SUDO_FAILS=0 MOCK_TIMEOUT_FAILS=2
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1
[[ "$(grep -c '^timeout:180s' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^python:' "$MOCK_LOG")" -eq 1 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG")" -eq 2 ]]

export MOCK_TIMEOUT_FAILS=0

# A persistent failure stays a red CI job: never quietly skip browser QA.
export MOCK_PYTHON_FAILS=3 MOCK_SUDO_FAILS=0
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

# Admin still requires the combined Chromium/system dependency installation.
export MOCK_PYTHON_FAILS=3 MOCK_DEPS_FAILS=0
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1; then
  echo 'Persistent Admin Chromium/dependency failure was silently accepted' >&2
  exit 1
fi
[[ "$(grep -c '^python:-m playwright install --with-deps chromium$' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^sudo:' "$MOCK_LOG" || true)" -eq 0 ]]

# Fonts are also required for visual QA. Do not let three apt failures pass.
export MOCK_PYTHON_FAILS=0 MOCK_SUDO_FAILS=3
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1; then
  echo 'Persistent font installation failure was silently accepted' >&2
  exit 1
fi
[[ "$(grep -c '^python:' "$MOCK_LOG")" -eq 1 ]]
[[ "$(grep -c '^sudo:' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^timeout:60s' "$MOCK_LOG")" -eq 3 ]]

# Bad parameters fail before any installation attempt.
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --unsupported >/dev/null 2>&1; then
  echo 'Unsupported argument did not fail' >&2
  exit 1
fi
[[ ! -s "$MOCK_LOG" ]]

echo 'Browser installation bounded retry tests: 7/7 passed'
