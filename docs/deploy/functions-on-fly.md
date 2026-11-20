# Cloud Functions 改跑在 Fly.io（`nuni-functions`）

Firebase 專案 `campus-one-tw` 停在免費 Spark，不能佈署 Cloud Functions。Firestore 與 Auth 繼續留在該專案；這份 HTTP 服務把既有 `backend/functions` callable / `onRequest` / Firestore 觸發器接到 Fly。

**本文件只寫步驟，不代表已經建立 Fly app 或已經上線。不要在未核准時執行 `fly launch` / `fly deploy`。**

## 服務位置

- 程式：`backend/functions` 的既有 handler（不改業務邏輯）
- HTTP 入口：`deploy/functions-server/server.js`
- 映像：`deploy/functions-server/Dockerfile`
- Fly 設定：`deploy/functions-server/fly.toml`（app `nuni-functions`，region `nrt`）
- 健康檢查：`GET /healthz`
- Callable 協定：`POST /{functionName}`，body `{ "data": ... }`，成功 `{ "result": ... }`，失敗 `{ "error": { "status", "message", "details?" } }`
- 驗證：`Authorization: Bearer <Firebase ID token>`（`firebase-admin` `verifyIdToken`），`request.auth` / 第二參數 `context.auth` 與 v2 callable 相同
- Firestore 觸發器：Admin SDK `onSnapshot`（見下方）

App Check：**目前沒有 enforce**（既有 `onCall` 都沒設 `enforceAppCheck`）。不要設 `ENFORCE_APP_CHECK=true`。

線上點餐維持關閉：不要設 `ONLINE_ORDERING_ENABLED`（沒設就是關）。

## 必要 secrets（名稱）

| Secret | 用途 |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | `campus-one-tw` 服務帳戶 JSON 全文。Admin SDK 連 Firestore / Auth，並發 custom token |

服務帳戶必須能 `createCustomToken`（靜宜學號登入 `signInPuStudentId` 會用）。在 GCP IAM 幫這個服務帳戶加上 **Service Account Token Creator**（對自己），Firebase 角色用 **Firebase Admin SDK Administrator Service Agent** 即可。

**金鑰不要放進 repo、不要複製到專案目錄。** `.gitignore` 已忽略 `serviceAccount*.json`、`*-service-account*.json`、`*.pem`、`*.key`、`.env*`。用 repo 外的檔案或環境變數寫入 Fly secret：

```bash
# JSON 放在 repo 外面（絕對路徑），不要出現在專案目錄
fly secrets set -a nuni-functions \
  FIREBASE_SERVICE_ACCOUNT_JSON="$(cat /path/outside/repo/campus-one-tw.json)"

# 或 stdin（同樣指向 repo 外）
fly secrets set -a nuni-functions FIREBASE_SERVICE_ACCOUNT_JSON < /path/outside/repo/campus-one-tw.json

# 或已在環境變數裡
fly secrets set -a nuni-functions \
  FIREBASE_SERVICE_ACCOUNT_JSON="$FIREBASE_SERVICE_ACCOUNT_JSON"
```

可選（缺了對應功能會降級或失敗，不會讓行程起不來）：

| Secret | 用途 |
| --- | --- |
| `SSO_CONFIG_ENCRYPTION_KEY` | SSO 設定加解密 |
| `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` | 校車即時到站；沒設就走靜態快取 |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | 校園助理模型 |
| `EXPO_ACCESS_TOKEN` | Expo push receipt |
| `CRON_SECRET` | `POST /internal/cron/{name}` 的 Bearer / `X-Cron-Secret` |

`fly.toml` 已寫入（非 secret）：`APP_ENV=production`、`ALLOWED_WEB_ORIGINS=https://nuni.tw,https://www.nuni.tw`、`ENABLE_IN_PROCESS_SCHEDULES=true`、`ENABLE_FIRESTORE_TRIGGERS=true`。

## 哪些跑在 Fly

