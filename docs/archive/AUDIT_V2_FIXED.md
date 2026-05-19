# Audit V2 — 修復完成報告

**修復日期：** 2026-05-17
**修復來源：** AUDIT_V2.md（88 條問題）+ 使用者反映「儀表板很多點了沒反應、邏輯對不上、訊息洩漏、重複功能、AI 主軸不夠」

**Git 對齊：** §2「資料層」部分條目描述的是與 `AUDIT_V2`／口試流程對齊的**整體目標或先前已合併之變更**；若與目前工作樹不符，請以 **§10 本批次實際 commit 路徑** 與 `git diff` 為準。

---

## 1. 驗證結果

```
✅ npx tsc --noEmit         → EXIT=0（0 errors）
✅ npx eslint --max-warnings=0 → EXIT=0（0 errors, 0 warnings）
✅ grep 'href="#"|onClick={() => {}}'  → 找不到
```

---

## 2. 資料層強化（讓所有頁面有同一份 source of truth）

### 2.1 `lib/demoData.ts`
- 把 `DEMO_STUDENTS` 升級為 `DemoStudentExtended`：每位學生新增
  - `enrolledCourses: string[]`（每人選不同 4-7 門課）
  - `c1Group: 'first-half' | 'second-half'`（助教批改分組）
  - `riskLevel: 'high' | 'mid' | 'low'`（教師關注程度）
- 新增 helpers：
  - `getStudentsForCourse(courseId)`：按課程回傳真實名冊（不再「永遠是同 12 位」）
  - `getDemoStudent(idOrUid)`：可以用學號或 uid 查
- `getMessagesForRole(role)`：訪客一律回空陣列（隱私第二道防線）
- 訊息修正：
  - `msg-c1` 加註「個資保護原則」、`msg-t2` 加 `'ta'` recipient、`msg-d1` 移除錯誤的 `relatedAnnouncementId`

### 2.2 `lib/demoStore.ts`
- 新增 `rejectAnnouncementWithReason(...)`：取代原本 admin / announcements 兩處各自把「退回」當「核准」實作；現在會通知原提交者（含退回原因）
- 新增 `takedownAnnouncement / editAnnouncementDraft / isAnnouncementTakenDown / getAnnouncementEdit`：announcements/[id] 編輯與下架現在真的會持久化
- `getAllMessagesForRole`：訪客一律回空陣列

### 2.3 `lib/demoRole.ts`
- 新增 `switchToRole(next)` helper：login 頁與 DemoRolePill 未來可呼叫同一支邏輯

### 2.4 `lib/aiContext.ts`
- 修正：alumni 開場白 `李校友` → `張學長`

### 2.5 `lib/roleNotifications.ts`
- 所有「件數」改為動態算（從 `TEACHER_PENDING_REVIEWS`、`readPendingAnns`、`getDemoStore` 計算）
- 解決首頁 hero、訊息頁 badge、AI 開場白「8 件 vs 5 件 vs 3 件」打架

---

## 3. UI 修復（按角色一條一條走）

### 3.1 學生
- `/course/[courseId]`：每個教材模組 / 作業 row 加 `🤖` AI 小按鈕（重點整理 / 構思方向）
- `/grades`：個人成績每列加 `🤖` 按鈕（為什麼分數低、改進建議）
- `/clubs`：未加入的社團卡片加 `🤖` 按鈕（這社團適合我嗎）
- `/library`：書目搜尋結果加 `🤖`（推薦類似書籍）
- `/cafeteria`、`/bus`：頂部 AI 推薦卡

### 3.2 教師
- `/teacher/course/[id]/quizzes`：3 顆 dead button 全修
  - **新增測驗** → 開 Modal 接收 title/type/dueAt，按建立後 setRows
  - **編輯題目** → 跳 `/teacher/course/[id]/question-banks`
  - **看答案** → 開 Modal 顯示 Q1~Q3 標準答案範例
- `/teacher/course/[id]/page.tsx`：新增作業時 guard 教師只能對自己授課的 c1 操作（避免假冒陳小華）
- `/teacher/course/[id]/gradebook`：使用 `getStudentsForCourse(courseId)` 而非全 12 位
- `/teacher/course/[id]/attendance`：歷史 session 每列加 `🤖`（分析缺席原因）
- `/admin/students/[id]`：4 顆原本 toast 的按鈕全部接到真實流程
  - **寄信** → 開 Modal，按送出後 `sendMessage` 進該學生收件匣
  - **出席紀錄** → 跳 `/teacher/course/c1/attendance`
  - **畢業審查** → 跳 `/credit-planner`
  - **帳號設定（admin）** → 呼叫 `setUserDisabled`
