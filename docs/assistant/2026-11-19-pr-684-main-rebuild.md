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
