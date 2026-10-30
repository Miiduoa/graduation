# 個人匯入辨識穩定性與雲端備援

基準：`7dc77f5cb15265937d41bd5516c3e3c6a15e96ca`；分支 `fix/import-recognition-stability`。以下原始行號均指基準版本。變更尚未提交或部署。

## 根本原因與證據

### 網頁

- `apps/web/src/lib/personalImportAi.ts:79–94, 167–174` 原先把完整文字交給單一 worker，最後才解析 JSON、核對完整表格。任一 JSON／來源核對錯誤都使整次作業失敗，沒有可交付的部分草稿。
- `apps/web/src/lib/personalImportAi.worker.ts:137–151, 273–281` 對純文字也載入 Qwen3-VL 2B；`personalImportAiConfig.ts:1–9` 標示約 1.9 GB，輸入／輸出上限 8192／4096 tokens。`worker.ts:316–319` 達輸出上限直接拋錯，沒有分段恢復。
- `personalImportAi.ts:23–40, 73–74, 109–111` 不支援 WebGPU 時直接擋住，工作只有共用的十分鐘逾時。`PersonalImportCenter.tsx:517, 698–743` 只在整次完成後換成新草稿，卸載會取消工作。
- 這些是程式與回歸測試確認的失敗路徑。沒有原使用者的崩潰紀錄，不能斷言其裝置實際發生 GPU／記憶體溢位。

### 手機

- `apps/mobile/src/services/imports/personalImportAi.ts:172–177, 205–241` 已有分段，但任何後段逾時、截斷、JSON／表格核對錯誤都 reject 整次工作，丟棄先前的 `combined`。同一後段失敗案例在基準版本失敗、修正後保留成功段落。
- 原 `personalImportAi.ts:181–185` 固定要求 1536 輸出 tokens；`apps/mobile/src/services/localLLMInference.ts:110–117` 的 Qwen2.5 0.5B 只有 2048 context，原匯入流程沒有為提示、來源與輸出共用的 context 留出預算。
- 原 `PersonalImportScreen.tsx:398, 539–551` 只在整次返回時更新草稿，沒有完成段落的保存機制。切換畫面會取消，已完成段落無法恢復。
- 原 `TimetableOcrHost.tsx:63–70` 只處理 WebView 一般載入錯誤，缺少 iOS／Android renderer 終止處理。這是可確認的錯誤處理缺口，真機是否因 OOM 終止仍未確認。

## 修正後行為

- 雲端優先，其次本機模型，最後規則解析；每段都會在畫面說明目前模式。
- 來源最多 40,000 字元，按完整資料列／可辨認段落分段；單段以 1,000 字元、最多八筆完整紀錄為目標。不能安全拆開的紀錄留在裝置上走規則解析，其他段落繼續。
- 完成段落立即更新草稿。JSON 不完整、欄位錯配或輸出截斷會在已知邊界縮小重試；失敗範圍留有明確提示，使用者可只重試未完成段落。草稿需核對後才寫入個人紀錄。
- Web worker 在同次匯入中共用已載入模型，每段釋放 tensor，輸入／輸出預算降為 4096／2048；本機載入上限三分鐘，生成上限兩分鐘。最終完成、取消或致命錯誤會終止 worker。
- 手機依 Qwen context 控制輸出長度；逾時保留成果，但原生 completion 尚未結束前仍保留鎖，避免同時載入／推論。手機草稿依帳號與學校隔離、依序保存。
- 圖片先在裝置上 OCR，只將遮罩後的文字交給雲端。網頁 OCR 失敗時可嘗試本機視覺模型。原圖不送 Cloudflare；OCR Host 終止後可重建，舊 Host 的事件不能干擾新的工作。

## 雲端端點

`POST /api/personal-import/recognize`，只接受文字、資料類型及欄位參考。