**Callable（`POST /{name}`，body `{data}`）**都會上：包含 `joinLiveSession` / `startLiveSession` / `endLiveSession`、`appealTeacherStatus` / `listTeacherAppeals` / `createTimetableShare`、`askCampusAssistant` / `executeAgentWrite`、`createOrder` / `updateOrderStatus` / `cancelOrder`、`finalizePostLogin`、`createGroup` / `joinGroupByCode`、`getMyAcademicRecords`、`getBusArrivals`、報修／活動／錢包等 `index.js` 匯出的 `onCall`。

**HTTP `onRequest`** 同樣掛在 `/{name}`：`signInPuStudentId`、`signInUniversalDevAccount`、`startSSOAuth`、`verifySSOCallback`、`getSSOConfig`、`calendarSubscribe`、`puFetchCampusData`、`puFetchTronClassData` 等。

**排程（in-process interval + 可選 cron endpoint）**

| 匯出 | 原排程 | Fly 替代 |
| --- | --- | --- |
| `assignmentDueReminder` | 每小時 | in-process interval |
| `busArrivalReminder` | 每分鐘 | in-process interval |
| `scheduledPushReceiptSweep` | 每 5 分鐘 | in-process interval |
| `scheduledOrderTimeoutSweep` | 每 5 分鐘 | in-process；點餐關閉時幾乎無單 |
| `scheduledFlashDealExpiry` | 每 10 分鐘 | in-process |
| `dailyQueueReset` | 每天 00:05 Taipei | cron matcher |
| `generateDailyBrief` | 每天 07:30 Taipei | cron matcher |
| `generateWeeklyReport` | 週日 22:00 Taipei | cron matcher |

機器必須常駐（`auto_stop_machines = false`、`min_machines_running = 1`）。也可以另外用 Fly scheduled machine 打 `POST /internal/cron/{name}`（要 `CRON_SECRET`）。

**Firestore 觸發器（Admin SDK `onSnapshot`，重用既有 handler 的 before/after 事件）**

Spark 沒有 Cloud Functions 事件來源，所以 Fly 行程對相關 collection 開 listener，組出與 v2 `onDocumentWritten` / `onDocumentCreated` 相同的 `{ params, data }` 再呼叫既有邏輯。

單機：`fly scale count 1`，`min_machines_running = 1`。另外用 Firestore 文件 `_flyRuntime/firestoreTriggerLease` 當租約鎖；第二台拿不到鎖就不會開 listener，避免雙重處理。

冪等：listener 重啟會重放目前 snapshot。權限同步用文件 `updateTime` 對照 `_flyRuntime/firestoreTriggerLease/processed/{id}`；版本沒變就跳過，有變才再同步（claims／目錄會跟上）。通知類（成績 push、群組提問助理）第一次啟動只記標記當水位；之後重啟會把停機期間寫入、還沒標記的變更補跑，已處理過的不會重送。`SIGTERM`／`SIGINT` 會先放掉租約，下一台不必空等 45 秒。

| 匯出 | 文件 | Fly 上做什麼 |
| --- | --- | --- |
| `onUserProfileChanged` | `users/{uid}` | 同步 Auth custom claims（`role` / `schoolId` / `roles`）與各校 directory |
| `onSchoolMembershipChanged` | `schools/{schoolId}/members/{uid}` | 依 membership 寫入或刪除 `schools/{schoolId}/directory/{uid}` |
| `onCafeteriaOperatorChanged` | `schools/{schoolId}/cafeterias/{cafeteriaId}/operators/{uid}` | 重算 `activeOperatorCount` 寫回食堂文件 |
| `groupQuestionAssistantReply` | `groups/{groupId}/posts/{postId}` | 提問建立後由伺服器寫助理回覆（停機期間的提問重啟後補跑，已處理不重送） |
| `gradePublishedNotification` | `schools/{schoolId}/grades/{gradeId}` | 成績公布 push（停機期間的成績重啟後補跑，已處理不重送） |
| `onInspectionWritten` | `schools/{schoolId}/inspections/{inspectionId}` | 稽查分數連動停權；handler 本身依 inspection version 冪等，重啟會補跑未處理版本 |

