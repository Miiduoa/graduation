# 校園 AI Agent · 口試交付包 v3

> 🤖 主軸：**AI 能代理完成所有事** · 跨服務 · 跨角色 · 跨工具
> 2026-05-16 v3 / 口試 5/23 / 組員：周攸晨、顧晉瑋、楊世堅、吳容陞

## v3 vs v2 重大升級

| 面向 | v2 | v3 |
|------|------|------|
| 主軸 | AI 駕駛艙（智慧建議） | 🤖 **AI Agent 自動代理**（Plan → Execute → Verify） |
| 新 service | — | **aiAgentRuntime.ts**（intent registry + 引擎） |
| 新 screen | — | **AIAgentConsoleScreen**（agent 駕駛室） |
| 新 component | — | **AgentSummaryBanner**（5 cockpit 共用） |
| Agent intents | — | **9 個**（學生 2、老師 2、TA 1、主任 2、餐廳 2） |
| Autonomy Mode | — | **3 段**（assistive / collaborative / autonomous） |
| PPT 張數 | 22 | **25 張** |
| Demo 長度 | 10 分鐘 | **11 分鐘**（含 Agent Console 演示時段） |
| 影片數 | 13 | **14**（新增 V14 agent 主秀） |
| 截圖數 | 18 | **20**（新增 S19/S20 agent console） |

## 4 份 v3 檔案（都在 `/Users/miiduoa/Desktop/畢業專題/`）

| 檔案 | 內容亮點 |
|------|------|
| `口試簡報_v3.pptx` | 25 張，包含 AI Agent 3 段生命週期架構圖、9 intents 矩陣、Plan 範例、Autonomy 三段比喻卡 |
| `口試Demo主持腳本_v3.docx` | 11 分鐘逐秒主持稿、每角色 agent demo 時段、Q&A 10 條（含「跟 ChatGPT 差在哪」） |
| `角色資料畫面對照矩陣_v3.xlsx` | 9 個 sheet，新增「AI Agent intents 矩陣」、「Autonomy Mode 決策表」、「Agent vs Chatbot」 |
| `口試交付包_README_v3.md` | 本檔 |

## Code 變動清單

### 新增 4 個檔案
1. **`apps/mobile/src/services/aiAgentRuntime.ts`** — Plan-Execute-Verify 引擎，9 個 intent，3 段 autonomy mode，AsyncStorage 持久化
2. **`apps/mobile/src/screens/AIAgentConsoleScreen.tsx`** — agent 駕駛室畫面（autonomy 切換 + 4 sections + plan 卡片 + verify 顯示）
3. **`apps/mobile/src/components/AgentSummaryBanner.tsx`** — 5 cockpit 共用 banner（「AI 今日代你完成 N 件」）
4. **`apps/mobile/src/screens/LearnStack.tsx`** 註冊新路由 `AIAgentConsole`

### 修改 6 個檔案
1. **TodayCockpitScreen.tsx** — hero 下加 AgentBanner
2. **TeacherCockpitScreen.tsx** — hero 下加 AgentBanner（線上 user 又加了請假審核功能）
3. **TADashboardScreen.tsx** — hero 下加 AgentBanner
4. **DepartmentDashboardScreen.tsx** — hero 下加 AgentBanner
5. **VendorDashboardScreen.tsx** — hero 下加 AgentBanner
6. **roleEventBus.ts** — `ALL_ROLE_EVENT_KINDS` 補上新增的 3 個事件（leave_requested / leave_decision / dorm_repair_requested），否則 subscribe 又會漏

### 驗證結果
- **TypeScript**：與 demo flow 相關 0 錯誤
- **PPT**：25 張全部 render 通過（emoji 在 PowerPoint / Keynote 開會正常）
- **AI Agent runtime**：9 intents 都可在 Console 觸發

## 🤖 AI Agent 9 個 intents 速查

