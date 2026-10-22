#!/usr/bin/env bash
# 核對來源與目標：表數、每張表列數、schema_migrations、sequence、函式／觸發器、應用程式角色權限。
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
require_direct_host "$DEST_DATABASE_URL" DEST_DATABASE_URL
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
    >"$WORKDIR/dest_schema_migrations.tsv"

  psql_url "$DEST_DATABASE_URL" -At -F $'\t' -c \
    "SELECT schemaname, sequencename, COALESCE(last_value::text, '') FROM pg_sequences ORDER BY 1,2" \
    >"$WORKDIR/dest_sequences.tsv"

  psql_url "$DEST_DATABASE_URL" -At -F $'\t' -c \
    "SELECT extname, extversion FROM pg_extension ORDER BY 1" \
    >"$WORKDIR/dest_extensions.tsv"

  psql_url "$DEST_DATABASE_URL" -At -F $'\t' -c "
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
 ORDER BY 1,2,3
" >"$WORKDIR/dest_functions.tsv"

  psql_url "$DEST_DATABASE_URL" -At -F $'\t' -c "
SELECT n.nspname, c.relname, t.tgname
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal
 ORDER BY 1,2,3
" >"$WORKDIR/dest_triggers.tsv"

  psql_url "$DEST_DATABASE_URL" -At -F $'\t' -c "
SELECT n.nspname, c.relname, r.rolname, a.privilege_type
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN LATERAL aclexplode(c.relacl) a ON true
  JOIN pg_roles r ON r.oid = a.grantee
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r','p','v','m')
   AND c.relacl IS NOT NULL
   AND r.rolname NOT IN (
     'postgres','cloud_admin','neon_superuser','neon_admin',
     'neon_auth','neon_authenticator','neon_service'
   )
   AND r.rolname !~ '^pg_'
   AND a.grantee <> c.relowner
 ORDER BY 1,2,3,4
" >"$WORKDIR/dest_table_grants.tsv"

  psql_url "$DEST_DATABASE_URL" -At -F $'\t' -c "
SELECT rolname
  FROM pg_roles
 WHERE rolcanlogin
   AND rolname !~ '^pg_'
   AND rolname NOT IN (
     'postgres','cloud_admin','neon_superuser','neon_admin',
     'neon_auth','neon_authenticator','neon_service'
   )
 ORDER BY 1
" >"$WORKDIR/dest_login_roles.txt"
}

compare_tsv_set() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
label, src_path, dest_path = sys.argv[1], sys.argv[2], sys.argv[3]
def load(path):
    try:
        return [line for line in open(path, encoding="utf-8").read().splitlines() if line]
    except FileNotFoundError:
        return []
src, dest = load(src_path), load(dest_path)
print(f"{label} 來源={len(src)} 目標={len(dest)}")
if src != dest:
    print(f"{label} 不一致")
    print("  來源有、目標沒有：", sorted(set(src) - set(dest))[:20])
    print("  目標有、來源沒有：", sorted(set(dest) - set(src))[:20])
    sys.exit(1)
PY
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
text = "\n".join(lines) + ("\n" if lines else "")
open(out_path, "w", encoding="utf-8").write(text)
print(f"表數 來源={len(src)} 目標={len(dest)} 缺={len(missing)} 多={len(extra)} 列數不符={len(mismatch)}")
if lines:
    sys.stderr.write(text)
    sys.exit(1)
PY
}

capture_dest

if [[ "${COMPARE_INVENTORY:-}" == "yes" ]]; then
  [[ -f "$DUMP_DIR/inventory/table_counts.tsv" ]] || die "找不到 dump 盤點"
  [[ -s "$DUMP_DIR/inventory/schema_migrations.tsv" ]] || die "dump 盤點沒有 schema_migrations，拒絕核對"
  SRC_COUNTS="$DUMP_DIR/inventory/table_counts.tsv"
  SRC_MIGRATIONS="$DUMP_DIR/inventory/schema_migrations.tsv"
  SRC_SEQ="$DUMP_DIR/inventory/sequences.tsv"
  SRC_EXT="$DUMP_DIR/inventory/extensions.tsv"
  SRC_FUNCS="$DUMP_DIR/inventory/functions.tsv"
  SRC_TRIGGERS="$DUMP_DIR/inventory/triggers.tsv"
  SRC_GRANTS="$DUMP_DIR/inventory/table_grants.tsv"
  SRC_ROLES="$DUMP_DIR/inventory/login_roles.txt"
else
  SOURCE_DATABASE_URL="$(read_url SOURCE_DATABASE_URL)"
  require_sslmode "$SOURCE_DATABASE_URL" SOURCE_DATABASE_URL
  require_direct_host "$SOURCE_DATABASE_URL" SOURCE_DATABASE_URL
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
    >"$WORKDIR/src_schema_migrations.tsv"
  psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c \
    "SELECT schemaname, sequencename, COALESCE(last_value::text, '') FROM pg_sequences ORDER BY 1,2" \
    >"$WORKDIR/src_sequences.tsv"
  psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c \
    "SELECT extname, extversion FROM pg_extension ORDER BY 1" \
    >"$WORKDIR/src_extensions.tsv"
  psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c "
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
 ORDER BY 1,2,3
" >"$WORKDIR/src_functions.tsv"
  psql_url "$SOURCE_DATABASE_URL" -At -F $'\t' -c "
