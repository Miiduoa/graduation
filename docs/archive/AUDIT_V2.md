# Campus Learning OS — Web Demo Audit V2

審查日期：2026-05-17
審查範圍：`apps/web/src/`（80 個 .ts/.tsx 檔，不含 node_modules / mobile）
8 個角色：student / teacher / ta / club_officer / department_head / admin / alumni / guest

---

## 1. Dead button / 無響應 / 假動作（30 條）

[1-dead] [apps/web/src/components/SiteShell.tsx:205] [全角色] 頁尾「關於我們」是 `<a href="#">`，點下會跳到頁首。 → 改成 `<Link>` 指向 /about（如無此頁則改文字標籤或拿掉）。
[1-dead] [apps/web/src/components/SiteShell.tsx:208] [全角色] 頁尾「隱私政策」是 `href="#"`，但實際已有 `/privacy` 頁。 → 改為 `<Link href="/privacy">`。
[1-dead] [apps/web/src/components/SiteShell.tsx:211] [全角色] 頁尾「聯絡我們」是 `href="#"`。 → 改 mailto: 或拿掉。
[1-dead] [apps/web/src/app/clubs/page.tsx:258] [club_officer] 「＋ 發布社團活動」按鈕只 toast「（demo）」，沒有真實表單。 → 改成導向 /announcements?compose=1 並讓社團幹部可挑選社團。
[1-dead] [apps/web/src/app/clubs/page.tsx:266] [club_officer] 「👥 管理成員」按鈕只 toast「（demo）」，下方雖有「待審申請」但沒有「現有成員列表」。 → 開 Modal 顯示 120 位成員列表並可移除/降級。
[1-dead] [apps/web/src/app/clubs/page.tsx:274] [club_officer] 「📝 審核申請」按鈕只 toast，下方的待審列表才是真正可點。 → 移除這顆按鈕（已重複），或讓它 scroll 到待審區塊。
[1-dead] [apps/web/src/app/announcements/[id]/page.tsx:199] [teacher/dept_head/admin] 「✏️ 編輯公告」只 toast「（demo）」。 → 至少做個 Modal 把 title/body 改成可編輯。
[1-dead] [apps/web/src/app/announcements/[id]/page.tsx:209] [dept_head/admin] 「🗑️ 下架」只 toast，沒有真正移除公告（重新整理還在）。 → 寫入 demoStore 的 takenDown 集合，並在列表 filter 出去。
[1-dead] [apps/web/src/app/admin/students/[id]/page.tsx:212] [teacher/ta/dept_head/admin] 「✉️ 寄信」只 toast「（demo）」。 → 改成導 /messages?compose=stu-xxx 或開 Modal。
[1-dead] [apps/web/src/app/admin/students/[id]/page.tsx:220] [同上] 「✅ 出席紀錄」只 toast。 → 導向 /teacher/course/c1/attendance（已有真實頁）。
[1-dead] [apps/web/src/app/admin/students/[id]/page.tsx:228] [同上] 「🎯 畢業審查」只 toast。 → 導向 /credit-planner（已有真實頁）。
[1-dead] [apps/web/src/app/admin/students/[id]/page.tsx:237] [admin] 「🛡️ 帳號設定」只 toast。 → 改為呼叫 setUserDisabled，與 /admin 一致。
[1-dead] [apps/web/src/app/teacher/course/[courseId]/quizzes/page.tsx:80] [teacher] 「+ 新增測驗」按鈕完全沒有 onClick。 → 開 Modal 接收 title/dueAt 後 setRows。
[1-dead] [apps/web/src/app/teacher/course/[courseId]/quizzes/page.tsx:115] [teacher] 每一列的「編輯題目」按鈕沒有 onClick。 → 至少 alert/info 或 router.push 到題庫頁。
[1-dead] [apps/web/src/app/teacher/course/[courseId]/quizzes/page.tsx:117] [teacher/ta] 每一列的「看答案」按鈕沒有 onClick。 → 開 Modal 顯示題目與標準答案。
[1-dead] [apps/web/src/app/settings/page.tsx:254] [全角色] 「Campus One 版本 2.0.0」整行 SettingRow 沒有 onClick，但 SettingRow 在沒 onClick 時 cursor=default 是 ok；標的是同檔 line 255-256 才是真的 dead。
[1-dead] [apps/web/src/app/settings/page.tsx:255] [全角色] 「📄 服務條款」SettingRow 無 onClick；應導 /terms（已存在）。
[1-dead] [apps/web/src/app/settings/page.tsx:256] [全角色] 「🔐 隱私政策」SettingRow 無 onClick；應導 /privacy（已存在）。
[1-dead] [apps/web/src/app/settings/page.tsx:514] [全角色] 帳號頁右上「編輯」三字 cursor:pointer 但沒 onClick。 → 導 /profile 或開編輯 Modal。
[1-dead] [apps/web/src/app/settings/page.tsx:540] [全角色] 「🔑 密碼管理」SettingRow 無 onClick（顯示「請至 e 校園」但點不開連結）。 → 加 target=_blank 的真實 URL 或拿掉 chevron。
[1-dead] [apps/web/src/app/settings/page.tsx:545] [全角色] 「🔥 Firebase 會話」整行沒有任何動作，但右邊是 pill。 → 移除 chevron（目前 right 是 pill，但 SettingRow 預設仍 render chevron 嗎？實際是 right!=undefined 就不 render；ok）；只是視覺意義不大，建議改成「上次同步：xx」。
[1-dead] [apps/web/src/app/settings/page.tsx:184-194] [全角色] 「🏫 目前校園」SettingRow 無 onClick，但 chevron 仍顯示（right 是 pill 才會吃掉 chevron — 此處 right 是 pill，所以 chevron 不會顯示，OK）。
[1-dead] [apps/web/src/app/profile/page.tsx:413] [全角色] `MOCK_COURSES` 內歷史課程沒有 courseId 對應時，`<Link href="#">` 是 dead anchor。 → 改成 `<div>` 不渲染 Link；或在 GRADED_COURSES 補 courseId（已補但 CURRENT_SEM_COURSES 可能 fallback 到 undefined）。
[1-dead] [apps/web/src/app/profile/page.tsx:451] [ta] 「查看課表 →」是 `<a href="...">`（不是 Link）；正常但缺 hover state；ta 的 timetable 頁會顯示「教師課表」而非個人課表，是體驗錯位。
[1-dead] [apps/web/src/app/library/page.tsx:380] [teacher/ta/dept_head/admin] 「問 AI 推薦書單 →」用 `<a href>` 不是 Link，會 full page reload。 → 改 Next Link。
[1-dead] [apps/web/src/app/library/page.tsx:451] [非 student] 「續借 +14 天」按鈕對沒有借閱權限的角色仍會 render，僅在 onClick 內 guard；視覺上會誤導。 → 對 !canBorrowBooks 角色一開始就不渲染借閱列表。
[1-dead] [apps/web/src/app/grades/page.tsx:312] [teacher] 「發布成績」是 Link 沒問題；但 GradesPage 教師視角的 hero 「開啟成績冊」與下方「發布成績」兩顆按鈕功能不同（一個進成績冊頁，一個跳同樣 gradebook 頁）。 → 文字差異化或合併。
[1-dead] [apps/web/src/app/teacher/course/[courseId]/attendance/page.tsx:175-191] [teacher] 「📥 匯出 CSV」按鈕邏輯正常，但歷史 session 不會顯示哪堂課（無 courseId / date metadata 完整顯示）；非 dead，但 metadata 缺失。
[1-dead] [apps/web/src/app/login/page.tsx:233] [所有] Demo 快速登入按鈕 user 用 `getDemoUser(r.role === 'guest' ? 'student' : r.role)` — guest 卡片會顯示「王小明 · ...」誤導為學生身份。 → guest 卡片應顯示「訪客 · 未登入」。
[1-dead] [apps/web/src/app/ai-assistant/page.tsx:1775] [alumni] 「報名校友回娘家活動」只 toast「已成功報名」但沒有寫入任何 store；下次切回校友再點還是「成功」。 → 寫入 demoStore.libraryReservations 或新增 events 集合。

