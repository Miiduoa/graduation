# #684 再次同步 main（8642a166f）

本次完成既有 no-ff merge，父提交為 `3c97433c2b32` 與 `8642a166f401`。下方較早紀錄描述前一次同步，並非本次的差異或測試結果。

逐檔先取 MERGE_HEAD，再核對 `git diff c112ac4199bd...3c97433c2b32 -- <file>`。本次 20 個衝突全部採用 main 原文，沒有需要額外移植的 #684 hunk：main 已包含 task-first 完整清單與 compact 的復原 renderer、elapsed／missed 作業安排復原、原 mutation identity、未知結果阻擋，以及 coursework recovery 與 task retry 的功能和測試。本次合併樹相對 main 僅多出這份處理紀錄。

## 本次採用 main 原文的衝突檔案（20 個）

- `.github/workflows/ci.yml`
- `apps/web/src/components/TodayCampusEntry.test.tsx`
- `apps/web/src/features/nuni/Assistant.tsx`
- `apps/web/src/features/nuni/assistant/AssistantPlanRevision.tsx`
- `apps/web/src/features/nuni/assistant/AssistantThread.tsx`
- `apps/web/src/lib/nuni/assistantV2/actions.ts`
- `apps/web/src/lib/nuni/assistantV2/adapter.ts`
- `apps/web/src/lib/nuni/assistantV2/campusEventRequest.ts`
- `apps/web/src/lib/nuni/assistantV2/connectedServiceFlow.test.ts`
- `apps/web/src/lib/nuni/assistantV2/connectedServiceReads.ts`
- `apps/web/src/lib/nuni/assistantV2/contracts.ts`
- `apps/web/src/lib/nuni/assistantV2/courseworkRecovery.ts`
- `apps/web/src/lib/nuni/assistantV2/crossService.ts`
- `apps/web/src/lib/nuni/assistantV2/crossServiceRequest.ts`
- `apps/web/src/lib/nuni/assistantV2/handler.ts`
- `apps/web/src/lib/nuni/assistantV2/runner.ts`
- `apps/web/src/lib/nuni/assistantV2/taskRetry.ts`
- `apps/web/src/lib/nuni/assistantV2/tools.ts`
- `packages/shared/src/assistantRoleProfiles.ts`
- `scripts/qa/assistant-plan-revision/check.py`

## 本次保留與驗證

保留 #689 的 `focusVisibleTabControl`、`event.preventDefault()` 與 `onKeyDown={focusVisibleTabControl}`；保留所有 browser cases，包含 `revision_native_focus_policy_case` 與 `role_context_case`。保留 preferredWorkContext 僅影響顯示、鎖定時仍能選擇工作情境範例、未鎖定手動選擇同步 taskProfile 的規則；教師偏好測試及 merchantWorkspace 的大小寫 script 斷言完全沿用 main。

ServiceDirectory、生活與交流的分類及 `/life?group=daily` 的「吃飯與住宿」完全沿用 main。權限、登入、Firestore rules／indexes 等檔案也僅接收 main 既有版本，沒有新增修改。

- Web 主要回歸：100 files / 2,324 tests passed。執行 TodayCampusEntry、TodayAgent、TodayAgentPanel、AssistantWorkContext.integration、AssistantPlanRevision、AssistantTaskRetry、AssistantTaskPlan、assistantTaskRetry，以及 assistantV2 整個目錄（含 merchantWorkspace、courseworkRecovery、taskRetry 與角色工作區測試）。
- Web 入口與 UI：7 files / 206 tests passed。執行 life/page、ServiceDirectory、CampusServiceMenu、serviceJourneys、Assistant、AssistantThread 與 AssistantThread.scroll。
- Shared：99 tests passed，涵蓋 assistantRoleProfiles、assistantRoleWorkflows、assistantRoleTasks、assistantTaskPlan、assistantServices。
- Chromium：`revision-native-focus-policy-320`、`role-pending-390`、`role-unknown-390` 全部通過，實際使用本工作樹的 production UI fixture。
- Web typecheck 通過；相對 main 的 `git diff --check` 通過。相對舊 HEAD 的 staged check 僅指出 main 已存在的 GroupPresentation.test.tsx EOF 空行，未為此改動 main 原文。
- 執行環境 Node 24.22.1，repository 宣告為 22.x；未調整環境設定或測試斷言。

未推送、部署或合併 PR。

---

# #684 同步 main 的衝突處理紀錄

本次在 `fix/agent-task-recovery-integration-20261117` 完成既有的 no-ff 合併，父提交為 `9daceac8f445` 與 `c112ac4199bd`（origin/main）。所有 43 個衝突先取 main，再核對 `git diff 89408730815c...9daceac8f445 -- <file>`，只移植仍需要且不回退 main 的內容。

保留 main 的 ServiceDirectory / serviceJourneys 三分類；生活與交流各有頁面。`/life?group=daily` 仍為「吃飯與住宿」，包含餐飲且不包含圖書館。保留 main 所有 life 頁面斷言。

## 採用 main 原文（37 個）

