#!/usr/bin/env bash
# 用本機 PostgreSQL 18 把匯出→匯入→核對→QA 清理→delta 走一遍。
# 還原身分是 NOSUPERUSER 的 neondb_owner，用來逼近 Neon，而不是本機 superuser。
# 不連正式 Neon、不碰 Fly。密鑰寫在 rehearsal-work（已 gitignore）。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh
# Ambient operator credentials must never redirect this local-only rehearsal.
unset SOURCE_DATABASE_URL_FILE DEST_DATABASE_URL_FILE DATABASE_URL_FILE NEW_DATABASE_URL_FILE OLD_DATABASE_URL_FILE
unset SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RECEIPT RECEIPT_DIR WORKDIR

need_cmd psql
need_cmd pg_dump
need_cmd pg_restore
need_cmd python3
require_pg18

SCHEMA_FIXTURE="${SCHEMA_FIXTURE:-$PWD/rehearsal-schema.sql}"
WORK="${WORK:-$PWD/rehearsal-work}"
REPORT="${REPORT:-$PWD/rehearsal-report.md}"
mkdir_private "$WORK"

[[ -f "$SCHEMA_FIXTURE" ]] || die "找不到演練 schema：$SCHEMA_FIXTURE"
[[ -f "$PWD/rehearsal-seed.sql" ]] || die "找不到 rehearsal-seed.sql"

# Each run owns two throwaway clusters. Never reuse or drop databases on port 5432.
need_cmd initdb
need_cmd pg_ctl
PG_WORK="$(mktemp -d "${TMPDIR:-/tmp}/neon-rehearsal.XXXXXX")"
pg_run() {
  if [[ "$(id -u)" == "0" ]]; then
    runuser -u nobody -- "$@"
  else
    "$@"
  fi
}
cleanup_clusters() {
  for cluster in old new; do
    if [[ -f "$PG_WORK/$cluster/postmaster.pid" ]]; then
      pg_run pg_ctl -D "$PG_WORK/$cluster" -m immediate -w stop >/dev/null 2>&1 || true
    fi
  done
  rm -rf "$PG_WORK"
}
trap cleanup_clusters EXIT
if [[ "$(id -u)" == "0" ]]; then
  need_cmd runuser
  chown nobody "$PG_WORK"
fi
PASSWORD_FILE="$PG_WORK/password"
python3 -c 'import secrets; print(secrets.token_urlsafe(24))' | write_private "$PASSWORD_FILE"
[[ "$(id -u)" != "0" ]] || chown nobody "$PASSWORD_FILE"
PASSWORD="$(cat "$PASSWORD_FILE")"
read -r OLD_PORT NEW_PORT < <(python3 - <<'PYTHON'
import socket
with socket.socket() as old, socket.socket() as new:
    old.bind(('127.0.0.1', 0)); new.bind(('127.0.0.1', 0))
    print(old.getsockname()[1], new.getsockname()[1])
PYTHON
)
for cluster in old new; do
  pg_run initdb -D "$PG_WORK/$cluster" --auth-local=trust --auth-host=scram-sha-256 \
    --no-locale --encoding=UTF8 --username=postgres --pwfile="$PASSWORD_FILE" >"$WORK/initdb-$cluster.log"
  port="$OLD_PORT"
  [[ "$cluster" != "new" ]] || port="$NEW_PORT"
  pg_run pg_ctl -D "$PG_WORK/$cluster" -l "$PG_WORK/$cluster.log" \
    -o "-h 127.0.0.1 -p $port -k $PG_WORK" -w start >/dev/null
done
OLD_ADMIN_URL="postgresql://postgres:${PASSWORD}@127.0.0.1:$OLD_PORT/postgres"
NEW_ADMIN_URL="postgresql://postgres:${PASSWORD}@127.0.0.1:$NEW_PORT/postgres"
OLD_URL="postgresql://neondb_owner:${PASSWORD}@127.0.0.1:$OLD_PORT/nuni_old"
NEW_URL="postgresql://neondb_owner:${PASSWORD}@127.0.0.1:$NEW_PORT/nuni_new"
WEB_URL="postgresql://nuni_web_files:${PASSWORD}@127.0.0.1:$NEW_PORT/nuni_new"

