# Campus Companion × APP 深度整合對照地圖

> 「精靈和花園不是分頁，是滲透到每一個畫面的回饋層」
> 對應檔案：`packages/shared/src/companion/*` + `packages/shared/src/lms/*`

## 一、整合原則

1. **每一個 APP 功能，都至少觸發一個信號**（DailyActivitySignal 的 28 個欄位）
2. **每一個 APP 功能里程碑，都對應一個成就解鎖**（22 個成就定義）
3. **每一個 APP 行為，都會影響精靈／花園／星圖**——不是分開 3 個系統，是同一個生態
4. **嚴肅功能優先**：報修、健康、學習風險 → 解鎖物比社交娛樂更顯著
5. **可一鍵關閉**：使用者覺得擾人 → 全部變回純功能 APP

---

## 二、深度整合對照表（28 個畫面 → 完整信號）

### 學習主幹（LMS）

| 畫面 / 行為 | 觸發事件 | 信號欄位 | 解鎖成就 | 精靈反應 | 花園影響 |
|------------|----------|---------|---------|---------|---------|
| AcademicScreen 進入 | `study_session_logged` | studyMinutes | — | needs.study + | 對應植物 +growth |
| CourseHubScreen 進入 | `study_session_logged` | studyMinutes | — | 同上 | 該課植物 +growth |
| CourseModulesScreen 讀教材 | `material_read` | materialsRead | (累積 → 開花) | needs.study + | 該植物階段推進 |
| AssignmentDetailScreen 繳交 | `assignment_submitted` | assignmentsSubmitted | 首次繳交 = 📝 初試啼聲 | needs.study + | 該植物 +growth 25% |
| QuizTakingScreen 完成 | `quiz_attempt_submitted` + 自動計分 | quizAttempts | 滿分 = 👑 滿分皇冠 | needs.study + | 該植物 +growth 20% |
| AttendanceLiveScreen 簽到 | `attendance_checkin` | attendanceCheckins | 一週全勤 = ✨ 全勤光環 | needs.study + | 該植物 +growth |
| ClassroomScreen 課中投票 | `study_session_logged` (5min/次) | studyMinutes | — | needs.study | 該植物 +growth |
| CourseGradebookScreen 採收 | `plant_harvested` | (lifetime) | 首次採收 = 🧺 採收提籃 | vitality + 5 | 該植物 → 已收成 |
| PeerReviewScreen 送出 | `peer_review_given` | peerReviewsGiven | 首次 = 🎗️ 同儕勳章 | needs.social + | 雙方植物互相 +5% |
| 課程討論串發文 | `discussion_post_created` | discussionPosts | useful 5 次 = 🔆 助人之燈 | needs.social + | — |
| AICourseAdvisor 對話 | `ai_tutor_turn` | aiTutorTurns | — | needs.study (微量) | — |

### 圖書館

| 行為 | 事件 | 信號 | 成就 |
|------|------|------|------|
| 借書 | `library_borrow` | libraryActions | 5 本 = 🐛 書蟲 |
| 續借 | `library_renew` | libraryActions | — |
| 預約座位 | `library_seat_reserved` | libraryActions | 20 次 = 🪑 專屬讀書角 |

### 餐廳

| 行為 | 事件 | 信號 | 成就 |
|------|------|------|------|
| 訂餐 | `meal_ordered`(vendorId, balanced) | mealsOrdered + distinctVendors | 10 家 = 🍴 美食家 |
| 均衡餐 | 同上 (balanced=true) | balancedMealDays | 30 天 = 🥗 綠色圍裙 |
| 揪團 | `group_order_joined` | groupOrderJoined | 3 次 = 🏮 揪團小燈 |
| 看菜單／人潮預測 | `cafeteria_viewed` | cafeteriaInteractions | — |
| 看月預算 | `budget_checked` | budgetChecks | — |

### 校園探索與交通

| 行為 | 事件 | 信號 | 成就 |
|------|------|------|------|
| 造訪 POI | `poi_visited`(poiId) | campusVisitsCount + distinctPoiVisited | 20 個 = 🌌 探索者星座 |
| AR 導航 | `ar_navigation_completed` | arNavigationCompleted | 5 次 = 🥽 AR 護目鏡 |
| 步數紀錄 | `steps_logged`(steps) | campusStepsEstimate | 週 3.5w = 🥾 健行靴 |
| 校車打卡 | `bus_checkin` | busCheckins | 10 次 = 🧣 通勤圍巾 |

### 校園服務

| 畫面 | 事件 | 信號 | 成就 |
|------|------|------|------|
| PrintServiceScreen | `print_job_created` | printJobs | — |
| HealthScreen 預約 | `health_appointment_created` | healthCenterVisits | 首次 = 💚 自我照顧 |
| DormitoryScreen 報修 | `dorm_repair_created` | dormRepairCreated | 首次 = 🧰 小工具箱 |
| LostFoundScreen | `lost_found_posted/claimed` | lostFoundActions | — |

### 活動與社群

| 行為 | 事件 | 信號 | 成就 |
|------|------|------|------|
| 活動報名 | `event_signup` | (lifetime) | — |
| 活動簽到 | `event_checkin` | eventAttendance | 5 場 = 📷 活動相機 |
| 群組發文 | `group_post_created` | socialInteractions | — |
| 鼓勵雲送出 | `encouragement_sent` | encouragementsSent | 10 次 = ☁️ 鼓勵守護者 |

### 系統互動

