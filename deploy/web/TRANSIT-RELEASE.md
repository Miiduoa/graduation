# 公車恢復與發布檢查

本次從目前 main 還原 PR #33 的公車站牌探索、Web 伺服器查詢及測試。使用新分支整合，不重設或強推 main，亦不覆寫公車以外的後續更新。

## 發布前

Web release 先在兩台既有 `nuni-web` 機器內執行唯讀 TDX 檢查，再建置和發布。只傳送檢查程式，不讀出、回傳或複製機器上的 TDX Secret；需要既有 Fly 部署權杖與 SSH 權限。不會新建主機，也不會自動更換或啟用 Secret。

檢查必須取得名稱包含「靜宜大學」的臺中站牌，以及至少一筆具去返程與有效來源時間的資料。超過 90 秒、來源來自未來、空資料、HTML 404、無權限及限流都會停止發布。末班已過等有效狀態與真正倒數分開記錄；只有明確的正常狀態加有效秒數才會標記 countdownVerified。非營運時段若 TDX 不提供新鮮狀態，檢查會停止，不能以假倒數通過。

## 發布後

另檢查公開 `/health/ready` 的確切版本、新版 `/bus`、定位權限政策、`/api/transit` 真實站牌和新鮮到站資料。只通過 Web 健康檢查或一般 CI 不會被記成公車上線成功。

## 金鑰與權限

沿用 GitHub Secret `FLY_NUNI_WEB_DEPLOY_TOKEN`。TDX 憑證只需存在 Fly 的 Web runtime，不必複製到 GitHub。新建立或 staged 的 Secret 不代表目前機器已讀到；若 runtime preflight 未通過，發布會停止，不會自動重啟機器來繞過檢查。

沒有可用的 Fly 部署憑證時不嘗試部署。取得平台登入授權仍須帳號擁有者操作；GitHub 程式碼寫入權限不能代替 Fly 或 TDX 帳號授權。

## 驗證邊界

`node --test deploy/web/transit-release-gate.test.mjs` 使用明確的本機傳輸替身，不能當作正式 TDX 連線紀錄。手機實機定位、道路兩側現場方向與多機器共享配額仍須另行驗收。所有正式機器、憑證、TDX 及發布流程都必須通過實際檢查，才可宣稱已上線。
