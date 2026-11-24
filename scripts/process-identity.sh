#!/usr/bin/env bash
# Linux process identity for launcher and installer cleanup.
proc_identity() {
  local pid="$1" stat=""
  local -a fields
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  # read with a NUL delimiter keeps any newlines in comm.
  { IFS= read -r -d '' stat < "/proc/$pid/stat" || [[ -n "$stat" ]]; } 2>/dev/null || return 1
  # comm may contain spaces and closing parentheses.
  read -ra fields <<< "${stat##*) }"
  [[ "${fields[2]:-}" =~ ^[1-9][0-9]*$ && "${fields[19]:-}" =~ ^[0-9]+$ ]] || return 1
  proc_group="${fields[2]}"
  proc_start="${fields[19]}"
  proc_state="${fields[0]}"
}

# 1: contradictory identity; 2: leader gone or stat unavailable;
# 3: matching live stat but leader marker unavailable.
proc_group_leader_matches() {
  local pid="$1" start="$2" group="$3" marker="$4" marked=0 conflict=0
  local proc_group proc_start proc_state
  [[ "$pid" == "$group" && "$group" =~ ^([2-9]|[1-9][0-9]+)$ &&
    "$start" =~ ^[0-9]+$ && "$marker" =~ ^[A-Z_][A-Z_0-9]*= ]] || return 1
  proc_identity "$pid" || return 2
  [[ "$proc_state" != Z && "$proc_state" != X ]] || return 2
  [[ "$proc_group" == "$group" && "$proc_start" == "$start" ]] || return 1
  if grep -zFxq -- "$marker" "/proc/$pid/environ" 2>/dev/null; then
    marked=1
  elif [[ "$?" == 1 ]] && grep -zEq -- "^${marker%%=*}=" "/proc/$pid/environ" 2>/dev/null; then
    conflict=1
  fi
  proc_identity "$pid" || return 2
  [[ "$proc_state" != Z && "$proc_state" != X ]] || return 2
  [[ "$proc_group" == "$group" && "$proc_start" == "$start" && "$conflict" == 0 ]] || return 1
  [[ "$marked" == 1 ]] || return 3
}

# Open the pidfd before the final checks. A numeric PID can be recycled
# after either check, but the descriptor can only signal the original task.
proc_send_signal() {
  python3 -I -c '
import errno
import os
import signal
import sys

pid, start, group, marker, name = sys.argv[1:]
pid = int(pid)

def matches(proc):
    with open("stat", "rb", opener=lambda name, flags: os.open(name, flags, dir_fd=proc)) as stat:
        fields = stat.read().rsplit(b") ", 1)[1].split()
    return (fields[0] not in (b"Z", b"X") and fields[19] == start.encode()
            and (not group or fields[2] == group.encode()))

try:
    sig = getattr(signal, "SIG" + name)
    with_pidfd = hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal")
    pidfd = None
    if with_pidfd:
        try:
            pidfd = os.pidfd_open(pid)
        except OSError as error:
            if error.errno not in (errno.ENOSYS, errno.EINVAL):
                raise
    proc = os.open(f"/proc/{pid}", os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW)
    if not matches(proc):
        sys.exit(1)
    if marker:
        fd = os.open("environ", os.O_RDONLY, dir_fd=proc)
        with os.fdopen(fd, "rb") as environ:
            if os.fsencode(marker) not in environ.read().split(b"\0"):
                sys.exit(1)
    if pidfd is not None:
        try:
            signal.pidfd_send_signal(pidfd, sig)
            sys.exit(0)
        except OSError as error:
            if error.errno != errno.ENOSYS:
                raise
    # A pinned proc directory stops resolving stat if the task exits.
    # On older kernels, recheck it immediately before the numeric syscall.
    if not matches(proc):
        sys.exit(1)
    os.kill(pid, sig)
except (OSError, IndexError, ValueError, AttributeError):
    sys.exit(1)
' "$@"
}

proc_group_members() {
  local group="$1" start="$2" marker="$3" signal="${4:-}"
  local entry pid member_start proc_group proc_start proc_state failed=0 found=0
  [[ "$group" =~ ^([2-9]|[1-9][0-9]+)$ && "$start" =~ ^[0-9]+$ && -n "$marker" ]] || return 1
  for entry in /proc/[0-9]*; do
    pid="${entry##*/}"
    proc_identity "$pid" && [[ "$proc_group" == "$group" && "$proc_state" != Z && "$proc_state" != X ]] &&
      (( 10#$proc_start >= 10#$start )) || continue
    member_start="$proc_start"
    # The marker is placed in the initial environment of the launched command.
    # Inheritance preserves provenance when the kernel reparents a survivor.
    grep -zFxq -- "$marker" "$entry/environ" 2>/dev/null || continue
    proc_identity "$pid" && [[ "$proc_group" == "$group" && "$proc_start" == "$member_start" && "$proc_state" != Z && "$proc_state" != X ]] || continue
    [[ -n "$signal" ]] || return 0
    found=1
    if ! proc_send_signal "$pid" "$member_start" "$group" "$marker" "$signal" &&
      proc_identity "$pid" && [[ "$proc_group" == "$group" && "$proc_start" == "$member_start" &&
        "$proc_state" != Z && "$proc_state" != X ]]; then
      failed=1
    fi
  done
  # Rescan even if delivery raced with exit or was temporarily denied.
  [[ "$signal" != KILL || "$found" == 0 ]] || return 2
  [[ -n "$signal" && "$failed" -eq 0 ]]
}

# A live leader must belong to this run before any member is signalled.
# Signal marked members individually, including when the leader has exited.
proc_signal_marked_group() {
  local pid="$1" start="$2" group="$3" marker="$4" signal="${5:-}"
  local status=0
  proc_group_leader_matches "$pid" "$start" "$group" "$marker" || status=$?
  case "$status" in
    0) [[ -n "$signal" ]] || return 0 ;;
    2|3) ;; # Check surviving members below.
    *) return 1 ;;
  esac
  if [[ "$signal" == KILL ]]; then
    local scan_status empty=0 deadline=$((EPOCHSECONDS + 3))
    while :; do
      scan_status=0
      proc_group_members "$group" "$start" "$marker" "$signal" || scan_status=$?
      case "$scan_status" in
        0) (( empty )) && return 0; empty=1 ;;
        2) empty=0 ;; # A member could have forked after the glob expanded.
        *) return 1 ;;
      esac
      (( EPOCHSECONDS < deadline )) || return 1
      sleep 0.01
      status=0
      proc_group_leader_matches "$pid" "$start" "$group" "$marker" || status=$?
      [[ "$status" != 1 ]] || return 1
    done
  fi
  proc_group_members "$group" "$start" "$marker" "$signal" && return 0
  # A matching live stat is sufficient to retain a journal during inspection.
  [[ -z "$signal" && "$status" == 3 ]]
}