---

## 2. 跨頁邏輯對不上（25 條）

[2-link] [apps/web/src/app/admin/students/[id]/page.tsx:34] [teacher/admin] 每位 DEMO_STUDENT 的 `enrolledCourses` 都硬寫成 `['c1', 'c2', 'c3']`，但 DEMO_GRADES 只有 stu-001 王小明的成績。其他 11 位學生點進來都會顯示「修課中」三門課但沒有成績。 → 為每位學生產生差異化的選課與成績資料。
[2-link] [apps/web/src/app/search/page.tsx:41] [teacher/admin] 搜尋結果 `陳大同 (M11302014)` 不在 DEMO_STUDENTS 中（清單只到 M11302012）。點進去會顯示「找不到此學生」。 → 改成 M11302002 等存在的 studentId 或把 stu-013/14 加進 DEMO_STUDENTS。
[2-link] [apps/web/src/app/profile/page.tsx:413] [全角色] CURRENT_SEM_COURSES 用 c.code 映射 courseId，但 ENG201 → c6 不在 DEMO_GRADES（沒有英文寫作成績），點進 /course/c6 雖然有 workspace fallback 但和 grades 頁沒成績、行為不一致。 → 統一資料源。
[2-link] [apps/web/src/lib/aiContext.ts:438] [alumni] AI Alumni Context 中顯示「李校友（B09203001）」，但 DEMO_USERS 的 alumni 是「張學長」。 → 改成 `張學長`。
[2-link] [apps/web/src/app/ai-assistant/page.tsx:1763] [alumni] 申請成績單代理時送出去的廣播寫 `B09203001` 學號，但 roleLabel 是 `校友`。 → 應該用 demoUser.displayName。
[2-link] [apps/web/src/app/ai-assistant/page.tsx:1492] [student] AI 一鍵「訂餐」固定下單「校園小棧」（從未在 cafeteria 頁出現過），語意脫節。 → 從 DEMO_CAFETERIAS 第一家挑或讓使用者選。
[2-link] [apps/web/src/app/ai-assistant/page.tsx:1456] [student] AI 一鍵「求助 TA」固定針對 c1 / 林助教，學生若沒選 c1 也會發。 → 用最近一個有問題的課程，或讓使用者選。
[2-link] [apps/web/src/app/ai-assistant/page.tsx:1437] [student] 一鍵續借假設 bookId 1/2/3 都未到期就 +14；如使用者 manually 把第 3 本續借過了會出現 renewCount > 3 不檢查的問題（雖然有 cnt < 3 guard，但 UI 顯示「已續借 3 本」對只有 1 本可續借會誤導）。 → 寫實際續借了幾本。
[2-link] [apps/web/src/app/ai-assistant/page.tsx:670] [admin] 對所有教師發送密碼重設提醒用 `sendDeptBroadcast({ audience: ['teacher'] })`，但 DEMO_USERS 只有 1 位教師 demo-teacher-1（王大明），訊息只會出現在他收件匣。 → 文案改成「教師王大明已收到」或加更多 teacher demo 帳號。
[2-link] [apps/web/src/app/admin/page.tsx:744] [admin] 角色變更 modal 列出 7 種角色（缺 guest），但 DEMO_ROLES 共 8 種。 → 補上 guest 或註明「demo 不可變更為 guest」。
[2-link] [apps/web/src/app/admin/page.tsx:749] [admin] 點角色按鈕只 info「（demo：寫入 audit log）」但沒實際變更，且 DEMO_USERS 是常數無法修改。 → 改用 demoStore 紀錄 roleOverride，並讓首頁 / 訊息頁能讀到。
[2-link] [apps/web/src/app/admin/page.tsx:78-82] [admin] SECURITY_LOG 第 4 筆「B10203015@pu.edu.tw」與 DEMO_USERS 中的 club.chen（B11203015@pu.edu.tw）不一致，admin 也不會在使用者管理找到 B10203015。 → 對齊 studentId。
[2-link] [apps/web/src/app/teacher/course/[courseId]/page.tsx:115-121] [teacher/ta] 教師端 fallback 用 getDemoCourseWorkspace 對任何 courseId 都生 demo workspace；ta 進入 /teacher/course/c2（線性代數，陳小華老師）會看到自己是助教，但 DEMO_USERS 助教只配屬 c1。 → 在進入前 guard：ta 只能進 c1。
[2-link] [apps/web/src/app/teacher/course/[courseId]/page.tsx:60] [department_head] 系主任在 demo mode 被視為 canManage（教師工作台 allowed）；但 caps.canEditModules 為 false，UI 出現「教師專用」灰色按鈕；體驗矛盾。 → 系主任視角應明示「唯讀檢視」並全部按鈕 disable。
[2-link] [apps/web/src/app/teacher/course/[courseId]/gradebook/page.tsx:155-185] [teacher] 發布成績時用 `computed.rows` 包含全部 DEMO_STUDENTS（12 位），但 publishGrades 又呼叫 sendMessage 廣播給 `recipientRoles: ['student']`，所以 demo 中王小明（學生）會收到一則「成績已發布」訊息。但是 store.publishedGrades 寫入後，grades 頁的 sorted 並沒有讀 publishedGrades（永遠用 DEFAULT_GRADES）。 → 學生 grades 頁應 merge store.publishedGrades。
[2-link] [apps/web/src/app/course/[courseId]/page.tsx:436] [student] 學生在 /course/c2 點動態作業繳交時，寫入 `studentId: 'stu-001'` 但繳交目標 courseId=c2 並不是 stu-001 應該繳的（其實 stu-001 就是王小明，OK），但教師端只有 c1 會看到 pending submission，c2 的教師（陳小華 = demo-teacher-2）不存在於 DEMO_USERS，這份繳交永遠不會被批改。 → c2-c8 教師資料補齊或在 UI 上限制只能對 c1 提交。
[2-link] [apps/web/src/app/messages/page.tsx:449] [全角色] 訊息 detail 中「📥 前往公告審核佇列」link 對所有角色都導 /admin，但 student / club_officer 沒有 admin 權限，會被 admin 頁攔截。 → 根據角色決定 href（學生改導 /announcements/[id]）。
[2-link] [apps/web/src/app/grades/page.tsx:453] [admin] admin 角色點「學生成績管理」導向 `/admin/students` 但該 index 頁不存在（只有 `/admin/students/[id]`）。 → 建立 /admin/students 列表頁，或改導 /admin。
[2-link] [apps/web/src/app/admin/page.tsx:130-153] [dept_head] 系主任核准公告後 `notifyStudentsAnnApproved` 推給 student 角色，但只有單一 student demo 帳號（王小明），且訊息列表 announcements 並沒有真的把 ann-1 ~ ann-7 的 status 改成「approved」，所以 admin 頁的 SECURITY_LOG / 公告統計都是看不到新進公告的。 → addPendingAnn → approvePendingAnn 後也要 push 到 DEMO_ANNOUNCEMENTS（或另一個 store.publishedDynamicAnns）。
[2-link] [apps/web/src/app/announcements/page.tsx:236] [teacher/dept_head/club_officer] mineSourceMatches 判斷「教師發的」靠字串包含「王大明」or「老師」，會把其他老師（陳小華、李志明）的公告也算進「自己發的」。 → 用 submittedByUid / authorUid 比對。
[2-link] [apps/web/src/app/announcements/page.tsx:715-731] [teacher] NewAnnModal onSubmit 把所有 teacher 角色的 source 都寫成「王大明老師」，但 demo 有多位教師。雖然 demo 只有 1 位真實 teacher，但其他課的公告（c2-c8）會混淆。 → 用 demoUser.displayName 而非寫死。
[2-link] [apps/web/src/app/teacher/course/[courseId]/page.tsx:387] [teacher] 教師新增作業時 `courseName: courseInfo?.name ?? '課程'`，但若 teacher 切到 c2 新增作業，會以王大明老師名義通知學生 c2 課程，假冒陳小華。 → guard：teacher 只能對自己 instructorId=demo-teacher-1 的課新增作業。
[2-link] [apps/web/src/app/teacher/course/[courseId]/page.tsx:64-67] [teacher/ta] 教師 / TA / admin 自動 redirect 到 /teacher/course/c1，包含從 /course/c2 進來時也會強制跳 /teacher/course/c2 — 但 c2-c8 的 instructorId 不是當前 demo-teacher-1。 → 對 c2-c8 應該不 redirect，或顯示「你不是這門課的教師」。
[2-link] [apps/web/src/app/credit-planner/page.tsx:856] [全角色] 分數欄位 `course.score > 0 ? course.score : course.grade` 在「修習中」課程會 fallback 顯示「修習中」字串到分數欄位，但 fontSize 80px、letterSpacing -0.04em 並不適合中文，視覺擠出格子。 → 統一 N/A 顯示。
[2-link] [apps/web/src/app/page.tsx:165-172] [admin] Hero「⚠️ 注意安全警示」徽章與下方 admin AI 提醒「異常登入」同時顯示「今日偵測 1 件」；但 admin 收件匣 `msg-ad1`、roleNotifications n-ad-1、SECURITY_LOG 都各自描述一次（4 處），數據耦合錯。 → 抽成單一 securityEvents 來源。

