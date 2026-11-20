# Web 紙感訂單明細驗證（2026-11-01）

將既有訂單品項改為紙感明細，使用實際顧客 DTO 的店名、訂單編號、品項快照、數量、金額與建立／更新時間。標題為「Campus One 訂單明細」，明示「非統一發票」。紙紋、虛線與鋸齒邊沿用現有主題色彩，沒有動態效果。品項預設收合，可用鍵盤展開；背景更新保留同筆訂單的展開選擇。

付款、取消、更新、取餐操作與總額仍在紙票前方。元件僅接收六個明確欄位，不接收付款資料或取餐憑證。整數 TWD 金額沿用 `foodMoney`，不除以 100，不推算稅費；訂單處理狀態不推定付款成功。既有讀取失敗清除明細與憑證的行為保留。

## 環境與結果

- 基底：`c93b4ac3851df68f76d607af29b086030735dc55`，開工及提交前核對最新 main 與 open PR。未修改其他 PR 的共用檔案或 Mobile 點餐頁。
- Node 22.23.4、pnpm 10.28.2，frozen offline install；執行檢查設定 `EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null`。
- 六個 Web Vitest 檔案 **68/68 通過**：`FoodOrderReceipt.test.tsx`、`FoodWorkspace.test.tsx`、`foodOrderGuidance.test.ts`、`foodRead.test.tsx`、`foodMutation.test.tsx`、`foodPersistence.test.ts`。包含既有回歸，並非 68 個新增案例。
- 完整 `pnpm typecheck`、`pnpm lint` 通過。Lint 0 errors、695 既有 warnings（Mobile 565、Web 124、Functions 4、Shared 2）。最後版本另通過 Web typecheck、修改檔 ESLint、Prettier 與 `git diff --check`。
- 實際元件與全域／CSS module 在 Chromium 執行 **50 項檢查通過、0 runtime errors**，詳見 [browser-results.json](browser-results.json)。使用本機測試資料與 client 替身，禁止 fetch；沒有連正式資料、登入或金流。
- 兩輪獨立程式審查。首輪發現時間缺少年份，已補臺灣年份及跨年／不同年份回歸；第二輪沒有阻擋項。這不是 GitHub required review 或指定合併閘門的批准。

測試指令（工作目錄為 repo root）：

```sh
EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null pnpm --filter web exec vitest run src/features/food/FoodOrderReceipt.test.tsx src/features/food/FoodWorkspace.test.tsx src/features/food/foodOrderGuidance.test.ts src/features/food/foodRead.test.tsx src/features/food/foodMutation.test.tsx src/features/food/foodPersistence.test.ts --maxWorkers=1
EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null pnpm typecheck
EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null pnpm lint
```

## 畫面與互動證據

畫面為實際 `FoodOrders`／`FoodOrderReceipt`，以合成訂單隔離驗證，並非正式交易或發票。

| 畫面                                                | 覆蓋                                                |
| --------------------------------------------------- | --------------------------------------------------- |
| [桌面 1440px](desktop.png)                          | 完整畫面、原取餐操作在紙票前、展開品項與鍵盤焦點    |
| [手機 390px 淺色](mobile-light-paper.png)           | 紙紋、品項層級、整數 TWD 金額、非統一發票標示       |
| [手機 320px 深色長中文](mobile-dark-long-paper.png) | 長店名／品項／選項／備註／訂單編號換行              |
| [320px、模擬 200% 文字](large-dark-heading.png)     | 捲動後標題完整可見；全頁另以 DOM 邊界檢查無橫向溢出 |
| [授權等待入帳](awaiting-settlement.png)             | 保留「等待入帳」及確認中提示，不宣稱已付款          |

瀏覽器另驗證 Enter／Space 開合、44px disclosure 高度、reduced motion、資料更新不重播動畫與不重設展開、出示憑證後紙票仍無 token、失敗清資料、重試、返回／重開、四種處理狀態不推定已付款、已入帳原標籤及缺少品項的空狀態。200% 使用逐文字節點的 CSS 字級模擬，沒有冒充瀏覽器縮放或作業系統動態字級驗收。

## 測試來源 SHA-256

| 檔案（`apps/web/src/features/food/`） | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| FoodOrderReceipt.tsx                  | `bd67067f7bd6ac42ef0019a0036f923f2ecf18ff30379a7a5a75e6a03a75742f` |
| FoodOrderReceipt.module.css           | `d8e3eca97b2051d65f95e2bd3958dcc443e15f0ec7a1d7a2f45df4b8064c39e9` |
| FoodOrderReceipt.test.tsx             | `b540af000cb77561984ad37b319be2d7eeb342afc293c74f4e656ddc1354e20f` |
| FoodOrders.tsx                        | `0838da06b369166c9a82b59dd7f8be4e6716d8c6c8d1f68191fd7a1134bc1d24` |
| FoodWorkspace.test.tsx                | `f490165e0f0a8129a02147137850e72c0d0ac1e76b2f91d7b71eaa525d5c81fc` |

## 邊界與回滾

未新增發票號碼、統編、稅額、條碼、官方 QR 或可分享的取餐憑證；沒有分享／列印功能。未更動 API、資料庫、權限、依賴、工作流程或部署設定。沒有處理真實交易或恢復校務抓取。

尚未驗收 Safari／Firefox、實體裝置、真實讀屏、正式登入／付款與整站導覽；本機畫面不是完整 Next.js 正式建置或正式發布。精確 PR head 的遠端 CI 另外追蹤，不以此文件宣稱已通過或已合併。

還原本次提交即可回到原訂單品項呈現，不需要資料遷移。合併由主線既有窗口依 required checks／reviews 與指定 `nuni-merge-gate`「審查通過」協調；此工作不代做 approval 或繞過閘門。
