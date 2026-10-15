# 正式 Web 發布

`Web release` 工作流程只在 `main` 手動啟動時發布，push / PR 僅跑檢查。輸入 `expected_revision` 完整 SHA、`confirm_app=nuni-web` 與 `transit_profile`。同一版本最新的 push CI 必須全部成功；主線在建置期間前進，或既有正式映像改變，都會停止而不覆蓋其他發布。

發布需要 repository Actions secret `FLY_NUNI_WEB_DEPLOY_TOKEN`，使用只限 `nuni-web` 的短效 deploy token，不用個人或整個組織 token。不能把 token 貼進程式、issue、輸出或建置參數。過期後須以新的短效部署憑證替換這個專用 secret。

六個 Firebase 瀏覽器設定來自核准專案 `campus-one-tw` 的官方公開 SDK 設定端點 `https://campus-one-tw.web.app/__/firebase/init.json`，逐一檢查專案、domain、bucket 與 app/sender 對應；來源不存在、欄位缺少或混入測試值就停止。不修改 Firebase rules、Auth 設定或 service-account 權限。這是公開 SDK 設定，不是伺服器憑證。來源說明：https://firebase.google.com/docs/hosting/reserved-urls

映像在 GitHub runner 本機建置，不建立 Fly remote builder。只更新事前已核對的兩台 nrt / 512 MB / shared CPU 主機，保存移除私密內容的前後映像摘要。App、DNS、資料庫、付費方案及其他服務不在發布範圍。既有 Functions 覆寫網址僅由 production 的 `NEXT_PUBLIC_FUNCTIONS_BASE_URL` 變數帶入；未設定時保留程式原本行為，不擅自啟用文件中的未部署後端。

工作流程先檢查新 Web 容器的公開路由，正式 rollout 後確認兩台映像與公開 readiness 的完整 SHA。公開 `/bus` 需回應目前公車頁的伺服器頁框並允許同源定位；校園與查詢按鈕在瀏覽器載入後呈現，因此不再把伺服器 HTML 中的按鈕字串當發布條件。`browserControlsVerified` 保持 false，直到另行完成 JavaScript 載入後的瀏覽器操作驗收。

`transit_profile` 預設為 `live-tdx`，維持真實 TDX 站牌、方向與新鮮到站資料的發布條件；需要 Web runtime 的 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`。另一個選項 `official-links-only` 供尚未申請 TDX 的版本明確發布官方查詢入口：

- 建置前、rollout 前與後，逐一檢查兩台既有機器：兩個 TDX 環境變數必須完全不存在；只設定一個、空字串或已設定兩個都停止，避免掩蓋已啟用服務的故障。
- 正式 `/health/ready` 必須為預期完整 SHA，且 legacy ready。`/api/transit` 必須精確回覆 HTTP 503 及僅含 `status: unavailable`、`reason: not-configured` 的 JSON；401、429、provider outage、額外站牌／到站資料均不能通過。
- `/bus` 的伺服器畫面必須明示「即時到站尚未啟用」，並具有標明臺中市的官方 HTTPS 查詢連結。該說明不依賴選校或 JavaScript，即時查詢本身維持未啟用。
- artifact 一律寫入 profile；links 模式明確記錄 `transitReady: false`。這只確認 Web 及官方入口，不能稱為公車即時資料已啟用，也不能代替瀏覽器、實機或外部官方站的操作驗收。

模式必須主動選擇，未知值會停止；`live-tdx` 失敗不會自動降級。保留 sanitized `transit-preflight.json`、`transit-before-rollout.json`、`transit-after-rollout.json` 與 `transit-public.json`，不輸出機器環境內容或原始 provider error。本流程不新增、搬移或推測 TDX 憑證。Web 發布成功、取得站牌、即時到站及手機定位分別記錄，不互相冒充完成。驗證失敗先檢視 sanitized artifact 中的 `before.json` / `image.json` / `public-check.json`，再核對正式站沒有其他人在發布後，使用當次捕捉的舊 digest 回復；不要以舊資料庫覆蓋新資料。

檢查本身：`node --test deploy/web/release-check.test.mjs`。測試使用替身資料，不對正式站寫入，也不取用真實憑證。建立此流程不等於已執行或通過正式發布。
