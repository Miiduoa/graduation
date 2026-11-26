# 借閱 Agent 在交易內重驗助理權限

## 問題與範圍

獨立審查 #670 / #678 / #631 整合版本時，透過實際 callable、registry 與借閱工具重現：`executeAgentWrite` 前置核對權限成功後，一旦 proposal claim 已成立，使用者即使撤銷助理權限、刪除設定或設定來源不可讀，續借／還書仍可能更新服務資料。這是前存安全缺口，不能靠帳號仍 active 或 claim 已 started 視為持續授權。

本分支基於 #670 `74f75bd916bddb29fcaba4743ab33e67caa97e30`；只涵蓋 `borrowBook`、`renewBook`、`returnBook`。修改前逐一比對全部 origin refs，除 #670 及相依 #678 外，沒有相同路徑的權限交易修補。沒有改動來源 PR。

## 行為

- 保留原有 claim 前權限拒絕。
- 三個工具在實際副作用交易內讀取 `users/{uid}/settings/assistantPermissions`，用既有 normalization / tool permission model 核對固定的 server 工具名。
- 只有伺服器驗證 proposal 後加入的 `agentActionKey` 啟用此查核；raw input 不能指定工具權限或覆寫 context。
- 撤銷、缺少、格式不合法或讀取失敗均中止；交易 retry 每次重新讀取，不快取允許結果。loan、mirror、inventory、service guard 不會部分寫入。
- 一般直接服務 callable 維持既有帳號／校籍／所有權授權；取消助理權限不等於禁止本人直接使用圖書館服務。active、legacy 與 missing root profile 的既有 admission 語意保留。
- #670 的來源版本比對、明確書目選取與原子資料更新完整保留。失敗 claim 保持已嘗試，重新開權限不能重播同一確認。

## 回歸與驗證

- 獨立 reviewer 初始 6 個真實 handler 回歸全數失敗；正式新測試涵蓋三工具，修補前 21 failed / 18 passed（15 個實際安全失敗、6 個交易讀取契約）；後續加入 6 個正常帳號對照，共 45 新 Jest cases。
- 固定 #670 baseline 的真實 Firestore emulator：9 failed / 53 passed；三工具各自的撤銷／刪除／讀取失敗確實在 claim commit 後觸發。修補後 62/62 passed。
- Emulator 核對服務 data 與 updateTime 無變更，也檢查 claim、恢復授權後拒絕重播、只撤銷其他工具不影響目前授權、直接 callable 正常使用。
- 完整 Functions 149 suites / 2598 tests passed；Functions lint 0 errors / 4 個既有 warnings；shared typecheck 及 diff check 通過。第一次完整 Functions 因 sandbox 禁止 localhost listener 有 25 項環境失敗，放行本機 fixture 後完整重跑全過。
- 另一位未參與作者的 reviewer 重新閱讀 guard / context / registry / 三工具交易與測試，未發現 blocker；自行執行 5 focused suites / 105 tests passed。遠端 CI 需另核對本批精確 SHA，不能沿用基底綠燈。

## 相依整合與限制

本輪已將 main `2d7f65484acc5059cd9a9e84c361ade0ede29f5d`、#670 `74f75bd9`、#678 `42d9a384`、#631 `1cdc7d82` 正常合至隔離本地 integration `600ff77c98a522cd516dc5e41f0f8510566987ca`，無衝突；完整 Functions 2679、emulator 79、Web Agent aggregate 2220、Web service-flow 56、shared aggregate 256、Mobile focused 10 通過，Functions/Web lint 與三套 typecheck 通過。#631 沒有 Functions 差異，兩條 core 執行鏈及 proposal input 轉交已實際審查。

#631 精確 head 的 revision browser run `44049912119` 仍有 320px Tab focus 額外捲動 11px 的失敗；不以單元 aggregate 覆蓋該來源分支限制。Web 跨功能圖書館仍為 handoff，不宣稱已完成寫入串接。

訂餐、請假、座位、洗衣及其他 Agent 寫入的交易內助理權限撤銷不屬本批。沒有 UI 變更、正式帳號操作、真實訂餐／付款、部署或合併。保持 Draft，相依 #670 及指定 App 5504170 核准仍須完成；原生實機與正式服務尚未驗收。
