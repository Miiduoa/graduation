# Neon 搬遷腳本本機演練結果（2026-10-23 隔離演練）

環境：Linux，psql (PostgreSQL) 18.6 (Ubuntu 18.6-1.pgdg24.04+2)。沒有連 Neon、Fly、Supabase。還原身分是 `neondb_owner` **NOSUPERUSER**，不是本機 superuser。

## 做了什麼

1. 建立兩個一次性本機 cluster 的 `nuni_old`／`nuni_new`，owner 為 `neondb_owner`（NOSUPERUSER）。
2. 套用精簡課班 schema、函式／觸發器、sequence、QA 與一筆一般學生作業的固定測試資料。
3. 跑 `01-export.sh` → `02-import.sh` → `03-verify.sh`。
4. 故意改列數確認核對失敗；Fly 乾跑並拒絕 pooler／缺 sslmode／錯 app。
5. QA `MODE=list`（ROLLBACK）再 `MODE=apply`；有其他學生繳交時 apply 必須失敗。
6. `06-replay-delta.sh` 乾跑不寫入，套用後只補有時間欄且有主鍵的列；略過 `schema_migrations`。

## 結果

| 項目 | 結果 |
| --- | --- |
| public 表數 | 15 |
| schema_migrations 列 | 2 |
| sequences | 1（含 rehearsal_only_seq=42） |
| 函式／觸發器 | 39／1 |
| custom dump 大小 | 40146 bytes |
| 列數／migration／sequence／extension／函式／觸發器／GRANT | 通過 |
| 列數被改時核對 | 失敗（exit 1） |
| 目標 web role 從不存在到可登入 | 0 → 1；SCRAM 驗證登入通過 |
| 私有函式對 web role 的 EXECUTE | f（應為 f） |
| PUBLIC grant／GRANT OPTION | t／t（皆應為 t） |
| 全域 default privileges 的 PUBLIC REVOKE | 新函式 EXECUTE=f（應為 f） |
| 過期 SQL receipt | 失敗（exit 1），未刪資料 |
| Fly secrets 乾跑 | 通過；pooler／缺 sslmode／多餘鍵／錯 app 被拒；未印密碼 |
| QA list 後作業列 | 1（應為 1） |
| QA apply 後 QA 作業列 | 0（應為 0） |
| QA apply 後課班列 | 1（應為 1） |
| QA apply 後老師成員 | 1（應為 1） |
| QA apply 後 nocard 學生成員 | 0（應為 0） |
| QA apply 後真實學生／真實作業／真實繳交 | 1／1／1（皆應為 1） |
| nuni_web_files 讀作業檔 | 0（應為 0，表還在且有 USAGE） |
| delta 乾跑後舊庫新帳號 | 0（應為 0） |
| delta 套用後舊庫新帳號 | 1（應為 1） |

## 限制

- 既有計畫提到的 537 張表 schema-only 備份未包含於此 repo，所以**不能**重現「539 張表／43 MB」的還原時間。本演練證明的是工具鏈、非 superuser 還原、權限／sequence／migration／失敗即停、QA 條件與 delta 安全閥。
- 沒有測 Neon TLS、Fly 重啟、真實 43 MB 資料、也沒有刪正式 Supabase 物件。
- 本機 CREATE EXTENSION 由一次性 cluster 的 postgres 先做；正式新 project 請確認 console 已啟用來源有的 extension。

## 同次離線回歸驗證

`python3 -m unittest discover -s scripts/ops/neon-migrate -p 'test_*.py' -v`：**25 項通過**，不使用外部服務。

- 空／偽 URL、pooler、缺少 TLS、重複 secret 鍵、錯誤模式、本機 URL 寫入 Fly 均被拒絕；mock Fly 不被呼叫。
- 新 role 的 `%I`／`%L`、特殊字元密碼、既有 role、過高權限／NOLOGIN role，以及失敗訊息的原始與 SQL escaped 密碼遮蔽。
- 102 個巢狀 Storage 檔案的分頁、實際檔案路徑刪除、範圍外／資料夾刪除拒絕、更新或新增檔案拒絕。
- receipt 的 DB／SQL 版本綁定、權限 600、SQL 失敗不得刪 Storage、部分刪除後續跑，以及 API 假成功的核對。
- delta 的同庫拒絕、時區與有效時間驗證、新舊 target 綁定、部分成功報告拒絕直接重試、`schema_migrations` 無法取消略過。
- shell syntax 與 `git diff --check` 通過。

新增 `Neon migration tools` workflow 會在 PR 中自動跑同一套離線測試與 PostgreSQL 18 隔離演練。遠端 workflow 尚未於此本機變更上執行；合併前仍應確認新 head 的檢查結果。
