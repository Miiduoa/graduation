#!/usr/bin/env bash
# 用本機 PostgreSQL 18 與早上的 schema 備份，把匯出→匯入→核對→QA 清理走一遍。
# 不連正式 Neon、不碰 Fly。密鑰寫在 rehearsal-work（已 gitignore）。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh

need_cmd psql
need_cmd pg_dump
need_cmd pg_restore
need_cmd python3
require_pg18

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || realpath ../../..)"
SCHEMA_DUMP="${SCHEMA_DUMP:-/home/ubuntu/.cursor/projects/workspace/uploads/nuni-api-neondb-schema-before-280-20261022-111048_13f7.sql}"
MIGRATION_280="${MIGRATION_280:-$ROOT/deploy/nuni-api/assignment-files/280_assignment_submission_files.sql}"
WORK="${WORK:-$PWD/rehearsal-work}"
REPORT="${REPORT:-$PWD/rehearsal-report.md}"
mkdir_private "$WORK"

[[ -f "$SCHEMA_DUMP" ]] || die "找不到 schema 備份：$SCHEMA_DUMP"
[[ -f "$MIGRATION_280" ]] || die "找不到 280 SQL：$MIGRATION_280"

PASSWORD_FILE="$WORK/password"
if [[ ! -f "$PASSWORD_FILE" ]]; then
  python3 -c 'import secrets; print(secrets.token_urlsafe(24))' | write_private "$PASSWORD_FILE"
fi
PASSWORD="$(cat "$PASSWORD_FILE")"
# 本機 URL，不印出。
OLD_URL="postgresql://neon_rehearsal:${PASSWORD}@127.0.0.1:5432/nuni_old"
NEW_URL="postgresql://neon_rehearsal:${PASSWORD}@127.0.0.1:5432/nuni_new"

