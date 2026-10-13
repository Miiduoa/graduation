# 公車站牌與到站查詢

`/bus` 先找候車地點，再確認路線、方向及預估到站。原本透過 Firestore 登錄路線的頁面移到 `/bus/registered`，沒有刪除資料，也沒有變更原 Firebase callable。

## 查詢範圍

靜宜大學的預設入口以 TDX 站名搜尋「靜宜大學」。這不是校門座標附近的完整站牌清冊，也不代表校方背書的路線推薦。每個站牌保留自己的 StopUID，不合併道路兩側的同名站牌。

「找我附近」取得一次使用者授權的位置，在所選縣市內查詢 300、600 或 1,000 公尺半徑，依直線距離排序。縣市不會從 GPS 自動推測；跨縣市須切換縣市，邊界外的站點可能未列入。只顯示最多 16 個站牌，來源或畫面結果截斷時標示為部分結果。導航使用公開站牌座標，不假裝直線距離等於步行距離，也不自行估算步行時間。

到站估計以每筆 SrcUpdateTime（缺少時才使用 UpdateTime）檢查新鮮度，來源超過 90 秒或明顯來自未來就不顯示倒數。去返程只在有明確目的地資料時標示「往某站」，不從路線名稱猜方向。尚未發車、交管不停靠、末班已過、今日未營運、沒有預估、離線及查詢失敗分開處理。

## 啟用條件

在 **Next.js Web 服務的伺服器執行環境** 設定 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`，使用具備對應 API 權限及額度的 TDX 帳號。變數範例在 `apps/web/transit.env.example`。不要加 `NEXT_PUBLIC_` 前綴、提交真實金鑰，或把權杖交給瀏覽器。已存在 Firebase Functions 的同名 secret 不會自動傳到 Web 服務。

沒有設定時 `/api/transit` 明確回覆 HTTP 503 / `not-configured`，頁面提供原路線查詢與官方網站；不提供看似真實的示範班次。新增程式碼本身不代表正式服務已啟用。上線前仍須在真實部署確認有效 TDX 憑證、實際站牌、即時到站及手機定位。

## 隱私與服務保護

查詢經由同源 POST `/api/transit`，GPS 不放在 URL、不寫入個人檔案，也不存到收藏。收藏僅保存公開站牌資訊，最多 16 筆。伺服器會在記憶體短暫快取粗化後的查詢中心與站牌資料；正式平台的請求記錄政策仍須另行確認。

入口限制 JSON 本體 2 KB、拒絕瀏覽器跨站請求並驗證動作、縣市、座標、半徑與 StopUID；TDX hostname 固定，站名的 OData 字串經過跳脫。上游逾時 8 秒，不追蹤重新導向。OAuth 與相同查詢共用進行中的請求，站牌快取 120 秒、到站快取 15 秒；來源時間不會被快取重新包裝成新資料。

快取最多 128 筆，同時最多 8 個不同查詢，最多 4 個上游連線；單一執行個體每分鐘最多 60 次上游請求。429 依 Retry-After 暫停請求。這些是**單一程序內**的保護，不是跨執行個體的配額保證；多個執行個體或正式高流量使用，仍須在入口加共享限流並監控 TDX 配額。

頁面只有一個站牌會持續更新，正常每 30 秒查詢、失敗退避 60 秒。背景頁面或離線時停止輪詢。查詢、站牌切換及定位回呼都有取消／過期防護。

## 測試

```sh
node --test scripts/test-transit.cjs
pnpm --filter web exec vitest run src/components/TransitExplorer.test.tsx src/app/bus/registered/page.test.tsx
pnpm --filter web typecheck
pnpm --filter web build
```

Node 測試使用注入的本地傳輸替身，直接執行正式 transit 與 API 模組，不使用真實憑證或付費流量。React 互動測試由既有 Web Tests 工作流程執行；原路線頁測試隨頁面一起保留。`Transit contract checks` 額外執行獨立資料契約測試與嚴格型別檢查，不依賴整個行動版工作區安裝。

正式驗收至少包含：同名道路兩側站牌、允許／拒絕定位、切換縣市、移除收藏、TDX 429、斷線重連、背景 90 秒後返回、末班車與沒有預估的差異。人工仍須對照站牌或官方網站，確認沒有搭錯方向。

## 來源

- TDX 空間查詢： https://motc-ptx.gitbook.io/tdx-xin-shou-zhi-yin/api-te-se-shuo-ming/zhi-yuan-odata-cha-xun-yu-fa/odata-cha-xun/odata-cha-xun-xuan-xiang-spatialfilter
- 市區公車站牌：`/api/basic/v2/Bus/Stop/City/{City}`
- 市區公車到站預估：`/api/basic/v2/Bus/EstimatedTimeOfArrival/City/{City}`
- OAuth：`/auth/realms/TDXConnect/protocol/openid-connect/token`
