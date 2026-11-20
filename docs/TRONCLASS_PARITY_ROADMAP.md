# TronClass Parity 落地 Roadmap

> 對應 `TRONCLASS_PARITY_INTEGRATION_MAP.md`
> 適用對象：你（學生）、畢專口試委員、後續接手的工程師

## 一、總原則

1. **不是新蓋一座 LMS**：你已經有 90% 的 stub 與 type，這份 roadmap 是「接水電 + 補缺口」。
2. **三個 Phase 嚴格依賴**：Phase 1 完才能 demo「TronClass parity」；Phase 2 完才有「校園聯動超車」；Phase 3 完才有「真的智慧化」。
3. **每一項都有「驗收標準」**：能 demo 才算 done，不靠口頭交付。

---

## 二、本輪（5/13）已交付

### 文件
- ✅ `docs/TRONCLASS_PARITY_INTEGRATION_MAP.md` — 16 個模組逐項對照、Firestore 結構、AI 工具清單
- ✅ `docs/TRONCLASS_PARITY_ROADMAP.md` — 本檔
- ✅ `docs/TRONCLASS_PLUS_PRODUCT_BLUEPRINT.md` — 已存在（產品定位）

### 引擎（純函式 + 全測試）
- ✅ `packages/shared/src/lms/quizScoring.ts` — 測驗自動計分（5 種題型、部分分制、人工評分補回）
- ✅ `packages/shared/src/lms/gradebookCompute.ts` — 成績簿加權計算（自動正規化、免修重分、班均/通過率）
- ✅ `apps/mobile/src/__tests__/quizScoring.test.ts` — 14 條測試
- ✅ `apps/mobile/src/__tests__/gradebookCompute.test.ts` — 11 條測試

### 後端 Cloud Functions
- ✅ `backend/functions/agent/tools/submitQuizAttempt.js` — 對接 scoreQuizAttempt
- ✅ `backend/functions/agent/tools/computeGradebook.js` — 對接 computeGradebook + 角色過濾
- ✅ 註冊到 `agent/tools/registry.js`
- ✅ 70 個 backend agent 測試保持綠

### Mobile 端
- ✅ `apps/mobile/src/data/courseSpaceSource.ts` 的 `submitQuiz` 接上 `scoreQuizAttempt`
- ✅ `apps/mobile/src/services/aiToolRegistry.ts` 新增 7 個 LMS 代理工具：
  - `query_modules` / `query_quizzes` / `submit_quiz` / `list_gradebook`
  - `post_discussion` / `build_study_plan` / `risk_radar`

### Web 教師工作台
- ✅ `apps/web/src/app/teacher/course/[courseId]/modules/page.tsx`
- ✅ `apps/web/src/app/teacher/course/[courseId]/quizzes/page.tsx`
- ✅ `apps/web/src/app/teacher/course/[courseId]/attendance/page.tsx`
- ✅ `apps/web/src/app/teacher/course/[courseId]/gradebook/page.tsx`（接 computeGradebook 即時計算）

---

## 三、Phase 1 — TronClass 主幹 parity（剩下要做）

目標：學期初導入即可使用，教師能把整門課完整跑完。預估 4-6 週。

| # | 任務 | 涉及檔案 | 驗收 |
|---|------|---------|------|
| P1-1 | Quiz 題目資料模型補齊（從教師端建立 → 學生作答 → 自動評分 → 寫成績簿） | `apps/web/.../quizzes/page.tsx` 的「編輯題目」要可用；`courseSpaceSource.createQuiz` 要支援 questions[] 寫入 | 教師建一份 5 題小考，學生在 mobile 作答後，gradebook 自動出現該欄分數 |
| P1-2 | 題庫（QuestionBank）CRUD | 新 `apps/web/.../question-banks/page.tsx`；`courseSpaceSource.listQuestionBanks/addQuestion` | 教師可從題庫拉題目進 quiz |
| P1-3 | 點名 QR / Geofence 真實寫入 | `AttendanceLiveScreen.tsx` + `checkInAttendance` Firestore 寫入；`AttendanceAnalyticsScreen.tsx` 顯示出席率 | 老師開 QR → 學生 mobile 掃描 → AttendanceSummary 即時更新 |
| P1-4 | 收件匣可執行動作 | `InboxScreen.tsx` 每張卡加 `action` 按鈕（去繳交 / 去簽到 / 回討論） | 從 inbox 點一個 item，能直接跳到對應 screen 並完成任務 |
| P1-5 | 課程公告獨立於 group | 新增 `courseSpaces/{id}/announcements`；過渡期讀新舊兩處 | 教師可發課程級公告，學生只看到自己選的課的公告 |
| P1-6 | Rubric 評分標準 | `Rubric` type + `RubricEditorScreen`（教師建立） + Assignment 評分時引用 | 教師建一份 4 criterion rubric，批改作業時用 rubric 打分 |
| P1-7 | 同儕互評正式接入 | `PeerReviewScreen.tsx` 接 `assignments[id]/peerReviews`；隨機分配 | 1 名學生交作業後，自動隨機指派 2 人互評 |
| P1-8 | 討論串獨立 schema | 新 `courseSpaces/{id}/discussions/{threadId}`；新 `CourseDiscussionScreen.tsx`（已部分） | 教師發討論題，學生回覆，AI tool `post_discussion` 可用 |

