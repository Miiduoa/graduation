# TronClass → APP 全功能 ↔ 7 角色 資料流

> 一張圖看「TronClass 拉到的原始資料 → 變成我們的標準型 → 7 角色各自看到/做什麼 → companion/AI 怎麼反應」
> 對應檔案：`packages/shared/src/lms/tronclassAdapter.ts` + `packages/shared/src/lms/actionGraph.ts`

## 一、總體資料流

```
┌─────────────────────┐
│  TronClass 官方 API │（學校現有系統，視為單一可信資料源）
└──────────┬──────────┘
           │ scheduled pull / on-demand webhook
           ▼
┌─────────────────────────────────────────────────────────┐
│  packages/shared/src/lms/tronclassAdapter.ts            │
│  ── 純函式 normalize ──                                  │
│  TronClassRawCourse  → CourseSpace                      │
│  TronClassRawModule  → CourseModule                     │
│  TronClassRawMaterial → CourseMaterial                  │
│  TronClassRawQuiz    → Quiz                             │
│  TronClassRawAttendanceSession → AttendanceSession      │
│  TronClassRawAttendanceRecord  → AttendanceRecord       │
│  TronClassRawGradeItem + Entry → CourseGradebookData    │
│  buildImportResult()  → 一次匯入 + sourceMeta           │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  Firestore（我們的標準型）                               │
│  schools/{id}/courseSpaces/{id}/{modules,quizzes,...}   │
│  users/{uid}/{enrollments,companionSignals,...}         │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  我們新加的引擎（純函式，packages/shared/src）           │
│  ─ quizScoring  ─ gradebookCompute  ─ rubricScoring     │
│  ─ riskRadar    ─ discussionEngine  ─ questionBank      │
│  ─ spriteEngine ─ gardenEngine      ─ achievements      │
│  ─ signalAggregator                                     │
│  ─ actionGraph (本輪新增) ─ tronclassAdapter (本輪新增) │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌────────────────┬────────────────┬───────────────────────┐
│ Mobile (RN)    │ Web (Next)     │ AI 代理 (Cloud Fn)    │
│  CourseHub     │  Teacher 工具區│  24 個 callable        │
│  CompanionScn  │  Modules       │  + Risk Radar 主動推 │
│  GardenScn     │  Quizzes       │  + 精靈 careHint     │
│  Constellation │  Question Bank │  + 收件匣可執行卡片  │
│  Collection    │  Rubric        │                       │
│  LearningAnaly │  Attendance    │                       │
│  Inbox (CTA)   │  Gradebook     │                       │
└────────────────┴────────────────┴───────────────────────┘
```

## 二、7 角色 × 動作 × 下游影響（節選；完整見 actionGraph.ts）

每個動作走完整鏈路：寫入 → 哪些角色看到 → 觸發哪個 companion signal → 哪個 AI tool 重算 → 哪些 inbox 卡片送出。

### Student 學生

| 動作 | 寫入 | 影響角色 | Companion 信號 | AI 觸發 | Inbox |
|------|------|---------|---------------|---------|-------|
| 繳交作業 | submissions, inbox, companionSignals | student, teacher | onAssignmentSubmitted | risk_radar | assignment |
| 作答測驗 | quizAttempts, gradebookEntries, companionSignals | student, teacher | onQuizAttempt | risk_radar | quiz |
| 掃 QR 簽到 | attendanceRecords, companionSignals | student, teacher | onAttendanceCheckin | risk_radar | — |
| 點餐 | orders, companionSignals | student, vendor | onMealOrdered | — | — |
| 借書 | libraryLoans, companionSignals | student, admin | onLibraryBorrow | — | — |
| 宿舍報修 | dormRepairs, inbox, companionSignals | student, staff | onDormRepairCreated | — | assignment |
| 請假申請 | leaveRequests, inbox | student, teacher, dept_head | — | getLeaveRequestStatus | assistant_queue |
| 課程討論發文 | discussions, companionSignals | student, teacher | onDiscussionPosted | — | group |
| 同儕互評 | submissions, companionSignals | student | onPeerReviewGiven | — | — |
| 送鼓勵雲 | inbox, companionSignals | student | onEncouragementSent | — | group |
| 採收植物 | companionSignals, companionUnlocks | student | onPlantHarvested | — | — |
| 查學分試算 | companionSignals | student | onCreditAuditViewed | — | — |
| 收件匣完成 | inbox, companionSignals | student | onInboxActionTaken | — | — |

### Teacher 教師

| 動作 | 寫入 | 影響角色 | TronClass endpoint |
|------|------|---------|--------------------|
| 發布作業 | assignments, inbox | teacher, **student** | POST /courses/{id}/homework |
| 發布測驗 | quizzes, inbox | teacher, student | POST /courses/{id}/quizzes |
| 開啟點名 | attendanceSessions, inbox | teacher, student | POST /courses/{id}/attendance |
| 批改作業 (Rubric) | submissions, gradebookEntries | teacher, student | PATCH /submissions/{id} |
| 建 / 改 Rubric | rubrics | teacher | — |
| 建 / 改題庫 | questionBanks | teacher | — |
| 從題庫抽題 | quizzes | teacher | — |
| 發布課程公告 | announcements, inbox | teacher, student | POST /courses/{id}/announcements |
| 發布最終成績 | gradebookEntries, inbox | teacher, student | — |

### Admin / Staff / Dept Head / Vendor