---

## 3. 訊息／資料洩漏（10 條）

[3-leak] [apps/web/src/lib/demoData.ts:1402] [teacher] `msg-t2`「課程系統」訊息列出 5 位學生姓名 + 提交時間 — 給 teacher OK。但 ta 角色（林助教）需要的「11-20 號學生」並沒有對應訊息，這份訊息助教也想看。recipientRoles 應包含 `['teacher', 'ta']`。
[3-leak] [apps/web/src/lib/demoData.ts:1437] [teacher] `msg-t4`「你發布的公告已獲核准」recipientRoles 只給 `['teacher']`，但其他發起公告的角色（club_officer、dept_head）也應該收到對應通知。 → 訊息泛化或為各角色各加一則。
[3-leak] [apps/web/src/lib/demoData.ts:1484] [club_officer] `msg-c1`「3 位新成員申請入社」明確列出 3 位申請人姓名 + 系所 + 學號（李宇欣 B11302088、張博文 B11202044、陳怡萱 B11305012）。這些學號跟 DEMO_STUDENTS 沒有對齊（stu-001~012 全是 M11302xxx），且洩漏不在學生名單內的個資（虛構但格式真實）。 → 對齊 DEMO_STUDENTS。
[3-leak] [apps/web/src/app/clubs/page.tsx:74-87] [club_officer] 程式設計社社長（陳社長）視角 `MOCK_CLUBS` 顯示「攝影社 unread 1」「創業研究社 unread 2」等不該屬於他的未讀數，因為 unread 是寫死在 DEMO_CLUBS 上的全域值（任何人看到都是同一個數字）。 → unread 應該 per-role 計算，或者社團幹部只看自己的社團。
[3-leak] [apps/web/src/app/groups/page.tsx:91-99] [club_officer] /groups 對社團幹部顯示所有 6 個社團的 lastMessage（例如「春季外拍照片上傳啦」「報名截止 5/28」），這些都是其他社團內部訊息。 → 社團幹部應只看「我管理的」+ 公開課程；其他社團 lastMessage 隱藏。
[3-leak] [apps/web/src/app/groups/page.tsx:73-86] [teacher] /groups 對教師顯示 8 門課程，每門課的 lastMessage（例：「期中考成績已公布」由 c7 劉建宏老師發），王大明老師不該看到其他老師班上的內部訊息。 → 教師只顯示「我授課的」+ 「我加入的社團」。
[3-leak] [apps/web/src/app/grades/page.tsx:241-355] [ta] TA 視角 /grades 直接展示全班 12 位學生的「作業 95、期中 96、期末 97」等完整分數明細 + 學號 + 姓名 + 紅字「⚠️ 需關注」標籤。TA 在實際校園系統通常只能看到「該批改學生」而非全班；至少應該強調這是「批改視角」並 mask 學號。
[3-leak] [apps/web/src/app/admin/page.tsx:71-75] [admin] filteredUsers 顯示所有 7 位 DEMO_USERS 的 email、department、role；admin 看是合理的，但若是 dept_head 進 /admin 也會看到 admin@pu.edu.tw 與 alumni@gmail.com 的個資。實際上 dept_head 不應看到系外帳號（admin、alumni）。 → 用 caps.canManageUsers 而非 canViewAdminDashboard guard 該區塊（dept_head 應只看「使用者管理」=hidden）。
[3-leak] [apps/web/src/lib/demoData.ts:1290-1295] [teacher] TEACHER_PENDING_REVIEWS 是 module-level 常數，所有教師角色都會看到同一份「王小明、陳雅婷、林俊宏…」5 位學生待批改。在 demo 只 1 個教師沒問題，但若擴充到 2+ 教師會看到不屬於自己的學生 → 結構性缺陷。 → 改成 byCourseId 索引。
[3-leak] [apps/web/src/app/teacher/course/[courseId]/gradebook/page.tsx:29-37] [ta/admin/dept_head] DEMO_STUDENTS 全部 12 位無論 courseId 都顯示同一份。Dept_head 進入 /teacher/course/c2 看到的 12 位學生其實是 c1 班級。 → courseId 應該決定學生 roster。

