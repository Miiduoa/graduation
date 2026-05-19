# sync-external-directory

以 **service role** 對一批 email 發送 **`inviteUserByEmail`**（使用者將收到 Supabase／SMTP 邀請信）。供校外名錄／HR CSV 等非互動情境呼叫。

## Secrets

| 變數 | 說明 |
|------|------|
| `EXTERNAL_DIRECTORY_SECRET` | 自訂長隨機字串；請求須 `Authorization: Bearer <同一字串>` |
| （自動注入） | `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` |

Dashboard → Authentication → SMTP／發信設定須可用，否則邀請信無法送出。

## Request

```http
POST /functions/v1/sync-external-directory
Authorization: Bearer <EXTERNAL_DIRECTORY_SECRET>
Content-Type: application/json
```

Body：

```json
{
  "users": [
    { "email": "student@school.edu.tw", "display_name": "王小明" },
    { "email": "teacher@school.edu.tw", "display_name": "李老师" }
  ]
}
```

## 說明

- **不是 LDAP bind**：若校務為 LDAP，優先將 **LDAP → IdP（AD FS／Keycloak 等）→ Supabase Hosted SAML／OIDC**；請勿將校務使用者密碼流經自建 Edge。
- **`ldap.js`/`ldapsearch` Connector（唯讀）**：若校方僅能提供 LDAP／LDAPS，建議將排程程式部署在 VPC 受信網段，對 LDAP **唯讀**擷取 email／display name，並轉成上述 JSON POST 進本函式；失敗告警（HTTP 狀態、錯誤列）請寫入校務監控。**不要**對外公開 Secret，亦不要嘗試在 Supabase 內對 LDAP 進行互動 bind 當成登入協定——仍應交由 IdP 完成認證與 MFA。
- 已存在之使用者會計入 `skipped`。
- **切勿**在前端或公開腳本硬編 Secret。

## Staging checklist（摘）

完整步驟與 RBAC／SSO Redirect 對照請見 [`docs/auth-enterprise.md`](../../docs/auth-enterprise.md)
「Staging 端到端檢查清單」；請在 **staging Supabase** 實際驗 **invite→啟用帳號→教師加入課程**。
