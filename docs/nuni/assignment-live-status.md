# 作業狀態同步

nuni 自有課程使用 class-workspaces 授權 HTTP 端點。主清單與教師最後選取且可見的一份收件，各在上次讀取完成後等待 2.5 秒補讀，同一流程最多一筆在途請求。只有目前課程的作業分頁自動更新；隱藏頁面、pagehide、背景、離線與其他分頁停止排程，回前景補讀。搜尋隱藏或收合收件也停止該份更新。

「已同步」只代表最近一次伺服器清單讀取成功，時間來自裝置。送出仍以伺服器確認收據為準。背景事件作廢舊世代；本機寫入增加 revision，較早的讀取不能覆蓋新收據或回饋。401、403、404 或工作階段變更清空、停止並解除訂閱。手動與自動收件串行，草稿保留。非權限錯誤採 5、10、20、40、60 秒退避，成功後回到 2.5 秒。已送出的 HTTP 不取消伺服器執行。

## 2026-11-01 合成驗收

本次選用合成負載，沒有部署、讀取環境檔、連線正式資料庫、執行資料搬移或新增服務。測試使用虛擬時間，所有上游 fetch 都替換為只接受 `https://synthetic.invalid/` 的記憶體端點，其他路徑直接失敗。BFF 的附件索引明確選用測試用記憶體儲存。

### 實際資料路徑與 Spark 額度

不能將 HTTP 次數直接當成 Firestore 文件讀取：

