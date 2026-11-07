# 校園空間導覽

這一版將 Three.js 的空間鏡頭互動用在現有 Web 校園地圖。使用者主動開啟「空間導覽」後，才載入繪圖程式；選地點、進度條、前後站與俯視按鈕控制相機。地點資料、校別邊界、平面地圖選取與步行導航沿用既有地圖。

靈感參考：[Chloe 的 Three.js 建築導覽短片](https://www.instagram.com/reel/DfW38iDFKxg/)。本專案沒有經確認的校園建築模型，因此使用有實際座標的地點標記，不呈現虛構的樓高、道路、室內動線或即時人流。

## 資料與效能邊界

- 只接收 `MapClient` 目前可見範圍的地點，不自行讀取其他學校或帳號資料。
- 使用公尺尺度的本地投影；跨越過大範圍的地點組合回到平面地圖處理。
- 相同座標不會被移開以假造距離。圖釘與地面僅表示相對位置，不能取代步行路線。
- 資料來源與「單一來源，位置待再次確認」提示沿用原有邏輯。
- 只在畫面改變時繪圖；相機移動期間才逐幀更新。離屏或分頁隱藏會暫停。
- 像素比上限 1.5，繪圖緩衝區上限 120 萬像素。幾何與材質共用，沒有外部模型、紋理或圖片下載。
- 遵循系統與網站的減少動態偏好；偏好改變時立即結束非必要的相機動畫。
- WebGL 不可用、載入逾時或繪圖中斷時，地點選擇、來源與導航仍可操作，也能重試。
- 關閉後清除動畫、監聽、DOM 標籤、幾何、材質與 WebGL context。

## 本機單元與整合回歸

專案使用 Node 22.23.4、pnpm 10.28.2。先依根目錄說明安裝相依套件。

```sh
pnpm --filter web exec vitest run \
  src/app/map/CampusSpatialExplorer.test.tsx \
  src/app/map/campusSpatialModel.test.ts \
  src/app/map/campusSpatialScene.test.ts \
  src/app/map/MapClient.test.tsx \
  src/app/map/MapCanvas.test.tsx \
  src/app/map/mapService.test.ts \
  src/app/map/mapFirstScreen.test.ts \
  src/app/map/campusMapSearch.test.ts \
  src/app/map/providenceCampus.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

場景單元測試使用真正的 Three.js 相機矩陣與幾何，只替換 GPU renderer 邊界。它驗證取景、焦點保留、縮放、動畫與清理行為，不能作為真實瀏覽器或實機效能的證據。

## 可重現的瀏覽器驗收

`Campus Spatial Browser` workflow 對相關 PR 執行以下流程：

```sh
pnpm install --frozen-lockfile
node scripts/qa/campus-spatial/build.mjs
python -m pip install playwright==1.57.0
python -m playwright install --with-deps chromium
python scripts/qa/campus-spatial/check.py
```

fixture 使用正式 `CampusSpatialExplorer`、Modal、樣式與已收錄的靜宜地點快照；只有 Firebase 邊界替換為不可使用帳號的防護。測試拒絕所有非本機請求，不登入學校，也不開啟外部導航服務。

驗收包含延遲載入、真實 WebGL2、原生對話框焦點與背景隔離、選點、相機畫面變化、鍵盤進度操作、320／390px 版面、44px 操作目標、深色、200% 根字級、減少動態、離屏停止繪圖，以及原生 context-loss 事件後的備援與重試。

結果與截圖儲存在 CI 的 `campus-spatial-browser` artifact：`results.json`、桌面與兩種手機寬度、深色大字級、繪圖失敗備援；失敗案例另存 trace 與無障礙樹。沒有成功的 run 與對應 SHA 前，不能宣稱瀏覽器驗收通過。

### 這些驗收不涵蓋

- 實機 iPhone／Android 的 GPU 效能、耗電與 Safari 相容性。
- 作業系統切到背景時的實際 `document.hidden` 行為；CI 只驗證真實離屏暫停，背景事件另有單元回歸。
- 瀏覽器整頁縮放；大字級案例調整根字級。
- 已登入的完整 Next.js 地圖路由、正式環境或即時資料新鮮度。
- POI 是否精確到建築入口、可通行道路與無障礙路線；這些需要有來源的獨立資料。

## 技術依據

- [Three.js：有需要才繪圖](https://threejs.org/manual/pages/rendering-on-demand.html)
- [Three.js：響應式與繪圖緩衝區](https://threejs.org/manual/pages/responsive.html)
- [W3C：尊重 prefers-reduced-motion](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)
