# 學生下單到取餐：2026-10-15 驗證紀錄

這次變更補上 Web 與 App 的訂單進度更新、斷線後重試保存，以及可重建的點餐 API 候選。未部署正式服務，也未完成手機實機驗收。

## 使用流程

- 學生選餐、確認金額與取餐時間，再明確送出到店付款訂單。
- 店家開啟收銀班別，確認收到款項後接單、開始備餐、標記餐點備妥。
- 學生查看一次性取餐憑證；店家核對憑證並確認交付後，學生看到已取餐，憑證隱藏。
- Web 分頁可見、App 位於前景時，每 10 秒更新訂單；返回前景立即更新。完成的訂單詳情停止輪詢，訂單清單與工作台繼續更新。
- 自動讀取保留尚未送出的確認內容；權限或狀態變更會移除已不適用的操作。讀取失敗時不保留可操作的舊權限或取餐憑證。
- 送出前先保存原始操作及冪等鍵。Web 使用該分頁的 sessionStorage，App 使用裝置 SecureStore；重新整理／重新啟動後回到相同門市，可以重試原操作。Web 關閉分頁後不保證保留紀錄。
- 儲存不可用時阻止送出；未知結果的重試失敗不刪除原始操作。資料依帳號與門市／訂單隔離，登出清理不阻止帳號撤銷，也不能污染下一個登入。

## 實際完成的驗證

已整合主分支 `6a37e69`（含餐廳目錄 API 與個人資料備份修正），以下 Web／App 全套數量為整合後重跑結果。API 六補丁來源與瀏覽器交易流程的實作檔案未變更。

| 範圍                               | 結果                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| Web 全套測試                       | 1,731 通過，1 跳過                                                                                 |
| App 全套測試                       | 2,496 通過，1 跳過                                                                                 |
| 型別檢查                           | Mobile、Web、shared 通過                                                                           |
| 建置                               | Next 正式版建置；Expo iOS／Android bundle 匯出通過                                                 |
| API 候選來源／邊界／native adapter | 23 個 Node 測試通過                                                                                |
| API 建置隔離                       | 6 個 Python 測試通過                                                                               |
| 真實 HTTP／PostgreSQL              | 81 次請求通過；結束後移除隔離 schema                                                               |
| App transport＋真實 API            | 另一輪 81 次請求通過，其中 50 次經 App 的 `nuniPlatformRequest`；結束後移除隔離 schema             |
| 瀏覽器雙帳號                       | 使用隔離測試帳號及真實 API／PostgreSQL，完成下單、收款、接單、備餐、QR 圖片讀取與交付              |
| 斷線恢復                           | 後端建立訂單後刻意中斷回應；重新整理後重試，payload／冪等鍵與訂單 ID 相同，回執為 `replayed: true` |
| 雙邊進度                           | 學生未手動刷新即看到已接單、可以取餐與已取餐；核銷後 QR 消失，店家待處理清單移除該筆               |
| 排版                               | 瀏覽器 390px 學生畫面及 1440px 店家畫面沒有水平溢出                                                |

HTTP 測試另涵蓋取消／退款、交班、暫停接單後既有訂單查詢／取消／取餐、重複送出、跨帳號及跨門市拒絕。瀏覽器驗證使用開發預覽；開發工具預載警告、尚未開班的預期 404 與反覆重載期間 `/api/schools` 的 429 均未作為「零 console 錯誤」驗收。

SecureStore 測試使用符合已安裝 Expo key 規則的儲存替身，驗證不可用、讀寫失敗、重啟恢復、並行索引及登出晚完成；這不代表已在 iOS Keychain／Android Keystore 實機上驗收。

## API 來源與發布界線

預設 `deploy/nuni-api/source.json` 保持四份補丁的 v20；本次沒有把先前回退的正式 API 自動升版。點餐候選明確選用六份補丁：

- candidate/runtime：`5e419aeb0482a535819e9345599e03f950de95a1`
- source tree：`cb6c18ea7f0ccc73b64d3df99e0e772563561c68`
- 本機建置 image：`nuni-api:food-ordering-candidate`
- image manifest digest：`sha256:c8b7cb89e2c32443da47afb0776b6e65c1d9dc755e70b5879f11c7f045a17fd3`

第五份補丁保留暫停門市的既有訂單權限，第六份提供訂單場域清單。驗收工具會拒絕把四／五份補丁的來源當成完整候選。建置與驗收指令見 [API 說明](../../deploy/nuni-api/README.md)。

正式開放前還需要：選定包含點餐候選的整合發布版本、確認正式場域與店家營運權限、部署後雙帳號驗證，以及安裝 App 的登入、重啟恢復與相機掃碼實機驗收。本機 bundle 匯出沒有產生可安裝 APK／IPA，也沒有提交商店。

## 正式環境的到期處理尚未就緒

2026-10-15 的唯讀 Fly 稽核看到 `nuni-api` 只有兩台 `app` process machine，API image 啟動的是 `index.js`；可見 Fly apps 沒有獨立的訂餐到期 worker。未查 Fly 以外主機，不能推論所有主機都沒有 worker。

同一份六補丁 image 包含 `apps/api/dist/food-expiry-worker.js`，但單純更新 API image 不會啟動它。正式發布必須另有 private worker process／service，明確啟用 `FOOD_EXPIRY_ENABLED=true`，以自己的 `4102/health/ready` 驗證；API 的 `4100` 探針不能替代它。需要先驗證 worker 資料庫身分、精確 schema manifest 及各目標場域的 food event contracts，保持 enforce。worker 同時處理餐桌關閉與候位到期，啟用前須盤點其影響範圍。

瀏覽器 fixture 未啟動背景 worker，因此逾時的未付款訂單可能仍顯示待付款且沒有可用操作。正式驗收必須證明到期狀態更新、庫存只釋放一次、已付款訂單不被誤刪，以及 worker readiness 能反映失敗。此項尚未完成，不以 happy-path 成功取代發布驗收。
