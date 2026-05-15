# Demo 極致化 + 實際開發 SOP（2026-05-15）

> 本文件凍結 demo 應該長什麼樣 + 每個角色介面 + 功能 + AI 串聯，並訂出之後做正式版時要照這個樣板走。

## 1. 5 角色介面 + 功能完整對照

### 1-1. 🎓 學生（顧晉瑋 / demo_student_kuchih）

**Today（角色駕駛艙）**：`TodayCockpitScreen`
- Hero：AI 一句話建議（從 `aiSummarizeStudentInbox` 出來）
- 焦點 CTA 黑卡：next task + 預估時長 + 「開始」按鈕
- 3 個 metric chip：待辦 / 風險課 / 錯題複習
- 摺疊 sections：待辦清單、各課預估、錯題複習、來自老師 inbox
- 工具入口：AI 學伴、成績試算、錯題本

**Learn**：`CoursesHomeScreen`
- 5 門課，每張卡片 8 chips（教材/測驗/成績/點名/討論/AI 學伴/筆記/互評）
- 頂部 CockpitQuickRow：駕駛艙 / 試算 / 錯題本

**Campus / 訊息 / 我**：標準資訊（餐廳、地圖、inbox）

**AI 整合層級**：
- proactiveAIAgent.scanForStudent 5 種 suggestion kind
- aiContextBuilder.buildFullAIContext 把 5 門課狀態全餵給 AI
- aiOrchestrator.aiCommentOnWhatIf 即時試算回饋

### 1-2. 👨‍🏫 老師（張怡君 / demo_teacher_chang）

**Today**：`TeacherCockpitScreen`
- Hero：今天教學一覽 + AI 建議
- 3 metric chip：待批改 / 缺繳人次 / 🚩 紅旗
- 課程切換 chips
- 摺疊 sections：紅旗學生、評語風格、本課作業批改情況
- AI 起草評語 modal + 批量提醒 modal

**AI 整合層級**：
- proactiveAIAgent.scanForTeacher 2 種 suggestion
- aiOrchestrator.aiPreReviewGrade 批改前先預測
- aiOrchestrator.aiForecastBulkReminder 批量提醒前預測補交率
- feedbackDrafter 自動草擬評語

### 1-3. 🧑‍💼 助教（林助教 / demo_ta_lin）

**Today**：`TADashboardScreen`
- Hero：今日協助任務
- 3 metric chip：待批改 / 待回覆 / 需聯繫
- 摺疊 sections：老師指派的批改、學生提問、需聯繫學生

**AI 整合層級**：
- proactiveAIAgent.scanForTA 推待批改建議

### 1-4. 🏛 主任（黃主任 / demo_admin_huang）

**Today**：`DepartmentDashboardScreen`
- Hero：本系今日概況 + AI 系所健康度評分
- 3 metric chip：風險課程 / 待批改總數 / 平均出席
- 摺疊 sections：🚩 風險課程、課程一覽、老師工作負載
- 工具：教學評鑑、發布公告、學生 risk

**AI 整合層級**：
- proactiveAIAgent.scanForDepartment 風險警示
- aiOrchestrator.aiDepartmentHealthScore 即時健康度

### 1-5. 🍱 餐廳員工（阿英 / demo_cafeteria）

**Today**：`VendorDashboardScreen`
- Hero：店名 + 員工角色 + AI 營運建議
- MerchantSwitcher（多店切換）
- 3 metric chip：新訂單 / 製作中 / 待取
- 摺疊 sections：訂單佇列、本週熱門
- 工具依角色顯示（owner/manager/staff 不同）

**AI 整合層級**：
- proactiveAIAgent.scanForVendor 久候訂單警示
- aiOrchestrator.aiVendorNextAction 即時下一步建議

## 2. 跨角色聯動矩陣

