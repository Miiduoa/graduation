# 靜宜校園 Edge Relay（Supabase）

靜宜防火牆封鎖部分 Cloudflare Workers 出口時，把 `alcat.pu.edu.tw`、`mypu.pu.edu.tw` 改走東京（`ap-northeast-1`）的 Supabase Edge Function。簽章協定與 `deploy/edge-relay` 相同，**protocol 直接引用那一份，不要再複製**。

`identity.pu.edu.tw`、`tronclass.pu.edu.tw` 仍走 Cloudflare Worker；這支函式不要當成全部校園流量的唯一出口。

本目錄只放原始碼與部署說明。密鑰在 Vault，不要寫進 repo，也不要在這個變更裡實際部署。

## 做什麼

- 只轉 `https://*.pu.edu.tw`（可用 `ALLOWED_HOSTS` 收緊白名單）
- 請求必須帶 HMAC-SHA256 簽章、時間戳與隨機 nonce；時間戳允許 60 秒誤差，窗口內重複 nonce 回 **404**
- 簽章涵蓋 timestamp、nonce、method、target、body 的 SHA-256、Cookie 與 Content-Type
- 原樣轉送 method、標頭（含 Cookie）、body
- `redirect: manual`，多個 `Set-Cookie` 與 `Location` 原樣回傳
- 日誌只記 host、path、status、耗時、執行位置；不記 body、Cookie、學號、密碼
- 回應加上 `x-pu-relay-colo`（例如 `supabase-ap-northeast-1`）
- `cf-placement` 只寫進日誌，不用來拒絕請求

簽章字串與標頭與 `deploy/edge-relay/README.md` 相同。

## 為什麼關閉 JWT 驗證

這支函式不是給已登入的 Supabase 使用者呼叫，而是 nuni-web／Functions 用 HMAC 把校園 HTTPS 轉出來。若開著 `verify_jwt`，沒有使用者 JWT 的伺服器端轉送會全部 401，HMAC 簽章還沒檢查到。

身份驗證改由 `x-pu-relay-sign`（HMAC-SHA256）負責，與 Cloudflare Worker 同一套。部署時必須加 `--no-verify-jwt`。

## 密鑰（Vault）

不要把轉送密鑰寫進函式環境變數或原始碼。在 Dashboard → Project Settings → Vault 建立名稱為 `pu_edge_relay_secret` 的 secret，再建立只有 `service_role` 能執行的 RPC：

```sql
create or replace function public.pu_edge_relay_secret()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'pu_edge_relay_secret'
  limit 1;
$$;

revoke all on function public.pu_edge_relay_secret() from public, anon, authenticated;
grant execute on function public.pu_edge_relay_secret() to service_role;
```

函式啟動後用內建的 `SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 呼叫這個 RPC，密鑰快取 5 分鐘。

## 部署

專案請選東京 `ap-northeast-1`。從 repo 根目錄：

```sh
npx supabase functions deploy pu-edge-relay \
  --project-ref <PROJECT_REF> \
  --no-verify-jwt \
  --entrypoint deploy/supabase-relay/index.ts
```

若 CLI 不收 `--entrypoint`，把 `index.ts` 連同它 import 的 `deploy/edge-relay/src/protocol.ts` 放到暫存函式目錄再部署，**不要手改 protocol**。

可選白名單（逗號分隔；預設 `*.pu.edu.tw`）：

```sh
npx supabase secrets set ALLOWED_HOSTS='alcat.pu.edu.tw,mypu.pu.edu.tw'
```

部署後記下函式 URL，例如：

`https://<PROJECT_REF>.supabase.co/functions/v1/pu-edge-relay`

（不要結尾斜線。）

## 開啟 nuni-web／Functions 分流

主轉送仍是 Cloudflare。備援三個變數都要設才會把列出的主機改走這支函式；沒設時行為與現在完全一樣。

```sh
fly secrets set \
  PU_EDGE_RELAY_ALT_URL=https://<PROJECT_REF>.supabase.co/functions/v1/pu-edge-relay \
  PU_EDGE_RELAY_ALT_SECRET='與 Vault pu_edge_relay_secret 相同的那把' \
  PU_EDGE_RELAY_ALT_HOSTS='alcat.pu.edu.tw,mypu.pu.edu.tw' \
  -a nuni-web
```

若 `nuni-functions` 也要打 alcat／mypu，用同一組名稱：

```sh
fly secrets set \
  PU_EDGE_RELAY_ALT_URL=https://<PROJECT_REF>.supabase.co/functions/v1/pu-edge-relay \
  PU_EDGE_RELAY_ALT_SECRET='與 Vault pu_edge_relay_secret 相同的那把' \
  PU_EDGE_RELAY_ALT_HOSTS='alcat.pu.edu.tw,mypu.pu.edu.tw' \
  -a nuni-functions
```

主機比對是精確 FQDN（會去掉尾點），`www.alcat.pu.edu.tw` 不會因為列出 `alcat.pu.edu.tw` 就走備援。不要把 `*.pu.edu.tw` 寫進 `PU_EDGE_RELAY_ALT_HOSTS`（萬用字元會被忽略）。

## 回滾（回到只走 Cloudflare／直連）

拿掉三個備援變數即回到主轉送；不必下線這支函式：

```sh
fly secrets unset PU_EDGE_RELAY_ALT_URL PU_EDGE_RELAY_ALT_SECRET PU_EDGE_RELAY_ALT_HOSTS -a nuni-web
```

## 怎麼移除這支函式

1. 先做上面的 Fly unset，確認流量不再打過來。
2. `npx supabase functions delete pu-edge-relay --project-ref <PROJECT_REF>`
3. 刪掉 Vault 的 `pu_edge_relay_secret`，並 `drop function if exists public.pu_edge_relay_secret();`

## 本機確認

單元測試走 vitest（`pnpm --filter web test`），只用 mock，不會對真實學校送帳密。不要把正式密鑰寫進 `.env`。
