# Neon 搬遷腳本

給正式執行的人在**有密碼的機器**上跑。本目錄的腳本不會自己去連 `nuni-prod`，也不會在未設 `APPLY_SECRETS=yes` 時改 Fly。

完整步驟與學生會看到什麼，見 [`docs/ops/neon-migration-20261022.md`](../../../docs/ops/neon-migration-20261022.md)。

## 密鑰怎麼傳

| 變數 | 或檔案 | 用途 |
| --- | --- | --- |
| `SOURCE_DATABASE_URL` | `SOURCE_DATABASE_URL_FILE` | 舊庫（直連，不要用 pooler） |
| `DEST_DATABASE_URL` | `DEST_DATABASE_URL_FILE` | 新庫（直連） |
| `DATABASE_URL` | `DATABASE_URL_FILE` | QA 清理目標 |
| stdin `KEY=VALUE` |  | Fly secrets |

正式連線必須帶 `sslmode=require`。腳本不印 URL、密碼、token。

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

回滾：先 `06-replay-delta.sh`（把新庫在 CUTOVER_TS 之後的列補回舊庫），再 `05-rollback-fly-secrets.sh`。

QA 清理：

```sh
DATABASE_URL_FILE=/path/outside/repo/target.url MODE=list ./qa-cleanup.sh
# 看 receipts/qa-list.txt
DATABASE_URL_FILE=/path/outside/repo/target.url MODE=apply CONFIRM=yes ./qa-cleanup.sh
```

建議在**切換完成且 health 通過之後**、對新庫清，理由寫在計畫裡。
