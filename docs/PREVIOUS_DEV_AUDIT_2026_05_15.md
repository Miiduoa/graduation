# 既有開發深度 audit（2026-05-15）

> 在繼續開發 AI 核心整合前，先檢視前兩輪（本地化 + 7 差異化引擎）的盲點。

## 🟥 必修

### A. 跨 Stack Navigation 沒打通
**症狀**：`TodayCockpit / GradeWhatIf / MistakeRepertoire / TeacherCockpit` 只在 LearnStack 註冊；從 HomeStack / MessagesStack 等別處 `navigation.navigate('TodayCockpit')` 會 fail。
**修法**：在 RootNavigator linking 加 deep link fallback；或讓四個 cockpit screen 在 root level 註冊。

### B. CockpitQuickRow 不分角色
**症狀**：學生身分也看到「👨‍🏫 教師端」按鈕，點進去 demo 沒問題但語意錯。
**修法**：依 `profile.roleGroup` 切換顯示。學生顯示前 3 個，老師顯示前 3 個 + 教師端。

### C. MistakeRepertoireScreen / TodayCockpit storage 沒 scoped 到 uid
**症狀**：多人共用同一台 demo 裝置 → 看到別人錯題。
**修法**：用 `getScopedStorageKey('mistake_repertoire_v1', { uid })`。

### D. bulkReminders deepLink bug
**症狀**：`HomeworkSubmit?courseId=${input.courseName}` — courseName 不是 id。
**修法**：bulkReminders 多收一個 `courseId`，正確帶。

### E. demoFetchCourseExams.score_percentage 寫 '0'
**症狀**：ExamCard 用 `Number(e.score_percentage) > 0` 判斷是否顯示「佔比」 → demo 永遠 0，看不到佔比資訊。
**修法**：從 demo score items 反推每個 exam 的 weight。

### F. demoFetchHomeworkActivities.submitted = hw.submitted 顯示給「教師端」是「樣本已交」
**症狀**：TeacherCockpit 把 hw.submitted 解讀成「整班是否有人交」誤導。
**修法**：教師端的「已交」應該看 fakeSubmittedSet().size，不是 hw.submitted。

### G. AICourseAdvisor 塞了 courseContext 但 AIContext type 沒這欄位
**症狀**：型別 cast 過但後端忽略；AI 對話實際拿不到課程章節 / 作業資料。
**修法**：把資料以「user message preamble」方式塞入 systemPrompt 而不是 context 物件，並擴展 AIContext type。

### H. 登入登出流程：
- ✗ 沒有「demo 一鍵體驗」入口 (學生 / 老師 / TA / Admin 角色切換)
- ✗ OnboardingScreen 是 deprecated stub
- ✗ 沒有「demo 模式」明確標示
- ✗ 登出後再開 APP 直接進主畫面（不會回到登入頁）
**修法**：建一個簡潔的 `LoginLandingScreen` 含 5 個 demo 角色卡片 + 真實登入入口。

## 🟧 該修但不阻塞 demo

### I. CourseScoresScreen 自定義「系統試算總分」與 gradePredictor.likelyCase 不一致
**症狀**：兩個地方算出來的分數可能不一樣（一個用 selfScore.final_score，一個自己平均所有 graded items），會讓學生看到不同數字。
**修法**：統一用 `predictCurrent` 算 → meta 顯示 likelyCase。

### J. 新 4 個 cockpit screen 沒有 unit test
**修法**：寫 smoke render test，至少確保 import + render 不會 throw。

### K. CoursesHomeScreen 把 demo course 與 TC course 混在同一個 array
**症狀**：tcCourses[] 含 demo 課程時，CourseListView 的 hover / chip 行為皆對齊；但 demo 課程仍會通過某些 type guard 例如 isTronClassCourse() → 可能誤判。
**修法**：給 demo course 標 `__demo: true`，並調整 isTronClassCourse 判斷。

### L. SocraticCoach 對英文 student bypass 有偵測，對中文「直接給答案」也偵測，但「直接告訴我選 C」這類 mixed bypass 沒測。
**修法**：補強 STUDENT_BYPASS_PATTERNS。

### M. 沒有 AI Context Aggregator
**症狀**：AI 拿到的 context 太薄。
**修法**：build `aiContextBuilder.ts` 把所有資料 (study plan / grades / notifications / mistakes) 串成單一 prompt-friendly 大物件。

### N. AI Tool Registry 沒有暴露 grade-predictor / study-planner 等新引擎
**修法**：補上 6 個新 tool function（gradePredict / studyPlanWeek / addMistake / etc）。

### O. 沒有跨角色 event bus
**症狀**：老師批改 → 學生不會自動收到「成績更新」通知（除非重整 APP）。
**修法**：本地用 EventEmitter（已有 `services/events` 之類？要查）+ Cloud Function 推播。

## 🟨 nice-to-have

- 暗色模式對齊 — 部分新 screen hardcoded color
- i18n — 新 screen 全 zh-TW hardcoded
- Accessibility label 補齊
- AsyncStorage 用量加管控（避免無限增長）
- Performance：CoursesHomeScreen 3000+ 行，可拆

## 修法優先序

1. (A, B, C, D, G, H) → 馬上修，影響 demo 可信度
2. (E, F, I, K) → 影響 demo 精緻度
3. (J, M, N, O) → 是下一輪「AI 核心化」的基石
4. 其餘 → 後續

下一輪 work plan：先把 🟥 全清，再做 AI Context Aggregator + AI Tools + 跨角色聯動。
