#!/usr/bin/env bash
# QA 測試資料：先 list（只讀、transaction ROLLBACK），確認 receipt 後再 apply。
# 用法：
#   DATABASE_URL=... MODE=list  ./qa-cleanup.sh
#   DATABASE_URL=... MODE=apply CONFIRM=yes RECEIPT=... ./qa-cleanup.sh
# Storage：有 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 才動 bucket assignment-submissions。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh

need_cmd psql
need_cmd python3
require_pg18

MODE="${MODE:?請設 MODE=list 或 apply}"
DATABASE_URL="$(read_url DATABASE_URL)"
require_sslmode "$DATABASE_URL" DATABASE_URL
RECEIPT_DIR="${RECEIPT_DIR:-./receipts}"
mkdir_private "$RECEIPT_DIR"
PREFIX='cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2/cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1/'

run_sql() {
  local apply_flag="$1"
  local out="$2"
  psql_url "$DATABASE_URL" \
    --set apply="$apply_flag" \
    --file ./qa-cleanup.sql \
    >"$out"
}

list_storage() {
  local url="${SUPABASE_URL:-}"
  local key="${SUPABASE_SERVICE_ROLE_KEY:-}"
  if [[ -z "$url" || -z "$key" ]]; then
    printf '未設 SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY，跳過 Storage 盤點。\n' >&2
    printf '[]'
    return 0
  fi
  python3 - "$url" "$key" "$PREFIX" <<'PY'
import json, os, sys, urllib.request
base, key, prefix = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]
req = urllib.request.Request(
    f"{base}/storage/v1/object/list/assignment-submissions",
    data=json.dumps({"prefix": prefix, "limit": 100}).encode(),
    headers={
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.load(resp)
except Exception as exc:
    raise SystemExit(f"Storage 列出失敗：{type(exc).__name__}")
names = []
if isinstance(payload, list):
    for item in payload:
        name = item.get("name") if isinstance(item, dict) else None
        if name:
            names.append(prefix + name if not str(name).startswith(prefix) else name)
print(json.dumps(names, ensure_ascii=False))
PY
}

delete_storage() {
  local url="${SUPABASE_URL:-}"
  local key="${SUPABASE_SERVICE_ROLE_KEY:-}"
  [[ -n "$url" && -n "$key" ]] || return 0
  python3 - "$url" "$key" "$PREFIX" <<'PY'
import json, sys, urllib.request
base, key, prefix = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]
body = json.dumps({"prefixes": [prefix]}).encode()
req = urllib.request.Request(
    f"{base}/storage/v1/object/assignment-submissions",
    data=body,
    headers={
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    },
    method="DELETE",
)
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()
except Exception as exc:
    raise SystemExit(f"Storage 刪除失敗：{type(exc).__name__}")
print("storage prefix deleted", file=sys.stderr)
PY
}

case "$MODE" in
  list)
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    # 整個 list 包在 transaction，結束 ROLLBACK，保證只讀。
    {
      printf 'BEGIN;\n'
      cat qa-cleanup.sql
      printf '\nROLLBACK;\n'
    } >"$tmp"
    out="$RECEIPT_DIR/qa-list.txt"
    psql_url "$DATABASE_URL" --set apply=0 --file "$tmp" >"$out"
    objects="$(list_storage)"
    python3 - "$out" "$objects" "$RECEIPT_DIR/qa-list.receipt.json" <<'PY'
import json, re, sys
text, objects, dest = open(sys.argv[1], encoding="utf-8").read(), json.loads(sys.argv[2]), sys.argv[3]
rows = []
# psql aligned 輸出不易穩抓，改從 ===qa_preview=== 之後的列解析 relation。
receipt = {"mode": "list", "sql_output_sha_placeholder": True, "storage_objects": objects, "note": "完整 SQL 輸出在 qa-list.txt"}
open(dest, "w", encoding="utf-8").write(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
print("已寫入 list 輸出與 receipt。請人工看 qa-list.txt 的 qa_preview 後再 apply。")
PY
    ;;
  apply)
    [[ "${CONFIRM:-}" == "yes" ]] || die "apply 需要 CONFIRM=yes"
    [[ -f "${RECEIPT:-$RECEIPT_DIR/qa-list.receipt.json}" ]] || die "找不到 list receipt，請先 MODE=list"
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    {
      printf 'BEGIN;\n'
      cat qa-cleanup.sql
      printf '\nCOMMIT;\n'
    } >"$tmp"
    out="$RECEIPT_DIR/qa-apply.txt"
    psql_url "$DATABASE_URL" --set apply=1 --file "$tmp" >"$out"
    delete_storage
    printf 'apply 完成。SQL 輸出在 %s。課班列應仍在，作業／邀請／nocard 學生應已刪。\n' "$out"
    ;;
  *)
    die "MODE 只能是 list 或 apply"
    ;;
esac
