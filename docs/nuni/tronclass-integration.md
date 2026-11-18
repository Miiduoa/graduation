# TronClass 獨立綁定與作業整合

更新日期：2026-11-18。此文件描述本分支的實作與驗證範圍，不代表已部署或已完成校方真人帳號驗收。

## 功能狀態

Web 入口為 `/tronclass`，`/classroom` 的課程清單提供連接入口。原生 Mobile 入口為 `TronClassWorkspace`，學習首頁與 nuni 課程工作區均有入口；深連結路徑為 `/tronclass`。目前只支援靜宜大學 `https://tronclass.pu.edu.tw`。

| 能力 | 本分支狀態 |
| --- | --- |
| 使用 nuni 平台登入或 Firebase 登入綁定 TronClass | 已實作；不依賴 E-campus session |
| 重新連接、換綁、解除連接 | 已實作，使用 revision 防止舊請求覆蓋新綁定；校方 session 失效時在原頁開啟重新連接表單 |
| 本人 ongoing / upcoming 課程、作業與截止時間 | 已實作，分頁不完整會顯示部分失敗 |
| Web／Mobile 待辦工作區 | 支援作業／課程搜尋、待繳／未知／已繳篩選與期限排序；送出及查證期間避免切換作業，可信成功結果不被較早同步覆寫 |
| 校方作業詳情與設定 | 已實作本人活動 GET；顯示個人／小組、形式、開放／截止、已用與剩餘次數、重交及撤回設定，不推論寫入權限 |
| 連接中斷後繼續編輯 | 已實作同一已驗證學生的頁內記憶體恢復；重新同步、重新讀取作業後才恢復文字與 File，不沿用舊上傳狀態 |
| 本人個人作業的歷次繳交內容 | 已實作官方 GET 來源，顯示本文、附件名稱／大小、來源紀錄時間及五種狀態；與本系統新送出的收據分開 |
| 本人歷次繳交的一般附件下載 | Web 下載及 Mobile 分享已接上相同本人 BFF；來源明確允許的一般附件才提供入口，下載前後重新核對同一版本、身分及權限 |
| 選定課程的公告與教材 | 已實作，包含一般活動與 courseware 活動 |
| 來源隱藏／未發布資料過濾 | 已套用於作業、公告、教材與附件，以及作業歷史的讀取邊界；不因另一旗標允許就忽略明確拒絕 |
| 使用已綁定 session 下載教材附件 | 已實作，重新確認本人課程、活動與附件下載權限；真人下載仍待驗收 |
| 既有 Assistant 直接查詢 TronClass | 已實作，回傳本人課程、作業狀態、公告與教材；私有結果不加入雲端模型歷史 |
| Agent 代理下載與準備作業 | 已實作，需使用者分別授權；在聊天內下載附件、選定作業並開啟預覽 |
| 隨時調整／撤銷 Agent 權限 | 已實作，綁定 revision 與權限版本雙重檢查；換綁後重新授權 |
| 作業文字、附件選擇、預覽、複製內容 | 已實作；Web 草稿及檔案只留在目前頁面記憶體，Mobile 文字留在記憶體、附件使用有清理機制的受控 cache 副本 |
| 依已確認的作業規則編輯與預覽 | 已實作；保留零附件額度，送出前先核對全部文字、檔案與總量，規則未知時只標示本頁整理上限 |
| 上傳 → 最終送出 → 本人版本確認 | 公開 API、v2 service、持久化 journal 及 Web／Mobile UI 已接線，以注入的合成校方來源驗證；正式 writer 仍停用 |
| 官方送出協定與受控文字候選實作 | 已實作 request builder、acknowledgment parser 及單次 POST；公開 service 的 server gates 通過後才會呼叫，正式 provider 尚未通過校方驗收 |
| 受控附件傳輸及正式版本讀回 | 已實作 metadata → binary → callback、帶附件的 final POST、精確本人版本讀回；公開 API 已接上 v2 prepare／upload／submit／reconcile 與新確認結果，正式寫入仍未啟用 |
| 真正寫入校方 TronClass | **尚未完成契約驗證，production adapter 固定拒絕寫入** |
| 重交、撤回、小組繳交、代替其他人繳交 | 未實作；小組歷史也回傳 `group-unsupported`，引導至原作業查看 |
| 原生 Mobile 的新綁定／作業畫面 | 已實作獨立綁定、選課讀取、作業詳情、文字／選檔／預覽／再次確認、條件式送出與唯讀查證，使用相同 BFF；正式 writer 的停用條件相同 |
| 原生 Mobile 教材下載 | 使用固定、已驗證本人權限的 material-download BFF；限定大小、檔名與完整 bytes，透過原生分享介面儲存，使用後清理暫存 |
| 資料到期與關帳清理 | 已實作 Spark 可用的有上限背景清理與平台關帳 outbox worker；均需明確部署設定。TTL 另有可選設定，不默默啟用計費 |

TronClass 與 nuni 自有課程是兩個不同的來源。nuni 自有課程的收件、附件與教師批改，不是 TronClass 的正式繳交證據。

## 校方最新作業設定與草稿恢復

`getAssignment()` 在本人課程與完整作業清單核對後，讀取固定的 `GET /api/activities/{activityId}`。`prepare.details` 獨立於 `rules`、`canSubmit`，只呈現來源明示的設定：個人／小組、一般／選題作業、開放與截止時間、一般期間狀態、已用與剩餘次數、重交設定與是否允許撤回。公開前端的欄位依據見 [來源查核](tronclass-public-contract-2026-11-16.md)。

