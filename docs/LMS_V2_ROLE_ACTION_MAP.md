# LMS v2 角色 × 動作 × 跨角色因果鏈

> 給「舊 AI 助理 (chatWithCampusAssistant + aiAgentRuntime)」用的設計依據。
> 每個動作都對應一個 AI 工具(tool),被 `aiToolRegistry.executeToolStandard()` 統一執行,
> 受 Supabase RLS 與 `course_role_capabilities` 雙重保護。

## 角色定義

LMS 內的角色有兩層:

1. **App 全域角色** (DemoRole / Firebase claims):`student | teacher | ta | department | vendor`
2. **課程內角色** (course_members.role):`student | teacher | assistant | moderator | observer`

AI 規劃時要同時看這兩層 — App 全域角色決定能進哪些畫面,課程內角色決定能對哪些課程做什麼。

## 動作矩陣

### 學生 (student)

| 動作 | LMS 表 | RLS 條件 | AI 工具 |
|---|---|---|---|
| 查看自己選的課 | course_members | user_id = auth.uid() | listMyCourses |
| 看教材 | course_materials | course_members 內 | listMaterials |
| 繳作業(草稿) | submissions | own + before due_at | submitAssignmentDraft |
| 繳作業(送出) | submissions | own + before due_at | submitAssignmentFinal |
| 開始測驗 | quiz_attempts | own + quizzes.status=published | startQuizAttempt |
| 答題 | quiz_answers | own attempt | answerQuizQuestion |
| 提交測驗 | quiz_attempts | own + 未過期 | submitQuizAttempt |
| 發討論 | forum_posts | course_members 內 | postForumReply |
| 簽到 | live_attendance | own + in window | checkInLive |
| 同儕互評 | peer_review_submissions | own assigned reviews | submitPeerReview |
| 看自己成績 | course_grade_rollups | user_id = auth.uid() + published=true | listMyGrades |
| 看公告 | announcements | course_members 內 | listAnnouncements |
| 完成問卷 | survey_answers | own | submitSurveyAnswer |

### 教師 (teacher / course_members.role='teacher')

學生的所有讀動作 + 以下寫動作:

| 動作 | LMS 表 | AI 工具 | 跨角色影響 |
|---|---|---|---|
| 加學生到課程 | course_members | enrollStudent | 該學生 inbox + push |
| 移除學生 | course_members | unenrollStudent | 該學生 inbox |
| 建立教材 | course_materials | createMaterial | 所有學生 push (可關) |
| 上傳教材檔 | storage + course_materials | uploadMaterial | 同上 |
| 建立作業 | assignments | createAssignment | 所有學生 todo +1 |
| 更新作業 | assignments | updateAssignment | 學生 push 若改截止 |
| 批改作業 | submissions | gradeSubmission | 該學生 push(若發布) |
| 發布成績(整課) | course_grade_rollups | publishCourseGrade | 全班 push |
| 發公告 | announcements | createAnnouncement | 全班 push + inbox |
| 建測驗 | quizzes + quiz_questions | createQuiz | 所有學生 todo +1 |
| 發布測驗 | quizzes.status | publishQuiz | 全班 push |
| 鎖定測驗 | quizzes.status | closeQuiz | 進行中學生收提示 |
| 手動批改測驗 | quiz_manual_scores | manualScoreQuiz | 學生收成績 |
| 建討論版 | forum_categories/forum_topics | createForumTopic | 學生看到主題 |
| 管理討論 (隱藏/刪除) | forum_post_flags + audit_logs | moderateForumPost | 原發文者收通知 |
| 開直播課 | live_sessions | startLiveSession | 學生收 push 進入簽到 |
| 關直播課 | live_sessions | endLiveSession | 缺席學生風險 +1 |
| 手動點名 | live_attendance | markAttendance | 該學生 inbox |
| 建評分量表 | rubric_definitions | createRubric | 後續批改用 |
| 發問卷 | surveys + survey_questions | createSurvey | 所有學生 push |
| 設定 TA | course_role_capabilities | grantTACapabilities | 該 TA 通知 |
| 建徽章 | course_badges | createBadge | 學生看到 |
| 頒徽章 | course_badge_awards | awardBadge | 學生 push |

### 助教 (TA / course_members.role='assistant')

依 course_role_capabilities flag 啟用以下子集:

| 動作 | 需 capability | AI 工具 |
|---|---|---|
| 批改作業 | assignments.grade | gradeSubmission |
| 看作業列表 | (預設啟用) | listSubmissions |
| 管理出勤 | attendance.manage | markAttendance |
| 管理討論版 | forum.moderate | moderateForumPost |
| 發公告 | announcements.author | createAnnouncement |
| 建題目進題庫 | quizzes.author | createQuizQuestion |
| **不能** publish course grades | grades.publish (僅教師) | — |

