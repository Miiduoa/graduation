# 訂單成立後的取消、狀態變更與給號交易

## 基底、批次與 CI 隔離

本批次由已完成驗證的 #670 head `74f75bd916bddb29fcaba4743ab33e67caa97e30` 建立獨立 worktree／分支 `fix/order-action-transaction-guards-20261117`。#670 原分支保持不動；直到該 SHA 的 [CI #44044326456](https://github.com/Miiduoa/graduation/actions/runs/44044326456) 與 [CodeQL #44044326416](https://github.com/Miiduoa/graduation/actions/runs/44044326416) 均 completed/success 才準備推送。Course access review、prompt-injection drill 也成功，Preview skipped。

這是相依的獨立 Draft PR：包含 #670 的基底提交，目標仍為 main，以執行完整 PR CI／CodeQL；在 #670 合併前，review 應比較 `74f75bd9...本分支` 的新增批次。沒有把這批工作追加至 #670，也沒有重寫其歷史。修改前 main 為 `2d7f65484acc5059cd9a9e84c361ade0ede29f5d`；當時 22 個 open PR，所有遠端分支的 cancelOrder、orderTransitions 與 queueNumber 相同，沒有其他同範圍修補。

已檢查 workflow：CI concurrency 為 workflow＋github.ref，Preview 為 PR number；新 PR 的 ref／number 與 #670 不同。CodeQL、Course access 與 prompt drill 沒有跨 PR 的取消群組。新分支 push 不符合 CI 的 main/develop push 條件，開 Draft PR 才執行對應 PR checks；不加 preview label、不修改 gate、不啟動部署。

## 共同安全邊界

本批只處理「既有訂單的後續寫入」：取消、商家／管理員狀態變更、給號與已有號碼重播。Agent 取消原本分別 update 正式訂單與 set 鏡像，鏡像失敗會留下分裂狀態；其來源讀取與寫入間也沒有交易保護。一般訂單狀態與給號雖有交易，仍沒有在交易內重讀帳號。

- Agent `cancelOrder` 改委派 `createOrderStatusHandlers.cancelOrder`，與一般取消共用校籍、本人訂單、有效狀態及原子寫入。交易中來源變更或 commit 失敗，不能留下半筆取消。維持原始 input.orderId 作 receipt 比對，避免正規化後已成功卻被 Agent 誤報。
- `orderTransitions` 在初次 transaction.getAll 讀取操作人的 root account，重用 `isAccountUnavailable`，先於任何正式訂單／鏡像寫入及通知。customer、operator、admin 的原有授權規則保留。
- `assignNumberForOrder` 完成既有角色授權後，在同一交易讀取帳號，先於既有號碼分支、counter、鏡像或訂單狀態寫入；來源錯誤直接中止，不轉為空 profile。

| 給號情境 | 交易內檢查的 root account |
| --- | --- |
| 本人手動取號 | 已符合訂單所有權的 caller |
| 店員給號／接單 | 已符合店家 operator 授權的 caller |
| createOrder commit 後的內部 system 給號 | 正式訂單的 canonical buyer，拒絕無效 owner |

客戶端不能用 `as: system` 取得內部 system 角色。有效店員仍可處理停用買方的既有訂單，沒有改成拿買方狀態取代店員授權。新帳號／legacy 無 status／missing profile 的既有語意也保留；讀取本身失敗則拒絕。

正常取消會以正式收據完整同步鏡像、清除使用中的號碼並保留已取消號碼。再次取消不覆寫原取消原因與時間；有效的鏡像修復仍在同一交易。付款、退款與庫存規則沒有增加或改寫。

整批覆核另重現舊取消資料殘留 queueNumber 的問題：已有號碼分支會把 cancelled 訂單的 queueStatus 改回 assigned。本批也在已有號碼分支前拒絕 cancelled 訂單，禁止復活取消號碼；completed 訂單既有歷史號碼的重播語意則保留，並加相容控制案例。

若訂單已在有效帳號下 commit，之後才停用而使 system 給號被拒絕，原訂單與鏡像保持真實的 pending 狀態，回覆仍是「訂單成立、號碼待確認」；不能把已成立訂單誤報為未成立，也不消耗號碼。

## 真實結果

使用 Node 22.23.5、鎖定 Functions 依賴、合成資料與本機 demo emulator。沒有真實訂餐、取消、付款或正式資料操作。

| 檢查 | 實際結果 |
| --- | --- |
| 固定 #670 原始 SHA，加初批 emulator 回歸 | 28 failed、49 passed，共 77；確認舊取消／給號契約缺口 |
| 修補前給號 focused | 27 failed、11 passed |
| 取消殘留號碼補充回歸，修補前 | 6 failed、41 passed；completed 歷史號碼控制正常 |
| 修補前取消／狀態 focused | 65 failed、102 passed；另一次缺 generated/shared 的環境錯誤已排除，不計為 regression |
| 修補前建單後給號 focused | 9 failed、64 passed，其中 3 項是新增 queue 帳號讀取次數契約 |
| 修補後完整 Functions（含 shared build、parse5 smoke） | 150 suites、2,679 tests passed |
| 修補後完整 Agent Firestore emulator | 79 passed、0 failed |
| Functions lint | 0 errors、4 個既有 index.js warnings |
| shared typecheck、git diff --check | passed |

新增 126 個 Jest 與 35 個 emulator 案例，涵蓋 claim 後／transaction 前停用、刪除旗標、來源不可讀、狀態變更、重播、正常相容與 commit 失敗。Emulator 對拒絕前後的資料及 updateTime 比對，並在真正 transaction callback 已暫存寫入、尚未 commit 時注入 abort，驗證兩份收據不會部分更新。建單後案例在建單 transaction 已 commit、給號 transaction 尚未開始的明確界線改變帳號。所有攔截只在測試 SDK，沒有 production 測試後門。

Emulator 限 `127.0.0.1:18773`、`demo-campus-agent-write-transactions`，已停止。前序 #670 與本批全部測試一併執行，但新提交的遠端 CI 仍須核對新 SHA，不能沿用 #670 的綠燈。

## 尚未驗收

未在本機執行完整 monorepo、UI／瀏覽器／Maestro／實機與正式服務驗收。本批未改 UI，沒有驗證新錯誤逐字顯示。宿舍報修、測驗提交、出席確認等其他 Agent 寫入不在本批範圍，不宣稱所有工具已原子化。

本批及 #670 均維持 Draft；指定 nuni-merge-gate App 5504170 核准仍待取得，不合併、不部署、不修改正式帳號或權限。