- 使用現有平台 session 檢查，再向既有 `sessions/current` 驗證；網頁沿用 Cookie／`X-Campus-Session`，手機沿用 `Authorization: Platform …`。沒有修改登入或 session 實作。
- 僅伺服器從環境變數讀取 `CF_AI_ACCOUNT_ID`、`CF_AI_API_TOKEN`。未設定回 `503 disabled`，前端自動備援。本次沒有讀取、設定或列印實際值，也沒有改 `.env`。
- 目前模型為 `@cf/qwen/qwen3-30b-a3b-fp8`，使用 Workers AI REST JSON schema。支援方式依 [Cloudflare 模型文件](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)與 [JSON Mode 文件](https://developers.cloudflare.com/workers-ai/features/json-mode/)核對。
- 每位已驗證的平台帳號、每個台灣日曆日最多 60 次模型請求；每段算一次，自動縮小重試也計次。單次文字加欄位參考最多 8,000 字元。
- 使用現有 Firebase Admin 的 Firestore transaction 儲存配額，不依賴單一伺服器記憶體；配額儲存不可用時停止雲端呼叫並退回本機。延遲的前一天請求不能重設新一天計數。
- 客戶端與伺服器都遮罩可辨識的姓名、教師、學號及證號。支援含引號、跨行 CSV／TSV、混合欄位與直向 OCR；整份來源先遮罩再分段，防止標籤與姓名分開後漏出。無法可靠判斷的個資欄留在裝置上處理。
- 伺服器 20 秒、客戶端 25 秒上限。未啟用、429、逾時、5xx 或無法驗證登入時自動備援。服務日額度仍以 Cloudflare 帳號當時的方案為準。

## 驗證與未驗證範圍

使用 Node 22，最終驗證：

- `pnpm typecheck`：Web、Mobile、shared 全部通過。
- `pnpm --filter web exec vitest run src/lib/personalImport src/components/imports/PersonalImportCenter.test.tsx src/lib/server/personalImportCloud`：26 個測試檔、647 項通過，包含 44 項雲端／遮罩測試。
- `pnpm --filter mobile test --testPathPattern='[Pp]ersonalImport|[Tt]imetableOcr|localLLM'`：16 個測試組、183 項通過。
- `git diff --check`：通過。
- 基準重現：手機後段失敗測試在原版本拒絕整次匯入，修正後保留完成資料；worker 新增三個回歸案例在原版本失敗，修正後通過；OCR 舊 Host 錯誤回呼在修正前中止新工作，修正後被忽略。

自動化驗證包含雲端成功、未登入拒絕、未啟用／429／5xx／逾時備援、個資遮罩、配額交易／跨日競態、後段失敗保留、失敗段重試、取消／晚到回應、草稿恢復與 OCR renderer 重建。

未使用正式 Cloudflare token 或真實平台帳號呼叫端點；未執行真實 1.9 GB WebGPU 模型下載／推論、手機 Qwen 真機推論、實機記憶體壓力與作業系統終止測試。沒有部署，也沒有 commit／push。單元與元件測試不等同於上述正式環境驗收。

## 變更檔案

### 實作

- `apps/mobile/src/components/TimetableOcrHost.tsx`
- `apps/mobile/src/screens/PersonalImportScreen.tsx`
- `apps/mobile/src/services/imports/personalImportAi.ts`
- `apps/mobile/src/services/imports/personalImportDraft.ts`
- `apps/web/src/app/api/personal-import/recognize/route.ts`
- `apps/web/src/components/imports/PersonalImportCenter.tsx`
- `apps/web/src/lib/personalImportAi.ts`
- `apps/web/src/lib/personalImportAi.worker.ts`
- `apps/web/src/lib/personalImportAiConfig.ts`
- `apps/web/src/lib/personalImportAiLocal.ts`
- `apps/web/src/lib/server/personalImportCloud.ts`
- `packages/shared/src/imports/aiCloud.ts`
- `packages/shared/src/imports/aiRecognition.ts`
- `packages/shared/src/imports/aiTextBatches.ts`

### 測試

- `apps/mobile/src/__tests__/PersonalImportScreen.test.tsx`
- `apps/mobile/src/__tests__/TimetableOcrHost.test.tsx`
- `apps/mobile/src/__tests__/personalImportAi.test.ts`
- `apps/mobile/src/__tests__/personalImportAiBatches.test.ts`
- `apps/mobile/src/__tests__/personalImportAiCloud.test.ts`
- `apps/mobile/src/__tests__/personalImportAiCoverage.test.ts`
- `apps/mobile/src/__tests__/personalImportAiRecovery.test.ts`
- `apps/mobile/src/__tests__/personalImportDraft.test.ts`
- `apps/web/src/components/imports/PersonalImportCenter.test.tsx`
- `apps/web/src/lib/personalImportAi.tableCoverage.test.ts`
- `apps/web/src/lib/personalImportAi.test.ts`
- `apps/web/src/lib/personalImportAi.worker.test.ts`
- `apps/web/src/lib/personalImportAiFlow.test.ts`
- `apps/web/src/lib/personalImportAiResilientBatches.test.ts`
- `apps/web/src/lib/personalImportAiSchema.test.ts`
- `apps/web/src/lib/server/personalImportCloud.test.ts`
- `apps/web/src/lib/server/personalImportCloudClient.test.ts`

