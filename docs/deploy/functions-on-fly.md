# Cloud Functions 改跑在 Fly.io（`nuni-functions`）

Firebase 專案 `campus-one-tw` 停在免費 Spark，不能佈署 Cloud Functions。Firestore 與 Auth 繼續留在該專案；這份 HTTP 服務把既有 `backend/functions` callable / `onRequest` 接到 Fly。

**本文件只寫步驟，不代表已經建立 Fly app 或已經上線。不要在未核准時執行 `fly launch` / `fly deploy`。**

## 服務位置

- 程式：`backend/functions` 的既有 handler（不改業務邏輯）
- HTTP 入口：`deploy/functions-server/server.js`
- 映像：`deploy/functions-server/Dockerfile`
- Fly 設定：`deploy/functions-server/fly.toml`（app `nuni-functions`，region `nrt`）
- 健康檢查：`GET /healthz`
- Callable 協定：`POST /{functionName}`，body `{ "data": ... }`，成功 `{ "result": ... }`，失敗 `{ "error": { "status", "message", "details?" } }`
- 驗證：`Authorization: Bearer <Firebase ID token>`（`firebase-admin` `verifyIdToken`），`request.auth` / 第二參數 `context.auth` 與 v2 callable 相同

App Check：**目前沒有 enforce**（既有 `onCall` 都沒設 `enforceAppCheck`）。不要設 `ENFORCE_APP_CHECK=true`。

線上點餐維持關閉：不要設 `ONLINE_ORDERING_ENABLED`（沒設就是關）。

## 必要 secrets（名稱）

| Secret | 用途 |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | `campus-one-tw` 服務帳戶 JSON 全文。Admin SDK 連 Firestore / Auth，並發 custom token |

服務帳戶必須能 `createCustomToken`（靜宜學號登入 `signInPuStudentId` 會用）。在 GCP IAM 幫這個服務帳戶加上 **Service Account Token Creator**（對自己），Firebase 角色用 **Firebase Admin SDK Administrator Service Agent** 即可。

可選（缺了對應功能會降級或失敗，不會讓行程起不來）：

| Secret | 用途 |
| --- | --- |
| `SSO_CONFIG_ENCRYPTION_KEY` | SSO 設定加解密 |
| `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` | 校車即時到站；沒設就走靜態快取 |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | 校園助理模型 |
| `EXPO_ACCESS_TOKEN` | Expo push receipt |
| `CRON_SECRET` | `POST /internal/cron/{name}` 的 Bearer / `X-Cron-Secret` |

`fly.toml` 已寫入（非 secret）：`APP_ENV=production`、`ALLOWED_WEB_ORIGINS=https://nuni.tw,https://www.nuni.tw`、`ENABLE_IN_PROCESS_SCHEDULES=true`。

## 哪些跑在 Fly、哪些不支援

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

**Firestore trigger：不支援**（Spark 沒有 Functions，Fly 也沒有同等事件來源）

- `onUserProfileChanged`（`users/{uid}`）
- `onSchoolMembershipChanged`
- `onCafeteriaOperatorChanged`
- `groupQuestionAssistantReply`
- `gradePublishedNotification`
- `onInspectionWritten`

claims／目錄同步主要仍靠 `finalizePostLogin` 等 callable。群組提問助理自動回覆、成績發布 push、稽核連動停權在 Fly 上不會被文件寫入觸發。

## 建立與佈署（尚未執行）

在 repo 根目錄：

```bash
# 1. 只做一次：建立 app（不要用互動式隨便改 region）
fly apps create nuni-functions --org <your-org>

# 2. 寫入服務帳戶（JSON 一行，不要進 git）
fly secrets set -a nuni-functions \
  FIREBASE_SERVICE_ACCOUNT_JSON="$(cat serviceAccount-campus-one-tw.json)"

# 視需要再設
# fly secrets set -a nuni-functions SSO_CONFIG_ENCRYPTION_KEY=... GROQ_API_KEY=... GEMINI_API_KEY=... CRON_SECRET=...

# 3. 佈署
fly deploy -a nuni-functions -c deploy/functions-server/fly.toml \
  -d . -f deploy/functions-server/Dockerfile
```

本機映像（可選，不上線）：

```bash
docker build -f deploy/functions-server/Dockerfile -t nuni-functions:local .
```

## Web / mobile 指到 Fly

未設底下變數時，行為與現在相同（打 `asia-east1-{project}.cloudfunctions.net`，模擬器測試不受影響）。

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

仍可用既有的 `EXPO_PUBLIC_CLOUD_FUNCTION_BASE_URL`；`FUNCTIONS_BASE_URL` 優先。

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

未知函式應為 HTTP 404、`error.status = NOT_FOUND`。沒帶 token 的需登入 callable 應為 `UNAUTHENTICATED`。

## 回退

1. Web / mobile **拿掉** `NEXT_PUBLIC_FUNCTIONS_BASE_URL` / `EXPO_PUBLIC_FUNCTIONS_BASE_URL`，重新建置。客戶端會回到 Firebase Cloud Functions URL（Spark 上本來就打不通，等於停用 callable）。
2. Fly：`fly apps destroy nuni-functions` 或把機器 scale 到 0。不要改 Firestore／Auth。
3. 不要對 `campus-one-tw` 跑 `firebase deploy --only functions`（CI 的 `deploy-functions` 仍只在 `workflow_dispatch` 才跑）。
