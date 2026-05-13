# TronClass Parity × 既有 APP 整合對照表

> 對應 `TRONCLASS_PLUS_PRODUCT_BLUEPRINT.md` 第 8、9、10 節
> 對齊現況：2026-05-13

## 一、結論先看（盤點 16 個 LMS 主幹模組）

你以為「缺很多」，實際上不是。盤完 `apps/mobile/src/screens/` 與 `apps/mobile/src/data/types.ts`、`data/source.ts`，現況是：

| 狀態 | 模組數 | 含義 |
|------|--------|------|
| 已有畫面 + types + source method | 11 | 升級即可（接 hybridSource 真實資料、補計算邏輯、補 AI 接點） |
| 有 types 但缺 source method | 2 | 補 source method、補後端 tool、補畫面接線 |
| 完全沒有 | 3 | 從 schema 到畫面都要建（討論串 / Rubric / 題庫管理 UI） |

換句話說：**第一階段不是「再蓋一座 LMS」，是「把現有 stub 接上水電」**。

## 二、16 個模組對照表

| # | TronClass 模組 | 既有資產 | 狀態 | 行動 |
|---|----------------|---------|------|------|
| 1 | 課程空間（CourseSpace） | `CourseHubScreen.tsx`(1051行) + `CourseSpace` type + `listCourseSpaces()` | 升級 | 把 hybridSource 從 mockSource 改成真實 Firestore 讀；補 `courseSpaceSource.ts` 走 fetchWithFallback |
| 2 | 課程教材（CourseModules / Materials） | `CourseModulesScreen.tsx`(1385行) + `CourseModule` / `CourseMaterial` types + `listCourseModules / createCourseModule / listCourseMaterials` | 升級 | 接真實檔案儲存（已有 storage）；補學習進度 `progress` 計算；補 web 教師端建立 UI |
| 3 | 課程公告 | groups[type=course] 的 announcements + `GroupDetailScreen.tsx` | 沿用 | 直接重用，過渡期 announcements 仍掛在 groups |
| 4 | 作業（Assignment） | `GroupAssignmentsScreen.tsx` + `AssignmentDetailScreen.tsx` + `Assignment` / `Submission` types | 升級 | 補同儕互評（peer review）與 Rubric 評分；`PeerReviewScreen.tsx` 已存在但未串入 |
| 5 | 測驗 / 考試 | `QuizCenterScreen.tsx`(445行) + `QuizTakingScreen.tsx`(1190行) + `Quiz` / `Question` types + `listQuizzes / createQuiz` | **升級** | **缺自動計分引擎與寫入 gradebook**：這次補 |
| 6 | 題庫（QuestionBank） | `QuestionBank` type（813行有定義） | **缺 source/screen** | 補 source method + 教師端 UI（web） |
| 7 | 點名 / 出缺席 | `AttendanceScreen.tsx`(1730行) + `AttendanceLiveScreen.tsx`(902行) + `AttendanceAnalyticsScreen.tsx` + types + `listAttendanceSessions / getAttendanceSummary` | 升級 | 補 QR/地理圍欄真實寫入；補低出席率提醒 → 學習風險雷達 |
| 8 | 成績簿（Gradebook） | `CourseGradebookScreen.tsx`(320行) + `CourseGradebook*` types + `getCourseGradebook` | **升級** | **缺加權計算與發布流程**：這次補 |
| 9 | 討論 / Q&A | groups[type=course] posts/comments | 部分沿用 | 課程內討論獨立 schema（`discussions/{threadId}`）；過渡期維持 groups posts |
| 10 | 同儕互評 / Rubric | `PeerReviewScreen.tsx` + Assignment.peerReview | 升級 | 補 `Rubric` type + 評分標準引擎 |
| 11 | 課中互動 | `ClassroomScreen.tsx`(1561行)（投票、匿名提問、反應條） | 沿用 | 已成熟，補進 CourseHub 標準入口（已部分接） |
| 12 | 學習分析 | `LearningAnalyticsScreen.tsx` + `listRiskSnapshots / StudentRiskSnapshot` | 升級 | 接入 navigation；補風險計算規則（出席率<70% / 作業逾期>2件 / 測驗<60分） |
| 13 | 收件匣 | `InboxScreen.tsx` + `listInboxTasks / InboxTask` type | 沿用 | 已聚合作業/測驗/Live；補「可執行動作」按鈕 |
| 14 | 公告 / 通知 | `AnnouncementsScreen.tsx`(已有) | 沿用 | 不動 |
| 15 | SSO / 多校 adapter | `sso.ts` + `AdapterRegistry.ts` + `NCHUAdapter.ts` + `puDirectScraper.ts` | 沿用 | 已比 TronClass 標準款更深 |
| 16 | Web 教師工作台 | `apps/web/src/app/teacher/course/[courseId]/page.tsx`(只有一個 page) | **缺** | 補 modules / gradebook / attendance / quizzes 子頁面 |

## 三、Phase 1 必補（10 件）

依 blueprint §9.1，第一階段 TronClass parity 應交付：

