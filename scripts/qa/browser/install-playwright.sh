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
  local -a elevation=()
  if [[ "$1" == sudo ]]; then
    elevation=(sudo)
    shift
  fi
  local attempt install_status recovery_attempt recovery_deadline remaining recovered
  for attempt in 1 2 3; do
    # sudo can start a separate session. Run timeout *after* elevation so it
    # owns and can signal the entire privileged apt process group on expiry.
    if "${elevation[@]}" timeout --kill-after=5s "$deadline" "$@"; then
      return 0
    else
      install_status=$?
    fi
    if (( attempt == 3 )); then
      echo "${label} failed after 3 attempts." >&2
      return 1
    fi
    if (( ${#elevation[@]} )); then
      # SIGKILL may end timeout before its command has released the package
      # lock. Allow two short recovery retries after a timeout, within one
      # 180-second budget; never retry apt until dpkg actually succeeds.
      recovered=0
      recovery_deadline=$((SECONDS + 180))
      for recovery_attempt in 1 2 3; do
        remaining=$((recovery_deadline - SECONDS))
        if (( remaining <= 0 )); then break; fi
        if "${elevation[@]}" timeout --kill-after=5s "${remaining}s" dpkg --configure -a; then
          recovered=1
          break
        fi
        if [[ "$install_status" != 124 && "$install_status" != 137 ]] ||
          (( recovery_attempt == 3 || SECONDS + recovery_attempt >= recovery_deadline )); then break; fi
        sleep "$recovery_attempt"
      done
      if (( ! recovered )); then
        echo "${label}: could not recover interrupted package configuration." >&2
        return 1
      fi
    fi
    echo "${label} attempt ${attempt}/3 failed or timed out; retrying after $((attempt * 15)) seconds." >&2
    sleep "$((attempt * 15))"
  done
}

if [[ "${1:-}" == '--fonts-noto-cjk' ]]; then
  retry_install 'Playwright system dependencies' 180s sudo "$(command -v python)" -m playwright install-deps chromium
  # Download as the runner user so the browser remains in that user's cache.
  retry_install 'Playwright Chromium' 180s python -m playwright install chromium
  # This package is about 61 MB. A 60-second wall-clock limit can repeatedly
  # interrupt a healthy but slow mirror download before apt finishes it.
  # Give fonts the same bounded transfer/install window as Chromium.
  retry_install 'Noto CJK fonts' 180s sudo apt-get \
    -o Acquire::http::Timeout=45 -o Acquire::https::Timeout=45 \
    -o Acquire::Retries=3 install -y fonts-noto-cjk
else
  retry_install 'Playwright Chromium' 180s python -m playwright install chromium
  if ! retry_install 'Playwright system dependencies' 90s sudo "$(command -v python)" -m playwright install-deps chromium; then
    echo 'Skipping extra system packages after bounded retries; continuing with actual browser checks (Ubuntu mirror may be unreachable).' >&2
  fi
fi
