# 我們的 APP vs TronClass — 差異化對照（2026-05-14）

> 兩天衝刺：把 TronClass「只能讓你看到資料」的被動工具，升級成「告訴你今天該做什麼」的主動學伴。
> 本輪 ship 了 7 個全新引擎 + 5 個對應 UI screen，全部本地優先、可 demo、有測試。

## 1. 引擎 / Screen / 測試 一覽

| # | 引擎 | UI Screen | 測試數 | TronClass 對應 |
|---|------|-----------|--------|----------------|
| 1 | `gradePredictor` (what-if calculator) | `GradeWhatIfScreen` | 20 | ❌ 沒有 |
| 2 | `studyPlanner` (跨課智慧排程 + 番茄鐘) | `TodayCockpitScreen` | 15 | ❌ 沒有 |
| 3 | `notificationPlanner` (智慧通知) | 整合進 TodayCockpit | 15 | ❌ 沒有 |
| 4 | `mistakeRepertoire` (錯題本 + 間隔重複) | `MistakeRepertoireScreen` | 14 | ❌ 沒有 |
| 5 | `socraticCoach` (AI 解題教練) | 整合進 AICourseAdvisor | 21 | ❌ 沒有 |
| 6 | `feedbackDrafter` (教師 AI 評語) | `TeacherCockpitScreen` | 11 | ❌ 沒有 |
| 7 | `bulkReminders` (老師批量提醒) | `TeacherCockpitScreen` | (同上) | ❌ 沒有 |

**合計：96 條新測試 ✅，TS 編譯 0 錯誤，851/852 全套通過。**

## 2. 學生端差異化（5 條核心）

### 2-1. 🚀 今日駕駛艙 (TodayCockpitScreen)

**TronClass**：學生開啟 APP → 看到課程列表 → 不知道從何下手。

**我們**：開啟 APP → AI 一句話告訴你今天該做什麼 + 用番茄鐘排好時段 + 列出 critical 通知 + 預估今日各課成績。

```
🚀 今日駕駛艙
午安，要開始今天了嗎？
今天最該處理 2 件 24 小時內到期的任務；安排 6 個番茄鐘約 178 分鐘。

[ 6 待辦 ]  [ 6 番茄鐘 ]  [ 3.0 小時 ]

🔔 立即注意 (critical / high)
  📛 已逾期：HW1 MQTT-NodeRED-通訊節點
  📝 12h 內到期：HW2 機器學習期末微專題
  ✅ 機器學習 老師開點名中

⏱ 今日番茄鐘排程
  1. 機器學習 · MQTT-NodeRED-通訊節點 (+0~25 分 / 休 5)
  2. 機器學習 · MQTT-NodeRED-通訊節點 (+30~55 分 / 休 5)
  3. 機器學習 · 期末微專題 (+60~85 分 / 休 5)
  ...

📊 各課程預估（按目前已批改 + 平均推估）
  機器學習    80% B+
  作業研究    78% A-
  ...
```

### 2-2. 📊 成績試算 (GradeWhatIfScreen)

**TronClass**：只給已批改分數，學生想推估「期末考拿 N 分總成績多少」要自己拿計算機算。

**我們**：
- 滑桿 / 輸入框：「假設這份作業拿 X 分」→ 即時看到總成績變化（與基準的 delta）。
- 三情境：悲觀（剩下都 0 分）/ 預估（用目前平均）/ 樂觀（剩下都滿分）。
- 反向：「想拿 80 分，剩下要平均幾分？」→ 標 easy / doable / hard / impossible。
- 60 / 70 / 80 / 90 一覽表：一眼看到 4 個目標的可達性。

引擎核心：`predictCurrent`, `simulateWhatIf`, `requiredToReach`, `commonTargets`。

### 2-3. 🧠 錯題本 (MistakeRepertoireScreen)

**TronClass**：考卷封閉、考完看不到、錯題沒地方收。

**我們**：
- 考完試自動把錯題收進個人錯題本（`importFromExamWrongAnswers`）。
- 間隔重複（Leitner system）：box 0 → 1 天、box 1 → 3 天、box 2 → 7 天、box 3 → 14 天、box 4 → 30 天。
- 答對 box +1，答錯 box reset 為 0。連續 3 次對 → retire (已熟練)。
- 「今天該練的題目」自動排出來；按 box 低 + 距上次練越久越前。
- 統計：吸收率 = retired / total。

### 2-4. ✨ AI 解題教練 (Socratic Coach)

**TronClass**：完全沒有 AI 教練。

**我們**：
- 5 個 hint 等級：L1 最輕（只給引導問題）→ L5 最重（給第一步具體做法但仍不給最終答案）。
- 偵測 AI 是否洩漏答案（`detectAnswerLeak`）→ 重生 hint。
- 偵測學生試圖繞過（「請直接給答案」）→ 拒絕。
- 老師可開啟「教練模式」，禁止 AI 給答案。

引擎 prompt + fallback 都已內建。`buildSocraticSystemPrompt` 給 chatWithAI 用，`fallbackHint` 在 AI 失敗時的安全網。

### 2-5. 🔔 智慧通知 (notificationPlanner)

**TronClass**：通知就是「老師發布了新作業」級的訊息流。

