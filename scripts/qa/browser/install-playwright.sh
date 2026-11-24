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

source "$(dirname "${BASH_SOURCE[0]}")/../../process-identity.sh"

# Record the timeout group before exec. Its PGID is the leader PID. Some timeout implementations only
# kill their direct child, leaving package helpers holding the dpkg/apt lock.
attempt_dir="$(mktemp -d)"
trap 'rm -rf "$attempt_dir"' EXIT
attempt_group_file="$attempt_dir/process-group"
proc_identity "$$"
installer_group="$proc_group"

record_attempt() {
  IFS= read -r attempt_id < /proc/sys/kernel/random/uuid
  : > "$attempt_group_file"
  record_group=(bash -c "$(declare -f proc_identity)
    proc_identity \$\$ || exit 1
    group=\$proc_group
    proc_identity \$group && [[ \$group == \$proc_group ]] || exit 1
    printf '%s %s\\n' \"\$group\" \"\$proc_start\" > \"\$1\" || exit 1
    export PLAYWRIGHT_INSTALL_ATTEMPT=\"\$2\"
    shift 2
    exec \"\$@\"" record-process-group "$attempt_group_file" "$attempt_id")
}

kill_timed_out_group() {
  local group start extra
  read -r group start extra < "$attempt_group_file" || return 0
  [[ "$group" =~ ^([2-9]|[1-9][0-9]+)$ && "$start" =~ ^[0-9]+$ &&
    "$group" != "$installer_group" && -z "$extra" ]] || return 0
  # Read privileged /proc environments and recheck identity after elevation.
  "$@" bash -c "$(declare -f proc_identity proc_group_leader_matches proc_group_members proc_signal_group)
    proc_signal_group \"\$@\"" signal-process-group "$group" "$start" "PLAYWRIGHT_INSTALL_ATTEMPT=$attempt_id" KILL || true
}

retry_install() {
  local label="$1"
  local deadline="$2"
  shift 2
  local -a elevation=()
  if [[ "$1" == sudo ]]; then
    elevation=(sudo)
    shift
  fi
  local attempt_id record_group=()
  local attempt install_status recovery_attempt recovery_deadline recovery_status remaining recovered
  for attempt in 1 2 3; do
    # sudo can start a separate session. Run timeout *after* elevation so it
    # owns and can signal the entire privileged apt process group on expiry.
    local -a probe=()
    if (( ${#elevation[@]} )); then
      record_attempt
      probe=("${record_group[@]}")
    fi
    if "${elevation[@]}" timeout --kill-after=5s "$deadline" "${probe[@]}" "$@"; then
      return 0
    else
      install_status=$?
    fi
    if (( ${#elevation[@]} )) && [[ "$install_status" == 124 || "$install_status" == 137 ]]; then
      kill_timed_out_group "${elevation[@]}"
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
        # The recovery command is bounded the same way as an install attempt:
        # record its process group so a timeout implementation that kills only
        # the direct child cannot leave dpkg helpers holding the package lock.
        record_attempt
        if "${elevation[@]}" timeout --kill-after=5s "${remaining}s" "${record_group[@]}" dpkg --configure -a; then
          recovered=1
          break
        else
          recovery_status=$?
        fi
        if [[ "$recovery_status" == 124 || "$recovery_status" == 137 ]]; then
          kill_timed_out_group "${elevation[@]}"
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
