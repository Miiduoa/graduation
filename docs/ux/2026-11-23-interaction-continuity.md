# 搜尋與輸入的操作連續性

日期：2026-11-23（台灣時間）。開發基準：`15bdca30796646d93263ddf8442eca248aa196b4`。

## 本輪目的

讓使用者搜尋、開啟服務、返回及填寫表單時，可以從原本的位置接著做。改善涵蓋 Web 的全站搜尋、生活與交流目錄，以及原生 App 共用頁面、搜尋列和意見回饋。

### Web：正式搜尋能直接進入結果

- 生活與交流目錄新增「查看結果」。Enter、手機鍵盤的搜尋鍵與按鈕走同一個提交動作。
- 即時輸入與分類切換保留目前焦點；只有明確提交才聚焦結果標題。
- 結果標題涵蓋全部服務、單一分類、免登入、一般搜尋及找不到結果；服務數量與標題相鄰，清除篩選返回搜尋欄。
- 搜尋列依容器寬度與字級改成上下排列，窄版移除裝飾圖示，保留輸入與按鈕的可用空間。
- 中文組字 Enter、`isComposing` 與 `229` 不誤觸提交。Escape 在組字期間交由輸入法處理。

### Web：開啟服務後，返回原入口

- 一般服務、相關服務、推薦入口與「交給校園助理」都記錄當次離開的入口。
- 真正的 Back／Forward 回到同一個 history entry、URL、帳號／工作階段、校園和搜尋條件時，恢復對應入口焦點與可見位置。
- 相關服務的父層展開區塊一併恢復；捲動採即時最短位移，避免長距離動畫。
- 定位延至瀏覽器 history 還原後的下一幀，先中止仍在進行的原生平滑捲動，再移到原入口；避免結果先出現、隨後又被捲到固定底部導覽後方。執行前再次核對歷史項目、帳號、校園、搜尋條件與目前焦點。
- 等待 Router、帳號或校園確認期間，使用者的打字、點擊、觸控、滾動及新的控制焦點優先，取消舊的焦點恢復。
- 全新導航、另開分頁、修飾鍵點擊和下載不建立返回紀錄。History 無法寫入時，服務仍可開啟。
- 暫時的 AI 推薦若已不存在，回到結果標題。返回不自動重送 AI，不保存私人預覽。

### 原生 App：鍵盤與搜尋的一致操作

- `AIScreen`、`AIDetailScreen` 共用 `keyboardShouldPersistTaps="handled"`。iOS 使用互動式拖曳收鍵盤及原生鍵盤 inset，Android 保留拖曳收鍵盤與平台 resize。
- 呼叫端仍能覆寫鍵盤政策，既有捲動 ref、捲動事件和底部間距保留。
- SearchBar 清除後回同一個輸入欄，停用時不清除、不聚焦；課號與 UID 搜尋關閉自動大小寫及拼字修正。
- 群組成員與課程驗證兩個實際使用頁面同步採用 handled taps，讓父層清單不攔截第一次操作。
- 一般頁首可顯示兩行。窄版、大字或長課名／店名把完整標題與副標放入主要捲動內容，返回與操作留在頂部。
- 視窗尺寸改變不重掛載原有輸入元件，保留表單內容。

### 原生 App：回饋草稿能安全離開

- 使用 `usePreventRemove` 保護原生返回與滑回。修改過的草稿可選擇繼續編輯，或捨棄並執行原本的導航動作。
- 送出期間保留目前畫面；失敗保留輸入，成功收到回饋編號後正常離開。
- 舊確認必須仍符合同一草稿、帳號、校園、畫面焦點及請求狀態，才可執行。重複確認不會重複導航。
- 提交另一則回饋會重設草稿基準，保留聯絡信箱。既有同步鎖與 requestId 防重送規則維持有效。

## 驗證與重現

使用 Node.js 22.23.5、pnpm 10.28.2，依現有 lockfile 安裝。

| 範圍                     | 本機結果                            |
| ------------------------ | ----------------------------------- |
| Web 搜尋頁               | 114 項通過                          |
| Web 生活／交流／共用目錄 | 3 份 suite、59 項通過               |
| 原生 App 相關回歸        | 11 份不同 suite、218 項不同測試通過 |
| Mobile TypeScript        | 通過                                |
| Web TypeScript           | 通過（本機使用 8 GB Node heap）     |
| 變更檔 ESLint            | 0 errors、0 warnings                |
| UI design gate           | 8 項測試及變更 CSS 檢查通過         |
| git diff --check         | 通過                                |

原生回歸包含兩組測試，其中共用畫面 suite 重複執行 9 項；上表已扣除重複，沒有將重跑累加。

本機 Web 型別檢查第一次耗盡 Node 預設約 2 GB heap；以 `NODE_OPTIONS=--max-old-space-size=8192` 重跑同一檢查通過，沒有改動型別檢查規則。

瀏覽器驗收使用實際產品元件與 CSS，僅替換帳號、校園、登入選項與路由／網路邊界的合成資料。`/search` 載入真實 SearchPage 與 SiteShell；頁面跳轉使用真正的 browser history，另開分頁使用真正的修飾鍵點擊。現有 8 種桌面、手機、320px、200% 文字、深色、訪客與減少動態情境，新增搜尋連續性檢查。

人工複核曾發現原生 history 平滑捲動會在第一次定位後繼續移動畫面，單幀 `to_be_in_viewport` 會漏掉固定導覽遮擋。驗收已補上立即返回及在目的頁停留後返回：等待幾何連續穩定 120ms，核對標題每行完整位於可用視窗內，再以 hit-test 確認沒有被其他元素遮住。新增 11 項搜尋回歸也涵蓋延後一幀期間的手動操作、歷史項目、帳號及校園變更。

重現方式：

```sh
pnpm install --frozen-lockfile
node scripts/qa/interface-design/build.mjs
xvfb-run -a -s "-screen 0 1920x1440x24" python scripts/qa/interface-design/check.py
```

畫面與報告由 `Interface Design Browser` 的 artifact 保存，包含 `checks.json`、PNG 與來源 SHA-256。遠端 CI、Web TypeScript、建置及最終瀏覽器結果，以本 PR 對應提交的 checks 為準。

### 驗證界線

- DOM composition 事件驗證的是瀏覽器事件處理路徑，不能代替 iOS／macOS 的實際注音候選操作。
- React Native 回歸可確認元件契約、草稿生命週期、尺寸分流及導航保護；沒有把它當作 iOS／Android 實機鍵盤、滑回手勢或 VoiceOver 驗收。
- 本輪未新增依賴，未變更 API 或授權規則。發布狀態以 PR 和部署紀錄為準。

## 與其他進行中工作的銜接

已核對 #739 `04aaccd2`、#754 `21547d42`、#752 的工作範圍。本輪不重做社群表單、附件預覽、行事曆、通知或抽屜的既有修改。原生 `components.tsx` 本輪只調整 SearchBar，與 #754 的 Button／Card／AnimatedCard 區塊分離。

參考：[Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion)、[React Native ScrollView](https://reactnative.dev/docs/scrollview)。動態用於操作回饋，保留減少動態設定；以完整流程的可用性判斷改善效果。
