# 靜宜校園 Edge Relay

東京（Fly `nrt`）連 `*.pu.edu.tw` 會被靜宜防火牆丟包。這個 Cloudflare Worker 固定跑在台灣 `gcp:asia-east1`（實際 colo 為 TPE），把 nuni-web 的校園 HTTPS 請求轉出去。

**預設關閉。** 沒設環境變數時，成績與 TronClass 維持原本的 `https.request`，學號登入維持 IPv4 直連，行為與 main 一致。

本目錄只放原始碼與部署說明。不要把密鑰寫進 repo，也不要在這個變更裡實際部署。

## 做什麼

- 只轉 `https://*.pu.edu.tw`（可用 `ALLOWED_HOSTS` 收緊白名單）
- 請求必須帶 HMAC-SHA256 簽章、時間戳與隨機 nonce；時間戳允許 60 秒誤差，窗口內重複 nonce 回 **404**
- 簽章涵蓋 timestamp、nonce、method、target、body 的 SHA-256、Cookie 與 Content-Type
- 原樣轉送 method、標頭（含 Cookie）、body
- `redirect: manual`，多個 `Set-Cookie` 與 `Location` 原樣回傳
- 日誌只記 host、path、status、耗時、執行位置；不記 body、Cookie、學號、密碼
- 回應加上 `x-pu-relay-colo`（實際執行位置，例如 `remote-TPE`，不是入口 colo）
- 若執行位置不在台灣附近（例如 `remote-NRT`），日誌加 `placement_miss`

簽章字串（UTF-8）：

```
{unix秒}
{nonce}
{METHOD}
{完整目標 URL}
{body 的 SHA-256 hex}
{Cookie 標頭，沒有則空}
{Content-Type 標頭，沒有則空}
```

標頭：

- `x-pu-relay-ts`：Unix 秒
- `x-pu-relay-nonce`：32 字元 hex 隨機值
- `x-pu-relay-sign`：HMAC-SHA256 hex
- `x-pu-relay-target`：例如 `https://alcat.pu.edu.tw/index_check.php`

客戶端會把 Location 尾點 FQDN（`alcat.pu.edu.tw.`）正規化後再走轉送。

## 部署 Worker

免費方案即可。在 repo 根目錄：

```sh
cd deploy/edge-relay
npm install
npx wrangler login
npx wrangler secret put RELAY_SECRET
npx wrangler deploy
```

`wrangler.toml` 已設 `placement.region = "gcp:asia-east1"`，並關閉 Workers Logs／invocation logs／traces。

**部署後請到 Cloudflare dashboard 確認 Workers Logs 關閉：** Workers → `pu-edge-relay` → Observability / Logs，確認 Logs 與 Traces 都是關。此 Worker 會轉送 Cookie 與登入表單，不要把 invocation log 存到 Cloudflare。

部署後記下 `workers.dev` 網址，例如 `https://pu-edge-relay.<帳號>.workers.dev`（不要結尾斜線）。

可選白名單（逗號分隔；預設 `*.pu.edu.tw`）：

```sh
npx wrangler secret put RELAY_SECRET   # 共用密鑰，與 Fly 同一把
# ALLOWED_HOSTS 已在 wrangler.toml 的 [vars]
```

更換密鑰：再執行一次 `wrangler secret put RELAY_SECRET`，並同步更新 Fly。

## 開啟 nuni-web 轉送

nuni-web 的 Fly app 是 `nuni-web`。兩個都要設才會走轉送：

```sh
fly secrets set \
  PU_EDGE_RELAY_URL=https://pu-edge-relay.<帳號>.workers.dev \
  PU_EDGE_RELAY_SECRET='與 wrangler secret 相同的那把' \
  -a nuni-web
```

若東京的 `nuni-functions` 也要打學校，用**同一組名稱**：

```sh
fly secrets set \
  PU_EDGE_RELAY_URL=https://pu-edge-relay.<帳號>.workers.dev \
  PU_EDGE_RELAY_SECRET='與 wrangler secret 相同的那把' \
  -a nuni-functions
```

只設其中一個變數不會開啟轉送。

## 回滾（回到直連）

拿掉兩個環境變數即回直連（成績／TronClass 回 `https.request`，登入回 IPv4 fetch）：

```sh
fly secrets unset PU_EDGE_RELAY_URL PU_EDGE_RELAY_SECRET -a nuni-web
```

不必改程式、不必部署 Worker 下線。

## 本機確認

```sh
cd deploy/edge-relay
npx wrangler dev
```

網站測試請用 vitest（`pnpm --filter web test`），不要把正式密鑰寫進 `.env`。
