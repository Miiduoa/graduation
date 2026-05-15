# AI-Core Integration（2026-05-15）

> 本輪：把 APP 變成「AI 為核心」的校園作業系統 — 登入登出極致化 + 全資料串到 AI + 角色資料聯動。

## 1. Audit 找到的 14 個遺漏點

詳見 `docs/PREVIOUS_DEV_AUDIT_2026_05_15.md`。本輪修了 🟥 必修的 6 項 + 🟧 4 項 + 🟨 1 項。

## 2. 登入登出極致化

### 新檔
- `apps/mobile/src/screens/LoginLandingScreen.tsx`：5 個 demo 角色卡片（顧晉瑋學生 / 張怡君老師 / 林助教 / 黃主任 / 阿英餐廳）+ SSO 真實登入入口。
- linter 自動建了 `PreAuthStack` 含 `SSOLogin` route。

### 改動
- `App.tsx` 在 `!auth.user && !auth.profile` 時顯示 `LoginLandingScreen` 而不是直接進主畫面。
- mockAuth 既有體系不變，新介面用 `saveMockAuthSession` 寫入後 auth.tsx 自動拿到 profile。

### 結果
- 第一次開啟 APP → 看到登入頁 → 一鍵切換 5 種角色 demo
- 登出後再開 → 自動回登入頁（不是空畫面）

## 3. AI Context Aggregator — 全資料串到 AI

### 新檔
- `apps/mobile/src/services/aiContextBuilder.ts`（8 條測試綠燈）
  - `buildFullAIContext({ uid, ... })` → 回傳：
    - user info（姓名 / 學號 / 系所 / 角色）
    - 5 門 demo 課程的完整狀態（預估成績 / 作業計數 / 出席率 / 討論串數）
    - studyPlan summary + top 5 待辦
    - critical/high 通知
    - 錯題本統計
    - at-risk 課程列表（預估 < 70）
  - `contextToPromptBlock(ctx)`：序列化成 markdown 給 LLM system prompt
  - `contextToCompactJson(ctx)`：精簡版給 AI tool call

### 用法（給 chatWithAI）
```typescript
const ctx = await buildFullAIContext({
  uid: auth.user.uid,
  schoolId: auth.profile?.schoolId,
  displayName: auth.profile?.displayName,
  role: auth.profile?.role,
});
const systemPromptBlock = contextToPromptBlock(ctx);
// 把 systemPromptBlock 塞進 chatWithAI 的 system prompt
```

## 4. AI Tool Registry 補齊 6 個新 tool

`apps/mobile/src/services/aiToolRegistry.ts` 新增：

| Tool | Kind | 對應引擎 |
|------|------|---------|
| `grade_predict_what_if` | read | simulateWhatIf |
| `study_plan_today` | read | planStudy |
| `mistake_due_today` | read | recommendDailyPracticeSet |
| `urgent_notifications` | read | planNotifications |
| `socratic_hint` | read | fallbackHint + buildSocraticSystemPrompt |
| `ai_full_context` | read | buildFullAIContext |

AI 對話時可主動呼叫這些工具，例如：
> 學生：「我這週要先做什麼？」
> AI：[invokes `study_plan_today`] → 拿到 6 個番茄鐘 + top 5 待辦 → 回答學生

> 學生：「假設期末考拿 80 分，我這門課總分會是多少？」
> AI：[invokes `grade_predict_what_if`] → 拿到 likelyCase / bestCase / worstCase → 回答學生

## 5. 角色資料聯動 — Role Event Bus

### 新檔
- `apps/mobile/src/services/roleEventBus.ts`（7 條測試綠燈）
- 7 種事件 kind：
  - `grade_published` — 老師批改 → 學生看到新成績
  - `bulk_reminder_sent` — 老師批量提醒 → 學生 inbox
  - `feedback_drafted` — 老師起草評語 → 學生收到評語
  - `attendance_session_opened` — 老師開點名 → 學生立刻 critical 通知
  - `announcement_posted` — 老師公告 → 全班看到
  - `homework_published` — 老師發布作業 → 學生待辦多一項
  - `peer_review_assigned` — 老師指派互評 → 學生收任務