| 角色 | 主要動作 | 影響角色 |
|------|---------|---------|
| Admin | 審核店家、發全校公告 | 全部 |
| Staff | 處理宿舍報修 | staff, student |
| Dept Head | 簽核請假 | dept_head, teacher, student |
| Vendor | 更新菜單、接訂單 | vendor, student, admin |

## 三、TronClass 端點對映表

| 我們的功能 | TronClass endpoint（pull） |
|-----------|---------------------------|
| 課程列表 | GET /users/me/courses |
| 教材單元 | GET /courses/{id}/modules + /activities |
| 作業 | GET /courses/{id}/homework |
| 測驗 | GET /courses/{id}/quizzes |
| 點名 | GET /courses/{id}/attendance |
| 成績 | GET /courses/{id}/grades |
| 公告 | GET /courses/{id}/announcements |
| 討論 | GET /courses/{id}/forum |

Push 端（我們寫回 TronClass）：

| 我們的動作 | TronClass endpoint |
|-----------|--------------------|
| 學生繳交作業 | POST /courses/{id}/homework/{aid}/submissions |
| 學生作答測驗 | POST /courses/{id}/quizzes/{qid}/attempts |
| 學生 QR 簽到 | POST /courses/{id}/attendance/{sid}/check_in |
| 教師發作業 | POST /courses/{id}/homework |
| 教師發測驗 | POST /courses/{id}/quizzes |
| 教師批改 | PATCH /submissions/{id} |

## 四、入口導覽（解決「我看不到入口」）

### Mobile

| 入口位置 | 進入畫面 |
|---------|---------|
| 我的（PersonalHub）→ 校園精靈 | CompanionScreen |
| 我的 → 我的收藏 | CompanionCollectionScreen |
| 我的 → 校園星圖 | ConstellationScreen |
| 我的 → 校園園地 | CampusGardenScreen |
| 我的 → 成就與積分 | AchievementsScreen |
| 我的 → 學分與畢業規劃 | CreditAuditStack |
| 課程 → 課程詳情 | CourseHubScreen → 作業 / 測驗 / 成績 / 點名 / 教材 |
| 收件匣每張卡 | 自動依 kind 跳到對應 screen（resolveInboxAction） |

### Web

| 入口位置 | 進入畫面 |
|---------|---------|
| 教師課程總覽（/teacher/course/[id]） | 工具列 6 個按鈕（教材 / 測驗 / 題庫 / Rubric / 點名 / 成績簿） |
| 教師端任一子頁 → 「← 回課程總覽」 | 教師課程總覽 |

### AI 代理（24 個 tool 可在聊天框觸發）

| 學生常用 | 教師常用 |
|---------|---------|
| query_modules / query_quizzes / submit_quiz | upsertQuestionBank |
| list_gradebook / post_discussion | upsertRubric |
| query_companion / pet_companion / harvest_plant | draftQuizFromBank |
| send_encouragement / explore_constellation | computeGradebook |
| risk_radar / build_study_plan | grade_submission |

## 五、現在你能拿這份做什麼

### 1. 對接 TronClass（4 週可完成 MVP）

```ts
// backend cron 或 webhook handler
import { buildImportResult } from '@campus/shared';

async function importFromTronClass(uid: string, schoolId: string) {
  const raw = await fetchAllFromTronClass(uid); // 你寫這個 fetcher
  const normalized = buildImportResult(schoolId, raw);
  await writeToFirestore(uid, normalized); // 我們已有的型
  // 完成後所有引擎 / UI / AI 都會自動有資料
}
```

### 2. 在口試簡報用 action graph 展開連鎖反應

```ts
import { explainActionChain } from '@campus/shared';
console.log(explainActionChain('teacher', 'open_attendance'));
// {
//   primary: { label: '開啟點名', ... },
//   downstreamCompanion: null,
//   downstreamAi: null,
//   affectedRoles: ['teacher', 'student'],
//   inboxToSend: ['live']
// }
```

可一頁式展示「教師按一個按鈕，學生 mobile 就跳簽到卡片」這種因果。

### 3. AI 助理可主動引導使用者

利用 action graph 知道「使用者剛剛做了 X → 下一步可能想做 Y」：
- 學生繳完作業 → 提示「現在去看你植物的成長」
- 老師發完作業 → 提示「要不要一鍵發草稿提醒到 inbox？」
- 學生掃完簽到 → 提示「課中可用即時投票 / 提問牆」

## 六、本輪交付物清單

### 新增引擎（packages/shared/src）
- ✅ `lms/tronclassAdapter.ts` — 8 個 normalize 函式 + buildImportResult
- ✅ `lms/actionGraph.ts` — 30 個跨角色動作定義 + 6 個查詢 API

### 測試（apps/mobile/src/__tests__）
- ✅ `tronclassActionGraph.test.ts` — 11 條測試（4 adapter + 7 action graph）

### 入口接線
- ✅ Mobile PersonalHubScreen 加 3 個入口（精靈 / 收藏 / 星圖）
- ✅ Web 教師課程總覽加 6 個工具按鈕（教材 / 測驗 / 題庫 / Rubric / 點名 / 成績簿）

### 文件
- ✅ `docs/TRONCLASS_TO_APP_DATA_FLOW.md`（本檔）

### 累計
- 12 個純函式引擎全測試覆蓋
- backend 122 + mobile 93 = **215 條測試全綠**
