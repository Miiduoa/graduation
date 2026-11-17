# 借閱確認必須綁定已核對的來源

## 問題與相依

本輪接續 Draft PR #670 的 `2d61ab630543dc1b96b090ad9aec0ed7cbb5a299`，保留完整來源讀取與指定書目選擇的修補。舊版確認只保存 `loanId`：即使確認後正式借閱的書籍被更換，仍會續借／歸還新書；若使用者先從一般圖書館頁續借一次，舊 Agent 確認也會再消耗第二次續借。個人借閱鏡像不能作為正式寫入的唯一依據。

以舊 head 的實際 callable、權限、proposal claim、registry、writer 與 receipt 邏輯搭配記憶體資料庫 transport 重現：新回歸 11 項中 7 failed、4 passed。失敗包含續借／還書各自接受已改變的 bookId 或書名、一般續借後仍接受舊確認，以及兩種無來源版本的舊草稿。

提交前刷新 main 為 `0a8066cc4370a902fdbbcd725f9995f688d6bb1b`；相較本分支起點 `e71bccf0`，新增的是宿舍／社團 UI 與共享資料功能。當時 23 個 open PR，已比較遠端分支的借閱 writers、確認 handler、proposal 與 service guard；沒有其他來源版本修補。#631 仍修改同一 core 檔案的跨功能流程，整合時需保留雙方行為。#670 reviews 與 review threads 當時皆空，沒有指定 App 核准。

## 行為

- 建立確認前讀取目前學校 `libraryLoans/{loanId}` 正式紀錄，核對借閱人與有效狀態。鏡像選出的書籍、期限、借閱時間、狀態或續借次數若與正式資料不同，請使用者重新查詢，不產生確認。
- 明確借閱編號直接讀取該正式紀錄，仍支援超過 500 筆歷史資料的精確操作；找不到、他人紀錄、已歸還與讀取失敗均不產生確認，也不洩露他人書名。
- 共用 `projectLibraryLoan` 處理 reader、確認內容與版本資料，避免時間格式或舊欄位 fallback 不一致。以已核對欄位產生 `expectedLoanVersion`，保存在原有 proposal input；客戶端不能移除或替換。
- 續借／還書在同一 Firestore 交易中，核對正式借閱人後、任何服務資料寫入前重新比較版本。版本不同或舊 Agent 草稿沒有版本，回傳 `failed-precondition`，不改借閱、鏡像、庫存或服務鎖，也不產生成功收據。依既有單次 claim 設計，該確認標示 unverified，必須重新查詢產生新草稿。
- 一般圖書館 callable 沒有 Agent action key，未帶版本仍維持既有流程；若明確帶版本則同樣核對。版本雜湊只作資料比較，沒有替代帳號、學校、來源 proposal 或權限檢查。
- 模型工具清單本來就排除需要確認的寫入工具；版本由 deterministic core 產生，不交由模型猜測。

## 驗證

使用 Node 22.23.5、Functions 鎖定依賴與合成資料；沒有呼叫付費模型或連線正式資料。

| 檢查 | 實際結果 |
| --- | --- |
| 舊版 callable 回歸 | 7 failed、4 passed，重現上述錯誤 |
| 修補後完整 Functions（含 shared runtime build、parse5 smoke） | 146 suites、2,477 tests passed |
| 本機 Firestore emulator `agentWrites.emulator.cjs` | 18 passed、0 failed |
| Functions lint | passed：0 errors、4 個既有 index.js unused-vars warnings |
| shared typecheck | passed |
| git diff --check | passed |

新增 39 個版本／writer 測試、11 個完整 callable 流程測試、7 個 core 準備確認測試，以及 3 個 emulator 交易案例。涵蓋六種來源欄位改變、未變更正常操作、重複確認、移除／替換版本、舊無版本草稿、一般續借介入、鏡像與正式資料不一致、來源失敗及跨帳號／跨校限制。Emulator 比對拒絕前後的資料與 `updateTime`，確認沒有暗中重寫服務資料。

本機 emulator 首次因 Java `zh_TW_#Hant` 缺少 `JValidationMessages_messages`，18 項均在 beforeEach hook 失敗，沒有進入測試內容；使用相同 jar、規則、port 與測試，只加 `-Duser.language=en -Duser.country=US -Duser.script=` 重啟後全部通過。伺服器限於 `127.0.0.1:18771`、`demo-campus-agent-write-transactions`，已停止。

未執行 UI 瀏覽器、Maestro、實機、正式 Firestore／學校官方圖書館驗收；本輪沒有 UI 修改。現有前端會以保守的未確認結果提示檢查服務，並非已驗證顯示伺服器的逐字錯誤訊息。完整 monorepo 測試沒有在本機執行；新 head 的遠端 CI 需另行核對，不能沿用舊 `2d61ab63` 的綠燈。PR 保持 Draft，仍需 nuni-merge-gate App 5504170 核准；未合併、未部署、未修改 gate。