- `.github/workflows/role-workflows-browser.yml`
- `.gitignore`
- `apps/mobile/src/__tests__/CampusHubSchoolScope.test.tsx`
- `apps/mobile/src/__tests__/myOrdersScreen.test.tsx`
- `apps/mobile/src/__tests__/quickCampusActions.test.ts`
- `apps/mobile/src/__tests__/releaseNavigation.test.tsx`
- `apps/web/src/app/admin/announcements/SchoolAnnouncementsAdmin.test.tsx`
- `apps/web/src/app/admin/announcements/SchoolAnnouncementsAdmin.tsx`
- `apps/web/src/app/life/life.module.css`
- `apps/web/src/app/life/page.test.tsx`
- `apps/web/src/app/life/page.tsx`
- `apps/web/src/app/login/page.tsx`
- `apps/web/src/app/page.test.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/search/page.test.tsx`
- `apps/web/src/app/search/page.tsx`
- `apps/web/src/components/CampusServiceMenu.module.css`
- `apps/web/src/components/CampusServiceMenu.test.tsx`
- `apps/web/src/components/today/StudentToday.tsx`
- `apps/web/src/features/nuni/assistant/AssistantPlanRevision.test.tsx`
- `apps/web/src/lib/academicSections.test.ts`
- `apps/web/src/lib/academicSections.ts`
- `apps/web/src/lib/campusDirectorySearch.test.ts`
- `apps/web/src/lib/campusDirectorySearch.ts`
- `apps/web/src/lib/campusServices.test.ts`
- `apps/web/src/lib/campusServices.ts`
- `apps/web/src/lib/nuni/assistantV2/careerCapabilityHandler.test.ts`
- `apps/web/src/lib/primaryNavigation.test.ts`
- `apps/web/src/lib/primaryNavigation.ts`
- `apps/web/src/lib/quickCampusActions.test.ts`
- `apps/web/src/lib/useSchoolRole.test.tsx`
- `apps/web/src/lib/useSchoolRole.ts`
- `docs/assistant/2026-11-17-career-capability-compatibility.md`
- `packages/shared/tests/assistantServices.test.cjs`
- `scripts/campus-visual-smoke.py`
- `scripts/qa/browser/install-playwright.sh`
- `scripts/qa/browser/install-playwright.test.sh`

## 移植與必要適配（6 個）

- `apps/web/src/components/today/TodayAgentPanel.tsx`：移植復原資格、原 mutation identity、阻擋狀態與共用 arrangement renderer；完整清單與 compact 最近安排皆可明確提出新預覽。
- `apps/web/src/components/today/TodayAgentPanel.test.tsx`：保留全部 main 測試，加入 #684 的 elapsed、最新 parent、原歷史、compact 與未知結果核對回歸。
- `packages/shared/src/assistantTaskPlan.ts`：移植有界任務證據解析器與本 PR 已接通的讀取能力；保留 main 的職涯 handoff 能力。
- `packages/shared/tests/assistantTaskPlan.test.cjs`：加入解析器測試，更新本 PR 已接通讀取能力的預期，保留 main 的測試項目與職涯斷言。
- `apps/web/src/features/nuni/assistant/AssistantPlanRevision.tsx`：僅加入 #684 的 `data-assistant-plan-revision` 屬性，供編輯焦點與捲動保護辨識；完整保留 main 原生 Tab 處理。
- `apps/web/src/components/TodayCampusEntry.test.tsx`：保留 main 全部測試與斷言；假 session context 改為正式驗證需要的 43 字元，fetch fixture 增加 #684 的 map-read 端點，讓原取消／晚到回覆測試涵蓋新的讀取路徑。

另外修正兩處 Git 自動合併重複：assistantServices 移除本 PR 重複新增的 career，完整保留 main 的原生路由、摘要與別名；V2 tools 移除重複 import。未更動權限政策或登入流程。

## 驗證

- Web：143 files / 3,209 passed / 0 failed（`vitest run --maxWorkers=2`）。涵蓋 life 頁面與 continuity、academicSections、campusDirectorySearch、campusServices、primaryNavigation、quickCampusActions、serviceJourneys、search、首頁、ServiceDirectory、CampusServiceMenu、TodayCampusEntry、StudentToday、TodayAgentPanel、TodayAgent、assistant 計畫修訂／草稿／捲動／任務 UI、V2 整個目錄（含 careerCapabilityHandler 與 coursework/task retry recovery）、公告管理及 useSchoolRole。
- 共享：`node --test packages/shared/tests/assistantTaskPlan.test.cjs packages/shared/tests/assistantServices.test.cjs`：81 passed / 0 failed。
- 安裝腳本：`bash scripts/qa/browser/install-playwright.test.sh`：8/8 passed。
- Mobile：CampusHubSchoolScope、myOrdersScreen、quickCampusActions、releaseNavigation、aiAgentCrossService：5 suites / 178 passed / 0 failed。
- Web 與 shared typecheck、相關 Web ESLint、`git diff --check`：通過。

Mobile 的既有 node_modules symlink 指到其他 worktree，初跑無法載入 main 新增的 shared 模組；重跑用臨時 Jest moduleNameMapper 指回本 worktree，完整保留原設定與斷言。臨時設定未提交。

Web 大批執行曾有 1 項 adapter 測試超過原 5 秒時限；單獨重跑 3/3 通過，再以 `--maxWorkers=2` 重跑全部相關測試，未變更 timeout。執行環境 Node 為 24.22.1，與 repository 宣告的 22.x 不同。
