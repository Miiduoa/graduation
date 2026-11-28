#!/usr/bin/env bash
# Retry once only for the observed Maven Central dependency-download rate limit.
set -uo pipefail

if (( $# == 0 )); then
  echo 'Usage: run-gradle-with-rate-limit-retry.sh command [args...]' >&2
  exit 2
fi

log=$(mktemp) || exit 1
trap 'rm -f -- "$log"' EXIT

for attempt in 1 2; do
  "$@" 2>&1 | tee "$log"
  statuses=("${PIPESTATUS[@]}")
  status=${statuses[0]}
  if (( statuses[1] != 0 )); then
    exit "${statuses[1]}"
  fi
  if (( status == 0 )); then
    exit 0
  fi
  if (( attempt == 2 || status >= 128 )) ||
    ! grep -Eq "Could not (GET|HEAD) 'https://repo\.maven\.apache\.org/maven2/[^']+'.*Received status code 429" "$log" ||
    grep -Eq 'There were failing tests|> Task .* FAILED|Compilation failed' "$log"; then
    exit "$status"
  fi
  echo 'Maven Central returned HTTP 429; retrying once in 20 seconds.' >&2
  sleep 20 || exit "$status"
done
