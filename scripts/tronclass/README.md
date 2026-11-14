# TronClass 離線契約查核

這支工具把**本機 HAR** 裡與靜宜 TronClass 有關的已知路徑整理成型別與關聯缺口，供開發者確認正式 adapter 的必要條件。它不登入、不發網路請求、不重新送出任何操作，也不會把 `contractVerified` 改成 `true`。

## 使用方式

需要 Node.js 22，不需安裝套件。在 repository 根目錄執行：

```sh
node scripts/tronclass/analyze-har.mjs /absolute/path/capture.har > /absolute/path/contract-report.json
node --test scripts/tronclass/analyze-har.test.mjs
```

HAR 必須是你有權使用的本機一般檔案。工具拒絕 URL、符號連結、超過 16 MiB 的檔案，以及超過 1,000 筆的 HAR；不是監聽或網路代理工具。若分析失敗，stderr 只包含固定錯誤代碼，不包含輸入路徑或原始錯誤。

## 準備能查核的紀錄

使用學校核准的測試課程與測試帳號，或你已合法持有的操作紀錄。需要的順序是：讀取目前登入者 `/api/profile`、上傳測試附件、正式送出、重新讀取同一課程同一作業的本人繳交紀錄。必須包括回應 JSON；只截一張成功畫面、只留 HTTP 狀態碼或只擷取上傳階段，都不能確認作業已繳交。不要為了取得 HAR 對真實作業重複繳交。

原始 HAR 可能包含 session cookie、帳密、學生資料及完整作業。**原始 HAR 留在本機，不要提交 Git、貼到 issue，或傳給 Agent。** 分析器不修改原始檔；分享產生的報告前仍應依學校規範檢查。

## 報告如何解讀

| 欄位 | 代表什麼 |
| --- | --- |
| `entries` | 只列固定 `https://tronclass.pu.edu.tw` origin 與程式中明列的路徑模板、HTTP method／狀態及 JSON 型別。路徑在白名單內不代表該寫入端點已獲學校確認。 |
| `requestBody` / `responseBody` | JSON schema 形狀，只包含型別及允許的欄位名稱；沒有任何原始值、enum、examples 或 required 推論。未擷取、非 JSON、編碼、過大及無法解析的 body 都明確標記。 |
| `homeworkEvidence.missingTracePhases` | 整份紀錄缺少上傳、正式送出或讀回的哪個階段。純文字繳交仍會標記尚無附件上傳紀錄，避免誤認已支援檔案繳交。 |
| `homeworkEvidence.chains` | 每次正式送出是否能在同一份紀錄中連到先前上傳的附件代號、先前登入者、稍後同作業的同一份本人 receipt、明確 submitted 狀態、時間及內容／附件。只輸出布林值、固定缺口代碼和 HAR entry 序號，不輸出代號本身。 |
| `manualReviewRequired` | 仍須由正式介面文件或獲授權的測試環境確認的事項，包括真正檔案上傳完成、身分／session 綁定、狀態語意、學校規則、冪等與逾時處理。 |
| `contractVerified` | **固定為 `false`**。HAR 是可編輯的離線紀錄，不能證明伺服器真實接受了操作。即使沒有關聯缺口，也不是啟用寫入的驗收結果。 |

未知欄位名稱可能就是姓名或 token，因此只輸出 `x-omitted-field-count` 計數，連未知欄位名稱都不保留；已知欄位的值一律不輸出。URL query、header、cookie、檔名、作業內文及學生 ID 不會出現在報告。HTTP 2xx 只被描述為傳輸層觀察，不會推論正式成功；缺少狀態不會預設為 submitted，也不會把兩筆不同學生的紀錄拼成驗收證據。

單一 JSON body 最多分析 256 KiB；每份 schema 最多 64 個節點、6 層、每個陣列 16 個樣本。正式送出最多檢查前 32 筆，每筆最多比對 64 個讀回請求、每個讀回取前 64 筆 receipt；報告會標記截斷或分析上限，完整 JSON 輸出另有 8 MiB 上限。型別是觀察樣本，不是完整 API 規格。未知路徑直接略過；如果學校使用其他上傳流程，必須先審查後擴充固定路徑白名單。

## 下一步：實際介面驗收

報告可以指出缺哪段合約與哪些欄位型別，但無法取代校方驗收。完成 adapter 前，還需要確認檔案上傳／finalize 的真正請求與回應、附件與 final 的關係、權威本人 receipt、修改／重繳政策，以及網路逾時後如何避免重複提交。遇到 HTTP 成功卻沒有完整本人讀回紀錄時，維持 unavailable 或待確認，不可回報「已繳交」。

參考來源：[TronClass 官方作業說明](https://support.tronclass.com/tw/question/homework)、[官方操作手冊](https://support.tronclass.com/public-manual/manual-teacher.html)。這些文件確認操作流程與政策差異，沒有提供靜宜站點可直接驗收的完整 HTTP 寫入合約。既有 repository 的讀取路徑與 legacy writer，以及公開 [Tronclass-API client](https://github.com/seven-317/Tronclass-API)，僅用來界定待查核路徑，不作為 verified 證據。
