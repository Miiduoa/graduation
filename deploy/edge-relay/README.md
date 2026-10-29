# 靜宜校園 Edge Relay

東京（Fly `nrt`）連 `*.pu.edu.tw` 會被靜宜防火牆丟包。這個 Cloudflare Worker 固定跑在台灣 `gcp:asia-east1`（實際 colo 為 TPE），把 nuni-web 的校園 HTTPS 請求轉出去。

**預設關閉。** 沒設環境變數時，網站維持 IPv4 直連，行為不變。

本目錄只放原始碼與部署說明。不要把密鑰寫進 repo，也不要在這個變更裡實際部署。

## 做什麼

- 只轉 `https://*.pu.edu.tw`（可用 `ALLOWED_HOSTS` 收緊白名單）
- 請求必須帶 HMAC-SHA256 簽章與時間戳，允許 60 秒誤差；否則回 **404**
- 原樣轉送 method、標頭（含 Cookie）、body
- `redirect: manual`，多個 `Set-Cookie` 與 `Location` 原樣回傳
- 日誌只記 host、path、status、耗時、colo；不記 body、Cookie、學號、密碼
- 回應加上 `x-pu-relay-colo`

簽章字串（UTF-8）：

```
{unix秒}\n{METHOD}\n{完整目標 URL}
```

標頭：

- `x-pu-relay-ts`：Unix 秒
- `x-pu-relay-sign`：HMAC-SHA256 hex
- `x-pu-relay-target`：例如 `https://alcat.pu.edu.tw/index_check.php`

## 部署 Worker

免費方案即可。在 repo 根目錄：

```sh
cd deploy/edge-relay
npm install
npx wrangler login
npx wrangler secret put RELAY_SECRET
npx wrangler deploy
```

`wrangler.toml` 已設 `placement.region = "gcp:asia-east1"`。部署後記下 `workers.dev` 網址，例如 `https://pu-edge-relay.<帳號>.workers.dev`（不要結尾斜線）。

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

拿掉兩個環境變數即回 IPv4 直連：

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
