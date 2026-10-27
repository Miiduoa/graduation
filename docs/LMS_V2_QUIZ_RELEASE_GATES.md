# LMS v2 測驗發布驗收

範圍：`apps/mobile/src/screens/lmsV2/`、`apps/mobile/src/services/lmsV2QuizDelivery.ts`、Supabase `graduation` 專案。

## 產品契約

1. 開啟測驗頁只能讀取測驗名稱、規則與本人作答紀錄，不會建立新嘗試或提前公開題目。
2. 學生點「開始作答」才呼叫 `start_quiz_attempt(p_quiz_id)`；若同一筆尚未交卷，須恢復該筆，不再消耗次數。
3. 所有答案寫入 `quiz_answers(attempt_id, question_id, answer)`。單選、多選使用 `optionIds`；是非題用 `value`；簡答與申論用 `text`。
4. 單題儲存需要伺服器回執，且每次核對本人、測驗、題目與抽題結果；送出前按順序儲存未確認的變更。
5. 正式交卷只能呼叫 `submit_quiz_attempt(p_attempt_id)`，必須核對本人 `quiz_attempts` 的 `submitted_at` 與 `score`。申論題分數可能仍待人工補評。
6. 讀取不完整、授權拒絕、時間限制錯誤、回執缺失時，不能顯示「已儲存」或「已交卷」；學生仍可保留畫面上的未儲存答案。

## 尚未完成的正式資料庫發布閘門

2026-10-26 以唯讀 SQL 查詢 Supabase `graduation` 的 ACL，結果 `authenticated` 對 `public.quiz_answers`：

| 權限 | 查核結果 |
| --- | --- |
| SELECT | 有 |
| INSERT | **沒有** |
| UPDATE | **沒有** |
| DELETE | 有 |

同一資料庫中，`start_quiz_attempt(uuid)` 與 `submit_quiz_attempt(uuid)` 已存在且 `authenticated` 可執行。這代表**目前正式環境無法驗證答案的新增／修改閉環**；前端功能與 CI 通過不能替代此發布閘門。

Repository 既有的 `supabase/migrations/20261021055702_explicit_data_api_privileges.sql` 已明確列出 `grant select, insert, update, delete on table public.quiz_answers to authenticated;`，但本次檢查未發現對應的近期 migration 歷史。務必先核對正式環境 schema drift、現有 RLS／grants 與 migration 記錄，再依既有資料庫發布程序安全套用經審查的 ACL，不要在使用者端放 `service_role`，也不要對所有資料表全面開權限。

可重跑的唯讀查核：

```sql
select
  has_table_privilege('authenticated', 'public.quiz_answers', 'SELECT') as can_select,
  has_table_privilege('authenticated', 'public.quiz_answers', 'INSERT') as can_insert,
  has_table_privilege('authenticated', 'public.quiz_answers', 'UPDATE') as can_update,
  has_table_privilege('authenticated', 'public.quiz_answers', 'DELETE') as can_delete,
  has_function_privilege('authenticated', 'public.start_quiz_attempt(uuid)', 'EXECUTE') as can_start,
  has_function_privilege('authenticated', 'public.submit_quiz_attempt(uuid)', 'EXECUTE') as can_submit;
```

只有完成以下流程才能解除 BLOCK：

1. DBA 審核現有 migration 對所有資料表的授權效果，先在隔離環境套用，檢查 RLS 不會擴大跨學生、跨課程資料存取。
2. 完成正式遷移記錄與執行證據，重新查核 `INSERT`、`UPDATE`、`SELECT` 與 RPC 權限。
3. 使用**測試身分與測試課程**實際完成：開卷不消耗次數、明確開始、五種題型儲存／清除、斷線恢復、伺服器交卷、人工補評。另用不同學生、不同課程驗證互相不可讀寫。
4. 驗證測驗時間限制、作答次數、抽題池、無解答提前洩漏，以及 App 重啟後的回執與錯誤狀態。
5. 驗證現有 LMS v2 feature flag／development-demo 條件；另由正式上線檢查決定是否能擴大開放。

這份報告不代表真實測驗已在正式環境驗證通過，也未對正式資料庫進行資料寫入或 ACL 修改。
