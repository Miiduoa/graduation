# API Anything 與校園操作整合

查核日期：2026-11-07（台灣時間）。參考影片為 brewbytes.ai 於 11 月 6 日發布的 [Instagram Reel](https://www.instagram.com/reel/DfbmRynvVB9/)；其中 API Anything 與 `/domains/{domain}` 範例，可對上[官方專案](https://github.com/goodnight000/api-anything)的 `lobste.rs` 示範。以下以查核當日文件為準。

## 判斷與運作方式

適合用來改善跨校資料整合：把已確認的網站操作保存成規格，後續重複呼叫。它不會因為收到一個學校網址，就自動取得所有功能或登入權限。

官方設計是用瀏覽器擷取兩組輸入產生的請求，比較參數位置，建立請求範本；`learn_site` 再用第三組輸入驗證。範本學習本身不需大模型，複雜頁面的探索與操作選擇仍可能需要外部 agent。執行先用 HTTP，必要時使用瀏覽器內請求，讀取操作最後才回到頁面擷取。共享目錄主要保存規格，不替使用者執行登入後的請求。[設計依據](https://github.com/goodnight000/api-anything/blob/main/docs/DESIGN.md)

## 執行環境與整合邊界

[套件設定](https://github.com/goodnight000/api-anything/blob/main/package.json)目前為 `0.4.0`，要求 Node `>=22.13.0`。本專案根目錄 `package.json` 接受 `>=20.19.4 <21 || >=22 <23`，CI 使用 `22.23.4`，因此不能一概判定不相容：CI 版本符合，Node 20 與較早的 Node 22 則不符合。正式導入前仍須核對部署執行環境。需要 Chromium 的學習流程，也不能直接視為手機瀏覽器端能力。

若日後採用原套件，優先評估 [`api-anything/host`](https://github.com/goodnight000/api-anything/blob/main/docs/HOST.md)：只發現本機已安裝規格，以 `planCall`、`callPlanned` 核對操作版本與參數；call-only 模式不連共享目錄、不自動修復或替換規格、不匯入日常瀏覽器登入。結果 schema 只是描述，Campus One 仍須檢查實際資料。

關閉分享不等於完全本機執行：`--no-share` 仍可能把搜尋送到目錄，`API_ANYTHING_LOCAL_ONLY=1` 才會阻止所有 registry 請求。[分享設定](https://github.com/goodnight000/api-anything/blob/main/docs/REGISTRY.md)。HTTP server 的 `--sites` 只限制工具與文件列表，並非端點權限邊界；多校、多使用者不能共用可讀取所有 session 的執行空間。[伺服器限制](https://github.com/goodnight000/api-anything/blob/main/docs/SERVE.md)

## 第一階段（2026-11-07）：操作目錄與公開查課

第一階段採用可重複使用操作的設計方式，**沒有安裝 API Anything 套件**。範圍是暨南大學 `ncnu`、清華大學 `nthu` 的公開課程查詢：建立明確的 operation registry，交由各校 adapter 讀取既有官方來源，集中檢查回應 schema、預期學校與來源網址；不開放任意網址或任意程式執行。

沿用 `/api/public-course-catalog` 與既有客戶端資料契約。舊客戶端可以忽略新增的 `operation`；新客戶端也接受尚未帶此欄位的舊伺服器回覆，但來源仍須完全符合該校登錄網址。有 `operation` 時，名稱、版本、回應規格、公開讀取範圍與擷取時間都要符合。這是執行版本紀錄，不是校方簽章或學籍證明。公開開課清單不是學生本人已選修的課表，不能據此宣稱完成學籍、學分或選課驗證。

### 操作介面

`GET /api/public-course-catalog/operations` 只列出靜態規格，不讀取帳號或向學校發出請求。兩個操作為 `ncnu.courses.search`、`nthu.courses.search`，版本皆為 `1`，只接受可選的 `query` 字串，最多 80 個 Unicode 碼點。

每個操作描述既有 HTTP 端點、固定的 `schoolId`，以及 `query` 對應 HTTP 參數 `q` 的關係。例如：

```text
GET /api/public-course-catalog?schoolId=nthu&q=資料
```

內部可呼叫 `executePublicCourseOperation('nthu.courses.search', { query: '資料' })`，與現有 Web／App 查課走相同的資料來源、快取及結果檢查。錯誤分為呼叫參數有誤與上游不可用；不會改查另一校，也不會把失敗轉成空清單。新增校園須加入固定來源、專用解析器與契約驗證，不能把擷取檔或共享規格直接送進執行器。

第一階段只提供本專案的 REST 操作目錄，當時尚未接入對話助理。第二階段加入下述規則式前置處理；這組公開查課操作仍不是 MCP server，也尚未註冊為模型原生 tool calling 的工具。

同樣方式可逐步擴充公開公告與館藏查詢；TronClass 作業、成績、借閱及宿舍個人資料，須另有登入授權與使用者隔離。已有正式 API 的服務優先維持原接法，不為採用新工具重做穩定功能。

驗收時應保留課程代碼的前導零、內部空白及每一組上課時間與教室的對應，不能為了統一格式破壞原始意思。查無課程、上游無法連線與資料格式改變也應分開處理；網站失敗不能變成空清單，更不能自行套用另一校的資料。這些檢查要落在使用者實際會走的查詢路徑。

後續若擴充學習工具，擷取檔可能包含完整回應與登入資訊，不能直接放進公開儲存庫。測試資料應使用人工建立或已去識別的案例，憑證留在受保護的個別執行空間。免用大模型只表示特定學習步驟不消耗模型呼叫；瀏覽器、主機與維護仍有成本，速度改善須以校方實際流程量測。

## 兩階段共通邊界

這兩階段的公開查課整合沒有新增私有登入、繳作業、請假、訂位、付款或自動修復。遇到學校停用登入、要求人工驗證、驗證碼或權限不足，必須暫停該操作並說明狀態，不能繞過限制或把失敗當作成功。未來寫入功能需要獨立審核與讀回驗證；HTTP 成功回應不等於作業已繳交。官方亦說明 write 操作主要以本機 fixture 測試，不能直接推論校方端點可用。[能力與限制](https://github.com/goodnight000/api-anything/blob/main/docs/REFERENCE.md)

原專案採 [MIT 授權](https://github.com/goodnight000/api-anything/blob/main/LICENSE)；若日後納入其程式碼，須保留授權聲明。兩階段只借鏡設計，沒有複製其實作，也沒有對外分享學校操作或使用者資料。

## 第一階段驗證紀錄（歷史）

- 基底：PR #526 的 `06a98e4d1e0db57b5e4d52e79acdfe39bdf906f9`。第一階段沿用該 PR 的公開查課，未重建解析器。
- Node `22.23.4` 執行 shared 與完整 Web TypeScript 檢查通過；Web 使用 2 GiB heap、關閉 incremental。`nthuCourseSchedule.test.cjs`、`ncnuCourseSchedule.test.cjs` 共 12 項通過。
- 2026-11-07 19:53（台灣時間），將實際查課 route 打包後呼叫兩校官方來源，搜尋「資料」：暨大回 19 筆、清大回 18 筆，均為 HTTP 200、未截斷，包含正確操作版本、來源與擷取時間。這是當次公開查詢結果，不代表完整支援所有學期或已部署。
- 上述實際讀取各使用一次固定 HTTPS GET，只有 `Accept` header，`credentials: omit`、`redirect: error`；搜尋字不送往校方來源。
- 第一階段 Web 7 個檔案共 133 項通過：操作執行器 46 項、操作目錄 2 項、查課 API 14 項、清大來源解析 19 項、共用回應驗證 8 項、查課元件 29 項、查課頁面 15 項。涵蓋 discovery → HTTP 呼叫、80／81 個 Unicode 碼點、錯校／錯來源／錯誤 schema、上游失敗及舊回應相容。
- 手機查課畫面 11 項通過，包含既有複製、匯入入口、逾時重試、切校及晚到回應，以及拒絕錯誤來源或操作版本。
- 第一階段修改的 TypeScript／TSX 檔案 ESLint 與 `git diff --check` 通過。
- 遠端 CI 與指定 GitHub App 的「審查通過」由 [PR #526](https://github.com/Miiduoa/graduation/pull/526/checks) 追蹤，須以最新提交為準。以上本機證據不表示已合併或部署。

## 第二階段（2026-11-07）：自然語言查課接入實際助理

### 已接入的路徑與結果

公開查課已接到 Web `LegacyAssistant`、V2 `features/nuni/Assistant`、首頁 `QuickCampusEntry`，以及 Mobile `CampusAssistant` 的 `device` 一般助理路徑；手機的平台帳號課表助理仍維持既有範圍。例如目前瀏覽暨大時，輸入「幫我找清大的資料庫課程」，可明確指定清大進行這次公開讀取，不會持久變更全域校別或個人匯入校別。

這是 **deterministic preflight（規則式前置判斷）**：先辨識完整的公開查課要求，再呼叫第一階段固定來源與 schema 驗證的查課 API，不由模型生成網址、課碼或課程資料。這條公開查課路徑尚未實作模型原生工具選擇或 MCP，也沒有安裝 API Anything。公開讀取本身不需要個人帳號、私人課表或已下載的手機模型，首頁亦提供訪客查詢；各助理頁面原有的登入與校別入口規則仍適用。公開課程須連網取得。

結果先顯示最多 5 筆，保留來源原有的課名、課碼、班別、學期、授課老師與學分，並提供校方來源及可用的擷取時間。擷取時間標示台灣時間，明確區分校方更新時間；舊伺服器未提供時不自行補造。畫面分開處理查無結果與來源無法驗證，不會將公開開課當作本人已選修或已取得學分。

### 從回答接到既有課表核對

Web CTA 將明確校別與 `q` 帶到 `/school-courses`；只有單一且合法的 `q`（0–80 個 Unicode 碼點）才自動執行公開讀取。`q=` 可以瀏覽、沒有 `q` 維持手動；重複或超長值顯示可修改提示，不靜默截斷。切換查詢或校別會取消舊請求，晚到結果不能覆寫新查詢。

Mobile CTA 將 `publicSchoolId`、`filter.keyword` 與 `autoSearch` 帶到既有課程目錄。兩端後續都由使用者挑選課程，再進入既有 review／import 流程核對學期、時段與教室，保留匯入校別確認及現有草稿保護；查詢和 CTA 本身不自動匯入，也不是向學校選課。

### 語意、相容性與對話隔離

目前可依課名、課號、系所或老師查詢已接通的兩校公開資料。指定未支援學校、多校混查，或要求指定學期、星期、學分、必選修及不衝堂等尚未支援的篩選時，先請使用者釐清，不會忽略條件而回傳看似符合的答案。「我的課表」、「下一堂課」、「我的作業／成績」等私人問題保留原本處理路徑；帶有選課、退選或寫入要求也不會直接執行。

已修正 React Native `whatwg-fetch` 在 `cache: 'no-store'` 下自動加入 `_` query、被既有 API 參數驗證拒絕的相容問題：只有 Web 傳此 fetch 選項，Mobile 省略；兩端 API 回應仍使用 `Cache-Control: no-store`，不放寬參數規則。Mobile 另檢查可取得的最終回應網址，避免接受非預期來源。

公開查課回合隔離於後續模型 history。Web Legacy／V2 與 Mobile 都排除這類使用者問題及助理回覆，仍保留畫面上的公開查詢紀錄、其他一般對話與當前新問題。Mobile 的 device／campus 模型和本機工具選擇器皆有回歸案例，確認跨校公開結果不會被當成私人課務上下文；原始訊息、校別及帳號範圍不被修改。

### 競品定位

截至查核日，UniTable 在台灣 App Store 的名稱為[準點課表：AI 課表管理](https://apps.apple.com/tw/app/unitable-ai-academic-partner/id6745899492)，官方介紹與更新紀錄已涵蓋 AI 課表匯入、個人課表對話及確認流程；[NCNU GO 排課器](https://www.ncnugo.com/course-planner)已有暨大找課與排課功能。單憑「有 AI 對話」或「可以匯入」不足以宣稱超越。

第二階段的可驗收重點是：在現有助理明確指定另一校查詢，回答附可核對來源、學期與擷取時間，再保留同一校別及搜尋條件進入課表核對。這是本專案的實作與驗收目標，不推論競品沒有未公開功能，也不宣稱已在功能、速度或品質上全面領先。

### 第二階段驗證紀錄

- 基底為第一階段提交 `1e28b588b1f4b937e642f710e8e46bf2e034cdb0`，沿用 PR #526 原分支。變動限於共用查課助理、Web／Mobile 入口與交接、相關測試及本文件。
- 第二階段 Web 10 個檔案、223 項測試全數通過；共用輸入檢查與首頁 scope 收尾後，另重跑其中 4 檔、102 項通過，不重複加總。涵蓋問句分流、Native fetch 套件、取消與逾時、兩個助理入口、訪客首頁、結果卡及查課交接。
- Mobile 統一執行 8 suites、258 項測試全數通過，涵蓋一般助理與語意工具回歸、公開查課 feature／畫面、交接、查課頁及既有課表核對匯入。公開回合不會進入後續 device／campus 模型或私有工具選擇；一般對話與目前問題仍保留。
- Native fetch 相容回歸直接使用 `whatwg-fetch` 套件實作與 XHR 替身，驗證省略快取選項後不會加入 `_`；錯誤最終網址、錯校與額外參數的回應不被接受。這不是實體手機網路驗收。
- 2026-11-07 20:41（台灣時間），將新增的 shared 自然語句 client 與實際 GET route 打包串接官方來源；目前校別設為靜宜 `pu`，「查清大資料課程」解析為 `nthu`／`q=資料`，回 18 筆；「查暨大資料課程」解析為 `ncnu`／`q=資料`，回 19 筆。兩者皆 HTTP 200、預覽 5 筆、未截斷，CTA 保留對應校別與查詢。
- 上述首筆學期均為 `1151`；清大首筆課碼 `11510CS  235101` 的內部空白與暨大首筆課碼 `050028` 的前導零均保留。這是當次公開查詢的證據，不代表全部學期或所有課程皆已驗收。
- 兩校各執行一次固定官方 HTTPS GET，只有 `Accept` header，`credentials: omit`、`redirect: error`；校方上游請求不含搜尋文字。文件只記錄必要摘要，未納入原始執行輸出。
- Node `22.23.4`：shared 完整 TypeScript 檢查通過。修改的 32 個 TypeScript／TSX 檔 ESLint exit 0；Web／shared 零警告，Mobile 僅保留 `CampusAssistantScreen` 基底已有的兩個 effect dependency 警告。`git diff --check` 通過。
- 本階段完整 Web 與 Mobile TypeScript 在本機受資源限制，行程被終止（exit 137），沒有產生型別診斷；降低 heap 並序列執行仍未完成。不能沿用第一階段通過結果宣稱本階段完整型別通過，完整檢查以新提交的 CI 為準。
- 本機元件瀏覽器視覺 QA **未完成**：實際元件與 CSS 的隔離 fixture 已打包，但 Chromium 建立 socket 遭環境拒絕；Browser 插件缺少 originating context，cloud browser 也無法連到本機 fixture。沒有元件 QA 截圖，不能以互動單元測試代稱視覺通過。
- **真實手機驗收未完成**。元件與 fixture 測試不等同完整站、實際 Native 裝置或正式校務登入流程。最新提交的 CI、指定 App 5504170「審查通過」及既有整合／發版程序仍由 [PR #526](https://github.com/Miiduoa/graduation/pull/526/checks) 追蹤；上述本機驗證不表示已合併或部署。