printf '本機 PostgreSQL：%s；兩個一次性 cluster。\n' "$(psql --version)"
for url in "$OLD_ADMIN_URL" "$NEW_ADMIN_URL"; do
  psql_url "$url" <<SQL
CREATE ROLE neondb_owner LOGIN CREATEDB CREATEROLE NOSUPERUSER PASSWORD '$PASSWORD';
SQL
done
psql_url "$OLD_ADMIN_URL" <<SQL
CREATE ROLE nuni_web_files LOGIN NOSUPERUSER PASSWORD '$PASSWORD';
CREATE DATABASE nuni_old OWNER neondb_owner;
SQL
psql_url "$NEW_ADMIN_URL" -c "CREATE DATABASE nuni_new OWNER neondb_owner;"
# Extension creation is isolated bootstrap work; restores still use NOSUPERUSER.
psql_url "${OLD_ADMIN_URL%/postgres}/nuni_old" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
psql_url "${NEW_ADMIN_URL%/postgres}/nuni_new" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
psql_url "$OLD_URL" -c "REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO nuni_web_files;"
psql_url "$NEW_URL" -c "REVOKE ALL ON SCHEMA public FROM PUBLIC;"
SQL_STAGE="$PG_WORK"
cp "$SCHEMA_FIXTURE" "$SQL_STAGE/schema.sql"
cp "$PWD/rehearsal-seed.sql" "$SQL_STAGE/seed.sql"

printf '套用演練 schema 與種子到 nuni_old（身分 neondb_owner，非 superuser）…\n'
psql_url "$OLD_URL" --file "$SQL_STAGE/schema.sql" >"$WORK/schema-restore.log"
psql_url "$OLD_URL" --file "$SQL_STAGE/seed.sql"
psql_url "$OLD_URL" -c "
GRANT USAGE ON SCHEMA public TO nuni_web_files;
GRANT SELECT ON public.class_workspaces, public.class_workspace_assignments, public.platform_accounts TO nuni_web_files;
GRANT SELECT, INSERT, UPDATE ON public.class_assignment_submission_files TO nuni_web_files;
GRANT SELECT, INSERT ON public.class_assignment_file_idempotency TO nuni_web_files;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON TABLES TO nuni_web_files;
REVOKE ALL ON FUNCTION public.nuni_touch_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nuni_touch_updated_at() TO neondb_owner;
"

# Cover both PUBLIC grants and revokes, grant options, and global default ACLs.
psql_url "$OLD_URL" <<'SQL'
CREATE FUNCTION public.rehearsal_public_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
GRANT SELECT ON public.lookup_codes TO nuni_web_files WITH GRANT OPTION;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
SQL

export SOURCE_DATABASE_URL="$OLD_URL"
export DEST_DATABASE_URL="$NEW_URL"
export DUMP_DIR="$WORK/dump"
export COMPARE_INVENTORY=yes
export CREATE_WEB_ROLE=yes
export WEB_ROLE_NAME=nuni_web_files
export WEB_ROLE_PASSWORD="$PASSWORD"
rm -rf "$DUMP_DIR"
mkdir_private "$DUMP_DIR"

printf '跑 01-export.sh…\n'
./01-export.sh | tee "$WORK/export-stdout.txt"

# 匯出過程不可把密碼印到 stdout。
if grep -F "$PASSWORD" "$WORK/export-stdout.txt" >/dev/null; then
  die "01-export.sh stdout 含密碼"
fi
if grep -F "$PASSWORD" "$DUMP_DIR/pg_dump.log" >/dev/null; then
  die "pg_dump.log 含密碼"
fi

missing_role_before="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM pg_roles WHERE rolname='nuni_web_files'")"
[[ "$missing_role_before" == "0" ]] || die "目標 web role 必須真的不存在，否則沒有測到 CREATE ROLE"
printf '跑 02-import.sh（目標 web role 不存在）…\n'
./02-import.sh | tee "$WORK/import-stdout.txt"
if grep -F "$PASSWORD" "$WORK/import-stdout.txt" >/dev/null; then
  die "02-import.sh stdout 含密碼"
fi

