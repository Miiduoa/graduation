# 靜宜 TronClass 媒體下載查核（2026-11-18）

## 問題與修正範圍

既有 nuni 教材與本人繳交附件下載已核對學生、課程、活動、版本與附件，但只接受 `tronclass.pu.edu.tw` blob 入口直接回傳 HTTP 200。校方若以 302 轉往自己的媒體服務，原程式一律拒絕，因此已顯示的下載按鈕仍可能無法取得檔案。

本次新增一次、固定來源與路徑的媒體下載。先前的本人課程／歷史授權、下載後再次核對、30 秒總期限、25 MiB 上限、來源大小與實際 bytes 比對、MIME 檢查均保留。教材、本人歷史附件、使用這兩個 BFF 的 Web／Mobile／Agent 共用相同處理。

## 獨立的官方公開證據

以下均為匿名 HTTPS GET，不使用真人 Cookie、帳密、私人檔案或登入後 runtime state。

1. 取得官方 [公開課程頁](https://tronclass.pu.edu.tw/public-course)。本次 HTML 直接包含公開標誌圖片 `https://tronclass.pu.edu.tw/api/uploads/129/modified-image?thumbnail=0x272`，不是猜測或列舉私人 upload ID。
2. 請求該公開圖片時，校方回 HTTP **302**，`Location` 指向 **`https://media.pu.edu.tw`**，路徑為 `/download/file/{40 位小寫十六進位識別碼}`。
3. 轉址 query 恰有 `timestamp`、`token`、`name` 三個參數，各一份。實際形狀為 10 位正整數 timestamp、32 位小寫十六進位 token，以及檔名；不在文件、測試或程式庫保存實際 token 或完整簽名網址。
4. 另一次匿名 GET 這個公開媒體網址，未傳 Cookie、Authorization 或 Referer，取得 HTTP **200**、`Content-Type: image/png`。來源 `Content-Length: 27422`，實際 **27,422 bytes**，SHA-256 為 `32e79f319e12bb17cad0322905ef99e6e428f432c12f025ad6a7ed638e2f760d`。

公開來源定位與本次 SHA-256：

| 官方來源 | SHA-256 |
| --- | --- |
| [public-course](https://tronclass.pu.edu.tw/public-course) HTML | `01bcdec2a0c7fc32fd4f55af0db7737918dd7341a5cb1dbc0bd3ed04677742d5` |
| [72914-965f4ad4.js](https://tronclass.pu.edu.tw/static/72914-965f4ad4.js) | `ec0f18dd4da0b05bc656334e0a05306d0e61fe912d34130c288efd398f7d1d77` |
| [56834-67be8618.js](https://tronclass.pu.edu.tw/static/56834-67be8618.js) | `72f95909ee245893dcd801813bf5365c47b0097ebb8c3635da86d9c361c54e14` |

兩份公開 JS 與前輪查核版本相同；媒體 origin、路徑及簽名參數的正面證據來自公開圖片的實際 HTTP 回應。HTML 包含動態內容，其雜湊只標識本次取得的 bytes。

另於使用者授權帳號的正常作業介面，確認已交附件下載連結仍為 `/api/uploads/{數字 ID}/blob`；該連結導向的失敗分頁標題為 `media.pu.edu.tw`。瀏覽器回報 `net::ERR_BLOCKED_BY_CLIENT`，未取得私人目的路徑或完成檔案，沒有更換方法繞過限制。這只交叉確認媒體 host，不能宣稱本人檔案下載已驗收。

## 程式行為

`tronClassDownloadTransport.ts` 抽出既有有界 binary transport，新增共用下載器：

- 起點仍限定 `https://tronclass.pu.edu.tw/api/uploads/{既有合法 upload ID 或 key}/blob`，且必須先經既有本人範圍與附件權限查核。
- 只有校方 **302** 可進入已查明的媒體流程。媒體目的地必須完整匹配上述 HTTPS origin、40 位識別碼路徑及三個參數形狀；其他主機、路徑、額外或重複參數、非 HTTPS、非標準連接埠、帳密、fragment、正規化前後不同的 URL 均不發出第二個請求。
- 跳往媒體前重新核對目前 owner／binding，沿用原 AbortSignal 與整段下載期限。第二跳重新建立 headers，只帶下載所需 `Accept` 與 `Accept-Encoding: identity`；不轉送學校 Cookie、平台憑證、CSRF 或 Referer。既有部署有校方 relay 時沿用它，不改變任意網路目的地設定。
- 第二次轉址不跟隨。簽名網址只存在 server 請求內，不加入 DTO、前端錯誤或自訂紀錄；共用 relay 的現有紀錄不含 query。
- 媒體服務回 401／403 表示本次簽名下載不可用，回一般下載失敗；不將其當作學校登入過期而撤下使用者連線。學校第一跳回 401／403 仍保留原重新連線處理。
- 收到 bytes 後仍走原 MIME／長度／來源大小檢查，再重新讀取活動或完整本人歷史。檔案、版本或權限途中改變時，不把已下載 bytes 回傳給使用者。

公開 logo 成功證明上述 signed media 形狀及匿名媒體讀取可行，並不證明所有校方 storage 類型、私人附件或真人 nuni 綁定已驗收；遇到未觀察過的目的地仍保留原錯誤。

## 本次驗證

另外直接載入本次實作的 `createTronClassDownloadFetch()`（包含真正的目的地 parser）及 `readTronClassDownloadResponse()`，以正常匿名 HTTPS fetch 注入，執行一次公開資料傳輸驗證。測試依賴將合法 blob 首跳映射到上文已確認的公開 logo `modified-image` URL；真實 302 的 `Location` 通過新 parser，媒體第二跳未帶敏感 headers、沿用同一 AbortSignal，最後得到同樣 **27,422 bytes 的 PNG 及相同 SHA-256**。沒有以合成 Location 代替此實際回應，也沒有將簽名 query 值寫入輸出。

這次直接驗證確認真實 URI 編碼、簽名參數形狀、轉址處理與完整 bytes／MIME 檢查相容；使用的是注入的匿名 HTTP 傳輸及取消檢查，不是私人作業 reader、Firestore 綁定、production IPv4／relay 或真人 nuni BFF 的完整驗收。

Node **22.23.5** 下，三份下載範圍測試 **166 項通過、0 失敗、0 略過**。其中教材與本人歷史案例使用實際 downloader、完整 reader 與 normalizer，合成來源回覆校方 302 與媒體 bytes，核對下載成功、下載後版本撤除、binding 變更、共同取消、敏感 header 清除與拒絕第二次轉址。這些是程式整合測試，不把合成檔案當真人下載。

六個修改的 TypeScript 程式／測試檔 ESLint 與差異空白檢查通過。整體 Web TypeScript、CI、PR 與部署狀態以該輪完整版本的另行驗證結果為準。

本次沒有建立校方草稿、上傳或正式繳交；production `contractVerified: false` 不變。
