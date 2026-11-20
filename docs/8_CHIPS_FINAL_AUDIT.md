# 8 chip × 5 維度完整 audit（2026-05-13 重設）

> 你說「修一個月還沒修好」。這次我做的是徹底拆掉中間 abstraction，每個 chip 都直接拉 TronClass 該課程資料，不再經過 dataSource / mockSource 中間層。

## 8 chip 完整對映

| chip | 路由名 | 目的地畫面 | 傳入參數 | screen 收 courseId 後做的事 |
|------|--------|----------|----------|----------------------------|
| 📚 教材 | CourseModules | CourseModulesScreen | `groupId`、`groupName` | 並行呼 `tcFetchModules` / `tcFetchCourseActivities` / `tcFetchCourseExams` / `tcFetchHomeworkActivities`（**本輪修：modules 空時用合成 catch-all 章節仍顯示其他內容；不再 type==='material' 過濾**） |
| ❓ 測驗 | QuizCenter | QuizCenterScreen | `groupId`、`groupName` | dataSource fallback：若 ds 回空且有 routeGroupId，**本輪改：直接呼 `tcFetchCourseExams + tcFetchExamSubmissions` 拉該課程的小考/考試及個人分數** |
| 📊 成績 | **CourseScores（新）** | **CourseScoresScreen（本輪新增）** | `groupId`、`groupName` | **完全 bypass AcademicScreen / RouteGuard**：直接呼 `tcFetchSelfScore + tcFetchScoreItems + tcFetchCourseExams + tcFetchHomeworkActivities`，整合作業/測驗/評分項目，顯示「該課」每項分數 + 加權 + 平均 |
| ✅ 點名 | AttendanceMultiMethod | AttendanceMultiMethodScreen | `courseId`、`sessionId` | 上方拉 `listAttendanceSessions(courseId)` 顯示本課歷史紀錄；中央依老師方法渲染簽到 UI |
| 💬 討論 | CourseDiscussion | CourseDiscussionScreen | `groupId`、`groupName` | `tcFetchDiscussions(courseId)`，空時顯示「這門課還沒有任何討論」 |
| ✨ AI 學伴 | AICourseAdvisor | AICourseAdvisorScreen | `groupId`、`groupName` | 從 route 讀 `focusedCourseId`，注入 aiContext，AI 對話限縮在該課程 |
| 📝 筆記 | CourseNotes | CourseNotesScreen | `courseId`、`courseName` | AsyncStorage key per-course，每門課獨立筆記本 |
| 💯 互評 | PeerReviewSubmit | PeerReviewSubmitScreen | `courseId`、`assignmentTitle` | `tcFetchPeerReviews(courseId)`，無任務顯示「本課程目前沒有同儕互評任務」 |

## 本輪重點修法

### 1. 教材 chip — `CourseModulesScreen`

**問題**：
- `if (modules.length === 0) return [];` 即使 activities/exams/homework 有資料也直接清空畫面
- `filter((a) => a.type === 'material')` 把 video / online_video / web_link / page 全部濾掉

**修法**：
- 任一個（modules / activities / exams / homework）有資料 → 顯示
- modules 空時建立合成 catch-all module 「課程內容」，把所有沒分章節的活動裝進去
- 不再用 type 過濾，所有非作業非考試的 TronClass type 都當教材呈現

### 2. 測驗 chip — `QuizCenterScreen`

**問題**：用 `ds.listQuizzes(uid, groupId, schoolId)` 抽象層，若 Firestore 沒同步就回空陣列，學生看不到 TronClass 的真實測驗

**修法**：dataSource 回空時 fallback **直接呼 `tcFetchCourseExams + tcFetchExamSubmissions`**，從 TronClass 拉該課程的小考/考試清單與個人分數。

### 3. 成績 chip — 全新 `CourseScoresScreen`

**問題**：之前跳 `CourseGradebook → AcademicScreen` 被 `RouteGuard requires="courses.grade"` 擋（這是教師權限）

**徹底修法**：建立全新獨立 screen `CourseScoresScreen`，**bypass AcademicScreen 與 RouteGuard**。直接：
- `tcFetchSelfScore(courseId)`
- `tcFetchScoreItems(courseId)`
- `tcFetchCourseExams(courseId)` + `tcFetchExamSubmissions(examId)`
- `tcFetchHomeworkActivities(courseId)`

整合成 ScoreRow 陣列，逐項顯示：作業 / 小考 / 考試 / 評分項，每項分數 + 滿分 + 加權 + 通過判定。頂部統計平均分。

## TronClass API 鏈完整對應表

| chip | 呼叫的 TronClass endpoint |
|------|--------------------------|
| 教材 | `GET /api/courses/{id}/modules` + `/api/courses/{id}/activities`（含 `type=courseware_activity`） + `/api/courses/{id}/exams` + `/api/courses/{id}/homework-activities` |
| 測驗 | `GET /api/courses/{id}/exams` + `/api/exams/{eid}/submissions` |
| 成績 | `GET /api/courses/{id}/score-items` + `/api/courses/{id}/self-score` + `/api/courses/{id}/exams` + `/api/exams/{eid}/submissions` + `/api/courses/{id}/homework-activities` |
| 點名 | `GET /api/courses/{id}/attendance-sessions`（暫透過 `listAttendanceSessions`） |
| 討論 | `GET /api/courses/{id}/discussions` |
| AI 學伴 | 不打 TronClass，是 AI 對話 context |
| 筆記 | 完全本地 AsyncStorage |
| 互評 | `GET /api/courses/{id}/peer_reviews` |

## 重啟驗證

```bash
cd apps/mobile && npx expo start --clear
```

依以下步驟驗證每個 chip：

1. 學習 → 我的課程 → 課程分頁 → 任一課程卡
2. 點 **教材** → 應該看到該課所有教材 / 影片 / 連結（即使沒分章節也會合成「課程內容」）
3. 點 **測驗** → 看該課的小考考試 + 個人分數
4. 點 **成績** → 看該課每項分數 + 加權，不再被權限擋
5. 點 **點名** → 上方該課歷史出席紀錄，下方依老師方法簽到
6. 點 **討論** → 該課討論串列表 + 發新文
7. 點 **AI 學伴** → 對話 scope 限縮在該課
8. 點 **筆記** → 該課獨立筆記本
9. 點 **互評** → 該課互評任務列表

每個 chip 進去後，**只**看到該課程資料；空狀態有友善提示，不會被權限擋。
