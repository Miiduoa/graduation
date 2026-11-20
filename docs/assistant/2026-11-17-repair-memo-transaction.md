# 報修備忘確認期間撤權的交易防護

## 使用者行為與修補

使用者確認「存成報修備忘」後，既有 `executeAgentWrite` 先核對帳號、校籍、助理寫入設定與伺服器提案，再取得防重 claim。原本 `createDormRepairRequest` 接著直接 `.add()`，因此 claim 成立後撤銷上述資格，仍會建立備忘並回傳成功。

修補將當前使用者 profile、所選學校 membership 與 `assistantPermissions` 的讀取，和 `repairRequests` 建立放在同一個 Firestore transaction。使用 main 現有 `isAccountUnavailable` 與助理權限定義；停用、刪除標記、撤銷校籍、關閉或缺少報修授權、來源讀取失敗均不得提交備忘。交易重試必須重讀三個來源，只有確認提交後才回傳原有成功回執。

保留 main 的新帳號／legacy profile 語意：缺少 profile 本身不等於帳號已刪除；仍必須有有效校籍、明確報修授權與本人有效提案。沒有擴張跨帳號、跨校或角色權限。

這仍是應用內的個人備忘，不會送到學校。成功欄位維持 `success`、`repairId`、`requestId`、`status: pending`、`dormitory`、`room`，內部識別不是校方單號。保留失敗 envelope 和既有不確定回執提示；提交回應遺失不代表必然沒有寫入，不能自動重新送出。已嘗試 claim 的重複確認仍被阻擋，使用者應先查看備忘紀錄。

## 獨立基底與範圍

- 開發基底：main `dac303783f572b00ac356d5c7ba6957ab2afa0d4`。
- #631 `0c60b2333f9e8e01e0cf18460b698d7e568b9a97` 不在此基底血緣內；其相對共同基底的 119 個變更路徑沒有 backend，也沒有根 `package.json`。
- 本次修改的兩個既有檔案在 main 和 #631 的內容原本完全相同；其餘為新的回歸檔與本文件。沒有從 #631、#682、#683、#684、#689 移植或複製功能。
- 選題時核對全部 open PR 的完整檔案清單，沒有其他 PR 修改 `createDormRepairRequest.js`。#670／#678／#680／#681 保護的服務、借閱與訂餐交易沒有涵蓋此工具；#690 是座位確認。既有 #626 已合併，僅涉及宿舍雲端紀錄入口，未修改此工具。發布前再查新增 #691／#692／#693 與更新的 #668 完整 diff，均無本次路徑重疊。
- 只修此 Agent 報修工具；不聲稱所有 Agent 寫入均已有同等保護，不更改其他 PR、正式資料、門檻或部署。

## 可重現驗證

`agent/handlers/executeAgentWrite.repair.test.js` 保留真 callable、registry、提案比對、claim、權限函式與工具，僅替換 Firebase transport，並支援原本 `.add()` 的真實寫入語意。於 claim 提交後才注入撤權，避免只測入口檢查。修改前最終 26 項為 17 failed／9 passed：16 項證明撤權、來源或提交故障仍留下備忘；另 1 項證明正常寫入未在交易內讀取權限。修補後 26 項通過；依獨立 reviewer 建議再補兩個工具授權隔離控制，最終 focused 28 項通過。

`agentRepairWrites.emulator.cjs` 只允許明確 localhost emulator 與固定 demo project，使用真 callable、Firestore claim、文件及 SDK transaction runner。來源失敗與 gRPC ABORTED 為測試注入；不是正式校務資料或真實外部服務故障。案例包含 claim 後撤權、交易重試重新讀取授權、staged write 回滾、重複確認、跨帳號／校別與提案竄改、正常回執。修補後 22 項通過，另外既有 Agent／transactional writes emulator 共 49 項通過。根 `test:rules` 已納入此檔，因此現有 CI 的完整 emulator gate 會執行。

本機使用 Node 22.23.4、pnpm 10.28.2 與既有依賴快取；專案要求的 Node 22.23.5 及 frozen lockfile 矩陣須以新提交的 CI 驗證。完整 Functions 144 suites／2,356 項通過（含新回歸），Functions lint 零錯誤、四個既存 warning，shared typecheck 通過。Web 四檔 65 項與 Mobile 三檔 116 項相關既有回歸通過，涵蓋確認／取消、連點、登入／scope 中斷與回執呈現。沒有改動 UI，也沒有以這些 focused tests 宣稱整套前端通過。

初次完整 Functions 在受限 sandbox 因本機 socket `EPERM` 失敗；同一程式取得本機 socket 權限後完整通過，未移除測試、放寬 timeout 或降低 gate。實機、正式帳號與校方送件不在本次驗證範圍。PR 維持 Draft，合併仍需指定 App 5504170 與原有全部門檻。

獨立 reviewer 實際檢查 production diff、既有權限模型、交易／回執邊界及 #631 血緣，未發現 blocking finding；提出的兩項工具授權隔離測試已加入。另一 reviewer 只讀核對 emulator hook 與 Firestore SDK 的 ABORTED／rollback 行為，未發現阻擋問題。這些程式審查不等於 GitHub 指定 App 核准。
