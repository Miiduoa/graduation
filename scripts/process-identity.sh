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

proc_group_leader_matches() {
  local group="$1" start="$2" marker="$3"
  local proc_group proc_start proc_state
  [[ "$group" != 1 && -n "$marker" ]] && proc_identity "$group" &&
    [[ "$proc_group" == "$group" && "$proc_start" == "$start" && "$proc_state" != Z && "$proc_state" != X ]] &&
    grep -zFxq -- "$marker" "/proc/$group/environ" 2>/dev/null &&
    proc_identity "$group" && [[ "$proc_group" == "$group" && "$proc_start" == "$start" ]]
}

proc_group_members() {
  local group="$1" start="$2" marker="$3" signal="${4:-}"
  local entry pid member_start proc_group proc_start proc_state
  [[ "$group" =~ ^([2-9]|[1-9][0-9]+)$ && "$start" =~ ^[0-9]+$ && -n "$marker" ]] || return 1
  for entry in /proc/[0-9]*; do
    pid="${entry##*/}"
    proc_identity "$pid" && [[ "$proc_group" == "$group" && "$proc_state" != Z && "$proc_state" != X ]] &&
      (( 10#$proc_start >= 10#$start )) || continue
    member_start="$proc_start"
    # The marker is placed in the initial environment of the launched command.
    # Inheritance preserves provenance when the kernel reparents a survivor.
    grep -zFxq -- "$marker" "$entry/environ" 2>/dev/null || continue
    proc_identity "$pid" && [[ "$proc_group" == "$group" && "$proc_start" == "$member_start" ]] || continue
    [[ -n "$signal" ]] || return 0
    kill "-$signal" -- "$pid" 2>/dev/null || true
  done
  [[ -n "$signal" ]]
}

# A live leader must belong to this run before any member is signalled.
# Signal marked members individually, including when the leader has exited.
proc_signal_marked_group() {
  local group="$1" start="$2" marker="$3" signal="${4:-}"
  local proc_group proc_start proc_state
  if proc_identity "$group"; then
    [[ "$proc_group" == "$group" && "$proc_start" == "$start" ]] || return 1
    if [[ "$proc_state" != Z && "$proc_state" != X ]]; then
      proc_group_leader_matches "$group" "$start" "$marker" || return 1
      [[ -n "$signal" ]] || return 0
    fi
  fi
  proc_group_members "$group" "$start" "$marker" "$signal"
}
