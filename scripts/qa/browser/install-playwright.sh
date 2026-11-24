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

# Record the process group that timeout gives each privileged attempt. GNU
# timeout sends its final SIGKILL to that whole group, but other timeout
# implementations (for example uutils on newer Ubuntu runners) kill only the
# direct child, leaving TERM-ignoring package helpers that still hold the
# dpkg/apt lock. The installer therefore removes survivors itself.
attempt_dir="$(mktemp -d)"
trap 'rm -rf "$attempt_dir"' EXIT
attempt_group_file="$attempt_dir/process-group"
record_group=(bash -c 'read -r _ _ _ _ pgid _ < "/proc/$$/stat" && printf "%s\n" "$pgid" > "$1"; shift; exec "$@"' record-process-group "$attempt_group_file")
read -r _ _ _ _ installer_group _ < "/proc/$$/stat"

kill_timed_out_group() {
  local group=""
  [[ -s "$attempt_group_file" ]] && read -r group < "$attempt_group_file"
  # Never signal an unrecorded or invalid group, nor the installer's own group.
  if [[ ! "$group" =~ ^[1-9][0-9]*$ || "$group" == "$installer_group" ]]; then return 0; fi
  "$@" kill -KILL -- "-$group" 2>/dev/null || true
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
  local attempt install_status recovery_attempt recovery_deadline recovery_status remaining recovered
  for attempt in 1 2 3; do
    # sudo can start a separate session. Run timeout *after* elevation so it
    # owns and can signal the entire privileged apt process group on expiry.
    local -a probe=()
    if (( ${#elevation[@]} )); then
      probe=("${record_group[@]}")
      : > "$attempt_group_file"
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
        : > "$attempt_group_file"
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

prefetch_noble_fonts() {
  local destination="$1"
  local sha='7d64b985f6fe128c99eae5610d5c047338e572bdcfb2bb09736be01b824a7f6c'
  local deb='fonts-noto-cjk_20230817+repack1-3_all.deb'
  local candidate installed
  # The runner's regional mirror can stall on this 61 MB package. Only use
  # this alternative for the exact candidate published in Ubuntu's Noble index.
  candidate="$(LC_ALL=C apt-cache --no-all-versions show fonts-noto-cjk)" || return 1
  grep -Fxq "SHA256: $sha" <<< "$candidate" || return 1
  installed="$(dpkg-query -W -f='${Status} ${Version}' fonts-noto-cjk 2>/dev/null)" || installed=''
  [[ "$installed" != 'install ok installed 1:20230817+repack1-3' ]] || return 1
  curl --fail --silent --show-error --proto '=https' --connect-timeout 8 --max-time 75 \
    --output "$destination" "https://archive.ubuntu.com/ubuntu/pool/main/f/fonts-noto-cjk/$deb" || return 1
  printf '%s  %s\n' "$sha" "$destination" | sha256sum --check --status
}

if [[ "${1:-}" == '--fonts-noto-cjk' ]]; then
  retry_install 'Playwright system dependencies' 180s sudo "$(command -v python)" -m playwright install-deps chromium
  # Download as the runner user so the browser remains in that user's cache.
  retry_install 'Playwright Chromium' 180s python -m playwright install chromium
  # Keep ordinary authenticated apt installation for other candidates and as
  # fallback if the archive is unreachable or its bytes fail verification.
  font_package=fonts-noto-cjk
  if prefetch_noble_fonts "$attempt_dir/fonts-noto-cjk.deb"; then
    font_package="$attempt_dir/fonts-noto-cjk.deb"
  fi
  retry_install 'Noto CJK fonts' 180s sudo apt-get \
    -o Acquire::http::Timeout=45 -o Acquire::https::Timeout=45 \
    -o Acquire::Retries=3 install -y "$font_package"
else
  retry_install 'Playwright Chromium' 180s python -m playwright install chromium
  if ! retry_install 'Playwright system dependencies' 90s sudo "$(command -v python)" -m playwright install-deps chromium; then
    echo 'Skipping extra system packages after bounded retries; continuing with actual browser checks (Ubuntu mirror may be unreachable).' >&2
  fi
fi
