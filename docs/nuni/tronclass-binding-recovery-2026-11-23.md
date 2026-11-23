# TronClass 綁定取消、恢復與主線整合

日期：2026-11-23（台灣時間）。

## 本輪來源

接續 PR #616 的 `04ca3983b3eda1d0163363f233d9094e1932b4d5`，以正常雙親合併保留 main `f7f5acba2177562ed42ea73067d094b6e7946edb`。程式提交為 [4ca45957](https://github.com/Miiduoa/graduation/commit/4ca45957210181a940436f6808de5508b84bbcf5)，tree `80a7ae6b2dc0b64d9b6c9c2bd87634f423b12ee4` 與本機最後驗證的程式樹一致。後續文件提交不改變程式。

## 使用者會遇到的問題與修正

### 1. 離開登入流程後，舊請求仍可能完成綁定

原本 Web／Mobile connect 沒有把使用者取消傳到 BFF、校方原生登入、CAS 跳轉與 profile 查核。頁面雖然已離開，晚到的登入結果仍可能進入綁定交易。

現在 Web 與 Mobile 都有「取消連接」，並將同一操作的 AbortSignal 傳到真正的請求。切換實際 nuni owner／context、卸載工作區會中止登入；Mobile 也處理路由失焦與切到背景。伺服器在取得資料庫、登入、每次跳轉及綁定交易讀取後、寫入前重新檢查取消。即使 provider 忽略 signal，晚到結果也不能繼續建立綁定。錯誤使用固定的 `TRONCLASS_LOGIN_CANCELLED`，不回傳呼叫端的 abort reason。

已經開始的登入保留原有次數限制。原本的 session 加密、revision 比對、每跳期限及整段期限維持有效。

**取消不能回滾已送出的 Firestore commit。** 因此前端取消後會先重新讀取綁定狀態，再決定顯示已連接或使用最新 revision 重新登入；不把取消當成解除綁定。舊請求的晚到成功或 finally 不能覆蓋、啟動同步或解除新請求的操作鎖。

### 2. 同一個帳號的背景更新不應中斷登入

Web 原本以整個 session／Firebase user 物件作為 client memo 依賴。同一平台帳號與 context 被換成新物件，或平台登入優先時 Firebase 在背景更新，都可能誤判成身分改變。

現在只依有效平台帳號與 context，或實際啟用的 Firebase UID 建立 client。同 UID 的 Firebase token getter 由最新 user 提供；真正換人仍會中止。回歸包含相同 session 新物件、無關 Firebase 更新，以及真實 owner／context 變更。

### 3. 一筆壞課程資料不應讓正常課程全部失去快取

main 容許舊快取夾有格式不完整的獨立課程列，TronClass 分支則增加較嚴格的課程歸屬檢查。直接合併會使 main 的正常恢復行為退步。

現在先建立已驗證的 `{ id, name }` 清單，略過無有效編號或名稱的獨立壞資料列，回傳內容也不再夾帶那些列。作業、錯誤、教材與公告仍只能引用這份清單中的課程。重複編號、外部課程參照、401、已到期的部分同步快取，仍使來源重新查核或拒絕；沒有以容錯放寬課程隔離。

### 4. 保留主線與 TronClass 的兩套近期改動

合併解決 AI 助理、課務快取、CI 與瀏覽器安裝腳本的七個衝突。保留 main 的任務重試、地圖／活動、帳號展示與介面調整，以及 TronClass 私人查詢、附件下載與作業準備。TronClass 結果不會進入一般雲端對話歷史，專屬指令也不會誤入其他新分支。CI 同時保留兩邊的驗證工作與 main 的套件安裝恢復機制。

## 實際驗證

執行環境：Node 22.23.5、pnpm 10.28.2。下列測試有重疊，不相加為另一個總數。