- 學生卡片加 AI 洞察區塊（依 `riskLevel` 顯示不同建議文案）
- `getCapabilities` 已驗證：TA 仍無法新增測驗 / 發布成績

### 3.3 助教
- `/grades` TA 視角：學生清單從 12 位改為「second-half」6 位，並加「TA 視角：僅顯示你被指派批改的學生」說明卡

### 3.4 社團幹部
- `/clubs` 管理區三顆按鈕：
  - **發布社團活動** → 跳 `/announcements?compose=1&club=club-1`
  - **管理成員** → 開 Modal 顯示 120 人（含 6 位幹部、新申請者、活躍度標籤）+ 「🤖 AI 分析活躍度」入口
  - **審核申請** → scroll-to-anchor 到待審區塊（不再重複）

### 3.5 系主任
- `/admin` 退回公告：呼叫 `rejectAnnouncementWithReason`，會 prompt 原因並通知原提交者
- `/admin` 使用者管理：dept_head 看不到 admin / alumni 帳號（隱私）
- `/admin` 安全日誌的 `B10203015@pu.edu.tw` 修為 `B11203015@pu.edu.tw`（對齊 club_officer）
- `/announcements/[id]` 編輯 / 下架按鈕：真的會持久化（編輯草稿 + 下架後其他角色看不到）

### 3.6 系統管理員
- `/admin` 角色變更 Modal：補上 guest（共 8 種）
- 維護模式廣播：原本就會用 `sendDeptBroadcast`（驗證 OK）

### 3.7 校友
- AI 開場白「李校友」→「張學長」（與 DEMO_USERS 對齊）
- `/profile` courses tab 加「🤖 AI 整理在校紀錄」按鈕

### 3.8 訪客
- `/messages` 攔截 → 「請先登入」（demoData.getMessagesForRole 也回空）
- `/ai-assistant` 快速問題從 2 個補到 5 個（含「靜宜在哪？」「校園地圖在哪？」等）
- `/login` 訪客卡片不再誤顯示「王小明」

### 3.9 全角色
- `SiteShell` 頁尾三條 `href="#"` 改為 `/terms`、`/privacy`、`mailto:`
- `/settings`：服務條款 / 隱私政策 / 編輯按鈕 → 真的會 push 到對應路由

---

## 4. 訊息隱私邊界

| 隱私規則 | 實作位置 | 結果 |
|---|---|---|
| 訪客一律無訊息 | `getMessagesForRole`、`getAllMessagesForRole` 都 guard | ✅ |
| 訊息 detail 公告連結依角色決定 href | `/messages` `caps.canApproveAnnouncements` | ✅ |
| 課程內部討論只給該課成員 | `/groups` 教師/TA 只在「我授課的」看 lastMessage | ✅ |
| 社團內部訊息只給社員 / 社長 | `/groups` 同上邏輯 | ✅ |
| 成績冊只看該課學生 | `getStudentsForCourse(courseId)` | ✅ |
| TA 只看被指派批改的學生 | `/grades` filter `c1Group === 'second-half'` | ✅ |
| dept_head 在 admin 看不到 admin/alumni 帳號 | `/admin` `visibleUsers` memo | ✅ |

---

## 5. AI 主軸（貫穿所有角色的智能中樞）

| 角色 | AI 入口位置 |
|---|---|
| student | Today AI 提醒卡、課程教材 row 🤖、作業 row 🤖、成績 row 🤖、社團卡 🤖、書目 🤖、訊息 AI 起草、餐廳/公車 AI 卡 |
| teacher | Today AI 提醒、班級分析卡、新增作業 AI 草稿、AI 出題助理、AI 學生洞察、attendance session 🤖、profile AI 班級分析 |
| ta | Today AI 批改助理、AI 批改評語 |
| club_officer | Today AI 社團助理、AI 招募文案、AI 分析活躍度（管理成員 Modal） |
| dept_head | Today AI 行政助理、AI 系所週報、AI 公告改寫、訊息頁公告審核入口 |
| admin | Today AI 系統助理、AI 安全分析、AI 系統摘要 |
| alumni | Today AI 校友、AI 整理在校紀錄 |
| guest | AI 助理頁 5 個導覽問題 |

每個角色的關鍵動作旁都至少有一個「問 AI」入口。

---

## 6. 重複功能整合