---

## 4. 重複/相似功能（10 條）

[4-dup] [apps/web/src/app/page.tsx:60 + apps/web/src/components/SiteShell.tsx:41] [全角色] 首頁與 SiteShell 都各自用 `getUnreadCountDynamic(demoRole, store)` 算未讀數；雖數值一致，但雙處計算且 SiteShell 也有 badge。建議首頁不再額外算，直接讀 SiteShell 已 context 化的值。
[4-dup] [apps/web/src/app/page.tsx:65-77 + apps/web/src/app/admin/page.tsx:57-68 + apps/web/src/app/announcements/page.tsx:181-190] [admin/dept_head] 三個頁面分別 listen 'demoPendingAnnChange' + 'storage' 並各自 setPendingQueue。三處數字（首頁 hero「3 則待審」、admin metric「pendingApprovals」、announcements stats「pending」）必須同步，目前是巧合一致。 → 抽 hook usePendingAnns()。
[4-dup] [apps/web/src/app/announcements/page.tsx:583-595 + apps/web/src/app/admin/page.tsx:151-153] [dept_head/admin] 「核准 / 退回」公告動作在 announcements 頁與 admin 頁各實作一次。退回邏輯不一致：admin 頁 `rejectPending` 用 `approvePendingAnn(id)`（標為已處理），announcements 頁 `退回修改` 也是用 `approvePendingAnn(id)`。兩處都把退回當成核准實作，且都不送任何「請修改」訊息給原提交者。 → 抽出 demoStore.rejectAnnouncement(id, reason) 並通知提交者。
[4-dup] [apps/web/src/app/clubs/page.tsx:255-281 + apps/web/src/app/announcements/page.tsx:441-475] [club_officer] 「發布社團活動 / 公告」按鈕在 /clubs（toast only）與 /announcements（真實 modal）各一份；功能行為差很大。 → 保留 /announcements 那份，/clubs 改成導向。
[4-dup] [apps/web/src/app/admin/page.tsx:579-622 + apps/web/src/app/ai-assistant/page.tsx:1684-1709] [dept_head] 「系所廣播」功能在 /admin 系所廣播 card 與 /ai-assistant AI 一鍵動作各一份。內容差不多但 audience 預設不同（admin 頁是 ['student','teacher','ta']，AI 是同樣但 fromName 不同）。 → 統一在 ai-assistant 用 AI 草稿後再走 admin 廣播路徑。
[4-dup] [apps/web/src/app/teacher/course/[courseId]/page.tsx:340-405 + apps/web/src/app/ai-assistant/page.tsx:1543-1582] [teacher] 「新增作業 / 批量提醒」在教師工作台與 AI 助理各有一份；後者 hard-coded「5 件未繳」。 → AI 端應讀真實 store.dynamicAssignments 計算未繳人數。
[4-dup] [apps/web/src/components/DemoRolePill.tsx:163-220 + apps/web/src/app/login/page.tsx:225-291] [全角色] 兩個角色切換器（DemoRolePill 與登入頁 demo 快速登入）各自呼叫 writeDemoRole；前者用 router.push、後者用 router.push；切換邏輯不一致（DemoRolePill 有 isPathOkForRole 判斷，login 直接跳 entryHref）。 → 抽 switchRoleTo(role) helper。
[4-dup] [apps/web/src/app/page.tsx:200-263 + apps/web/src/lib/roleNotifications.ts:32-196] [全角色] 首頁 hero 統計（重要公告數、未讀訊息、社團成員等）和 roleNotifications.ts 的角色通知清單，兩處資料分開硬編碼但描述同一狀況；例：roleNotifications.ts `n-tc-1` 寫「8 件作業待批改」，但 aiContext.ts `getTeacherContextSummary` 返回 5；又：roleNotifications.ts `n-ta-1` 寫「3 件待批改」與 aiContext 數字也對不上。 → 統一從 demoStore / aiContext 算。
[4-dup] [apps/web/src/lib/demoData.ts:1289-1295 (TEACHER_PENDING_REVIEWS) + apps/web/src/lib/demoStore.ts:296-328 (submitAssignment)] [teacher] 教師端的「5 件待批改」清單與「動態繳交」分為兩個資料源；teacher gradebook 頁的 `pendingSubmissions` 只看動態繳交，不包含 TEACHER_PENDING_REVIEWS（5 件靜態），數字會打架。 → 合併或補上 lookup helper。
[4-dup] [apps/web/src/app/settings/page.tsx:600-661 + apps/web/src/app/admin/page.tsx:439-509] [admin] 系統設定（學校資訊、認證、日誌、通知）在 /settings system 區塊與 /admin 「⚙️ 系統設定」各一份。/settings 那邊全 router.push 到 /admin，看似已導向，但 /admin 系統設定也只是 modal 顯示文字。 → 二選一保留。