| 範圍 | 結果 |
| --- | --- |
| 最後凍結程式的完整 TronClass／校方登入 Web 回歸 | 71 個測試檔、2,521 項通過；另 4 檔、38 項環境相關測試略過，0 失敗 |
| 最後凍結程式的 Mobile 工作區、client 與 session controller | 3 個測試檔、185 項通過，0 失敗 |
| AI 助理合併邊界 | 6 檔、92 項通過，涵蓋私人資料、角色、地圖、任務重試與帳號展示 |
| 課務快取檔 | 160 項通過，包含最初失敗案例與新增的七組歸屬／401／時效檢查；已包含於 Web 回歸 |
| 完整 Web／Mobile TypeScript | 兩端均 exit 0；Web 在最後身分穩定化修改後再執行一次並通過 |
| 本輪 18 個修改程式檔及兩個 AI 合併檔的 ESLint／diff | 通過、零警告；沒有放寬 lint 設定 |
| 擴及自動合併檔案的 ESLint | Web 19 檔、Mobile 6 檔皆零錯誤；Web 有一項 main 已存在的首頁 effect 警告，詳見下段 |
| 瀏覽器安裝腳本 | 11 項通過，包含真正的 timeout／套件鎖恢復與慢速字型下載模型 |
| 隔離環境 launcher 與 seed | 5 項通過 |

第一輪 Web typecheck 與其他大型工作並行時曾被系統終止（exit 137）；停止測試服務後單獨完整重跑通過，最後凍結版本再查一次也通過。沒有將第一次中止列為成功。

較大範圍的 lint 使用 `--max-warnings=0` 時，因首頁 `src/app/page.tsx` 第 215 行的既有 `react-hooks/set-state-in-effect` 警告失敗。另以 `git show origin/main:apps/web/src/app/page.tsx` 傳入同一路徑的 ESLint stdin，確認 main 原碼有相同警告；本分支相對 main 的首頁差異只有 TronClass 入口文案與連結。保留原檢查設定與既有首頁行為，未把此較大範圍宣稱為零警告。一般 ESLint 執行為零錯誤，CI YAML 可解析。

主要重現指令：

```sh
pnpm --filter web typecheck
pnpm --filter web exec vitest run tronclass tronClass TronClass puCampusClient --maxWorkers=2
pnpm --filter mobile exec tsc --noEmit
pnpm --filter mobile exec jest src/__tests__/TronClassWorkspaceScreen.test.tsx src/__tests__/tronClassIntegration.test.ts src/__tests__/nuniSession.test.ts --runInBand
bash scripts/qa/browser/install-playwright.test.sh
node --test scripts/test-env/tronclass-launcher.test.mjs scripts/test-env/seed.test.cjs
```

## 完整本機服務與真人測試的界線

本輪啟動真正 Next.js、Auth Emulator 與 Firestore Emulator。2026-11-23 14:02:55 的 HTTP 驗證確認錯密碼、無效 token、停用帳號拒絕，以及公開測試帳號的綁定狀態跨請求保存與帳號隔離；14:03:05 的健康檢查為 `/health/live`、`/login` 皆 200。測試未使用校方帳密，沒有校方登入或寫入；此結果不代替新取消行為的真人 HTTP 驗收。

當次可用的雲端瀏覽器沒有校方登入狀態。本機 nuni 服務在該瀏覽器的 `127.0.0.1` 不可達，回報連線拒絕；後續錯誤頁觀察亦被瀏覽器政策拒絕，因此沒有用替代控制方式繞過。公開校方入口能正常顯示，但不代表真人 nuni 綁定成功。完成檢查後已停止本機測試服務。

本輪沒有完成真人帳號「nuni 綁定 → 同步 → 私人附件下載 → 上傳 → 正式繳交 → 本人精確讀回」。production factory 的 `contractVerified: false` 保留；實際 PU 上傳目的地、binary／callback、正式 acknowledgment 與收件仍待驗收。既有受控首次純文字驗收入口見 [ACCEPTANCE.md](../../scripts/tronclass/ACCEPTANCE.md)。

PR #616 需以本輪最新 head 重新取得 CI、CodeQL、原生／瀏覽器驗證，以及 ruleset 要求的指定 App「審查通過」。本機結果、舊 head 的綠燈、或僅有校方登入畫面，都不代替這些結果。這份文件不宣告合併、正式部署或完整作業繳交能力已上線。