SELECT n.nspname, c.relname, t.tgname
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal
 ORDER BY 1,2,3
" >"$WORKDIR/src_triggers.tsv"
  SRC_COUNTS="$WORKDIR/src_table_counts.tsv"
  SRC_MIGRATIONS="$WORKDIR/src_schema_migrations.tsv"
  SRC_SEQ="$WORKDIR/src_sequences.tsv"
  SRC_EXT="$WORKDIR/src_extensions.tsv"
  SRC_FUNCS="$WORKDIR/src_functions.tsv"
  SRC_TRIGGERS="$WORKDIR/src_triggers.tsv"
  SRC_GRANTS="$DUMP_DIR/inventory/table_grants.tsv"
  SRC_ROLES="$DUMP_DIR/inventory/login_roles.txt"
fi

printf '目標 host：%s\n' "$(redacted_host "$DEST_DATABASE_URL")"
compare_counts "$SRC_COUNTS" "$WORKDIR/dest_table_counts.tsv"

python3 - "$SRC_MIGRATIONS" "$WORKDIR/dest_schema_migrations.tsv" <<'PY'
import sys
def load(path):
    rows = []
    text = open(path, encoding="utf-8").read().splitlines()
    for line in text:
        if not line:
            continue
        parts = line.split("\t")
        rows.append((parts[0], parts[1] if len(parts) > 1 else ""))
    return rows
src, dest = load(sys.argv[1]), load(sys.argv[2])
print(f"schema_migrations 來源={len(src)} 目標={len(dest)}")
if not src:
    print("來源沒有 schema_migrations，拒絕通過（API 啟動會核對 checksum）")
    sys.exit(1)
if src != dest:
    print("migration 紀錄不一致：")
    print("  來源", src)
    print("  目標", dest)
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

compare_tsv_set extensions "$SRC_EXT" "$WORKDIR/dest_extensions.tsv"
compare_tsv_set functions "$SRC_FUNCS" "$WORKDIR/dest_functions.tsv"
compare_tsv_set triggers "$SRC_TRIGGERS" "$WORKDIR/dest_triggers.tsv"

python3 - "$SRC_GRANTS" "$WORKDIR/dest_table_grants.tsv" <<'PY'
import sys
def load(path):
    try:
        return set(line for line in open(path, encoding="utf-8").read().splitlines() if line)
    except FileNotFoundError:
        return set()
src, dest = load(sys.argv[1]), load(sys.argv[2])
missing = sorted(src - dest)
print(f"table GRANT 來源={len(src)} 目標={len(dest)} 目標缺少={len(missing)}")
if missing:
    print("目標缺少的應用程式 GRANT（前 20 條）：")
    for line in missing[:20]:
        print(" ", line)
    sys.exit(1)
PY

python3 - "$SRC_ROLES" "$WORKDIR/dest_login_roles.txt" <<'PY'
import os, sys
def load(path):
    try:
        return [line for line in open(path, encoding="utf-8").read().splitlines() if line]
    except FileNotFoundError:
        return []
src, dest = load(sys.argv[1]), load(sys.argv[2])
missing = sorted(set(src) - set(dest))
print(f"LOGIN 角色 來源={len(src)} 目標={len(dest)} 目標缺少={len(missing)}")
if missing:
    print("目標缺少的 LOGIN 角色：", ", ".join(missing))
    if os.environ.get("IGNORE_MISSING_ROLES") == "yes":
        print("IGNORE_MISSING_ROLES=yes，只警告。")
    else:
        print("這些角色的 GRANT 可能已被跳過。在新 project 建好後重跑匯入，或設 IGNORE_MISSING_ROLES=yes。")
        sys.exit(1)
PY

# 模擬 nuni-api database-role-readiness.ts：目前連線角色對 public 表／函式要有權限。
# 來源在封存的 nuni-prod（database-role-readiness.ts、migrate.ts），本倉庫對得上的
# 是 has_table_privilege（scripts/verify-nuni-import-api.mjs）與 function privileges（composed/README.md）。
ready="$(psql_url "$DEST_DATABASE_URL" -At -F $'\t' -c "
SELECT
  current_user,
  count(*) FILTER (WHERE NOT has_table_privilege(format('%I.%I', n.nspname, c.relname), 'SELECT')) AS missing_select,
  count(*) FILTER (WHERE NOT has_table_privilege(format('%I.%I', n.nspname, c.relname), 'INSERT')) AS missing_insert,
  count(*) AS tables
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';
")"
printf 'role readiness（current_user / 缺 SELECT / 缺 INSERT / 表數）：%s\n' "$ready"
missing_select="$(printf '%s' "$ready" | cut -f2)"
if [[ "$missing_select" != "0" ]]; then
  die "目前連線角色對 public 表缺少 SELECT。nuni-api 啟動的 has_table_privilege 檢查會失敗。"
fi

fn_missing="$(psql_url "$DEST_DATABASE_URL" -At -c "
SELECT count(*)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prokind IN ('f','p')
   AND NOT has_function_privilege(p.oid, 'EXECUTE');
")"
printf 'public 函式缺 EXECUTE：%s\n' "$fn_missing"
if [[ "$fn_missing" != "0" ]]; then
  die "目前連線角色對 public 函式缺少 EXECUTE。nuni-api 啟動的 function privilege 檢查會失敗。"
fi

printf '核對通過。\n'