| ID | 角色 | Intent | 一句話 |
|----|------|--------|--------|
| S1 | 🎓 學生 | student.daily_arrange | AI 排今日 + 自動訂便當 |
| S2 | 🎓 學生 | student.exam_prep | 考前 3 天自動排複習 + 邀學伴 |
| T1 | 👨‍🏫 老師 | teacher.bulk_feedback | 5 份評語批量草擬 + 缺繳提醒（demo 主秀） |
| T2 | 👨‍🏫 老師 | teacher.risk_student_outreach | 紅旗學生關懷 |
| TA1 | 🧑‍💼 助教 | ta.auto_reply_help | 求助自動草擬回覆 |
| D1 | 🏛 主任 | department.risk_followup | 風險課程任課老師關懷 |
| D2 | 🏛 主任 | department.weekly_broadcast | 本週系所重點自動產出 |
| V1 | 🍱 餐廳 | vendor.long_wait_notify | 20+ 分鐘久候自動補時 + 折扣券 |
| V2 | 🍱 餐廳 | vendor.peak_prep | 預測尖峰前自動推員工備料 |

## Autonomy Mode 三段（使用者可選）

| Mode | 走法 | 適合誰 | 比喻 |
|------|------|--------|------|
| 🛡 **assistive** 完全詢問 | 所有 step 都要 user approve | 新使用者 | AI 是副駕 |
| 🤝 **collaborative** 協作（預設） | low/medium 自動跑、high 跳 confirm | 一般使用者 | AI 是實習生 |
| 🚀 **autonomous** 全自動 | 全自動跑 + 事後審計 | 重度使用者 | AI 是代理人 |

## 5/23 之前必做的事

### Code 層
1. **錄製 V14（agent console 主秀影片）** — 最重要
2. **截 S19 / S20**（agent console 主畫面 + plan 詳細）
3. **demo 前 5 分鐘預先觸發 2-3 條 agent task**（讓「完成」數字不是 0）
4. 之前 v2 列的：補 expo-speech / 把 AIStudyBuddy 接進更顯眼的 nav 入口

### Demo 排練
- 4 組員照 docx 11 分鐘逐秒表跑一次
- 注意 0:20 / 3:00 / 6:00 / 8:00 四個 agent intent 觸發點
- 強調 Plan-Execute-Verify 三段
- 強調 Autonomy Mode 三段

## 13 條重要 Q&A 速查（完整版在 docx）

- **「跟 ChatGPT 差在哪」**：ChatGPT 一問一答；我們 Plan-Execute-Verify 三段，可跨服務代你跑、可離線、可審計
- **「跟 OpenAI Operator 差在哪」**：離線 + 校園專用 + 開源
- **「AI 失控怎辦」**：7 條 Guardrail + Autonomy 三段 + killSwitch + dynamicQuietHours
- **「Plan 怎麼生成」**：intent registry 是 typed factory，不是 LLM 即興
- **「Execute 真能跑跨服務」**：simulator 級別已通；真實 LMS 寫入是 v4
- **「Verify 怎麼確定 AI 沒亂搞」**：plan.results 每 step status；verify 算 success/total
- **「9 個 intent 太少」**：plug-in 架構，加一個 IntentDefinition 就出現在 Console

## 🎬 demo 9 段必拍（重要程度排序）

1. **V14 ⭐⭐⭐** — AI Agent Console 全流程（最重要！）
2. **S19 / S20 ⭐⭐⭐** — Console 主畫面 + Plan 展開含 Verify
3. V03 — 老師 AI 起草評語 Modal（含 AI banner）
4. V05 — 雙手機學生下單 → 餐廳即時 +1
5. V04 — 學生 cockpit + 跨角色 inbox
6. V08 — 主任廣播 → 學生即時收到
7. V12 — Web 8 角色切換 + 攔截卡
8. V09 — AI 學伴配對 4 維評分
9. V11 — OnBusMode 沉浸式搭車

存到 `/Users/miiduoa/Desktop/畢業專題/demo-media/` 並依檔名規範存好。

## 加油！5/23 一戰成名。

> 我們不是做另一個 chatbot，我們做的是真正能「代理你完成所有事」的 AI Agent。
> Plan-Execute-Verify、跨服務、跨角色、可審計、可離線 — 這就是我們跟 ChatGPT 的本質差別。

