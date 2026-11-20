# 5 角色 × 14 事件 完整資料流（2026-05-16）

> 這份文件回答「某角色做某動作後，誰會看到什麼變化」。
> 是 demo 的腳本基礎也是正式版的事件契約。
>
> 圖例：✅ 已實作 / ⚠️ 部分實作 / ❌ 缺漏

---

## 一、14 個 RoleEvent 完整對照表

| Event Kind | 觸發者 | 立刻影響 | UI 反應位置 | 狀態 |
|------------|--------|----------|-------------|------|
| `grade_published` | 老師 | 學生 inbox + 該課程成績重算 + GradeWhatIf 更新 | StudentInbox / CourseScores / TodayCockpit「來自老師」 | ✅ |
| `bulk_reminder_sent` | 老師 | 多位學生 inbox 進件 + 老師 cockpit 紀錄 | StudentInbox / TeacherCockpit | ✅ |
| `feedback_drafted` | 老師 | 學生看到評語 inbox + 學生 trust 改變 | StudentInbox / GradeWhatIf | ✅ |
| `attendance_session_opened` | 老師 | 全班學生 critical 通知 + AttendanceMultiMethod 倒數 | TodayCockpit / push | ✅ |
| `announcement_posted` | 老師 / 系所 | 全班學生 inbox | AnnouncementsScreen / StudentInbox | ✅ |
| `homework_published` | 老師 | 全班學生待辦 +1 + AI 重算優先排序 | TodayCockpit「下一個任務」/ CoursesHome | ✅ |
| `peer_review_assigned` | 老師 | 學生互評任務 inbox | StudentInbox / PeerReviewSubmit | ✅ |
| `homework_submitted` | 學生 | 老師待批改 +1 + TA dashboard +1 + AI 預先預測 | TeacherCockpit metric chip / TADashboard | ✅ |
| `attendance_checked_in` | 學生 | 老師簽到面板更新 + 出席率動態變化 | AttendanceLive / TeacherCockpit | ✅ |
| `discussion_posted` | 學生 | 老師待回覆 +1 + TA dashboard +1 | TADashboard / TeacherCockpit | ✅ |
| `help_requested` | 學生 | 助教 inbox + AI 學伴配對推薦 | TADashboard | ✅ |
| `order_placed` | 學生 | 餐廳訂單佇列 +1 + AI 即時預測重算 | VendorDashboard / vendorPredictor | ✅ |
| `order_status_changed` | 餐廳 | 學生「餐已備好」通知 + StudentOrders 更新 | StudentOrders / TodayCockpit | ⚠️ StudentOrders 需驗證 listener |
| `department_broadcast` | 主任 | 全系學生 + 老師 inbox + 老師 cockpit 顯示 | StudentInbox / TeacherCockpit / TADashboard | ✅ |

---

## 二、5 角色「動作 → 期待結果」全表

### 2.1 學生（顧晉瑋）

| 動作 | UI 觸點 | 事件 | 受影響角色 | 受影響 UI |
|------|---------|------|-----------|-----------|
| 繳交作業 | HomeworkSubmit | `homework_submitted` | 老師、TA | 待批改 +1 |
| 簽到 | AttendanceMultiMethod | `attendance_checked_in` | 老師 | AttendanceLive 名單 +1 |
| 發討論 | CourseDiscussion | `discussion_posted` | 老師、TA | 待回覆 +1 |
| 求助 | AIStudyBuddy 即時求助 | `help_requested` | TA + 線上學伴 | 學伴 inbox |
| 訂餐 | Cafeteria → Ordering | `order_placed` | 餐廳 | VendorDashboard 訂單佇列 +1 |
| 採納 AI 建議 | AIAgentObservatory | （學習引擎內部） | 自己 | preference profile 更新、trust card 計數 |
| 完成番茄 | PomodoroSession | （學習引擎內部） | 自己 | 焦點 CTA 推進、achievements 計數 |
| 加錯題 | TeacherGrading / 自加 | （錯題本內部） | 自己 | MistakeRepertoire 增列、複習提醒 |
| 試算成績 | GradeWhatIf | （無 emit） | 自己 | 即時看到調整後 GPA |
| 觀察 AI 思考 | AIAgentObservatory | 採納/拒絕回流 | 自己 | trust card 計分 |
| 看本月回顧 | MonthlySummary | （唯讀聚合） | 自己 | 自我反思 |
| 看訂單 | StudentOrders | （唯讀） | 自己 | 訂單歷史 |
| 配對學伴 | AIStudyBuddy | 邀請事件（demo Alert） | 學伴 | 學伴 inbox（規劃中） |

### 2.2 老師（張怡君）

| 動作 | UI 觸點 | 事件 | 受影響角色 | 受影響 UI |
|------|---------|------|-----------|-----------|
| 批改作業 | TeacherGrading | `grade_published` | 該學生 | 成績更新、inbox |
| 起草評語 | TeacherCockpit AI 起草 | `feedback_drafted` | 該學生 | 看到評語 |
| 批量提醒 | TeacherCockpit bulk reminder | `bulk_reminder_sent` | 缺繳學生群 | inbox |
| 開點名 | AttendanceLive | `attendance_session_opened` | 全班 | critical 通知 |
| 發布作業 | TeachingHub | `homework_published` | 全班 | 待辦 +1 |
| 公告 | Announcements compose | `announcement_posted` | 全班 | inbox |
| 指派互評 | PeerReview admin | `peer_review_assigned` | 涉及學生 | 任務 inbox |
| 看紅旗學生 | TeacherCockpit | （唯讀） | 自己 | 風險清單 |
| 看評語風格 | TeacherCockpit | （唯讀，從 history） | 自己 | 過去評語摘要 |

### 2.3 助教（林助教）

