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
    [[ "$name" =~ ^[a-zA-Z0-9_-]+$ ]] || die "extension 名稱不合法"
    psql_url "$DEST_DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS \"$name\";"
  done <"$DUMP_DIR/inventory/extensions.tsv"
fi

# 應用程式角色（不含 Neon 內建）。名稱從環境變數讀，不寫死正式密碼。
# 預設：還原身分就是 owner。若要給 nuni-web 最小權限，設 CREATE_WEB_ROLE=yes。
if [[ "${CREATE_WEB_ROLE:-}" == "yes" ]]; then
  WEB_ROLE_NAME="${WEB_ROLE_NAME:-nuni_web_files}"
  WEB_ROLE_PASSWORD="${WEB_ROLE_PASSWORD:-}"
  [[ -n "$WEB_ROLE_PASSWORD" ]] || die "CREATE_WEB_ROLE=yes 時請設 WEB_ROLE_PASSWORD（不要寫進 repo）"
  NEON_MIGRATION_DATABASE_URL="$DEST_DATABASE_URL" WEB_ROLE_NAME="$WEB_ROLE_NAME" \
    WEB_ROLE_PASSWORD="$WEB_ROLE_PASSWORD" python3 ./safety.py role
fi

# --no-comments：Neon 上 extension 多半屬 neon_superuser，COMMENT ON EXTENSION 會讓
# --exit-on-error 整段還原失敗；註解不影響資料或啟動檢查。
postgres_url "$DEST_DATABASE_URL" pg_restore \
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
  NEON_MIGRATION_DATABASE_URL="$DEST_DATABASE_URL" python3 - "$DUMP_DIR/inventory/grants.sql" <<'PY'
import os, sys, re
from safety import postgres, redact
url, path = os.environ["NEON_MIGRATION_DATABASE_URL"], sys.argv[1]
missing_role = re.compile(r'role ".*?" does not exist', re.I)
applied = 0
skipped = 0
skipped_roles = []
for raw in open(path, encoding="utf-8"):
    line = raw.strip()
    if not line or line.startswith("--"):
        continue
    result = postgres(url, ["-c", line], check=False)
    if result.returncode != 0:
        err = redact(result.stderr, url)
        if missing_role.search(err):
            skipped += 1
            skipped_roles.append(line)
            print(f"警告：略過（角色不存在）：{line}", file=sys.stderr)
            continue
        sys.stderr.write(err)
        raise SystemExit("套用 GRANT 失敗，已停止。不要繼續換 Fly。")
    applied += 1
print(f"GRANT 已套用 {applied} 條，跳過 {skipped} 條（角色不存在；系統角色已由匯出器排除）", file=sys.stderr)
if skipped_roles:
    print(
        "有應用程式 GRANT 因角色不存在被跳過。請對照 inventory/login_roles.txt，"
        "停止切換。建好角色後只重放 inventory/grants-skipped.txt，再跑 03-verify.sh；不要對非空目標重跑整份匯入。",
        file=sys.stderr,
    )
    open(os.path.join(os.path.dirname(path), "grants-skipped.txt"), "w", encoding="utf-8").write(
        "\n".join(skipped_roles) + "\n"
    )
    raise SystemExit("匯入尚未完成：有應用程式角色缺失，禁止切換 Fly。")
PY
fi

if [[ "${CREATE_WEB_ROLE:-}" == "yes" ]]; then
  WEB_ROLE_NAME="${WEB_ROLE_NAME:-nuni_web_files}"
  NEON_MIGRATION_DATABASE_URL="$DEST_DATABASE_URL" WEB_ROLE_NAME="$WEB_ROLE_NAME" python3 - <<'PYTHON'
import os, re, sys
from safety import SafetyError, postgres, literal
url, role = os.environ["NEON_MIGRATION_DATABASE_URL"], os.environ["WEB_ROLE_NAME"]
if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
    raise SystemExit("WEB_ROLE_NAME 不合法")
try:
    connect_sql = postgres(url, ["-At", "-c", "SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), " + literal(role) + ")"]).stdout.strip()
    grants = f"""
{connect_sql};
GRANT USAGE ON SCHEMA public TO "{role}";
GRANT SELECT ON public.class_workspaces, public.class_workspace_assignments, public.platform_accounts TO "{role}";
GRANT SELECT, INSERT, UPDATE ON public.class_assignment_submission_files TO "{role}";
GRANT SELECT, INSERT ON public.class_assignment_file_idempotency TO "{role}";
"""
    postgres(url, [], input=grants)
except SafetyError as exc:
    raise SystemExit(str(exc)) from None
print("web role grants ready", file=sys.stderr)
PYTHON
fi

printf '匯入完成。請接著跑 03-verify.sh。\n'
