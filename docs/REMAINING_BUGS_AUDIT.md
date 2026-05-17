# Bug 審視報告（2026-05-16）

> 全 app 系統性檢查，找出 demo 期間可能爆掉的所有 bug。
> 嚴重度：🔴 demo 必爆 / 🟠 跨角色串連失敗 / 🟡 局部 UX 受損 / 🟢 已修

---

## 一、已修的 bug（這輪）

### 🟢 Bug A：VendorDashboard 看不到學生訂單
**原因**：mount 時只讀 mock，沒讀 `__all__` broadcast inbox + LoginLanding 清掉 `__all__`
**修法**：
1. LoginLanding 切角色時保留 `__all__`（移除 `clearRoleEventInbox('__all__')`）
2. VendorDashboard mount 載入 `loadRoleEventInbox(vendorUid)` 過濾 `order_placed`
**測試**：`__tests__/orderFlow.test.ts` 4 個整合測試

### 🟢 Bug B：TeacherCockpit 沒讀歷史 inbox
**同類 bug**：學生在切到老師帳號前繳交的作業，老師 mount 後不會看到。
**修法**：`useEffect` 第一段加 `loadRoleEventInbox`，filter `homework_submitted` / `discussion_posted` / `leave_requested` 三類，merge 進 state。

### 🟢 Bug C：TADashboard 同類 bug
**修法**：同 Bug B，加 `loadRoleEventInbox` 過濾 `help_requested` / `discussion_posted` / `homework_submitted`。

### 🟢 Bug D：DepartmentDashboard 同類 bug
**修法**：`subscribeAllRoleEvents` 配對 `loadRoleEventInbox(adminUid)`，過濾掉 vendor / 自己廣播後 merge。

### 🟢 Bug E：學生簽到沒 emit `attendance_checked_in`
**原因**：AttendanceMultiMethodScreen 簽到成功只 alert，沒 emit 跨角色事件 → 老師 cockpit / AttendanceLive 看不到出席變化
**修法**：在 try / catch 兩條成功路徑都加 `emitAttendanceCheckedIn`，target = 該課老師

### 🟢 Bug F：AI 學伴邀請 / 求助沒 emit
**原因**：sendInvite 和 instant help 按鈕只 alert
**修法**：
- sendInvite → `emitAnnouncementPosted` 限定 audience = 對方 uid
- 即時求助 → `emitHelpRequested` target = 對方 + TA

### 🟢 Bug G：「即將推出」字串
**原因**：22 個 fallbackMessage 寫了「即將推出」，但所有 route 都註冊好了，這文字永遠是死字
**修法**：用 sed 全部清除 + safeNavigate 預設文案改為「無法開啟」

### 🟢 Bug H：cross-tab navigation silent fail
**原因**：「Today」tab 按按鈕跳「學習」tab 的 route → React Navigation 找不到 → silent fail → 觸發 `onUnhandledAction`
**修法**：
1. 建 `routeRegistry.ts` 中央 route → tab 對照表
2. `safeNavigate` 3 段式：同 stack 先試 → 不行查 registry cross-tab → 不行才 fallback alert

---

## 二、還沒修但 demo 風險較低的 bug

### 🟠 Bug I：hardcoded `teacherUid: 'demo_teacher_chang'`
**位置**：HomeworkSubmitScreen / TeacherGradingScreen / AttendanceMultiMethodScreen
**問題**：學生繳交所有作業都 emit 給 demo_teacher_chang，不論該課真正的老師是誰。
**真實情境**：多老師 demo 會混亂；單 demo 老師沒事。
**修法建議**：
- 從 `DEMO_COURSES[courseId].instructor` 反查老師 uid（建 instructor → uid mapping）
- 或在 RoleEvent payload 加 `teacherUidMapper(courseId)` 統一處理

### 🟠 Bug J：直接 `navigation.navigate(...)` 沒走 safeNavigate
**剩 3 處**：
1. `CourseModulesScreen:76` → `CourseMaterialViewer`（同 stack 安全）
2. `LoginLandingScreen:161` → `SSOLogin`（PreAuthStack 內安全）
3. `CompanionScreen:107` → `deepLinkForCareHint(...)`（動態 route 名稱，可能跨 tab 失敗）
**修法**：CompanionScreen 包 safeNavigate；其餘可保留。

