#!/usr/bin/env bash
# No packages/network required: exercise installation retries and privilege order.
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
  [[ "${MOCK_ROOT:-0}" == 1 ]]
  count="$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG" || true)"
  (( count > MOCK_DEPS_FAILS ))
else
  [[ "$*" == '-m playwright install chromium' && "${MOCK_ROOT:-0}" == 0 ]]
  count="$(grep -c '^python:-m playwright install chromium$' "$MOCK_LOG" || true)"
  (( count > MOCK_BROWSER_FAILS ))
fi
MOCK
cat > "$mock_dir/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
# Regression: timeout must run inside sudo, including for font installation.
[[ "$1" == timeout ]]
printf 'sudo:timeout\n' >> "$MOCK_LOG"
export MOCK_ROOT=1
exec "$@"
MOCK
cat > "$mock_dir/bin/apt-get" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "${MOCK_ROOT:-0}" == 1 && "$*" == *'install -y fonts-noto-cjk' ]]
printf 'fonts\n' >> "$MOCK_LOG"
count="$(grep -c '^fonts$' "$MOCK_LOG" || true)"
(( count > MOCK_FONT_FAILS ))
MOCK
cat > "$mock_dir/bin/sleep" <<'MOCK'
#!/usr/bin/env bash
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
if (( count <= MOCK_TIMEOUT_FAILS )); then exit 124; fi
"$@"
MOCK
chmod +x "$mock_dir/bin/"*
export PATH="$mock_dir/bin:$PATH" MOCK_LOG="$mock_dir/install.log"
export MOCK_DEPS_FAILS=0 MOCK_BROWSER_FAILS=0 MOCK_FONT_FAILS=0 MOCK_TIMEOUT_FAILS=0

# Transient dependency, browser and font failures each recover independently.
export MOCK_DEPS_FAILS=1 MOCK_BROWSER_FAILS=1 MOCK_FONT_FAILS=1
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >"$mock_dir/output" 2>&1
[[ "$(grep -c '^python:-m playwright install-deps chromium$' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^python:-m playwright install chromium$' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^fonts$' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG")" -eq 3 ]]

# Timeouts retry successfully while retaining privileged dependency installation.
export MOCK_DEPS_FAILS=0 MOCK_BROWSER_FAILS=0 MOCK_FONT_FAILS=0 MOCK_TIMEOUT_FAILS=2
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >"$mock_dir/output" 2>&1
[[ "$(grep -c '^sudo:timeout$' "$MOCK_LOG")" -eq 4 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG")" -eq 2 ]]
export MOCK_TIMEOUT_FAILS=0

# Admin fails closed independently for dependencies, browser downloads and fonts.
for failure in MOCK_DEPS_FAILS MOCK_BROWSER_FAILS MOCK_FONT_FAILS; do
  export MOCK_DEPS_FAILS=0 MOCK_BROWSER_FAILS=0 MOCK_FONT_FAILS=0
  export "$failure=3"
  : > "$MOCK_LOG"
  if bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >"$mock_dir/output" 2>&1; then
    echo "Persistent Admin failure was silently accepted: $failure" >&2
    exit 1
  fi
  grep -q 'failed after 3 attempts' "$mock_dir/output"
  [[ "$(grep -c '^sleep:' "$MOCK_LOG")" -eq 2 ]]
done

# Campus still requires a browser download.
export MOCK_DEPS_FAILS=0 MOCK_BROWSER_FAILS=3 MOCK_FONT_FAILS=0
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" >"$mock_dir/output" 2>&1; then
  echo 'Persistent Chromium failure was silently accepted' >&2
  exit 1
fi
[[ "$(grep -c '^python:-m playwright install chromium$' "$MOCK_LOG")" -eq 3 ]]

# Campus retains its existing dependency fallback, then runs actual browser QA.
export MOCK_BROWSER_FAILS=0 MOCK_DEPS_FAILS=3
: > "$MOCK_LOG"
(
  set -e
  bash "$script_dir/install-playwright.sh"
  echo 'browser-check' >> "$MOCK_LOG"
) >"$mock_dir/output" 2>&1
[[ "$(grep -c '^timeout:90s$' "$MOCK_LOG")" -eq 3 ]]
grep -q '^browser-check$' "$MOCK_LOG"
grep -q 'continuing with actual browser checks' "$mock_dir/output"

# Bad parameters fail before any installation attempt.
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --unsupported >"$mock_dir/output" 2>&1; then
  echo 'Unsupported argument did not fail' >&2
  exit 1
fi
[[ ! -s "$MOCK_LOG" ]]
echo 'Browser installation retry and privilege tests: 8/8 passed'