---

## 四、Phase 2 — 整合既有亮點 → 超車起點

目標：把你已經有的 Classroom / LearningAnalytics 等 unique 功能接進主流程。

| # | 任務 | 驗收 |
|---|------|------|
| P2-1 | `ClassroomScreen.tsx` 成為 CourseHub 的「課中」標準 tab | 課前 15 分鐘自動進入 Classroom Mode；下課自動退出 |
| P2-2 | `LearningAnalyticsScreen.tsx` 進入主導航 | 從學生個人面板可一鍵打開；含「本學期 vs 上學期」對照 |
| P2-3 | AI 今日摘要正式串入 Today 頁 | 每天 7 點本機觸發；夾帶 priority assignments 卡片 |
| P2-4 | 課程位置與地圖聯動 deepLink | 上課前 15 分鐘自動推播「帶我去 D305」 |
| P2-5 | AI build_study_plan 工具實作 | 對話「幫我規劃這週讀書」會回完整 7 天讀書計畫，並寫入 planner |

---

## 五、Phase 3 — 差異化超車

目標：拿到口試委員「這個比 TronClass 更智慧」的評語。

| # | 任務 | 驗收 |
|---|------|------|
| P3-1 | 學習風險雷達正式化 | 三條件：出席率 < 70% / 作業逾期 ≥ 2 件 / 任一測驗 < 60；命中即進 `userRiskSnapshots` + 主動通知 |
| P3-2 | 畢業進度動態建議 | 結合 `CreditAuditScreen` 與已修課，AI 建議「下學期該修哪門才能畢業」 |
| P3-3 | 校園服務聯動推薦 | 課程結束 + 接近用餐時間 → 推薦附近餐廳 + 揪團 |
| P3-4 | 課程事件驅動通知 | 教師發新公告 / 開新考試 → 立即推播 + 寫 inbox + 觸發 Today 卡片 |
| P3-5 | 多校 adapter 擴充 | 至少再接 1 所學校（除靜宜外）的 SSO 與成績匯入 |

---

## 六、各任務依賴關係（口試簡報可用）

```text
P1-1 Quiz 完整流程  ─┬─ P1-2 QuestionBank（題庫）
                     ├─ P3-1 學習風險雷達（quiz 分數是輸入）
                     └─ P2-3 AI 今日摘要

P1-3 點名實寫 ─────── P3-1 學習風險雷達（出席率輸入）

P1-4 收件匣 ───────── P2-3 AI 今日摘要（共用 priority 來源）

P1-5 課程公告 ─────── P3-4 事件驅動通知（公告觸發）

P1-6 Rubric ──────── P1-7 同儕互評（評分用同一 rubric）

P1-8 討論串 ───────── （獨立）

P2-1 Classroom 標準化 ─ P3-3 校園服務聯動（下課時機）

P2-5 build_study_plan ─ P3-2 畢業進度建議（同樣需要 planner）
```

P0 必修：P1-1、P1-3、P1-8（沒這三件就不能稱「TronClass parity」）

---

## 七、口試簡報怎麼講（一頁摘要）

> 「我們的產品定位是 Campus Learning OS。不是另一套 TronClass，而是把 LMS 主幹 + 校園行動服務整合進同一條使用者旅程。
>
> 第一階段已完成 TronClass parity 的 13 / 16 個核心模組，包括測驗自動計分與成績簿加權計算這兩個核心算法（純函式、完整單元測試）。
>
> 第二、三階段差異化在三件事：學習風險雷達、課程與校園服務聯動、AI 學習代理人——這三件 TronClass 都沒有。」

口頭講完丟出 demo：
1. 開 web 教師端 `/teacher/course/{id}/quizzes` → 新增 5 題小考
2. 切到 mobile 學生帳號 → QuizCenter 看到該測驗
3. 學生作答送出 → 自動計分顯示分數
4. 切回 web `/teacher/course/{id}/gradebook` → 看到該分數已加權計入總成績

---

## 八、最後一句話

不要再說「我要做跟 TronClass 一樣的所有功能」——那個沒重點。
改成：「我要做 Campus Learning OS，TronClass 的核心我都做了，外加 LMS 廠商做不到的校園行動聯動」。
口試會比較好過。
