# Nuni 後端串接

Campus One 保留紙白／墨綠介面，後端方向改為沿用 Nuni。Nuni 課程空間新增在 `/classroom`，原有首頁、校務、群組、社群、生活服務、帳號、設定與管理頁全部維持原路徑與權限；不以後端開關替換整個應用程式，也不把 Nuni 帳號當成 Firebase User。

## 目前可驗證的功能

- Google authorization code + PKCE 登入；沿用 `https://nuni.tw/auth/platform/callback`。登入方式需同時符合 Web 設定與 API 實際開放的 provider，才顯示可使用的按鈕。
- Nuni 平台 session 以相容的 AES-GCM HttpOnly Cookie 保存，Google client secret 只在伺服器使用。頁面與 API 回應不包含 platform handle。
- 課程空間、建立課程、課程建立者邀請學生；老師發布文字教材與參考連結、作業、文字測驗；學生閱讀、繳交與作答；老師收件、留下回饋、停止收件。
- 所有服務選單保留原有入口，另加課程空間。原本 `/groups` 的課程與群組不會被替換；Nuni 帳號與校園帳號分開驗證，登出課程空間不代表已登出校園帳號。
- 回應遺失後保留同一份送出內容與 idempotency key；重試不建立第二門課。後端沒有確認前不顯示成功。
- 學生、授課老師與未加入者由後端判定。平台帳號與課班身分不會取得學校學籍、正式成績或校務管理權。
- 每個資料要求綁定登入 session；舊頁面不能使用另一個帳號的 Cookie 寫入。登出失敗時保留待撤銷狀態，重新開頁也不恢復私人資料。

## 設定

參考 `apps/web/nuni.env.example`。使用 `NUNI_CLASSROOM_ENABLED=true` 明確開放新增的課程 API。這個設定不會切換原有功能或登入系統；根佈局固定保留既有 AuthProvider 與 ToastProvider。舊的 `CAMPUS_BACKEND=nuni` 僅作為 Nuni API 啟用旗標的相容寫法，已無全站切換作用。

| 設定                                    | 用途                                                             |
| --------------------------------------- | ---------------------------------------------------------------- |
| `NUNI_CLASSROOM_ENABLED=true`           | 開放新增課程空間的伺服器 API，保留全部原有頁面                   |
| `NUNI_API_BASE_URL=https://api.nuni.tw` | 既有 API；不可含路徑、帳密或查詢參數                             |
| `WEB_PUBLIC_ORIGIN=https://nuni.tw`     | Cookie／OAuth／CSRF 的正式來源，不信任 Host 或 forwarded headers |
| `BFF_SESSION_SECRET`                    | 沿用既有主機的 session 加密 secret，至少 32 字元                 |
| `PLATFORM_GOOGLE_LOGIN_ENABLED=true`    | 明確開放 Google 登入                                             |
| `PLATFORM_GOOGLE_CLIENT_SECRET`         | 沿用既有伺服器 secret，不放入 NEXT_PUBLIC 或映像                 |

`nuni-web` 的唯讀 secret 名稱清單已確認包含上述既有加密、Google 登入及公開來源設定；沒有讀出 secret 值或新增付費服務。Nuni 既有 session cookie 格式相容，但正式登入／切換仍須在同版本候選站驗收。

## 驗證邊界

參考 API 原始碼為 `Miiduoa/nuni-prod@9de47b4b3492325e430562c37bcad552867162db`。該 repository 已封存；線上 `api.nuni.tw` 的 Google provider 仍可讀取。Fly API 映像沒有足以核定原始碼 SHA 的 metadata，不能把參考版本當成已部署版本。

2026-10-08 以該來源的實際 Fastify API、獨立持久化資料庫、停用 demo auth、測試用簽署身分完成瀏覽器驗證：老師開課、邀請、發布作業，學生加入、繳交、重新整理，老師收件；另確認越權／非成員讀取、過期帳號寫入、遺失回應重試及真正撤銷 session。測試 Google 身分只在隔離 harness 中使用，沒有加入應用程式或部署路徑。

修正全站入口後，另外驗證全部 55 個原有 Web 路由：訪客頁面均可開啟，沒有被 Nuni 登入或通用未開放頁取代，沒有瀏覽器例外；首頁、服務搜尋、群組與設定另測 320、390、1365px 共 12 組。這只證明原有入口與訪客畫面保留，不代表所有登入後業務已接通。原有題庫、測驗管理及評分規準頁的未完成功能仍列入交付範圍。

課程空間以 production build、隔離 HTTPS 與同一 Nuni API 來源驗證：教材與安全參考連結、作業／測驗繳交、老師回饋、停止收件、學生重新載入讀取回饋，以及學生越權拒絕。作業回執遺失後保留同一份內容與重試鍵；關閉回執遺失後，重新讀取實際關閉狀態。隔離 HTTPS 使用本機測試憑證，未驗證 service worker 的正式憑證信任；沒有修改正式 Google 或校園帳號設定。

程式內測試涵蓋 Cookie 加密與用途隔離、CSRF、過期帳號要求、登出失敗後重試、回應大小限制、Google endpoint allowlist、state／PKCE、跨課程契約與前端延遲回應。執行：

```sh
pnpm --filter web exec vitest run src/lib/nuni/server.test.ts src/features/nuni/Session.test.tsx
pnpm --filter web typecheck
pnpm --filter @campus/shared typecheck
NUNI_CLASSROOM_ENABLED=true pnpm --filter web build
```

## 尚未達到發布條件

Nuni 串接目前涵蓋上述課程空間與帳號流程。其他校務、群組、社群、地圖、完整教師操作、設定及管理功能維持既有實作與資料來源，不能為了遷移而移除或用「尚未開放」替代。這些功能尚未全部移植到 Nuni；原生 App session 與深連結、支付退款、推播及商店交付也仍待逐項整合驗收。頁面和入口保留不等於所有服務已完成上線驗收。

這批不能直接取代 `nuni.tw` 現站。完成所有既有功能的對照驗收、正式 Google 登入、真實角色、跨帳號撤銷、資料遷移與實機驗收後，才可切換正式流量。舊的 Firebase Blaze 啟用步驟不再是目前路線的下一步。

Google 登入協定參考：[Google OAuth Web Server 文件](https://developers.google.com/identity/protocols/oauth2/web-server)。

## 課程操作的資料界線

作業與文字測驗的時間欄位只提供參考；實際停止收件須由老師操作。測驗送出後此頁保留唯讀紀錄，後端並非一次作答的考試引擎，不應宣稱能防止其他用戶端重新作答。回饋編輯會偵測已讀取的新版本並要求選擇；後端沒有版本鎖，不能保證攔下尚未讀取的其他老師更新。

教材與測驗目前列出最近 100 筆。封存課程保留可讀內容，依 API 權限不顯示無法使用的名單操作。原有課程系統的題庫、評分規準、成績簿等功能不因新增文字測驗而被替換。
