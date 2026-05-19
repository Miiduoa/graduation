# 8 角色 × 全功能 對應矩陣

> **2026-05-17** — 統一定義每個角色在每個功能上能做什麼、看到什麼、觸發什麼事件。
> 這是所有 demo 修復的單一真實來源（single source of truth）。

## 角色定義（8 種）

| 角色 | demo uid | 代表人物 | 主軸動詞 |
|------|---------|---------|---------|
| **student** | demo-student-1 | 王小明 | 學、繳、問、約 |
| **teacher** | demo-teacher-1 | 王大明老師 | 出題、批改、發布、追蹤 |
| **ta** | demo-ta-1 | 林助教 | 批改、答疑、整理 |
| **club_officer** | demo-club-1 | 陳社長 | 招募、活動、審核成員 |
| **department_head** | demo-dept-1 | 黃主任 | 審核、廣播、看系所 KPI |
| **admin** | demo-admin-1 | 系統管理員 | 帳號、安全、系統設定 |
| **alumni** | demo-alumni-1 | 張學長 | 回憶、申請文件、看活動 |
| **guest** | (匿名) | — | 看公開資訊 |

## 跨應用對齊

- **Web** 8 角色完整覆蓋。
- **Mobile** 額外角色：vendor（餐廳店家）、parent（家長，未完整實作）。
  Mobile 的 vendor 對應到 Web 沒有的角色，demo 時走 mobile 端展示。
  parent 暫不列入主 demo。

## 功能 × 角色 對應表

符號：✅ 可操作 | 👁️ 唯讀（看得到但不能改） | 🔒 隱藏 / 軟擋

| 功能 | student | teacher | ta | club_officer | dept_head | admin | alumni | guest |
|------|---------|---------|----|--------------|-----------|-------|--------|-------|
| **/ 首頁** | ✅ 個人卡片 | ✅ 教師看板 | ✅ TA 看板 | ✅ 社團看板 | ✅ 系所看板 | ✅ 管理看板 | ✅ 校友看板 | ✅ 公開看板 |
| **/timetable** | ✅ 個人課表 | ✅ 授課課表 | 👁️ TA 提示 | 👁️ 無課表 | 👁️ 系所總覽 | 👁️ 不適用 | 🔒 | 🔒 |
| **/course/[id]** | ✅ 繳交+點名+提問 | ➡️ redirect 教師頁 | ➡️ redirect | 👁️ 唯讀 | ➡️ redirect | ➡️ redirect | 👁️ 唯讀（橫幅） | 👁️ 唯讀 |
| **/teacher/course/[id]** | 🔒 | ✅ 完整功能 | ✅ TA 紫色橫幅 | 🔒 | ✅ 主任視角 | ✅ admin 完整 | 🔒 | 🔒 |
| **新增作業** | 🔒 | ✅ 真寫入 demoStore | 🔒 教師專用 | 🔒 | ✅ | ✅ | 🔒 | 🔒 |
| **批改作業** | 🔒 | ✅ | ✅ | 🔒 | ✅ | ✅ | 🔒 | 🔒 |
| **發布成績** | 🔒 | ✅ 對全班生效 | 🔒 TA 唯讀 | 🔒 | ✅ | ✅ | 🔒 | 🔒 |
| **開啟 QR 點名** | 🔒 | ✅ | 🔒 | 🔒 | ✅ | ✅ | 🔒 | 🔒 |
| **編輯教材模組** | 🔒 | ✅ 開模組 modal | 👁️ 唯讀 | 🔒 | ✅ | ✅ | 🔒 | 🔒 |
| **編輯題庫** | 🔒 | ✅ | 🔒 | 🔒 | ✅ | ✅ | 🔒 | 🔒 |
| **編輯 Rubric** | 🔒 | ✅ | 🔒 | 🔒 | ✅ | ✅ | 🔒 | 🔒 |
| **/grades** | ✅ 個人 + 趨勢 | ✅ 班級分布 | ✅ 班級分布 | 👁️ 無個人 | ✅ 全系統計 | 👁️ 不適用 | ✅ 唯讀歷史 | 🔒 |
| **/announcements 看公告** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 過濾 | ✅ 過濾 |
| **/announcements 發布** | 🔒 | ✅ → 待審 | 🔒 | ✅ 社團公告 → 待審 | ✅ 系所公告 | ✅ | 🔒 | 🔒 |
| **/announcements 審核** | 🔒 | 🔒 | 🔒 | 🔒 | ✅ | ✅ | 🔒 | 🔒 |
| **/clubs 加入** | ✅ → demoStore | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 校友禁 | 🔒 |
| **/clubs 審核成員** | 🔒 | 🔒 | 🔒 | ✅ → demoStore | 👁️ 統計 | ✅ | 🔒 | 🔒 |
| **/clubs 發布社團公告** | 🔒 | 🔒 | 🔒 | ✅ → 待審 | 👁️ | ✅ | 🔒 | 🔒 |
| **/library 借閱** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔒 校友禁 | 🔒 |
| **/library 續借** | ✅ → demoStore | ✅ | ✅ | ✅ | ✅ | ✅ | 🔒 | 🔒 |
| **/library 預約** | ✅ → demoStore | ✅ | ✅ | ✅ | ✅ | ✅ | 🔒 | 🔒 |
| **/library 轉讓** | ✅ → demoStore | ✅ | ✅ | ✅ | ✅ | ✅ | 🔒 | 🔒 |
| **/messages 收件匣** | ✅ 動態+靜態 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔒 登入提示 |
| **/messages 回覆** | ✅ → demoStore | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 限通知 | 🔒 |
| **/ai-assistant 對話** | ✅ 個人化 | ✅ 課程化 | ✅ 批改助理 | ✅ 招募助理 | ✅ 行政助理 | ✅ 安全助理 | ✅ 校友助理 | ✅ 公開資訊 |
| **/ai-assistant 一鍵動作** | ✅ 繳交/續借/求助/訂餐/請假 | ✅ 推送提醒/起草評語/發布作業 | ✅ 起草評語/答疑 | ✅ 起草招募/通過成員 | ✅ 發系所廣播/核准公告 | ✅ 停用帳號/查日誌 | 👁️ 開啟申請表 | 🔒 |
| **/admin 主控台** | 🔒 | 🔒 | 🔒 | 🔒 | ✅ 系所視角 | ✅ 完整 | 🔒 | 🔒 |
| **admin 使用者管理** | 🔒 | 🔒 | 🔒 | 🔒 | 👁️ 看教師 | ✅ 啟用/停用/改角色 | 🔒 | 🔒 |
| **admin 系統設定** | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | ✅ 開 modal | 🔒 | 🔒 |
| **/credit-planner** | ✅ 個人試算 | 👁️ | 👁️ | 👁️ | ✅ 行政視角 | 👁️ | 👁️ 校友 | 👁️ |
| **/profile** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ➡️ 登入提示 |
| **/settings 一般+外觀** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **/settings 系統** | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | ✅ 開 modal | 🔒 | 🔒 |
| **/settings 系所** | 🔒 | 🔒 | 🔒 | 🔒 | ✅ 開 modal | 👁️ | 🔒 | 🔒 |
| **/bus / /cafeteria / /map** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **訂餐（mobile）** | ✅ → demoStore | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔒 |
| **請假流程** | ✅ → demoStore | ✅ 核准 | 👁️ | 🔒 | ✅ | ✅ | 🔒 | 🔒 |
| **宿舍報修（mobile）** | ✅ → demoStore | 🔒 | 🔒 | 🔒 | 🔒 | ✅ 處理 | 🔒 | 🔒 |
| **同儕互評** | ✅ 評他人/被評 | ✅ 指派 | ✅ 看狀態 | 🔒 | ✅ | ✅ | 🔒 | 🔒 |