### 🟠 Bug K：emit 的 hardcoded `'demo_teacher_chang'` 在真實學生帳號失準
**問題**：學生用真實 SSO 登入時，他的課老師 uid 不會是 `demo_teacher_chang`。emit 出去後沒有任何老師會收到。
**修法**：從 course.instructor 反查；或留 demo fallback、正式版查 Firestore

### 🟡 Bug L：`bak` / `bak2` 檔留在 repo
**位置**：`src/screens/*.tsx.bak` × 8、`*.tsx.bak2` × 8
**問題**：不會影響執行（.bak 不會被 import），但 git status 看起來髒
**修法**：要求用戶 `find apps/mobile/src/screens -name "*.bak*" -delete`

### 🟡 Bug M：30+ 重複 AI service 仍未收斂
**位置**：`apps/mobile/src/services/`
**狀態**：已有計畫文件（`docs/AI_SERVICE_CONSOLIDATION_PLAN.md`），未執行
**風險**：新進開發者搞混；不影響 demo

### 🟡 Bug N：StudentInbox / AttendanceLive 等 screen 沒做這輪「load + subscribe」改造
**位置**：StudentInboxScreen.tsx / AttendanceLiveScreen.tsx
**狀態**：StudentInbox 我前面確認有 loadRoleEventInbox ✓；AttendanceLive 還沒查
**修法建議**：審視所有 cockpit 之外的 screen，套同樣 pattern

### 🟡 Bug O：onUnhandledAction 不會 cross-tab 自動嘗試
**位置**：App.tsx
**問題**：如果某個 button 不透過 safeNavigate 而是直接 navigation.navigate 失敗 → onUnhandledAction 跳 alert 「無法開啟」。
**修法**：onUnhandledAction 內也用 routeRegistry 找 tab 自動 redirect

---

## 三、原則上不該 emit 但意外 emit 的（False positive）

無發現。所有 emit 都對應實際使用者動作。

---

## 四、demo 走過完整 7 分鐘腳本驗證表

| 秒 | 動作 | 應該觸發的 event | 受影響的 cockpit | 驗證狀態 |
|---|---|---|---|---|
| 0:30 | 老師 bulk reminder | `bulk_reminder_sent` | 學生 inbox / 老師 cockpit metric | ✅ |
| 1:30 | 老師 AI 起草評語 | `feedback_drafted` | 學生 inbox | ✅ |
| 2:00 | 切學生 | — | 上述兩 event 在 student inbox 看到 | ✅（fix 後保留 `__all__`） |
| 3:00 | 學生繳交作業 | `homework_submitted` | 老師 / TA cockpit | ✅ |
| 3:30 | 學生簽到 | `attendance_checked_in` | 老師 cockpit | ✅（本輪 fix） |
| 4:00 | 學生發討論 | `discussion_posted` | 老師 / TA cockpit | ✅ |
| 4:30 | 學生求助 | `help_requested` | TA cockpit + 線上學伴 | ✅（本輪 fix） |
| 5:00 | 切餐廳 | — | 看到上述全部 + 學生訂單 | ✅（本輪 fix） |
| 5:30 | 餐廳備餐推進 | `order_status_changed` | 學生 inbox / StudentOrders | ✅ |
| 6:00 | 切主任 | — | 看到全系所有 event | ✅（本輪 fix） |
| 6:30 | 主任發系所公告 | `department_broadcast` | 全系師生 inbox | ✅ |

---

## 五、給後續開發者的 5 條心法

1. **任何 cockpit screen 都要 `loadRoleEventInbox` + `subscribeRoleEvent` 配對**
   不能只 subscribe — subscribe 只接「未來」事件，切角色登入時看不到「過去」。
2. **任何 emit 都要把 targetUids 設對**
   `undefined` = broadcast 到 `__all__`（適合公告 / 訂單給特定店家）。明確 uid 陣列 = 點對點。
3. **任何 cross-tab navigation 走 `safeNavigate`**
   不要直接 `navigation.navigate`。registry 會自動 cross-tab。
4. **切角色不要清 `__all__` broadcast**
   `__all__` 是跨角色 demo 的公共渠道。
5. **新增功能 = 新增 emit + 新增 cockpit subscribe**
   沒有這對，跨角色聯動不會發生。

---

*產出於這輪審視。建議口委 demo 前再走一次 7 分鐘腳本，每段都確認對應 event 觸發。*
