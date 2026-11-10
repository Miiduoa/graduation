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