權限同步（profile / membership / operator → claims 或衍生文件）優先於通知。

## 建立與佈署（尚未執行）

在 repo 根目錄：

```bash
# 1. 只做一次：建立 app（不要用互動式隨便改 region）
fly apps create nuni-functions --org <your-org>

# 2. 寫入服務帳戶（JSON 在 repo 外，見上方 secrets）
fly secrets set -a nuni-functions \
  FIREBASE_SERVICE_ACCOUNT_JSON="$(cat /path/outside/repo/campus-one-tw.json)"

# 視需要再設
# fly secrets set -a nuni-functions SSO_CONFIG_ENCRYPTION_KEY=... GROQ_API_KEY=... GEMINI_API_KEY=... CRON_SECRET=...

# 3. 維持單機後佈署
fly scale count 1 -a nuni-functions
fly deploy -a nuni-functions -c deploy/functions-server/fly.toml \
  -d . -f deploy/functions-server/Dockerfile
```

本機映像（可選，不上線）：

```bash
docker build -f deploy/functions-server/Dockerfile -t nuni-functions:local .
```

## Web / mobile 指到 Fly

未設底下變數時，行為與現在相同（打 `asia-east1-{project}.cloudfunctions.net`）。**模擬器開啟時優先於這些覆寫**，仍打本機 emulator。

Web 是 Next `NEXT_PUBLIC_*`，**建置時**就要帶進去：

```bash
# apps/web 建置或 deploy/web Dockerfile
NEXT_PUBLIC_FUNCTIONS_BASE_URL=https://nuni-functions.fly.dev
```

`deploy/web/Dockerfile` 可加 build-arg `NEXT_PUBLIC_FUNCTIONS_BASE_URL`。CSP 已放行 `https://*.fly.dev`。

Mobile：

```bash
EXPO_PUBLIC_FUNCTIONS_BASE_URL=https://nuni-functions.fly.dev
```

仍可用既有的 `EXPO_PUBLIC_CLOUD_FUNCTION_BASE_URL`；`FUNCTIONS_BASE_URL` 優先。`EXPO_PUBLIC_USE_FIREBASE_EMULATOR` 或 `EXPO_PUBLIC_USE_CLOUD_FUNCTION_EMULATOR` 為 true 時改打 emulator。

SDK 走 `getFunctions(app, customDomain)`，既有 `httpsCallable(getFunctionsInstance(), name)` 會變成 `POST {base}/{name}`。

## 驗證

```bash
curl -fsS https://nuni-functions.fly.dev/healthz
# {"ok":true}

# callable（需真實 ID token）
curl -sS -X POST https://nuni-functions.fly.dev/getUserProfile \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  -H 'Origin: https://nuni.tw' \
  -d '{"data":{}}'

# 學號登入（onRequest，不是 {data} 包一層）
curl -sS -X POST https://nuni-functions.fly.dev/signInPuStudentId \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://nuni.tw' \
  -d '{"studentId":"...","password":"..."}'
```

未知函式應為 HTTP 404、`error.status = NOT_FOUND`。沒帶 token 的需登入 callable 應為 `UNAUTHENTICATED`。沒有 `Origin` 的請求不應得到 `Access-Control-Allow-Origin: *`。

## 回退

1. Web / mobile **拿掉** `NEXT_PUBLIC_FUNCTIONS_BASE_URL` / `EXPO_PUBLIC_FUNCTIONS_BASE_URL`，重新建置。客戶端會回到 Firebase Cloud Functions URL（Spark 上本來就打不通，等於停用 callable）。
2. Fly：`fly apps destroy nuni-functions` 或把機器 scale 到 0。不要改 Firestore／Auth。
3. 不要對 `campus-one-tw` 跑 `firebase deploy --only functions`。CI 手動 job 只佈署 Firestore 規則／索引與 Storage；Functions 走 Fly（見 `.github/workflows/ci.yml`）。
