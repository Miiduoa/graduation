#!/usr/bin/env bash
# 把新庫在 CUTOVER_TS 之後新增／更新的列，以 upsert 方式補回舊庫。
# 只處理 public 裡有時間欄且有主鍵的表。沒有時間欄的表會列出來，要人工判斷。
# 預設略過 schema_migrations（避免把 checksum 寫回舊庫害舊映像起不來）。
# 用法：NEW_DATABASE_URL=... OLD_DATABASE_URL=... CUTOVER_TS='2026-10-22T16:00:00+08:00' ./06-replay-delta.sh
# 預設乾跑。APPLY_DELTA=yes 才寫入舊庫，且必須先有同一 CUTOVER_TS 的乾跑報告。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh

need_cmd psql
need_cmd python3
require_pg18

NEW_DATABASE_URL="$(read_url NEW_DATABASE_URL)"
OLD_DATABASE_URL="$(read_url OLD_DATABASE_URL)"
require_sslmode "$NEW_DATABASE_URL" NEW_DATABASE_URL
require_sslmode "$OLD_DATABASE_URL" OLD_DATABASE_URL
require_direct_host "$NEW_DATABASE_URL" NEW_DATABASE_URL
require_direct_host "$OLD_DATABASE_URL" OLD_DATABASE_URL
CUTOVER_TS="${CUTOVER_TS:?請設 CUTOVER_TS（ISO-8601）}"
APPLY_DELTA="${APPLY_DELTA:-no}"
WORKDIR="${WORKDIR:?請設 WORKDIR}"
mkdir_private "$WORKDIR"

printf '新庫 host：%s\n舊庫 host：%s\nCUTOVER_TS=%s\n' \
  "$(redacted_host "$NEW_DATABASE_URL")" \
  "$(redacted_host "$OLD_DATABASE_URL")" \
  "$CUTOVER_TS"

[[ "$APPLY_DELTA" == "yes" || "$APPLY_DELTA" == "no" ]] || die "APPLY_DELTA 只能是 yes 或 no"
if [[ "$APPLY_DELTA" == "yes" && "${CONFIRM_WRITES_STOPPED:-}" != "yes" ]]; then
  die "先停止 nuni-api／nuni-web 寫入，再設 CONFIRM_WRITES_STOPPED=yes"
fi
NEW_DATABASE_URL="$NEW_DATABASE_URL" OLD_DATABASE_URL="$OLD_DATABASE_URL" CUTOVER_TS="$CUTOVER_TS" \
  WORKDIR="$WORKDIR" APPLY_DELTA="$APPLY_DELTA" python3 ./replay_delta.py