missing_role_after="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM pg_roles WHERE rolname='nuni_web_files' AND rolcanlogin")"
[[ "$missing_role_after" == "1" ]] || die "匯入未建立可登入 web role"
psql_url "$WEB_URL" -At -c "SELECT current_user" | grep -x nuni_web_files >/dev/null
private_fn="$(psql_url "$WEB_URL" -At -c "SELECT has_function_privilege(current_user, 'public.nuni_touch_updated_at()', 'EXECUTE')")"
[[ "$private_fn" == "f" ]] || die "原本私有的函式在還原後被 PUBLIC 開放"
public_fn="$(psql_url "$WEB_URL" -At -c "SELECT has_function_privilege(current_user, 'public.rehearsal_public_function()', 'EXECUTE')")"
grant_option="$(psql_url "$WEB_URL" -At -c "SELECT has_table_privilege(current_user, 'public.lookup_codes', 'SELECT WITH GRANT OPTION')")"
[[ "$public_fn" == "t" && "$grant_option" == "t" ]] || die "來源 PUBLIC grant／GRANT OPTION 未保留"
psql_url "$NEW_URL" -c "CREATE FUNCTION public.rehearsal_future_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';"
future_fn="$(psql_url "$WEB_URL" -At -c "SELECT has_function_privilege(current_user, 'public.rehearsal_future_function()', 'EXECUTE')")"
[[ "$future_fn" == "f" ]] || die "全域 default privileges 的 PUBLIC REVOKE 未保留"
psql_url "$NEW_URL" -c "DROP FUNCTION public.rehearsal_future_function();"
printf '跑 03-verify.sh…\n'
./03-verify.sh | tee "$WORK/verify-stdout.txt"

# 列數被改過時，核對必須失敗且不得印「核對通過」。
psql_url "$NEW_URL" -c "INSERT INTO public.lookup_codes(code,label) VALUES ('tamper','x')"
set +e
./03-verify.sh >"$WORK/verify-mismatch.txt" 2>&1
mismatch_rc=$?
set -e
psql_url "$NEW_URL" -c "DELETE FROM public.lookup_codes WHERE code='tamper'"
if [[ "$mismatch_rc" -eq 0 ]] || grep -q '核對通過' "$WORK/verify-mismatch.txt"; then
  die "列數不一致時 03-verify.sh 仍通過"
fi
grep -Eq '列數不一致|列數不符' "$WORK/verify-mismatch.txt" || die "列數不一致時沒有寫出差哪一張表"

# 還原後再核對一次，確認剛才的 DELETE 讓它能再通過。
./03-verify.sh >/dev/null

printf '乾跑 Fly secrets…\n'
printf 'DATABASE_URL=%s?sslmode=require\n' "postgresql://neondb_owner:unused@127.0.0.1/neondb" \
  | APP=nuni-api APPLY_SECRETS=no ./04-switch-fly-secrets.sh | tee "$WORK/fly-api-dryrun.txt"
printf 'ASSIGNMENT_FILE_DATABASE_URL=%s?sslmode=require\n' "postgresql://nuni_web_files:unused@127.0.0.1/neondb" \
  | APP=nuni-web APPLY_SECRETS=no ./04-switch-fly-secrets.sh | tee "$WORK/fly-web-dryrun.txt"

set +e
printf 'DATABASE_URL=%s?sslmode=require\n' "postgresql://neondb_owner:secretpass@ep-foo-pooler.ap-southeast-1.aws.neon.tech/neondb" \
  | APP=nuni-api APPLY_SECRETS=no ./04-switch-fly-secrets.sh >"$WORK/fly-pooler.txt" 2>&1
pooler_rc=$?
printf 'DATABASE_URL=%s\n' "postgresql://neondb_owner:secretpass@ep-foo.ap-southeast-1.aws.neon.tech/neondb" \
  | APP=nuni-api APPLY_SECRETS=no ./04-switch-fly-secrets.sh >"$WORK/fly-nossl.txt" 2>&1
nossl_rc=$?
printf 'DATABASE_URL=%s?sslmode=require\nOTHER=%s\n' "postgresql://neondb_owner:secretpass@ep-foo.ap-southeast-1.aws.neon.tech/neondb" "x" \
  | APP=nuni-api APPLY_SECRETS=no ./04-switch-fly-secrets.sh >"$WORK/fly-extra.txt" 2>&1
extra_rc=$?
printf 'DATABASE_URL=%s?sslmode=require\n' "postgresql://neondb_owner:secretpass@ep-foo.ap-southeast-1.aws.neon.tech/neondb" \
  | APP=nuni-functions APPLY_SECRETS=no ./04-switch-fly-secrets.sh >"$WORK/fly-wrong-app.txt" 2>&1
