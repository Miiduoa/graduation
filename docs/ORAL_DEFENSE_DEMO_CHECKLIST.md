# 口試 Demo 驗收 Checklist（超越 TronClass 敘事 · Golden Path）

固定 **五門 demo 課 id**：`71378`、`71282`、`71240`、`71393`、`77418`（離線／無 TronClass 時會自動出現在「學習 → 我的課程 → 課程」分頁）。

啟動建議：`cd apps/mobile && npx expo start --clear`  
離線 AI：`EXPO_PUBLIC_AI_PROVIDER=offline`（若專案有該變數）。

---

## A. 離線／無 Firebase 登入路徑

- [ ] **Today**：看得到「下一個學習動作（Demo）」卡片，點擊會進 **機器學習** 教材頁（`CourseModules`）。
- [ ] **學習 → 我的課程 → 課程**：列表含上述 **5 門 demo**，無空白「請登入 TronClass」。
- [ ] **學習 → 我的課程 → 行事曆**：頂部條「要看教室在哪？前往『課表』分頁」可切到 **課表**。
- [ ] **學習 → 我的課程 → 課表**：點任一節課 → 對話框有 **校園地圖**，會開「校園」Tab 的地圖。

## B. 八枚 chip（任選 **71378 機器學習** 跑一圈）

由「課程」列表進入該課卡，逐項點：

| Chip | 驗收 |
|------|------|
| 教材 | 有模組／教材／作業／測驗列表，無紅屏 |
| 測驗 | 有考試／小考列表或友善空狀態 |
| 成績 | 有加權／項目列表 |
| 點名 | 若為 demo 課：有智慧／多種簽到 UI |
| 討論 | 有討論串或可發文 |
| AI 學伴 | 開場白含課名；輸入「作業截止」或「模組摘要」有 **demo 資料型**回答 |
| 筆記 | 可新增筆記、不重複錯誤 |
| 互評 | 有互評任務列表或空狀態 |

## C. 線上路徑（有 PU／TronClass session，選賽）

- [ ] 同上八 chip **任一門真實課**，資料來自 `tronClassClient`，無誤跳教師權限頁。
- [ ] （選）Cloud Functions／Firebase Agent：`docs/8_LOCAL_FUNCTIONS_VERIFICATION.md` 自行抽查。

## D. 教師 Web（smoke）

- [ ] `cd apps/web && pnpm typecheck` 通過。
- [ ] 瀏覽器開發模式：`pnpm dev`，進入任一教師課程子路由（例如 `teacher/course/[courseId]/modules`）頁面可載入無 Runtime Error。

---

## E. 口試 30 秒话术提示（對照 TronClass）

> 「校方 TronClass 仍是 LMS 真源；我們把 **高频動作留進 App**（教材／繳交／影音／討論／互評等），再用 **Today、行事曆、校園地圖與 AI 學伴** 串成『今天要干嘛』——這條閉環是原生 TronClass App 較少做到的。」
