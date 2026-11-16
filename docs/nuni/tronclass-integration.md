# TronClass 獨立綁定與作業整合

更新日期：2026-11-16。此文件描述本分支的實作與驗證範圍，不代表已部署或已完成校方真人帳號驗收。

## 功能狀態

Web 入口為 `/tronclass`，`/classroom` 的課程清單提供連接入口。目前只支援靜宜大學 `https://tronclass.pu.edu.tw`。

| 能力 | 本分支狀態 |
| --- | --- |
| 使用 nuni 平台登入或 Firebase 登入綁定 TronClass | 已實作；不依賴 E-campus session |
| 重新連接、換綁、解除連接 | 已實作，使用 revision 防止舊請求覆蓋新綁定；校方 session 失效時在原頁開啟重新連接表單 |
| 本人 ongoing / upcoming 課程、作業與截止時間 | 已實作，分頁不完整會顯示部分失敗 |
| 本人個人作業的歷次繳交內容 | 已實作官方 GET 來源，顯示本文、附件名稱／大小、來源紀錄時間及五種狀態；與本系統新送出的收據分開 |
| 選定課程的公告與教材 | 已實作，包含一般活動與 courseware 活動 |
| 來源隱藏／未發布資料過濾 | 已套用於作業、公告、教材與附件，以及作業歷史的讀取邊界；不因另一旗標允許就忽略明確拒絕 |
| 使用已綁定 session 下載教材附件 | 已實作，重新確認本人課程、活動與附件下載權限；真人下載仍待驗收 |
| 既有 Assistant 直接查詢 TronClass | 已實作，回傳本人課程、作業狀態、公告與教材；私有結果不加入雲端模型歷史 |
| Agent 代理下載與準備作業 | 已實作，需使用者分別授權；在聊天內下載附件、選定作業並開啟預覽 |
| 隨時調整／撤銷 Agent 權限 | 已實作，綁定 revision 與權限版本雙重檢查；換綁後重新授權 |
| 作業文字、附件選擇、預覽、複製內容 | 已實作，草稿及檔案只留在目前頁面記憶體 |
| 上傳 → 最終送出 → 讀回收據 | 服務及 UI 已實作，以注入測試來源驗證 |
| 真正寫入校方 TronClass | **尚未完成契約驗證，production adapter 固定拒絕寫入** |
| 重交、撤回、小組繳交、代替其他人繳交 | 未實作；小組歷史也回傳 `group-unsupported`，引導至原作業查看 |
| 原生 Mobile 的新綁定／作業畫面 | 本次未實作；舊作業、討論發文／回覆、問卷與同儕互評 writer 改為明確拒絕，避免假成功 |

TronClass 與 nuni 自有課程是兩個不同的來源。nuni 自有課程的收件、附件與教師批改，不是 TronClass 的正式繳交證據。

## 本人歷次作業紀錄

本輪依靜宜官方公開前端確認讀取路徑，新增 `readSubmissionHistory()`。伺服器先以目前綁定的校方學生檢查本人課程與作業清單，再呼叫 `GET /api/activities/{activityId}`，確認活動 ID、課程 ID、`type: homework`、可見性及 `submit_by_group: false`，最後才讀取 `GET /api/activities/{activityId}/students/{studentId}/submission_list` 的 `{ list: [...] }`。學生 ID 來自伺服器已驗證的綁定，不接受瀏覽器指定他人 ID 或來源 URL。官方資源版本、SHA-256、模組定位及尚未驗證的範圍見 [2026-11-16 公開前端契約查核](tronclass-public-contract-2026-11-16.md)。

歷史隨 `prepare` 回傳，顯示五種逐筆狀態：

| state | 畫面名稱 | 判讀原則 |
| --- | --- | --- |
| `submitted` | 已繳交 | `is_draft`、`is_redo`、`submit_by_instructor` 均明確為 false |
| `draft` | 草稿 | `is_draft: true`，且未同時標示退回重做 |
| `returned` | 退回重做 | `is_redo: true`，且未同時標示草稿 |
| `teacher-marked` | 教師標記已繳 | 明確不是草稿或退回，且 `submit_by_instructor`、`marked_submitted` 均為 true |
| `unknown` | 狀態待確認 | 必要旗標不足、型別不符或互相矛盾，不用 JavaScript 的 `!undefined` 推論已繳交 |