1. ✅ 課程首頁（CourseHubScreen 已有） → 升級
2. ✅ 教材單元（CourseModulesScreen 已有） → 接真實檔案
3. ✅ 作業與繳交（已有雛形） → 補 Rubric
4. 🔴 **測驗引擎自動計分**（本輪實作）
5. 🔴 **題庫管理 UI 與 source method**（本輪 schema 完成、UI Phase 2）
6. ✅ 點名（已有畫面）→ 補真實 QR/Geofence 寫入
7. 🔴 **成績簿加權計算與發布**（本輪實作）
8. ✅ 收件匣（已有）→ 補執行動作
9. 🔴 **Web 教師端 4 個子頁面**（本輪建骨架）
10. 🔴 **討論串獨立 schema**（本輪 schema 完成）

## 四、Phase 2 整合既有亮點（5 件）

1. `ClassroomScreen.tsx` → 標準化為 `CourseHub` 內 tab（已部分完成）
2. `LearningAnalyticsScreen.tsx` → 接入 student 個人面板
3. AI 今日摘要 → 用 `getPrioritySummary` 已有
4. 課程與地圖/交通聯動 → 用 ambientCue + 課程位置 deepLink（架構已有）
5. AI 學習代理人 → AI tool registry 加 `query_modules / submit_quiz / list_grades / build_study_plan`（本輪實作）

## 五、Phase 3 差異化超車（5 件）

1. 學習風險雷達 → `listRiskSnapshots` 已有 type，補計算規則
2. 畢業進度 → `CreditAuditScreen.tsx` + `CreditAuditInputScreen.tsx` 已有
3. 校園服務聯動 → `ambientCue` 機制已有
4. 課程事件驅動通知 → `proactiveAI` + `proactiveIntelligenceEngine` 已有
5. 多校 adapter 擴充 → 架構已有，補新學校適配

## 六、資料層遷移策略（不重寫，過渡共存）

### 6.1 過渡層原則

```
過渡期（現在 - 8 週）
  groups[type=course] ⇄ courseSpaces 並存
  toCourseSpaceFromGroup(group) 自動橋接
  hybridSource 寫入時雙寫；讀取優先 courseSpaces

穩定期（8 週後）
  新建課程只進 courseSpaces
  舊 groups[type=course] 標記 legacy，停止寫入

退場期
  資料完整遷出後，groups 限社團/讀書會/社交群組
```

### 6.2 Firestore 結構（blueprint §8）

```
schools/{schoolId}/terms/{termId}/courseSpaces/{courseId}/
  announcements/{id}
  modules/{moduleId}
    materials/{materialId}
  assignments/{assignmentId}
    submissions/{uid}
  quizzes/{quizId}
    questions/{questionId}      ← 本輪補
    attempts/{uid}/{attemptId}  ← 本輪補
  attendanceSessions/{sessionId}
    records/{uid}
  discussions/{threadId}        ← 本輪補
    replies/{replyId}
  liveSessions/{sessionId}
  gradeItems/{gradeItemId}      ← 本輪補
  gradebookEntries/{uid}        ← 本輪補
  rubrics/{rubricId}            ← 本輪補
  members/{uid}

schools/{schoolId}/questionBanks/{bankId}/  ← 本輪補
  questions/{questionId}

users/{uid}/
  enrollments/{courseId}        ← 已有
  inbox/{itemId}                ← 已有 listInboxTasks
  analytics/{snapshotId}        ← 已有 listRiskSnapshots
  planner/{taskId}              ← 本輪補
```

## 七、AI 代理新增工具（對照本輪實作）

依 blueprint §7.3 「AI 不是聊天玩具，而是學習代理人」原則：

| AI 工具 | 對應功能 | 本輪狀態 |
|---------|----------|----------|
| `query_modules` | 列課程教材單元 | 補 |
| `query_quizzes` | 列待測驗 | 補 |
| `submit_quiz` | 提交測驗答案 | 補（draft，要 user confirm） |
| `open_attendance` | 老師開啟點名 | 已有 `start_attendance` |
| `list_grades` | 列成績（自己授權範圍） | 已有 `query_grades` |
| `build_study_plan` | AI 切分作業 + 安排讀書時間 | 補 |
| `risk_radar` | 學習風險評估 | 補（讀 risk_snapshots） |
| `post_discussion` | 在課程討論串發文 | 補 |
| `peer_review_submit` | 同儕互評送出 | 補 |

## 八、本輪實際交付物

1. 本文件
2. `docs/TRONCLASS_PARITY_ROADMAP.md`（任務依賴 + Phase 拆分）
3. `docs/TRONCLASS_PARITY_AUDIT.md`（細到「每個 TronClass 功能 vs 你的程式碼路徑」）
4. **`packages/shared/src/lms/quizScoring.ts`**：純函式測驗計分引擎 + Jest 測試
5. **`packages/shared/src/lms/gradebookCompute.ts`**：純函式成績簿加權計算 + Jest 測試
6. `backend/functions/agent/tools/` 新增 `submitQuizAttempt.js` / `getCourseGradebook.js`
7. AI tool registry 擴充（mobile + cloud）對齊 blueprint
8. 既有 117 個 backend agent 測試保持綠
