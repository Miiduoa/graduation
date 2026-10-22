# Neon 搬遷腳本本機演練結果（2026-10-22）

環境：Ubuntu 24.04，PostgreSQL **18.6**（套件 18.6-1.pgdg24.04+2，與正式庫 18.6 同版）。沒有連 Neon、Fly、Supabase。整段工具鏈約 22 秒（schema-only＋少量種子列，不是 43 MB 正式資料）。

## 做了什麼

1. 把早上的 schema-only 備份還原到本機 `nuni_old`。
2. 套用 `280_assignment_submission_files.sql`（正式庫在 dump 之後已建這些表）。
3. 插入 CLEANUP.md 的 QA id、一條 `rehearsal_only_seq`（值 42）、以及 `nuni_web_files` 最小權限 GRANT。
4. 跑 `01-export.sh` → `02-import.sh` → `03-verify.sh`。
5. Fly secrets 腳本乾跑（`APPLY_SECRETS=no`）。另測 Neon host 缺少 `sslmode=require` 會被拒絕。
6. 在新庫跑 QA `MODE=list`（transaction ROLLBACK）再 `MODE=apply`（COMMIT）。

## 結果

| 項目 | 結果 |
| --- | --- |
| public 表數 | 539（schema dump 537 + 280 的 2 張） |
| schema_migrations 列 | 2（279、280 種子） |
| sequences | 1（`rehearsal_only_seq` last_value=42；PG 18 的 `pg_sequences` 已無 `is_called`） |
| custom dump 大小 | 2 768 127 bytes |
| 列數／migration／sequence／extension 核對 | 通過（缺 0、多 0、列數不符 0） |
| GRANT 重放 | 547 條套用、0 條跳過 |
| Fly secrets 乾跑 | 通過（未呼叫 flyctl）；缺 sslmode 的 Neon URL 會失敗 |
| QA list | 見下表；list 結束為 `ROLLBACK` |
| QA apply 後作業列 | 0 |
| QA apply 後課班列 | 1（課班本身保留） |
| QA apply 後老師成員 | 1 |
| QA apply 後 nocard 學生成員 | 0 |

QA list 預覽（apply 前）：

| 表 | 列數 |
| --- | --- |
| class_assignment_file_idempotency | 4 |
| class_assignment_submission_files | 2 |
| class_workspace_assignment_idempotency | 1 |
| class_workspace_assignment_submissions | 1 |
| class_workspace_assignments | 1 |
| class_workspace_invite_idempotency | 1 |
| class_workspace_invites | 1 |
| class_workspace_join_idempotency | 1 |
| class_workspace_members（nocard 學生） | 1 |
| class_workspace_submission_feedback_idempotency | 0 |
| class_workspace_submission_idempotency | 2 |

## 限制

- 早上的檔是 **schema-only**，沒有正式列資料，所以演練證明的是工具鏈與權限／sequence／migration 核對，不是 43 MB 正式資料的還原時間。
- schema dump 沒有 GRANT／extension／owner；演練另外補了應用程式角色。正式匯出必須用 `01-export.sh` 在停寫後現抓。
- 沒有測 Neon pooler、TLS、Fly 重啟，也沒有刪正式 Supabase 物件。
- 本機用 SUPERUSER 角色做 dump／restore。正式新 project 請用 console 建好的 `neondb_owner`（以及可選的 `nuni_web_files`），不要把密碼寫進指令歷史。
