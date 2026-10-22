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
require_direct_host "$DEST_DATABASE_URL" DEST_DATABASE_URL
DUMP_DIR="${DUMP_DIR:?請設 DUMP_DIR}"
DUMP_FILE="${DUMP_FILE:-$DUMP_DIR/neondb.dump}"
[[ -f "$DUMP_FILE" ]] || die "找不到 dump：$DUMP_FILE"

printf '目標 host：%s\n' "$(redacted_host "$DEST_DATABASE_URL")"

# 還原前確認目標幾乎是空的，避免覆寫已有使用者資料。
existing="$(psql_url "$DEST_DATABASE_URL" -At -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")"
if [[ "$existing" != "0" && "${ALLOW_NONEMPTY_DEST:-}" != "yes" ]]; then
  die "目標 public schema 已有 $existing 張表。若確認是新開的空庫，設 ALLOW_NONEMPTY_DEST=yes"
fi

# 先裝 dump 裡沒帶到、但來源盤點有的 extension。名稱用識別字引號，uuid-ossp 才建得起來。
if [[ -f "$DUMP_DIR/inventory/extensions.tsv" ]]; then
  while IFS=$'\t' read -r name version; do
    [[ -n "${name:-}" ]] || continue
    case "$name" in
      plpgsql) continue ;;
    esac
    python3 - "$DEST_DATABASE_URL" "$name" <<'PY'
import os, subprocess, sys
url, name = sys.argv[1], sys.argv[2]
if not all(c.isalnum() or c in "-_" for c in name) or not name:
    raise SystemExit(f"extension 名稱不合法")
ident = '"' + name.replace('"', '') + '"'
sql = f"CREATE EXTENSION IF NOT EXISTS {ident};"
env = {**os.environ, "PSQL_HISTORY": "/dev/null"}
result = subprocess.run(
    ["psql", "--no-psqlrc", "--dbname", url, "-v", "ON_ERROR_STOP=1", "-c", sql],
    env=env, capture_output=True, text=True,
)
if result.returncode != 0:
    sys.stderr.write(result.stderr)
    raise SystemExit(f"無法建立 extension {name}。請在 Neon console 先啟用後重試。")
PY
  done <"$DUMP_DIR/inventory/extensions.tsv"
fi

# 應用程式角色（不含 Neon 內建）。名稱從環境變數讀，不寫死正式密碼。
# 預設：還原身分就是 owner。若要給 nuni-web 最小權限，設 CREATE_WEB_ROLE=yes。
if [[ "${CREATE_WEB_ROLE:-}" == "yes" ]]; then
  WEB_ROLE_NAME="${WEB_ROLE_NAME:-nuni_web_files}"
  WEB_ROLE_PASSWORD="${WEB_ROLE_PASSWORD:-}"
  [[ -n "$WEB_ROLE_PASSWORD" ]] || die "CREATE_WEB_ROLE=yes 時請設 WEB_ROLE_PASSWORD（不要寫進 repo）"
  python3 - "$DEST_DATABASE_URL" "$WEB_ROLE_NAME" "$WEB_ROLE_PASSWORD" <<'PY'
import os, subprocess, sys
url, role, password = sys.argv[1], sys.argv[2], sys.argv[3]
if not role.replace("_", "").isalnum():
    raise SystemExit("WEB_ROLE_NAME 不合法")
role_literal = role.replace("'", "''")
password_literal = password.replace("'", "''")
payload = (
    "DO $$ BEGIN "
    f"IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role_literal}') THEN "
    f"EXECUTE format('CREATE ROLE %%I LOGIN PASSWORD %%L', '{role_literal}', '{password_literal}'); "
    "END IF; END $$;"
)
env = {**os.environ, "PSQL_HISTORY": "/dev/null"}
subprocess.run(
    ["psql", "--no-psqlrc", "--dbname", url, "-v", "ON_ERROR_STOP=1", "-c", payload],
    check=True, env=env,
)
print("web role ready", file=sys.stderr)
PY
fi

