# TronClass 本機受控驗收入口

此入口用來在已指定測試帳號、測試作業與精確測試文字後，執行既有 controlled candidate。它與公開 Web／Mobile writer 分開，**不修改 production `contractVerified: false`，不建立 HTTP 端點，也不提供環境變數繞過**。

目前只支援 PU 一般開放期間、個人、normal、本人完整空歷史、零次繳交的首次純文字版本。實際校方 CSRF、POST acknowledgment 與收件仍待驗收；本工具的合成測試不構成這些證據。附件、校方既有草稿、重交、補交、小組與其他模式全部拒絕。

## 執行環境

使用本 repository 的 Node **22.23.5 以上、未滿 23** 與 frozen lock 安裝的 dependencies。CLI 使用既有 **esbuild 0.28.2** 以 `write: false` 將固定 server-only entry 編譯為記憶體中的 Node bundle，並直接載入該輸出；`server-only` 使用套件既有的 `react-server` condition。沒有 TypeScript require hook、任意 module path 或新 runtime dependency。

真正 preflight／dispatch／reconcile 必須在已具備 Web server 私有設定的受信任操作環境執行：既有 `FIREBASE_SERVICE_ACCOUNT_JSON`、`TRONCLASS_SESSION_SECRET`（未設時沿用 `BFF_SESSION_SECRET`），及必要時既有 PU relay 設定。沿用原本 `campus-one-tw` Admin 與 binding；不初始化其他專案或資料庫，不新增服務帳號，不自動讀取 `.env`。

工具只讀取**已存在的 nuni TronClass 綁定**，不登入、換綁或接受校方密碼／Cookie。作業輸入、計畫與確認資料只接受本機私有 JSON 檔案；不得把原始 HAR、學校憑證或帳密塞入這些檔案。沒有指定測試資料時，只執行 help 與下方合成測試。

```sh
node scripts/tronclass/acceptance.mjs --help
```

`--help` 不編譯 application runtime、不初始化 Admin、不連線校方。

## 私有檔案

所有路徑必須是 repository 外的絕對路徑，不能是 URL、symlink 或含 symlink 的路徑。輸入是目前作業系統使用者擁有的 regular file、不可有 group／other 權限、不可有多個 hard links，最多 128 KiB。建議目錄 `0700`、檔案 `0600`；輸出目錄必須是私人目錄。計畫與執行標記用 `O_EXCL`／`O_NOFOLLOW` 建立為 `0600`，不覆寫原檔。

請使用受信任文字編輯器建立輸入。以下只有合成格式範例，**不是可直接拿去對真人作業送出的資料**：

```json
{
  "version": 1,
  "schoolId": "pu",
  "ownerKey": "firebase:synthetic-acceptance",
  "studentId": 303,
  "courseId": 101,
  "homeworkId": 202,
  "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "operationId": "reviewed_test_operation_0001",
  "content": "已檢視並同意送出的測試文字。"
}
```

`ownerKey` 必須是既有 nuni actor 的 server owner，`studentId` 必須符合已驗證的校方本人，不能從輸入帳號猜測。`revision` 是目前 binding revision。所有欄位都會與 server 當下讀取值核對；其他欄位，包括 `attachments`、`cookies`、`password`、自訂 URL 都拒絕。

為這次受控測試指定**一個** operation ID，長度 16–80，僅英數、`_`、`-`。工具不產生或替換 ID。該 ID、本人、作業與精確內容應先納入人工審查；未知結果不能換一個 ID 再送。

## 1. 唯讀 preflight

在已授權讀取的測試範圍準備完成後，才執行：

```sh
node scripts/tronclass/acceptance.mjs preflight \
  --input /absolute/private/tronclass-check/input.json \
  --plan /absolute/private/tronclass-check/plan.json
```

preflight 會核對 current binding、既有 operation／作業鎖、PU 正面學生角色、本人課程／作業、首次一般個人資格、完整空歷史與寫入 header 的安全序列化。沿用已核對的官方 client 形式：session cookie 必須有效；XSRF cookie 有值時才帶入對應 header，缺少時不虛構 token。通過這個 helper 不代表實際校方已接受 CSRF 或 POST。preflight 不建立 operation／claim，不傳檔案、不送 final，也不改任何校方狀態。既有課程 reader 可能以唯讀用途的 `POST /api/my-courses` 查詢，不能用 HTTP method 本身判斷是否繳交。

成功後產生最長五分鐘的計畫；更早的 session／作業到期會縮短有效期。HMAC 綁定 owner、學生、課程、作業、revision、operation、**原文精確 UTF-8 SHA-256**、canonical wire comment SHA-256、有效期與格式版本。用途與 binding secret 分隔，計畫不含密鑰、Cookie、密碼或原文。標準輸出只列 operation、原文 digest、到期時間與 `contractVerified:false`。

