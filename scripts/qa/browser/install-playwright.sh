#!/usr/bin/env bash
# Campus requires Chromium but tolerates unavailable system packages; Admin
# (--fonts-noto-cjk) requires Chromium, system dependencies, and fonts.
# Bound package and browser operations independently so stalled downloads and
# interrupted package configuration can be retried.
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--fonts-noto-cjk" ) ]]; then
  echo 'usage: bash install-playwright.sh [--fonts-noto-cjk]' >&2
  exit 2
fi

source "$(dirname "${BASH_SOURCE[0]}")/../../process-identity.sh"

# sudo creates the record directory under the system sticky directory.
# Keep it private to the elevated attempts and never use the caller's TMPDIR.
attempt_dir=''
font_download_dir=''
proc_identity "$$"
installer_group="$proc_group"

private_attempt_dir() {
  local dir="$1"
  [[ ! -L /tmp && "$(stat -c '%u:%a' -- /tmp)" == 0:1777 &&
    "$dir" =~ ^/tmp/playwright-install\.[a-zA-Z0-9]{10}$ && ! -L "$dir" && -d "$dir" &&
    "$(stat -c '%u:%a' -- "$dir")" == "$EUID:700" ]]
}

cleanup_attempt_dir() {
  [[ -n "$attempt_dir" ]] || return 0
  sudo bash -c "$(declare -f private_attempt_dir)
    private_attempt_dir \"\$1\" && rm -f -- \"\$1/process-group\" \"\$1/fonts-noto-cjk.deb\" && rmdir -- \"\$1\"" clean-attempt-dir "$attempt_dir"
}

cleanup() {
  local status=0
  cleanup_attempt_dir || status=$?
  if [[ -n "$font_download_dir" ]]; then
    rm -f -- "$font_download_dir/fonts-noto-cjk.deb" && rmdir -- "$font_download_dir" || status=$?
  fi
  return "$status"
}
trap cleanup EXIT