只有 `is_latest_version: true` 才建立 `latestId`，保留各版本自己的狀態，不以最大 ID、第一筆或時間猜測最新版。缺少最新版標記時仍可逐筆查看；重複最新版、重複 ID、身分或範圍不符、顯示不完整分頁等情況，整份歷史回報 `unavailable`，不回傳看似完整的部分紀錄。來源 `created_at` 轉成 `createdAt` 顯示為「紀錄時間」，不是已驗證的正式送出時間；無法解析的時間維持 null。

只輸出整理後的本文、附件名稱與大小，本文以純文字顯示，超過 20,000 字元標示截斷。清單及單筆附件各上限 100 筆，超量不默默截成完整結果；歷史附件目前不提供直接下載。外部資源與簡報只顯示另有資源的提示。任何 `submit_by_instructor: true` 的教師建立紀錄均移除本文、附件及其他資源，不透傳建立人、教師評語、分數或 `submission_correct`。

`submit_by_group: true` 直接回傳 `group-unsupported` 並保留原作業入口，不呼叫個人歷史來代替小組結果。一般讀取失敗顯示「暫時無法讀取」，可在頁內重試；空清單只代表這次沒有取得紀錄。校方登入失效或明確撤銷存取權限則保留錯誤，不降級成空清單。

**歷史不是本系統新送出的收據。** `history` 不填入 `receipt`，不參與 `submit`／`reconcile` 的成功判定，也不解除寫入限制。既有正式版本、教師標記或上傳檔案，都不能證明 nuni 的某次新送出已成功。

## 在既有 Assistant 使用 Agent

先登入 nuni，在 `/tronclass` 連接學校帳號，再於「TronClass 助理權限」選擇允許的能力。三項權限預設全關：讀取課程資料、下載教材、準備作業。下載與準備均需要同時開啟讀取權限，沒有「代為寫入」權限。

使用者可以在既有 `/ai-assistant` 對話中輸入「TronClass 有哪些未交作業」、「查詢 TronClass 公告」、「幫我下載 TronClass 教材」或「幫我準備 TronClass 作業」。結果直接顯示在對話：課程與作業選項、校方繳交狀態、公告、附件下載及作業預覽，不需要另開一個 Agent。一般概念說明、否定操作與不支援的寫入要求不會被當成下載授權。

- Agent 根據當次使用者文字選擇有型別的工具；校方作業內文、公告、歷史訊息與模型輸出不會變成工具指令。
- 未確認的繳交狀態維持 `null`，和已交／未交分開顯示；資料不完整不代表全部作業已完成。
- 課程、作業或附件目標不唯一時，顯示可選項目。只有明確下載要求、完整資料與唯一可確認附件才可直接啟動下載；其他情況由使用者選擇。
- 聊天中的作業流程只可準備與預覽。即使未來人工繳交 adapter 開放，Agent 的 upload、submit、reconcile 仍明確拒絕，不會暗自取得寫入能力。
- TronClass 對話與結果不加入雲端模型 history；資料顯示為文字，不執行校方 HTML 或工具要求。這不代表已具備通用模型分析、背景排程、自動答題或所有校方操作。
- 對話結果列出來源、查詢時間、已執行／部分完成／未執行的操作及可用能力；下載只在取得合格檔案後啟動瀏覽器下載，不宣稱已保存至使用者磁碟。

Agent grant 存在既有 server-only 綁定文件中，每次更新以 `revision` 與 `expectedVersion` 做 transaction compare-and-set。解除連接、重新連接與關帳都會移除原授權；重新開啟權限產生新版本，舊請求仍不能繼續。每次操作前後會重驗目前 nuni actor、綁定與授權；前端對已取消或切換身分的晚到結果不啟動下載。已顯示的資料無法因事後撤權從使用者記憶中收回，撤權約束後續操作與尚未完成的結果。

## 登入與資料隔離

