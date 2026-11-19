# 課業準備時間復原

使用者已確認並保存的準備時段結束後，作業可能仍未完成。原首頁因 `trackedTask` 只檢查有無追蹤紀錄，持續隱藏找空檔入口，無法接續課業與行事曆任務。

本批提供明確的重新規劃操作：先驗證舊安排的簽章來源、目前課程資格、作業狀態與期限，再讀取完整課表及行事曆，產生新的 30 分鐘確認卡。使用者再次確認後才寫入，並沿用原有讀回核對及不確定結果復原流程。保留舊行程及追蹤，不更改權限、不自動執行。

## 版本及範圍

- 開發基底：PR #631 `0c60b2333f9e8e01e0cf18460b698d7e568b9a97`。
- 盤點時 main：`0fdee84e7cd2eca2fa49efd9477b24dd516e1c7c`。
- 本功能依賴 #631 的課務來源、個人行程確認、Today 追蹤與執行回執；不依賴 Firebase 圖書／訂餐修補。
- #672 `f3d1f28f4f973becabba0275dafb95da972733f2` 修改相同 Today 元件的 compact 呈現，未提供這項復原功能；整合時須保留 compact props 與兩處追蹤元件的復原入口。
- 新分支獨立於 #670／#678／#680／#681，不推送或重寫它們的分支。既有 workflow concurrency 依 PR/ref 區分，不取消其檢查。

## 安全邊界

- 只有來源仍開放、未繳交、期限在未來，而且原行程完整相符且已結束，才可重新規劃。
- 查不到、改過、尚未結束或無法讀取的原行程不提供復原。缺少紀錄不能證明先前寫入失敗。
- 舊 proof 只選擇並驗證歷史來源；新確認綁定目前帳號、session、學校與 conversation。重新查核目前新增個人行程權限。
- 同一原安排使用穩定的後續 mutation ID；不同分頁或重試不能透過新 ID 堆出多筆後續行程。持久層既有 revision CAS／mutation 冪等機制保持不變。
- 確認前再次檢查作業、原行程及新時段。來源變更、權限撤回、讀取失敗或 revision 衝突一律停止。
- 確認後回應遺失仍保留原確認及 execution journal，先查核同一筆；取消未送出預覽不會刪除既有行程。
- 此頁面中的 unknown 操作只查核原確認。另一個登入 session 可能重新取得同一 child ID 的預覽，仍須再次明確確認；沒有跨 session 的全域 dispatch 鎖。競態回歸以合成 transport 模擬既有服務的 mutation request-hash 衝突與 revision CAS，確認最多保留一筆後續行程；這不是新增資料庫交易測試，也不代表完全禁止第二次 dispatch。
- 現有行事曆紀錄沒有課業 ID；對同標題且尚未結束的其他行程採保守拒絕，不能宣稱已辨識所有改名或手動安排的同一課業。重名可能需要先人工核對。
- 使用合成來源與本機 fixture；未操作正式課程、帳號或行事曆。

## 既有審查證據

2026-11-17 重新核對的既有 Draft heads：#670 `74f75bd916bddb29fcaba4743ab33e67caa97e30`、#678 `42d9a3848f49c4364a259e78aadbb5e70b236cfc`、#680 `729406d1a9641d783b39dea8c79a6abac84abad4`、#681 `d4db45d1d51d42397c12397ef059f11846e5fdb9`。它們的 CI 與 CodeQL 均成功。

#681 的 [Maestro run 44054022961](https://github.com/Miiduoa/graduation/actions/runs/44054022961) 已完成成功；check-run 的 `head_sha` 也等於上述 `d4db45d…`。#631 `0c60b233…` 的 [Maestro run 44052894571](https://github.com/Miiduoa/graduation/actions/runs/44052894571) 同樣已成功，沒有沿用舊 in-progress 或舊版結果。本輪沒有取消、重跑或弱化這些檢查。

前一批 #670／#678／#680／#681 與 #631 的獨立審查、Functions／Firestore emulator 及合併驗證紀錄仍保存在本機 integration 分支。該份完整整合報告尚未推送，不能當作可分享的 GitHub 證據。本批的實際測試結果與獨立審查將記錄於此文件及 Draft PR。

App `5504170` 的必要核准、正式帳號及實機驗收仍屬獨立門檻；本批不合併、不部署，也不修改 gate。

## 本批驗證

開發提交 `1f88a2e5` 合入 main `0fdee84e7cd2eca2fa49efd9477b24dd516e1c7c` 後，測試程式版本為 `1d5c17917c910f40a9c2214bd0dca770ba159e8b`。main 合併沒有衝突。