缺少資料時保留 `null`／`unknown`，不把未提供期限說成無期限，也不把剩餘零次改成預設額度。次數接受數字及嚴格十進位字串，拒絕空白、前導零、指數、負數、小數及尾隨文字；只有明示有次數限制且上限、已用次數均合法，才計算剩餘次數。這些觀察不等於補交、重交或正式送出的資格。

有可用詳頁時，編輯器與預覽採用最新標題、說明及期限。老師清空說明或期限後，不再回填舊清單的內容。暫時 429／5xx 可保留獨立確認可見的摘要並顯示設定讀取失敗；401、403、活動 404／410、隱藏或範圍錯誤會停止資料回傳。讀取本人歷史途中再次發現活動隱藏、刪除或撤權，也不能被降級為歷史暫時不可讀後回傳較早的內容。只有 `submission_list` 自身的 404 仍可顯示歷史不可讀，不能用它推論活動已刪除。

作業文字與選取的 `File` 只保留在這個頁面的記憶體。連接失效時先撤下資料，重新連接後，比對伺服器產生的 `studentKey`；同一 nuni owner、校方與已驗證的校方使用者才會相同。該值使用既有伺服器密鑰的 HMAC-SHA256，輸入包含用途標記及上述範圍，不公開校方數字 ID，也不是可用來授權 API 的憑證。過期、解除、密文失效時回傳 `null`；舊版回應沒有此欄位可照常連接，但不恢復草稿。

新的同步結果找到原作業後，使用者可按「繼續編輯保留的草稿」；再通過新 revision 的 `prepare`，才顯示文字與附件。重新產生附件本地 ID，狀態回到 `ready`，不保留 revision、上傳 ID、來源權限或收據。若原操作結果不明，仍以原 pending operation ID 查證，不能重新送出。換 nuni owner／平台 session、換校方已驗證使用者、解除連接、明確清除或關閉／重整頁面，都會丟棄草稿。本次沒有建立多份草稿資料庫。

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

只輸出整理後的本文、附件名稱與大小，本文以純文字顯示，超過 20,000 字元標示截斷。清單及單筆附件各上限 100 筆，超量不默默截成完整結果；符合一般附件下載契約的項目另帶 `download: { uploadId }`，不包含來源 URL、Cookie 或 storage key。外部資源與簡報只顯示另有資源的提示。任何 `submit_by_instructor: true` 的教師建立紀錄均移除本文、附件及其他資源，不透傳建立人、教師評語、分數或 `submission_correct`。

`submit_by_group: true` 直接回傳 `group-unsupported` 並保留原作業入口，不呼叫個人歷史來代替小組結果。一般讀取失敗顯示「暫時無法讀取」，可在頁內重試；空清單只代表這次沒有取得紀錄。校方登入失效或明確撤銷存取權限則保留錯誤，不降級成空清單。

**歷史不是本系統新送出的收據。** `history` 不填入 `receipt`，不參與 `submit`／`reconcile` 的成功判定，也不解除寫入限制。既有正式版本、教師標記或上傳檔案，都不能證明 nuni 的某次新送出已成功。

### 本人歷史附件下載

`POST /api/tronclass/submission-attachment` 只接受 `courseId`、`homeworkId`、`submissionId`、`uploadId`、`revision` 五欄；本人學生 ID 與 Cookie 由目前伺服器綁定取得。下載前完整核對本人課程、作業清單、可見個人活動及本人全部歷史，精確選擇指定版本的附件。只有明確 `allow_download: true`、非教師／不明狀態、一般 upload 且未被隱藏、刪除或審核拒絕時才開放。參照附件、外部 source、批改 PDF、專案／知識圖譜與上傳失敗等不同契約不走這個入口。

後端使用固定靜宜 origin 的數字 upload ID blob 路徑，不接受前端網址、storage key 或他人學生 ID，不跟隨 redirect。完整 bytes 受 25 MiB 與 30 秒總預算限制，核對 HTTP 長度、來源大小、MIME 及偽裝登入頁。讀完檔案後再讀取本人歷史與活動權限；版本被刪除、撤權、換綁或附件 metadata 變更時，已讀 bytes 不送給使用者。教材與歷史附件共用每程序兩個下載名額及每帳號速率限制，私有回應不快取。

Web 從目前作業的歷史紀錄直接下載。Mobile 使用相同固定 BFF、目前 Platform／Firebase 身分及受控 cache 分享；下載、等待分享能力及分享前後核對 owner、revision、到期時間，離頁時取消傳輸，完成後清理暫存。兩端遇到較晚回傳的舊連線結果都不啟動下載／分享。下載不更動作業狀態，也不建立、清除或重送 pending operation。