- Web 的 `NuniApp.tsx`、Mobile 的 `NuniCourses.tsx` 都呼叫共用 `createNuniClasses().assignments()`。
- `apps/web/src/lib/nuni/api.ts` 的清單路由依序讀上游作業、課程與身分，並呼叫 `hydrateAssignmentFiles()`；`server.ts` 的 `platformRequest()` 使用授權 HTTP。
- 附件索引由 `assignmentFileStore.ts` 使用 PostgreSQL 或測試用記憶體實作。這條路徑沒有 Firestore SDK 讀取。上游既有 PostgreSQL 架構另見 [課班存取設計](../course-access-review.md) 與 [平台發布紀錄](../PLATFORM_RELEASE.md)。未把測試用記憶體的成本冒充 PostgreSQL 實測成本。
- [Firebase 官方配額](https://firebase.google.com/docs/firestore/quotas)為每天 50,000 次文件讀取；[計費說明](https://firebase.google.com/docs/firestore/pricing)也指出查詢文件、規則相依讀取等需要另計。這是整個資料庫的配額，不是每位使用者各有五萬次。

本功能的 Firestore 讀取增量：**每位使用者每小時 0 次；2,000 名活躍學生每天 0 次，占 Spark 每日 50,000 次的 0%**。即使全日開啟，本功能也不扣這個文件讀取額度。既有其他功能仍會使用自己的額度，本次沒有查詢它們的使用量。這項結論限定目前的 PostgreSQL／HTTP 架構，不能推廣到其他 Firestore 功能或未來改接的端點。

### 負載方法與數據

可重跑的測試：`apps/web/src/lib/nuni/assignmentLiveAcceptance.test.tsx`。

第一個案例執行真正的 `startAssignmentLive`、共用清單解析、`NextRequest`、`handleNuni`、授權檢查及附件清單補齊；僅最末端上游／儲存替換為合成實作。10 個獨立排程同時前景運行 600,000ms，每次清單含 100 份作業、每份標示 100 份合成收件；學生不下載教師整份收件名單。此案例沒有聲稱實際產生或讀取一萬份收件文件。上游每次讀寫均注入 100ms；每次完整清單需三次依序上游讀取，因此讀取耗時 300ms，穩態週期 2,800ms。每 15 秒發起一次發布，共 40 次；計時起點在發布請求之前，包含寫入等待與輪詢相位，10 個客戶端共得到 400 筆觀測。

| 項目 | 本次結果 |
| --- | ---: |
| 每位學生 10 分鐘 HTTP 清單讀取 | 215 次 |
| 10 人清單讀取合計 | 2,150 次 |
| 上游 GET 合計（作業、課程、身分） | 6,450 次 |
| BFF 清單 JSON 回傳量（UTF-8，未壓縮） | 67,096,660 bytes |
| 發布至共用清單接收 p95／最大值 | 2,900／3,100ms |
| Firestore 讀取 | 0 次 |

每小時及每日的計算，明確保留 HTTP 與文件讀取兩種單位：

| 情境 | 每人每小時 HTTP 清單讀取 | 2,000 人每天 HTTP 清單讀取 | Firestore 每日讀取 |
| --- | ---: | ---: | ---: |
| 本次 10 分鐘樣本線性外推、每天前景 1 小時 | 215 × 6 = 1,290 | 2,580,000 | 0 |
| 同樣外推、每天前景 24 小時 | 1,290 | 61,920,000 | 0 |
| 零延遲端點，每個小時都另計一次首次讀取，24 小時保守估計 | 1,441 | 69,168,000 | 0 |

300ms 端點的連續一小時理論次數為 `floor(3,600,000 / 2,800) + 1 = 1,286`；1,290 是直接將含首次讀取的樣本乘六，略為保守。零延遲穩態為每人每小時 1,440 次。教師另開一份收件時增加一條類似排程，不包含在 2,000 名學生情境；背景／其他分頁的定期讀取為零，已有兩端回歸測試保護。

反證：若未來改成每次 HTTP 至少讀一份 Firestore 文件，僅每天前景一小時就需 2,580,000 次，超過五萬次約 51.6 倍；若每次讀 100 份文件還需乘 100。不能把現在的輪詢直接移植成 Firestore 查詢。僅延長到幾秒或失敗退避也無法解決這種額度問題。現行程式未走該路徑，因此本次沒有為了不適用的 Spark 文件額度更換儲存或新增服務。

### 發布至畫面可見的全鏈路

同一驗收檔的第二個案例從 `createNuniClasses().createAssignment()` 發起發布，經真實 BFF POST、合成儲存、真實 BFF GET、共用解析、2.5 秒排程，再更新真正的 `CourseAssignments`／`AssignmentCard` React 元件，以可存取的作業 article 出現為終點。不是以 fetch 完成或同步狀態當作可見。先完成一次舊清單，緊接著發布，以涵蓋接近完整輪詢等待的相位；每 50ms 檢查畫面。40 次發布觀測的 **p95 = 2,800ms、最大 = 2,800ms，均低於 5,000ms**。

此外，`NuniApp.test.tsx` 與 Mobile `NuniCourses.test.tsx` 各自執行實際課程畫面生命週期與清單更新，在合成寫入 200ms、讀取 300ms 條件下，從共用發布呼叫開始到學生畫面出現新標題，兩端皆為 **2,800ms**。Mobile 以真正的畫面文字作為終點；Web 以課程作業導覽中可見的作業連結作為終點，該檔既有卡片替身不拿來當完整卡片驗收。

兩個層次互補：完整 BFF 至卡片案例驗證端到端資料路徑，兩端畫面案例驗證各自接線。所有時間均為合成虛擬時間，包含設定的寫入、讀取、排程等待與 React 更新；不包含實機繪製、真實網路抖動、真實資料庫排隊或裝置 CPU。**五秒門檻在上述合成條件通過，不是正式環境 SLA。** 離線、背景或錯誤退避期間不承諾五秒。

### 容量結論的範圍

Spark 文件讀取與合成五秒門檻已驗收；不能由此宣布全部服務在 2,000 人持續前景下免費。測得的 HTTP 負載很高，未壓縮回傳量若照樣本外推，全日 2,000 人約 1.93TB／日，且真實 PostgreSQL 還有附件索引及上游查詢成本。100 份清單在本地索引補齊時會呼叫 100 次 `countWithdrawn()`；目前正式 SQL 實作會各執行一次查詢，測試用記憶體不產生 SQL。6,450 次上游 GET 也不等於 6,450 次 SQL。

本次沒有量測正式剩餘 CU-hours、SQL 執行時間、壓縮後 egress 或其他功能既有用量，無法判定 PostgreSQL／主機的剩餘免費容量。若發布決策要求「整套服務皆在剩餘免費額度內」，仍須在有用量資料的隔離環境驗收；保留該發布阻擋，不能以 Spark 零讀取消除它。本次沒有部署或宣稱可直接正式上線。

## 重跑與回歸

所有命令設定 `EXPO_NO_DOTENV=1`，暫存與 Mobile 快取使用本次專屬 `/tmp/jest_rs/nuni359-fix3`；Web 使用 `--no-cache --maxWorkers=2`。安裝僅在工作目錄沒有 node_modules 時執行 `pnpm install --frozen-lockfile`，結束清除本次安裝與暫存。

- Web：assignmentLive、AssignmentCard、CourseAssignments、NuniApp、CourseMaterials、CourseMaterialSearch、NuniMaterialAccess、shareCourseMaterial、assignmentLiveAcceptance、assignmentFileRoutes。
- Mobile：assignmentLive、NuniCourses、CourseMaterialViewerScreen、lmsV2MaterialAccess。
- 全專案：`pnpm typecheck`、`pnpm lint`、`git diff --check`。
- 本次結果：Web 十檔 190 項、Mobile 四檔 120 項通過；typecheck、lint、差異空白檢查皆通過。lint 有既有 694 個警告、零錯誤。Node 24.22.1 超出專案要求的 20／22，命令有版本警告；未造成檢查失敗。
- 既有測試涵蓋撤權、登出、背景世代、回前景補讀、失敗退避、慢收件串行、本機回饋防舊快照覆蓋、教材分享及撤權回歸。

實機仍應檢查跨端送出／撤回／回饋、草稿保留、隱藏／收合停止、離線重連、登出與撤權清空、讀屏播報頻率及小螢幕。這些檢查不冒充本次合成測試已覆蓋的實機驗收。