## 跨角色資料流 (Action Chains)

完整列表參考 [DEMO_NARRATIVE.md](./DEMO_NARRATIVE.md)。共 15 條動作鏈：

1. **作業流**：teacher 新增 → student 收通知 → student 繳交 → teacher/ta 收通知
2. **公告審核**：teacher/club_officer 提交 → dept_head/admin 審核 → 學生收公告 + 提交者收回應
3. **成績發布**：teacher 發布（多學生） → 全部受影響學生收通知 + AI 摘要更新
4. **點名**：teacher 開 QR → student 收即時橫幅 → student 簽到 → teacher 看出席 → teacher 結束 → 缺席者收訊息
5. **社團入社**：student 申請 → club_officer 收申請 → club_officer 核准 → student 收歡迎
6. **圖書館續借/預約/轉讓**：student 動作 → store override → AI 即時知道
7. **求助 → TA 答疑**：student 在 AI 助理求助 → ta 收 help_requested → ta 回覆 → student 收回答
8. **訂餐**（mobile）：student 下單 → vendor 收訂單 → vendor 推進狀態 → student 收狀態變更
9. **請假**：student 提交請假 → teacher 收請假申請 → teacher 核准/退回 → student 收結果
10. **討論串**：student 發討論 → 同學/teacher/ta 收通知 → 互動回覆
11. **同儕互評**：teacher 指派 → 學生 A 評學生 B → 學生 B 收評語 → teacher 看統計
12. **教師起草評語**（AI）：teacher 用 AI 起草 → student 收評語 → student 可追問 AI
13. **系所廣播**：dept_head 發廣播 → 全系師生收
14. **批量提醒**：teacher 對未交作業的學生發提醒 → 學生收提醒
15. **宿舍維修**：student 報修 → admin 收 → admin 派工 → student 收結案

## 未實作但 demo 不展示的角色行為

- alumni 申請成績單表格（demo 中只 toast 提示「已開啟申請表」）
- guest 註冊流程（demo 不示範註冊）
- parent（mobile）家長帳號（暫不列入）