以上透過合成來源與真正的 reader／normalizer 路徑測試，校方公開模板的 URL／欄位依據見 [2026-11-18 來源查核](tronclass-public-contract-2026-11-16.md#2026-11-18本人繳交紀錄的一般附件下載)。真人附件下載仍須驗收。

### 綁定後同步與待辦操作

獨立登入會保存 `/api/profile` 回應合併後的最新 Cookie，避免 session／XSRF 輪替後仍保存舊登入憑證。首頁對只有 Firebase 身分的使用者提供 `/tronclass` 入口，E 校園舊資料擷取仍維持暫停。

同步現在以同一個 50 秒總期限涵蓋 binding、課程、作業分頁、教材及公告；`request.signal` 及剩餘預算一路傳入 direct／relay 底層讀取。客戶端取消、登入失效、權限撤回或換綁會取消其他在途工作，不把取消視為部分成功。即使注入來源忽略取消，晚到的回應也不會啟動下一頁請求。

Web／Mobile 均提供全部、待繳交、狀態待確認、已繳交四種篩選，數量依目前課程與搜尋縮小；待處理項目按期限排序。未知狀態維持獨立。上傳、送出或查證途中不能切換作業；收到可信 `submitted`／`confirmed` 結果後更新清單，同時使較早啟動的同步失效。之後使用者主動同步仍可接受校方最新狀態，不永久固定本機成功標記。

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

`prepare.rules` 為 `{ status: "unknown" }` 或 `{ status: "confirmed", allowsText, allowsAttachments, maxTotalBytes }`；附件數量、單檔上限與 MIME 仍由既有 `maxFiles`、`maxFileBytes`、`allowedContentTypes` 提供。來源 `permissionKnown` 未確認時，不把本頁 4 檔／10 MiB／20 MiB 整理額度當成校方授權。已確認的零值保持為零，不回退成預設額度；較舊的回應若沒有 `rules`，仍能整理與預覽，但不能據此送出。新增的 `prepare.details` 是另一份已去除私有原始欄位的觀察資料，不能取代 `rules`；Client 會核對完整欄位、型別與次數計算一致性，拒絕多出的來源欄位。

使用者確認送出後，UI 先重新取得完整規則，再一次核對文字、所有附件、檔名、空檔、個別大小、合計大小及 MIME。任何一項不合格，都在第一個 upload 前停止並保留草稿。重新讀取失敗會移除舊的送出資格，不讓先前的 `canSubmit` 繼續生效。後端原有規則檢查仍保留。

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

### 2026-11-18：公開查證、原生 Mobile 與實際資料庫驗證

`getDefaultTronClassSubmissionService()` 現在回傳 `tronClassPublicSubmissionService.ts`：公開 prepare／upload／submit 均使用 v2 adapter，僅保留舊 service 的唯讀 prepare 與 v1 reconcile，不再讓新的公開寫入建立 v1 ledger。這層可獨立完成的程式接線不列為校方外部 blocker。production factory 明確傳入 `contractVerified: false`，沒有注入 tenant authorization／storage policy，也沒有新增能以環境變數解鎖的設定；實際學校送交仍關閉。

公開 prepare 重用本人詳情與歷史，只有明確受控的 server authorization、CSRF、完整空歷史、一般期間、個人首次作業及兩個 server gates 都通過，才投影最新規則與 `canSubmit`。公開 upload 必須完成 metadata／binary／callback 且 journal 已持久化，才回傳不透明 fileId、名稱、MIME、大小與 hash；不公開校方 uploadId、owner、studentId、cookie 或儲存 URL。submit 將已確認的 attachments 映射為本次 v2 manifest，使用單次 final claim／POST；新 confirmation 不硬塞進需要 `submittedAt` 的舊收據型別。HTTP request 的 abort signal 會傳至 upload／submit。

送出回應遺失或 acknowledgment 儲存失敗時，原 attempt 與鎖保留；可確認存在原 claim 的暫時錯誤只回 `unknown`，不重送。若後續權限改變，仍會用原 manifest 與同一本文轉換規則核對 digest；更改本文、附件清單或 fileId 不會被誤認為原操作，會回 conflict。這些公開路由整合測試使用真正的 handler／adapter／journal 程式、原子記憶體 DB 與合成校方 fetch，不是校方真人或外部網路驗收；真正 Firestore 交易另有 emulator 測試。

`reconcile` 按持久化版本分流。v1 沿用既有正式收據與時間檢查；v2 只讀取受控 journal 保存的原 attempt 與 acknowledgment，再使用目前綁定重新讀取本人校方歷史。未知版本一律拒絕，不能以 v1 parser 處理 v2 記錄。這條路徑沒有附件上傳或作業寫入依賴，也不會釋放作業鎖、重寫原 revision 或把紀錄改成可重送。校方既有課程查詢使用唯讀用途的 `/api/my-courses` POST，不能把 HTTP 方法本身當作作業寫入證據。

新增 `tronClassRawSubmissionHistory.ts` 在讀取前後核對當下綁定、課程完整清單、作業活動與個人繳交模式，並驗證歷史的完整性、重複 ID 與本人範圍。401／403／隱藏／404／410 不能退回舊內容；外層 15 秒期限的 abort signal 會一路傳入 scraper 的 HTTPS／relay、內部課程分頁與 fallback，每頁亦有 deadline guard，逾時會取消進行中的來源請求且不再啟動下一頁。作業分頁另有預設傳輸時間與回應大小上限。原始 HTML 與附件 ID 只用於伺服器內部精確比對，不回傳給公開介面。

有可信 acknowledgment 且精確讀回成功時，公開回應新增獨立的 `status: confirmed`、`receipt: null`、`confirmation.kind: acknowledged-readback`。確認包含本次 operation、校方版本 ID、課程／作業與 `confirmedAt`；可空的 `sourceRecordedAt` 仍只是校方建立紀錄時間。它沒有虛構 `submittedAt`，也不改變舊收據格式。Web 與 Mobile 都核對 operation 及作業範圍後才清除本地 pending；錯誤範圍、暫時讀取失敗、沒有 acknowledgment 或仍在 preparing 的 v2 操作保留待查證。準備中的另一個 actor 仍可能取得 final claim，因此唯讀查證不能聲稱「確定不會送出」。

原生 Mobile 使用平台 session context；只有沒有平台 session 且 Firebase 登入仍有效時，才使用目前 Firebase token。平台 session handle 留在既有 controller，校方 Cookie 不傳到手機。換 nuni 帳號、換校方 studentKey、解除連接或晚回的舊要求都不能沿用權限或確認。選課會發起帶 courseId 的讀取，取得該課完整作業、公告與教材，並丟棄較早選課的晚回覆。

Mobile 文字草稿留在目前畫面記憶體；附件使用 DocumentPicker 的 cache copy 支援 iCloud／Android 文件來源，再移至本畫面的隨機暫存目錄。預覽固定當時 bytes 與 SHA-256，確認後上傳相同內容。移除、丟棄、換人、解除連接、確認成功與離頁會清理副本；不刪使用者原檔。只能恢復同一已驗證學生的本頁草稿，重連後重新讀取權限與預覽。AsyncStorage 僅保存 owner／作業範圍對應的不透明操作 ID，不保存密碼、草稿文字、附件 URI、上傳狀態或校方 Cookie。教材下載使用固定 BFF、大小與 header 檢查，在原生分享完成後清除暫存。JavaScript export／單元測試不等同於 iOS／Android 真人選檔與校方繳交驗收。

Firestore journal 已用真正的 Java 21／Firestore Emulator 1.22.0／Admin SDK 測試，不再只依賴模擬交易：兩個獨立 client 的檔案／final claim 競爭、跨 owner 同學生共用鎖、同學生重連只讀、換學生拒絕、實際關帳 hook 與晚回 transfer／acknowledgment 都在驗證範圍內。後述 Spark retention 也有真 emulator 的 query／transaction 競態測試。這些使用合成校方資料，沒有真人作業 POST。

另外整合 PR #586 的既有課務 reader 修正：補讀 courseware、隱藏／未發布／跨課資料過濾，以及不完整結果的 60 秒重試。交叉審查再修正損壞 error cache 阻斷手動 refresh 的問題，並加入 projection version；舊快取已遺失隱藏旗標，必須整體重新讀取，不能在升級後繼續回傳舊投影。

### 2026-11-17：受控附件與版本確認

下段保留 11/17 的設計與當日測試紀錄；11/18 的公開 v2 全流程及真實資料庫驗證更新見上節。新增 `tronClassAttachmentCandidate.ts`、`tronClassFinalSubmissionCandidate.ts`、`tronClassSubmissionReadback.ts` 三個協定模組，並以 `tronClassControlledSubmission.ts` 與 `tronClassControlledJournal.ts` 完成服務及 Firestore 交易接線。執行候選與工廠預設停用，`contractVerified` 固定為 `false`，不會由環境變數自行成為正式 provider。公開 route／Agent 寫入限制不變。

**附件傳輸。** 先以 server-only 授權讀取器確認本人作業與限制，再要求原子且持久化的檔案 claim，才建立 metadata。S3／WRPC 分支以原始 bytes PUT，成功後呼叫官方 callback；MEDIA 分支以包含 `file` 的 multipart PUT。multipart 先產生完整 bytes 及相同 boundary 的 Content-Type，避免既有底層把 FormData 轉成字串或遺失 boundary。QINIU、CHINAMCLOUD、未知模式與尚未驗證的 S3 分支拒絕。

Metadata 的 `upload_url` 只能提供待查核的目的地，不能自行授權網路請求。呼叫方必須注入受控、獨立設定的精確 URL／upload ID／傳輸模式 policy；沒有預設可信 storage host，不以「與學校同來源」放行任意 API 路徑。Storage PUT 不帶校方 Cookie、CSRF、平台 Authorization、Origin 或 Referer；不跟 redirect、不重試。MEDIA 目的地若仍要求校方 Cookie，此候選目前不支援，必須先確認精確目的地接受無憑證 PUT 才能由 policy 放行。每個階段有時間／回應大小上限與綁定、開關、期限檢查。參數與 bytes 會先複製，避免等待期間變動。

Binary／callback 的 HTTP 成功僅回傳 `state: transferred`、`confirmation: awaiting-confirmation` 與檔案識別資料；不回傳私有 URL、cookie、教師資料或收據。該結果也不保證遠端 bytes 已經下載核對。候選要求呼叫端用 owner／operation／file 的穩定槽持久化 claim；換 bytes、revision 或程序不能自動重建同一檔案。

**最後送出。** Final candidate 只接受本次選取的 file IDs，由 server-only journal 取得已完成傳輸的 handle，重新核對 owner、校方學生、作業、revision、operation、檔名、大小與 SHA-256 欄位。完整附件集合符合最新限制才可繼續；缺少任一附件時，不送出部分版本。它要求跨 owner／程序的校方學生與作業原子 claim，保存本次本文、附件 manifest、完整空 baseline 與內容摘要後才 POST。

Claim 完成後會再次讀取校方授權與歷史。若使用者已在另一個校方分頁繳交、老師變更限制／期限、或綁定身分改變，就停止正式 POST。這個最小候選只處理個人、normal、一般繳交期間、完整空歷史、零次數的首次送出；沒有推論小組、重交、補交或草稿更新權限。最後的校方競態仍須由伺服器自身權限檢查拒絕。

**讀回確認。** Final HTTP 200／201 先解析本人新版本 acknowledgment，將 ID 保存後，再讀取該學生的官方 `submission_list`。只有以下條件全部成立才回傳 `verified-new-version`：

- 完整事前版本仍保留，清單只多出這次 acknowledgment 的一個 ID，且該 ID 是唯一最新版。
- 同一學生、課程與作業；明確不是草稿、退回或教師標記。
- 原始 canonical HTML 本文逐字相同；附件數字 ID、檔名、大小完整相符，沒有額外資源或簡報。
- 查核前後綁定仍相同；晚到的舊身分資料不能成為確認結果。

`sourceRecordedAt` 只表示校方 `created_at`，缺少或無法解析時保留 null。`confirmedAt` 是本系統完成讀回核對的時間；兩者都不冒稱正式 `submittedAt`。這個結果目前沒有轉成既有公開 `TronClassSubmissionReceipt`，不能直接用校方建立時間填入該舊收據介面。

**查證與防重送。** 有保存 acknowledgment 而讀回失敗時，可用新 candidate instance 的 `reconcile(ownerKey, operationId)` 查原版本。關閉寫入後仍可查證，同一校方本人重新綁定後也可恢復；此方法不呼叫 POST。Claim 的本文與 manifest 會重新比對摘要，避免查證過程換內容。若正式 POST 的整個回應遺失，沒有可信 acknowledgment ID，仍維持 `awaiting-confirmation`；不能靠看到同內容就認定是本次操作，也不會再送一次。

**持久化接線。** `createTronClassControlledSubmission()` 已直接使用 Firestore transaction journal，將附件結果保存後才交給 final。Operation 與舊服務使用相同 owner／operation hash，採明示 version 2 與 candidate 標記；遇到舊 version 1 會拒絕覆寫。校方學生／作業鎖與舊服務共用相同 hash，跨 nuni owner 也只能取得一次。本輪遇到任何既有鎖均拒絕，包含舊 `not-sent`；不自行清除或轉換舊鎖。

每個交易先讀取 `_tronClassBindings` 的關帳／解除／換綁 barrier，核對當下本人、revision 與期限，再讀寫 operation 及鎖。附件有固定 file slot、完整 manifest 與總量限制；保存 acknowledgment 前會重新核對原 attempt 和鎖，不把 acknowledged 標成已完成讀回。所有 v2 記錄與鎖使用 `purgeAt: null`，避免 TTL 讓原操作再次送出。新增的私有資料仍由 ownerKey 清理流程覆蓋；11/18 已加入平台關帳 outbox worker，部署條件見下節。

**驗證與剩餘接線。** `tronClassControlledFlow.test.ts` 直接使用實際工廠與 journal，配合支援原子提交、rollback、先讀後寫的交易測試資料庫，完成文字與兩個 PDF／ZIP MIME 附件的 8 條整合流程：正常順序、三階段失敗、第二檔失敗、少檔後唯讀恢復、跨 instance 防重送及關帳競態。每次操作都可重建工廠，仍讀回資料庫中的原 claim／manifest／acknowledgment。沒有手造已上傳 token，也沒有真人作業送交。

Node **22.23.5** 的整合回歸：37 個測試檔通過、1 個環境相關檔略過；**1,260 項通過、3 項略過、0 失敗**。修改範圍的 12 個 TypeScript 模組／測試連同 imports 依原 Web strict 設定通過型別檢查。完整 Web TypeScript 在本地兩次以 exit 137 結束、沒有診斷輸出，不能列為本地通過，另依 GitHub CI 查核。測試資料庫不是 Firestore emulator；正式 Firestore 與校方 session／CSRF、可信 storage policy、來源權限 reader、正式 adapter／收據介面及本人與教師端收件仍須驗收。

### 既有站內服務的送出狀態

1. 讀取本人課程與作業，確認來源已提供明確規則。
2. 使用者檢視預覽，勾選確認，送出前重新讀取條件。
3. 先以最新條件核對全部文字與附件，全部合格才逐檔上傳並驗證完整集合；任何一檔失敗就不進入最終送出。
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

### 受控候選實作的範圍

`tronClassSubmissionProtocol.ts` 已根據官方公開 client 實作新作業 POST 的固定 body、一般檔案 metadata body、S3／WRPC callback body，以及保守的 acknowledgment／metadata parser。純文字先做 HTML escape 再保留換行；一般附件使用數字 ID，不把 `operationId` 或猜測的 upload key 放入校方 body。Metadata 的 `parent_id: 0` 代表個人資源根目錄，不是課程或活動 ID。

Metadata parser 只回傳 `metadata-created` 和數字 ID，二進位能力固定為 `unsupported`；不使用或回傳任意 `upload_url`。Acknowledgment parser 要求明確的本人、課程、活動、新 ID 與非草稿／非教師代標等欄位；缺少任何必要證據保持 `unconfirmed`。這是保守候選 schema，尚無真人 POST 回應證明所有必填欄位一定存在。結果不含本文、教師資料、時間或 `receipt`，尤其不將 `created_at` 改成 `submittedAt`。

`createTronClassTextSubmissionCandidate()` 是供受控環境驗證的獨立候選，不是 production `TronClassSubmissionSource`。其限制為：

- `enabled` 預設 false，`contractVerified` 固定 false；沒有公開 HTTP 入口，也沒有環境變數可把它接入既有正式送出流程。
- 只接受 normal、個人、一般窗口、首次、純文字；呼叫端必須提供從校方資料取得的權限確認、完整空歷史、零送出次數及前置活動已符合的證明。候選不以 raw activity 缺少欄位推論放行。
- 使用固定靜宜 origin 與 `/api/course/activities/{id}/submissions` POST，拒絕任意路徑、query、附件 ID、二進位或其他作業模式。XSRF cookie 缺少或格式不符時停止；目前只實作公開 Angular 預設策略，仍需實測校方要求。
- 送出前後重新檢查 binding revision；預設 15 秒、最多 1 MiB 回應、無 redirect／fallback／retry。單一 candidate 實例只允許一次外部嘗試，競態或逾時不會再送。
- 上述單一實例保護不能代替既有持久化 operation／作業鎖。接入正式 provider 前，仍須完成真實權限 reader、CSRF／session 契約、持久化 claim 與本人／教師 readback 驗收。

目前測試全部注入記憶體 HTTP 回應與合成身分；本次沒有執行候選的真實校方 POST，也沒有開放附件傳輸或把 acknowledgment 當成成功收據。

### 離線契約查核工具

`scripts/tronclass/analyze-har.mjs` 可在本機檢查已獲授權的 HAR，輸出固定靜宜 origin、白名單路徑模板、HTTP method／status、去值化 JSON 型別與 upload → final → 本人 readback 的證據缺口。原始 header、cookie、query、學生代號、檔名、內容及未知欄位名稱都不輸出；輸入、分析深度與輸出均有限制，錯誤也使用固定代碼。

此工具不連網、不重播操作，不會自行開放 adapter。HAR 可被編輯，HTTP 2xx 或完整觀察鏈也不能取代真人校方驗收，報告的 `contractVerified` 永遠是 false。使用方式、輸入限制與缺口說明見 [`scripts/tronclass/README.md`](../../scripts/tronclass/README.md)。原始 HAR 不應提交 Git 或傳入對話。

本輪分析器已升為 `formatVersion: 2`，辨識官方 activity／本人 `submission_list` GET、POST／PUT final、metadata、可精確關聯的同來源 binary PUT 及 callback。舊猜測路徑保留 `legacy_*` 分類，不再作為正式流程證據。它會核對登入脈絡、事前歷史、相同作業與版本、`created_by`、數字 upload IDs、精確本文及唯一最新版；POST 新送出與 PUT 草稿轉正式分開處理，後續退回或讀取失敗不會被先前成功掩蓋。

Binary 證據只採用先前 metadata 中完全相同的同來源 `upload_url`，包含 query 的一致性；這是離線比對，不代表該 URL 已獲准作為線上 PUT 目的地。跨來源儲存服務、QINIU 或外部資源明確列為未支援。空報告、未識別路徑與不足的 chain 仍不能證明 HAR 沒有操作，完整觀察鏈也不會把 `contractVerified` 改成 true。使用範圍見 [分析器說明](../../scripts/tronclass/README.md)。

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

**平台帳號（Google／nuni）關帳接線：**本分支新增 PostgreSQL 的帳號狀態／刪除 trigger，與真實 `platform_accounts` 關帳交易一同寫入 durable outbox。背景 worker 以 lease token 領取並呼叫同一 `closeTronClassOwner()`，成功才刪除事件及其 platform ID；失敗固定錯誤碼、退避重試，程序中斷後可重新領取。worker 只讀明確關帳事件，不掃不存在的帳號猜測關帳，也沒有讓客戶端任意傳 owner 的 HTTP 端點。專用資料庫設定、最小權限、候選 migration 與啟用順序見 [平台關帳部署說明](../../deploy/nuni-api/tronclass-account-closure/README.md)。本輪未套用正式 PostgreSQL migration，因此不能宣稱 production 平台關帳已啟用自動清理。

**到期清理：**`TRONCLASS_RETENTION_ENABLED=true` 會在 Node.js Web 程序啟用背景 worker，每 15 分鐘加 0–60 秒 jitter 執行一次；每輪三個固定集合合計最多掃描 50 筆。同一程序不重疊，跨程序由 Firestore transaction 重讀目前期限及狀態後決定是否刪除。換綁、配額續期或 draft 轉成 unknown 時不會被舊查詢結果刪除。游標與輪換順序避免不應刪除的紀錄堵住其他已到期資料。這個方式保留 Spark 部署相容性，不依賴付費 TTL；仍受實際服務運作與 Firestore 配額影響，不承諾到期瞬間刪除。

程式依以下期限清理，伺服器授權仍即時核對到期時間，不等待背景刪除：

| 文件 | purgeAt |
| --- | --- |
| 已連接校方 session | 12 小時有效期到期 |
| 登入嘗試配額 | 15 分鐘視窗到期 |
| v1 尚未最終送出的 draft operation | 24 小時 |
| v1 已確認成功的 receipt operation | 30 天 |
| unknown / submitting 與所有 v2 operation | null，不自動到期；關帳時清理 |
| closed / disconnected 綁定標記、所有作業鎖 | 不設定 TTL |

Firebase TTL deletion 需要已啟用計費。預設 `firebase.json` 沒有啟用 TTL；[可選 TTL profile](../../deploy/tronclass/README.md) 產生器會保留所有既有索引，另加入三個 `purgeAt` policy，並明確停用作業鎖的 TTL。readiness gate 會核對 exact field 的 `ACTIVE` 狀態、零額外 offset 及鎖 policy 已停用，不能只因一般索引 READY 就通過。本輪未修改 production 計費或套用 TTL policy。正式啟用時需部署 retention worker 設定及平台關帳 migration／worker；若使用可選 TTL，還需先確認該專案已符合計費前提。

## 驗證方式與範圍

使用專案支援的 Node 22，先執行 `node scripts/build-functions-shared.cjs`。Web 測試在 `apps/web` 執行 `vitest run`，包含 binding、auth、reader、route、submission source／service、Agent grants／意圖／工具／下載、client、TronClassWorkspace 與既有 Assistant／NuniApp 回歸；另外驗證 Mobile 五個舊 writer 沒有任何網路送出。HAR 測試使用 `node --test scripts/tronclass/analyze-har.test.mjs`，已加入既有 CI。

### 2026-11-18 本輪工作區與附件下載驗證

本輪已合入 `main` 的 `6b0dbe30` 及前輪公開 v2 service，完成 Web／Mobile 作業待辦、本人歷史附件下載、登入 Cookie 輪替及同步／下載期限取消。以下為這一輪實際執行的本機驗證；最新提交的 GitHub CI 已觸發，結果仍須以該提交的 Actions 為準，不沿用先前 head 的 CI 綠燈。

| 範圍 | 實際結果 |
| --- | --- |
| Web TronClass 整合回歸 | 使用 `maxWorkers: 4`；56 個檔案通過、4 個略過，1,790 項通過、33 項略過、0 失敗 |
| 原生 Mobile／transport／session 回歸 | 8 suites、174 / 174 通過，包含歷史附件分享與作業待辦流程 |
| 底層 scraper 回歸 | 122 / 122 通過 |
| 最後教材下載與底層取消回歸 | 52 / 52 通過；涵蓋下載期限內的 metadata 讀取取消，與上述回歸有重疊，不重複加總 |
| 受影響範圍 ESLint／TypeScript | 通過；既有 lint warnings 保留，未降低規則 |
| 完整 Web Next build | 使用 CI 規定的 public 合成設定、Node 22.23.5 與本機 4 GiB heap，編譯、完整 TypeScript、靜態頁面及產物整理均完成；TypeScript 階段約 65 秒，未略過型別檢查 |

先前一次本機 build 在預設約 2 GiB heap 下於 TypeScript 階段耗盡記憶體；提高該次程序的 heap 上限後完整完成，未因此變更 repository 建置規則。CI 合成 public 設定的 build 不等同正式環境設定驗收；本輪未重新執行原生商店 build、真人裝置或校方登入／收件驗收。33 項 skipped 不計為通過，前輪完整 Web、資料庫與原生 export 結果分開保留於下方。

`main` 的 `6b0dbe30` 已包含 `picomatch` 公告 `GHSA-fc5q-39xc-vjpf` 的既有、具期限風險接受紀錄。本輪隨主線合入該紀錄，沒有另增例外、修改版本號或放寬安全 gate；因此下方前輪「audit 被阻擋」是當時觀察，不能直接當作目前新 head 的檢查結果。新的 CI／security gate 狀態仍須依最新 Actions 核對。

### 2026-11-18 前輪整合證據（截至 `0a4b7db8`）

前輪先合入 `main` 的 `d4bc4cbf`，再接上公開 v2 service。以下保留截至 `0a4b7db8` 的驗證紀錄：完整 Web 測試執行於該輪開發收尾期間；其後變更另跑當時的 TronClass／instrumentation 範圍，兩者有重疊，不能相加，也不代表目前新 head 已重跑全部項目。

| 範圍 | 實際結果 |
| --- | --- |
| 完整 Web Vitest | 770 個檔案通過、16 個略過；16,641 項通過、141 項略過、0 失敗 |
| 前輪最後 TronClass、relay 與 instrumentation 回歸 | 53 個檔案通過、4 個略過；1,574 項通過、33 項略過、0 失敗；包含公開 v2 adapter、default factory 禁寫、HTTP route 整合與底層取消接線後的回歸 |
| 底層 scraper／relay／PU pause 回歸 | 3 suites、152 項通過、0 略過；涵蓋 direct socket 及 relay body 取消、內部分頁／fallback deadline、舊呼叫相容性 |
| 真 Firestore Emulator | controlled journal 8 項與 retention 6 項，合計 14 / 14 通過 |
| 真 PostgreSQL 17.12 | 關帳 outbox、角色權限、lease、rollback 與實際 SQL 逾時，16 / 16 通過 |
| 前輪原生 Mobile／transport／session 測試 | 9 suites、149 / 149 通過 |
| Mobile 受影響導覽回歸 | 4 suites、140 / 140 通過；與上列分開列示，不加總 |
| 完整 Web 與 Mobile TypeScript | Node 22.23.5，均 exit 0 |
| 完整 monorepo ESLint | `pnpm lint` exit 0；既有 warnings 保留，沒有降低規則 |
| 原生 iOS／Android Metro JS export | development 設定下兩平台均 exit 0；不等同原生商店 build 或真人裝置驗收 |
| 正式環境 iOS／Android JS export | 兩平台均在 Expo 設定階段因缺少 `EXPO_PUBLIC_FIREBASE_API_KEY` 停止，尚未進入 Metro；未加入假設定或略過 release gate |
| UI design gate | `--base origin/main` 通過 |

普通 Vitest 未啟動 PostgreSQL／Firestore Emulator 時會略過相應檔案；上表真資料庫結果來自另外實際啟動的隔離 runtime，不把 skipped 計作通過。學校登入回應與作業內容均為合成資料，沒有將其他學生的真實課務資料轉為 fixture，也沒有真人作業送交。

在前輪尚未合入 `main` 的 `6b0dbe30` 時，11/17 更新的 `picomatch` advisory `GHSA-fc5q-39xc-vjpf` 沒有可用已發布修正版，當時的 `workspace-prod`／`workspace-all` audit 都被既有 high gate 阻擋。該輪沒有修改例外名單、改版本號假裝修補，或放寬安全 gate。此處僅保留歷史觀察；本輪合入主線既有風險接受紀錄的狀態與最新驗證見上一節。

### 先前開發回合

前輪（2026-11-16，`ca87994d`）的驗證結果保留如下。這是指定範圍的回歸結果，不代表整個 monorepo 的所有測試均已執行；重跑的子集合不重複累加。最新詳情／草稿恢復的結果另列於下方。

| 範圍 | 結果 |
| --- | --- |
| Web TronClass 回歸 | **30 個測試檔、809 / 809 通過**，包含新規則 UI、protocol 與 candidate |
| 完整 Web TypeScript 檢查 | 通過，exit 0 |
| 本輪修改的 Web TypeScript 檔 ESLint | **12 個檔案，`--max-warnings 0` 通過** |
| nuni UI design gate | `--base origin/main` 通過 |
| 離線 HAR v2 | **32 / 32 通過**，包含交叉審查發現的作者、baseline 範圍、metadata 與同來源 401 邊界 |

本輪新涵蓋零附件額度、文字／附件模式、最新規則變更、全部附件在上傳前核對、prepare 失敗撤銷舊資格；protocol 的數字 ID、純文字處理、metadata 與 acknowledgment 分流；candidate 的預設停用、權限不明停止、deadline 跨過 awaited binding check、固定 POST、有限回應、CSRF 格式、取消／逾時、同時呼叫只送一次，以及綁定變更丟棄晚到結果。protocol 131 項、candidate 45 項與規則 UI 20 項均包含在 Web 809 項之內，不重複累加。

既有本人歷史、Agent 權限、資料可見性、防重與重新連接亦包含在本輪 Web 指定範圍內。前輪 Backend account＋dorm 49 項、scraper 88 項與其他 Mobile 測試未在本輪重新計數；相應實作本輪沒有變更。

測試中的 verified provider、帳號、課程及收據都是合成資料，用於證明權限隔離、防重、失敗與恢復行為。官方公開 JavaScript 的匿名 GET 查核可證明前端使用的路徑與欄位，不能取代真人帳號回應、真實繳交或教師收件驗收。本輪沒有宣告正式部署，也未宣告桌面／窄螢幕／深色模式的瀏覽器視覺驗證通過；UI design gate 是程式檢查，不等同視覺驗收。

## 本輪詳情與草稿恢復驗證（2026-11-16）

本輪本地使用 Node **24.22.1** 與相同鎖檔的依賴，不修改專案 Node **22.23.5** 要求；該指定 runtime 的結果須另讀新提交的 GitHub CI。

| 範圍 | 本輪結果 |
| --- | --- |
| Web 全部非模擬器 TronClass 相關測試及站內連結檢查 | **33 檔、955／955 通過** |
| 納入 main `ab9c8677` 後的整合回歸 | **34 檔、1,025／1,025 通過**；含上述 955 項及主線地圖變更的 70 項 |
| 完整 Web TypeScript | 通過，exit 0 |
| 本輪 TypeScript ESLint | 23 個 Web 檔按 Web config、1 個 shared 檔按其 config，`--max-warnings 0` 通過 |
| nuni UI design gate、git diff 格式檢查 | 通過 |
| 瀏覽器視覺、真人校方登入／繳交 | **未完成驗收** |

955 項已包含草稿重連／換帳號、來源設定、client 邊界、原 Assistant、繳交防重與來源失效情境，各子集合不重複累加。main `ab9c867719d8de71660a539c78346f2173a4c0fd` 僅帶入已合併的地圖三檔變更；整合後重新執行上述 34 檔、完整 Web TypeScript 與 UI design gate 均通過。撤權修補先以順序合成回應重現 9 項失敗，再修正為通過；沒有呼叫真實校方 writer。前輪 GitHub Web Tests 的唯一失敗，來自導航掃描將校方 API `path` 誤判為站內路由，本輪改成明確的 `schoolPath`，保留原掃描與固定來源驗證。未修改 workflow、規則或 allowlist。

本輪嘗試瀏覽器畫面驗收，但本機瀏覽器啟動受執行環境限制、連接的瀏覽器不可用，雲端瀏覽器也無法連到本機測試頁；沒有將程式／DOM 檢查宣稱為實際視覺驗收。HAR、Mobile 真機及教師收件本輪未重新驗收。

## 官方依據

- [靜宜大學教學發展中心：TronClass 登入說明](https://tdcenter.pu.edu.tw/p/406-1061-45101,r1105.php?Lang=zh-tw)：校方正式入口與登入帳密說明。
- [TronClass 官方作業說明](https://support.tronclass.com/tw/question/homework/)：上傳檔案與正式繳交是不同步驟；作業規則與版本需要依實際作業確認。
- [2026-11-16 官方公開前端契約查核](tronclass-public-contract-2026-11-16.md)：記錄靜宜官方資源 URL、版本、SHA-256、模組及本人歷史／final／upload 證據，並列出完整 schema、CSRF、真實寫入及工具缺口。

公開說明與前端程式提供部分接口證據，尚不足以構成經過受控校方驗收的完整學生 REST 寫入契約。
