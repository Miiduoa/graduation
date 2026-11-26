# nuni：聊天安排接回首頁追蹤

日期：2026-11-24

本增量延續 [AI 工作區設計](2026-11-24-ai-workspace.md) 與 [PR #788](https://github.com/Miiduoa/graduation/pull/788)。目標是讓使用者完成一項安排後，首頁立即接住同一件事，並在中斷後清楚說明還需要做什麼。

## 需要解決的問題

原本從 Today 確認的讀書安排會保留來源追蹤；從聊天確認的相同安排，則在核對行事曆後直接清除 execution journal。首頁無從知道這份作業已安排，仍可能顯示另一張尚未送出的預覽。即使已有追蹤寫入，同一分頁也收不到瀏覽器原生的 `storage` 事件。

另一個問題是完成判準不一致：行程已由伺服器讀回，但本機更新或後續追蹤仍未完成時，部分進度與後續確認仍只看 `status: verified`。

本輪沿用現有的規劃、簽章、回執、journal 與 coursework followup，不建立第二套排程或任務資料。

## 使用者流程

1. 使用者在聊天查詢自己的作業，選擇一份並要求安排準備時間。
2. 系統重新查核原作業、課表與空堂，產生待確認卡片。預覽不等於寫入，模型資料同意不代替操作確認。
3. 使用者明確確認後，保存原操作的恢復紀錄，送出一次行程確認，核對精確的行程回執。
4. 聊天以原 conversation、token、event 與 issued context，向既有 followup 端點唯讀核實課務來源，再保存原安排的追蹤證據。
5. 同分頁的 Today 收到範圍通知後，重新讀取與核對證據，撤下同一份課務尚未送出的預覽，顯示原行程與原作業連結。
6. 後續追蹤失敗時，保留已建立行程的事實與 journal，提供重新核對原操作。修復不重送 confirm，也不自動確認下一張卡片。

「已安排準備時間」與「作業已繳交」維持不同狀態；只有重新查核的課務來源可以表示作業完成。

## 完成與恢復規則

| 情況 | 介面與儲存行為 |
| --- | --- |
| 回執相符、本機已更新、追蹤已接續 | 顯示完成；清除該操作 journal；首頁可接回原安排 |
| 回執相符，但本機更新失敗 | 保留遠端儲存事實、原回執與 journal；提供唯讀核對與更新 |
| 本機已更新，但追蹤讀取或保存失敗 | 保留精確行程連結，以追蹤警告說明問題；不誤稱本機尚未更新；保留 journal |
| 追蹤再次讀取發現行程已變更 | 保留原安排與追蹤，不覆寫；保留警告及重新核對入口 |
| 多張卡片中，前一筆仍有本機或追蹤警告 | 下一張不可確認；可直接核對前一筆；成功後仍須本人確認下一張 |
| 課務追蹤已達 24 筆 | 新課務卡在確認前停止；保存時仍以鎖再次檢查，不刪除其他紀錄換取空間 |
| 預檢後才被另一個操作填滿容量 | 保留已建立的行程及 journal，唯讀重試；不重送寫入 |
| 帳號、session 或校園切換 | 舊讀取不能寫入新範圍，也不能清除原範圍的恢復證據 |
| 一般行程或取餐行程 | 不加入課務追蹤，不承擔課務的 24 筆容量限制 |
| 舊版 journal 沒有課務提示 | 唯讀核實簽章來源；`not_coursework` 不保存追蹤。舊取餐卡沿原 source-bound 路徑，不送課務分類 |

## 實作邊界

- `signCard` 為個人行程輸出有限的 `coursework` 布林提示，只有真正帶 signed study guard 才為 `true`。提示不能提供作業身分或授予寫入權限；後端 followup 仍驗證當前帳號、校園與原始簽章。
- journal 保留 `true`、`false` 與舊版缺省的差異；拒絕非布林資料及對同一操作提示的改寫。既有 `sourceBound: food-pickup` 保持獨立，課務修訂不因此被阻擋。
- `assistantCourseworkTracking` 只做來源讀取與原證據保存。課務身分不能從標題推測，也不依賴容易在修訂或恢復時消失的 turn-level targets。
- 儲存沿用帳號／校園範圍、Web Locks、讀回確認與容量限制。成功保存後才發出同分頁通知；通知僅含範圍 key 與記憶體 writer symbol，不攜帶 token、作業內容或完成證明。
- Today 忽略自己的保存通知，保留其他同分頁實例與跨分頁變更的重新查核。外部更新若在讀取中到達，仍排入下一次核對。
- `isAssistantCalendarActionReady` 統一後續依賴與完成判準：`verified`、`local: ready`、沒有 `verificationWarning`。Today 顯示完成前另核對回執的校園、mutation 與事件相符。
- 聊天完成後，Today 若只剩原安排追蹤、沒有新的待確認卡片，就收起準備流程步驟，避免仍顯示「安排空檔」正在進行。
- Today 的 `/plan` 只準備課務，因此舊服務的缺省提示正規化為 `true`；顯式相矛盾的 `false` 會被拒絕。從共用 journal 恢復的卡片保留原分類。

## 與最新主線整合

本輪從已發布的 `d14d20a089ea8421ae8c792433d6bc1d94cca3f5` 延續，納入 main `ca73d802600c5e14bf1572b6f08a09c943080083`（[#755](https://github.com/Miiduoa/graduation/pull/755)）。三方整合保留未修改匯入紀錄不重寫 `batchId`／`importedAt` 的行為、相關兩項測試，以及 Linux Chromium 的 Control 開新頁操作；保留原工作區的取消等待、帳號切換與草稿保護。

不在本輪整合其他開放 PR 的完整首頁／原生工作區重設。原生已有的作業安排與原作業返回能力保持原實作，本增量聚焦 Web 的跨介面接續。

## 驗證與限制

直接回歸涵蓋真實 Conversation 與已掛載 Today 的同頁接續、原作業精確連結、僅一次 confirm、讀回失敗、保存失敗、容量競態、登入範圍切換、legacy 分類、一般行程／取餐隔離，以及警告修復後才開放後續確認。伺服器測試覆蓋簽章 guard 與 precise／subset／shift 修訂保留提示；底層測試使用真正 parser、journal 與 storage。

既有 `scripts/qa/ai-workspace` 瀏覽器驗收加入兩個課務情境，仍保留原六個工作區情境。使用實際 Provider、Today、Conversation、journal、行事曆鏡像、追蹤儲存與 CSS；帳號、導覽及傳輸為隔離的合成資料。合成後端只有在實際按下確認後才建立紀錄，沒有預先注入課務追蹤證據。

瀏覽器檢查記錄來源雜湊、實際 runtime、同一 Today DOM、document time origin、請求、寫入數與 journal 清除時的證據；伺服器契約的雜湊只鎖定版本，不代表瀏覽器執行了後端權限驗證。

### 本機實際結果

| 驗證 | 結果 |
| --- | --- |
| 助理前後端與追蹤相關回歸 | 148 個測試檔、6,351 項；以每檔最後結果去重後全部通過，0 skipped |
| 最後的追蹤畫面與流程覆檢 | 3 檔、132／132 通過，是上述範圍的子集，不另加總 |
| Chromium 真實元件驗收 | 8／8 情境、49 項流程、34 張截圖；page／console／外部／非預期請求錯誤皆為 0 |
| 瀏覽器來源鎖定 | 365 檔及 React／DOM runtime 雜湊前後相同；Playwright 1.56.0、Chromium 141.0.7390.37 |
| Web TypeScript、變更檔 ESLint | TypeScript exit 0；23 個 Web 程式／測試檔 0 errors、0 warnings；另 2 個 QA TSX 0 errors、0 warnings |
| main #755 隔離整合回歸 | 8 檔、351／351；編輯流程 3 個 viewport、6 個子流程、24 checks 通過；這是獨立批次 |

**保留一次逾時紀錄：**148 檔批次中，既有 `courseworkRecoveryAdapter` 的第一項測試超過原本 5 秒上限，該次為 6,350 通過、1 逾時。沒有更改產品、斷言或上限；單獨重跑原 3 項測試全部通過，首項耗時 3,366ms，仍確認預覽 8 次、確認 10 次 API 呼叫與原本 12 次預算。逾時原因未被斷定為產品錯誤或環境錯誤，遠端完整 CI 仍須獨立取得結果。

完整計數、各批結果雜湊與變更來源見 [validation.json](evidence/study-followthrough-20261124/validation.json)。瀏覽器來源清單見 [source-sha256.json](evidence/study-followthrough-20261124/source-sha256.json)，SHA-256 為 `43fb98439b8088e772e95debc8a5001e2b5a295f03a43019ba909add643f6fa5`；完整 browser results SHA-256 為 `86ca218ae80b1261dd267bb21d1e8e240642c1108ee4ee6cdafb96a008c90002`。manifest 如實記錄執行當時的基底與未提交修改，發布樹另以相同來源雜湊核對。

可審閱的畫面：[桌機接回原安排](evidence/study-followthrough-20261124/desktop-tracking.png)、[手機唯讀恢復後](evidence/study-followthrough-20261124/phone-recovered.png)。兩張圖均保留合成資料標示。

這些驗證不等於真實學校帳號、正式後端、Safari、原生裝置或正式部署已驗收。最後提交的 Actions、指定 App 審查、合併與部署狀態，依 PR 的精確 head 分別核對；先前 d14 的綠燈不能轉用為本增量的結果。
