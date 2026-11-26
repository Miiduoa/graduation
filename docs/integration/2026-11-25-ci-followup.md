# 2026-11-25 整合候選 CI 修復紀錄

本紀錄接續 [38 個來源的整合與驗證](./2026-11-25-all-branches-reconciliation.md)，修復 [PR #768](https://github.com/Miiduoa/graduation/pull/768) 首次送審後實際發現的問題。本輪驗證延續至台灣時間 2026-11-26；產品來源截止時間仍為 2026-11-25 22:43，沒有將其他治理提案混入這次修復。

## 已發布版本與第一輪遠端結果

第一輪 head 為 [`7cac19f9205c9481233f228d2e68c9783a699bd0`](https://github.com/Miiduoa/graduation/commit/7cac19f9205c9481233f228d2e68c9783a699bd0)，tree 為 `f97634ddce6cc1ad5107f3c503bf5c584ecca01a`。發布後重新 fetch 證明整棵 tree 與本機受測候選相同，來源清單中的 38 個 head 均為祖先，#797、#798 未納入。

以下是第一輪的實際結果，不代表包含本文件之後續 head 已通過：

| 範圍 | 第一輪結果與證據 |
| --- | --- |
| 完整 Mobile | [604 suites passed／1 skipped；12,711 tests passed／1 skipped](https://github.com/Miiduoa/graduation/actions/runs/45638915016/job/139291802046)。 |
| 完整 Web | [970 files passed／1 failed／16 skipped；39,908 tests passed／1 failed／147 skipped](https://github.com/Miiduoa/graduation/actions/runs/45638915016/job/139291801886)。唯一失敗是意圖分類器效能案例約 215 ms，超過既有 200 ms 門檻；語意斷言通過。 |
| Lint、TypeScript、Functions、Firestore、Assistant Integration | [各工作通過](https://github.com/Miiduoa/graduation/actions/runs/45638915016)。Web／Mobile build 被前置失敗跳過，不能算建置完成。 |
| Security Gates、Admin、Campus Spatial Browser | installer 測試在共同的 font fallback 路徑失敗；後兩項尚未執行實際 UI 驗收。 |
| 完整歷史掃描 | [新 main 的 squash 重現一個既有本機 emulator fixture 的精確 fingerprint](https://github.com/Miiduoa/graduation/actions/runs/45638914780)。 |
| CodeQL | [分析工作完成，但 CodeQL check 發現兩項 high 問題](https://github.com/Miiduoa/graduation/runs/139300981927)，分別是 Native 作業描述的 regex tag removal 與 Web 發文圖片預覽的 DOM source。 |
| Interface Design Browser | [既有主要導覽／字體／按壓期待與新版設計不一致，另發現窄畫面課務導覽的焦點與排版問題](https://github.com/Miiduoa/graduation/actions/runs/45638914636)。 |
| Timetable Browser | [production guest smoke 在原生拖曳步驟未返回，整個工作到時取消](https://github.com/Miiduoa/graduation/actions/runs/45638915269)。 |
| Android NFC | 第一次因 Maven HTTP 429 無法下載依賴；以正常 job rerun 後，[編譯與 APDU protocol tests 成功](https://github.com/Miiduoa/graduation/actions/runs/45638915153/job/139296034551)，未修改 Android 程式。 |

修復期間遠端另新增 [`7182f35a1a74eddef573dd544ad147da210883b1`](https://github.com/Miiduoa/graduation/commit/7182f35a1a74eddef573dd544ad147da210883b1)，只強化主要導覽的真實連結、名稱與單一 active route 驗證。已先查核並正常合入該提交，再合成較完整的 label／path 與介面修復；發佈時以該最新遠端 head 為父提交及更新 lease，保留並行工作。舊版 Maestro 在 iOS build 階段取消，與新 head CI 的啟動時間相近；尚未執行 smoke／full tests，沒有將取消當成 E2E 失敗或成功。

## 修復內容與局部驗證

### 瀏覽器安裝與提升權限邊界

`install-playwright.test.sh` 的四個 patched fixture 改為保留 `scripts/qa/browser` 相對層級，讓真實的 process identity helper 可正常載入。實際 installer 將下載檔放在呼叫者獨立的私有暫存目錄；每次安裝才複製到該次 elevated attempt 的私有目錄，並在提升權限後重新比對固定 SHA-256，成功、重試與結束都清理各自的檔案。

原有 root、PID、nonce、程序識別及清理限制保留。新增下載後遭替換的測試，要求 privileged `dpkg` 完全不能執行。於隔離 user／PID namespace、root-owned 1777 `/tmp` 的正常信任模型下，**24／24 installer tests 通過**；移除 elevated digest recheck 的負向控制確實失敗。`bash -n` 與 diff whitespace check 通過，未變更 workflow gate。

### 課務導覽與新版介面驗收

課務導覽的 focus-visible selector 增加自身容器範圍，保留 inset focus ring，避免被頁面通用連結規則覆蓋；窄畫面改用可換行 flex，200% 字體下匯入操作可移至下一行，當前分區仍完整可見。

Interface QA 現在量測真實的五個主要導覽連結，並精確驗證文字與路徑；裝飾標題不再當作連結。按壓效果改驗證實際設計的 opacity 前／中／後變化及 reduced-motion，字級依目前 token 驗證。既有生活服務仍透過明示 fixture 入口驗收，保留搜尋、返回、IME、焦點、44 px 點擊範圍與遮擋檢查。

- **原 8 個 headless scenarios、306 checks 通過**；所有產品修正後再次重建及完整重跑，416 份來源 hash 與受測工作樹相符，無 page errors／外部請求。
- 320 px 與 390 px、200% 字體的課務分區與焦點截圖經人工覆核。
- CSS、意圖分類器及助理登入修正後，AI workspace 最後再次重新建置，**8 scenarios／55 checks 通過**，376 份來源 hash 零漂移、40 張截圖；未直接納入 bundle 的課表拖曳另由專用 production smoke 驗證。
- 第一輪遠端的 8 個 headed notification 情境已通過；本機未將其宣稱為重跑結果，完整新 head 仍由 CI 驗收。

### 歷史掃描：僅接受已核對的同一 fixture

新 fingerprint 精確限定為 `149cfbe2f806ee15da1985854b34dfe72a7e07d9:scripts/test-env/verify-tronclass.cjs:generic-api-key:53`。它與已納入的來源及第一輪 head 的整份 helper 為同一 blob `d85bd50fa1d4f0b86a36247b316822831f0d375a`，內容 SHA-256 為 `041fd00f154b66dd3bc73096e4e9627abaa8eb21043f01e3c5a7ab96a6cd6292`；匹配值是已審查 emulator seed 的公開測試值。helper 仍限制 demo project、loopback emulator、development，並拒絕 production／service-account／DB／signing 設定。

新增獨立、固定的 reviewed fixture 身分，由 validator 綁定原 fingerprint、觀測 commit、完整 path／line／rule 及整份 blob；原本最多兩筆 test alias 的限制保持不變。只加入這一筆 commit-scoped fingerprint，沒有 path 級忽略、偵測器停用或 generic token 排除。

**25 項 Node regressions、25 項 fingerprint／blob 驗證與 6／6 positive controls 通過**。控制包含同一 helper、同一行號但新 commit 的隨機 marker，仍必須被偵測。固定版 Gitleaks 8.24.3 完整掃描 **3,295 commits／約 152.5 MB**，exit 0、0 findings。另由第二位 reviewer 獨立覆核限定範圍及失敗控制。

### 兩項 CodeQL 修復

Native `CourseModulesScreen` 改用既有 `homeworkDescriptionText` 純文字轉換器，取代逐段 regex 移除 tag；仍呈現於 React Native `Text`，保留作業資訊與使用者明確點選後的原始作業入口。新增實際展開畫面的測試，涵蓋 tag、script／style、註解、entity、截斷、長度界線與原始入口。相關 **4 suites／85 tests 通過，完整 Native typecheck 通過**。

Web 圖片預覽以各自的 `File` 建立 object URL，賦值前要求 `blob:` 且與目前頁面同來源；非法 URL 不成為圖片來源。替換、刪除、離頁及 effect cleanup 均回收該次 URL。上傳繼續使用原本的 `File`，移除多餘且可能不同步的 preview state。元件與發文頁 **2 suites／24 tests 通過，完整 Web typecheck 通過**，並完成獨立生命週期覆核。沒有 CodeQL suppression；實際告警是否消除須看新 head 的 CodeQL。

### 意圖分類器效能

將原本一定回傳 `ambiguous` 的 unproven-write 判定，移至相同 quote／filename stripping 之後、private-read 模型建構之前。判定語意、輸入集合、200 ms 門檻及八筆 token cache 大小皆維持原樣；已需確認的句子不再建立後續不會使用的 read routing view。

同版 Node 22、V8 coverage 下，原 1,260 句案例從本機 baseline **69.55 ms** 降至最終 **29.18 ms**；獨立 50 輪精準 coverage profile 中位數約 **66.55 → 32.88 ms**。本機 baseline 原本就通過，不能宣稱穩定重現 GitHub 的 215 ms。新增正反請求、引號與否定交替，以及超過 LRU 容量後回訪的回歸，最終相關 **6 個檔案／9,482 tests 通過，0 skipped**。

### 課表原生拖曳被版面位移取消

以同一 production build 重現：`dragstart` 同步在網格前插入 status，來源課程位置改變，Chromium 立即產生 `dragend`，沒有 `dragover`／`drop`。Playwright 1.57 隨後等待未發生的 `Input.dragIntercepted`，造成工作直到整體逾時才取消。先用真實「移動課程 → 取消移動」讓同高 status 已存在時，其他程式不改，原生拖放便能完成；這個對照只用於定位，未放入正式驗收。

產品在原生拖曳時保留既有文流提示的幾何，將拖曳／非法目標訊息放在可見、`aria-live`、不攔截指標的固定提示中。長課名與錯誤訊息換行都不會移動網格。鍵盤操作仍使用原提示位置，拖曳結束清除即時狀態；原有 disabled、來源課程核對、續堂 offset 與明確儲存流程保持完整。

Browser smoke 改用有期限的 Chromium 原生滑鼠輸入，由瀏覽器自行產生 DragEvent／DataTransfer，沒有合成 DOM 拖放或注入課程資料。除原斷言外，現在要求四個可信任事件、dragstart／drop 的正確 course ID、星期二第七節落點、來源矩形不位移及重載後的精確儲存資料；失敗截圖、事件及 trace 也有清理期限。

- movement **2 suites／37 tests 通過**。
- 重新建置實際 Next production 網站後，原 **9／9 browser checks 通過，0 page errors**。續堂移動後為星期二第 6–7 節，焦點與儲存後重載一致。
- 正式原生拖曳前後來源矩形完全相同：`x=347, y=685.390625, width=197, height=64.5`。
- 長課名與 200% 字體補充驗證的 **5 項前置／儲存核心通過**：在桌面 viewport 內將提示盒限制為 320 px，26 px 字體換成約 247 px 高，完整可見且來源矩形不變。這是窄提示盒測試，沒有將它稱為手機 viewport 或另一輪完整 9 項驗收。
- 第二位 reviewer 獨立核對產品、原生事件、矩形、readback 與長課名截圖。

### 助理登入保留原服務，現場草稿不進網址

修好課表後，後段 production 校園入口驗收揭露另一個實際回歸：共用助理有未送出草稿時，登入連結改跳 `/ai-assistant?q=...`，將現場輸入帶入網址並丟失原服務分類／搜尋。這與 [既有返回契約](../ux/2026-11-14-user-journeys.md)及[新版工作區文件](../ux/2026-11-24-ai-workspace.md)的「記憶體草稿、完整登入重載清稿、返回原服務」約定相反，不能靠改測試接受。

`TodayCampusEntry` 移除草稿組合登入 query 的分支，使用原本已核對的 current return path、校園與展開助理的錨點。原頁的合法搜尋（例如生活目錄 `q=借書`）繼續保留，現場編輯草稿不會取代它。同文件收合／重開仍可接續；完整登入重載清除現場草稿，只展開助理、不自動送出問題。既有明示 `/ai-assistant?q=...` 連結的一次帶入保持原樣，沒有全域刪除合法 query。

新增首頁、生活目錄與明示助理連結三個真正工作區回歸，在舊程式都精確失敗；修復後相關 **8 suites／295 tests 通過，0 failed／skipped**。檢查完整內外層參數、原服務返回、local／session storage 沒有現場草稿、收合接續、重掛載清稿，以及 0 次自動問答。產品與測試經獨立覆核；正式 browser 的 document timeOrigin、原頁返回與清稿斷言完整保留。

同一後段驗收也更新已變更設計的精確期待：主要導覽與無目錄來源時的 breadcrumb 使用「探索」及 `/explore`，有明確生活目錄來源時仍返回原目錄與篩選；白色主題依目前 `--bg: #ffffff` 驗證。舊生活 deep link、實際 Back／Forward、焦點、校園、登入權限與成員資料保護斷言均保留。

新生活目錄入口透過真正的桌面「工作工具 → 校園生活」Next Link，點擊後恢復原 viewport，並要求 `performance.timeOrigin` 不變；因此同文件的新入口隔離仍會被驗證，不以整頁重載清除記憶體代替。最終產品修正後的完整 Web TypeScript 為 exit 0、無診斷。

最後在同一份 Next production build 完成 **Timetable 9／9、完整 campus-visual 63／63**，兩者 page errors 均為 0。補強同文件新入口斷言後，又以同一 build 完整重跑 63 項通過；最終腳本 SHA-256 為 `6c87bea99bdcb831ce8f8ca5dcd6ed87a6ca239ac58ec834145f8074aed7e8d8`。正式執行保留所有情境，另存的中途診斷不計入完成結果。課表留存 6 張截圖與 trace，校園入口留存 61 張截圖；產品來源於執行前後均無變動。

## 本機產物指紋

下列為本輪實際產物 SHA-256，用於核對本機證據；可下載的新 head CI 產物仍以各工作 artifact 為準。各輪測試有重疊，不相加為總測試數。

| 產物 | SHA-256 |
| --- | --- |
| Interface headless results | `f262f0ccc7f2e5f56512faed2e0d5afc32bf8e807d6a568072727b1b3c7390e6` |
| Interface source manifest | `32bdcdbe06fb3f673e18c9ca0714ca840283a7afe91b84255ddd97e9f5bf6ecf` |
| AI workspace results | `cd8cda393665c54a3eeabc54e71d20981a4bb920266b933d8396a41558ffbe6c` |
| AI workspace source manifest | `193c1373964378d1c9c50dbe1018c654405d9cc73b830dd03b2144cc8e88556f` |
| Intent／server-agent final tests | `ab27c0fa39d1345ee6ec00cdd36a7f1214f0487b43946369256665a181c4a1c8` |
| Verified history aliases | `cbe6fd6ccd753356f60fe1c7907f450e901efc9bc1e62091f8d88baa3cd14733` |
| Full history scan JSON | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` |
| Timetable production results | `a9d119b1633eaa9f55877c4b1c29c92d6a1ad6e2769ec2d9d7ced7cd923bd40a` |
| Timetable native drag events | `32500e58874b3da750ae3c709ed06404bc6509ce8de24c4aea10997e5f9870a9` |
| Timetable source bounds | `3c1625b0d278cc0969b641de994292cce01bd4bc0c43a3fd30b5518952e3d820` |
| Assistant login privacy regressions | `289d1927313d54e7dcb1c54ff260e08d6da51ffbefd27d225aff595bd3f01f51` |
| Campus visual production results | `e7dd16bbae5af7487f4155d386fcc6f0528b8d3a528f4862e3b08435eecc73a0` |

## 後續 head 的驗收與發布

本文件是修復內容與分輪證據，不能把第一輪成功 check 移植到新 head。更新同一 PR 後，需重新確認 exact tree、來源祖先、主線與 head lease，並以新 head 的完整 CI、CodeQL、資料庫／政策測試與指定 App 核可決定是否能合併。

[main ruleset 26004626](https://github.com/Miiduoa/graduation/rules/26004626) 的 App 5504170「審查通過」及其他必要 checks 保持原樣。尚未取得的核可不能由一般 review 或另一個 App 代替；skipped build／EAS Update 不代表建置或正式部署完成。本輪未執行正式 migration、遠端功能啟用或真實校方帳號寫入。
