# WOW Class：驗證後的連線與來源學分

## 修正內容

`loginTronClass` 已以 `/api/profile` 核對身分，但原本回傳 `/api/login` 的舊 Cookie。校方在驗證時輪替 session，後續讀課就可能沿用已失效的值。現在保留驗證回應合併後的 Cookie，並在校方明確刪除 session 時停止，不以 200 或身分 JSON 當作有效連線。合併時處理空值、Max-Age=0／負值及已過期 Expires；Max-Age 優先。不放寬帳號一致性檢查、不新增重試登入或密碼儲存。

既有 `normalizeTcCourse` 會保留有效 `credit`／`credits`，但 Web handler 及瀏覽器解析器未轉交。現在經過本人權限與連線再次查核後，回傳有限、非負的來源學分。瀏覽器允許舊回應缺欄位（視為未知），不把文字、布林值或空值轉成數字。來源沒有資料仍是 null，不是零。

WOW Class 課程卡顯示原列學分。既有選課對照只在同學期、完整課號唯一對上時比較兩邊學分；若不同，顯示兩個原值並納入待核對。課堂入口、e 校園學分與校方小計不被改寫。缺少來源學分、不明對應或校務本身互相衝突，不猜差異。

## 驗證

新增五個測試檔，覆蓋驗證 Cookie 輪替／撤銷、實際 TronClass 讀取器→handler→瀏覽器的合成資料整合、學分差異判斷及兩個畫面的互動。

本機將本次 TypeScript 實作轉譯後執行 27 項 Node 檢查，27 通過；同一檢查套用修改前程式為 6 通過、21 失敗。包含真實解析程式與模擬校方 HTTP，不代表真實帳號驗收。本機未安裝完整鎖定依賴，parse5 實作來自先前經 CI 建置的 source map，已修改的既有檔案以 Git blob SHA 核對 main 基準。完整型別、Vitest、後端及建置結果以本分支確切提交的 CI 為準。

## 範圍

沿用現有已驗證身分與本人 session；沒有增加對外來源、資料庫修改、背景工作、依賴或 CI 豁免。此修正不能解決所有校方網路限制、SSO 或 2.5 秒學生 LMS 軟逾時情境，也不代表正式畢業採計。未以真實校方帳號驗收，不宣稱原生 App 或 Safari 實機通過。

Cookie 移除與優先規則參考：
https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
