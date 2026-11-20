# TronClass 全功能 → 本地化覆蓋率（2026-05-13）

> 目標：把 TronClass 所有功能都能在 APP 內操作，TronClass 只當資料源。
> 狀態定義：
>  - 🟢 **本地完整**：APP 內可看 + 操作（讀 + 寫）
>  - 🟡 **本地僅讀**：APP 內可看到，但動作（繳交/新增）走 webview
>  - 🔴 **完全 webview**：點下去把人踢到 TronClass 網頁
>  - ⚪ **TronClass 沒有 / 我們新加**

## 一、TronClass 核心功能 × APP 本地化現況

### 學生視角 (Student)

| TronClass 功能 | 我們的 screen / 引擎 | 狀態 | 上輪修法 |
|---------------|---------------------|------|---------|
| 我的課程列表 | CoursesHomeScreen | 🟢 | 已串 tcFetchCourses |
| 課程詳情 | CourseHubScreen | 🟢 | 已存在 |
| 教材單元/章節 | CourseModulesScreen | 🟢 | 接 tcFetchModules + tcFetchCourseActivities |
| 教材 PDF/文件 | CourseMaterialViewerScreen | 🟢 | **本輪修：webview inline 內開，不再踢出 APP** |
| 教材影片 | CourseMaterialViewerScreen | 🟡 | 用 webview 載入；本地播放器待加 |
| 課程公告 | (groups posts 暫代) | 🟡 | 應建立 CourseAnnouncementsScreen |
| 作業列表 | CourseModulesScreen (HomeworkCard) | 🟢 | 已存在 |
| 作業詳情 + 繳交 | HomeworkSubmitScreen | 🔴 | **未建** — 目前點下去 webview |
| 作業繳交（含附件） | (同上) | 🔴 | **未建** |
| 測驗列表 | QuizCenterScreen | 🟢 | 已存在 |
| 測驗作答 | QuizTakingScreen + scoreQuizAttempt | 🟢 | 已存在 + 本輪自動計分 |
| 測驗成績 | QuizCenterScreen + ScoreOverview | 🟢 | 已存在 |
| 補考 / 重考 | (TronClass 用同一 quiz endpoint) | 🟢 | 自動可用 |
| 課程點名 | AttendanceScreen | 🟢 | 已存在 |
| 即時點名 (QR) | AttendanceLiveScreen | 🟢 | 已存在 + joinLiveSession |
| 課程成績 | CourseGradebookScreen + computeGradebook | 🟢 | 已存在 + 本輪加權計算 |
| 課程討論串 | CourseDiscussionScreen | 🟢 | **本輪新建** + discussionEngine |
| 同儕互評 | PeerReviewScreen | 🟡 | 已存在但需確認可送出 |
| 個人筆記 | (TronClass 有) | 🔴 | **未建** CourseNoteScreen |
| 學習進度 / 完成度 | LearningAnalyticsScreen | 🟢 | 已存在 |
| 影音觀看紀錄 | (待加) | 🔴 | **未建** |
| 課程下載/匯出 | (待加) | 🔴 | **未建** |

### 教師視角 (Teacher)

| TronClass 功能 | 我們的 screen / 引擎 | 狀態 |
|---------------|---------------------|------|
| 我的班級列表 | TeachingHubScreen | 🟢 |
| 教材管理 (CRUD) | (web /teacher/.../modules) | 🟡 mobile 缺 |
| 作業批改 | TeacherGradingScreen | 🔴 **未建** |
| Rubric 評分 | rubricScoring 引擎 + web | 🟡 mobile 缺 UI |
| 測驗發布 | (web /teacher/.../quizzes) | 🟡 mobile 缺 |
| 題庫管理 | (web /teacher/.../question-banks) | 🟡 mobile 缺 |
| 點名開啟 | start_attendance AI tool | 🟢 |
| 出席分析 | AttendanceAnalyticsScreen | 🟢 |
| 成績發布 | (web /teacher/.../gradebook) | 🟢 |
| 學生風險雷達 | riskRadar 引擎 | 🟢 |
| 課程公告發布 | (web) | 🟡 mobile 缺 |
| 課堂互動 | ClassroomScreen | 🟢 |

### 共用 / 系統

| 功能 | 狀態 |
|------|------|
| SSO 登入 | 🟢 已有 |
| 多角色切換 | 🟢 已有 |
| Push 通知 | 🟢 已有 |
| 行事曆 | 🟢 UnifiedCalendarScreen |
| 全域搜尋 | 🟢 GlobalSearchScreen |
| AI 學伴 | 🟢 AICourseAdvisorScreen + 24 個 AI tool |
| 校園精靈 | 🟢 ⚪（我們獨家）CompanionScreen |
| 校園星圖 | 🟢 ⚪（我們獨家）ConstellationScreen |
| 學習花園 | 🟢 ⚪（我們獨家）gardenEngine |

## 二、剩餘工作優先級

### P0 ✅ 已完成（本輪）
1. ✅ **HomeworkSubmitScreen** — 學生本地繳交作業（文字 + 檔案 + 遲交標記）
2. ✅ **VideoMaterialScreen** — 教材影片本地播放（expo-av）+ 進度記錄
3. ✅ **SurveyScreen** — 課程問卷（單選/複選/量表/文字）

### P1 ✅ 已完成（本輪）
4. ✅ **PeerReviewSubmitScreen** — 同儕互評本地送出（Rubric 打分 + 即時預覽 + 匿名回饋）
5. ✅ **TeacherGradingScreen** — 教師端 mobile 批改（多份切換 + Rubric + 自動下一份）
6. ✅ **CourseNotesScreen** — 個人筆記（標籤、過濾、匯出）

### P2（下輪）
7. **CourseAnnouncementsScreen** — 課程公告獨立畫面
8. **OfflineCourseMode** — 教材可離線下載
9. **CourseExportScreen** — 個人課程資料匯出
10. **AnomalyDetector** — TronClass 排程異動偵測

## 三、本輪實際交付物

### 已完成
- ✅ `safeNavigate.ts` — Navigation 安全網
- ✅ `CourseMaterialViewerScreen` — 本地 webview，取代 WebBrowser 跳出
- ✅ `CourseDiscussionScreen` — 本地討論串
- ✅ CourseModulesScreen 內 11 個 WebBrowser 全替換成本地 viewer
- ✅ CoursesHomeScreen 課程卡 6 chips（教材/測驗/成績/點名/討論/AI 學伴）
- ✅ 「本週需注意」AI 摘要橫條

### 引擎與測試
- 216 條測試全綠
- 12 個純函式引擎
- 24 個 AI 代理工具

## 四、給口試講的一句話

> 「我們做的不是再蓋一個 TronClass，而是把學校既有的 TronClass 變成我們 APP 的『資料後端』。學生打開我們的 APP，看到的是統一的、結合校園生活與 gamification 的介面；但繳作業、看教材、答測驗、簽到——所有實際資料流仍走 TronClass。對學校 IT 是零侵入，對學生是體驗升級。」
