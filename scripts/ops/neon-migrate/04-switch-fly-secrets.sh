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
  *) die "APP 只能是 nuni-api 或 nuni-web，避免寫到錯的 Fly app" ;;
esac

STAGE="${STAGE:-yes}"
APPLY_SECRETS="${APPLY_SECRETS:-no}"

[[ "$STAGE" == "yes" || "$STAGE" == "no" ]] || die "STAGE 只能是 yes 或 no"
[[ "$APPLY_SECRETS" == "yes" || "$APPLY_SECRETS" == "no" ]] || die "APPLY_SECRETS 只能是 yes 或 no"

if [[ "$STAGE" != "yes" && "${CONFIRM_RESTART:-}" != "yes" ]]; then
  die "STAGE=no 會讓 fly secrets import 建新 release 並可能啟動機器。若確定要重啟，設 CONFIRM_RESTART=yes"
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
umask 077
cat >"$tmp"
chmod 600 "$tmp"
[[ -s "$tmp" ]] || die "stdin 沒有 KEY=VALUE"

python3 ./safety.py fly "$tmp" "$APP" "$APPLY_SECRETS"

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
