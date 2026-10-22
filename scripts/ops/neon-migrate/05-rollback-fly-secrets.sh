#!/usr/bin/env bash
# 把 Fly secrets 換回舊庫。stdin 仍是 KEY=VALUE，不印密鑰。
# 切換後寫進新庫的資料，請先跑 06-replay-delta.sh 再執行本腳本。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh

APP="${APP:?請設 APP=nuni-api 或 nuni-web}"
APPLY_SECRETS="${APPLY_SECRETS:-no}"
STAGE="${STAGE:-yes}"

printf '回滾目標 app=%s。請確認已把新庫在 CUTOVER_TS 之後的列補回舊庫（06-replay-delta.sh 不重放 DELETE、略過 schema_migrations）。\n' "$APP"

# 與切換腳本同一條路，避免兩套行為。
APPLY_SECRETS="$APPLY_SECRETS" STAGE="$STAGE" APP="$APP" ./04-switch-fly-secrets.sh
