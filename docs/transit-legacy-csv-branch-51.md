# 公車站牌名錄分支 #51 的替代與整合說明

更新：2026-10-14。

## 整合決策

原 PR #51 的 `/api/bus-stops` 使用臺中市舊政府開放資料 CSV 下載位址（`data.gov.tw/dataset/81555`、`newdatacenter.taichung.gov.tw`），但其「official live source smoke」實際失敗，回報 `source-unavailable`。**不得把靜態測試資料當成真實公車站牌，不能在未取得來源前宣稱站牌服務已接通。**

目前 `main` 改採 `apps/web/src/app/api/transit/route.ts` 與 `apps/web/src/lib/transit-server.ts`，以經授權的 TDX 官方公車 API 支援：
- 指定學校的站名搜尋，以及跨校選擇相對應縣市
- 使用者明確授權定位後查詢附近站牌，保留站牌 ID 與方向
- 查詢路線預估到站、依資料來源時間顯示時效
- 收藏站牌、地圖步行連結、失敗與服務未設定狀態
- 對來源格式、站牌 ID、校園識別、速率限制與快取進行檢查

對應測試包含 `apps/web/src/components/TransitExplorer.test.tsx` 及 transit 的 API/服務相關測試。TDX 要有正式環境憑證及網路才能實際回傳結果；**CI 測試通過不代表現場資料源一定在線。**

## Git 歷史政策

本次保留原 PR #51 HEAD 作為 Git 合併父提交，採「新版 `main` 內容為準」整合，不採納無法驗證的舊 CSV 下載器及其 API 路由，不恢復可能失敗的定時/即時驗收步驟。GitHub 顯示原分支 merged 只表示歷史已歸檔，並非聲稱廢棄來源恢復運作。

正式公車營運仍必須用真實環境在選校、定位、查詢、到站、來源失敗及資料時效流程完成驗收。
