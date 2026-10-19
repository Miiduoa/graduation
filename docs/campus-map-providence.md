# 校園地圖第一版（靜宜）

## 結論與範圍

第一版只做靜宜大學，與公車第一版同校。學生從「生活 → 校園地圖」進入
（底欄仍是 今天｜課務｜生活｜我，不新增底欄項目），在同一張地圖上看：

- 校園範圍內的主要建築與設施（教學大樓、圖書館、餐廳、宿舍、運動、停車等）
- 公車站牌位置；點站牌後按「查看即時到站」到公車頁看即時到站
- 一筆 OpenStreetMap 閘門標記的出入口，正式名稱待補

其他學校不套用靜宜資料：Firestore 沒有地點時維持「目前沒有可顯示的
校園地點」，各地點標待補。

## 查到的現況（沒有從零重做）

- 網頁已有 `/map`（Leaflet + OpenStreetMap 底圖）、搜尋、分類、收藏、
  步行導航外連與手機版式；手機 App 也有 WebView 地圖。本版只補資料與
  站牌連結，不重做這些功能。
- 網頁地圖原本只讀 Firestore `schools/{schoolId}/pois`；查不到地點時
  只剩校方平面圖連結，沒有可點的建築。
- repo 內舊的靜宜建築清單（`apps/web/src/lib/campusPoiLookup.ts`、
  `apps/mobile/src/data/puCampusData.ts`）座標約在東經 120.564 一帶，
  與校方公布的 GPS（北緯 24.2257、東經 120.5772）、OpenStreetMap
  校園範圍（東經 120.5769～120.5844）及臺中站牌座標對不上，差約
  1.6 公里。本版不沿用那批座標，已另列黃燈，手機端舊清單未在本版處理。

## 資料來源（逐筆可回查）

| 資料 | 來源 | 網址 | 授權／費用 |
| --- | --- | --- | --- |
| 底圖與建築座標 | OpenStreetMap 貢獻者（2026-10-19 查詢） | https://www.openstreetmap.org/copyright | ODbL，免費、免金鑰；頁面與底圖保留署名 |
| 靜宜校園範圍 | OpenStreetMap way 117553450 | https://www.openstreetmap.org/way/117553450 | 同上 |
| 校舍名稱核對 | 靜宜大學校方校區平面圖 | https://gnl.pu.edu.tw/p/426-1007-8.php?Lang=zh-tw | 只核對名稱，不當座標來源 |
| 校方 GPS 參考 | 靜宜大學「如何到靜宜」 | https://www.pu.edu.tw/p/406-1000-2733,r192.php?Lang=zh-tw | 校方公布北緯 24.2257、東經 120.5772 |
| 公車站牌座標與路線名 | 臺中市政府交通局靜態站牌快照（2026-10-18） | https://data.gov.tw/dataset/81555 | 政府資料開放授權條款第 1 版，免費、免金鑰 |

每筆建築在 `apps/web/src/app/map/providenceCampus.ts` 都保留回到
OpenStreetMap 元件頁的網址；站牌保留資料集網址。地點詳情有「查看
地點來源 ↗」可直接回查。

## 使用規則

- Firestore 有地點時以它為準，只補還沒有的公車站牌。
- Firestore 確認為空時，靜宜才改用隨附的 OpenStreetMap 建築資料。
- Firestore 讀取失敗時顯示錯誤與重試，不拿隨附資料假裝同步成功。
- 站牌的路線只列名稱；到站分鐘一律到公車頁查即時資料，地圖不自行推估。
- 不需要新金鑰、不花錢；沒有申請任何新帳號。

## 怎麼驗

```sh
pnpm --filter web exec vitest run src/app/map/providenceCampus.test.ts src/app/map/MapClient.test.tsx src/app/map/MapCanvas.test.tsx src/app/map/mapService.test.ts src/app/map/page.test.tsx
pnpm --filter web exec tsc --noEmit
pnpm --filter web build
```

人工驗收（部署後）：開 `/map?schoolId=pu`，確認看得到主顧樓、蓋夏
圖書館與靜宜大學（校門）站牌；點站牌後「查看即時到站」到
`/bus?schoolId=pu`；手機寬度下地圖與地點列表可操作。

## 待補與黃燈

- 出入口：目前只有一筆 OpenStreetMap 閘門標記且名稱待補；正門、後門
  的正式位置待校方資料或實地核對後再補，不自行猜測。
- 舊靜宜建築清單座標偏差（約 1.6 公里）：`campusPoiLookup.ts` 與手機
  `puCampusData.ts` 仍被其他功能引用，本版未更動，需另開一線逐筆
  用 OpenStreetMap／校方資料核對後修正。
- Firestore 正式地點若之後補上，會自動成為主資料；隨附資料的更新
  方式比照公車靜態快照：重新查詢、記錄日期與來源後才替換。
- 其他學校：維持待補，有該校可回查的真實座標來源後再逐校加入。