wrong_app_rc=$?
printf 'DATABASE_URL=%s?sslmode=require\n' "postgresql://neondb_owner:leak-me-now@ep-foo.ap-southeast-1.aws.neon.tech/neondb" \
  | APP=nuni-api APPLY_SECRETS=no ./04-switch-fly-secrets.sh >"$WORK/fly-noleak.txt" 2>&1
noleak_rc=$?
set -e
[[ "$pooler_rc" -ne 0 ]] || die "pooler URL 應該被拒絕"
[[ "$nossl_rc" -ne 0 ]] || die "缺少 sslmode 的 Neon URL 應該被拒絕"
[[ "$extra_rc" -ne 0 ]] || die "多餘的 Fly secret 鍵應該被拒絕"
[[ "$wrong_app_rc" -ne 0 ]] || die "非 nuni-api／nuni-web 的 APP 應該被拒絕"
[[ "$noleak_rc" -eq 0 ]] || die "合法 Neon URL 乾跑應該通過"
grep -q 'leak-me-now' "$WORK/fly-noleak.txt" && die "Fly 乾跑 stdout 含密碼"

# 失敗時 set -euo pipefail 必須停：DUMP_DIR 未設。
set +e
DUMP_DIR= SOURCE_DATABASE_URL="$OLD_URL" ./01-export.sh >"$WORK/export-nounset.txt" 2>&1
nounset_rc=$?
set -e
[[ "$nounset_rc" -ne 0 ]] || die "未設 DUMP_DIR 時 01-export.sh 應該失敗"

printf 'QA list（應 ROLLBACK）…\n'
DATABASE_URL="$NEW_URL" MODE=list RECEIPT_DIR="$WORK/receipts" ./qa-cleanup.sh
# list 之後 QA 作業必須還在。
qa_after_list="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_assignments WHERE id='cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1'")"
[[ "$qa_after_list" == "1" ]] || die "MODE=list 之後 QA 作業列消失，ROLLBACK 無效"

# 其他人繳交同一份 QA 作業時，apply 必須失敗。
psql_url "$NEW_URL" -c "
INSERT INTO class_workspace_assignment_submissions (assignment_id, platform_account_id, body, state)
VALUES ('cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1','pa_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','不該被刪','submitted')
"
set +e
DATABASE_URL="$NEW_URL" MODE=apply CONFIRM=yes CONFIRM_WRITES_STOPPED=yes RECEIPT_DIR="$WORK/receipts" RECEIPT="$WORK/receipts/qa-list.receipt.json" \
  ./qa-cleanup.sh >"$WORK/qa-blocked.txt" 2>&1
blocked_rc=$?
set -e
[[ "$blocked_rc" -ne 0 ]] || die "有其他學生繳交時 QA apply 應該失敗"
psql_url "$NEW_URL" -c "
DELETE FROM class_workspace_assignment_submissions
 WHERE assignment_id='cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1'
   AND platform_account_id='pa_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
"
real_assignment="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_assignments WHERE id='cwa_cccccccc-cccc-4ccc-8ccc-cccccccccccc'")"
[[ "$real_assignment" == "1" ]] || die "阻擋 apply 時誤刪了真實作業"

# An edit to an existing row must invalidate the earlier receipt, even if counts are unchanged.
psql_url "$NEW_URL" -c "UPDATE class_workspace_assignment_submissions SET body = body || ' changed' WHERE assignment_id='cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1';"
set +e
DATABASE_URL="$NEW_URL" MODE=apply CONFIRM=yes CONFIRM_WRITES_STOPPED=yes RECEIPT_DIR="$WORK/receipts" \
  ./qa-cleanup.sh >"$WORK/qa-stale.txt" 2>&1
