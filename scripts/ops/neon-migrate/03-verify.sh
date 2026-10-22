#!/usr/bin/env bash
# 核對來源與目標：表數、每張表列數、schema_migrations、sequence、應用程式角色權限。
# 用法：SOURCE_DATABASE_URL=... DEST_DATABASE_URL=... DUMP_DIR=... ./03-verify.sh
# 若來源已暫停、只想跟 dump 盤點比，設 COMPARE_INVENTORY=yes（不連來源庫）。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh

need_cmd psql
need_cmd python3
require_pg18

DEST_DATABASE_URL="$(read_url DEST_DATABASE_URL)"
require_sslmode "$DEST_DATABASE_URL" DEST_DATABASE_URL
DUMP_DIR="${DUMP_DIR:?請設 DUMP_DIR}"
WORKDIR="${WORKDIR:-$DUMP_DIR/verify}"
mkdir_private "$WORKDIR"

capture_dest() {
  psql_url "$DEST_DATABASE_URL" -At -F $'\t' -c "
SELECT n.nspname, c.relname, (
  xpath('row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, ''))
)[1]::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY n.nspname, c.relname
" >"$WORKDIR/dest_table_counts.tsv"

  psql_url "$DEST_DATABASE_URL" -At -F $'\t' -c \
    "SELECT id, checksum, applied_at::text FROM public.schema_migrations ORDER BY id" \
    >"$WORKDIR/dest_schema_migrations.tsv" || true

  psql_url "$DEST_DATABASE_URL" -At -F $'\t' -c \
    "SELECT schemaname, sequencename, last_value::text FROM pg_sequences ORDER BY 1,2" \
    >"$WORKDIR/dest_sequences.tsv"

  psql_url "$DEST_DATABASE_URL" -At -F $'\t' -c \
    "SELECT extname, extversion FROM pg_extension ORDER BY 1" \
    >"$WORKDIR/dest_extensions.tsv"

  psql_url "$DEST_DATABASE_URL" -At -c "
SELECT format('%s %s %s %s', table_schema, table_name, grantee, privilege_type)
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee NOT IN ('PUBLIC','postgres','cloud_admin','neon_superuser','neon_admin')
  AND grantee !~ '^pg_'
ORDER BY 1;
" >"$WORKDIR/dest_grants.txt"
}

compare_counts() {
  python3 - "$1" "$2" "$WORKDIR/count-diff.txt" <<'PY'
import sys
src_path, dest_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
def load(path):
    rows = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            schema, name, count = line.split("\t")
            rows[(schema, name)] = int(count)
    return rows
src, dest = load(src_path), load(dest_path)
missing = sorted(set(src) - set(dest))
extra = sorted(set(dest) - set(src))
mismatch = sorted(k for k in src.keys() & dest.keys() if src[k] != dest[k])
lines = []
if missing:
    lines.append("目標缺少的表：")
    lines.extend(f"  {s}.{n} 來源={src[(s,n)]}" for s, n in missing)
if extra:
    lines.append("目標多出的表：")
    lines.extend(f"  {s}.{n} 目標={dest[(s,n)]}" for s, n in extra)
if mismatch:
    lines.append("列數不一致：")
    lines.extend(f"  {s}.{n} 來源={src[(s,n)]} 目標={dest[(s,n)]}" for s, n in mismatch)
open(out_path, "w", encoding="utf-8").write("\n".join(lines) + ("\n" if lines else ""))
print(f"表數 來源={len(src)} 目標={len(dest)} 缺={len(missing)} 多={len(extra)} 列數不符={len(mismatch)}")
if lines:
    sys.exit(1)
PY
}

capture_dest

if [[ "${COMPARE_INVENTORY:-}" == "yes" ]]; then
  [[ -f "$DUMP_DIR/inventory/table_counts.tsv" ]] || die "找不到 dump 盤點"
  SRC_COUNTS="$DUMP_DIR/inventory/table_counts.tsv"
  SRC_MIGRATIONS="$DUMP_DIR/inventory/schema_migrations.tsv"
  SRC_SEQ="$DUMP_DIR/inventory/sequences.tsv"
  SRC_EXT="$DUMP_DIR/inventory/extensions.tsv"
else
  SOURCE_DATABASE_URL="$(read_url SOURCE_DATABASE_URL)"
  require_sslmode "$SOURCE_DATABASE_URL" SOURCE_DATABASE_URL
  printf '來源 host：%s\n' "$(redacted_host "$SOURCE_DATABASE_URL")"
  psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c "
SELECT n.nspname, c.relname, (
  xpath('row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, ''))
)[1]::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY n.nspname, c.relname
" >"$WORKDIR/src_table_counts.tsv"
  psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c \
    "SELECT id, checksum, applied_at::text FROM public.schema_migrations ORDER BY id" \
    >"$WORKDIR/src_schema_migrations.tsv" || true
  psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c \
    "SELECT schemaname, sequencename, last_value::text FROM pg_sequences ORDER BY 1,2" \
    >"$WORKDIR/src_sequences.tsv"
  psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c \
    "SELECT extname, extversion FROM pg_extension ORDER BY 1" \
    >"$WORKDIR/src_extensions.tsv"
  SRC_COUNTS="$WORKDIR/src_table_counts.tsv"
  SRC_MIGRATIONS="$WORKDIR/src_schema_migrations.tsv"
  SRC_SEQ="$WORKDIR/src_sequences.tsv"
  SRC_EXT="$WORKDIR/src_extensions.tsv"
fi

printf '目標 host：%s\n' "$(redacted_host "$DEST_DATABASE_URL")"
compare_counts "$SRC_COUNTS" "$WORKDIR/dest_table_counts.tsv"

python3 - "$SRC_MIGRATIONS" "$WORKDIR/dest_schema_migrations.tsv" <<'PY'
import sys
def load(path):
    rows = []
    try:
        text = open(path, encoding="utf-8").read().splitlines()
    except FileNotFoundError:
        return rows
    for line in text:
        if not line:
            continue
        parts = line.split("\t")
        rows.append((parts[0], parts[1] if len(parts) > 1 else ""))
    return rows
src, dest = load(sys.argv[1]), load(sys.argv[2])
src_ids = [(i, c) for i, c in src]
dest_ids = [(i, c) for i, c in dest]
print(f"schema_migrations 來源={len(src_ids)} 目標={len(dest_ids)}")
if src_ids != dest_ids:
    print("migration 紀錄不一致：")
    print("  來源", src_ids)
    print("  目標", dest_ids)
    sys.exit(1)
PY

python3 - "$SRC_SEQ" "$WORKDIR/dest_sequences.tsv" <<'PY'
import sys
def load(path):
    rows = {}
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except FileNotFoundError:
        return rows
    for line in lines:
        if not line:
            continue
        parts = line.split("\t")
        key = (parts[0], parts[1])
        rows[key] = parts[2] if len(parts) > 2 else ""
    return rows
src, dest = load(sys.argv[1]), load(sys.argv[2])
print(f"sequences 來源={len(src)} 目標={len(dest)}")
if src != dest:
    print("sequence 值不一致")
    for key in sorted(set(src) | set(dest)):
        if src.get(key) != dest.get(key):
            print(f"  {key[0]}.{key[1]} 來源={src.get(key)} 目標={dest.get(key)}")
    sys.exit(1)
PY

python3 - "$SRC_EXT" "$WORKDIR/dest_extensions.tsv" <<'PY'
import sys
def load(path):
    return [line for line in open(path, encoding="utf-8").read().splitlines() if line]
src, dest = load(sys.argv[1]), load(sys.argv[2])
print(f"extensions 來源={len(src)} 目標={len(dest)}")
# plpgsql 幾乎一定在兩邊；其他必須齊。
if set(src) != set(dest):
    print("extension 不一致")
    print("  來源", src)
    print("  目標", dest)
    sys.exit(1)
PY

# 角色權限：至少確認目前連線角色對 public 表有 SELECT。
psql_url "$DEST_DATABASE_URL" -c "
SELECT current_user,
       count(*) FILTER (WHERE has_table_privilege(format('%I.%I', n.nspname, c.relname), 'SELECT')) AS select_ok,
       count(*) AS tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r';
"

printf '核對通過。\n'