record_attempt() {
  cleanup_attempt_dir || return 1
  attempt_dir="$(sudo mktemp -d /tmp/playwright-install.XXXXXXXXXX)" || return 1
  [[ "$attempt_dir" =~ ^/tmp/playwright-install\.[a-zA-Z0-9]{10}$ ]] || { attempt_dir=''; return 1; }
  IFS= read -r attempt_id < /proc/sys/kernel/random/uuid || return 1
  record_group=(bash -c "$(declare -f proc_identity private_attempt_dir)
    private_attempt_dir \"\${1%/*}\" || exit 1
    proc_identity \$\$ || exit 1
    group=\$proc_group
    proc_identity \$group && [[ \$group == \$proc_group ]] || exit 1
    umask 077
    (set -o noclobber; printf '%s %s %s %s\\n' \"\$group\" \"\$proc_start\" \"\$2\" \"\$proc_group\" > \"\$1\") || exit 1
    export PLAYWRIGHT_INSTALL_ATTEMPT_DIR=\"\${1%/*}\"
    shift 2
    exec \"\$@\"" record-process-group "$attempt_dir/process-group" "$attempt_id")
}

read_attempt_record() {
  local file="$1" nonce="$2" installer_group="$3" pid start recorded_nonce group extra
  private_attempt_dir "${file%/*}" || return 1
  # The recorder must create this file before executing the package command.
  [[ -e "$file" || -L "$file" ]] || return 0
  # In a private directory the unprivileged caller cannot swap the checked file.
  [[ ! -L "$file" && -f "$file" && "$(stat -c '%u:%a:%h' -- "$file")" == "$EUID:600:1" ]] || return 1
  read -r pid start recorded_nonce group extra < "$file" || return 1
  [[ "$pid" == "$group" && "$group" =~ ^([2-9]|[1-9][0-9]+)$ && "$start" =~ ^[0-9]+$ &&
    "$group" != "$installer_group" && "$recorded_nonce" == "$nonce" && -z "$extra" ]] || return 1
  proc_signal_marked_group "$pid" "$start" "$group" "PLAYWRIGHT_INSTALL_ATTEMPT=$nonce" KILL
}

kill_timed_out_group() {
  "$@" bash -c "$(declare -f proc_identity proc_group_leader_matches proc_send_signal proc_group_members proc_signal_marked_group private_attempt_dir read_attempt_record)
    read_attempt_record \"\$@\"" signal-process-group "$attempt_dir/process-group" "$attempt_id" "$installer_group" || {
    echo 'Playwright package process group cleanup failed.' >&2
    return 1
  }
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
    local -a probe=() environment=()
    if (( ${#elevation[@]} )); then
      record_attempt || return 1
      probe=("${record_group[@]}")
      environment=(env "PLAYWRIGHT_INSTALL_ATTEMPT=$attempt_id")
    fi
    if "${elevation[@]}" "${environment[@]}" timeout --kill-after=5s "$deadline" "${probe[@]}" "$@"; then
      return 0
    else
      install_status=$?
    fi
    if (( ${#elevation[@]} )) && [[ "$install_status" == 124 || "$install_status" == 137 ]]; then
      kill_timed_out_group "${elevation[@]}" || return 2
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
        record_attempt || return 1
        if "${elevation[@]}" env "PLAYWRIGHT_INSTALL_ATTEMPT=$attempt_id" timeout --kill-after=5s "${remaining}s" "${record_group[@]}" dpkg --configure -a; then
          recovered=1
          break
        else
          recovery_status=$?
        fi
        if [[ "$recovery_status" == 124 || "$recovery_status" == 137 ]]; then
          kill_timed_out_group "${elevation[@]}" || return 2
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

install_verified_fonts() {
  local directory="${PLAYWRIGHT_INSTALL_ATTEMPT_DIR:-}"
  local sha='7d64b985f6fe128c99eae5610d5c047338e572bdcfb2bb09736be01b824a7f6c'
  private_attempt_dir "$directory" || return 1
  # The caller can change its download after prefetch verification. Stage a
  # private elevated copy and verify those exact bytes before invoking dpkg.
  cp -- "$1" "$directory/fonts-noto-cjk.deb" || return 1
  printf '%s  %s\n' "$sha" "$directory/fonts-noto-cjk.deb" | sha256sum --check --status || return 1
  dpkg --install "$directory/fonts-noto-cjk.deb"
}

if [[ "${1:-}" == '--fonts-noto-cjk' ]]; then
  # A fresh runner can still be unpacking packages after three minutes.
  retry_install 'Playwright system dependencies' 360s sudo "$(command -v python)" -m playwright install-deps chromium
  # Download as the runner user so the browser remains in that user's cache.
  retry_install 'Playwright Chromium' 180s python -m playwright install chromium
  # Keep ordinary authenticated apt installation for other candidates and as
  # fallback if the archive is unreachable or its bytes fail verification.
  font_download_dir="$(mktemp -d /tmp/playwright-font-download.XXXXXXXXXX)"
  if prefetch_noble_fonts "$font_download_dir/fonts-noto-cjk.deb"; then
    # APT may re-fetch the same version from its preferred mirror even with a
    # local path. This verified Noble package has no package dependencies.
    retry_install 'Noto CJK fonts' 180s sudo bash -c "$(declare -f private_attempt_dir install_verified_fonts)
      install_verified_fonts \"\$1\"" install-verified-font "$font_download_dir/fonts-noto-cjk.deb"
  else
    retry_install 'Noto CJK fonts' 180s sudo apt-get \
      -o Acquire::http::Timeout=45 -o Acquire::https::Timeout=45 \
      -o Acquire::Retries=3 install -y fonts-noto-cjk
  fi
else
  retry_install 'Playwright Chromium' 180s python -m playwright install chromium
  status=0
  retry_install 'Playwright system dependencies' 90s sudo "$(command -v python)" -m playwright install-deps chromium || status=$?
  if (( status == 2 )); then exit "$status"; fi
  if (( status != 0 )); then
    echo 'Skipping extra system packages after bounded retries; continuing with actual browser checks (Ubuntu mirror may be unreachable).' >&2
  fi
fi
