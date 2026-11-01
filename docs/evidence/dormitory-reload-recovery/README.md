# 宿舍跨分頁重新讀取：重現與驗證

2026-11-01，基底 main `c93b4ac3851df68f76d607af29b086030735dc55`。開工核對全部 30 個 open PR，沒有其他 PR 修改本次宿舍頁、樣式或測試；不修改已交 #380／#381。

## 可重現問題

分頁 A 編輯包裹，分頁 B 刪除或修改同一包裹。A 的保存會先被既有版本比較阻擋，但按「重新讀取最新紀錄」後，舊表單、編輯 ID 與草稿仍然存在。再保存會復活已刪包裹，或覆蓋 B 更新的名稱／領取地點／日期。同樣地，設備問題、重要日期與包裹的舊刪除確認也會在重讀後繼續生效。

- 未修基準的新增回歸：**5 failed / 3 passed**。5 個失敗案例實際驗證復活、覆蓋與三類過期刪除；三類單純保存失敗保留草稿的既有行為均成功。
- 未修版在 Chromium 的兩個同源分頁亦重現真實 `storage` 事件：重讀後表單仍在，舊標題「舊草稿不應復活」再次寫入 localStorage，見 [baseline-browser.json](baseline-browser.json) 與 [原問題畫面](before-resurrected.png)。
- Mobile 衝突仍要求返回重開，不採納新的 raw 基準，沒有這條同頁重讀路徑；本輪未修改 Mobile，也不宣稱已驗收其原生行為。

## 修正與恢復行為

讀取、解析及正規化成功後，才清除三類紀錄的草稿、編輯／待保存 ID、開啟表單及刪除確認。保留當前功能與篩選；重新編輯使用剛讀到的最新資料。普通保存失敗保留草稿與重試流程不變。

衝突提示先說明重新讀取會關閉未儲存表單並取消刪除確認，使用者可先複製文字。成功後提供狀態訊息，把目前功能按鈕立即捲回可見範圍並恢復鍵盤焦點；不播放捲動動畫。窄版導覽焦點環改畫在按鈕內，避免水平捲動容器裁切。初次載入不搶焦點。

## 驗證結果

Node 22.23.4、pnpm 10.28.2，依鎖檔離線安裝；執行指令設定 `EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null`。沒有載入正式帳號、校務、金流或遠端住宿資料。

- 最終 Web 三組 **26/26 tests passed**：原宿舍頁、資料核心與新增 8 個重讀回歸。原測試與斷言保留。
- 完整 `pnpm typecheck`、`pnpm lint` 通過；Lint 0 errors、695 既有 warnings。最後焦點修正版再次通過 Web typecheck、修改檔 ESLint 與三組測試；新增測試 Prettier、`git diff --check` 通過。
- 最終 Chromium **44 項檢查通過、0 runtime errors**，見 [browser-results.json](browser-results.json)。使用實際宿舍元件／CSS、真實 localStorage 與兩個分頁，帳號／校園／外層 SiteShell 為固定替身，fetch 禁止。
- 兩輪獨立審查與一輪針對新發現「導覽被橫向捲走」的增量核對，沒有未解決阻擋項；不是正式 PR approval。

```sh
EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null pnpm --filter web exec vitest run src/app/dormitory/reloadRecovery.test.tsx src/app/dormitory/page.test.tsx src/lib/dormitory.test.ts --maxWorkers=1 --no-file-parallelism
EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null pnpm typecheck
EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null pnpm lint
```

瀏覽器涵蓋：320／390／1440px、深淺色、模擬 200% 文字、衝突前保留草稿、Enter 重讀、舊編輯與確認失效、最新資料重開編輯、新確認可刪除、取消、新表單空白、讀取失敗後重試，以及導覽捲走後的完整可見焦點。另核對初載未搶焦點。200% 是文字 CSS 放大，不是原生動態字級或瀏覽器縮放。

| 畫面                                             | 證據                               |
| ------------------------------------------------ | ---------------------------------- |
| 320px 深色，衝突前草稿保留與重讀說明             | [衝突](narrow-dark-conflict.png)   |
| 320px 深色，重讀成功、刪除結果保留、焦點完整可見 | [恢復](narrow-dark-recovered.png)  |
| 390px 淺色，成功狀態與空包裹清單                 | [手機](mobile-light-recovered.png) |
| 1440px，成功狀態與目前功能焦點                   | [桌面](desktop-recovered.png)      |

所有畫面都是「測試資料預覽 · 僅本機住宿備忘」，不代表校方申請或真實住宿資料。

## 測試來源 SHA-256

| `apps/web/src/app/dormitory/` | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| page.tsx                      | `daaa591bc4013b1650123d2e2bd9e7f28cecfafd4ca48af71ca4a31ea67b4462` |
| dormitory.module.css          | `819aebfd3358a5f849998fd4ec13e052157f09596275d18687b6af3f47e0843c` |
| reloadRecovery.test.tsx       | `97af356be5fbec791c0fd77f5387d2572248822e1b65c199a9f55d981ae724d4` |

## 未驗收與交付邊界

Safari／Firefox、真實讀屏、實體手機與完整登入導覽未跑。這是同瀏覽器 localStorage 的重讀恢復修正，不是跨裝置同步或資料庫原子交易；沒有改保存契約、資料格式、API、權限、依賴、CI、安全設定或部署，也沒有恢復校務抓取。還原此提交即可回滾，無 migration。

精確 PR head 的遠端 CI 另由 PR 結果追蹤。合併仍由主線窗口依 required checks／reviews 與指定 `nuni-merge-gate`「審查通過」協調，本工作不自行 approval 或 merge。
