#!/usr/bin/env bash
# Campus requires Chromium but tolerates unavailable system packages; Admin
# (--fonts-noto-cjk) requires Chromium, system dependencies, and fonts.
# Bound each stalled apt/download attempt so GitHub's 20-minute runner limit
# can still report an actual failed installation rather than a hung check.
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--fonts-noto-cjk" ) ]]; then
  echo 'usage: bash install-playwright.sh [--fonts-noto-cjk]' >&2
  exit 2
fi

retry_install() {
  local label="$1"
  local deadline="$2"
  shift 2
  local attempt
  for attempt in 1 2 3; do
    if timeout --kill-after=5s "$deadline" "$@"; then
      return 0
    fi
    if (( attempt == 3 )); then
      echo "${label} failed after 3 attempts." >&2
      return 1
    fi
    echo "${label} attempt ${attempt}/3 failed or timed out; retrying after $((attempt * 15)) seconds." >&2
    sleep "$((attempt * 15))"
  done
}

if [[ "${1:-}" == '--fonts-noto-cjk' ]]; then
  retry_install 'Playwright Chromium/dependencies' 180s python -m playwright install --with-deps chromium
  retry_install 'Noto CJK fonts' 60s sudo apt-get \
    -o Acquire::http::Timeout=45 -o Acquire::https::Timeout=45 \
    -o Acquire::Retries=3 install -y fonts-noto-cjk
else
  retry_install 'Playwright Chromium' 180s python -m playwright install chromium
  if ! retry_install 'Playwright system dependencies' 90s python -m playwright install-deps chromium; then
    echo 'Skipping extra system packages after bounded retries; continuing with actual browser checks (Ubuntu mirror may be unreachable).' >&2
  fi
fi