---

## 5. AI 主軸不夠突出（8 條）

[5-ai] [apps/web/src/app/messages/page.tsx:125] [全角色] 訊息頁只有最頂端有「讓 AI 整理」入口；單一訊息 detail（line 459-514）的回覆區沒有「讓 AI 起草回覆」按鈕。 → 在回覆 textarea 旁加「🤖 AI 起草」按鈕。
[5-ai] [apps/web/src/app/course/[courseId]/page.tsx:393-421] [student] 每個教材 module row 只有「⬇ 下載」按鈕，沒有 AI 對該教材摘要的入口。 → 在每個 module row 加「🤖 AI 重點」icon button。
[5-ai] [apps/web/src/app/course/[courseId]/page.tsx:480-541] [student] 每個作業 row 只有「📤 繳交」/「✏️ 應試」，沒有「🤖 AI 幫你檢查作業要求 / 給靈感」入口。 → 在 row 加 AI 快捷按鈕。
[5-ai] [apps/web/src/app/grades/page.tsx:684-763] [student] 個別成績列沒有「AI 為什麼這科分數低 / 改進建議」入口（每門課應該都能呼叫 AI）。 → 在 row 加 AI 圖示按鈕。
[5-ai] [apps/web/src/app/library/page.tsx:170-230] [student] 書目搜尋結果只有「預約借閱」/「已借完」按鈕，沒有「AI 摘要這本書」「AI 為何推薦」入口。 → 加 AI 圖示按鈕。
[5-ai] [apps/web/src/app/cafeteria/page.tsx:464-499] [student] 菜單列表沒有 AI 入口（學生會想問「今天午餐建議」「卡路里」）。 → 餐廳 section 頂端加「🤖 AI 今日推薦」按鈕。
[5-ai] [apps/web/src/app/bus/page.tsx:194-213] [全角色] 公車頁完全沒有 AI 入口；學生會想問「下一班幾點到 XX 餐廳」。 → 至少加 1 個 AI 入口卡片。
[5-ai] [apps/web/src/app/profile/page.tsx:444-498] [全角色] courses tab 對 teacher / club_officer / alumni / admin / department_head 都顯示「沒有資料 + 一個導向按鈕」，但這幾段卻沒有 AI 入口（教師看 courses 應該能問 AI 班級表現、校友能問 AI 整理在校紀錄）。雖然每個身份 hero 區有 AI 卡片，但這幾個 tab 內仍應有 inline AI 入口。
[5-ai] [apps/web/src/app/admin/students/[id]/page.tsx:206-244] [teacher/admin/dept_head] 學生個人檔案頁完全沒有 AI 入口 — 但這正是教師最需要 AI 摘要「這位學生需要關注嗎？」的場景。 → 在「🛠️ 管理動作」card 加「🤖 AI 摘要」按鈕。
[5-ai] [apps/web/src/app/teacher/course/[courseId]/attendance/page.tsx:158-213] [teacher/ta] 歷史 attendance session 列表每堂課只有「查看名單 / 匯出 CSV」，沒有「AI 分析這堂出席異常」入口（雖然頁面底部已有 AI 出勤分析，但 inline per-session 沒有）。 → 在每個 session row 加 AI button。
[5-ai] [apps/web/src/app/timetable/page.tsx:740-770] [student] 課表週視圖每個課程 cell 沒有 AI 入口；長按或 hover 應該能呼叫 AI 提問「這堂課的作業有哪些？」。
[5-ai] [apps/web/src/app/clubs/page.tsx:456-540] [student] 每個社團卡片只有「申請加入 / 已加入」按鈕，沒有 AI 入口（學生看到陌生社團應該能問 AI「這社團適合我嗎？」）。 → 加 AI quick-ask 按鈕。
[5-ai] [apps/web/src/app/ai-assistant/page.tsx:106-110] [guest] 訪客快速問題只有 2 個（其他角色都 3-6 個），訪客其實也需要更多公開問題引導（如「學校在哪？」「申請流程？」「校園地圖在哪？」）。 → 補到 4-5 個。

