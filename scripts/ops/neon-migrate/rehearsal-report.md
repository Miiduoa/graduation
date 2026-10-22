# Neon 搬遷腳本本機演練結果（2026-10-22 審查後重跑）

環境：Ubuntu 24.04，PostgreSQL **18.6**。沒有連 Neon、Fly、Supabase。還原身分是 `neondb_owner` **NOSUPERUSER**，不是本機 superuser。

## 做了什麼

1. 建立本機 `nuni_old`／`nuni_new`，owner 為 `neondb_owner`（NOSUPERUSER）。
2. 套用精簡課班 schema、函式／觸發器、sequence、QA 與一筆真實學生作業。
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
| 函式／觸發器 | 38／1 |
| custom dump 大小 | 39833 bytes |
| 列數／migration／sequence／extension／函式／觸發器／GRANT | 通過 |
| 列數被改時核對 | 失敗（exit 1） |
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

- 這次沒有早上那份 537 張表的 schema-only 備份（不在此環境），所以**不能**重現「539 張表／43 MB」的還原時間。本演練證明的是工具鏈、非 superuser 還原、權限／sequence／migration／失敗即停、QA 條件與 delta 安全閥。
- 沒有測 Neon TLS、Fly 重啟、真實 43 MB 資料、也沒有刪正式 Supabase 物件。
- 本機 CREATE EXTENSION 仍由 unix peer 的 postgres 先做；正式新 project 請確認 console 已啟用來源有的 extension。
