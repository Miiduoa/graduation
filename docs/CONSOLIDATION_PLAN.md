# 重複/相似功能 整合與刪除清單

> **2026-05-17** — 找出兩端的重複實作、決定保留版本、執行刪除。
> 目標：故事性、可維護性、demo 不卡頓。

## A. Mobile AI 服務（最大重災區）

`apps/mobile/src/services/` 目前 34+ 個 AI 相關檔案。按 `docs/AI_SERVICE_CONSOLIDATION_PLAN.md` 整合到 6 個。

### Phase 1 — 立刻刪除（純 stub / 已被取代）

| 檔案 | 處理 | 理由 |
|------|------|------|
| `aiAgentOrchestrator.ts` | DELETE | deprecated stub，被 `aiOrchestrator.ts` 取代 |
| `aiAmbientAwareness.ts` | DELETE | re-export stub |
| `aiBrain.ts` | DELETE | concept 已被 `aiOrchestrator.ts` + `aiFacade.ts` 取代 |
| `aiProactiveThinker.ts` | DELETE | 與 `proactiveIntelligenceEngine.ts` 重複 |
| `aiReflexion.ts` | MOVE → `__tests__/fixtures/` | testing util |
| `aiSelfDialogMultiTurn.ts` | MOVE → `__tests__/fixtures/` | testing util |

### Phase 2 — 合併（後 demo 再做，本次不動）

- `aiContinualLearning.ts` + `aiActiveLearning.ts` → `aiLearning.ts`
- `aiSemanticReasoner.ts` + `aiCrossModuleInference.ts` → `aiThinking.ts`
- `aiSmartActions.ts` + `aiActionCoordinator.ts` → 併入 `aiOrchestrator.ts`
- `aiAgentTools.ts` + `aiToolLayer.ts` → `aiToolRegistry.ts`

### Phase 3 — 巨檔拆分（後續工程）

- `ai.ts` (4161 行) → `aiTransport.ts` + `aiOrchestrator.ts`
- `aiLocalAgent.ts` (3004 行) → 拆 4 個檔

### 保留的 6 核心服務

1. `aiOrchestrator.ts` — 動作規劃 + 執行
2. `proactiveIntelligenceEngine.ts` — 5 角色主動掃描
3. `studyBuddyEngine.ts` — 學伴匹配
4. `smartAttendanceEngine.ts` — 智慧點名
5. `courseWorkspace.ts` — 課程脈絡
6. `localAIEngine.ts` — 本地推理

## B. Mobile 備份檔（純清理）

`apps/mobile/src/screens/*.tsx.bak` × 8、`*.tsx.bak2` × 8 — 全刪。

## C. Web 端相似頁面

| 相似組 | 處理 | 理由 |
|--------|------|------|
| `/groups` vs `/clubs` | 保留 `/clubs`，`/groups` 改為 redirect 到課程聊天分組 | groups 概念與 clubs 過於接近，但 groups 在 page.tsx 走「課程小組」走向，保留分離但讓首頁不要同時推兩個入口 |
| `/ai-assistant` vs mobile 的 AIStudyBuddy / Companion | Web `/ai-assistant` 是主入口；mobile 的 StudyBuddy 走學伴 P2P、Companion 走情緒/家教，明確分職責，不合併 | 三者角色不同：助理/學伴/陪伴 |
| `/bus` vs mobile `BusV2Screen` / `OnBusModeScreen` | 各自獨立（web 是看公車資訊，mobile 有上車模式），不合併 | 平台 affordance 不同 |
| `/map` vs mobile `GoogleMapsLikeScreen` / `IndoorFloorMapScreen` | 各自獨立 | 同上 |

## D. Web demoStore 動作鏈 缺口（要新增）

從 ROLE_FEATURE_MATRIX 對應，現有 6 條 + 新增 9 條 = 15 條：

新增：
1. `submitFeedback()` — teacher 起草評語 → student
2. `postDiscussion()` — student 發討論 → 同學/老師
3. `requestHelp()` — student AI 求助 → ta 佇列
4. `replyHelpRequest()` — ta 回覆求助 → student
5. `placeOrder()` — student 訂餐 → vendor
6. `updateOrderStatus()` — vendor 推進 → student
7. `requestLeave()` — student 請假 → teacher
8. `decideLeave()` — teacher 核准/退回 → student
9. `submitDormRepair()` — student 報修 → admin
10. `assignPeerReview()` — teacher 指派 → 學生
11. `submitPeerReview()` — 學生 → 對方學生
12. `bulkRemind()` — teacher 批量提醒 → 一批學生
13. `notifySubmitterAnnApproved()` — 公告核准回頭通知提交者
14. `sendDeptBroadcast()` — dept_head 發廣播 → 全系
15. `disableUser()` / `enableUser()` — admin 寫入帳號狀態

### 既有動作鏈的 bug 修正

- `publishGrades()` 寫死 `stu-001` → 改為接受 `studentIds: string[]` 或全班自動派發
- `approveClubMember()` 寫死「陳社長」「程式設計社」→ 從 membership / DEMO_CLUBS 動態讀
- `endAttendanceSession()` 只通知 `stu-001` → 改為通知所有 `absentUids`

## E. AI Context 動態化

`aiContext.ts` 目前讀靜態 `STUDENT_ASSIGNMENTS` / `TEACHER_PENDING_REVIEWS`。
改為：

- `buildStudentContext({ store })` 接受 store 參數，從 `store.dynamicAssignments` 合併
- `buildTeacherContext({ store })` 從 `store.submissions` 計算待批改數
- `buildClubOfficerContext({ store })` 從 `store.clubMemberships` 計算待審數
- `buildDeptHeadContext({ store })` 從 `readPendingAnns()` 計算待審公告數（已動態）+ store

## F. 不整合但需釐清的功能（保留分離）

- **訊息（messages）vs 公告（announcements）**：訊息=點對點/廣播 inbox；公告=公佈欄。保留分離但訊息頁加「來源於公告」的引用。
- **profile vs settings**：profile=讓別人看的；settings=個人化偏好。保留分離。
- **/admin vs /settings 系統區**：admin=多角色 ops；settings 系統區=管理員個人偏好。/settings 系統區應該都跳到 /admin。
