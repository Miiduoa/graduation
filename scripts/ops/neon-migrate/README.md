# Neon 搬遷腳本

給正式執行的人在**有密碼的機器**上跑。本目錄的腳本不會自己去連 `nuni-prod`，也不會在未設 `APPLY_SECRETS=yes` 時改 Fly。

完整步驟與學生會看到什麼，見 [`docs/ops/neon-migration-20261022.md`](../../../docs/ops/neon-migration-20261022.md)。

本機演練（不連正式庫）：

```sh
python3 -m unittest discover -s . -p 'test_*.py' -v
./rehearsal.sh
```

需要完整 PostgreSQL 18 工具（含 `initdb`、`pg_ctl`）與 Python 3。演練只建立兩個一次性本機 cluster，不使用既有 5432 服務、不刪現有資料庫，結束自動清除。來源預先有 web role，目標從不存在開始，實際驗證 CREATE ROLE、SCRAM 登入與私有函式不得對 PUBLIC 開放。還原身分是 `neondb_owner` NOSUPERUSER。通過不代表 43 MB 正式資料的還原時間。

## 密鑰怎麼傳

| 變數 | 或檔案 | 用途 |
| --- | --- | --- |
| `SOURCE_DATABASE_URL` | `SOURCE_DATABASE_URL_FILE` | 舊庫（直連，不要用 pooler） |
| `DEST_DATABASE_URL` | `DEST_DATABASE_URL_FILE` | 新庫（直連） |
| `DATABASE_URL` | `DATABASE_URL_FILE` | QA 清理目標 |
| stdin `KEY=VALUE` |  | Fly secrets（每個 app 只准一個鍵） |

正式連線必須帶 `sslmode=require`，host 不得含 `-pooler`。腳本拒絕空 URL、錯 scheme／host／db、重複鍵與未知連線參數；連線秘密從環境傳給 PostgreSQL，不放在 argv 或失敗 traceback。支援參數：`sslmode`、`channel_binding`、`connect_timeout`、`application_name`。

## 順序

```sh
# 1. 暫停寫入之後
DUMP_DIR=/path/outside/repo/neon-20261022 \
SOURCE_DATABASE_URL_FILE=/path/outside/repo/old.url \
  ./01-export.sh

# 2. 新 project 已開好、密碼已換過
DUMP_DIR=/path/outside/repo/neon-20261022 \
DEST_DATABASE_URL_FILE=/path/outside/repo/new.url \
  ./02-import.sh

DUMP_DIR=/path/outside/repo/neon-20261022 \
COMPARE_INVENTORY=yes \
DEST_DATABASE_URL_FILE=/path/outside/repo/new.url \
  ./03-verify.sh

# 3. 先 api 再 web；預設只 --stage
printf 'DATABASE_URL=%s\n' "$(cat /path/outside/repo/new-api.url)" \
  | APP=nuni-api APPLY_SECRETS=yes ./04-switch-fly-secrets.sh

printf 'ASSIGNMENT_FILE_DATABASE_URL=%s\n' "$(cat /path/outside/repo/new-web.url)" \
  | APP=nuni-web APPLY_SECRETS=yes ./04-switch-fly-secrets.sh
```

`STAGE=no` 可能重啟機器，要另設 `CONFIRM_RESTART=yes`。目標缺少來源的 LOGIN 角色時 `03-verify.sh` 會失敗；若確定不用那些角色，才設 `IGNORE_MISSING_ROLES=yes`。

回滾：先停止 api／web 寫入，完整核對新舊差異；`06-replay-delta.sh` 只輔助補新增／更新（乾跑 → 看報告 → `APPLY_DELTA=yes CONFIRM_WRITES_STOPPED=yes`；永遠略過 `schema_migrations`、不重放 DELETE 或 sequence、不保證 FK 順序）。部分成功需先核對再重新乾跑。之後用 `05-rollback-fly-secrets.sh` 把 api／web 兩條 secret 一同 stage 回同一個舊庫，實際送出要求 `CONFIRM_WRITES_STOPPED=yes`，兩邊一致才恢復流量。不得只讓 web 回舊庫。

QA 清理：

```sh
DATABASE_URL_FILE=/path/outside/repo/target.url MODE=list ./qa-cleanup.sh
# 看 receipts/qa-list.txt（應有 ROLLBACK）
DATABASE_URL_FILE=/path/outside/repo/target.url MODE=apply CONFIRM=yes CONFIRM_WRITES_STOPPED=yes ./qa-cleanup.sh
```

建議在**切換完成且 health 通過之後**，另安排暫停寫入窗口，對新庫清理。receipt 綁定目標、SQL 版本與完整資料指紋，過期或不同目標不得套用。

Storage 必須同時設定 `SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY`。先遞迴、分頁盤點，再刪 receipt 的實際檔案路徑並重新列舉核對；未設定會明示附件未處理。若 SQL 成功而 Storage 部分失敗，使用同份 `sql_applied` receipt 重試剩餘已盤點物件。新檔案或 metadata 變更會中止，必須重新 list。SQL 與 Storage 無跨服務 transaction，清理前需保留所需附件備份，回滾時也要協調舊庫的 QA 索引。

匯入會保留 PUBLIC REVOKE 與 grant options，避免 `--no-acl` 讓私有函式重新公開；`03-verify.sh` 會比較 PUBLIC ACL。若因應用程式角色缺失而產生 `grants-skipped.txt`，先補角色、只重放該檔並重新核對，不要對非空目標重跑整份匯入。