| 範圍 | 實際結果 |
| --- | --- |
| 原版回歸 | 首頁找不到復原按鈕：1 failed、41 skipped。原 handler 不接受 recovery：22 failed；其中原提案的 missing 成功情境後來撤除，最終明確拒絕 missing。 |
| 新復原測試 | Handler 33、實際 adapter 3、UI 新增 29；真 adapter 包含 principal，規劃 8 次、確認 10 次 API，沒有提高既有 12 次上限。 |
| main + 本功能 Web Agent／Today／career 聚合 | 126 files、2,715 passed。此為指定範圍，非完整 Web suite。 |
| main + 本功能 Mobile Agent／career | 6 suites、89 passed。 |
| 服務流程 | 56 passed；workflow／career contract 6 passed。 |
| Chromium 合成瀏覽器 | 11 passed，原 6 情境保留，新 5 情境涵蓋手機／桌面、唯一確認、取消重試、重新載入、回應遺失及帳號切換。0 page errors／外部請求／request failures。 |
| 型別與 lint | Web 型別檢查通過；變更的 fixture lint、Python syntax、bundle、diff-check 通過。 |

另外在本機整合分支，以 `0037b76c9032c24b7d22d07e2175af1523cf47fd` 實際結合 #670／#678／#680／#681 與上述 main、#631、新功能，無新增衝突：完整 Functions **152 suites／2,749 passed**、Firestore Agent emulator **106 passed**、Web 指定聚合 **127 files／2,726 passed**、Mobile 指定聚合 **9 suites／124 passed**。Web／Mobile／shared typecheck 均通過；Functions／Web／Mobile／shared lint 各有既有警告 4／212／585／2，均 0 errors。emulator 已停止。

獨立 reviewer 自行讀碼並執行 focused suites 及額外反例，沒有本功能的阻擋 finding。開發中處理了實際 adapter 重讀超額風險、舊 generic-study policy 降低新 gap 檢查的風險，以及長標題造成確認 token 超出瀏覽器 2048 字元上限的風險。現在原安排限定 coursework-gap，guard 只簽完整原紀錄的 hash；最大合法 ID／中文標題及第二代復原有持久回歸。

額外對未修改的 `scripts/qa/today-agent/build.mjs` 單獨 lint，仍遇其既有 `console/no-undef`；未把這項失敗改稱通過。適用套件 lint 與修改的 fixture lint 如上。正式帳號、正式寫入、真人操作與實機驗收沒有執行；本批遠端完整 CI 必須以 Draft PR 的最終 SHA 為準。

## #672 額外整合限制

#672 不是本功能執行的必要依賴。額外本機合併實際遇到 `TodayAgentPanel.tsx` 衝突：若直接保留 #672 的 taskPicker 區塊，會漏傳 recovery callback，合併測試曾有 2 failed／46 passed。解析時兩個追蹤呈現入口都必須呼叫本批 `arrangement(row)`。

獨立 reviewer 另發現 #631＋#672 的 **P1 相依阻擋**：#672 將 career 加入 `ASSISTANT_SERVICES`，而 #631 的 `capabilityDescriptions` 沒有對應項目，導致 TypeScript TS1360／TS7053，執行時也可能讀取 `undefined.modes`。本機隔離整合提交 `9463ed5ca1ff4be24631f47f6dbcd2a8c02707fe`（parents：本批 `1d5c17917c910f40a9c2214bd0dca770ba159e8b` 與 #672 `f3d1f28f4f973becabba0275dafb95da972733f2`）已修正 callback 合併遺失，並補最小 career handoff 描述與回歸，沒有新增代理權限。修正後 4 suites／182 tests、shared capability 17 tests、Web／shared typecheck、修改的 UI lint 及 diff checks 通過。未修改或推送 #672；其正式合併前仍須移植這些相容修正，不能當作正式分支 blocker 已解。完整本機整合 commits、logs、screenshots 目前未推送；此文件是可分享的結果摘要，不是正式服務驗收。
## 2026-11-19 同步 main（PR #682）

整合 main `bb61b1fa64dfea624bcd72f1c9f76e28f6c8ef8b`，保留工作情境、既有訂單取餐行程、原生 Tab 焦點修正及其回歸。課業復原、公開來源與跨服務接續共用入口合併；簽章卡片分別保留取餐、活動與課業復原的來源限制。學生情境保留本分支既有工具，教師的下一堂課問題仍沿用 main 的個人課表路徑。較舊的 Tab 攔截斷言改為驗證原生焦點轉移、可讀性及位置穩定，未移除 main 測試。

本地驗證結果：

- Web 助理／assistantV2／Today：151 個檔案、3,066 項測試通過，包含課業復原 handler 及實際 adapter。
- Shared 助理服務、任務、工作情境、學務摘要與執行契約：232 項通過；離線助理 CLI：4 項通過。
- Mobile 跨服務：1 suite、10 項通過。
- Chromium 合成瀏覽器：行程修改 44 個情境、Today／課業復原 11 個情境通過；包含取餐行程及重新載入。
- Web／shared 型別檢查、修改的 Web 檔案 lint、Python syntax 與 git diff 檢查通過。

測試使用目前環境 Node 24.22.1；套件宣告 Node 22，執行時有 engine 警告。瀏覽器使用合成 API／帳號資料，未執行正式寫入、部署或推送。

