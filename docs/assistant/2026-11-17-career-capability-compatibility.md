# 職涯服務的 Agent 能力表相容修正

## 問題與範圍

原修補 `803dd302c` 補上職涯服務與 `career: handoff(...)`，避免能力表初始化時存取不存在的描述。但原分支以 #631 為基底，將已決定不合併的跨服務執行器一併帶入，形成 merge-base review 的 P1 阻擋。

本輪以指定 main `fd7b2b87ae4368418b61839138d66435d44c2cb5` 為內容基準，用新增提交撤回 #631 的執行器、UI、讀取器及其專屬測試與文件；不 rebase、不改寫歷史。相對於該基準僅保留 7 個檔案的職涯能力表修補。`runner.ts`、`handler.ts`、adapter、Mobile、課程及社團資料流程均與指定基準一致。較新 origin/main 的其他 PR 不納入本次修補。

## 保留的修補

- 職涯服務保留 `/career`、校園 scope、別名與原頁確認文案，不新增原生畫面或宣稱已送出申請。
- `assistantTaskPlan.ts` 僅保留靜態能力表與查詢函式，不保留跨服務任務圖或解析器。名稱沿用本 PR 的檔案；此模組不執行任務。
- 保留 `Record<AssistantServiceId, CapabilityDescription>` 的完整性要求、每個服務恰好一筆描述及不可變資料測試。職涯僅為 `handoff`，可列入口及準備開頁，沒有申請、進度查詢或寫入工具。
- 能力表只宣告指定基準已註冊的工具；#631 才新增的公開查課、活動、地圖、公告、失物招領、公開交流與學校資訊 reader 改為誠實的原頁入口描述。
- 既有 `list_campus_services` 回傳靜態能力描述；不改動請求路由、權限判斷或資料存取。
- 保留真實 handler 的職涯入口、簽章確認、跨帳號／校園／session／對話拒絕、撤銷與不讀寫業務資料回歸。一般請求改用基準已有的圖書館服務入口驗證。

## 相容條件

沿用既有平台 session、有效學生會員與 reviewed 課程權限；社團沿用校園 realm 與原有存取檢查。轉學生及舊帳號沒有新增身分排除條件。個人匯入資料仍依帳號／校園讀取，舊活動保留 legacy collection fallback，學校帳號資料不混入平台帳號資料。

登入、認證、角色、Firestore rules／indexes、migration、付款、環境與 feature flags 均未修改。沒有刪除指定基準的功能或使用者資料，也沒有部署、推送或合併。

## 驗證

以下皆通過：

- `node --test packages/shared/tests/assistantServices.test.cjs packages/shared/tests/assistantTaskPlan.test.cjs`：66 項。
- `pnpm --filter web exec vitest run src/lib/nuni/assistantV2 src/features/nuni/Assistant.test.tsx src/features/nuni/assistant src/components/TodayCampusEntry.test.tsx`：70 個檔案、1,223 項。
- Mobile 的 `assistantServiceNavigation`、`assistantServiceIntegration`、`AssistantServiceReply` Jest 回歸：3 個檔案、59 項。
- `node --test scripts/nuni-assistant/v2.test.mjs`：3 項。
- shared 與 Web 全專案型別檢查；修改的 shared／Web TypeScript 檔案 ESLint；`git diff --check`。
- 範圍比對：修改全部位於原 PR 的檔案；原 123 個差異檔案中的其餘 116 個已還原指定基準，最終 7 個差異檔案沒有相對基準刪檔。

測試環境為 Node 24.22.1，與專案要求的 Node 22 不同；未將上述結果宣稱為 Node 22 驗證。PR 維持既有狀態；本次僅建立本機修正提交。
