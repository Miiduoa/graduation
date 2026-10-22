#!/usr/bin/env bash
# 共用函式。密鑰只從環境變數或檔案讀，絕不印出連線字串或密碼。
set -euo pipefail

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

# 只回傳 host，不帶帳密。失敗時回空字串。
url_host() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlparse
raw = sys.argv[1]
try:
    parsed = urlparse(raw)
except Exception:
    sys.exit(0)
host = parsed.hostname or ""
print(host)
PY
}

url_query_param() {
  python3 - "$1" "$2" <<'PY'
import sys
from urllib.parse import parse_qs, urlparse
raw, key = sys.argv[1], sys.argv[2]
try:
    parsed = urlparse(raw)
except Exception:
    sys.exit(0)
print((parse_qs(parsed.query).get(key) or [""])[0])
PY
}

is_local_host() {
  case "$1" in
    localhost | 127.0.0.1 | ::1 | '') return 0 ;;
    *) return 1 ;;
  esac
}

is_pooler_host() {
  case "$1" in
    *-pooler.* | *-pooler | *pooler.*) return 0 ;;
    *) return 1 ;;
  esac
}

require_sslmode() {
  local url="$1"
  local label="$2"
  local host
  host="$(url_host "$url")"
  if is_local_host "$host"; then
    return 0
  fi
  local mode
  mode="$(url_query_param "$url" sslmode)"
  [[ "$mode" == "require" || "$mode" == "verify-full" || "$mode" == "verify-ca" ]] \
    || die "$label 必須帶 sslmode=require（或更嚴的 verify-full／verify-ca）"
}

require_direct_host() {
  local url="$1"
  local label="$2"
  local host
  host="$(url_host "$url")"
  if is_pooler_host "$host"; then
    die "$label 的 host（$host）是 Neon pooler。pg_dump／nuni-api／node-pg 請用直連（不要含 -pooler）"
  fi
}

redacted_host() {
  local host
  host="$(url_host "$1")"
  if [[ -z "$host" ]]; then
    printf '(無法解析的連線字串)'
  else
    printf '%s' "$host"
  fi
}

psql_url() {
  local url="$1"
  shift
  # --no-psqlrc 避免本機設定把密鑰寫進歷史
  PSQL_HISTORY=/dev/null psql --no-psqlrc --dbname="$url" --set ON_ERROR_STOP=1 "$@"
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
