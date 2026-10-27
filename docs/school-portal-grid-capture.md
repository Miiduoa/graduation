# 校務網格擷取與資料完整性檢查

基於 main `cdd9980634bbecea029dba00fd2e802ee0fc05e3`，延續已合併的 PR #290；不再修改已合併的舊功能分支。

## 修正

原擷取器只找 HTML `<table>`，漏掉以明確 ARIA table/grid 語意呈現的網頁。另一個獨立問題是每層 DIV 都附加文字分隔符號，讓包在版面容器中的「課程名稱」變成「課程名稱 /」，無法通過既有欄位辨識。

現在同時處理原生表格與 `role="table"`、`role="grid"` 的 row／rowgroup／columnheader／rowheader／cell／gridcell，統一轉成既有純文字表格格式。保留欄位順序及可確定的 rowspan／colspan；不從 CSS class、圖片或一般卡片猜測資料結構。原生 HTML table 上的跨度以 HTML 屬性為準，不被 ARIA 覆寫。

文字分隔只出現在實際相鄰的文字區塊或 BR，而非單一標題的多層容器。因此原本的欄位解析、學期建議、人工核對、重新匯入差異比對與最後確認儲存流程可直接沿用。

## 避免將部分資料當成完整擷取

依 ARIA 的 rowcount／colcount／rowindex／colindex 檢查已載入的表格。宣告的列數含標題列；-1 代表總數未知，不表示目前畫面已包含全部資料。已知列／欄缺漏、錯誤索引、未知總數、跨列越界、跨度重疊、階層 treegrid、外部 aria-owns 或 aria-busy 載入狀態都停止這次讀取。

一頁含正常表格及已知不完整網格時，不先回傳一半資料。沿用既有 `unavailable` 錯誤及 App 的重試／檔案匯入提示；未改動橋接協定或新增成功狀態。已核對的草稿由現有流程保留。

這只驗證頁面公開的結構資訊。沒有提供 ARIA 總筆數／索引的分頁或延遲載入頁面，無法因此證明全學期或歷年資料完整；仍須使用者與校方清單核對。本版沒有自動捲動、翻頁、讀取隱藏資料、背景輪詢或模擬操作來取得更多紀錄。

## 隱私與界線

仍只在本人主動按讀取時執行。使用既有校園 HTTPS 來源與 nonce 驗證、容量及逾時限制；不讀密碼／表單值／Cookie／storage，不將 DOM 的 URL、ID、事件屬性或 ARIA label 當作紀錄。密碼表格略過、隱藏內容不輸出；原始頁面不修改。未增加校園入口、套件、外部 API、校務權限或資料庫寫入。

## 驗證

- 本機對擷取模組執行 strict TypeScript 編譯，並轉譯測試檔確認語法。
- Chromium 的 38 個本機合成頁案例通過：原生／ARIA 表格、標題容器、跨列、欄位位置、缺漏、隱藏內容、密碼欄位及大小限制。使用 390×844 視窗、about:blank，網路封鎖；僅將腳本預期 origin 常數替換成本機頁面 origin，未更改擷取邏輯。這不是六校帳號或原生 WebView 驗收。
- 新增 `portalCapture.grids.test.ts`。CI 使用真正 JSDOM、固定 HTTPS 測試 origin，執行未修改的擷取腳本，再走原有橋接驗證與課表／成績解析器；不以 mock 結果取代解析。
- 專項 CI 額外納入新檔，保留全部既有擷取、原生連續匯入、逐筆修正、重新匯入與登入測試。完整測試、建置、安全檢查以本次提交結果為準。

規格依據：W3C APG Grid and Table Properties，https://www.w3.org/WAI/ARIA/apg/practices/grid-and-table-properties/ 。實作刻意拒絕無法確定的結構，而非聲稱支援所有 ARIA 用法。
