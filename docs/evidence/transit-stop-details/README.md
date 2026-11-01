# 手機站牌詳情驗證紀錄

2026-11-01，基準 main `c93b4ac3851df68f76d607af29b086030735dc55`。產品元件 `apps/mobile/src/components/PublicTransitExplorer.tsx` 的 Git blob 為 `41398522b76905508924ed0fbc1e549d651e2d70`（對應分支 head，含焦點防護與清單外開重試）；第一提交 `4fd6cc3a` 當下 blob 為 `6360e60e06033de6f75b0471ac8ee7bf3a80d641`。正式提交 SHA 與 CI 結果以 PR 為準。瀏覽器畫面與 `browser-results.json` 以第一提交產品樹為基準；第二提交的 Web 焦點防護與清單外開重試另以 Jest 覆蓋。

## 使用者行為

搜尋或定位取得站牌後，點選任一站牌立即開啟獨立詳情；原清單保持掛載。頂端「返回站牌清單」、Android 返回與讀屏退出關閉詳情，取消班次讀取與輪詢，不重新搜尋。步行導航、官方網站及靜態資料來源在詳情內提供外開狀態、錯誤與原連結重試。靜態站牌不請求即時到站；到站時間仍由既有來源新鮮度判斷。

## 本機驗證

- Node 22.23.4、pnpm 10.28.2；以 `pnpm install --frozen-lockfile --offline` 使用既有 store。執行命令皆設 `EXPO_NO_DOTENV=1`、`DOTENV_CONFIG_PATH=/dev/null`。
- 完整 `pnpm typecheck` 與 `pnpm lint` 通過。Lint 共 695 項既有 warnings，0 errors；修改的產品元件及測試沒有 lint 警告。焦點修正後另跑 Mobile typecheck 與修改檔 lint。
- 四組 Mobile Jest（`PublicTransitExplorer`、`publicTransit`、`CampusBusScreen`、`BusStopDetailScreen`）51 項通過。包括真實 React Native Web 元件的 Modal 開啟與 DOM 焦點回歸測試，以及 Web 焦點防護、清單外開忙碌／重試與讀屏關閉掛點對齊；未更改既有測試門檻或共用 UI。
- [瀏覽器結果](browser-results.json)：36 項檢查通過，0 runtime errors。使用實際產品元件、既有 `aiFirst.tsx` 與 theme，透過 React Native Web 轉譯；網路、定位、外部應用開啟與原生安全區為固定測試替身，不連正式服務。
- 首次瀏覽器檢查發現原生 `findNodeHandle` 在 Web 拋錯；修正版改成平台分流，Web 聚焦 DOM 並保留捲動位置，Native 維持原生焦點 API。新增測試後重新執行瀏覽器全流程；未忽略該錯誤。
- 兩輪獨立程式審查：首輪上述問題已修正，第二輪未發現新增或未解決的確定問題。這不是 GitHub required review approval。

## 畫面證據

| 情境 | 證據 |
| --- | --- |
| 320px 淺色，長站名與立即可見詳情 | [手機淺色](mobile-light.png) |
| 390px 深色 | [手機深色](mobile-dark.png) |
| 320px，模擬 200% 文字，操作可捲動到達 | [大字級操作](mobile-dark-large-actions.png) |
| 1440px 桌面瀏覽器轉譯 | [桌面](desktop.png) |
| 外開失敗在詳情內重試 | [連結錯誤](link-error.png) |

瀏覽器另檢查 16 筆清單的首站開啟／返回、搜尋文字與捲動位置保留、不重複搜尋、標題與原站牌焦點、至少 44px 返回控制、無水平溢出、班次失敗重試、空班次、過期資料不顯示倒數、靜態資料不當作即時，以及讀取中關閉。

## 待實機驗收與界線

尚未測試 iOS／Android 實體裝置、VoiceOver／TalkBack、系統動態字級、原生安全區、軟鍵盤與外部地圖返回。200% 是瀏覽器文字樣式放大，不是原生 Dynamic Type。沒有部署、改正式資料、恢復校務／E 校園抓取，也沒有修改 API、存取規則或合併閘門。

回滾只需還原本次提交，沒有資料遷移。後續真機依序檢查：長站名→詳情→讀屏焦點→系統返回→原清單位置；定位拒絕→站名搜尋；外開失敗→重試→外部地圖返回；讀取中返回與切校後晚到資料不得出現。