### 版主 (moderator / course_members.role='moderator')

只能 forum.moderate,其他全擋。

### 系所主管 (department / App 全域角色)

不屬於課程內角色,但可跨課程:

| 動作 | LMS 表 | AI 工具 | 跨角色影響 |
|---|---|---|---|
| 跨課程廣播 | announcements (多 course_id) | broadcastDeptAnnouncement | 多課程學生 push |
| 看系所學業風險 | views/risk | listDeptRisks | 觸發教師輔導 |
| 審核教師發佈 | announcements (pending) | approvePendingAnnouncement | 通知發起教師 |

## 跨角色因果鏈 (AI 必須懂)

```
1. 學生繳作業
   submitAssignmentFinal(submissionId)
   → submissions row 更新
   → 觸發 trigger: 教師 inbox +1 / push "新作業繳交"
   → AI Agent (對教師端) 提醒批改

2. 教師批改 + 發布
   gradeSubmission(submissionId, score, feedback)
   → submissions.score 寫入
   → (若教師同時 publishCourseGrade) → 學生 push "X 課程的 Y 作業已批改"
   → 學生 AI Agent 提示「來看看老師的批改回饋」

3. 教師發公告
   createAnnouncement(courseId, title, body)
   → announcements row
   → trigger: 該課程所有學生 push
   → 學生 AIChat 對話框右下角 hint 顯示 "新公告"

4. 學生簽到
   checkInLive(sessionId)
   → live_attendance row insert
   → trigger: 教師的 LiveSession 監看頁面 count +1
   → 若 3 次連續缺席 → studentRiskEngine 標 watch → 教師風險儀表板

5. 學生發討論問題
   postForumReply(topicId, body)
   → forum_posts row
   → trigger: 教師/TA inbox +1
   → 教師 AI Agent 提示「有學生在 X 課程提問」

6. 系所主管廣播
   broadcastDeptAnnouncement(courseIds[], body)
   → 多筆 announcements
   → trigger: 多課程學生 push (扇出)
   → AI Agent 要先用 confirmIntent 提示影響面("此動作會通知 134 名學生")

7. AI 代學生繳作業
   submitAssignmentFinal → 教師收 push → 教師 AI Agent 自動列入「待批改清單」
   (Agent 一次回答即可串到兩端)

8. AI 代教師發布成績
   publishCourseGrade(courseId, itemId)
   → 影響:全班 push (高影響)
   → Agent 應先 plan: 顯示「將通知 28 位學生,確定?」
   → 用戶確認 → execute → verify
```

## AI 安全護欄

1. **影響面預先顯示**:任何 `cross_role_write` 的工具,執行前必須先 plan,告訴用戶「會影響 N 個人」。
2. **角色擋寫**:工具 executor 開頭先 `assertCapability(courseId, capability)`,失敗就回 `ToolError(role_denied)`。
3. **RLS 雙保險**:就算 AI 算錯能力,Supabase RLS policies 會再擋一次。
4. **Audit log**:所有寫入動作除了 Supabase row 之外,也寫一筆 `audit_logs`,讓教師事後能查 AI 在他帳號下做了什麼。
5. **可撤銷**:`undoLastWrite()` 工具,Agent 可在批改/發公告後 5 分鐘內回滾(刪除剛剛 insert 的 row + audit 標記 reverted)。
6. **草稿優先**:`createAnnouncement` / `createAssignment` 預設 status='draft',要 Agent 再呼叫 `publish*` 才正式發布。

## 模組對應檔案

| 設計 | 程式 |
|---|---|
| 工具 declarations | `apps/mobile/src/services/lmsV2WriteTools.ts` (新檔) |
| Read facade | `apps/mobile/src/services/supabaseLmsCache.ts` (已建) |
| Per-course context | `apps/mobile/src/services/perCourseAIContext.ts` (已建) |
| 工具註冊 | `apps/mobile/src/services/aiToolRegistry.ts` (extend) |
| 工具呼叫橋接 | `apps/mobile/src/services/aiAgentTools.ts` (extend) |
| Agent 規劃 | `apps/mobile/src/services/aiAgentRuntime.ts` (現有可用) |
| Auth bridge | `apps/mobile/src/services/lmsAuthBridge.ts` (已建) |
| Supabase client | `apps/mobile/src/services/supabaseClient.ts` (已建) |
| RBAC capabilities seed | `supabase/migrations/20260520120100_gap_p2_08_role_matrix_capabilities.sql` (已複製) |
| Audit table | `audit_logs` (在 forum_grades migration 內) |