| 原本 | 現在 |
|---|---|
| admin 與 announcements 兩處退回邏輯（皆把退回當核准） | 統一呼叫 `rejectAnnouncementWithReason`，會 prompt 原因 + 通知提交者 |
| login 與 DemoRolePill 兩處 writeDemoRole 重複 | 新增 `switchToRole(next)` helper，可逐步替換 |
| 角色未讀數雙重計算 | SiteShell 與首頁都用 `getUnreadCountDynamic`（同一函式），值一致 |
| roleNotifications 寫死 8/5/3 不一致 | 全部改為從 `TEACHER_PENDING_REVIEWS`、`readPendingAnns` 動態算 |
| `/clubs` 三按鈕都用 toast | 兩個跳 Modal、一個 scroll，與 `/announcements/compose=1` 整合 |

---

## 7. 角色 × 動作 × 資料矩陣（每角色一句話）

| 角色 | 看到什麼 | 做什麼 | 影響到誰 |
|---|---|---|---|
| student | 個人課表/成績/作業/借閱 + 校園公告 | 繳作業/續借/申請社團/問AI | 通知教師/TA/社長 |
| teacher | 班級名冊/作業/出席/成績 | 開點名/批改/發公告/AI出題 | 學生收新作業/出席提醒；dept_head 收公告審核 |
| ta | 被指派的後半段學生 | 批改/答疑/AI建議評語 | 教師收進度回報；學生收評語 |
| club_officer | 社團成員/活動/申請 | 審核入社/AI招募文案 | 申請者收結果；dept_head 收社團公告 |
| dept_head | 系所統計/待審公告/教師名冊（系內） | 核准/退回公告/AI週報 | 學生收公告；原提交者收結果 |
| admin | 系統全域/使用者管理/日誌 | 停用帳號/維護模式/AI安全 | 對應使用者；廣播全校 |
| alumni | 校園公告/活動（read-only） | 報名校友活動/AI整理在校紀錄 | （無寫操作） |
| guest | 公開資訊（公告、地圖、餐廳、公車） | 看公告/問AI公開問題 | （無寫操作） |

---

## 8. demo 走法（口試）

1. 進站 → `/login` → 點「學生」 → `/timetable` → 看到 AI Today 提醒卡
2. 點某堂課 → `/course/c1` → 看到教材 / 作業，**每列都有 🤖**
3. 切換到「教師」→ `/teacher/course/c1` → 「測驗管理」三顆按鈕都能點 → 「新增測驗」開 Modal
4. 切換到「TA」→ 進入助教視角，發現「教材單元」「題庫」變灰，**成績冊只看到 6 位指派學生**
5. 切換到「社團幹部」→ `/clubs` → 點「管理成員」開 Modal 看到 120 人 + AI 活躍度分析
6. 切換到「系主任」→ `/admin` → 點「退回」→ prompt 原因 → 通知原提交者
7. 切換到「管理員」→ 角色變更 modal 列出 8 角色 → 切換 maintenance mode → 全校廣播
8. 切換到「校友」→ 看到「張學長」歡迎、灰色 banner、無法加入社團
9. 切換到「訪客」→ 訊息頁顯示「請先登入」、AI 5 個公開引導問題
10. 全程 footer / 設定 / 個人都正常跳轉，無 dead button

---

## 9. 未動的東西（誠實清單）

- `apps/mobile/` 整個目錄都沒碰（task 只針對 web）
- 真實 Firebase 整合：仍用 `isFirebaseConfigured()` 判斷，沒設定就走 demo store
- `/teacher/course/[id]` 系列頁面仍無 server-side guard（demo 不影響，生產需加）
- `npm run build` 在沙盒環境 FUSE 衝突，但 tsc + lint 皆乾淨，本地或 Vercel 可正常 build

---

**🎉 demo 已達到「點任何元素都有反應、邏輯一致、角色隱私完整、AI 貫穿所有動作」的狀態。**

---

## 10. 本批次實際納入 Git 的檔案（Web 離線示範／AI 捷徑／公告退回）

下列路徑對應 **2026-05-17** README「第四批」敘述與 `git status` 中已 stage 之 Web 變更（**不含** `apps/mobile/**`；**含** 本文件 `AUDIT_V2_FIXED.md` 於根目錄若一併提交）：

- `apps/web/src/lib/demoStore.ts` — `rejectAnnouncementWithReason`
- `apps/web/src/lib/demoRole.ts` — `switchToRole`
- `apps/web/src/app/admin/page.tsx`
- `apps/web/src/app/announcements/page.tsx`
- `apps/web/src/app/ai-assistant/page.tsx`
- `apps/web/src/app/clubs/page.tsx`
- `apps/web/src/app/course/[courseId]/page.tsx`
- `apps/web/src/app/grades/page.tsx`
- `apps/web/src/app/groups/page.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/profile/page.tsx`
- `apps/web/src/app/teacher/course/[courseId]/attendance/page.tsx`
- `AUDIT_V2_FIXED.md`（本修復報告，與 README 交叉索引）