請比對私人計畫的作業與本人、`input.json` 的完整文字、有效期及 digest。重新預檢可產生新計畫檔，但不應更換原 operation ID。若 operation 或作業鎖已存在，工具回 `TRONCLASS_ACCEPTANCE_RECONCILE_ONLY`；不得刪除或重新建立鎖來繼續。

## 2. 明確確認後的一次 dispatch

另外建立 `0600` 的確認檔；operation 與 digest 必須由已審查計畫逐字帶入：

```json
{
  "operationId": "reviewed_test_operation_0001",
  "contentSha256": "填入已審查計畫中的完整64字元SHA256",
  "confirmed": true
}
```

```sh
node scripts/tronclass/acceptance.mjs dispatch \
  --input /absolute/private/tronclass-check/input.json \
  --plan /absolute/private/tronclass-check/plan.json \
  --confirm /absolute/private/tronclass-check/confirm.json
```

CLI 先驗章、檢查計畫與輸入完全相符、確認未過期且本人／revision 仍相同。通過後，透過受信任 callback 原子建立 `plan.json.dispatch` 私有標記，再進入現有 controlled core。該標記是保守的一次執行限制，**不是收件證明**，也不取代 Firestore journal。

Candidate 會 fresh authorize、持久化原子 final claim、再次核對權限後才送一次固定校方 POST；未確認的回應不重試。相同計畫的兩個 CLI 程序只有一個能建立標記；即使使用不同計畫檔，既有 journal 的同學生／課程／作業鎖仍限制真正 final POST。附件的 metadata／storage／callback 均不會被這個工具呼叫。

若驗證後、candidate 開始前後出現失敗，標記保留。即使可能尚未送出，也不能從一次例外、`readAttempt=null` 或 preparing 狀態推論可以重送。只有原 operation 的 reconcile 可以繼續；不得刪標記、複製計畫改路徑、換 ID 或清鎖來重試。

## 3. 原 operation 的唯讀 reconcile

```sh
node scripts/tronclass/acceptance.mjs reconcile \
  --plan /absolute/private/tronclass-check/plan.json
```

查證仍驗證計畫 HMAC 與原 journal scope，但不要求計畫仍在五分鐘內，也不再執行寫入 authorization。查證須沿用計畫的來源綁定版本。即使是同一學生重新綁定，版本不符也會在解封 session 或向校方讀取前回傳 `TRONCLASS_BINDING_CHANGED`，並保留原 attempt 與鎖。沒有 acknowledgment、讀回失敗或資料不符時，保留 `unknown` 及原鎖。

輸出應按 `status` 解讀：

| 結果 | 意義與後續 |
| --- | --- |
| `prepared` | 只完成可審查預檢，尚未送出。 |
| `confirmed` | 真正 candidate 捕捉 acknowledgment，且相同 ID 的本人版本精確讀回。`confirmedAt` 是核對時間，`sourceRecordedAt` 是來源建立紀錄時間；沒有虛構 `submittedAt`。仍須人工核對測試目的與教師收件，不自動宣告整個 tenant writer 已驗證。 |
| `unknown` | 原 operation 尚不能確定；唯一後續是 reconcile。沒有 acknowledgment 時不靠同文字猜一筆版本，也不重送。 |
| 固定錯誤碼 | 本次命令失敗；錯誤不含私人路徑、原始 response、憑證或作業內容。先保留計畫及標記再調查。 |

命令 exit 0 表示已輸出可解析結果，可能仍為 `unknown`，不能把 exit code 當成校方收件。失敗不會自動清理校方 operation、作業鎖或本機一次執行標記。

## 合成驗證，不連校方

```sh
pnpm --filter web exec vitest run src/lib/server/tronClassAcceptance.test.ts
node --test scripts/tronclass/acceptance.test.mjs
```

Core 測試使用真正 controlled candidate／journal／acknowledgment parser／readback mapper，搭配原子記憶體 Firestore 與合成來源。CLI smoke 真正使用 esbuild 載入 server module，再以私人檔案執行 preflight → dispatch → 重複 dispatch → reconcile；全域 HTTP／HTTPS／fetch 均拒絕外部網路，僅明確注入合成 provider。這些檢查不初始化真人 Admin、登入或提交真人作業。

新增此入口不代表已完成真人 preflight、CSRF、正式 POST、附件 storage／callback、nuni UI 端對端或教師收件驗收。完成一個受控案例也不會改動公開 production factory 的 gate。
