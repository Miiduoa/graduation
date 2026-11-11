# Google 平台服務權限

依主人晉瑋 2026-11-10 22:41（台北）「功能不能關」指示，既有公開社群（social）與雲端 AI（cloudAi）預設且持續啟用，無法透過權限設定關閉。

- 設定頁僅說明功能維持開啟、無法關閉，不提供 switch、儲存或樂觀更新。舊跨分頁權限通知不會清除社群草稿或停用功能。
- `platformServiceAccess` 永遠回傳兩項為 `true`；`requirePlatformService` 不會因服務偏好拒絕既有能力；`withPlatformServiceAccess` 忽略關閉值並移除舊限制。
- 讀取有效 session cookie 時忽略所有 `restrictedServices` 殘留值，包括缺省、舊格式及無效限制欄位。既有 session 有效期、加密驗證與登出狀態檢查仍適用；不會因舊限制欄位拒絕有效登入。
- `GET /api/nuni/service-access` 驗證登入後回傳 `{ social: true, cloudAi: true, scope: 'web-session' }`。
- `POST /api/nuni/service-access` 保留同源、session context、upstream session 與欄位驗證。任一值為 `false` 時回 422 `PLATFORM_SERVICE_ALWAYS_ENABLED`，不寫 cookie；兩項均為 `true` 時可清除 cookie 的舊限制。缺欄位或不合法輸入回 422。
- 社群讀寫、封鎖、檢舉與 assistant capability、ask 及 V2 操作不受舊服務偏好限制；不再產生設定造成的 403 `PLATFORM_SERVICE_DISABLED`。V2 的既有動作驗證保持適用。

Google 帳號不因此取得學校會員、老師、店家或管理員身分；校內私訊仍依學校身分授權。模型資料分享及具體寫入仍需各自確認。此次修改不開啟學號登入或下單開關，也不包含部署。

相關自動化測試覆蓋關閉請求無效、舊 cookie 保持啟用、API 仍到達 upstream、設定頁無關閉控制，以及舊事件不會中斷社群操作。

## Google 帳號的 AI 代辦權限（2026-11-11）

服務持續啟用與「允許 AI 代辦哪些動作」是兩個不同設定。Google-only 登入原本無法使用綁定 Firebase 學校帳號的助理權限，且「管理平台 AI 權限」只會開啟上述服務說明。本次在 Web 與原生 App 的「設定 → 助理權限」提供目前實際支援的兩項 Google 帳號設定：新增個人行程、整理訂餐草稿。兩項預設關閉，分別儲存於平台帳號；學校帳號原有權限保持獨立。

新設定透過 `GET/POST /api/nuni/assistant-permissions` 存入 PostgreSQL，以已驗證的 Google 平台帳號識別，不接受用戶端指定帳號。跨分頁或裝置同時更新時，revision 衝突必須重新讀取；讀取或儲存結果不明時，不允許直接再送出。切換帳號後忽略舊請求的回應。App 沿用既有 Platform bearer，Web 沿用同源 cookie 與 session context。

V2 助理在提出動作及使用者確認前重新檢查權限，關閉後舊卡片不能再開始新的寫入。訂餐權限目前允許整理草稿並前往點餐頁，付款與原本的下單條件仍須另外滿足。讀取設定失敗時停止代辦；AI 對話、社群與使用者手動操作仍可使用。

正式發布需先完成 283 migration、資料庫角色 ACL 及 API 驗證，再發布 Web 與 App。候選來源、保留 282 的建置流程、驗收與回滾方式見 [AI 動作權限發布說明](../deploy/nuni-api/assistant-permissions/README.md)。新增候選與通過本機測試不代表正式站已部署。