- 平台登入使用伺服器驗證過的 `platform:pa_UUID`；Firebase 使用 `firebase:UID`，兩個身分空間不互相替代。
- 瀏覽器平台請求使用 HttpOnly cookie 與 `X-Campus-Session`。原生平台請求可用 `Authorization: Platform …`；Firebase 使用 Bearer ID token，後端檢查撤銷與帳號狀態。
- 明確但不合法的 Authorization 不會退回另一個 cookie 帳號。平台登入載入、失敗或登出中，UI 不會轉用背景 Firebase 身分。
- 校方密碼只用於當次登入，不寫入 Firestore、localStorage 或 sessionStorage。UI 發出連接請求後即清空密碼欄。
- 校方 session 以 AES-256-GCM 加密存放，驗證資料包含 owner 與 revision；密鑰僅在伺服器。預設有效期 12 小時，重新綁定會更換 revision。
- 解除連接保留失效 revision，刪除帳號與 cookie 等連線資料，防止進行中的舊請求重新寫回。
- 長時間讀取結束會再驗證 nuni 身分與校方綁定；使用者換帳號、重新連線或解除連線後，舊資料不會送回新畫面。
- 本分支不授予校務角色、課程權限或組織成員資格，也不恢復 `alcat.pu.edu.tw` / `mypu.pu.edu.tw` 的暫停流程。

當查詢、歷史讀取或下載收到 `TRONCLASS_RECONNECT_REQUIRED`，Web 會立即撤下依賴舊連線的畫面，清空密碼欄，在原頁顯示重新連接表單並保留 compare-and-set 所需的 revision。即使本地綁定的 12 小時期限尚未到，也不以本地 `connected` 狀態覆蓋校方的登入失效結果。重新連接前先停止舊資料與下載流程，晚到的 status、查詢或繳交紀錄不能恢復舊畫面。

來源資料若提供 `is_hidden`、`hidden` 或 `published`，會依已知 boolean／0、1 編碼檢查；任一拒絕或無法辨識的值都不放行。缺少這些旗標的舊格式仍沿用既有本人課程及附件權限檢查，不能把「沒有隱藏旗標」當成獨立授權。相同活動在一般活動與 courseware 清單出現時，拒絕標記不會被另一份可見資料蓋過。

## HTTP 介面

`POST /api/tronclass`，`Content-Type: application/json`，JSON 上限 96 KiB。請求只接受各 action 已列出的欄位。

| action | 必填欄位 | 用途 |
| --- | --- | --- |
| `status` | 無 | 目前綁定狀態，不包含 cookie |
| `connect` | `schoolId: "pu"`, `account`, `password`, `expectedRevision` | 驗證校方身分後綁定；初次 revision 為 null |
| `disconnect` | `expectedRevision` | 解除目前綁定 |
| `sync` | 無；可加 `courseId` | 讀取全部本人課程與作業；選定課程時讀公告、教材 |
| `prepare` | `courseId`, `homeworkId` | 讀取作業資訊、可送出條件及獨立的本人歷史 `history`；歷史不構成 `receipt` |
| `submit` | `courseId`, `homeworkId`, `revision`, `operationId`, `content`, `attachments`, `confirmed: true` | 最終送出；attachments 為本次已驗證的 fileId，非來源 upload key |
| `reconcile` | `operationId`, `revision` | 只查證原操作，不重新送出 |

`PUT /api/tronclass` 接收單一附件原始 bytes。query 為 `courseId`, `homeworkId`, `revision`, `operationId`, `fileId`, `name`；Content-Type 為檔案 MIME。單檔最多 10 MiB、每份最多 4 個檔案、總附件最多 20 MiB、文字最多 20,000 字元；校方規則若更嚴格，採更嚴格者。這是應用程式上限，不是校方的通用額度。

回應使用 `Cache-Control: no-store, private`，不快取私人校方資料。一般請求每 owner 每程序每分鐘 60 次，同步每分鐘 6 次；另有 Firestore 持久化登入嘗試限制（15 分鐘：owner 6 次、同校方帳號 5 次）。一般請求限制不是跨程序全域配額。

### 教材附件下載

`POST /api/tronclass/material-download` 接收 `courseId`、`activityId`、`uploadKey`、`revision`。伺服器先確認目前校方學生的課程清單，再從該課程的一般／courseware 活動核對附件與 `allow_download: true`，只讀取固定校方 `/api/uploads/{key}/blob`。前端傳入任意網址、其他活動的 key、隱藏活動或不允許下載的檔案都不能下載。

回傳 attachment 與經過清理的檔名；不把校方 cookie 帶到瀏覽器。支援一般文件、壓縮檔、圖片、音訊與影片 MIME，拒絕 HTML／JSON 登入回應與未知格式；不跟隨來源 redirect。單檔上限 25 MiB、讀取校方來源最多 30 秒，回傳使用 64 KiB 區塊串流、傳送最多 60 秒。每程序最多同時處理 2 個下載，完成、取消或逾時才釋放名額，超過時回傳 429。檔案僅在這次請求記憶體中處理。超過限制或需跳轉到儲存服務的教材保留原始教材入口，不擴大校方網址白名單。