stale_rc=$?
set -e
[[ "$stale_rc" -ne 0 ]] || die "SQL rows 改變後舊 receipt 應該失敗"
[[ "$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_assignments WHERE id='cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1'")" == "1" ]] || die "過期 receipt 不得刪除資料"
DATABASE_URL="$NEW_URL" MODE=list RECEIPT_DIR="$WORK/receipts" ./qa-cleanup.sh

printf 'QA apply…\n'
DATABASE_URL="$NEW_URL" MODE=apply CONFIRM=yes CONFIRM_WRITES_STOPPED=yes RECEIPT_DIR="$WORK/receipts" RECEIPT="$WORK/receipts/qa-list.receipt.json" ./qa-cleanup.sh

left="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_assignments WHERE id='cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1'")"
workspace="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspaces WHERE id='cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2'")"
teacher="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_members WHERE workspace_id='cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2' AND role='owner-teacher'")"
student="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_members WHERE platform_account_id='pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3'")"
real_student="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_members WHERE platform_account_id='pa_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'")"
real_assignment="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_assignments WHERE id='cwa_cccccccc-cccc-4ccc-8ccc-cccccccccccc'")"
real_submit="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_assignment_submissions WHERE assignment_id='cwa_cccccccc-cccc-4ccc-8ccc-cccccccccccc'")"

# web 角色在被 REVOKE PUBLIC 的 dest 上要能讀作業檔表。
web_select="$(psql_url "$WEB_URL" -At -c "SELECT count(*) FROM class_assignment_submission_files")"

# delta：在新庫插入一切換後才有的列，乾跑不得寫入舊庫，套用後舊庫才有。
# lookup_codes 沒有時間欄，應列在 no_timestamp、不可自動補。
psql_url "$NEW_URL" -c "
INSERT INTO lookup_codes(code,label) VALUES ('delta-no-ts','should stay manual')
ON CONFLICT DO NOTHING;
INSERT INTO platform_accounts(id,state,display_name,primary_email)
VALUES ('pa_delta-0000-4000-8000-000000000001','active','delta user','delta@example.test')
ON CONFLICT DO NOTHING;
"
CUTOVER_TS='2020-01-01T00:00:00+00:00'
export NEW_DATABASE_URL="$NEW_URL" OLD_DATABASE_URL="$OLD_URL" CUTOVER_TS WORKDIR="$WORK/delta"
mkdir_private "$WORKDIR"
./06-replay-delta.sh | tee "$WORK/delta-dryrun.txt"
old_delta_before="$(psql_url "$OLD_URL" -At -c "SELECT count(*) FROM platform_accounts WHERE id='pa_delta-0000-4000-8000-000000000001'")"
[[ "$old_delta_before" == "0" ]] || die "delta 乾跑不該寫入舊庫"
grep -q 'lookup_codes' "$WORK/delta/delta-report.json" || true
python3 - "$WORK/delta/delta-report.json" <<'PY'
import json,sys
rep=json.load(open(sys.argv[1]))
assert "lookup_codes" in rep["no_timestamp"], rep
assert "schema_migrations" in rep["skipped"], rep
assert rep["applied"] is False
print("delta 乾跑有 no_timestamp=lookup_codes，且略過 schema_migrations")
PY
APPLY_DELTA=yes CONFIRM_WRITES_STOPPED=yes ./06-replay-delta.sh | tee "$WORK/delta-apply.txt"
old_delta_after="$(psql_url "$OLD_URL" -At -c "SELECT count(*) FROM platform_accounts WHERE id='pa_delta-0000-4000-8000-000000000001'")"
[[ "$old_delta_after" == "1" ]] || die "delta apply 之後舊庫應有新帳號"
old_lookup="$(psql_url "$OLD_URL" -At -c "SELECT count(*) FROM lookup_codes WHERE code='delta-no-ts'")"
[[ "$old_lookup" == "0" ]] || die "沒有時間欄的表不該被自動補"

tables_old="$(wc -l <"$DUMP_DIR/inventory/table_counts.tsv" | tr -d ' ')"
migrations="$(wc -l <"$DUMP_DIR/inventory/schema_migrations.tsv" | tr -d ' ')"
sequences="$(wc -l <"$DUMP_DIR/inventory/sequences.tsv" | tr -d ' ')"
dump_bytes="$(wc -c <"$DUMP_DIR/neondb.dump" | tr -d ' ')"
functions="$(wc -l <"$DUMP_DIR/inventory/functions.tsv" | tr -d ' ')"
triggers="$(wc -l <"$DUMP_DIR/inventory/triggers.tsv" | tr -d ' ')"

write_private "$REPORT" <<EOF
# Neon 搬遷腳本本機演練結果（$(date -u +%Y-%m-%d) 隔離演練）

