# 學生點餐、店家接單與取餐

日期：2026-10-13。PR：<https://github.com/Miiduoa/graduation/pull/36>。

本文件記錄本機與自動化驗收；尚未部署，未完成真實 Google 帳號登入、實體手機跨端掃碼或線上金流商戶驗收。

## 已實作

- Web `/food`、App 平台點餐：選門市、餐點與選項、數量／備註／預計取餐時間、取得實際報價、確認送出、訂單紀錄／詳情、付款狀態、取消及一次性取餐 QR。
- Web `/merchant`、App 店家工作台：開班、櫃檯實收確認、接單／婉拒、取消已接訂單、各工作站開始備餐／備妥、確認退款、核對一次性憑證交付及交班。
- Web 可用相機、取餐碼圖片或掃碼器輸入；App 使用相機掃碼。讀取 QR 只填入憑證，必須再確認交付。取消、離開頁面／背景、換訂單及延遲授權都會收回掃碼狀態。
- 操作結果不明時保留原內容與冪等鍵；重試不重新下單或重複收款。切換帳號、場域或門市時隔離草稿、回應與權限。
- 最後一家門市暫停後，本人舊單仍可探索、查詢、取消及取餐；新訂單與公開菜單依原接單條件限制。他人訂單、停用身分與撤銷角色仍拒絕存取。
- 保留既有 `/cafeteria`、`/orders`；訂餐入口與主分支的課表、匯入和行事曆並存。

線上付款只依後端實際可用付款方式與付款 session 提供連結，不能把開啟付款頁當成入帳。櫃檯收款與退款需要店家確認實際金額。

## 驗證紀錄

訂餐實作提交 `f6af6f07e0392f5d021a8a4a2b309d2f3bfbf8bd` 的穩定檢查：

| 驗證                                     | 結果                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| 共用 food client                         | 160 tests 通過                                                    |
| Web 全套                                 | 1,296 通過、1 既有略過                                            |
| App 全套                                 | 2,298 通過、1 既有略過                                            |
| API 新來源回歸                           | 4 suites／54 tests 通過                                           |
| 真實 HTTP／PostgreSQL                    | 81 requests 通過，測試 schema 已移除                              |
| TypeScript                               | 三個 workspace 通過                                               |
| ESLint                                   | 通過，仍有 warnings                                               |
| Web production build                     | 通過                                                              |
| Expo iOS／Android／Web JavaScript export | 通過；不等同 native build 或上架驗收                              |
| 獨立審查                                 | 兩輪收斂；首次發現的 BFF 錯誤碼、未知結果重試與退款流程問題已修復 |

合併 `origin/main` 的 `53c4ac0` 後，服務選單兩個測試衝突以入口聯集解決：31 項服務、選單含搜尋共 32 個連結；7 suites／69 tests 通過。學生頁顯示整理後 Web 11 tests 與 App 23 tests 通過；App 新增訂單編號返回重進收合的驗證。最終提交的 GitHub checks 請以 PR 即時結果為準。

### 瀏覽器實際操作

使用隔離 RS256 測試身分提供者，經真實簽章、nonce、平台 session handler 建立兩個帳號；把這些 session 接到本機 Web BFF。未使用 demo auth，未模擬訂餐 API 回應。資料庫是專用 PostgreSQL 17.11 schema；這不是正式 Google 登入或真人驗收。

完成一筆 NT$120 餐點：學生選餐／備註／報價／確認送出 → 店家開班／實收／接單 → 開始備餐／備妥 → 學生出示 QR → 店家讀取 QR 圖片 → 明確確認交付 → 學生顯示已取餐且 QR 消失 → 店家交班應有與實點均 NT$120，待處理清單清空。讀入 QR 後未勾交付確認前，送出按鈕維持停用。

390px 學生與店家畫面未見水平溢出，1440px 店家畫面已檢視。瀏覽器有 Next 開發模式 CSS preload warnings，交班後查詢不存在的開啟班別會收到預期 404；沒有觀察到 JavaScript 執行例外。沒有將此記成零 console 訊息。

瀏覽器驗收完成後，已關閉自有程序、移除測試 schema／PostgreSQL 容器，以及測試 session 檔與已消耗 QR 圖片。

## API 來源與重建

`deploy/nuni-api/source.json` 固定來源：

- candidate/runtime commit：`5e419aeb0482a535819e9345599e03f950de95a1`
- tree：`cb6c18ea7f0ccc73b64d3df99e0e772563561c68`
- 從固定 base 依序套用 6 份 checksum 補丁，可重建相同 tree，API build 通過。

第六份補丁新增 `GET /v1/auth/platform/food-order-realms`，只回傳目前有效帳號／persona／person 已有本人訂單、且仍開放且啟用 food 模組的場域，不建立 persona 或擴大公開探索／下單授權。API grant inventory 已隨來源重生，但分析結果仍為 `BLOCK`；新增 SQL 的靜態可達性尚未全部證明，不能據此宣稱資料庫 ACL 已驗收。

## 尚待發布驗收

- 最終提交 CI、native build 與裝置驗收需各自有結果；一般 unit tests 或 Expo export 不能替代。
- 真實學生與店家帳號分別登入 Web／App，使用實體手機相機跨端掃碼、確認退款及斷線重試。
- 正式 API 與資料庫變更、Web／App 發布、實際門市資料及金流設定；目前沒有合併、部署或啟用正式收款。
- 先前 Firebase 發布檢查的 Storage API、Auth 設定、授權網域與 bucket 項目仍屬獨立發布工作，這次未修改雲端設定。
