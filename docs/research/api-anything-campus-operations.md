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

## 各階段共通邊界

截至第三階段，公開查課整合沒有新增私有登入、繳作業、請假、訂位、付款或自動修復。遇到學校停用登入、要求人工驗證、驗證碼或權限不足，必須暫停該操作並說明狀態，不能繞過限制或把失敗當作成功。未來寫入功能需要獨立審核與讀回驗證；HTTP 成功回應不等於作業已繳交。官方亦說明 write 操作主要以本機 fixture 測試，不能直接推論校方端點可用。[能力與限制](https://github.com/goodnight000/api-anything/blob/main/docs/REFERENCE.md)

原專案採 [MIT 授權](https://github.com/goodnight000/api-anything/blob/main/LICENSE)；若日後納入其程式碼，須保留授權聲明。這三階段只借鏡設計，沒有複製其實作，也沒有對外分享學校操作或使用者資料。

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

第二階段當時可依課名、課號、系所或老師查詢已接通的兩校公開資料，尚未加入星期與學分篩選。指定未支援學校、多校混查，或要求指定學期、星期、學分、必選修及不衝堂等當時未支援的篩選時，先請使用者釐清，不會忽略條件而回傳看似符合的答案。「我的課表」、「下一堂課」、「我的作業／成績」等私人問題保留原本處理路徑；帶有選課、退選或寫入要求也不會直接執行。星期與精確學分是下述第三階段新增能力，不回溯計入本階段驗收。

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

### 第二階段提交的後續 CI 紀錄

以下只對應第二階段提交 [`777e582b575932922757e0e467adb3f1a6544f11`](https://github.com/Miiduoa/graduation/commit/777e582b575932922757e0e467adb3f1a6544f11)，該提交尚無第三階段的星期／學分篩選。這些遠端結果補足前述本機資源限制，不改寫當時本機未完成的事實。

- 全量 Web／Mobile 測試、Build Web／Mobile、Lint／Type 的主要檢查均為 success；提交檢查可由上述 commit 與 [PR checks](https://github.com/Miiduoa/graduation/pull/526/checks) 追溯。
- iOS Maestro job `128408032587` 為 success；這是 CI 的 iOS 自動化紀錄，不能等同真實手機驗收。
- Adoption 的首次執行在 Chrome 啟動階段逾時；只重跑失敗 job 後，[run `42374096736` 的 job `128411797078`](https://github.com/Miiduoa/graduation/actions/runs/42374096736/job/128411797078) 為 success。這項遠端結果也不代表前述本機元件視覺 QA 已完成。

## 第三階段（2026-11-07）：星期與精確學分篩選

本輪延伸第二階段的規則式公開查課，支援一個上課星期、一個精確學分，或兩者同時指定。例如「幫我查清大的星期一 3 學分資料庫課程」會保留 `nthu`、關鍵字「資料庫」、`weekday=1`、`credits=3`，再由固定官方來源查詢。仍未安裝 API Anything，也沒有改成模型原生 tool calling 或 MCP；跨校讀取不持久變更目前校別、個人匯入範圍或模型對話隔離規則。

### 契約與篩選順序

既有只帶關鍵字的請求維持 v1 回應形狀，不增加 `filters: {}` 或 `unresolvedCount`；原本允許的無 operation 舊回覆仍僅適用未篩選讀取。v2 必須至少帶一個有效的 `weekday` 或 `credits`，沿用同一端點，例如：

```text
GET /api/public-course-catalog?schoolId=nthu&q=資料庫&weekday=1&credits=3
```

篩選回覆必須帶 v2 operation／schema 版本、與請求完全一致的 `filters`，以及非負整數 `unresolvedCount`；客戶端也重新核對每一筆課程是否符合。若舊伺服器忽略新條件、回錯校或錯來源，整個篩選回覆會被拒絕，不降級成不受條件限制的清單。參數拒絕重複、未知欄位與無效值；內部 filter 只接受純資料物件，不執行 accessor。

兩校都從目前固定官方來源的完整公開快照開始，**先比對關鍵字，再判定篩選，最後才取最多 50 筆**；助理從已驗證結果預覽最多 5 筆。超過 50 筆時回報 `truncated`，不是先取前 50 筆再篩選。所有查詢共用該校快照，關鍵字與星期／學分不送進校方上游網址；完整快照指目前來源提供的資料，不表示涵蓋所有歷史學期。

篩選採三種結果：符合、不符合、資料不足。已知任何條件不符就排除；只有符合關鍵字、沒有已知不符，但仍缺少判定資料的課程，才計入 `unresolvedCount`。這個數字在截取前統計，另行顯示，不加入符合筆數，也不把缺資料解釋成「沒有這種課」。實作依據為[共用篩選契約](../../packages/shared/src/publicCourseFilters.ts)、[回應驗證](../../packages/shared/src/publicCourseCatalog.ts)與[操作執行器](../../apps/web/src/lib/server/publicCourseOperations.ts)，兩校 adapter 保留各自的來源解析。

### 語意與資料限制

- `weekday` 為 1–7，表示至少一組上課時段在指定日。例如星期一與星期四都有課的課程，符合「星期一有課」；不表示只有星期一。結果與匯入保留全部上課時段及教室配對，不裁掉其他日。可辨識星期也不等於已驗證該學期鐘點，原本的學期、時段與匯入核對仍須通過。
- `credits` 為 0–40 的有限數值，最多兩位小數，採數值完全相等；3 與來源的 3.0 可相符，0 學分也是有效條件。表單留白表示不限，送出時省略該參數；URL 的空值、超界值與重複值會被拒絕。校方學分欄位無法解析時，不能猜成 0 或已符合。
- 自然語句只接受單一星期與單一精確學分。日期、上下週、多天、範圍、比較與排除條件會要求釐清，例如「下週三」、「星期一和三」、「至少 3 學分」或「除了星期一」。先辨識完整條件，再移除結尾的課程用語，避免「星期三沒課／不上課／無課」被截斷後反向套用正向篩選。指定其他學期、鐘點、必選修與不衝堂也尚未支援。私人課務及寫入要求維持既有邊界，不因加上星期或學分而變成公開查課。[語句條件解析](../../packages/shared/src/publicCourseAssistantFilters.ts)

### Web／Mobile 與後續核對

Web 查課頁提供星期選單、精確學分欄位及清除篩選；Mobile 提供星期按鈕、學分輸入及清除條件。助理預覽與完整查課頁標示已查條件、其他上課日及資料不足筆數。結果保存送出時的關鍵字與 filters 快照；修改條件會取消舊請求、移除舊結果，切換校別或路由條件也會重設，晚到回覆不能蓋過新條件。Web 清除篩選會保留關鍵字重新查詢；Mobile 清除後由使用者按查詢送出。

Web CTA 將結果中的校別、`q`、`weekday`、`credits` 帶往既有 `/school-courses`；有效的純篩選連結也能以空關鍵字查詢。Mobile 從該次回答的 `read` 帶入 `publicSchoolId` 與扁平的 `filter.keyword/weekday/credits`，不讀取已改寫的對話草稿。重複或無效條件不自動查詢、不默默改成不限；Mobile 公開查課也不把靜宜既有的 `weekday=0` 解讀成合法公開星期。

Mobile 全域搜尋等既有入口若帶入格式合法的 `semester`，會保留關鍵字及合法星期／學分，明確提示指定學期尚未支援，並暫停自動讀取。使用者按「查詢最新公開課程」後才依保留的條件查詢目前官方快照；不默默丟棄指定學期並聲稱已符合，也不因舊入口附帶學期而丟掉可用的查課條件。無效學期仍拒絕進入查詢。

兩端仍由使用者挑選課程，再走既有課表 review／import；個人匯入校別確認、草稿保護、衝突核對及寫入前的資料快照檢查照舊。公開查詢與結果 CTA 不自動新增課表，也不向學校選課。核心畫面可對照 [Web 查課頁](../../apps/web/src/app/school-courses/PublicCourseSearch.tsx)與 [Mobile 查課頁](../../apps/mobile/src/screens/PublicCourseCatalogScreen.tsx)。

### 第三階段驗證紀錄

- 基底為第二階段提交 `777e582b575932922757e0e467adb3f1a6544f11`，繼續使用 PR #526 原分支。新提交的遠端 CI 由 [PR checks](https://github.com/Miiduoa/graduation/pull/526/checks) 追蹤，不沿用基底提交的 success 宣稱新篩選版本已通過。
- 本輪 Web／shared 相關 10 個檔案共 431 項通過：共用條件、自然語句與 client 3 檔 179 項（含短句否定的最後修正）；API／操作與來源 4 檔 166 項；Web 表單／頁面與結果卡 3 檔 86 項。Web 表單 effect 收尾後另重跑其中 60 項通過，不重複加總。
- Mobile 最後統一序列執行 7 suites、124 項全數通過，包含一般助理公開查課、feature、條件表單、路由交接、原查課頁、完整多日時段匯入與既有匯入核對。合法舊 semester handoff 的修正已納入此批驗證。短句否定收尾後，受影響的助理畫面與 feature 2 suites、27 項再次通過，不重複計數。先前測試計時器清理逾時已修正，遭 SIGKILL 的 suite 也重跑通過；沒有跳過測試或調高 timeout，早期 40 項的重跑不重複計數。
- 2026-11-07 21:29（台灣時間），以新增 shared 自然語句 client → 本機實際 GET route → 固定官方 HTTPS 來源串接，當前校別為靜宜 `pu`。「查清大星期三3學分的資料課程」取得清大 1 筆：`11510STAT202100`「資料結構與演算法」，學期 `1151`、學分 `3`、校方時間 `M3M4W2`；星期一及星期三的時段完整保留。
- 將同一問句校別改為暨大，取得 1 筆：`130021`「資料結構與演算法(上)」，學期 `1151`、學分 `3.0`、校方時間 `3bcd`。兩校均為 HTTP 200、v2 回覆、預覽 1 筆、`truncated: false`、`unresolvedCount: 0`；這是當次條件的實際結果，不是對所有課程資料完整性的保證。
- 上述實測各校僅一次固定官方 GET，只有 `Accept` header，`credentials: omit`、`redirect: error`；搜尋字、星期與學分條件皆未送到校方上游。這是本機 route 串接官方資料，並非已部署 production 端點驗收；原始執行輸出未納入公開文件。
- Node `22.23.4`：shared 完整 TypeScript 檢查通過。Web 完整 TypeScript 在本機以 768 MiB heap 序列執行，因 heap out of memory 中止（exit 134）；其後以 2 GiB heap 單獨重跑仍遭終止（exit 137），皆沒有產生型別診斷。第三階段初版提交 `2cd2f96e1c800045852c09a71c1b1df57a1cb17a` 的 [Lint／Type](https://github.com/Miiduoa/graduation/actions/runs/42377571625/job/128418208580) 與 [全量 Mobile Tests](https://github.com/Miiduoa/graduation/actions/runs/42377571625/job/128418208313) 已 success；後續短句否定修正的完整 CI 仍須以最新 head 核對。
- 修改的 33 個 TypeScript／TSX 檔案以各自 ESLint 設定檢查，零錯誤；Mobile 僅保留基底 `CampusAssistantScreen` 的兩個 effect dependency 警告。`git diff --check` 通過。遠端樹、提交與最新 CI 結果另記錄於 PR 描述，尚不代表已合併或正式部署。
- 本機元件瀏覽器視覺 QA 與真實手機驗收仍未完成，本輪沒有重試受阻的瀏覽器環境。互動測試、CI build 與前一提交的 Maestro／adoption 成功各有範圍，不代替本輪完整站或實機驗收；目前也不宣稱已部署或超越競品。
