# API Anything 與校園操作整合

查核日期：2026-11-07（台灣時間）。參考影片為 brewbytes.ai 於 11 月 6 日發布的 [Instagram Reel](https://www.instagram.com/reel/DfbmRynvVB9/)；其中 API Anything 與 `/domains/{domain}` 範例，可對上[官方專案](https://github.com/goodnight000/api-anything)的 `lobste.rs` 示範。以下以查核當日文件為準。

## 判斷與運作方式

適合用來改善跨校資料整合：把已確認的網站操作保存成規格，後續重複呼叫。它不會因為收到一個學校網址，就自動取得所有功能或登入權限。

官方設計是用瀏覽器擷取兩組輸入產生的請求，比較參數位置，建立請求範本；`learn_site` 再用第三組輸入驗證。範本學習本身不需大模型，複雜頁面的探索與操作選擇仍可能需要外部 agent。執行先用 HTTP，必要時使用瀏覽器內請求，讀取操作最後才回到頁面擷取。共享目錄主要保存規格，不替使用者執行登入後的請求。[設計依據](https://github.com/goodnight000/api-anything/blob/main/docs/DESIGN.md)

## 執行環境與整合邊界

[套件設定](https://github.com/goodnight000/api-anything/blob/main/package.json)目前為 `0.4.0`，要求 Node `>=22.13.0`。本專案根目錄 `package.json` 接受 `>=20.19.4 <21 || >=22 <23`，CI 使用 `22.23.4`，因此不能一概判定不相容：CI 版本符合，Node 20 與較早的 Node 22 則不符合。正式導入前仍須核對部署執行環境。需要 Chromium 的學習流程，也不能直接視為手機瀏覽器端能力。

若日後採用原套件，優先評估 [`api-anything/host`](https://github.com/goodnight000/api-anything/blob/main/docs/HOST.md)：只發現本機已安裝規格，以 `planCall`、`callPlanned` 核對操作版本與參數；call-only 模式不連共享目錄、不自動修復或替換規格、不匯入日常瀏覽器登入。結果 schema 只是描述，Campus One 仍須檢查實際資料。

關閉分享不等於完全本機執行：`--no-share` 仍可能把搜尋送到目錄，`API_ANYTHING_LOCAL_ONLY=1` 才會阻止所有 registry 請求。[分享設定](https://github.com/goodnight000/api-anything/blob/main/docs/REGISTRY.md)。HTTP server 的 `--sites` 只限制工具與文件列表，並非端點權限邊界；多校、多使用者不能共用可讀取所有 session 的執行空間。[伺服器限制](https://github.com/goodnight000/api-anything/blob/main/docs/SERVE.md)

## 本輪採用的範圍

本輪採用可重複使用操作的設計方式，**沒有安裝 API Anything 套件**。範圍是暨南大學 `ncnu`、清華大學 `nthu` 的公開課程查詢：建立明確的 operation registry，交由各校 adapter 讀取既有官方來源，集中檢查回應 schema、預期學校與來源網址；不開放任意網址或任意程式執行。

沿用 `/api/public-course-catalog` 與既有客戶端資料契約。舊客戶端可以忽略新增的 `operation`；新客戶端也接受尚未帶此欄位的舊伺服器回覆，但來源仍須完全符合該校登錄網址。有 `operation` 時，名稱、版本、回應規格、公開讀取範圍與擷取時間都要符合。這是執行版本紀錄，不是校方簽章或學籍證明。公開開課清單不是學生本人已選修的課表，不能據此宣稱完成學籍、學分或選課驗證。

### 操作介面

`GET /api/public-course-catalog/operations` 只列出靜態規格，不讀取帳號或向學校發出請求。兩個操作為 `ncnu.courses.search`、`nthu.courses.search`，版本皆為 `1`，只接受可選的 `query` 字串，最多 80 個 Unicode 碼點。

每個操作描述既有 HTTP 端點、固定的 `schoolId`，以及 `query` 對應 HTTP 參數 `q` 的關係。例如：

```text
GET /api/public-course-catalog?schoolId=nthu&q=資料
```

內部可呼叫 `executePublicCourseOperation('nthu.courses.search', { query: '資料' })`，與現有 Web／App 查課走相同的資料來源、快取及結果檢查。錯誤分為呼叫參數有誤與上游不可用；不會改查另一校，也不會把失敗轉成空清單。新增校園須加入固定來源、專用解析器與契約驗證，不能把擷取檔或共享規格直接送進執行器。

此介面是本專案的 REST 操作目錄，尚非 MCP server，也尚未註冊到對話助理的工具選擇流程。

同樣方式可逐步擴充公開公告與館藏查詢；TronClass 作業、成績、借閱及宿舍個人資料，須另有登入授權與使用者隔離。已有正式 API 的服務優先維持原接法，不為採用新工具重做穩定功能。

驗收時應保留課程代碼的前導零、內部空白及每一組上課時間與教室的對應，不能為了統一格式破壞原始意思。查無課程、上游無法連線與資料格式改變也應分開處理；網站失敗不能變成空清單，更不能自行套用另一校的資料。這些檢查要落在使用者實際會走的查詢路徑。

後續若擴充學習工具，擷取檔可能包含完整回應與登入資訊，不能直接放進公開儲存庫。測試資料應使用人工建立或已去識別的案例，憑證留在受保護的個別執行空間。免用大模型只表示特定學習步驟不消耗模型呼叫；瀏覽器、主機與維護仍有成本，速度改善須以校方實際流程量測。

## 暫不涵蓋

本輪沒有私有登入、繳作業、請假、訂位、付款或自動修復。遇到學校停用登入、要求人工驗證、驗證碼或權限不足，必須暫停該操作並說明狀態，不能繞過限制或把失敗當作成功。未來寫入功能需要獨立審核與讀回驗證；HTTP 成功回應不等於作業已繳交。官方亦說明 write 操作主要以本機 fixture 測試，不能直接推論校方端點可用。[能力與限制](https://github.com/goodnight000/api-anything/blob/main/docs/REFERENCE.md)

原專案採 [MIT 授權](https://github.com/goodnight000/api-anything/blob/main/LICENSE)；若日後納入其程式碼，須保留授權聲明。本輪只借鏡設計，沒有複製其實作，也沒有對外分享學校操作或使用者資料。

## 驗證紀錄

- 基底：PR #526 的 `06a98e4d1e0db57b5e4d52e79acdfe39bdf906f9`。本次沿用該 PR 的公開查課，未重建解析器。
- Node `22.23.4` 執行 shared 與完整 Web TypeScript 檢查通過；Web 使用 2 GiB heap、關閉 incremental。`nthuCourseSchedule.test.cjs`、`ncnuCourseSchedule.test.cjs` 共 12 項通過。
- 2026-11-07 19:53（台灣時間），將實際查課 route 打包後呼叫兩校官方來源，搜尋「資料」：暨大回 19 筆、清大回 18 筆，均為 HTTP 200、未截斷，包含正確操作版本、來源與擷取時間。這是當次公開查詢結果，不代表完整支援所有學期或已部署。
- 上述實際讀取各使用一次固定 HTTPS GET，只有 `Accept` header，`credentials: omit`、`redirect: error`；搜尋字不送往校方來源。
- Web 本輪 7 個檔案共 133 項通過：操作執行器 46 項、操作目錄 2 項、查課 API 14 項、清大來源解析 19 項、共用回應驗證 8 項、查課元件 29 項、查課頁面 15 項。涵蓋 discovery → HTTP 呼叫、80／81 個 Unicode 碼點、錯校／錯來源／錯誤 schema、上游失敗及舊回應相容。
- 手機查課畫面 11 項通過，包含既有複製、匯入入口、逾時重試、切校及晚到回應，以及拒絕錯誤來源或操作版本。
- 本輪修改的 TypeScript／TSX 檔案 ESLint 與 `git diff --check` 通過。
- 遠端 CI 與指定 GitHub App 的「審查通過」由 [PR #526](https://github.com/Miiduoa/graduation/pull/526/checks) 追蹤，須以最新提交為準。以上本機證據不表示已合併或部署。
