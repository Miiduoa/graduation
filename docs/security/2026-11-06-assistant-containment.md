# 校園助理授權中止與逾時取消

日期：2026-11-06（台灣時間）。接續 PR #518，原始版本為 `c9fde7a813b20f16b66dd1517e2bc21513251ebe`。

## 這次解決的問題

上一版在整批工具完成後才處理授權拒絕。`Promise.all` 已啟動其他工具，因此第一個工具回報沒有權限時，後面的讀取或寫入仍可能完成。前置課表、作業、公告與摘要的讀取也把授權拒絕當成一般資料來源故障，繼續進入模型。

另一條路徑使用 `Promise.race` 顯示模型逾時，但沒有取消背景工作。慢回應可能在請求結束後啟動工具，或把答案寫入下一輪可讀取的對話。

本輪保留模型、工具、使用者確認與資料庫各自的職責。後端收到明確的授權拒絕，就自行中止這次執行；不再請另一個模型判斷是否應繼續。

## 執行規則

| 情境 | 現在的行為 |
| --- | --- |
| 模型要求本輪未公開的工具 | 先檢查整個有上限的批次，任何名稱不符就整批拒絕，沒有工具被啟動。 |
| 工具拋出 `permission-denied` 或 `unauthenticated` | 立即停止後續工具與模型回合，回傳固定的安全說明。 |
| 工具回傳明確失敗收據 | 僅在 `success === false`，且錯誤碼是既定授權拒絕碼時中止，不依據文件內容或錯誤訊息關鍵字判斷。 |
| 前置讀取、摘要或 core 發現授權拒絕 | 結束本輪，不進入後續讀取、模型、回答評分或建議佇列。 |
| 資料來源暫時不可用 | 保留其他可取得的資料，沿用既有重試與部分資料回覆。 |
| 權限中止後的執行紀錄 | 保留工具名稱、時間及固定原因，清除參數和先前資料輸出；`agentRuns.status` 為 `blocked`，沒有可確認的寫入提案。 |
| 下一次合法請求 | 重新核對該次權限，正常執行；不因前次被拒絕而永久封鎖帳號。 |
| 模型逾時 | 取消此次模型工作的訊號，停止後續工具、provider 重試／切換及最終整理；晚回的模型答案不再開始寫入對話。 |

明確的失敗收據包含 `permission-denied`、`unauthenticated`、`role_denied`、`assistant_write_permission_denied`。報修詳情工具保留原有 `found`／`forbidden` 相容欄位，補上此失敗契約。查無資料維持一般的 `found: false`。

模型工具批次仍有每輪 8 個的上限，須本人確認的工具仍由既有確認入口執行。工具及前置讀取改成循序等待；相較同時讀取，延遲可能增加。這個取捨確保前一個工具尚未完成權限核對時，後一個工具不會先開始。

## 防止錯誤吞掉中止訊號

`executeCampusAssistantCore` 的借閱、請假狀態、報修詳情／清單和模型組裝原本各有一般錯誤備援。本輪讓確定的授權錯誤先向 runtime 傳遞，再由共同入口中止，避免它被當作「暫時沒資料」或把原始錯誤內容放入回覆。

runtime 記錄 `security_containment` 事件與固定原因 `authorization_denied`。模型批次或前置讀取中止時，先前取得的內容也不再留在本次可讀取的執行軌跡。對話儲存仍只使用後端建立、綁定帳號及學校的紀錄。

## 取消訊號的範圍

core 為每次模型工作建立 `AbortController`。訊號經過 compose、模型工具迴圈和 provider transport；每次等待結束、啟動下一個工具或重試前，都再次檢查。provider 忽略取消而晚回時，丟棄結果並關閉未讀的 response body。重試的 timer 與 listener 會清理。

取消不能撤回已經送出的 Firestore 寫入，也不能回滾先前已完成的工具。對話儲存若在期限前已開始提交，也可能在期限後完成。測試保證的是晚回結果不再啟動下一步，並非分散式交易回滾。

## 驗證與可重現方式

新增測試保留實際工具註冊、Zod 輸入解析、權限 reader、角色檢查與訂餐草稿程式，只替換模型 transport 和 Firestore 的合成資料。兩個案例在原始 `c9fde7a8` 都重現後續工具被呼叫，在修補版都通過：

1. 學生角色要求教師題庫草稿時，實際工具回傳 `role_denied`，後面的菜單工具不得執行。
2. 下單工具已公開給模型後，使用者關閉權限；工具重新讀取設定時拒絕，後續工具停止。重新授權後的新請求可以建立草稿，不直接建立訂單。

其他回歸涵蓋權限中止後的安全回覆與稽核、正常查無資料、一般資料來源故障、逾時後的晚回工具／模型、取消 429 重試、停止 provider 備援，以及晚回答案不能寫入可重播對話。

同步 main `6fd652c706d11d3e3ea189d41c5bcbbdd7c8cff2` 後，本機助理相關回歸共 **47 組、565 項通過**，沒有略過項目；變更的 JavaScript 通過 ESLint，workflow YAML 和 `git diff --check` 通過。離線演練 7/7 執行通過，包含下述仍為 0/12 的陌生措辭診斷。

將新增的批次、取消與真實工具測試放回 `c9fde7a8`，選定的 9 個拒絕／取消案例皆失敗；前置 runtime 對照另有 6 個失敗及 1 個正常故障恢復通過。這些是測試情境數量，不是 15 個獨立漏洞。

本機測試使用 Node 22.23.4、移除真實憑證環境，並由 seccomp 阻擋網路 socket。沒有連線正式校務服務、模型 API 或資料庫。遠端完整 CI 另以推送後的精確 head 為準。

在已安裝專案依賴並編譯 shared 的隔離測試環境，可執行：

```sh
pnpm --filter functions run build:shared
pnpm --filter functions exec jest --runInBand --runTestsByPath \
  assistantAgent.toolDispatch.test.js \
  assistantAgent.authorization.integration.test.js \
  assistantAgent.cancellation.test.js \
  agent/runtime.containment.test.js \
  agent/executeCampusAssistantCore.sources.test.js \
  agent/tools/getDormRepairStatus.test.js
node scripts/security/assistant-defense-drill.test.cjs
```

攻防演練 workflow 的變更監看新增實際 dispatcher、compose 與對話儲存入口。完整 Functions CI 會執行新增的工具和 runtime 回歸。

## 已知限制與發布條件

- 這是校園助理單次工作的自動中止，不是整站 WAF、DDoS 防護、帳號自動封鎖、全域撤銷權杖或正式環境自動修補部署。
- 現有離線紅隊依固定變形與回饋搜尋，最多 36 次查詢；不是向外部網站發動攻擊。本輪沒有修改文字分類器或其 fixture。第二批陌生語意仍為 0/12 攔截，演練成功不代表未知提示注入都已被識別。
- 防禦層依賴工具傳出的明確授權拒絕。工具內部若自行吞掉拒絕或錯誤地回傳成功，仍需在該工具修補。這也不是所有工具都有即時、交易式校籍撤銷檢查的證據。
- 稽核寫入屬盡力而為；資料庫不可用時仍會阻擋動作，但尚無 durable outbox，不能保證事件一定持久保存。
- 既有合併規則要求指定 GitHub App 的 `審查通過`。本機測試、一般 CI 或 CodeQL 成功都不取代這項檢查，也不等同正式部署或真實攻擊驗收。

設計依據可對照 [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)：授權在執行元件檢查、工具採最小權限、對話和稽核避免保留敏感資料、對工具濫用及權限繞過進行對抗測試。
