# Campus One 產品完成盤點（2026-10-23）

範圍對齊 [PRODUCT_ACCEPTANCE_2026-10-11.md](./PRODUCT_ACCEPTANCE_2026-10-11.md) 的 13 個領域。狀態依本 clone（`cursor/product-completion-20261023`，base `20df7c84`）原始碼與本輪測試，**不代表已部署、校方開放或商店上架**。

圖例：`既有未驗證`＝程式在、缺真實驗收；`缺實作`＝合約或 UI 未完成；`外部依賴`＝校方／金流／商店；`併行工作`＝其他 Cursor 負責；`本輪已證`＝本分支有行為測試通過。

| # | 領域 | 現況摘要 | 檔案／合約參考 | 角色工作流與通過條件 | 剩餘阻礙 |
| --- | --- | --- | --- | --- | --- |
| 1 | 帳號、多校 | 既有未驗證。Google／學生證選項與學校資格分流存在；NuniSession 不建立 Firebase user。 | `apps/web` AuthGuard；sign-in-options `google:true,studentId:false` | 同身分跨端登入、撤權後拒讀 | 真 Google／Firebase 學校身分對齊（外部＋產品） |
| 2 | 課表、成績、學分 | 既有未驗證；資料依學校整合。**成績通知導頁本輪已證（學校帳號候選）**：真實 producer `{type,gradeId,schoolId,channel}` → LearnStack `Grades`，不做作業繳交。 | `firestoreTriggerHandlers.js`；`notificationDestination.ts`；LearnStack `Grades` | 同校學生／教職員開成績；跨校／vendor／guest 拒開 | 校務原始成績核對；Firebase 學校身分 |
| 3 | 課程、教材 | 既有未驗證。併行 LMS 工作中，本 clone 不改。 | course／classroom | 教師發布、學生取得、封存唯讀 | 併行 LMS；真機大檔 |
| 4 | 作業、測驗、評分 | 既有未驗證。併行 LMS，本 clone 不改。 | assignment／quiz 流程 | 截止、補交、改分閉環 | 併行 LMS |
| 5 | 點名、請假 | 既有未驗證；請假未完整開放。 | attendance handlers | 真機掃碼、撤權 | 真機＋請假產品 |
| 6 | 通知、私訊 | **本輪已證（學校帳號候選）**：共用目的地；已讀 false 不導頁；**推播 hook 實際傳入 `auth.profile?.schoolId`**（跨校成績拒開有 adapter 測試）。 | `usePushNotifications.ts`；`App.tsx` SchoolNavigation；通知中心 | 點通知／推播→授權路由；跨校拒開；分頁＞50 | Firebase 學校身分；實機推播未驗；Google-only 不宣稱可用 |
| 7 | 社群、活動 | **本輪已證（討論）**：不可變 publication intent；衝突不自動換 ID；`runTransaction` 原子建立／同內容確認／異內容拒覆寫。擁有權移轉仍缺。 | `GroupDiscussion.tsx`；`groupDiscussionService.ts`（transaction）；rules 未放寬 | 成員讀寫；lost-result 同 intent 重試；衝突需明確「開始新貼文」 | **缺** transfer ownership API；行事曆併行 |
| 8 | 地圖、交通 | 既有未驗證；站牌對照有邊界。 | bus／map | 真實 TDX／定位 | TDX 憑證與對照 |
| 9 | 餐飲、店家、支付 | 既有未驗證；限啟用到店現金。 | shops／merchant／orders | 接單、取消通知基線 | 金流／真店家（外部）；不造假支付 |
| 10 | 圖書館 | 既有入口；續借屬館方系統。 | library | 官方帳戶交接 | 館方系統（外部） |
| 11 | 宿舍、校園服務 | 正式入口未開放／示範標示。 | dorm 相關 | 不冒稱校方收件 | 校方後端（外部） |
| 12 | 管理、治理 | 既有有限稽核。**Admin 分頁／匯出併行其他 Cursor，本 clone 不改。** | AdminDashboard（勿動） | 稽核完整分頁 | 併行 admin 工作 |
| 13 | Web/App 發布、無障礙、隱私 | 既有檢查腳本；商店／簽章未驗。 | STORE_RELEASE、readiness scripts | 簽章包、OAuth、a11y | 部署憑證、商店審核（外部） |

## 本輪實作邊界

- 通知與群組討論標為 **Firebase 學校帳號候選**：生產 sign-in 以 Google 為主且 Nuni 不建立 Firebase user 時，不能宣稱現有 Google 使用者可用。
- 不合併身分系統、不略過成員資格檢查、不假造擁有權移轉或支付／續借／宿舍收據。
- 競品僅作工作流基線（Discord 活動、Google Calendar 期限、Shopify 訂單狀態），不宣稱功能對等。

## 本輪驗證（以 result 檔為準）

見 `../cursor-product-result.md`：聚焦 mobile 通知／notifications state、web groups discussion 測試與受影響 typecheck／lint。單元通過 ≠ 正式服務驗收。
