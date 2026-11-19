# 訂單交易交錯後的可信回執

## 來源、問題與依賴

獨立審查 #678 相對 #670 的增量與 main / #631 整合時，實際重現前存 P2：建單 commit 與給號之間被取消，canonical 已 cancelled，回執卻仍顯示 pending / pending_confirmation；取消後的同 requestId 重送也會錯稱待給號。使用者可能因此等候不存在的取餐工作。

本批基於 #678 `42d9a3848f49c4364a259e78aadbb5e70b236cfc`，間接相依 #670 `74f75bd916bddb29fcaba4743ab33e67caa97e30`。沒有追加原分支或改其提交。已核對 origin refs 的後端、兩端 Agent 卡片及 shared helper：沒有同範圍進行中修補；舊整合分支 Mobile 差異僅在宿舍卡，未覆蓋它。

## 實際修改

- createOrder 對已讀到的 cancelled / completed 重播直接保留終態。取消一律不提供取餐號碼；完成可保留歷史號碼，但無號時也不重新排隊。
- 給號交易回傳的正常狀態不再被舊 pending 覆蓋。舊號碼快速分支同樣先驗證 canonical 身分與狀態。
- 只有交易內完成 actor / account / canonical 驗證的內部 `ClosedOrderError` 可以證明後續終態；createOrder 再核對同 user / school / order。任意文字、details 或仿造欄位不能證明取消。
- 第二位 reviewer 又重現成功給號分支的 buyer 綁定缺口：Alice commit 後 canonical owner 變 Bob，原回執可能拿 Bob 的號碼。已在 system 給號交易綁定 production caller 傳入的 authenticated uid，owner 不符即中止，不發號、不修任何人的鏡像。唯一 production system caller 是 createOrder；公開 callable 不接受 system。
- Web / Mobile Agent 卡片、保存的回執及 Mobile 逾時讀回結果依實際終態顯示「訂單已取消／完成」，不再顯示取餐號、待給號或要求重下。Web callback 保留 optional status。既有 pending / assigned 流程及其他訂單頁不變。
- 未知來源或帳號讀取失敗只保留已真實 commit 的建單事實、給號待確認；不推斷取消，也不誤報 not_created。沒有加入額外服務寫入或付款行為。

## 回歸

- 初始真實 handler Jest：9 failed / 9 passed；增加 malformed canonical 回歸 3 failed / 18 passed；獨立 buyer 綁定回歸 4 failed / 21 passed。最終新 suite 25 cases。
- 固定 #678 baseline emulator 初批 6 failed / 80 passed；另兩個 buyer 改變 emulator 回歸 2/2 failed。使用真實 create/cancel/transition/queue 交易，只替換外部通知 sender，絕不送出真實訊息。
- 測試核對 data / updateTime、counter、canonical、兩個 buyer mirror 與既有付款欄位。訂單先成立才被取消，回執必須反映可信終態，不能假稱從未建單。
- UI red：Web 6 failed / 5 passed、Mobile 8 failed / 7 passed；callback 契約補測先有 5 failed / 6 passed。修補後 Web 11 passed、Mobile 3 suites / 35 passed，三端 typecheck 與 changed-files lint 通過。
- 最終完整 Functions 151 suites / 2704 tests passed；Agent emulator 88/88 passed；shared food 160 passed；Functions lint 0 errors / 4 既有 warnings。遠端結果須以 PR 精確 head 另核對，不能沿用 #678 原 head 綠燈。

## 整合與驗收邊界

本輪另在隔離 integration 合併 main `2d7f6548`、#670 `74f75bd9`、#678 `42d9a384`、#631 `1cdc7d82`，無衝突，合併後完整 Functions 2679 / emulator 79、Web Agent aggregate 2220 / service-flow 56、shared 256、Mobile focused 10 與適用 lint/typecheck 通過。後續 #631 `98d6d6202b70d01ec1583797ff653c5dac0ff8e6` 也無衝突，Web aggregate 2229 passed；它沒有後端訂單／借閱修改。

#631 的 revision-browser 尚有獨立失敗；98d6d620 把舊 native smooth 情境改成診斷 flag，預設 CI 未涵蓋原情境。這是來源分支的驗收限制，沒有修改其測試／門檻或宣稱整合可發布。

本批僅處理收到成功回執時的可信狀態；原 Web watcher 只監聽號碼，不宣稱它能監測回執之後才發生的取消。未跑本機完整 Web/Mobile 全套、瀏覽器或原生實機驗收。所有測試使用合成 fixture / demo emulator，沒有真實訂餐、取消、付款、正式資料操作、合併或部署。Draft 保留 App 5504170 與相依 PR 的必要門檻。
