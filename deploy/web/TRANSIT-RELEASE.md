# 公車恢復與發布檢查

本次從目前 main 還原 PR #33 的公車站牌探索、Web 伺服器查詢及測試。使用新分支整合，不重設或強推 main，亦不覆寫公車以外的後續更新。

## 發布前

`live-tdx` 是 Web release 的預設 profile：先在兩台既有 `nuni-web` 機器內執行唯讀 TDX 檢查，再建置和發布；rollout 前後亦重新檢查，並分別保留證據。只傳送檢查程式，不讀出、回傳或複製機器上的 TDX Secret；需要既有 Fly 部署權杖與 SSH 權限。不會新建主機，也不會自動更換或啟用 Secret。

檢查必須取得名稱包含「靜宜大學」的臺中站牌，以及至少一筆具去返程與有效來源時間的資料。超過 90 秒、來源來自未來、空資料、HTML 404 及無權限都會停止發布。TDX 對每把金鑰限流，且兩台機器與公開伺服器共用同一把金鑰：單一請求收到 429 時，只在同一次檢查、同一個已取得的 token 上有界重試（20 秒、40 秒各一次），重試後仍限流就停止發布，不會換假資料或改走官方入口。末班已過等有效狀態與真正倒數分開記錄；只有明確的正常狀態加有效秒數才會標記 countdownVerified。非營運時段若 TDX 不提供新鮮狀態，檢查會停止，不能以假倒數通過。

## 發布後

另檢查公開 `/health/ready` 的確切版本、新版 `/bus`、定位權限政策、`/api/transit` 真實站牌和新鮮到站資料。只通過 Web 健康檢查或一般 CI 不會被記成公車上線成功。

## 尚未申請 TDX 的官方入口發布

明確選擇 `transit_profile=official-links-only` 時，所有既有主機必須在建置前、rollout 前後證明 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET` 都沒有設定；部分設定、空值或完整設定都會停止。此檢查不呼叫 TDX，也不會移除現有憑證來通過檢查。

公開檢查仍要求確切 Web SHA、legacy ready、公車頁框與同源定位政策，並驗證 API 精確回覆 503 / not-configured、伺服器 HTML 有「即時到站尚未啟用」及標明臺中市的官方查詢連結。成功的證據寫入 `profile: official-links-only`、`transitReady: false`、`browserControlsVerified: false`。任何 401、429、服務故障或假站牌／到站資料都不能冒充這個狀態。實際瀏覽器操作另行驗收。

這是尚未啟用即時資料時可使用的官方網站入口，不是免金鑰即時資料串接。TDX [官方 API 說明](https://tdx.transportdata.tw/api-service/swagger) 的訪客服務限瀏覽器且每 IP 每日 20 次；臺中 [官方動態資料集](https://data.gov.tw/dataset/83749) 的下載為範例，正式介接仍須申請。現階段可讓使用者前往 [臺中市官方公車查詢](https://citybus-free.taichung.gov.tw/)。不得以訪客額度或範例資料替代正式即時服務。

預設模式不變；未知 profile 或 `live-tdx` 檢查失敗時，絕不自動切換為官方入口模式。

## 金鑰與權限

沿用 GitHub Secret `FLY_NUNI_WEB_DEPLOY_TOKEN`。TDX 憑證只需存在 Fly 的 Web runtime，不必複製到 GitHub。新建立或 staged 的 Secret 不代表目前機器已讀到；若 runtime preflight 未通過，發布會停止，不會自動重啟機器來繞過檢查。

沒有可用的 Fly 部署憑證時不嘗試部署。取得平台登入授權仍須帳號擁有者操作；GitHub 程式碼寫入權限不能代替 Fly 或 TDX 帳號授權。

## 驗證邊界

`node --test deploy/web/transit-release-gate.test.mjs` 使用明確的本機傳輸替身，不能當作正式 TDX 連線紀錄。機內檢查失敗時只回固定錯誤代碼（如 `rate-limited`、`tdx-not-configured`），不回供應商回應內容或憑證資料；Fly SSH 本身失敗則另記 `fly-runtime-probe-failed`。發布最後的公開驗證會在機內檢查剛用過同一把 TDX 金鑰後執行，正式站可能因保護共用額度回 429 與 `Retry-After`；公開驗證只對 429 依 `Retry-After`（上限 120 秒、且不短於自身 30／60／60 秒間隔）有界重試，整次最多等 240 秒，仍被擋就以 `rate-limited` 停止。不設白名單標頭、不放寬一般使用者限流；機內檢查則維持固定間隔，避免超過 Fly SSH 時限。手機實機定位、道路兩側現場方向與多機器共享配額仍須另行驗收。只有正式機器、憑證、TDX 及發布流程都通過實際檢查，才可宣稱即時公車已啟用；官方入口模式的 Web 發布必須另外註明即時公車尚未啟用。

## 兩台機器共用公車快取

`/api/transit` 由第一台 Web 機器集中處理：另一台回 `fly-replay: instance=<第一台>;timeout=3s;fallback=prefer_self`，由 Fly Proxy 轉送；第一台不在或逾時就退回原機器本機處理，不形成單點故障。已轉送或退回的請求（帶 `fly-replay-src`、`fly-replay-failed`、`fly-preferred-instance-unavailable`）一律本機處理，不會來回轉送；不在名單內的機器也本機處理。機器名單與 `release-check.mjs` 的 `EXPECTED_MACHINES`、`transit-release-gate.mjs` 的 `MACHINE_IDS` 相同，換機時三處要一起改。對 TDX 的保護（同時 4、每分 60、Retry-After）不變，集中後整站仍受這些上限約束。

靜宜常見路線（162、301、368、326）的 TDX 站序會在第一次有人查詢後於背景預載；被限流時沿用最近一份 TDX 站序最多 24 小時補終點，超過就維持「終點未提供」，不寫死站名。部署閘門的機內檢查直接查 TDX、公開檢查經 Fly Proxy 轉送，流程不需調整。
