# Campus One 體驗整合驗收｜2026-10-25

本次整合既有功能分支，補齊 Web 與 App 的入口、操作流程與跨校資料隔離，並完成本機測試及 production build 的瀏覽器驗收。主要整合 [PR #201](https://github.com/Miiduoa/graduation/pull/201) 已合併至 `main`，提交為 `d78d170d8ab16cf6cbac6bf037931f3b70a8ffd9`；後續登入入口補修的狀態與 CI 亦連於該 PR 驗證區。此紀錄不代表正式站、商店 App 或所有後端功能已發布。

## 來源與範圍

初始整合基底：`main` 的 `6abe69be1520176e4714fe709b85360ad65e5a0c`。下列四個 PR 以 merge commit 保留原始歷史，再加入本次體驗修正；GitHub 已將四個原始 PR 標記為合併。整合另保留主分支的 `8e838cbb`（#200 舊畫面清理）與 `3f5c9987`（#199 新登入入口），沒有覆蓋同時完成的工作。

| PR | 原始 head | 整合內容 |
| --- | --- | --- |
| [#165](https://github.com/Miiduoa/graduation/pull/165) | `8d8b79b63da5111b5ae8244ea23a4774e247ad23` | 依學校提供課務來源、助理與校園服務入口 |
| [#170](https://github.com/Miiduoa/graduation/pull/170) | `99b02bd1f545c4b754bd24c254bb9c2066c3f982` | 跨校資訊、活動報名及個人行程提醒 |
| [#172](https://github.com/Miiduoa/graduation/pull/172) | `e6a95343e377b5b2ae2cf71cc92a29d60f447bae` | 失物招領跨端恢復、教材查找及學分試算 |
| [#169](https://github.com/Miiduoa/graduation/pull/169) | `45bdf1ae502eb1a6604a55c26947a879688e4932` | 校方權責、平台監督及 Web／App 管理工作區 |

## 完成的操作改善

- **Web 導覽與設定**：主要導覽、服務選單與校園切換保留目前學校；選單支援搜尋、鍵盤操作、空結果恢復及關閉後焦點返回。設定分區支援深層連結、頁面片段及瀏覽器上一頁／下一頁。行動底部導覽不遮住最後一個操作。
- **今天頁與個人資料**：沒有截止日期的待辦仍可見；更多待辦入口保留課程脈絡；相同 ID 的內容更新會刷新主要提示。帳號或學校切換時，個人紀錄與手動課表依所屬範圍更新，避免顯示上一個範圍的內容。長標題、大字體及 OLED 深色模式一併驗證。
- **App 搜尋與課程入口**：全域搜尋提供明確的服務入口、結果與空狀態，導航對應實際註冊畫面；課程查詢使用正確學期，不再沿用過期固定值。跨校官方服務保留所選學校。
- **課表、活動與提醒**：課表可用拖曳及鍵盤移動，支援取消、儲存、重載與今天空堂操作；未確認節次的學校不借用其他學校時刻。活動搜尋期間仍可載入下一頁；個人行程提醒保留排程、取消及恢復的一致性。
- **失物、教材與學分**：失物招領補齊草稿與跨端恢復；教材查找涵蓋後續資料頁；學分試算依有效成績及學校規則計算，並呈現資料不足狀態。
- **管理工作區**：區分平台管理、學校管理與服務人員權責。保留 CSV 公式防護、匯出範圍標記及分頁操作紀錄匯出；帳號、學校或角色改變時，舊匯出操作立即失效，暫存檔會清除。管理員降級後不能沿用舊選單匯出私密紀錄。
- **新版登入入口**：登入入口與登入 transaction 保留目的頁的校園、分頁、設定分類、活動來源及合法內容定位；篩除巢狀跳轉與憑證參數，維持站內路徑限制。頁尾使用成對主題色，深色模式不再出現近白背景配近白文字。

## 驗證結果

### 最新整合與登入補修

| 範圍與版本 | 結果 |
| --- | --- |
| 主要 PR head `503646f7` 的完整 Web CI | 2,984 項通過、11 項略過；266 個檔案通過、4 個略過 |
| 同一 head 的完整 App CI | 3,280 項通過、1 項略過；297 suites 通過、1 個略過 |
| 同一 head 的建置與安全檢查 | Web standalone runtime、App 雙平台 JavaScript bundle、型別、Lint、Functions、安全與權限閘門全部通過；實際 CodeQL check 成功、0 annotations |
| 同一 App 原始碼的 iOS 模擬器 | 原生建置成功，iPhone 15 模擬器上的首次開啟／登入入口及校園地圖兩條 smoke flows 通過 |
| 與最新 main 合併後的樹 `407e03b9` | 完整 Web coverage 3,027 項通過、11 項略過；268 個檔案通過、4 個略過；production build 及 32 項瀏覽器檢查通過 |
| 後續登入補修 | 兩個受影響 suites、88 項回歸測試通過；scoped lint、包含完整 TypeScript 的 production build 通過 |
| 登入補修後的正式瀏覽器驗證 | 26 項視覺／登入操作與 8 項課表檢查，共 34 項通過；明暗頁尾連結含透明度的有效文字對比皆達 4.5:1 |

主要遠端證據：[CI](https://github.com/Miiduoa/graduation/actions/runs/40160729129)、[瀏覽器](https://github.com/Miiduoa/graduation/actions/runs/40160729092)、[iOS smoke](https://github.com/Miiduoa/graduation/actions/runs/40160729050)、[CodeQL 實際檢查](https://github.com/Miiduoa/graduation/runs/121072189952)。最新主分支與後續登入補修均只改 Web、瀏覽器測試與文件；App／shared／Functions 原始碼及相依版本保持與上述原生驗證一致。

登入回歸驗證涵蓋已登入狀態下的返回操作，以及 Google／學校登入 transaction 寫入契約；未使用真實身分提供者或校務帳號完成正式 OAuth 往返。不同版本、範圍的測試有重疊，不加總成單一測試數。

### 前期整合紀錄

下表是不同範圍、不同輪次的實際結果；部分測試重疊，**不加總成單一測試數**。Web 全量測試完成後另有最後一輪課表調整，已補跑相關 28 項測試、production build、Web typecheck 及完整瀏覽器檢查。

| 範圍 | 結果 |
| --- | --- |
| Web 全量 | 264 個檔案通過、4 個略過；2,973 項通過、11 項略過；exit 0 |
| 最後一輪課表相關測試 | 28 項通過 |
| 教材分頁補修 | 兩個受影響 suites 開啟 coverage，23 項通過；Web typecheck 與 scoped lint 通過 |
| CodeQL 警示對應修正 | Web 44 項、Functions 81 項通過；型別與 scoped lint 通過；獨立 Functions production package 成功載入 121 exports |
| Web production build | 完成，建置檢查通過 |
| App 整合測試 | 36 suites／542 項通過 |
| App 最終導覽相關測試 | 7 suites／148 項通過；與整合測試重疊 |
| App 管理及授權 | 管理 14 suites／68 項、身分權限 29 項通過；與整合測試重疊 |
| Functions | 管理及授權 207 項、助理 75 項通過 |
| Firestore／Storage emulator | Node 174 項及 Web emulator 10 項通過；0 失敗、0 略過 |
| Typecheck | shared、mobile、Web 全部通過 |
| Lint | 0 errors；仍有既有 warnings |
| 最終本機瀏覽器 | 視覺與操作 18／18、課表 8／8，共 26 項通過；兩組 exit 0 |

瀏覽器使用本機 production build、訪客狀態及明確的測試資料；檢查 1440、768、390、320 px 版面、200% 文字縮放、OLED 外觀、選單鍵盤操作、設定連結及課表學校隔離。這些結果不包含原生實機、真實學校帳號或正式環境部署驗收。

PR 第一輪全量 Web CI 在「繼續載入較早教材」案例出現一次下一頁未顯示的失敗。學習路徑與教材搜尋的按鈕原先以 state 渲染，卻從稍後由 effect 同步的 ref 讀取分頁資料；補修改為直接讀取渲染按鈕的 state，並增加下一頁 cursor 的立即請求斷言。帳號／請求範圍與取消機制維持原有防護，沒有放寬測試 timeout。這筆補修在上述本機全量 Web 測試之後；最終整合結果以 PR 最新 commit 的完整 CI 為準。

CodeQL 的分析工作成功執行後，另有 7 項安全掃描警示。對應修正使用明確的 Firebase provider ID 等值比較、直接呈現學期欄位，以及 parse5 的單次 HTML 解析與迭代文字節點走訪；測試 mock 亦改為精確 hostname 比較。parse5 7.3.0 已加入 Functions 正式依賴與兩份鎖檔，並通過獨立 production 安裝／載入檢查。沒有停用規則或關閉警示；最終結果須同時檢查 CodeQL 分析工作與 code-scanning check。

### 遠端整合檢查與主分支更新

修正後的 `83edbdc895cd2ed84a0b31418bb302891ea97b50` 已完成 [GitHub CI](https://github.com/Miiduoa/graduation/actions/runs/40158601724)：Web 2,978 項通過、11 項略過；App 3,276 項通過、1 項略過；建置、型別、Functions、權限與安全閘門皆通過。[CodeQL 的實際 code-scanning check](https://github.com/Miiduoa/graduation/runs/121065969143) 成功，這次 PR 的變更沒有新增警示。

[iOS Maestro](https://github.com/Miiduoa/graduation/actions/runs/40158601730) 亦完成原生 App 建置，在 iPhone 15 模擬器上通過首次開啟／登入入口與校園地圖兩條 smoke flows；這不等同所有 Maestro flows 或原生實機驗收。

最後核對時，主分支新增 #200，故再整合其舊頁面刪除、轉址、成績分頁及通知／訊息標題。已完成的官方住宿／職涯服務集中至可達的學校資訊頁，搜尋與成績分頁同時保留目的頁參數及目前學校；無入口舊實作維持刪除。上述測試數屬於整合這筆主分支更新之前的確切版本；最新合併版本的完整結果與驗證範圍記錄於 [PR #201](https://github.com/Miiduoa/graduation/pull/201)。

納入 #200 後，本機重驗 Web 19 suites／233 項及 App 18 suites／266 項全數通過，兩端完整型別檢查與編輯檔案 lint 無錯誤。Web 重新完成 production build，視覺／操作 18 項與課表 8 項再次通過；下方五張畫面已用這次建置重新產生並核對。

## 畫面與可核對證據

共保留七張 PNG，以及最新的[視覺／操作結果](campus-experience-20261025/results.json)與[課表結果](campus-experience-20261025/timetable-results.json)。以下畫面皆為訪客與本機資料，沒有使用正式學生帳號。

桌面首頁：今天頁、主要導覽與服務入口。

<img src="campus-experience-20261025/home-desktop.png" alt="本機訪客桌面首頁" width="720">

手機服務頁：OLED 深色模式與可操作的服務分類。

<img src="campus-experience-20261025/services-oled-mobile.png" alt="本機訪客手機服務頁，OLED 深色模式" width="280">

手機設定頁：分區導覽與設定項目。

<img src="campus-experience-20261025/settings-mobile.png" alt="本機訪客手機設定頁" width="280">

其餘畫面：[手機 OLED 首頁](campus-experience-20261025/home-oled-mobile.png)、[手機服務搜尋](campus-experience-20261025/service-search-mobile.png)。

新版登入頁：明暗主題使用一致的介面層級，頁尾資訊保持可讀。

<img src="campus-experience-20261025/auth-account-mobile.png" alt="新版登入頁，淺色手機畫面" width="280">
<img src="campus-experience-20261025/auth-account-oled-mobile.png" alt="新版登入頁，OLED 手機畫面與清楚的頁尾連結" width="280">

## 重跑入口與發布界線

使用 Node 22、pnpm 10；emulator 另需 Java 21。從 repository 根目錄可重跑核心檢查；完整測試範圍以最終 PR CI 為準。

```sh
pnpm typecheck
pnpm lint
pnpm --filter web test
pnpm --filter web build
pnpm --filter mobile test --ci
pnpm --filter functions test --runInBand
pnpm test:rules
```

瀏覽器需先依 [Timetable Browser workflow](../../.github/workflows/timetable-browser.yml) 準備 standalone 的 static／public 資產，再啟動本機伺服器；以下瀏覽器指令在另一個終端執行，須已安裝 Playwright Chromium。

```sh
HOSTNAME=127.0.0.1 PORT=3100 node apps/web/.next/standalone/apps/web/server.js

TIMETABLE_TEST_URL=http://127.0.0.1:3100 python scripts/timetable-browser-smoke.py
CAMPUS_VISUAL_URL=http://127.0.0.1:3100 python scripts/campus-visual-smoke.py
```

兩個瀏覽器腳本均限制 loopback 目標。本機 emulator 若受 HTTP proxy 影響，僅在該測試程序移除 HTTP(S) proxy；本次沒有修改正式網路或服務設定。

一般 PR／push 的 GitHub CI 不會部署 Web、App 或 Firebase。正式發布需另行使用既有發布流程，並核對實際來源 SHA、服務狀態及發布結果；本驗收不宣稱已上線。