---

## 統計

- 第 1 類 Dead button：30 條
- 第 2 類 跨頁邏輯：25 條
- 第 3 類 訊息資料洩漏：10 條
- 第 4 類 重複功能：10 條
- 第 5 類 AI 主軸缺失：13 條

**總計：88 條**

---

## 補充：較有破壞性的 P0 修法優先順序

1. [3-leak] `/admin/students/[id]` 所有學生硬寫 enrolledCourses=[c1,c2,c3] → 全班學生點進來都長一樣（嚴重）
2. [2-link] /search 搜尋指向 M11302014 但學生資料不存在 → 點進去 404（demo 破功）
3. [1-dead] /teacher/course/[id]/quizzes 三顆按鈕（新增測驗 / 編輯題目 / 看答案）完全沒 onClick（教師主線最常用頁面）
4. [4-dup] roleNotifications.ts 與 aiContext 的待批改數字不一致（8 vs 5 vs 3）→ 教師首頁、訊息頁、AI 開場白看到不同數字
5. [3-leak] /groups 對社團幹部 / 教師顯示所有其他社團 / 課程的 lastMessage → 角色 demo 看起來像系統 bug
6. [2-link] aiContext.ts buildAlumniContext 把校友寫成「李校友」但 DEMO_USERS 是「張學長」→ AI 開場白角色錯誤
7. [1-dead] /announcements/[id] 編輯 / 下架按鈕只 toast → dept_head 演示流程 broken