| 動作 (Actor) | Event | 影響 (Target) | UI 反應 |
|------|--------|------|---------|
| 老師批改 | grade_published | 學生 | TodayCockpit「來自老師」+ 成績預測重算 |
| 老師起草評語 | feedback_drafted | 學生 | inbox 即時進件 |
| 老師批量提醒 | bulk_reminder_sent | 學生群 | 同上 |
| 老師開點名 | attendance_session_opened | 全班學生 | critical 通知 |
| 老師發布作業 | homework_published | 全班學生 | 待辦清單 +1 |
| **學生繳交** | homework_submitted | **老師** | TeacherCockpit 待批改 +1 |
| **學生簽到** | attendance_checked_in | **老師** | 點名面板出席名單更新 |
| **學生發討論** | discussion_posted | **老師 / TA** | 待回覆 +1 |
| **學生求助** | help_requested | **TA** | TADashboard 需聯繫 +1 |
| **學生下單** | order_placed | **餐廳** | VendorDashboard 訂單佇列 +1 |
| **餐廳完成** | order_status_changed | **學生** | 通知「餐已備好」 |
| 主任發公告 | department_broadcast | 全體 | 所有人 inbox |

## 3. AI 三層腦

```
            ┌──────────────────────────┐
            │  aiThinking 思考引擎     │  observation → inference
            │  (observeStudentState,    │  → tradeoff → ranking
            │   inferConcerns, ...)     │  → narrative
            └────────────┬─────────────┘
                          │
            ┌─────────────▼─────────────┐
            │  aiLearning 學習引擎     │  recordInteraction
            │  (computePreferenceProfile│  → discoverPatterns
            │   discoverPatterns, ...)   │  → selfReflect
            └────────────┬─────────────┘
                          │
            ┌─────────────▼─────────────┐
            │  aiSkillApplicator 應用 │  applyAndDecide
            │  + 7 條 guardrail          │  → auto_push / ask_user / block
            │  + audit log               │
            └────────────┬─────────────┘
                          │
            ┌─────────────▼─────────────┐
            │  proactiveAIAgent          │  startProactiveBackgroundLoop
            │  每 15 分鐘 scan           │  → ProactiveSuggestion
            │                            │
            │  aiOrchestrator            │  動作前後 AI 演算
            └────────────────────────────┘
```

## 4. Demo 端到端腳本（4 角色串連 7 分鐘）

| 秒 | 動作 | 重點 |
|----|------|------|
| 0:00 | LoginLanding → 選「張怡君老師」 | 角色 1 |
| 0:30 | TeacherCockpit → 點某 HW「📣 提醒 N 人」→ AI 預測補交率 → 確認發送 | aiForecastBulkReminder + emitBulkReminder |
| 1:30 | 點「✨ AI 起草評語」→ Modal 顯示 AI 草稿 → 微調送出 | feedbackDrafter + emitFeedbackDrafted |
| 2:00 | 登出 → 選「顧晉瑋學生」 | 切角色 |
| 2:15 | TodayCockpit「來自老師」card 看到剛才老師發的提醒 + 評語 | RoleEventBus 跨角色 |
| 3:00 | Learn → 點某 HW → 繳交 → demoActionSimulator.simulateStudentSubmit | 反向事件 |
| 3:30 | Today → 看 next task → 「開始 25 分鐘」（pomodoro） | studyPlanner + 焦點 CTA |
| 4:00 | 登出 → 選「阿英餐廳」 | 角色 3 |
| 4:30 | VendorDashboard 訂單佇列 → 「開始備餐」「待取」「已交付」 → AI 給下一步建議 | aiVendorNextAction |
| 5:00 | 同時學生收到「餐已備好」inbox（透過 emitOrderStatusChanged） | 雙向聯動 |
| 5:30 | 登出 → 選「黃主任」 | 角色 4 |
| 6:00 | DepartmentDashboard → AI 系所健康度 + 風險課程 → 發系所公告 | aiDepartmentHealthScore + simulateDepartmentBroadcast |
| 6:30 | 廣播後切回任一角色 → 看到公告進 inbox | 三角聯動 |
| 7:00 | Done | 5 角色都串完 |

## 5. 開發 SOP（給後續正式版照辦）

