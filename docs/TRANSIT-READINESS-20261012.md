# 公車正式環境驗收 — 2026-10-12

驗收時段：2026-10-12 22:50–22:51，Asia/Taipei（UTC+08:00）。

**結論：尚未接通。這次僅完成唯讀驗收，沒有部署、設定金鑰、重啟或新增機器。**

## 原始證據

- 執行：[Transit production readiness 38265838289](https://github.com/Miiduoa/graduation/actions/runs/38265838289)。
- 來源提交：`0c2096299c1c66abe17c8d4a3385d039bc539657`。
- Artifact：`transit-production-readiness-38265838289`，ID `11755200128`。
- ZIP SHA-256：`95c3429966a8b35a47f1747a663f3c7ef0e36bdc495803a6522170abc5a53ea2`。
- 內容：`source.json`、`public.json`、`platform.json`、`browser.json`、桌面與手機瀏覽器的正常／斷線 PNG 截圖。
- Artifact 保留至 2026-10-19 22:51（台灣時間）。成功執行只表示完成蒐證，不表示公車已可使用。

## 來源與 CI

[PR #33](https://github.com/Miiduoa/graduation/pull/33) 已於 2026-10-12 20:14:09 合併。Head 為 `af0cea3ff95c43641310b39645cbb204445a6a41`，merge commit 為 `6d893786ac0bce54aa4cf8223100e5b62b43394d`。

其後 [3e83a15d004ecbded2cfeb07530319770a856f4f](https://github.com/Miiduoa/graduation/commit/3e83a15d004ecbded2cfeb07530319770a856f4f) 於 21:17:52 撤回改動，提交訊息為「暫時取消公車站牌探索改動，待確認來源後再驗」。不能把 PR 已合併當成新版仍存在於 main。

驗收時 main 為 `5aaa0f9c15fed30b3f5912bf712cce2f0c69367b`；對應 [CI 38264914868](https://github.com/Miiduoa/graduation/actions/runs/38264914868) 已 completed / success。這個 SHA 下的三個檔案均不存在：

- `apps/web/src/app/api/transit/route.ts`
- `apps/web/src/components/TransitExplorer.tsx`
- `docs/TRANSIT.md`

重新讀取原 [CI 38231302159](https://github.com/Miiduoa/graduation/actions/runs/38231302159) 的 jobs：Web Tests、Mobile Tests、Functions Tests、Firestore Rules Tests、Security Gates、Lint & Type Check、Build Web、Build Mobile、CI Summary 均成功；Deploy Firebase backend 為 skipped。本次未重跑或改寫原本已通過的測試。

## 正式站 HTTP 實測

| 檢查 | 結果 |
| --- | --- |
| `GET https://nuni.tw/health/ready` | 200 JSON，service `campus-one-web`，status `ready` |
| 健康端點回報的正式 revision | `3e83a15d004ecbded2cfeb07530319770a856f4f` |
| `GET https://nuni.tw/bus` | 200 HTML，沒有新版站牌探索入口 |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(self)` |
| `POST /api/transit`，`{"action":"campus","schoolId":"pu"}` | 404 HTML，不是有效的 transit JSON |
| `POST /api/transit`，`{"action":"search","city":"Taichung","text":"靜宜大學"}` | 404 HTML，不是有效的 transit JSON |
| 真實站牌、去返程、即時到站 | 未取得；未偽造或以替身補值 |

這不是「靜宜大學附近沒有公車」，而是查詢端點不存在。也不是原實作中缺少 TDX 憑證時的 `503 / not-configured`。補金鑰本身無法修復缺少的路由。

## 憑證與權限

獨立的 GitHub Actions 執行環境檢查顯示，下列 repository secrets 皆不可用：

- `FLY_NUNI_WEB_DEPLOY_TOKEN`
- `TDX_CLIENT_ID`
- `TDX_CLIENT_SECRET`

已登入的 GitHub 設定頁也顯示 repository 無 secrets、無 environments。這只證明 GitHub 設定與本次工作流程可用性的狀態。

**因沒有可用的 Fly app 部署憑證，未讀取 `nuni-web` 的 Secret metadata 或 machine 狀態。不能據此宣稱 Fly 的 TDX Secret 不存在或無效。**

部署流程使用既有 `.github/workflows/web-release.yml`，目標為 Fly app `nuni-web`。發布要求完整 main SHA、該 SHA 的 full CI、app confirmation、既有機器與 immutable image 的檢查。不能用一般 CI 或只有 guards 的綠燈作為部署證明。

## 桌面與手機瀏覽器

實際操作 https://nuni.tw/bus；新建未登入的 Chromium context，沒有 mock transit 回應。

| 項目 | 桌面 1440×1000 | 手機瀏覽器 390×844 |
| --- | --- | --- |
| 頁面可載入 | 是 | 是 |
| 水平溢出 | 未觀察到 | 未觀察到 |
| 路線資料 | 顯示「目前無法取得校園路線資料，請重新讀取或使用官方查詢。」 | 相同 |
| 「找我附近」入口 | 不存在 | 不存在 |
| 斷線提示 | 斷網後出現提示 | 斷網後出現提示 |
| 恢復網路後重載 | 斷線提示消失，但公車資料仍無法取得 | 相同 |
| 未處理的 pageerror 事件 | 0 | 0 |

手機使用 Chromium 的 mobile / touch 模擬，**不是 iPhone、Android 或 Safari 實機驗證**。pageerror 為 0 也不代表所有請求成功。

未完成：允許／拒絕定位、真實附近站牌、同名不同方向辨識、收藏、到站 90 秒過期、真實班次斷線重連。原因是新版控制項與 API 不存在；不能把一般離線提示通過誤記為上述驗證通過。

## 解鎖條件與發布順序

1. 由既有 app 擁有者提供僅限 `nuni-web` 的短效部署 token，安全存入 GitHub Actions Secret `FLY_NUNI_WEB_DEPLOY_TOKEN`。不要存入原始碼、Issue、PR、對話或一般環境檔。
2. 登入 TDX，從「會員中心 → 資料服務 → API金鑰」取得 Client Id 與 Client Secret，確認公車 API 使用權限與現有方案額度。不自動購買或升級方案。
3. 優先檢查 Fly `nuni-web` 既有 Secret 狀態。有效的 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET` 應提供給 Next.js 伺服器 runtime；不加 `NEXT_PUBLIC_`、不放 Docker build args、也不假設 Firebase Functions Secret 自動傳遞。若直接在 Fly 設定，不必再把 TDX 金鑰複製進 GitHub。
4. 只在隔離程序中驗證 TDX OAuth、靜宜大學真實站牌與到站資料；不記錄 token、secret 或完整 provider 錯誤本文。保留 station ID、方向、來源時間與 HTTP status 作驗收。
5. 在最新 main 上建立新的整合 PR 還原公車功能，保留其後其他改動；不 reset main、不強推、不重新合併已關閉的 #33。檢查校名搜尋與 GPS 半徑查詢的差異、同名道路兩側站牌，以及多執行個體的整體配額控制。
6. 對新的確切 SHA 執行完整 CI，再使用既有 rolling、update-only 的發布方式；不新開主機、不改付費方案。發布前保留機器狀態及可回復 image，避免覆蓋同時發生的部署。
7. 發布後確認所有既有 Web 執行個體的版本、公開 API 的真實 stops / arrivals，再逐項驗證定位授權、拒絕、90 秒過期、斷線重連、手機實機與實際站牌方向。

Fly 可使用短效 app-scoped token；例如擁有者登入後執行 `fly tokens create deploy --app nuni-web --expiry 24h`。產生的值只存入 GitHub Secret，勿貼到對話。TDX secrets 需要更新時，可透過 `fly secrets import --app nuni-web --stage` 從標準輸入匯入；`--stage` 暫不觸發部署，須等後續受控發布啟用。不應把真實金鑰直接寫在命令列參數或 shell history。

## 官方設定參考

- [Fly app-scoped deploy token](https://fly.io/docs/flyctl/tokens-create-deploy/)
- [Fly secrets import 與 stage](https://fly.io/docs/flyctl/secrets-import/)
- [Fly runtime Secrets](https://fly.io/docs/apps/secrets/)
- [TDX 公車 v2 API 與金鑰申請指引](https://tdx.transportdata.tw/api-service/swagger/basic/2998e851-81d0-40f5-b26d-77e2f5ac4118)
- [TDX 官方認證範例](https://github.com/tdxmotc/SampleCode)