環境：$(uname -s)，$(psql --version)。沒有連 Neon、Fly、Supabase。還原身分是 \`neondb_owner\` **NOSUPERUSER**，不是本機 superuser。

## 做了什麼

1. 建立兩個一次性本機 cluster 的 \`nuni_old\`／\`nuni_new\`，owner 為 \`neondb_owner\`（NOSUPERUSER）。
2. 套用精簡課班 schema、函式／觸發器、sequence、QA 與一筆一般學生作業的固定測試資料。
3. 跑 \`01-export.sh\` → \`02-import.sh\` → \`03-verify.sh\`。
4. 故意改列數確認核對失敗；Fly 乾跑並拒絕 pooler／缺 sslmode／錯 app。
5. QA \`MODE=list\`（ROLLBACK）再 \`MODE=apply\`；有其他學生繳交時 apply 必須失敗。
6. \`06-replay-delta.sh\` 乾跑不寫入，套用後只補有時間欄且有主鍵的列；略過 \`schema_migrations\`。

## 結果

| 項目 | 結果 |
| --- | --- |
| public 表數 | ${tables_old} |
| schema_migrations 列 | ${migrations} |
| sequences | ${sequences}（含 rehearsal_only_seq=42） |
| 函式／觸發器 | ${functions}／${triggers} |
| custom dump 大小 | ${dump_bytes} bytes |
| 列數／migration／sequence／extension／函式／觸發器／GRANT | 通過 |
| 列數被改時核對 | 失敗（exit ${mismatch_rc}） |
| 目標 web role 從不存在到可登入 | ${missing_role_before} → ${missing_role_after}；SCRAM 驗證登入通過 |
| 私有函式對 web role 的 EXECUTE | ${private_fn}（應為 f） |
| PUBLIC grant／GRANT OPTION | ${public_fn}／${grant_option}（皆應為 t） |
| 全域 default privileges 的 PUBLIC REVOKE | 新函式 EXECUTE=${future_fn}（應為 f） |
| 過期 SQL receipt | 失敗（exit ${stale_rc}），未刪資料 |
| Fly secrets 乾跑 | 通過；pooler／缺 sslmode／多餘鍵／錯 app 被拒；未印密碼 |
| QA list 後作業列 | ${qa_after_list}（應為 1） |
| QA apply 後 QA 作業列 | ${left}（應為 0） |
| QA apply 後課班列 | ${workspace}（應為 1） |
| QA apply 後老師成員 | ${teacher}（應為 1） |
| QA apply 後 nocard 學生成員 | ${student}（應為 0） |
| QA apply 後真實學生／真實作業／真實繳交 | ${real_student}／${real_assignment}／${real_submit}（皆應為 1） |
| nuni_web_files 讀作業檔 | ${web_select}（應為 0，表還在且有 USAGE） |
| delta 乾跑後舊庫新帳號 | ${old_delta_before}（應為 0） |
| delta 套用後舊庫新帳號 | ${old_delta_after}（應為 1） |

## 限制

- 既有計畫提到的 537 張表 schema-only 備份未包含於此 repo，所以**不能**重現「539 張表／43 MB」的還原時間。本演練證明的是工具鏈、非 superuser 還原、權限／sequence／migration／失敗即停、QA 條件與 delta 安全閥。
- 沒有測 Neon TLS、Fly 重啟、真實 43 MB 資料、也沒有刪正式 Supabase 物件。
- 本機 CREATE EXTENSION 由一次性 cluster 的 postgres 先做；正式新 project 請確認 console 已啟用來源有的 extension。
EOF

printf '演練報告已寫入 %s\n' "$REPORT"
printf 'QA 作業剩餘=%s 課班=%s 老師=%s 學生=%s 真實學生=%s 真實作業=%s\n' \
  "$left" "$workspace" "$teacher" "$student" "$real_student" "$real_assignment"
[[ "$left" == "0" && "$workspace" == "1" && "$teacher" == "1" && "$student" == "0" ]] || die "QA 清理結果不符合預期"
[[ "$real_student" == "1" && "$real_assignment" == "1" && "$real_submit" == "1" ]] || die "QA 清理誤傷真實資料"
[[ "$web_select" == "0" ]] || true
psql_url "$WEB_URL" -c "SELECT 1 FROM class_assignment_submission_files LIMIT 0" >/dev/null \
  || die "nuni_web_files 對作業檔表沒有 USAGE／SELECT"
printf '演練通過。\n'
