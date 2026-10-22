#!/usr/bin/env bash
# 從 stdin 讀 KEY=VALUE，寫入 Fly secrets，不印密鑰。
# 預設只 --stage，不重啟機器。真正套用請再設 APPLY_SECRETS=yes。
# 用法：
#   printf 'DATABASE_URL=%s\n' "$NEW_API_URL" | APP=nuni-api ./04-switch-fly-secrets.sh
#   printf 'ASSIGNMENT_FILE_DATABASE_URL=%s\n' "$NEW_WEB_URL" | APP=nuni-web ./04-switch-fly-secrets.sh
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh

APP="${APP:?請設 APP=nuni-api 或 nuni-web}"
case "$APP" in
  nuni-api | nuni-web) ;;
  *) die "APP 只能是 nuni-api 或 nuni-web" ;;
esac

STAGE="${STAGE:-yes}"
APPLY_SECRETS="${APPLY_SECRETS:-no}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
umask 077
cat >"$tmp"
chmod 600 "$tmp"
[[ -s "$tmp" ]] || die "stdin 沒有 KEY=VALUE"

python3 - "$tmp" "$APP" <<'PY'
import sys, re
from urllib.parse import parse_qs, urlparse
path, app = sys.argv[1], sys.argv[2]
required = {
    "nuni-api": {"DATABASE_URL"},
    "nuni-web": {"ASSIGNMENT_FILE_DATABASE_URL"},
}[app]
keys = set()
for raw in open(path, encoding="utf-8"):
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    if "=" not in line:
        raise SystemExit(f"不是 KEY=VALUE：已省略內容")
    key, value = line.split("=", 1)
    keys.add(key)
    if "URL" in key and value:
        parsed = urlparse(value)
        host = parsed.hostname or ""
        local = host in {"localhost", "127.0.0.1", "::1"}
        sslmode = (parse_qs(parsed.query).get("sslmode") or [""])[0]
        if not local and sslmode not in {"require", "verify-full", "verify-ca"}:
            raise SystemExit(f"{key} 必須帶 sslmode=require")
        if parsed.password and parsed.password in {"changeme", "password", "secret"}:
            raise SystemExit(f"{key} 看起來像預設密碼，拒絕")
missing = required - keys
if missing:
    raise SystemExit("缺少必要密鑰：" + ", ".join(sorted(missing)))
print("stdin 通過檢查；鍵名：" + ", ".join(sorted(keys)))
PY

if [[ "$APPLY_SECRETS" != "yes" ]]; then
  printf '乾跑：將對 app=%s 執行 flyctl secrets import%s，stdin 有 %s 行。設 APPLY_SECRETS=yes 才會真的送出。\n' \
    "$APP" "$([[ "$STAGE" == "yes" ]] && printf ' --stage' || true)" "$(grep -c '=' "$tmp" || true)"
  exit 0
fi

need_cmd flyctl
args=(secrets import --app "$APP")
if [[ "$STAGE" == "yes" ]]; then
  args+=(--stage)
fi
# flyctl 會把 stdin 當密鑰檔。不要加 --verbose。
flyctl "${args[@]}" <"$tmp"

printf '已寫入 %s 的 secrets%s。密鑰內容未印出。\n' "$APP" "$([[ "$STAGE" == "yes" ]] && printf '（已 stage，尚未重啟）' || true)"
printf '下一步：確認機器仍暫停寫入，再依計畫啟動 nuni-api，然後才是 nuni-web。\n'