printf '本機 PostgreSQL：%s\n' "$(psql --version)"
printf 'schema 備份：%s\n' "$SCHEMA_DUMP"
SQL_STAGE=/tmp/neon-rehearsal-sql
mkdir -p "$SQL_STAGE"
chmod 755 "$SQL_STAGE"
cp "$SCHEMA_DUMP" "$SQL_STAGE/schema-source.sql"
cp "$MIGRATION_280" "$SQL_STAGE/280.sql"
cp "$PWD/rehearsal-seed.sql" "$SQL_STAGE/seed.sql"
chmod 644 "$SQL_STAGE"/*.sql

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('nuni_old','nuni_new') AND pid <> pg_backend_pid();" >/dev/null || true
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DROP DATABASE IF EXISTS nuni_old;
DROP DATABASE IF EXISTS nuni_new;
DROP ROLE IF EXISTS nuni_web_files;
DROP ROLE IF EXISTS neon_rehearsal;
CREATE ROLE neon_rehearsal LOGIN SUPERUSER PASSWORD '${PASSWORD}';
CREATE ROLE nuni_web_files LOGIN PASSWORD '${PASSWORD}';
CREATE DATABASE nuni_old OWNER neon_rehearsal;
CREATE DATABASE nuni_new OWNER neon_rehearsal;
SQL

printf '還原早上的 schema-only dump 到 nuni_old…\n'
sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=nuni_old --file "$SQL_STAGE/schema-source.sql" >"$WORK/schema-restore.log"
sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=nuni_old --file "$SQL_STAGE/280.sql"
sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=nuni_old --file "$SQL_STAGE/seed.sql"
sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=nuni_old -c "
ALTER DATABASE nuni_old OWNER TO neon_rehearsal;
GRANT CONNECT ON DATABASE nuni_old TO nuni_web_files;
GRANT USAGE ON SCHEMA public TO neon_rehearsal, nuni_web_files;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO neon_rehearsal;
GRANT SELECT ON public.class_workspaces, public.class_workspace_assignments, public.platform_accounts TO nuni_web_files;
GRANT SELECT, INSERT, UPDATE ON public.class_assignment_submission_files TO nuni_web_files;
GRANT SELECT, INSERT ON public.class_assignment_file_idempotency TO nuni_web_files;
"

export SOURCE_DATABASE_URL="$OLD_URL"
export DEST_DATABASE_URL="$NEW_URL"
export DUMP_DIR="$WORK/dump"
export COMPARE_INVENTORY=yes
rm -rf "$DUMP_DIR"
mkdir_private "$DUMP_DIR"

printf '跑 01-export.sh…\n'
./01-export.sh

# 目標庫先建好 web role，讓 GRANT 重放對得上。
sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=nuni_new -c "GRANT USAGE ON SCHEMA public TO neon_rehearsal, nuni_web_files;"

printf '跑 02-import.sh…\n'
./02-import.sh

printf '跑 03-verify.sh…\n'
./03-verify.sh

printf '乾跑 Fly secrets…\n'
printf 'DATABASE_URL=%s?sslmode=require\n' "postgresql://neon_rehearsal:unused@127.0.0.1/neondb" \
  | APP=nuni-api APPLY_SECRETS=no ./04-switch-fly-secrets.sh | tee "$WORK/fly-api-dryrun.txt"
printf 'ASSIGNMENT_FILE_DATABASE_URL=%s?sslmode=require\n' "postgresql://nuni_web_files:unused@127.0.0.1/neondb" \
  | APP=nuni-web APPLY_SECRETS=no ./04-switch-fly-secrets.sh | tee "$WORK/fly-web-dryrun.txt"

printf 'QA list（應 ROLLBACK）…\n'
DATABASE_URL="$NEW_URL" MODE=list RECEIPT_DIR="$WORK/receipts" ./qa-cleanup.sh
printf 'QA apply…\n'
DATABASE_URL="$NEW_URL" MODE=apply CONFIRM=yes RECEIPT_DIR="$WORK/receipts" RECEIPT="$WORK/receipts/qa-list.receipt.json" ./qa-cleanup.sh

left="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_assignments WHERE id='cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1'")"
workspace="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspaces WHERE id='cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2'")"
teacher="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_members WHERE workspace_id='cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2' AND role='owner-teacher'")"
student="$(psql_url "$NEW_URL" -At -c "SELECT count(*) FROM class_workspace_members WHERE platform_account_id='pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3'")"

tables_old="$(wc -l <"$DUMP_DIR/inventory/table_counts.tsv" | tr -d ' ')"
migrations="$(wc -l <"$DUMP_DIR/inventory/schema_migrations.tsv" | tr -d ' ')"
sequences="$(wc -l <"$DUMP_DIR/inventory/sequences.tsv" | tr -d ' ')"
dump_bytes="$(wc -c <"$DUMP_DIR/neondb.dump" | tr -d ' ')"

write_private "$REPORT" <<EOF
# Neon 搬遷腳本本機演練結果（2026-10-22）

環境：Ubuntu 24.04，PostgreSQL **18.6**（與正式庫同主版本）。沒有連 Neon、Fly、Supabase。

## 做了什麼

1. 把早上的 schema-only 備份還原到本機 \`nuni_old\`。
2. 套用 \`280_assignment_submission_files.sql\`（正式庫在 dump 之後已建這些表）。
3. 插入 CLEANUP.md 的 QA id、一條 \`rehearsal_only_seq\`（值 42）、以及 \`nuni_web_files\` 最小權限 GRANT。
4. 跑 \`01-export.sh\` → \`02-import.sh\` → \`03-verify.sh\`。
5. Fly secrets 腳本乾跑（\`APPLY_SECRETS=no\`）。
6. 在新庫跑 QA \`MODE=list\` 再 \`MODE=apply\`。

## 結果

| 項目 | 結果 |
| --- | --- |
| public 表數 | ${tables_old} |
| schema_migrations 列 | ${migrations} |
| sequences | ${sequences}（含 rehearsal_only_seq=42） |
| custom dump 大小 | ${dump_bytes} bytes |
| 列數／migration／sequence 核對 | 通過 |
| Fly secrets 乾跑 | 通過（未呼叫 flyctl） |
| QA apply 後作業列 | ${left}（應為 0） |
| QA apply 後課班列 | ${workspace}（應為 1） |
| QA apply 後老師成員 | ${teacher}（應為 1） |
| QA apply 後 nocard 學生成員 | ${student}（應為 0） |

## 限制

- 早上的檔是 **schema-only**，沒有正式列資料，所以演練證明的是「工具鏈與權限／sequence／migration 核對」，不是 43 MB 正式資料的還原時間。
- schema dump 沒有 GRANT／extension／owner；演練另外補了應用程式角色。正式匯出必須用 \`01-export.sh\` 現抓。
- 沒有測 Neon pooler、TLS、Fly 重啟，也沒有刪正式 Supabase 物件。
- \`CREATE ROLE\` 在本機用 unix peer 完成；正式新 project 請在 console 建角色，不要把密碼寫進指令歷史。
EOF

printf '演練報告已寫入 %s\n' "$REPORT"
printf 'QA 作業剩餘=%s 課班=%s 老師=%s 學生=%s\n' "$left" "$workspace" "$teacher" "$student"
[[ "$left" == "0" && "$workspace" == "1" && "$teacher" == "1" && "$student" == "0" ]] || die "QA 清理結果不符合預期"
