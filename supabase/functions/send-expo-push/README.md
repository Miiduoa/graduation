# send-expo-push

將一批 Expo Push Token 送往 Expo Push API（HTTPS）。呼叫者必須帶 **使用者 JWT**，且 `profiles.role = admin`。

**自動派發通知匣 → 推播**：見同目錄下的 [`dispatch-notification-push`](../dispatch-notification-push/README.md)（使用 `NOTIFICATION_DISPATCH_SECRET`，由 Cron／Webhook 呼叫；勿在前端嵌入 service_role）。

## Secrets（Dashboard → Edge Functions）

- `EXPO_ACCESS_TOKEN`：Expo 帳號的 Access Token（推播送達率／配額視 Expo 設定而定）。
- （自動注入）`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`

## Request

`POST`，Header：`Authorization: Bearer <使用者 access_token（anon sign-in 後取得）>`

Body：

```json
{
  "title": "公告",
  "body": "請查看通知匣",
  "tokens": ["ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"]
}
```

## 本地開發

請依 Supabase CLI 文件建立函式並部署；勿把 service_role 放進瀏覽器。