下載完成前再確認綁定與 nuni 身分；前端也會丟棄舊 owner／revision／課程的晚到結果。下載 bytes、檔名與權限不是由前端原始連結直接採信。

### Agent 介面

三個 Agent 路由沿用同一身分驗證、緊急停止設定與私人不快取回應。JSON 上限 8 KiB，僅接受明列欄位，不接受由客戶端指定 owner。

| 路由 | action／資料 | 用途 |
| --- | --- | --- |
| `POST /api/tronclass/agent-permissions` | `status` | 取得目前綁定的權限與版本，不包含校方 session |
| 同上 | `set`, `revision`, `expectedVersion`, `permissions` | 交易式更新三項權限；其他裝置先更新時拒絕舊版本覆蓋 |
| `POST /api/tronclass/agent` | `capability` | 取得可用能力；正式作業送出固定為 false |
| 同上 | `ask`, `question`；可帶 `courseId`、準備流程的 `homeworkId` | 執行當次唯讀查詢／選目標／準備並回傳結構化結果 |
| 同上 | `prepare`, `courseId`, `homeworkId` | 在 Agent 權限內重新讀取作業準備條件，`canSubmit` 固定 false |
| `POST /api/tronclass/agent/download` | `courseId`, `activityId`, `uploadKey`, `revision` | 重用教材下載器，再加上可撤銷的讀取與下載權限檢查 |

權限管理與 Agent 一般請求每 owner 每程序每分鐘 30 次；昂貴的 ask／prepare 每分鐘 6 次。下載沿用既有大小、時間與並行上限。這些限制不是跨程序全域配額。

## 送出與失敗恢復

1. 讀取本人課程與作業，確認來源已提供明確規則。
2. 使用者檢視預覽，勾選確認，送出前重新讀取條件。
3. 逐檔上傳並驗證完整附件集合；任何一檔失敗就不進入最終送出。
4. Firestore transaction 取得操作及作業鎖。鎖以校方、學生、課程、作業為範圍，即使同一校方學生綁定不同 nuni 帳號也共用。
5. 再確認目前綁定與最新作業規則，之後才呼叫來源送出。
6. 讀回來源收據，核對學生、課程、作業、正式 submitted 狀態、有效時間、本次文字與完整附件；排除原本已存在的收據。

HTTP 200、附件上傳完成或 writer 沒有拋例外，都不構成正式繳交成功。結果不明會保留 `unknown`，相同或其他操作不得盲目重送。

只有能確定尚未開始呼叫來源 submit 的失敗，才可以交易式釋放該操作的 claim。純附件上傳失敗時，UI 建立新 operation、將全部附件恢復待上傳；校方可能留下未關聯的上傳物件，清除方式須等正式上傳契約驗證後補齊。

UI 的 sessionStorage 只保存 owner＋課程＋作業對應的 operation ID，供重開頁面後查證；沒有保存作業文字、附件或密碼。伺服器 ledger 會保存上傳 metadata、內容 digest，以及確認成功後的收據（含收據文字），不可宣稱後端完全不保存作業內容。

同一 nuni owner 重新連接同一校方 studentId 後，可以用新 revision 只讀查證舊 operation；換成不同學生會被拒絕。草稿仍依身分及 revision 隔離。

## 正式寫入開放條件

production `createTronClassSubmissionSource()` 目前為 `contractVerified: false`，`uploadFile`、`submit`、`listSubmissions` 會明確拒絕。把 `TRONCLASS_HOMEWORK_WRITE_ENABLED` 改為 true 仍無法解鎖。

本輪新增的 `readSubmissionHistory` 是獨立唯讀能力，不受 writer 開放條件限制；它不等同於寫入流程的 `listSubmissions` 收據查證。公開前端已提供真正 final 與多階段 upload 的路徑證據，但尚未取得可證明真實寫入成功、完整附件關聯及超時恢復的校方回應。

開放前需要一個可控制、可驗證結果的測試課程及作業，記錄實際上傳、關聯附件、最終送出、讀回本人收據的校方契約；敏感 cookie、帳密及作業內容不得放進版本庫或測試 fixture。需確認：

