# Nuni 後端串接

Campus One 保留紙白／墨綠介面，後端方向改為沿用 Nuni。這批先完成 Web 帳號與課程作業的完整往返；不需要 Firebase custom token，也不把 Nuni 帳號偽裝成 Firebase User。

## 目前可驗證的功能

- Google authorization code + PKCE 登入；沿用 `https://nuni.tw/auth/platform/callback`。登入方式需同時符合 Web 設定與 API 實際開放的 provider，才顯示可使用的按鈕。
- Nuni 平台 session 以相容的 AES-GCM HttpOnly Cookie 保存，Google client secret 只在伺服器使用。頁面與 API 回應不包含 platform handle。
- 我的課程、建立課程、邀請加入、老師發布作業、學生繳交、老師查看繳交內容。
- 回應遺失後保留同一份送出內容與 idempotency key；重試不建立第二門課。後端沒有確認前不顯示成功。
- 學生、授課老師與未加入者由後端判定。平台帳號與課班身分不會取得學校學籍、正式成績或校務管理權。
- 每個資料要求綁定登入 session；舊頁面不能使用另一個帳號的 Cookie 寫入。登出失敗時保留待撤銷狀態，重新開頁也不恢復私人資料。

## 設定

參考 `apps/web/nuni.env.example`。這是尚未切換正式流量的候選 profile，必須明確設定 `CAMPUS_BACKEND=nuni`；未指定時保留現行 Firebase 程式路徑，以便逐步遷移與回復。

| 設定                                    | 用途                                                             |
| --------------------------------------- | ---------------------------------------------------------------- |
| `CAMPUS_BACKEND=nuni`                   | 啟用 Nuni 頁面及伺服器 API                                       |
| `NUNI_API_BASE_URL=https://api.nuni.tw` | 既有 API；不可含路徑、帳密或查詢參數                             |
| `WEB_PUBLIC_ORIGIN=https://nuni.tw`     | Cookie／OAuth／CSRF 的正式來源，不信任 Host 或 forwarded headers |
| `BFF_SESSION_SECRET`                    | 沿用既有主機的 session 加密 secret，至少 32 字元                 |
| `PLATFORM_GOOGLE_LOGIN_ENABLED=true`    | 明確開放 Google 登入                                             |
| `PLATFORM_GOOGLE_CLIENT_SECRET`         | 沿用既有伺服器 secret，不放入 NEXT_PUBLIC 或映像                 |

`nuni-web` 的唯讀 secret 名稱清單已確認包含上述既有加密、Google 登入及公開來源設定；沒有讀出 secret 值或新增付費服務。Nuni 既有 session cookie 格式相容，但正式登入／切換仍須在同版本候選站驗收。

## 驗證邊界

參考 API 原始碼為 `Miiduoa/nuni-prod@9de47b4b3492325e430562c37bcad552867162db`。該 repository 已封存；線上 `api.nuni.tw` 的 Google provider 仍可讀取。Fly API 映像沒有足以核定原始碼 SHA 的 metadata，不能把參考版本當成已部署版本。

2026-10-08 以該來源的實際 Fastify API、獨立持久化資料庫、停用 demo auth、測試用簽署身分完成瀏覽器驗證：老師開課、邀請、發布作業，學生加入、繳交、重新整理，老師收件；另確認越權／非成員讀取、過期帳號寫入、遺失回應重試及真正撤銷 session。測試 Google 身分只在隔離 harness 中使用，沒有加入應用程式或部署路徑。

程式內測試涵蓋 Cookie 加密與用途隔離、CSRF、過期帳號要求、登出失敗後重試、回應大小限制、Google endpoint allowlist、state／PKCE、跨課程契約與前端延遲回應。執行：

```sh
pnpm --filter web exec vitest run src/lib/nuni/server.test.ts src/features/nuni/Session.test.tsx
pnpm --filter web typecheck
pnpm --filter @campus/shared typecheck
CAMPUS_BACKEND=nuni pnpm --filter web build
```

## 尚未達到發布條件

Nuni profile 目前只提供上述課程與帳號流程。其他校務／社群／地圖資料來源、完整教師操作、原生 App session 與深連結、支付退款、推播及商店交付尚未遷移。未實作的 Nuni 路由會明確說明尚未開放，不會落回 Firebase UID、展示資料或假成功。

這批不能直接取代 `nuni.tw` 現站。完成其餘路由、正式 Google 登入、真實角色、跨帳號撤銷、資料遷移與實機驗收後，才可切換正式流量。舊的 Firebase Blaze 啟用步驟不再是目前路線的下一步。

Google 登入協定參考：[Google OAuth Web Server 文件](https://developers.google.com/identity/protocols/oauth2/web-server)。