# --no-comments：Neon 上 extension 多半屬 neon_superuser，COMMENT ON EXTENSION 會讓
# --exit-on-error 整段還原失敗；註解不影響資料或啟動檢查。
pg_restore \
  --dbname="$DEST_DATABASE_URL" \
  --no-owner \
  --no-acl \
  --no-comments \
  --verbose \
  --exit-on-error \
  "$DUMP_FILE" \
  2>"$DUMP_DIR/pg_restore.log"

if grep -E 'ERROR' "$DUMP_DIR/pg_restore.log" >/dev/null; then
  die "pg_restore.log 含 ERROR，目標庫可能不完整。請重置新庫後重跑，不要繼續換 Fly。"
fi

if [[ -s "$DUMP_DIR/inventory/grants.sql" ]]; then
  # 只有「角色不存在」可以跳過。relation does not exist、permission denied 必須失敗。
  python3 - "$DEST_DATABASE_URL" "$DUMP_DIR/inventory/grants.sql" <<'PY'
import os, subprocess, sys, re
url, path = sys.argv[1], sys.argv[2]
skip_roles = re.compile(r'\b(cloud_admin|neon_superuser|neon_admin|neon_auth|neon_authenticator|neon_service|postgres)\b')
missing_role = re.compile(r'role ".*?" does not exist', re.I)
env = {**os.environ, "PSQL_HISTORY": "/dev/null"}
applied = 0
skipped = 0
skipped_roles = []
for raw in open(path, encoding="utf-8"):
    line = raw.strip()
    if not line or line.startswith("--"):
        continue
    if skip_roles.search(line):
        skipped += 1
        continue
    result = subprocess.run(
        ["psql", "--no-psqlrc", "--dbname", url, "-v", "ON_ERROR_STOP=1", "-c", line],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        err = result.stderr
        if missing_role.search(err):
            skipped += 1
            skipped_roles.append(line)
            print(f"警告：略過（角色不存在）：{line}", file=sys.stderr)
            continue
        sys.stderr.write(err)
        raise SystemExit("套用 GRANT 失敗，已停止。不要繼續換 Fly。")
    applied += 1
print(f"GRANT 已套用 {applied} 條，跳過 {skipped} 條（角色不存在或為 Neon 內建）", file=sys.stderr)
if skipped_roles:
    print(
        "有應用程式 GRANT 因角色不存在被跳過。請對照 inventory/login_roles.txt，"
        "在新 project 建好角色後重跑 02-import.sh，或確認那些角色已不再使用。",
        file=sys.stderr,
    )
    open(os.path.join(os.path.dirname(path), "grants-skipped.txt"), "w", encoding="utf-8").write(
        "\n".join(skipped_roles) + "\n"
    )
PY
fi

if [[ "${CREATE_WEB_ROLE:-}" == "yes" ]]; then
  WEB_ROLE_NAME="${WEB_ROLE_NAME:-nuni_web_files}"
  python3 - "$DEST_DATABASE_URL" "$WEB_ROLE_NAME" <<'PY'
import os, subprocess, sys
url, role = sys.argv[1], sys.argv[2]
if not role.replace("_", "").isalnum():
    raise SystemExit("WEB_ROLE_NAME 不合法")
ident = role.replace('"', "")
env = {**os.environ, "PSQL_HISTORY": "/dev/null"}
lookup = subprocess.run(
    ["psql", "--no-psqlrc", "--dbname", url, "-v", "ON_ERROR_STOP=1", "-At",
     "-c", f"SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), '{ident}')"],
    env=env, capture_output=True, text=True, check=True,
)
connect_sql = lookup.stdout.strip()
grants = f"""
{connect_sql};
GRANT USAGE ON SCHEMA public TO "{ident}";
GRANT SELECT ON public.class_workspaces, public.class_workspace_assignments, public.platform_accounts TO "{ident}";
GRANT SELECT, INSERT, UPDATE ON public.class_assignment_submission_files TO "{ident}";
GRANT SELECT, INSERT ON public.class_assignment_file_idempotency TO "{ident}";
"""
subprocess.run(
    ["psql", "--no-psqlrc", "--dbname", url, "-v", "ON_ERROR_STOP=1", "-c", grants],
    env=env, check=True,
)
print("web role grants ready", file=sys.stderr)
PY
fi

printf '匯入完成。請接著跑 03-verify.sh。\n'