| 行為 | 事件 | 信號 | 影響 |
|------|------|------|------|
| 收件匣執行任務 | `inbox_action_taken` | inboxActionsTaken | 不直接解鎖，但加 lifeScore |
| 學分試算頁 | `credit_audit_viewed` | creditAuditChecks | 同上 |
| 學年推進（每年） | `study_year_advanced`(newYear) | studyYearReached | 大一完 = 🎓 大一紀念狀 |
| 大四種傳承樹 | `legacy_tree_planted` | legacyTreesPlanted | 種樹 = 🎒 傳承種子袋 |

---

## 三、跨系統交互（精靈 ↔ 花園 ↔ 星圖 ↔ 風險雷達）

### 1. LMS 直接餵花園
- 出席、繳交、測驗、教材 → `gardenEngine.computePlant()` 直接吃這四維
- 植物採收後 → 知識點 → 可餵精靈 / 換裝 / 種傳承樹

### 2. LMS 觸發精靈情緒
- 高出席 + 多繳交 → needs.study 高 → mood='focused' or 'energetic'
- 不活躍 + 漏交 → mood='lonely' + careHint 提醒

### 3. 風險雷達 → 精靈主動 careHint
- riskRadar 命中 'critical' → 精靈優先說「最近壓力大，可以找導師或諮商」
- 直接接到 `aiToolRegistry.risk_radar` → AI 對話主動帶出

### 4. 校園服務 → 星圖
- POI 造訪 / AR 導航 → 點亮對應星座
- 季節限定星座只在該季開放（春櫻、夏螢、秋楓、冬燈）

### 5. 同儕共生 ↔ 兩個系統
- 揪團讀書：雙方花園 +5%、雙方精靈 needs.social +
- 鼓勵雲：收方精靈 vitality +2、發方解鎖鼓勵守護者

---

## 四、TronClass 主幹 ↔ Companion 整合（這次新增）

| TronClass 模組 | Companion 整合方式 |
|---------------|------------------|
| 課程空間 | 每門課 = 花園裡一棵植物 |
| 教材單元 | 讀完 → growth；全部讀完 → 該植物開花 |
| 作業 | 繳交 → growth；批改 → 收回 feedback；採收 → 知識點 |
| 測驗（含 quizScoring） | 自動計分結果 → 寫 gradebookEntries + 寫 plant.harvestPoints |
| 題庫（questionBank） | 教師抽題建 quiz → 學生答 → 同上鏈路 |
| Rubric（rubricScoring） | 教師打分 → 寫 gradebookEntries → 對應作業植物進度 |
| 點名 | 簽到 → study signal + 全勤週成就 |
| 成績簿（gradebookCompute） | 全部成績寫入 → 學期末 termEnded=true → 植物可採收 |
| 討論（discussionEngine） | useful 標記 → 助人之燈成就；合作分高 → 精靈 caring mood |
| 學習風險雷達（riskRadar） | critical → 精靈主動 careHint + 雲端推播 |

---

## 五、本輪交付清單

### 純函式引擎（全部 packages/shared/src）
1. ✅ `companion/spriteEngine.ts` — 28 維信號 / 4 需求 / 進化 / 季節 / careHint
2. ✅ `companion/gardenEngine.ts` — 每課一植物 / 開花結果 / 採收 / 班級氣象
3. ✅ `companion/achievements.ts` — 22 個成就解鎖定義 + evaluateAchievements
4. ✅ `companion/signalAggregator.ts` — 從原始 events 聚合 dailyActivity + lifetime counters
5. ✅ `lms/quizScoring.ts` — 5 題型自動計分
6. ✅ `lms/gradebookCompute.ts` — 加權成績計算
7. ✅ `lms/rubricScoring.ts` — Rubric 評分（本輪新增）
8. ✅ `lms/riskRadar.ts` — 學習風險雷達（本輪新增）
9. ✅ `lms/discussionEngine.ts` — 討論串熱度與合作分（本輪新增）
10. ✅ `lms/questionBank.ts` — 題庫抽題（本輪新增）

### 測試（packages/shared 共用引擎）
- 197 條測試全綠：backend 122 + mobile 75

### Backend Cloud Functions
- ✅ `submitQuizAttempt.js`、`computeGradebook.js`、`computeCompanionState.js`

### AI Tool Registry（mobile）
- 12 個 LMS / Companion 新工具：query_modules / query_quizzes / submit_quiz / list_gradebook / post_discussion / build_study_plan / risk_radar / query_companion / pet_companion / harvest_plant / send_encouragement / explore_constellation

### Web 教師工作台
- modules / quizzes / attendance / gradebook 4 子頁

### 設計文件
- `TRONCLASS_PARITY_INTEGRATION_MAP.md`、`TRONCLASS_PARITY_ROADMAP.md`、`CAMPUS_COMPANION_DESIGN.md`、`CAMPUS_COMPANION_INTEGRATION_MAP.md`（本檔）

---

## 六、剩下要做的事（Phase 1 後續）

依優先級：

1. **Mobile screens**：CompanionScreen 主畫面、GardenScreen、ConstellationScreen
2. **Cloud Function cron**：每晚把今日 events → companionSignals + 觸發 achievements
3. **Inbox 可執行動作**：把每張卡 + action button
4. **教師端建立 Rubric UI**：對應 rubricScoring 引擎
5. **題庫管理 UI**：對應 questionBank 引擎
6. **學習風險雷達畫面**：對應 riskRadar 引擎，整合到 LearningAnalyticsScreen 主導航

剩下這些是 UI / wiring 工作，引擎與資料模型都已完成。

---

## 七、口試一句話總結

> 「我把精靈、花園、星圖三個 gamification 系統的成長養分，直接綁定到 APP 28 個畫面 / 行為信號和 22 個成就解鎖。每用 APP 一個功能都會看見回饋，但沒有 streak 懲罰、沒有 leaderboard、沒有課金，連學習風險警示也會由精靈用『關心』的方式說出來。」