**我們**：13 種 kind × 4 種 severity：
- 下堂課 30 分鐘內、教室異動、作業 < 24h 到期 / 已逾期、今天考試 / 明天考試、老師開點名中、教材 3 天沒翻、新成績發布、討論回覆、學習風險紅旗、互評到期。
- 每條都有 deepLink（點通知直接跳對應 screen）。
- Cooldown 機制：同 (kind, key) 4 小時內不再推（避免騷擾）。
- 按 severity 排序：critical → high → medium → low。

## 3. 教師端差異化（2 條核心）

### 3-1. ✏️ AI 評語草稿 (feedbackDrafter)

**TronClass**：教師 30 份作業 → 30 個空白文字框。

**我們**：
- 從 rubric 評分結果 + 學生作品摘要 → 一鍵起草中文評語。
- 結構：肯定 → 具體建議（針對 weak criteria）→ 結語。
- 風格切換：嚴格 / 中性 / 鼓勵。
- Deterministic seeded rotation：每個學生抽不同句子，避免 30 份都長一樣。
- 自動標出 weak criteria（< 60% of max level）。

```
小華，整體完成度不錯，看得出你對題目有理解。

具體建議：
- 建議補強「論述清晰」這個項目：可從教材或同學作品找對照例。
- 這份作業遲交，請留意下次時間管理；可在 APP 的「今日駕駛艙」設定提醒。

若針對上述幾點修正一下，整份作業會更扎實。
```

### 3-2. 📣 Bulk Reminders (一鍵提醒沒交作業學生)

**TronClass**：老師要一個一個發訊息或寫一封群發郵件。

**我們**：
- 老師在 TeacherCockpit 看到「HW1 缺繳 12 人」→ 一鍵 → 12 份個人化提醒。
- 每位學生收到不同問候句（避免雷同）。
- 標題自動切換：未到期「⏰ 作業到期提醒」/ 已逾期「📛 補交提醒」。
- 帶 deepLink 直接跳 HomeworkSubmit。

## 4. 入口配置

`apps/mobile/src/screens/CoursesHomeScreen.tsx` 在 WeeklyFocusBanner 上方加了 `CockpitQuickRow`：4 個顯眼大按鈕

```
🚀 今日駕駛艙   📊 成績試算   🧠 錯題本   👨‍🏫 教師端
```

進入任一課程的 8 chip 仍然在原本位置不變。

## 5. Demo 腳本（4 分鐘）

| 秒 | 動作 | 重點 |
|----|------|------|
| 0:00–0:20 | 開 APP → 課程列表 → 點 🚀 **今日駕駛艙** | hero 一句話 + 番茄鐘 + critical 通知 |
| 0:20–0:50 | 點任一 critical 通知 → 跳對應 HW / 點名 | deepLink 跳轉流暢 |
| 0:50–1:30 | 回駕駛艙 → 點 📊 **成績試算** → 改期末考分數 | delta 即時更新 + 60/70/80/90 4 段目標 |
| 1:30–2:10 | 點 🧠 **錯題本** → 練習一題 → 答錯 / 答對 | box 變化 + 觸發 retire |
| 2:10–2:40 | 課程卡片 → 點 ✨ AI 學伴 → 問題 → AI 不給答案只給 hint | Socratic 行為 |
| 2:40–3:30 | 點 👨‍🏫 **教師端** → 紅旗學生 + AI 起草評語 + 批量提醒 | 老師工作 5 倍快 |
| 3:30–4:00 | 結束：總結 7 引擎 + 96 條測試 + 跟 TronClass 比 | 一行差距：「能告訴你下一步做什麼」|

## 6. 文件 + 程式碼一覽

```
packages/shared/src/lms/
  gradePredictor.ts        (新)  what-if 試算 + commonTargets
  studyPlanner.ts          (新)  跨課排程 + 番茄鐘
  notificationPlanner.ts   (新)  智慧通知 13 kinds × 4 severity
  mistakeRepertoire.ts     (新)  錯題本 + Leitner 間隔重複
  socraticCoach.ts         (新)  AI 解題教練 + answer-leak 偵測
  feedbackDrafter.ts       (新)  教師評語草稿 + bulkReminders

apps/mobile/src/screens/
  TodayCockpitScreen.tsx       (新)  學生今日駕駛艙
  GradeWhatIfScreen.tsx        (新)  what-if 互動 UI
  MistakeRepertoireScreen.tsx  (新)  錯題本 + 練習 modal
  TeacherCockpitScreen.tsx     (新)  教師端：評語 + 批量提醒
  CoursesHomeScreen.tsx        (改)  加 CockpitQuickRow 4 按鈕入口
  LearnStack.tsx               (改)  註冊 4 個新 screen

apps/mobile/src/__tests__/
  gradePredictor.test.ts       20 pass
  studyPlanner.test.ts         15 pass
  notificationPlanner.test.ts  15 pass
  mistakeRepertoire.test.ts    14 pass
  socraticCoach.test.ts        21 pass
  feedbackDrafter.test.ts      11 pass
  ─────────────────────────────────
  合計新增：96 條測試全綠

回歸：apps/mobile 全套 851/852（1 個 pre-existing date-dependent test）
```

## 7. 還想做但暫緩

- 離線教材 reader + annotation（task 152）：技術可行，但本輪先把 7 引擎完整 ship。
- 跨課全文搜尋 + 筆記白板（task 153）：需要加 react-native-skia，本輪先不引依賴。

兩天衝刺結束。Demo 隨時可錄。
