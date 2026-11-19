# 訂餐交易內核對帳號狀態

## 問題與依賴

此提交接續 Draft PR #670 的 `1bee67eaa3dc344e1f95d19e6dc716abfda1f05b`，保留完整借閱來源、指定書目、確認版本及共用服務交易帳號防護。本輪補上一般訂餐 callable 與 Agent `createOrder` 共用的 `backend/functions/createOrder.js`。

舊建單交易只讀去重 key、校籍、正式訂單與鏡像，完全不讀 root account。即使 admission／Agent claim 後帳號停用或刪除，仍會建立訂單、鏡像、去重 key，並繼續給號碼。成功訂單的重送還會修復鏡像；商家拒絕時則會寫 rejected key，因此不能只在新建訂單分支補檢查。

修改前刷新 main `2d7f65484acc5059cd9a9e84c361ade0ede29f5d`、#670 head 與當時 22 個 open PR。所有遠端分支的 createOrder、Agent 訂餐 tool、queueNumber 與 executeAgentWrite 均無本輪同範圍修補；#631 最新 `e5e7b0f9e4da56c4a2dd97010b4ce82d9b75feec` 的跨功能改動也未修改這些檔案。沒有覆寫其他分支。

## 修補契約

- 在原有建單 transaction 的初次 `getAll` 讀取 `users/{uid}`，使用既有 `accountLifecycle.isAccountUnavailable`。禁用值及刪除旗標與其他 Agent／一般服務一致。
- 判斷位於所有 key 分支、鏡像修復、拒絕結果記錄與正式建單之前；讀取失敗直接中止，不轉成空 profile，不呼叫後續給號流程。
- 保留既有有效校籍、商家、菜單價格、去重、收據驗證及新帳號／legacy profile 語意。成功讀取到不存在的 profile 仍依既有模型處理；讀取本身失敗則停止。
- 帳號錯誤不含 `orderOutcome: not_created`，避免已有成功訂單的重送被誤報成沒有訂單。重新啟用後，原先商家拒絕 key 仍保留原結果；新內容須使用新的已確認 requestId。
- Agent tool 依既有契約回傳 `success:false`，claim 標示 failed、不產生成功 receipt，不能重播原確認。本輪沒有放寬 proposal、校籍或助理權限。

## 實際驗證

使用 Node 22.23.5、Functions 鎖定依賴與合成 fixture；emulator 限 `127.0.0.1:18771`、`demo-campus-agent-write-transactions`，只建立合成 onsite／pending 訂單。沒有實際訂餐、扣款、外部付款呼叫或正式資料操作。測試後 emulator 已停止。

| 檢查 | 結果 |
| --- | --- |
| 舊版真實 callable 新回歸 | 12 failed、3 passed，重現 claim 後六種停用／讀取失敗情境的新建及重送錯誤 |
| 舊版 Firestore emulator 新回歸 | 7 failed、3 passed；執行前 createOrder blob 為 `d860e90bc1a263896b8cb6f16962a18e6f087906` |
| 舊版 service 新回歸 | 19 failed、48 passed；其中 3 項正常控制僅缺交易內帳號讀取契約，並非正常訂餐失敗 |
| 修補後完整 Functions（shared build、parse5 smoke） | 148 suites、2,553 tests passed |
| 修補後完整 Agent Firestore emulator | 44 passed、0 failed |
| Functions lint | passed：0 errors、4 個既有 index.js warnings |
| shared typecheck、git diff --check | passed |

新增 15 個 callable、19 個 service Jest 案例與 10 個 emulator 案例。真實 callable 的 admission、claim、registry、訂餐 writer、queue 與 receipt 邏輯保留，只替換資料庫 transport。Emulator 在真正 claim transaction 提交後才改帳號，對讀取失敗只攔 SDK account read；拒絕後比對訂單、鏡像、去重 key、queue counters、付款資料與菜單的內容及 updateTime，均沒有變動。控制案例驗證正常／legacy／missing profile 完成同價訂單、鏡像與號碼，沒有扣款或修改菜單。這不等於實際付款流程驗收。

## 保留限制

正常帳號已成功 commit 的訂單，不會因後來停用而回滾；既有 commit 後獨立 system 給號流程不在本輪改造範圍。本輪不涵蓋取消訂單、宿舍報修、測驗提交與出席確認等其他寫入路徑，也不宣稱所有 Agent 操作都已有交易內帳號防護。

本機完整 monorepo、UI／瀏覽器／Maestro／實機及正式服務驗收未執行。新 head 的 CI 必須另行核對，不沿用 `1bee67ea` 的結果。PR 保持 Draft，仍待 nuni-merge-gate App 5504170 核准；未合併、未部署、未修改 gate 或正式帳號權限。
