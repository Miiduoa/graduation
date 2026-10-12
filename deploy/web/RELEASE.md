# 正式 Web 發布

`Web release` 工作流程只在 `main` 手動啟動時發布，push / PR 僅跑檢查。輸入 `expected_revision` 完整 SHA 與 `confirm_app=nuni-web`。同一版本最新的 push CI 必須全部成功；主線在建置期間前進，或既有正式映像改變，都會停止而不覆蓋其他發布。

發布需要 repository Actions secret `FLY_NUNI_WEB_DEPLOY_TOKEN`，使用只限 `nuni-web` 的短效 deploy token，不用個人或整個組織 token。不能把 token 貼進程式、issue、輸出或建置參數。過期後須以新的短效部署憑證替換這個專用 secret。

六個 Firebase 瀏覽器設定來自核准專案 `campus-one-tw` 的官方公開 SDK 設定端點 `https://campus-one-tw.web.app/__/firebase/init.json`，逐一檢查專案、domain、bucket 與 app/sender 對應；來源不存在、欄位缺少或混入測試值就停止。不修改 Firebase rules、Auth 設定或 service-account 權限。這是公開 SDK 設定，不是伺服器憑證。來源說明：https://firebase.google.com/docs/hosting/reserved-urls

映像在 GitHub runner 本機建置，不建立 Fly remote builder。只更新事前已核對的兩台 nrt / 512 MB / shared CPU 主機，保存移除私密內容的前後映像摘要。App、DNS、資料庫、付費方案及其他服務不在發布範圍。既有 Functions 覆寫網址僅由 production 的 `NEXT_PUBLIC_FUNCTIONS_BASE_URL` 變數帶入；未設定時保留程式原本行為，不擅自啟用文件中的未部署後端。

工作流程先檢查新 Web 容器的公開路由，正式 rollout 後確認兩台映像與公開 readiness 的完整 SHA。公開 `/bus` 需回應 HTML 並允許同源定位。HTML 出現按鈕字串僅作觀察，不能替代 JavaScript 載入後的瀏覽器操作驗收。

公車 TDX 的 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET` 仍須在 Web runtime 設定。本流程不新增、搬移或推測這兩個值。Web 發布成功、取得站牌、即時到站及手機定位分別記錄，不互相冒充完成。驗證失敗先檢視 sanitized artifact 中的 `before.json` / `image.json` / `public-check.json`，再核對正式站沒有其他人在發布後，使用當次捕捉的舊 digest 回復；不要以舊資料庫覆蓋新資料。

檢查本身：`node --test deploy/web/release-check.test.mjs`。測試使用替身資料，不對正式站寫入，也不取用真實憑證。建立此流程不等於已執行或通過正式發布。
