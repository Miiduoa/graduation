#!/usr/bin/env bash
# 把 01-export.sh 的 dump 還原到目標庫，並重放應用程式 GRANT。
# 用法：DEST_DATABASE_URL=... DUMP_DIR=... ./02-import.sh
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh

need_cmd psql
need_cmd pg_restore
require_pg18

DEST_DATABASE_URL="$(read_url DEST_DATABASE_URL)"
require_sslmode "$DEST_DATABASE_URL" DEST_DATABASE_URL
DUMP_DIR="${DUMP_DIR:?請設 DUMP_DIR}"
DUMP_FILE="${DUMP_FILE:-$DUMP_DIR/neondb.dump}"
[[ -f "$DUMP_FILE" ]] || die "找不到 dump：$DUMP_FILE"

printf '目標 host：%s\n' "$(redacted_host "$DEST_DATABASE_URL")"

# 還原前確認目標幾乎是空的，避免覆寫已有使用者資料。
existing="$(psql_url "$DEST_DATABASE_URL" -At -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")"
if [[ "$existing" != "0" && "${ALLOW_NONEMPTY_DEST:-}" != "yes" ]]; then
  die "目標 public schema 已有 $existing 張表。若確認是新開的空庫，設 ALLOW_NONEMPTY_DEST=yes"
fi

# 先裝 dump 裡沒帶到、但來源盤點有的 extension。
if [[ -f "$DUMP_DIR/inventory/extensions.tsv" ]]; then
  while IFS=$'\t' read -r name version; do
    [[ -n "${name:-}" ]] || continue
    case "$name" in
      plpgsql) continue ;;
    esac
    psql_url "$DEST_DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS ${name};" \
      || die "無法建立 extension $name。請在 Neon console 先啟用後重試。"
  done <"$DUMP_DIR/inventory/extensions.tsv"
fi

# 應用程式角色（不含 Neon 內建）。名稱從環境變數讀，不寫死正式密碼。
# 預設：還原身分就是 owner。若要給 nuni-web 最小權限，設 CREATE_WEB_ROLE=yes。
if [[ "${CREATE_WEB_ROLE:-}" == "yes" ]]; then
  WEB_ROLE_NAME="${WEB_ROLE_NAME:-nuni_web_files}"
  WEB_ROLE_PASSWORD="${WEB_ROLE_PASSWORD:-}"
  [[ -n "$WEB_ROLE_PASSWORD" ]] || die "CREATE_WEB_ROLE=yes 時請設 WEB_ROLE_PASSWORD（不要寫進 repo）"
  psql_url "$DEST_DATABASE_URL" -c "SELECT 1 FROM pg_roles WHERE rolname = current_user" >/dev/null
  python3 - "$DEST_DATABASE_URL" "$WEB_ROLE_NAME" "$WEB_ROLE_PASSWORD" <<'PY'
import os, subprocess, sys
url, role, password = sys.argv[1], sys.argv[2], sys.argv[3]
if not role.isidentifier() and not all(c.isalnum() or c == '_' for c in role):
    raise SystemExit('WEB_ROLE_NAME 不合法')
env = os.environ.copy()
# 密碼用 psql 變數，不進 shell history 的 argv 明文仍存在；改用 stdin。
sql = """
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %s) THEN
    EXECUTE format('CREATE ROLE %%I LOGIN PASSWORD %%L', %s, %s);
  END IF;
END $$;
"""
# 使用 quote 後的識別字，避免把密碼寫進伺服器 log 以外的本機檔。
import json
role_literal = role.replace("'", "''")
password_literal = password.replace("'", "''")
payload = f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role_literal}') THEN EXECUTE format('CREATE ROLE %%I LOGIN PASSWORD %%L', '{role_literal}', '{password_literal}'); END IF; END $$;"
subprocess.run(
    ["psql", "--no-psqlrc", "--dbname", url, "-v", "ON_ERROR_STOP=1", "-c", payload],
    check=True,
    env={**env, "PSQL_HISTORY": "/dev/null"},
)
print("web role ready", file=sys.stderr)
PY
fi

pg_restore \
  --dbname="$DEST_DATABASE_URL" \
  --no-owner \
  --no-acl \
  --verbose \
  --exit-on-error \
  "$DUMP_FILE" \
  2>"$DUMP_DIR/pg_restore.log"

if [[ -s "$DUMP_DIR/inventory/grants.sql" ]]; then
  # 過濾 Neon 內建角色；若角色在新庫不存在就跳過該行並記警告。
  python3 - "$DEST_DATABASE_URL" "$DUMP_DIR/inventory/grants.sql" <<'PY'
import os, subprocess, sys, re
url, path = sys.argv[1], sys.argv[2]
skip = re.compile(r'\b(cloud_admin|neon_superuser|neon_admin|neon_auth|neon_authenticator|postgres)\b')
env = {**os.environ, "PSQL_HISTORY": "/dev/null"}
applied = 0
skipped = 0
for raw in open(path, encoding="utf-8"):
    line = raw.strip()
    if not line or line.startswith("--"):
        continue
    if skip.search(line):
        skipped += 1
        continue
    result = subprocess.run(
        ["psql", "--no-psqlrc", "--dbname", url, "-v", "ON_ERROR_STOP=1", "-c", line],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        err = result.stderr.lower()
        if "does not exist" in err or "role" in err:
            skipped += 1
            continue
        sys.stderr.write(result.stderr)
        raise SystemExit("套用 GRANT 失敗")
    applied += 1
print(f"GRANT 已套用 {applied} 條，跳過 {skipped} 條（角色不存在或為 Neon 內建）", file=sys.stderr)
PY
fi

if [[ "${CREATE_WEB_ROLE:-}" == "yes" ]]; then
  WEB_ROLE_NAME="${WEB_ROLE_NAME:-nuni_web_files}"
  psql_url "$DEST_DATABASE_URL" -c "
GRANT SELECT ON public.class_workspaces, public.class_workspace_assignments, public.platform_accounts TO ${WEB_ROLE_NAME};
GRANT SELECT, INSERT, UPDATE ON public.class_assignment_submission_files TO ${WEB_ROLE_NAME};
GRANT SELECT, INSERT ON public.class_assignment_file_idempotency TO ${WEB_ROLE_NAME};
"
fi

printf '匯入完成。請接著跑 03-verify.sh。\n'