- CSRF／session 更新、校方課程與學生識別、正式 submitted 與 draft 的差異。
- 檔案類型、大小、數量、可送交時間、補交、剩餘次數、個人／小組作業等權限。
- 文字與完整附件如何從正式收據回讀；超時後如何辨認此次操作，防止誤認舊版本。
- 真正送出後，校方學生頁與教師收件都能看到同一筆結果。
- 在隔離環境驗證之後，才能實作 verified adapter，再開啟 runtime write switch。

目前未使用真人校方帳號、未對學校送出作業，也未證明所有上述契約已成立。

### 離線契約查核工具

`scripts/tronclass/analyze-har.mjs` 可在本機檢查已獲授權的 HAR，輸出固定靜宜 origin、白名單路徑模板、HTTP method／status、去值化 JSON 型別與 upload → final → 本人 readback 的證據缺口。原始 header、cookie、query、學生代號、檔名、內容及未知欄位名稱都不輸出；輸入、分析深度與輸出均有限制，錯誤也使用固定代碼。

此工具不連網、不重播操作，不會自行開放 adapter。HAR 可被編輯，HTTP 2xx 或完整觀察鏈也不能取代真人校方驗收，報告的 `contractVerified` 永遠是 false。使用方式、輸入限制與缺口說明見 [`scripts/tronclass/README.md`](../../scripts/tronclass/README.md)。原始 HAR 不應提交 Git 或傳入對話。

