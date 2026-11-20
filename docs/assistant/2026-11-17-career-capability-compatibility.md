# 職涯服務的 Agent 能力表相容修正

## 2026-11-19 整合說明

本次將 origin/main `44a250e3d813d102bc538de0d89d1a6b855c5b5e` 合併至角色工作流程分支。以下保留兩次修補的背景與當時驗證紀錄；其中「main 職涯最小修補紀錄」描述 #683 的指定基準，不代表本次整合要撤回角色工作流程分支已有的功能，也不代表本次重跑的測試結果。

整合後保留本分支的任務圖、解析器、已接通的公開查詢與教師／店家工作流程；職涯仍僅提供原頁入口與簽章確認，不新增申請、進度查詢或寫入。保留 main 新增的實際工具註冊檢查、圖書館入口與職涯 handler 回歸；一般學校資訊請求的回歸亦保留。能力表依整合後真正註冊的工具描述，已接通的服務不改回尚未接通。main 的座位確認修正及限動功能也保留。

### 本次整合驗證

- shared 服務清單與任務能力表：79 項通過，包含 main 的實際工具註冊檢查。
- Web 助理執行器、職涯 handler、任務與活動／地圖介面、Today 入口及限動：134 個檔案、2,889 項通過。
- 座位 action receipt、執行器、寫入 handler 與意圖解析 Jest 回歸：4 個檔案、113 項通過。
- shared／Web 全專案型別檢查及本次涉及的 shared／Web TypeScript、能力表測試 ESLint 通過。
- main 的限動程式與測試、座位確認程式與測試（含 emulator 測試原始碼）逐檔比對相同；本次未執行 emulator 測試。

本次環境為 Node 24.22.1；未宣稱已在專案要求的 Node 22 驗證。

## 角色工作流程分支的修補紀錄

## 問題與版本

2026-11-17 重新查證 main `fd7b2b87ae4368418b61839138d66435d44c2cb5`、#631 `0c60b2333f9e8e01e0cf18460b698d7e568b9a97`、#672 `f3d1f28f4f973becabba0275dafb95da972733f2`、#682 `1082661bb2c46ad0412c8b5528514cf519b4bf03`。現有 open PR 未另外修正此缺漏。

#672 在 `ASSISTANT_SERVICES` 加入 career；#631 新增的 `capabilityDescriptions` 沒有 career。兩者結合時，能力表初始化會存取 `undefined.modes`，在模組載入即拋出 TypeError，連普通 Agent 請求也可能無法載入；TypeScript 同時報 TS1360／TS7053。因此將它列為整合 P1 阻擋，不代表目前正式 main 已發生服務中斷。

前輪本機整合 `9463ed5ca1ff4be24631f47f6dbcd2a8c02707fe` 已找出修正，但未推送。本輪重新獨立重現後，移植最小修補，沒有搬入該整個合併提交或 Today 的 UI 衝突解析。

## 最小變更與依賴

- 本輪基底 `a29d0e6d2770f581eb87d19243a1f72bd6ea2ccd` 結合 #631 與上述 main；依賴 #631，不依賴 #682。
- `assistantServices.ts` 及其測試與 #672 精確版本逐 byte 相同，只同步已存在的職涯項目、別名與路由邊界。沒有重做職涯服務或修改 #672。
- `assistantTaskPlan.ts` 補上 career 的 `handoff` 描述。只允許列出服務／提出開啟原頁；沒有新增資料 reader、申請、承辦或寫入工具。
- 保留 `Record<AssistantServiceId, CapabilityDescription>` 型別要求與所有服務恰好一筆能力描述的回歸，沒有用忽略缺漏、空值預設或弱化檢查掩蓋問題。
- #682 的程式、head 與成功 CI 保持不變。其他正式分支、帳號、資料、部署及 App 5504170 gate 也未改動。

## 可重現驗證

在新隔離分支只同步 #672 清單、尚未加入 mapping 時執行：

```sh
node --test packages/shared/tests/assistantServices.test.cjs packages/shared/tests/assistantTaskPlan.test.cjs
pnpm --filter @campus/shared typecheck
```

實際結果：62 passed／1 module-load failure；型別檢查 TS1360／TS7053。補上描述後，同組測試 79 passed、shared typecheck 通過。原紅燈 logs 保留在本機 evidence，未將它們冒充公開附件。

本批只修正清單／能力表相容性，對未接通的職涯來源不宣稱有查詢或執行能力。實際申請、實習學分與承辦流程仍須依原頁的資料來源、登入與校方授權確認。

PR 的最終精確 head、適用聚合測試、獨立複查與遠端 CI 以 PR 描述為準。維持 Draft；不合併、不部署，不繞過必要 App 核准。

## main 職涯最小修補紀錄（#683，當時基準）

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
