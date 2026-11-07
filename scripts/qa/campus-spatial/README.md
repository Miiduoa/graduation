# 校園空間導覽

這一版將 Three.js 的空間鏡頭互動用在現有 Web 校園地圖。使用者主動開啟「空間導覽」後，才載入繪圖程式；選地點、進度條、前後站與俯視按鈕控制相機。也能用按鈕、鍵盤或橫向拖曳旋轉，調整縮放，並用北向提示辨識方向。地點資料、校別邊界、平面地圖選取與步行導航沿用既有地圖。

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

## 視角操作

旋轉與縮放只改變觀看方向，不會切換正在查看的地點。聚焦「校園地點空間圖」後，左右方向鍵旋轉，`+`／`-` 縮放，`Home` 回到北向與 100%。縮放範圍為 65–250%；到達界限時按鈕仍保留鍵盤焦點，再按不會超出範圍。選擇地點或「看全部地點」會保留方向，將縮放回到 100%。

預設斜視方向約 26.565°；北向提示依目前投影顯示。觸控時橫向拖曳旋轉，直向手勢交給頁面捲動；畫布不攔截雙指縮放。這些操作不會重建 WebGL context，靜止時不持續排入動畫影格。

## 本機單元與整合回歸

專案使用 Node 22.23.4、pnpm 10.28.2。先依根目錄說明安裝相依套件。

```sh
pnpm --filter web exec vitest run \
  src/app/map/CampusSpatialExplorer.test.tsx \
  src/app/map/campusSpatialModel.test.ts \
  src/app/map/campusSpatialCamera.test.ts \
  src/app/map/campusSpatialScene.test.ts \
  src/app/map/campusClassroomLookup.test.ts \
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

`scene.html` 使用正式 `CampusSpatialExplorer`、Modal、樣式與已收錄的靜宜地點快照。`map.html` 加入正式 `MapClient`、Leaflet、教室名稱解析與選取流程；Firebase／登入邊界改為唯讀測試資料與訪客狀態，Next Link 改成一般連結，底圖網址改成本機空白格線。多義案例的兩個建築明確標示為測試資料，不代表實際校園。正式的解析、標記與導覽程式仍參與測試。

測試拒絕所有非本機請求及 WebSocket，不登入學校，也不開啟外部導航服務。以下是腳本要求的驗收項目；是否通過必須以該次 commit 的 CI 結果為準。

| 案例 | 必須觀察到的行為 |
| --- | --- |
| `desktop` | 開啟前沒有場景或 Three.js chunk；開啟後是真實 WebGL2。原生對話框初始焦點可見、背景不能聚焦、Tab 返回對話框邊界、Escape 回啟動按鈕。選點、進度、俯視、回平面地圖與實際導航座標正確。 |
| `camera-controls` | 按鈕和場景鍵盤操作改變實際 canvas 畫面；方向提示與縮放讀值同步，選取不變，同一 canvas／context 保留。縮放界限保留焦點，Enter 與場景鍵盤皆不能超界；選點／總覽重設縮放，北向重設兩者。操作後 GPU 繪圖與 RAF 都停止。 |
| `camera-touch` | Chromium 原生觸控輸入產生可信的 touch PointerEvent；橫拖旋轉且不捲動，直滑真的改變對話框 `scrollTop` 且不旋轉。 |
| `mobile-320`、`mobile-390` | 320／390 CSS px 沒有橫向溢出，操作目標至少 44px，關閉與回平面地圖可操作。 |
| `dark-large-text` | 深色與 200% 根字級仍可讀、可操作，沒有橫向溢出。 |
| `motion-visibility` | 切換減少動態後不持續播放相機動畫；真實離屏停止繪圖，回到可視範圍再更新。 |
| `context-loss` | 真正的 `WEBGL_lose_context` 可信事件觸發備援；地點、來源與導航仍可用，重試建立新的有效 WebGL2 canvas。 |
| `map-classroom-unique` | `pu`／`主顧303` 對應主顧樓，導航座標精確符合快照，3D 接續該選取；解除篩選後可改選圖書館並帶回正式 MapClient。 |
| `map-classroom-ambiguous` | 同名測試建築沒有自動選取或預先提供目的地導航；使用者選第二個候選後才使用該候選座標。 |
| `map-classroom-unknown` | `pu`／`PH303` 不捏造目的地、不顯示地點詳情或導航，提供校方地圖核對連結。 |

繪圖探針只記錄原生 WebGL 與 RAF 呼叫，仍呼叫原方法，不以假的 renderer 或合成 context-loss 事件替代。觸控案例透過 Chromium 的標準輸入介面執行，不用 `dispatchEvent` 假裝頁面已捲動。所有案例要求沒有未處理的頁面 JavaScript 錯誤。預期的 WebGL context-loss console 警告與頁面例外分開記錄。

原生 `<dialog>` 的 Tab 邊界可能經過瀏覽器工具列。只有 `document.hasFocus() === false` 且頁面 activeElement 為 `BODY` 時允許一次過渡，下一次同向 Tab 必須返回指定的對話框控制項；不接受任何已取得頁面焦點的背景元素。焦點狀態寫入結果，便於核對。[Chrome 官方說明](https://developer.chrome.com/docs/modern-web-guidance/guides/accessibility/accessibility)

結果與截圖儲存在 CI 的 `campus-spatial-browser` artifact：`results.json`、桌面斜視總覽與俯視、視角操作、觸控、兩種手機寬度、深色大字級、繪圖失敗備援、教室唯一命中與未知案例。失敗案例另存 trace 與無障礙樹；結果保留實際 GPU／context／RAF 計數。沒有成功的 run 與對應 SHA 前，不能宣稱瀏覽器驗收通過。

### 這些驗收不涵蓋

- 實機 iPhone／Android 的 GPU 效能、耗電與 Safari 相容性。
- 真實手機的觸控硬體與雙指手勢；CI 驗證 Chromium 的原生觸控模擬與 `touch-action` 設定。
- 作業系統切到背景時的實際 `document.hidden` 行為；CI 只驗證真實離屏暫停，背景事件另有單元回歸。
- 瀏覽器整頁縮放；大字級案例調整根字級。
- 已登入的完整 Next.js 地圖路由、正式環境或即時資料新鮮度。`map.html` 只驗正式元件接收查詢的行為，沒有完成真實 Today 頁面到 Next.js 路由的端到端驗證。
- 真實底圖下載、斷網可用性、外部導航服務的路線與到達時間。繪圖失敗備援不等於離線能力。
- POI 是否精確到建築入口、可通行道路與無障礙路線；這些需要有來源的獨立資料。

競品功能的官方依據、同條件學生任務與尚未實測的項目，見 [校園地圖與課表導航比較基準](../../../docs/campus-spatial-benchmark.md)。

## 技術依據

- [Three.js：有需要才繪圖](https://threejs.org/manual/pages/rendering-on-demand.html)
- [Three.js：響應式與繪圖緩衝區](https://threejs.org/manual/pages/responsive.html)
- [W3C：尊重 prefers-reduced-motion](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)
