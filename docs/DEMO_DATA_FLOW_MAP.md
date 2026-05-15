# Demo 資料流地圖 — 每個動作 → 哪些 event → 哪些 UI 更新 → AI 重算什麼

> 2026-05-15 · 給口試 demo 用：證明每個角色的動作都有真實 cross-role 連帶反應
> 五個角色：student（顧晉瑋）/ teacher（張怡君）/ ta（林助教）/ admin（黃主任）/ vendor（阿英）

## 一、Event Bus 13 種事件總表

| Event kind | Emit 來源 screen | 經由 | 目標 UI 即時更新（subscribeRoleEvent） |
|------------|-----------------|------|------------------------------------|
| `homework_submitted` | HomeworkSubmitScreen.doSubmit | simulateStudentSubmit | TeacherCockpit、TADashboard、DepartmentDashboard |
| `grade_published` | TeacherGradingScreen.handleSaveAndNext | simulateTeacherGrade | TodayCockpit、StudentInbox、DepartmentDashboard |
| `feedback_drafted` | TeacherGradingScreen + TeacherCockpit AI draft | emitFeedbackDrafted | TodayCockpit、StudentInbox |
| `bulk_reminder_sent` | TeacherCockpit bulk action | emitBulkReminder | TodayCockpit、StudentInbox |
| `attendance_session_opened` | AttendanceScreen.handleCreateSession | simulateTeacherOpenAttendance | TodayCockpit（critical）、StudentInbox |
| `attendance_checked_in` | AttendanceLiveScreen.handleCheckIn | simulateStudentCheckIn | TeacherCockpit、TADashboard、DepartmentDashboard |
| `order_placed` | TodayCockpit「下訂 demo」 | simulateStudentOrderFood | VendorDashboard 訂單佇列 |
| `order_status_changed` | VendorDashboard advanceStatus | simulateVendorAdvanceOrder | TodayCockpit、StudentInbox |
| `department_broadcast` | DepartmentDashboard「一鍵廣播」 | simulateDepartmentBroadcast | 所有角色 inbox |
| `discussion_posted` | CourseDiscussion.handlePost | emitDiscussionPosted | TADashboard |
| `help_requested` | （未來）學生 AI 學伴求助 | emitHelpRequested | TADashboard |
| `announcement_posted` | 老師發課程公告 | emitAnnouncement | TodayCockpit、StudentInbox |
| `peer_review_assigned` | PeerReviewSubmitScreen | emitPeerReviewAssigned | TodayCockpit、StudentInbox |

## 二、五大角色動作 → 下游影響地圖

### 👨‍🎓 學生 顧晉瑋 (demo_student_kuchih)

```
動作 1: 繳交作業 HW3
  HomeworkSubmitScreen.doSubmit
  → emit homework_submitted (course=資料庫, hw=HW3)
  → 即時通知 demo_teacher_chang
  → TeacherCockpit「🔴 即時繳交」section 多一筆
  → TADashboard「🔴 即時批改」section 多一筆
  → DepartmentDashboard「🔴 全系動態」+1
  → AI 重算：
    - teacher cockpit 的「待批改」+1
    - AI 思考鏈：teacher 該優先批改誰
    - student companion XP +5

動作 2: 簽到（從點名 QR）
  AttendanceLiveScreen.handleCheckIn
  → emit attendance_checked_in
  → 即時通知 demo_teacher_chang
  → TeacherCockpit 簽到面板學生狀態 → present
  → student companion XP +3
  → student gradePredictor: 出席率 +1

動作 3: 一鍵訂餐
  TodayCockpit 推薦 → Alert.alert 確認 → simulateStudentOrderFood
  → emit order_placed (merchant=中餐部 / 咖啡屋 / ...)
  → VendorDashboard 訂單佇列即時 +1 + 自動展開 pending section
  → student inbox 之後會收到 order_status_changed
```

### 👨‍🏫 老師 張怡君 (demo_teacher_chang)

```
動作 1: 開點名
  AttendanceScreen.handleCreateSession
  → emit attendance_session_opened (critical severity)
  → 該課所有學生 inbox 收到 critical push
  → TodayCockpit「📥 來自老師」section 出現「✅ 老師開點名中」
  → DepartmentDashboard「🔴 全系動態」+1

動作 2: 批改作業
  TeacherGradingScreen.handleSaveAndNext
  → emit grade_published + emit feedback_drafted
  → 該學生 inbox 收到「📊 新成績」+「✏️ 評語」
  → TodayCockpit「各課預估」即時刷新（gradePredictor 重算）
  → StudentInbox 顯示新 row
  → DepartmentDashboard「🔴 全系動態」+1 +1

動作 3: 一鍵示範跨角色 (TeacherCockpit accent button)
  → simulateFullGradingCycle
  → 連發 emit homework_submitted → emit grade_published → emit feedback_drafted
  → demo 4 個目標角色 cockpit 同步顯示變化

動作 4: Bulk reminder（漏交學生群發）
  TeacherCockpit bulk action
  → emit bulk_reminder_sent × N（每位漏交學生一封）
  → 學生 inbox 收到「⏰ 老師催繳」
  → 每位學生 AI 重算 study plan，新增該作業 priority
```

### 🧑‍💼 助教 林助教 (demo_ta_lin)

```
動作 1: 協助批改
  TeacherGradingScreen.handleSaveAndNext（TA 也可用）
  → 同老師批改鏈
  
即時看：
  - 訂閱 homework_submitted → 學生繳交立刻出現「🔴 即時批改」
  - 訂閱 help_requested → 學生求助立刻出現「🆘 學生求助」
  - aiTANextAction 給今日 headline + suggestion
```

### 🏛 系所主任 黃主任 (demo_admin_huang)

