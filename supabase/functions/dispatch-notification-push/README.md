# dispatch-notification-push

由 **Cron（Scheduled Functions）** 或 **HTTP Webhook** 定期呼叫，將尚未派發推播的通知列批次送出：讀取 `notifications.push_dispatched_at is null`、依 `user_id` 查 `push_tokens`、呼叫 Expo Push API，成功後（或該使用者無任何 token 時）才寫入 `push_dispatched_at`。

## Cron／backoff／DLQ 營運

- **排程頻率**：建議 Dashboard → Scheduled Functions **每 1–5 分鐘** `POST`，Header `Authorization: Bearer <NOTIFICATION_DISPATCH_SECRET>`。
- **重試上限**：環境變數 **`PUSH_DISPATCH_MAX_ATTEMPTS`**（整數）；逾上限時寫 **`push_dispatch_abandoned_at`**，後續排程將 **略過** 該列（避免無限 Expo 捶打）。
- **仍卡住**：請至 Admin 「推播／DLQ」檢視；若需放行重試請執行 SQL／RPC：`admin_retry_notification_dispatch(notification_id uuid)`（僅 `profiles.role=admin`），會在 **`push_dispatched_at is null`** 前提下清除 abandon 與重試計數。
- **強制再行銷已成功列**：請勿自動清除 `push_dispatched_at`，以免重複打擾使用者；真要重送請另建通知列。

## 為何不能用使用者 JWT？

此函式使用 **service role** 讀取任意使用者的 `push_tokens` 與更新通知列。**請勿**在前端或公開 Repo 嵌入 service_role。**請勿**將 `NOTIFICATION_DISPATCH_SECRET` 透露給 App。

## Secrets（Dashboard → Edge Functions）

| 變數 | 說明 |
|------|------|
| `NOTIFICATION_DISPATCH_SECRET` | 自訂長隨機字串；請求時須帶 `Authorization: Bearer <同一字串>` |
| `EXPO_ACCESS_TOKEN` | （建議）Expo Access Token，提升送達率 |
| `PUSH_DISPATCH_MAX_ATTEMPTS` | （選填）自動重試次數上限，預設 10；達上限標記 **`push_dispatch_abandoned_at`** |
| （自動注入） | `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` |

## Request

```http
POST /functions/v1/dispatch-notification-push
Authorization: Bearer <NOTIFICATION_DISPATCH_SECRET>
```

Body 可不送。

## 行為說明

- 每次最多處理 **50** 筆：**`push_dispatched_at`** 為 null **`push_dispatch_abandoned_at` 為 null** 者（已達重試上限而放棄者略過）。
- 若使用者 **沒有任何 push token**：視為無須推播，仍會標記 `push_dispatched_at`（避免永遠卡住佇列）。
- 若有 token 但 Expo API **HTTP 失敗**：**不會**標記 `push_dispatched_at`，並遞增 `push_dispatch_attempts`、寫入 `push_dispatch_error`，下次排程可重試；達 **`PUSH_DISPATCH_MAX_ATTEMPTS`** 則標記 **`push_dispatch_abandoned_at`**。
- 大量 token 會切成每批約 **90** 則訊息送往 Expo。

## 建議排程

Supabase Dashboard → Edge Functions → **Schedules**：例如每分鐘或每 5 分鐘 `POST` 本函式（路徑含專案 ref），Header 使用上述 Bearer Secret。

亦可由 Database Webhook（例如 `notifications` INSERT）改為呼叫 **Supabase Functions Invoke**，但仍須保護 Secret，不可暴露在瀏覽器。

## 資料欄位

Migration：`notifications.push_dispatched_at`（`20260217100400_notifications_push_dispatch.sql`）；重試診斷：`push_dispatch_attempts`、`push_dispatch_error`（`20260218120000_p2_enterprise.sql`）、**`push_dispatch_abandoned_at`**（規劃期 migration）。