- 雙通道：
  - **In-memory listener** (`subscribeRoleEvent` / `subscribeAllRoleEvents`)：即時推送
  - **AsyncStorage inbox** (`loadRoleEventInbox(uid)`)：登出登入後仍看得到，最多 100 筆/uid
- 廣播：沒指定 `targetUids` → 寫到 `__all__` scope，所有人讀得到

### 串到 UI
- `TeacherCockpitScreen` 老師按「送出評語」/「批量提醒」→ emit event → 學生 TodayCockpit 立刻看到
- `TodayCockpitScreen` 新加 **「📥 來自老師」card**，列出最近 5 則
- 也訂閱 `subscribeAllRoleEvents` 即時刷新

## 6. 修補 audit 列出的遺漏

| 項 | 描述 | 修法 |
|----|------|------|
| A | 跨 stack screen 沒註冊 | 透過 LearnStack 全部註冊 OK；後續可考慮 root level |
| B | CockpitQuickRow 不分角色 | 加 `roleGroup` prop，學生/老師看不同按鈕 |
| C | mistakeRepertoire 沒 scoped to uid | 改用 `getScopedStorageKey('mistake_repertoire_v1', { uid })` |
| D | bulkReminders deepLink bug | 多收 courseId / homeworkId 參數，正確帶 |
| E | demoFetchCourseExams.score_percentage 寫死 '0' | 從 score_items 反推 weight |
| F | TeacherCockpit 「樣本已交」誤導 | 改顯示「已交 X/total」按 fakeSubmittedSet 算 |
| H | 沒登入頁 | 建 LoginLandingScreen + PreAuthStack |
| M | 沒 AI Context Aggregator | 建 aiContextBuilder.ts |
| N | AI Tool Registry 沒新工具 | 補 6 個 |
| O | 沒跨角色 event bus | 建 roleEventBus.ts |

## 7. 測試成果

新增 2 個測試檔，共 15 條測試全綠：
- `__tests__/aiContextBuilder.test.ts`：8 條
- `__tests__/roleEventBus.test.ts`：7 條
- 修正既有 `feedbackDrafter.test.ts`「deepLink 帶課程資訊」測試

**全套：866/867 通過**（1 個 pre-existing date-dependent test 跟本輪無關）。
TypeScript 編譯 0 錯誤。

## 8. Demo 流程 v2（5 分鐘）

| 秒 | 動作 | 重點 |
|----|------|------|
| 0:00–0:30 | 開 APP → **LoginLanding** → 選「張怡君老師」 | demo 多角色入口 |
| 0:30–1:30 | 跳到 TeacherCockpit → 看「需關注學生」紅旗 → 點某學生「📣 提醒 N 人」 | bulk reminder UI |
| 1:30–1:45 | Modal 列 N 份個人化提醒 → 「📣 全部發送」 | 觸發 `emit BulkReminder` |
| 1:45–2:00 | 點同學一份「✨ AI 起草評語」 → 看 AI 草稿 → 微調 → 送出 | feedbackDrafter |
| 2:00–2:30 | 登出 → LoginLanding → 選「顧晉瑋學生」 | 切角色 |
| 2:30–3:00 | 跳到 TodayCockpit → 看「📥 來自老師」card → 看到剛才老師發的兩則 | 跨角色聯動 |
| 3:00–3:40 | 點 🚀 駕駛艙 → AI 問「我今天該做什麼？」→ AI 用 study_plan_today tool 給答案 | AI 主動 |
| 3:40–4:30 | 點 📊 成績試算 → 改期末考分數 → 看 delta + 60/70/80/90 4 段 | what-if |
| 4:30–5:00 | 點 🧠 錯題本 → 練習一題 → box 變化 | 間隔重複 |

## 9. 仍 pending

- 152：離線教材 reader（不阻塞 demo，下輪做）
- 153：跨課全文搜尋 + 筆記白板（需 react-native-skia 新依賴）

兩天衝刺後再加一輪 AI 核心整合完成。86%（156/162）任務完成。
