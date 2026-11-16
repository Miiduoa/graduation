# 跨功能 Agent：失物招領搜尋與活動轉個人行程

日期：2026-11-16

接續 [公開公告／活動讀取與唯讀任務接續](./2026-11-16-task-retry-public-campus.md)。本輪讓兩條已有正式來源的服務進入現有 Agent runtime，沿用既有帳號、確認卡、寫入與回執契約。

後續已加入 [活動自然語句接續](./2026-11-16-event-natural-continuation.md)：支援「把第二個加入行程」及一次查詢並預覽指定活動，並補強一般模型提議的來源保護。

## 使用流程

### 平台失物招領搜尋

支援的例子：

- 「查失物招領」
- 「找學生證的招領，查今天課表，查公車」
- 「查失物招領關鍵字『黑色 iPhone 15』」
- 「查我發布的失物招領」
- 「我的學生證掉了」：查學生證招領，不會誤解成只查自己的刊登。

Agent 呼叫既有 Platform `lost-found/list`，顯示所選校園、查詢時間、查詢條件、刊登摘要、日期、地點與來源。單次最多讀五筆，摘要最多展開三筆；有下一頁會明確標成部分結果。沒有結果只代表該查詢的已讀範圍，不代表校內沒有相關失物。

這條工具只讀取平台刊登清單。它不讀結構化聯絡方式，不讀學校 Firebase 帳號的舊刊登，也不發布、結案、聯絡、認領或匯出。列表與個別來源連結固定平台來源，避免雙重登入時跳入另一套刊登。

單項失敗不阻擋課表、公車等獨立步驟。簽署的「重查未完成項目」保留原搜尋條件與帳校範圍，只重新讀取失敗來源；不重新產生或撤銷其他行程卡。

舊 API 可能將尚未支援的平台路由交給學校登入驗證而回傳 401。Agent 沿用既有 BFF 的相容處理：只查核同一 Platform session 一次，確認仍是同一帳號才將該模組標成未接通；不重送清單。真正失效或變更的帳號仍中止任務，取消、逾時與 API 預算不被轉成一般空結果。

### 公開活動轉個人行程

1. 使用「查近期活動」，也可與公告、課表、公車等查詢合併。
2. 從已驗證結果中明確選擇一筆「加入個人行事曆」。系統不因只有一筆結果就自動選取。
3. 後端以活動的校別、原 collection 與 document ID 重查該筆活動。
4. 依來源的完整時間核對已同步課表與個人行程，產生一張確認卡。此時尚未寫入。
5. 確認時再次驗證來源、權限、行程 revision 與開始時間，沿原個人行程 writer 儲存。
6. 再讀取權威資料，只有完整記錄與原卡相符時才顯示已驗證成功。

本輪保存活動標題與起訖時間，地點僅作來源參考。加入個人行事曆不代表報名活動，不會發送推播，也不會在日後活動改期時自動同步。

來源缺結束時間、已開始、起訖倒置、非整分鐘、標題超過現有行程上限，或跨日跨度超過 31 天，都不自行推測或截短。跨日以台北時間保留 `date/endDate/startTime/endTime`。部分活動清單仍可明確選擇其中一筆，再重查原始文件；未讀其他頁面不會被宣稱為完整清單。

## 來源、身分與執行邊界

| 項目 | 實作 |
| --- | --- |
| 失物招領 | `createNuniLostFound().list()`；原 Platform session、固定 school、嚴格 request/response 驗證；不開放 cursor 給模型 |
| 公開活動單筆 | `loadCampusEvent(schoolId, id, source, guard)`；固定來源，不跨 collection 找同名 ID |
| Firebase 讀取 | 專用匿名 named app，使用 `guard.db`，不用登入中的預設 app 或 Admin 權限 |
| API 預算 | 與其餘 Agent 來源共用最多 12 次實際 API 讀取，包含 principal 查核；每次讀取受取消與 4 秒來源期限限制 |
| 活動選取 | 客戶端只有 `{schoolId, source, id}` 提示；標題、時間、來源連結由後端重新讀取 |
| 活動來源簽章 | `publicEventGuard` 簽入校別、來源、ID 與來源指紋；指紋包含名稱、時間與來源地點 |
| 確認時來源變更 | 改期、改名、換地點、刪除或不可用都不寫入舊卡；回到重新查詢與預覽 |
| 卡片生命週期 | `event-preview` 取得伺服器產生的獨立 conversation 與專用 route purpose；不能拿一般聊天 route 取代它，也不能拿它去改一般提議 |
| 原待確認內容 | 有待確認卡或尚未核對的操作時，活動入口保留原卡並提示先處理；新活動 route 不覆寫聊天 route |
| 活動卡修改 | 不套用一般行程改期／整組修改；後端亦拒絕將來源保護卡修訂為無來源保護的普通卡 |
| 重複確認 | 沿用固定 mutation ID、operation queue、revision 與完整回讀；同一卡只建立一筆 |
| 已完成記錄恢復 | reconcile／取消查核先比對已保存的精確記錄，不依賴活動來源仍存在或在線 |
| Model | 這兩條確定性查詢／準備流程 `modelCalls: 0`；結果標記 `dataRead`，不放進後續模型 history |

確認前的來源重驗只保護該次新增操作。不同預覽卡不是持久化的活動訂閱，也不宣稱具備活動 source ID 層級的全域去重；已存在的同時段記錄由原衝突檢查阻擋。

## 新增／擴充位置

- `apps/web/src/lib/nuni/assistantV2/lostFound*.ts`：嚴格搜尋語法、平台 reader 與有來源摘要。
- `publicEvent*.ts`、`campusEventGuard.ts`、`campusEventRequest.ts`：單筆來源讀取、時間／指紋契約、確定性預覽。
- `adapter.ts`、`tools.ts`、`crossService*.ts`、`taskRetry.ts`：同一 runtime 的工具與唯讀續接。
- `actions.ts`、`handler.ts`：專用 route purpose、簽章來源 guard、確認前重驗、原回執恢復。
- `apps/web/src/lib/assistantCampusEvent.ts`：不信任回應的客戶端 metadata parser。
- `features/nuni/assistant/AssistantCampusEvents.tsx`、`features/nuni/Assistant.tsx`：明確選取、來源提示、原卡保護、獨立預覽、停止與帳校變更後的晚到結果隔離。

## 上線條件與未接通範圍

失物招領 reader 沿用後端 `CAMPUS_PLATFORM_LOST_FOUND_ENABLED` 部署開關。未開放時回 unavailable，不把入口或空陣列當成已搜尋成功。活動卡保存沿用 `CAMPUS_ASSISTANT_V2_WRITES_ENABLED` 與使用者 `createPersonalEvent` 權限；寫入關閉仍可查看來源時間，但不提供可執行卡。

通知、請假與宿舍私人紀錄目前仍使用 Firebase 學校 UID／會員與角色。Platform principal 不等同這些授權，不在本輪把平台帳號當作學校 UID 讀取。公開活動也不授權活動報名或讀取參加者資料。

## 驗證

定向測試涵蓋：真實跨功能 runner、讀取重試、平台傳輸、來源同校／同文件、匿名 DB、實際 API 預算、逾時及晚到資料；活動選取、雙擊／停止、帳校變更、原卡保留、來源改期／刪除、最後權限讀取跨過開始時間、確認撤權、來源保護不可被修訂解除、重複確認，以及來源離線後仍可核對已保存回執。

完整執行結果與精確 commit 的遠端 CI 狀態記於 PR #631。測試 fixture 的成功不代表正式來源已啟用或已上線；合併仍需通過 repository 指定的真實 GitHub App 核可。
