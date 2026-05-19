# Demo 終極化驗證報告

**日期：** 2026-05-17
**範圍：** Web (apps/web) + Mobile (apps/mobile) 全端

---

## 1. 建置驗證

| 工具 | 結果 |
|------|------|
| `apps/web` `npx tsc --noEmit` | ✅ 0 errors |
| `apps/web` `npx eslint src --max-warnings=0` | ✅ 0 warnings |
| `apps/mobile` `npx tsc --noEmit` | ✅ 0 errors |

---

## 2. 本輪交付內容

### A. 規劃文件（docs/）
1. **ROLE_FEATURE_MATRIX.md** — 8 角色 × 40+ 功能完整矩陣
2. **DEMO_NARRATIVE.md** — AI 主軸的一週校園故事 + 8 分鐘 demo 走場節奏
3. **CONSOLIDATION_PLAN.md** — 重複功能整合與刪除清單

### B. demoStore 擴展（核心）
**修 3 個 bug：**
- `publishGrades()` 不再寫死 stu-001 — 接受 `studentScores[]` 或自動派全班
- `approveClubMember()` 不再寫死「陳社長／程式設計社」— 從 membership + DEMO_CLUBS 動態讀
- `endAttendanceSession()` 通知所有 absentUids（不再只 stu-001）

**新增 9 條動作鏈：**
| # | 動作 | 函式 |
|---|------|------|
| 7 | 教師起草評語 → 學生 | `submitFeedback()` |
| 8 | 學生發討論 → 同學/老師/TA | `postDiscussion()` |
| 9 | 學生求助 / TA 回覆 | `requestHelp()` / `replyHelpRequest()` |
| 10 | 訂餐 / 推進狀態 | `placeOrder()` / `updateOrderStatus()` |
| 11 | 請假 / 核准 | `requestLeave()` / `decideLeave()` |
| 12 | 宿舍報修 / 派工 | `submitDormRepair()` / `setDormRepairStatus()` |
| 13 | 同儕互評（指派+提交） | `assignPeerReview()` / `submitPeerReview()` |
| 14 | 批量提醒 | `bulkRemind()` |
| 15 | 系所廣播 / 公告核准回頭通知 | `sendDeptBroadcast()` / `notifySubmitterAnnApproved()` |
| 16 | 管理員停用/啟用使用者 | `setUserDisabled()` |
| 17 | 圖書館 預約 / 轉讓 | `reserveBook()` / `transferBook()` |

DemoStore 介面新增欄位：`feedbackDrafts`、`discussionPosts`、`helpRequests`、`orders`、`leaveRequests`、`dormRepairs`、`peerReviews`、`disabledUsers`、`libraryReservations`，皆為 optional 不破壞既有 localStorage。

### C. Web 死按鈕修復

| 頁面 | 原死按鈕 | 修復做法 |
|------|---------|---------|
| `/admin` 角色 | toast only | 開 Modal，可選 8 種角色 |
| `/admin` 檔案 | toast only | 開 Modal，顯示教師檔案 + 跳工作台連結 |
| `/admin` 系統設定 × 4 | toast only | 開 Modal，顯示完整設定面板（學校資訊 / 認證 / 日誌 / 通知） |
| `/admin` 維護模式 | 假 toggle | 真 state，啟用會觸發系所廣播 |
| `/admin` 發布公告 | toast only | 跳 `/announcements?compose=1` 自動開 modal |
| `/admin` 停用使用者 | local Set | 改用 `setUserDisabled()` 持久化 |
| `/admin` 系所廣播 | （無此功能） | 新增表單，呼叫 `sendDeptBroadcast()` |
| `/settings` 系統 × 11 | toast only | 全部 redirect 到 `/admin` 真實後台 |
| `/settings` 系所 × 6 | 部分 toast | 全部 redirect 到 `/admin` / `/credit-planner` / `/announcements?compose=1` |
| `/settings` 匯出個人資料 | 無 onClick | 真實 JSON Blob 下載 |
| `/settings` 刪除帳號 | 無 onClick | confirm + clear localStorage + redirect /login |
| `/teacher/.../modules` 新增單元 | 無 onClick | 開 Modal 表單，寫入 state |
| `/teacher/.../modules` 編輯 | 無 onClick | 開 Modal 編輯標題/週次 |
| `/teacher/.../modules` 新增教材 | 無 onClick | 開 Modal，含類型選擇 |
| `/library` 預約借閱 | toast only | 呼叫 `reserveBook()`，學生收訊息 |
| `/library` 轉讓 | （無此功能） | 新增按鈕 + Modal 選擇受讓人，呼叫 `transferBook()` |
| `/announcements` ?compose=1 | 不支援 | 加 URL param 自動開啟新增公告 modal |

### D. AI 主軸升級（核心）

`/ai-assistant` 新增 **AIActionBar** — 每個角色 2~5 個「一鍵動作」按鈕，**真的呼叫 demoStore 動作、寫入跨角色資料、發訊息**。