| 動作 | UI 觸點 | 事件 | 受影響角色 | 受影響 UI |
|------|---------|------|-----------|-----------|
| 批改老師指派的作業 | TADashboard 進 TeacherGrading | `grade_published`（代老師） | 該學生 | 同上 |
| 回覆學生提問 | TADashboard 進 CourseDiscussion | `discussion_posted`（reply） | 該學生 | 看到回覆 |
| 聯絡學生 | TADashboard 需聯繫卡 | `bulk_reminder_sent`（小範圍） | 該學生 | inbox |
| 設定本學期職責 ❌ | TADashboardSettings ❌ | （無 emit，本地設定） | 自己 | TADashboard chip 隱顯 |

### 2.4 主任（黃主任）

| 動作 | UI 觸點 | 事件 | 受影響角色 | 受影響 UI |
|------|---------|------|-----------|-----------|
| 看系所健康度 | DepartmentDashboard | （唯讀聚合） | 自己 | AI score |
| 發系所公告 | DepartmentDashboard 公告 | `department_broadcast` | 全系師生 | inbox |
| 看風險課程 | DepartmentDashboard | （唯讀） | 自己 | 紅旗 list |
| 看老師工作負載 | DepartmentDashboard | （唯讀） | 自己 | 老師清單 |
| 看學生 risk ❌ | StudentRisk ❌ | （唯讀） | 自己 | 學生風險清單 |
| 教學評鑑 ❌ | TeachingEvaluation ❌ | （唯讀） | 自己 | 課程評鑑 |

### 2.5 餐廳（阿英）

| 動作 | UI 觸點 | 事件 | 受影響角色 | 受影響 UI |
|------|---------|------|-----------|-----------|
| 接訂單 → 製作中 | VendorDashboard | `order_status_changed` | 該學生 | 通知「製作中」 |
| 待取 | VendorDashboard | `order_status_changed` | 該學生 | 通知「餐已備好」 |
| 已交付 | VendorDashboard | `order_status_changed` | 該學生 | 訂單關閉 |
| 看 AI 預測 | VendorDashboard | （唯讀，vendorPredictor） | 自己 | 預測 hero |
| 管理菜單 | MerchantHub | （內部） | 自己 | 更新菜單 |
| Loyalty 推播 ❌ | VendorLoyaltyPush ❌ | `announcement_posted`（限定 audience） | 回頭客 | inbox |
| 月度報表 ❌ | VendorRevenueReport ❌ | （唯讀） | 自己 | 收入 chart |
| 員工管理 | AdminCafeteria | （內部） | 自己 | 員工清單 |

---

## 三、缺漏清單（要補實作）

### 缺的 screen

1. ❌ **StudentRiskScreen**（主任）— 風險學生清單 + 詳情 + 聯絡功能
2. ❌ **TeachingEvaluationScreen**（主任）— 課程評鑑卡 + 趨勢
3. ❌ **VendorRevenueReportScreen**（餐廳）— 收入圖表 + 熱銷單 + 預測對照
4. ❌ **VendorLoyaltyPushScreen**（餐廳）— 回頭客名單 + 推播
5. ⚠️ **TADashboardSettings**（TA）— 職責勾選（小，可整合進 TADashboard）

### 缺的 RoleEvent

無新增事件需求 — 既有 14 個已能覆蓋。新功能用 `announcement_posted`（小範圍）+ `bulk_reminder_sent`（限定 audience）即可。

### 缺的 listener（subscribe 缺漏）

| Cockpit | 應該聽 | 目前是否聽 |
|---------|--------|-----------|
| TodayCockpit（學生） | grade_published / bulk_reminder_sent / feedback_drafted / attendance_session_opened / announcement_posted / homework_published / peer_review_assigned / order_status_changed / department_broadcast | 部分（subscribeAllRoleEvents 一次接全部） |
| TeacherCockpit | homework_submitted / attendance_checked_in / discussion_posted / department_broadcast | 待驗證 |
| TADashboard | homework_submitted / discussion_posted / help_requested / department_broadcast | 待驗證 |
| DepartmentDashboard | （唯讀，無需 subscribe） | — |
| VendorDashboard | order_placed | 待驗證 |
| StudentOrders | order_status_changed | 待驗證（這個 screen 才能即時更新） |

---

## 四、Demo 7 分鐘腳本的事件鏈條圖

```
T+00:30  老師 cockpit
         ├─ bulk_reminder_sent → 學生 inbox (3 人)
         └─ feedback_drafted → 顧晉瑋 inbox

T+02:00  切學生 → TodayCockpit
         └─ subscribeAllRoleEvents 接到上述 2 件 → 顯示「來自老師」

T+03:00  學生繳交
         └─ homework_submitted → 老師 + TA cockpit metric chip +1

T+04:30  切餐廳 → VendorDashboard
         └─ 訂單推進 (3 個) → order_status_changed × 3 → 學生 StudentOrders 同步

T+05:00  學生收到「餐已備好」(此時學生不是 active screen，事件留 inbox)

T+06:00  切主任 → DepartmentDashboard
         └─ department_broadcast → 全系 inbox

T+06:30  切回任一角色 → 看到主任公告進 inbox
```

---

## 五、實作優先順序（給後續）

1. **本輪做**：補 4 個缺漏 screen 並 wire VendorDashboard / DepartmentDashboard
2. **下輪做**：驗證所有 cockpit 的 subscribe（補 console.log 觀察）
3. **正式版**：把 RoleEventBus 從 AsyncStorage 改成 Firestore real-time
4. **正式版**：「即時求助」實作 Firebase Cloud Messaging push

---

*事件契約穩定後，新增功能只需 emit 對應 event，不需碰其他角色的 UI 程式碼。*