```
動作 1: 一鍵廣播
  DepartmentDashboard「📣 一鍵廣播 demo」
  → simulateDepartmentBroadcast (audience=all)
  → 廣播到 __all__ inbox
  → 所有 demo 角色（學生/老師/助教/餐廳）inbox 都收到「🏛 系所公告」

即時監看（不主動 emit）：
  - 訂閱 ALL events（除 vendor/自己回波）
  - DepartmentDashboard「🔴 全系即時動態」section 滾動最新 20 筆
  - 看得到老師 / 學生 / TA 在 APP 內所有動作
  - aiDepartmentHealthScore 即時重算
```

### 🍱 餐廳員工 阿英 (demo_cafeteria)

```
動作 1: advance 訂單
  VendorDashboard.advanceStatus（按 "開始備餐" / "完成 → 待取" / "已交付"）
  → emit order_status_changed
  → 學生 inbox 收到對應訊息（製作中 / 已備好 / 已完成）
  → TodayCockpit 顯示 push

動作 2: 切換店家
  Merchant switcher（中餐部 manager / 咖啡屋 staff / 麵食館 manager）
  → 訂單佇列、熱門品、菜單、工具列權限 全部依角色 + 該店切換
  
即時看：
  - 訂閱 order_placed (filter by merchantId)
  - 學生在 TodayCockpit 下訂 → vendor 訂單佇列立刻 +1
  - 自動展開 pending section
```

## 三、AI 思考 / 學習 / 行動 流程

```
┌─────────────────────────────────────────────────────────┐
│ 1. proactive 後台 scan (每 5 分鐘自動 + 手動)             │
│    useProactiveAIAgentLoop → runProactiveScan             │
│    依角色跑 scanForStudent / Teacher / TA / Department /   │
│    Vendor，產出 suggestions                                │
└────────────────────┬────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 2. AI 思考鏈（AIAgentObservatory「立即跑」按鈕）           │
│    buildDemoSignals() ← demo data                         │
│    → observeStudentState (signal 抽 pattern)              │
│    → inferConcerns (pattern → 可能問題)                   │
│    → detectTradeoffs (衝突目標)                           │
│    → rankActions (候選動作評分)                            │
│    → explainChain (組成可解釋鏈)                          │
└────────────────────┬────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 3. 使用者「✓ 採納」/ 「🙅 不要」                           │
│    recordInteraction (kind, hour, dayOfWeek, reaction)    │
│    + executeSuggestion 真的 navigate / 跳對應 screen       │
└────────────────────┬────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 4. AI 學習                                                │
│    computePreferenceProfile (kind × hour bucket 統計)     │
│    discoverPatterns (preferred_time / rejected_kind /     │
│                      frequent_snooze / high_completion)    │
└────────────────────┬────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 5. AI 自我反思 + 突破                                     │
│    selfReflect → selfAdjustment 文字                     │
│    下次 scan 套用 ruleChange                              │
└────────────────────┬────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 6. Guardrails (aiSkillApplicator)                        │
│    7 道安全閥：daily cap / min confidence /                │
│                high impact confirm / dedupe /              │
│                quiet hours / rejection threshold /         │
│                global kill switch                          │
│    決定 auto_push / ask_user / block                      │
└─────────────────────────────────────────────────────────┘
```

## 四、Demo 演示腳本（5 分鐘）

```
0:00 登入 demo 老師張怡君
  → TeacherCockpit 看到種子的「3 天前學生繳交」+ 「2 小時前簽到」
  → 按「🎬 一鍵示範」accent 按鈕 → simulateFullGradingCycle 跑完
  → 看 console / Alert 顯示 4 步驟完成

0:50 切到 demo 學生顧晉瑋（左下登出 → 選學生）
  → TodayCockpit 看到剛剛老師批改的成績（92/100）+ 評語
  → 點 📥 收件匣 → 看到「新成績」「老師評語」
  → 點 🤖 AI 觀察台 → 看到 AI 思考鏈 + 採納/不要按鈕

1:50 切到 demo 餐廳阿英
  → VendorDashboard 看到 8 家店切換 chip
  → 點「中餐部」→ 看到訂單佇列、熱門品
  → 切回學生 → TodayCockpit 推薦下一餐 → 一鍵下訂 → 切回阿英 → 訂單即時 +1

2:50 切到 demo 主任黃主任
  → DepartmentDashboard 看到「🔴 全系即時動態」滾動的事件
  → 點「📣 一鍵廣播 demo」→ 發系所通知
  → 切回學生 inbox 看到「🏛 系所公告」

3:50 切到 demo 助教林助教
  → TADashboard 看到「🔴 即時批改」列表（剛從學生繳交累積）
  → 看到 AI headline 給今日 suggestion

4:30 回到 AI 觀察台
  → 按「✓ 採納」幾個建議 → AI 記錄反應
  → 查看「📊 學習軌跡」看到 acceptRate、time bucket
  → 累積 10+ 後切到「🔁 自我反思」看 AI 自己給的 adjustment

5:00 結束
  → 一句總結：「TronClass 只能讓你看資料，我們的 AI 主動思考、學習、突破自己。」
```

## 五、檢查清單（每次 demo 前確認）

- [ ] 5 個 demo 帳號都能登入
- [ ] 切角色清空舊 inbox + 種新 seed
- [ ] TeacherCockpit「一鍵示範」按下 → 跑出 4 個步驟
- [ ] VendorDashboard 8 家店切換可用
- [ ] DepartmentDashboard「全系即時動態」section 出現
- [ ] StudentInbox filter chip 4 個都對
- [ ] AI 觀察台「採納」會跳對應 screen
- [ ] Pomodoro 開始 25 分鐘倒數
- [ ] GradeWhatIf 改分數會即時 AI 評論
