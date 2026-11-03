# 平台帳號公開任務入場候選

這個切片處理「本人確認 → 一次性任務入場 → 查詢待處理／結果不明狀態」。
`claimed` 只代表已占用配額及取得一次執行權，不表示模型已執行或 Agent 已完成任務。
目前沒有 provider、執行 worker、HTTP 路由或前端接線；未加入任何建置／migration manifest。
`schema.candidate.sql` 沒有正式編號，這輪沒有執行它或更動資料庫權限。

## 身分與資料

- `PlatformPublicAdmission` 使用既有 `PlatformAccountService.resolveSession`，由已驗證的 Platform handle 派生 session hash；不接受 JSON 裡的 owner、角色、學籍、Firebase uid 或校園 revision。
- 交易內沿用正式 API 的密碼登入條件：password credential 仍須有效的 platform-operator 指派；一般 OAuth credential 不因此要求管理員資格。這不授予任何新角色。
- 僅接受 `campus-service-entry` 與 `public-campus-navigation`。資料與明確確認須相符，provider 固定為 Groq、model 固定為 `openai/gpt-oss-120b`。這個模型選擇不是帳戶免費額度已驗證的證明。
- 校園是使用者選定的公開資料範圍，不是學校會員資格。語意入口只是導覽建議，目的頁原權限維持。
- 導航確認與入場都必須經 server-owned 公開來源讀取器重驗 fingerprint。這裡只有必要介面，沒有用客戶端地點取代真來源，也沒有註冊 Firebase 私人 fetcher。
- ledger 不保存原文、session handle、個人資料或模型輸出；確認／操作保留內容雜湊、帳號與 session 綁定、校園、任務及期限。

## 一次性入場

`confirm(authorization, { approved: true, request })` 產生有期限的確認識別碼；相同內容重試不延長期限，也不扣配額。
`claim(authorization, { confirmationId, request })` 必須帶同一份確認內容。
同一筆交易重驗有效帳號、credential 與真 session，消耗確認，扣帳號及共用 provider budget，建立操作。
`read(authorization, { task, requestId, schoolId })` 只查既有狀態，不啟動工作。

操作唯一鍵是 `(platform_account_id, task, request_id)`。換 session、校園、模型或內容不能藉同 ID 再執行。
相同綁定重試只回 pending／unknown，不重新占用配額；running 到期轉 unknown，不回收執行權。
未知提交回應或取消期間的晚到提交，不可當作「沒有寫入」而自動重送。
帳號及 provider budget 來自伺服器設定，不接受 request 覆寫；此計數不等於供應商的實際 token／組織額度。

每帳號確認紀錄預設上限 1000 筆（伺服器可設 1–10000），過期及已消耗紀錄也計入；滿額回 429，既有確認重試仍可查回。
本輪不自動清理紀錄，避免遺忘 request ID 或未知結果。啟用前須決定容量用盡後的保留政策。
操作仍引用的確認不可單獨刪除；候選外鍵採延後檢查，帳號關閉仍依序刪除操作、確認與帳號配額。

來源與身分是分次檢查，並非跨來源的原子快照。來源最後讀取後仍可改變；未來執行前與結果交付前仍須重驗。
目前沒有 completed 狀態、任務結果或可對使用者宣稱成功的回執。

## 驗證與啟用前缺口

```sh
node scripts/test-platform-public-agent.mjs
```

Node 22 runner 先做嚴格 TypeScript 編譯，再用合成 resolver／來源／交易 adapter 測輸入、身分、去重、回滾、配額及逾時。
測試不連資料庫、不執行 SQL migration、不送 provider。模擬交易通過不能取代 PostgreSQL 跨程序隔離、FK、鎖與提交故障驗收。

介面來源為 `Miiduoa/nuni-prod` 的固定基底 `9de47b4b3492325e430562c37bcad552867162db`：
`apps/api/src/database.ts` 與 `accounts/platform-account-service.ts`；並沿用本 repo personal-import-sync 的鎖定順序。
另以 `security/source.json` 綁定的正式 patch 核對 account service：基底 blob `e0b0b883` 套用該檔兩個 hunks 後得到 `ea74d772`，與正式 patch 一致；包含密碼登入的管理員指派條件。
這是介面與單檔核對，尚未重建整份正式 API。repo 的正式來源記載為 `be815455`／`b0a10ac`，不能把歷史 v20 manifest 當作本輪正式驗收。

啟用前仍需核實完整組合來源、真 migration manifest／runtime grants、資料保留與清理政策，以及真 PostgreSQL 交易／逾時設定。
HTTP 等待期限不會取消已開始的資料庫交易；鎖等待、statement timeout、延後外鍵及帳號關閉 cascade 都尚待真 PostgreSQL 驗證。
管理員指派的讀取與 row-lock 權限也須核實；本輪未新增 GRANT，已知鎖定順序核對不代表所有正式撤銷路徑皆已驗證。
還缺受審的公開 POI reader、兩個固定公開 executor、有限公開結果驗證／來源回驗，以及合法免費環境和逐次資料外送同意。
這個候選不會建立帳號或學籍、配置 key、修改 billing、套用 migration、啟用 route 或部署。
