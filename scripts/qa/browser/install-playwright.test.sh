#!/usr/bin/env bash
# No packages/network required: exercise the actual retry script with mock tools.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mock_dir="$(mktemp -d)"
trap 'rm -rf "$mock_dir"' EXIT
mkdir -p "$mock_dir/bin"

cat > "$mock_dir/bin/python" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'python:%s\n' "$*" >> "$MOCK_LOG"
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
chmod +x "$mock_dir/bin/"*
export PATH="$mock_dir/bin:$PATH" MOCK_LOG="$mock_dir/install.log"

# A transient DNS/apt failure recovers without skipping the Chromium check.
export MOCK_PYTHON_FAILS=1 MOCK_SUDO_FAILS=1
: > "$MOCK_LOG"
bash "$script_dir/install-playwright.sh" --fonts-noto-cjk >/dev/null 2>&1
[[ "$(grep -c '^python:' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^sudo:' "$MOCK_LOG")" -eq 2 ]]
[[ "$(grep -c '^sleep:' "$MOCK_LOG")" -eq 2 ]]

# A persistent failure stays a red CI job: never quietly skip browser QA.
export MOCK_PYTHON_FAILS=3 MOCK_SUDO_FAILS=0
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" >/dev/null 2>&1; then
  echo 'Persistent Chromium installation failure was silently accepted' >&2
  exit 1
fi
[[ "$(grep -c '^python:' "$MOCK_LOG")" -eq 3 ]]
[[ "$(grep -c '^sudo:' "$MOCK_LOG" || true)" -eq 0 ]]

# Bad parameters fail before any installation attempt.
: > "$MOCK_LOG"
if bash "$script_dir/install-playwright.sh" --unsupported >/dev/null 2>&1; then
  echo 'Unsupported argument did not fail' >&2
  exit 1
fi
[[ ! -s "$MOCK_LOG" ]]

echo 'Browser installation retry tests: 3/3 passed'