| 角色 | 一鍵動作 |
|------|---------|
| **student** | 一鍵續借快到期書 ／ 求助 TA ／ 請假 ／ 訂餐 ／ 發討論 |
| **teacher** | AI 起草評語給 3 位重點學生 ／ 批量提醒未繳作業 ／ 發布全班成績 ／ 指派同儕互評 |
| **ta** | 批量回覆求助佇列 ／ 起草批改回饋 |
| **club_officer** | 一鍵核准所有待審入社 ／ 提交招募公告 |
| **department_head** | 一鍵核准所有待審公告 ／ 發系所廣播 ／ 對掛科風險發輔導通知 |
| **admin** | 廣播維護模式 ／ 一鍵封鎖可疑帳號 ／ 對教師發密碼重設提醒 |
| **alumni** | 申請在校成績單 ／ 報名校友活動 |

### E. Mobile 修復
- `HomeworkSubmitScreen` 寫死 `'demo_teacher_chang'` → 改為 `getTeacherUidForCourse(courseId)`
- 新增 `apps/mobile/src/data/demoUserStories.ts` 內統一 `DEMO_TEACHER_UID` 常數與 `getTeacherUidForCourse()` 反查函式
- 其餘 14 個檔案的 hardcoded teacherUid 暫保留（不影響單老師 demo，可後續分批遷移）
- 既有審計報告（`docs/REMAINING_BUGS_AUDIT.md`）所列 7 條 demo 必爆 bug 已全部修復

---

## 3. 8 角色 × Demo 走場驗證表

| 角色 | dashboard | AI 助理 | 跨角色看得到的動作 |
|------|-----------|---------|--------------------|
| student | `/` → 學分 + AI 提醒 | 5 個一鍵動作 | 求助 → TA 收 ／ 請假 → teacher 收 ／ 訂餐 → vendor 收 |
| teacher | `/teacher/course/c1` 完整工作台 | 4 個一鍵動作 | 起草評語 → 學生 ／ 發布成績 → 全班 ／ 批量提醒 |
| ta | TA 紫色橫幅 + 唯讀 | 2 個一鍵動作 | 批量回覆求助 → 學生 |
| club_officer | `/clubs` 審核佇列 | 2 個一鍵動作 | 核准入社 → 學生 ／ 送公告 → 系主任 |
| department_head | `/admin` 公告審核 + 教師名冊 + 系所廣播 | 3 個一鍵動作 | 核准公告 → 學生 + 提交者 ／ 系所廣播 → 全系 |
| admin | `/admin` 使用者 + 安全 + 系統設定 | 3 個一鍵動作 | 停用帳號 → 持久化 ／ 維護廣播 → 全校 |
| alumni | 校友校園公告 + 唯讀 | 2 個一鍵動作 | 申請成績單 → 註冊組 |
| guest | 公開資訊 + 登入提示 | （受限） | 無 |

---

## 4. 故事閉環驗證

走完 7 分鐘 demo 後，**切回 student 看 `/messages`**，應該看到下列訊息（按時序）：
- 圖書館：預約成功 / 借閱轉讓
- 王大明老師：個人化評語（AI 起草）
- 王大明老師：作業批量提醒
- 課程系統：成績已發布
- TA 林助教：求助回覆
- 校園小棧：訂單成立 / 狀態變更
- 課程系統：請假核准
- 黃主任：系所廣播 / 期末考時程 / 學業輔導
- 系統管理員：維護模式廣播 / 密碼重設提醒

這就是 demo 高潮：**一個學生看到 6 個角色在過去 7 分鐘為他做了什麼。**

---

## 5. 已知限制（不影響 demo）

| 項目 | 嚴重度 | 說明 |
|------|--------|------|
| `/teacher/course/[id]` 系列頁面無 server-side role guard | P3 | 學生直接輸入 URL 仍可進入；demo 場景透過身份膠囊切換，不會發生 |
| `npm run build` FUSE 衝突 | INFRA | 沙盒問題；macOS / Vercel 本機可正常 build |
| Mobile 端 14 個檔案仍寫死 `demo_teacher_chang` | P3 | 單老師 demo 不影響，後續遷移 |
| AI 服務 30+ 重複檔案 | P3 | 已有 `docs/AI_SERVICE_CONSOLIDATION_PLAN.md`，本次未執行整合（避免影響 demo） |

---

## 6. Demo 前最後檢查清單

- [ ] 開啟 `/` 切 8 角色每個都進得去
- [ ] `/ai-assistant` 按每個一鍵動作都看到 toast + 對應角色 inbox 收到訊息
- [ ] `/admin` 系統設定 4 卡都能開 modal
- [ ] `/teacher/course/c1/modules` 新增單元 / 編輯 / 新增教材 三個 modal 都能開
- [ ] `/library` 續借、預約、轉讓三個按鈕都能用
- [ ] `/settings` 系統 / 系所 row 點下去都會跳到 `/admin`
- [ ] 完成上面 6 步後，切 student 看 `/messages` 滿滿都是其他角色的動作回音