### 5.1 新增功能時
1. **判斷角色**：student / teacher / ta / department / vendor — 影響它放哪個 cockpit / chip
2. **走設計系統**：所有顏色 `theme.colors.*`、間距 `theme.space.*`、圓角 `theme.radius.*`、字體 `theme.typography.*`、border 用 `StyleSheet.hairlineWidth`
3. **走 cockpitShell primitives**：Hero / MetricRow / Section / Row / ToolChip / AccentCard
4. **跨角色資料 → 走 RoleEventBus**：emit + targetUids
5. **AI 接入**：
   - 動作前演算 → `aiOrchestrator.*`
   - 學習 → `aiLearning.recordInteraction`
   - 應用前過 guardrail → `aiSkillApplicator.applyAndDecide`
6. **Demo 模式 fallback**：若 courseId ∈ DEMO_COURSE_IDS 走 `demoCoursesAdapter`

### 5.2 寫測試
1. 純函式 → unit test (Jest)
2. UI smoke render → `@testing-library/react-native`
3. 跨角色聯動 → 用 `roleEventBus` mock 驗證
4. 新增功能後跑全套：`npx jest`，目標 ≥ 924/925 通過率

### 5.3 安全閥
- 任何寫入操作前查 `evaluateGuardrails`
- 高影響動作（urgent_action / teacher_action / department_action）→ `needsConfirm = true`
- 所有自動動作寫 `appendAuditLog`

### 5.4 命名 / 檔案 規範
- Screen：`<Role><Domain>Screen.tsx`（如 `TeacherCockpitScreen`、`VendorDashboardScreen`）
- Service：`<purpose>.ts`（如 `aiOrchestrator.ts`、`roleEventBus.ts`）
- Demo data：`demo<Domain>.ts`（如 `demoCoursesMock.ts`、`demoMerchants.ts`）
- Hook：`use<purpose>.ts`（如 `useMerchantContext.ts`）

### 5.5 PR 檢查清單
- [ ] TS `npx tsc --noEmit` 0 錯誤
- [ ] 測試全套 ≥ 99% 通過
- [ ] 新功能至少 1 條 unit test
- [ ] 用 theme tokens，零 hardcoded color
- [ ] 跨角色資料變動 → 透過 RoleEventBus
- [ ] AI 觸發點 → 過 orchestrator + guardrail

## 6. 檔案地圖（本輪總交付）

```
apps/mobile/src/
├── data/
│   ├── demoCoursesMock.ts            5 門課 mock
│   ├── demoCoursesAdapter.ts         demo → TC 形狀
│   └── demoMerchants.ts              3 家店 mock + 訂單 + 熱門
├── hooks/
│   └── useMerchantContext.ts         員工 ↔ 店家綁定
├── services/
│   ├── aiContextBuilder.ts           全資料給 AI
│   ├── aiDataInventory.ts            33 個 domain 盤點
│   ├── aiOrchestrator.ts             動作前後演算（7 介面）
│   ├── aiThinking.ts                 思考鏈（6 函式）
│   ├── aiLearning.ts                 學習 + 自我擴展
│   ├── aiSkillApplicator.ts          技能應用 + 7 條 guardrail
│   ├── proactiveAIAgent.ts           5 角色主動 scanner
│   ├── roleEventBus.ts               12 種跨角色事件
│   ├── demoActionSimulator.ts        端到端 demo 鏈
│   └── aiToolRegistry.ts             11 個 AI tools
├── ui/
│   ├── cockpitShell.tsx              共用 6 primitives
│   └── navigationTheme.ts            inline 化避免 circular
└── screens/
    ├── RoleAwareTodayScreen.tsx      Today tab dispatcher
    ├── TodayCockpitScreen.tsx        學生
    ├── TeacherCockpitScreen.tsx      老師
    ├── TADashboardScreen.tsx         助教
    ├── DepartmentDashboardScreen.tsx 主任
    ├── VendorDashboardScreen.tsx     餐廳
    ├── GradeWhatIfScreen.tsx         成績試算
    ├── MistakeRepertoireScreen.tsx   錯題本
    └── LoginLandingScreen.tsx        5 角色登入入口
```

## 7. 仍可深化（後續正式版）

- 真實 SSO 整合
- AI Skills Applicator 接 chatWithAI 後端
- 推播通知（FCM）
- 老師端 web 工作台同步
- 系所 / 校級權限再細化
