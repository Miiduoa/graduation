# 在服務交易內重新核對帳號狀態

## 問題與範圍

此提交接續 Draft PR #670 的 `7479d6a0d102b723e6e36bdda0fa1e5f4f273a8c`，保留完整借閱來源、指定書目選擇與確認版本三項修補。準備／執行 Agent 的入口會拒絕已停用帳號，但 `executeAgentWrite` 成功 claim 後，服務交易中的 `readServiceActor` 只檢查刪除旗標及 `deleted`。帳號在兩者之間改為 `disabled`、`suspended` 或 `inactive`，仍能續借／還書並回傳成功。

新 Jest 回歸保留實際 admission、proposal claim、registry、writer 與 receipt 檢查，只以記憶體 transport 代替 Firestore。測試在真實 claim 邏輯提交後才改帳號，舊 head 得到 6 failed、12 passed；失敗正是三種停用狀態各自仍可續借及還書。

本輪核對 main `2d7f65484acc5059cd9a9e84c361ade0ede29f5d` 與當時 22 個 open PR；遠端分支的 service guard、確認 handler 與 leaveRequests 沒有其他同範圍修補。#631 仍有 Agent core 的跨功能改動，本輪不修改 core；#671 的帳號刪除集合清理也不受覆寫。兩個較舊分支尚未有 `isAccountUnavailable` 匯出，整合時應保留目前 main 的共用 helper。

## 既有權限模型與修正

- `accountLifecycle.isAccountUnavailable` 是現有入口的共用帳號判斷：拒絕 `accountDeletionInProgress === true`、`deleted`、`disabled`、`suspended`、`inactive`。服務交易與請假的 `activeMember` 改用相同判斷。
- 狀態來自 `users/{uid}`，在真正寫入的同一個 Firestore 交易內重讀。沒有增加一次前置查詢來取代交易檢查，也沒有測試用 production hook。
- Firestore users 規則禁止客戶端寫入或移除上述狀態欄位；帳號刪除流程先保存刪除中標記，最後保存 `deleted` tombstone。本輪沒有變更狀態來源、帳號、權限或 rules。
- 保留原有新帳號／舊資料模型：root profile 不存在或沒有 status，只要符合既有有效校籍規則，仍可使用服務。這是成功讀取到不存在的紀錄；若帳號讀取本身失敗，例外不會被轉成空 profile，而會中止交易。沒有要求所有歷史帳號新增 `status: active`。
- 停用後的 Agent 嘗試不改服務資料、不產生成功回條，既有 claim 標示 unverified 並保留已嘗試紀錄；重新啟用也不能重播原確認。
- shared guard 涵蓋借書、續借、還書、座位預約、洗衣預約與一般洗衣取消。請假共用檢查涵蓋提交、撤回、審核與檢視資格；原有校籍與審核權限規則不變。

## 驗證與限制

測試只使用合成資料與本機 `demo-campus-agent-write-transactions`。Emulator 在真正 claim transaction 提交後才改帳號，再允許 callable 進入服務交易；帳號讀取失敗案例只在 SDK transport 的 account read 注入錯誤。拒絕案例比較服務文件內容與 `updateTime`，包含借閱、鏡像、庫存、座位預約與服務鎖。

| 檢查 | 實際結果 |
| --- | --- |
| 修補前 claim 後帳號變更回歸 | 6 failed、12 passed，重現三種停用狀態仍續借／還書 |
| 修補前請假狀態回歸 | 12 failed、21 passed，重現提交／撤回／審核及審核清單未拒絕停用 |
| 修補後完整 Functions，含 shared build、parse5 smoke | 147 suites、2,519 tests passed |
| 本機 Firestore emulator 全部 Agent 交易測試 | 34 passed、0 failed |
| Functions lint | passed：0 errors、4 個既有 index.js warnings |
| shared typecheck、git diff --check | passed |

新增 18 個 callable、24 個請假 Jest 案例，以及 16 個 emulator 案例。使用 Node 22.23.5 與鎖定 Functions 依賴。Emulator 使用英文 Java locale、限定 `127.0.0.1:18771`，測試後已停止。本輪修補後沒有失敗的適用測試；修補前的失敗是回歸證據，不能記成新版失敗。

本輪未修改 UI，未執行瀏覽器／Maestro／實機或正式資料驗收。這項修補不代表所有 Agent 工具都已有交易內帳號驗證：訂單建立仍需補交易 actor 查核；取消訂單、宿舍報修、測驗提交與出席確認使用其他非原子寫入路徑，應另行改造及驗證，不能只新增事前檢查。

PR 保持 Draft，不合併、不部署、不降低門檻。新 head 的 CI 必須單獨核對，仍需 nuni-merge-gate App 5504170 核准。