**目前分析器仍使用原有候選路徑，尚未完整辨識本輪確認的 `submission_list`、`/api/course/activities/{id}/submissions`、二進位上傳及 callback。空報告或缺少 chain 不能解讀成 HAR 中沒有這些動作。** 下一步需連同狀態欄位與附件關聯一起更新分析器；詳見 [公開前端契約查核的工具缺口](tronclass-public-contract-2026-11-16.md#離線分析器的目前缺口)。

## 環境設定

沿用既有平台 API、`WEB_PUBLIC_ORIGIN`、Firebase Admin 服務帳號與校方網路 relay。Firebase Admin 由既有 `getFirebaseAdmin()` 初始化，必須符合目前專案的 project ID；不要建立替代資料庫或放寬 Firestore client rules。

| 設定 | 行為 |
| --- | --- |
| `TRONCLASS_INTEGRATION_ENABLED=false` | 緊急停止本整合路由；未設時允許綁定與唯讀操作 |
| `TRONCLASS_SESSION_SECRET` | 至少 32 字元，用來衍生 session 加密密鑰；未設時沿用 `BFF_SESSION_SECRET` |
| `TRONCLASS_HOMEWORK_WRITE_ENABLED=true` | 只有來源契約也已驗證時才可能允許寫入；本分支 adapter 仍固定拒絕 |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | 沿用既有伺服器密鑰設定；內容必須是該 runtime 可解析的 JSON |

換密鑰後，舊加密 session 需重新連接，不應在錯誤訊息或 log 中輸出密鑰與 cookie。設定範例在 `apps/web/nuni.env.example`。

新增私有集合 `_tronClassBindings`、`_tronClassLoginAttempts`、`_tronClassSubmissionOperations`、`_tronClassSubmissionLocks` 沿用 server-only 存取；現有 Firestore rules 沒有給它們 client 讀寫權限。不得對 unknown operation 或對應作業鎖設定自動刪除，否則會失去防重送依據。

## 帳號刪除與保留期限

Firebase 既有 `accountDeletion` 在標記關帳後，會呼叫 server-only 的 `closeTronClassOwner()`。清理順序為：

1. 將 binding 改成永久關閉標記，只保留 owner hash、隨機 revision、時間與狀態，先阻止進行中的登入或操作寫回。
2. 對該 owner 的鎖交易式重讀。只有持久化 `not-sent` 才能釋放；其他鎖改成不含身分、檔案或內容的 `owner-deleted` 標記，避免校方同學生換 nuni 帳號後重送。
3. 分頁刪除該 owner 的作業 ledger 與登入嘗試。共用的校方帳號登入配額不因刪帳歸零。

所有 ledger 變更的 transaction 也會讀取關閉標記，防止清理完成後被尚未結束的請求重新建立。已確認收據的 ledger 日後到期清除，仍會保留作業鎖；重放同一 operation ID 也不能重新送交。

**平台帳號（Google／nuni）關帳仍有一個外部整合待辦：**實際關帳工作位於本 repo 之外的 nuni API，目前沒有可呼叫 Firestore 清理的 hook。可信的 closure job 必須以驗證過的 platform account ID 呼叫同一清理函式，不能暴露讓客戶端任意傳 owner 的端點。不能將本次 Firebase 清理宣稱為平台帳號也已自動清理。

程式已寫入下列 `purgeAt`，但本次**未建立或部署 Firestore TTL policy**，因此尚不能保證背景自動清除時間：

| 文件 | purgeAt |
| --- | --- |
| 已連接校方 session | 12 小時有效期到期 |
| 登入嘗試配額 | 15 分鐘視窗到期 |
| 尚未最終送出的 draft operation | 24 小時 |
| 已確認成功的 receipt operation | 30 天 |
| unknown / submitting operation | null，不自動到期 |
| closed / disconnected 綁定標記、所有作業鎖 | 不設定 TTL |

正式啟用前，需要對 `_tronClassBindings`、`_tronClassLoginAttempts`、`_tronClassSubmissionOperations` 的 `purgeAt` 設定 TTL policy，保留上述永久標記，並接好平台關帳 hook。

## 驗證方式與範圍

使用專案支援的 Node 22，先執行 `node scripts/build-functions-shared.cjs`。Web 測試在 `apps/web` 執行 `vitest run`，包含 binding、auth、reader、route、submission source／service、Agent grants／意圖／工具／下載、client、TronClassWorkspace 與既有 Assistant／NuniApp 回歸；另外驗證 Mobile 五個舊 writer 沒有任何網路送出。HAR 測試使用 `node --test scripts/tronclass/analyze-har.test.mjs`，已加入既有 CI。

2026-11-16 本輪驗證結果如下。這是本次指定範圍的回歸結果，不代表整個 monorepo 的所有測試均已執行；重跑的子集合不重複累加。

| 範圍 | 結果 |
| --- | --- |
| Web 回歸 | **27 個測試檔、599 / 599 通過** |
| 完整 Web TypeScript 檢查 | 通過，exit 0 |
| 本輪修改的 Web TypeScript 檔 ESLint | **0 errors** |
| 共用歷史回應 parser ESLint | `--max-warnings 0` 通過 |
| nuni UI design gate | `--base origin/main` 通過 |
| Backend account＋dorm 回歸 | **49 / 49 通過**，為這兩個範圍的合計 |
| Backend TronClass scraper 回歸 | **88 / 88 通過** |

本輪涵蓋本人歷史 GET 的來源及身分範圍核對、草稿／退回／教師標記／未知狀態、最新版與來源時間、教師內容移除、分頁與資料上限、小組未支援、歷史與新收據隔離，以及來源隱藏過濾、校方登入失效與晚到結果的重新連接行為。既有 Agent 與作業權限、防重及恢復流程亦在 Web 指定回歸範圍內。前輪 Mobile 舊 writer 與離線 HAR 的測試紀錄不列入本輪數量。

測試中的 verified provider、帳號、課程及收據都是合成資料，用於證明權限隔離、防重、失敗與恢復行為。官方公開 JavaScript 的匿名 GET 查核可證明前端使用的路徑與欄位，不能取代真人帳號回應、真實繳交或教師收件驗收。本輪沒有宣告正式部署，也未宣告桌面／窄螢幕／深色模式的瀏覽器視覺驗證通過；UI design gate 是程式檢查，不等同視覺驗收。

## 官方依據

- [靜宜大學教學發展中心：TronClass 登入說明](https://tdcenter.pu.edu.tw/p/406-1061-45101,r1105.php?Lang=zh-tw)：校方正式入口與登入帳密說明。
- [TronClass 官方作業說明](https://support.tronclass.com/tw/question/homework/)：上傳檔案與正式繳交是不同步驟；作業規則與版本需要依實際作業確認。
- [2026-11-16 官方公開前端契約查核](tronclass-public-contract-2026-11-16.md)：記錄靜宜官方資源 URL、版本、SHA-256、模組及本人歷史／final／upload 證據，並列出完整 schema、CSRF、真實寫入及工具缺口。

公開說明與前端程式提供部分接口證據，尚不足以構成經過受控校方驗收的完整學生 REST 寫入契約。
