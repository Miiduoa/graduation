# #689 同步 main 驗證紀錄（2026-11-19）

- 工作分支：`feat/role-aware-agent-20261117`。
- 原 PR HEAD：`fe414622f0f8e8b74f1f9ee087aa8b9ac8270c7c`。
- 合併 main：`c112ac4199bd64ed124465ef27d528f88e8aceac`。
- 所有衝突檔先取 main；移植依據為 `git diff bb61b1fa64df...fe414622f0f8 -- <file>`。
- 保留 main 的 ServiceDirectory / serviceJourneys、三個生活分類、獨立交流頁與網址語意。`/life?group=daily` 仍為吃飯與住宿，含餐飲、不含圖書館。
- main 已包含角色工作區入口與缺少 status 的舊會員相容處理，直接保留；未變更登入驗證、權限、規則、索引、付款或環境設定。

## 衝突檔採 main 原樣

- `apps/mobile/src/__tests__/CampusHubSchoolScope.test.tsx`
- `apps/mobile/src/__tests__/myOrdersScreen.test.tsx`
- `apps/mobile/src/__tests__/quickCampusActions.test.ts`
- `apps/mobile/src/__tests__/releaseNavigation.test.tsx`
- `apps/web/src/app/life/page.test.tsx`
- `apps/web/src/app/life/page.tsx`
- `apps/web/src/app/login/page.tsx`
- `apps/web/src/app/page.test.tsx`
- `apps/web/src/app/search/page.test.tsx`
- `apps/web/src/app/search/page.tsx`
- `apps/web/src/components/CampusServiceMenu.module.css`
- `apps/web/src/components/CampusServiceMenu.test.tsx`
- `apps/web/src/components/today/StudentToday.tsx`
- `apps/web/src/lib/academicSections.test.ts`
- `apps/web/src/lib/academicSections.ts`
- `apps/web/src/lib/campusDirectorySearch.test.ts`
- `apps/web/src/lib/campusDirectorySearch.ts`
- `apps/web/src/lib/campusServices.test.ts`
- `apps/web/src/lib/campusServices.ts`
- `apps/web/src/lib/primaryNavigation.test.ts`
- `apps/web/src/lib/primaryNavigation.ts`
- `apps/web/src/lib/quickCampusActions.test.ts`
- `apps/web/src/lib/useSchoolRole.test.tsx`
- `apps/web/src/lib/useSchoolRole.ts`
- `scripts/campus-visual-smoke.py`
- `scripts/qa/interface-design/check.py`

## 衝突檔移植 #689 相容變更

- `.github/workflows/role-workflows-browser.yml`
- `apps/web/src/app/page.tsx`
- `apps/web/src/components/TodayCampusEntry.test.tsx`
- `apps/web/src/components/TodayCampusEntry.tsx`
- `apps/web/src/components/today/TodayAgentPanel.test.tsx`
- `apps/web/src/components/today/TodayAgentPanel.tsx`

首頁和 TodayCampusEntry 僅新增教師工作情境傳遞，保留 main 的助理開關、焦點、回返網址及校園切換邊界。TodayAgentPanel 補上既有安排到期後重新規劃的入口與測試。TodayCampusEntry 的測試採有效格式的 session fixture，保留原取消請求、草稿恢復及忽略延遲結果的覆蓋，另加入地點查詢取消與角色情境測試。瀏覽器 workflow 使用 #689 的安裝重試腳本，保留 main 的步驟逾時限制。

## 指定自動合併檔

- `.gitignore`：以 main 為底，僅加入 #689 的 assistant-plan-revision 產物忽略規則（role-workflows 規則 main 已有）。
- `apps/web/src/app/life/life.module.css`：main 原樣。
- `apps/web/src/features/nuni/assistant/AssistantPlanRevision{.tsx,.test.tsx,.module.css}`：以 main 為底移植 #689 的可視範圍與鍵盤焦點修正及測試。
- `scripts/qa/browser/install-playwright{.sh,.test.sh}`：以 main 為底移植 #689 的權限提升後逾時、dpkg 復原、字型下載時間及測試。

## 驗證結果

- Web 生活頁、首頁、搜尋、目錄、services、primaryNavigation、academicSections、quickCampusActions、useSchoolRole、TodayAgent、TodayAgentPanel、StudentToday、TodayCampusEntry、CampusServiceMenu 等：最終重跑 25 檔案、721 項全部通過。首輪 TodayCampusEntry 失敗已以原 PR fixture 與獨立地點取消測試修正，未刪除測試。
- Web 助理元件、assistantV2、TodayCampusEntry、提議修改、角色任務、跨功能與地點流程等：135 檔案、2,945 項通過。
- Shared assistantTaskPlan / assistantRoleWorkflows：20 項通過。
- install-playwright：11/11 通過。
- Mobile CampusHubSchoolScope、myOrdersScreen、quickCampusActions、releaseNavigation、aiAgentCrossService：5 組、178 項通過。現有 node_modules 連到舊 worktree，首輪缺少 main 新增模組；以臨時 Jest 設定將 shared 解析到本 worktree 後通過，未修改產品或測試的模組實作。
- Role Workflows Browser：9 個情境、69 項檢查通過。
- TodayAgent Browser：11 個情境通過。
- Assistant Plan Revision Browser：46 個產品驗收情境通過。
- `scripts/nuni-assistant/v2.test.mjs`：4 項通過。
- Web typecheck：通過。
- 四個移植元件的 ESLint：0 error；首頁既有的 set-state-in-effect 警告 1 項。
- `git diff --check`：通過。

未推送、部署或合併 PR。
