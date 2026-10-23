#!/usr/bin/env bash
# 共用函式。密鑰只從環境變數或檔案讀，絕不印出連線字串或密碼。
# Disable tracing before reading any credentials, including when invoked with bash -x.
set +x
set -euo pipefail
umask 077
NEON_MIGRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

NEON_SYSTEM_ROLES_REGEX='^(cloud_admin|neon_superuser|neon_admin|neon_auth|neon_authenticator|neon_service|pg_.*|postgres)$'

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "找不到命令：$1"
}

require_pg18() {
  local ver
  ver="$(psql --version 2>/dev/null || true)"
  [[ "$ver" == *' 18.'* ]] || die "需要 PostgreSQL 18 用戶端（目前：${ver:-無}）"
  ver="$(pg_dump --version 2>/dev/null || true)"
  [[ "$ver" == *' 18.'* ]] || die "需要 pg_dump 18（目前：${ver:-無}）"
  if command -v pg_restore >/dev/null 2>&1; then
    ver="$(pg_restore --version 2>/dev/null || true)"
    [[ "$ver" == *' 18.'* ]] || die "需要 pg_restore 18（目前：${ver:-無}）"
  fi
}

# 從環境變數或檔案讀取 URL。檔案路徑由 *_FILE 指定。
read_url() {
  local name="$1"
  local file_var="${name}_FILE"
  local value="${!name:-}"
  local file="${!file_var:-}"
  if [[ -n "$file" ]]; then
    [[ -r "$file" ]] || die "$file_var 指向的檔案讀不到"
    value="$(tr -d '\r' <"$file" | sed -n '1p')"
  fi
  [[ -n "$value" ]] || die "請設 $name 或 $file_var"
  printf '%s' "$value"
}

# Validate every URL before any PostgreSQL process starts. Credentials travel in
# environment variables, never process arguments or exception tracebacks.
url_host() {
  NEON_MIGRATION_DATABASE_URL="$1" python3 "$NEON_MIGRATE_DIR/safety.py" host
}

require_sslmode() {
  NEON_MIGRATION_DATABASE_URL="$1" python3 "$NEON_MIGRATE_DIR/safety.py" validate
}

require_direct_host() {
  require_sslmode "$1" "$2"
}

redacted_host() {
  url_host "$1"
}

postgres_url() {
  local url="$1"
  shift
  NEON_MIGRATION_DATABASE_URL="$url" python3 "$NEON_MIGRATE_DIR/safety.py" pg "$@"
}

psql_url() {
  local url="$1"
  shift
  postgres_url "$url" psql --no-psqlrc --set ON_ERROR_STOP=1 "$@"
}

mkdir_private() {
  mkdir -p "$1"
  chmod 700 "$1"
}

write_private() {
  local path="$1"
  umask 077
  cat >"$path"
  chmod 600 "$path"
}

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()[:-1] if False else sys.stdin.read().rstrip("\n")))' <<<"$1"
}
