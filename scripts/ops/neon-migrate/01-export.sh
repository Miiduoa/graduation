#!/usr/bin/env bash
# 從來源庫匯出 custom dump + 盤點檔。不印密鑰。
# 用法：SOURCE_DATABASE_URL=... DUMP_DIR=... ./01-export.sh
# 或 SOURCE_DATABASE_URL_FILE=/path/outside/repo/old.url
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh

need_cmd psql
need_cmd pg_dump
need_cmd python3
require_pg18

SOURCE_DATABASE_URL="$(read_url SOURCE_DATABASE_URL)"
require_sslmode "$SOURCE_DATABASE_URL" SOURCE_DATABASE_URL

DUMP_DIR="${DUMP_DIR:?請設 DUMP_DIR}"
mkdir_private "$DUMP_DIR"
mkdir_private "$DUMP_DIR/inventory"

printf '來源 host：%s\n' "$(redacted_host "$SOURCE_DATABASE_URL")"
printf '寫入目錄：%s\n' "$DUMP_DIR"

# 1) 資料 + schema。不帶 owner／ACL：Neon 內建角色不能在新 project 重建。
#    權限另存 inventory，還原後由 02-import.sh 只套用應用程式角色。
#    custom 格式會帶 sequence 目前值、extension、函式、觸發器。
pg_dump \
  --dbname="$SOURCE_DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --encoding=UTF8 \
  --no-owner \
  --no-acl \
  --verbose \
  --file="$DUMP_DIR/neondb.dump" \
  2>"$DUMP_DIR/pg_dump.log"

# 2) 純文字 schema 備份（不含資料、不含密鑰），方便人工 diff。
pg_dump \
  --dbname="$SOURCE_DATABASE_URL" \
  --format=plain \
  --schema-only \
  --no-owner \
  --no-acl \
  --encoding=UTF8 \
  --file="$DUMP_DIR/schema.sql"

# 3) 盤點：角色、權限、extension、sequence、migration、列數。
psql_url "$SOURCE_DATABASE_URL" \
  --file ./capture-inventory.sql \
  --output "$DUMP_DIR/inventory/raw.txt"

# 精確列數另存 TSV，給 03-verify.sh 比對。
psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c "
SELECT n.nspname, c.relname, (
  xpath('row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, ''))
)[1]::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY n.nspname, c.relname
" >"$DUMP_DIR/inventory/table_counts.tsv"

psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c \
  "SELECT id || E'\t' || checksum || E'\t' || applied_at::text FROM public.schema_migrations ORDER BY id" \
  >"$DUMP_DIR/inventory/schema_migrations.tsv" || true

psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c \
  "SELECT schemaname, sequencename, last_value::text FROM pg_sequences ORDER BY 1,2" \
  >"$DUMP_DIR/inventory/sequences.tsv"

psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c \
  "SELECT extname || E'\t' || extversion FROM pg_extension ORDER BY 1" \
  >"$DUMP_DIR/inventory/extensions.tsv"

psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c \
  "SELECT rolname FROM pg_roles ORDER BY 1" \
  >"$DUMP_DIR/inventory/roles.txt"

# 應用程式 GRANT（排除 Neon／系統角色）。還原後可重放。
psql_url "$SOURCE_DATABASE_URL" -At -c "
SELECT format(
  'GRANT %s ON TABLE %I.%I TO %I;',
  string_agg(privilege_type, ', '),
  table_schema, table_name, grantee
)
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee NOT IN ('PUBLIC','postgres','cloud_admin','neon_superuser','neon_admin','neon_auth','neon_authenticator')
  AND grantee !~ '^pg_'
GROUP BY table_schema, table_name, grantee
ORDER BY 1;
" >"$DUMP_DIR/inventory/grants.sql"

psql_url "$SOURCE_DATABASE_URL" -At -c "
SELECT format(
  'GRANT %s ON FUNCTION %I.%I TO %I;',
  string_agg(privilege_type, ', '),
  routine_schema, routine_name, grantee
)
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND grantee NOT IN ('PUBLIC','postgres','cloud_admin','neon_superuser','neon_admin','neon_auth','neon_authenticator')
  AND grantee !~ '^pg_'
GROUP BY routine_schema, routine_name, grantee
ORDER BY 1;
" >>"$DUMP_DIR/inventory/grants.sql"

python3 - "$DUMP_DIR" <<'PY'
import hashlib, os, pathlib, json, sys
dump_dir = pathlib.Path(sys.argv[1])
payload = {"files": {}}
for path in sorted(dump_dir.rglob("*")):
    if path.is_file():
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        rel = str(path.relative_to(dump_dir))
        payload["files"][rel] = {"sha256": digest, "bytes": path.stat().st_size}
(dump_dir / "manifest.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
PY

printf '匯出完成。dump 位元組：%s\n' "$(wc -c <"$DUMP_DIR/neondb.dump" | tr -d ' ')"
printf '表數量（public）：%s\n' "$(wc -l <"$DUMP_DIR/inventory/table_counts.tsv" | tr -d ' ')"
printf 'migration 列數：%s\n' "$(wc -l <"$DUMP_DIR/inventory/schema_migrations.tsv" | tr -d ' ')"
printf 'sequence 列數：%s\n' "$(wc -l <"$DUMP_DIR/inventory/sequences.tsv" | tr -d ' ')"
printf '請核對 pg_dump.log 沒有 ERROR 再進行匯入。\n'
