# Google 帳號的 AI 動作權限

`/settings?section=assistant` 的 Google 平台帳號權限透過 BFF 的 `GET/POST /api/nuni/assistant-permissions` 儲存到 nuni PostgreSQL。每個平台帳號一份，跨瀏覽器、分頁與重新登入共用。公開社群及雲端 AI 服務仍維持啟用；這份設定只控制可由助理提出與執行的動作。

目前兩項權限為 `createPersonalEvent`（新增個人行程）及 `prepareFoodOrder`（整理訂餐草稿）。沒有設定時兩項均為 false；讀取失敗回 503，不以本機狀態、cookie 或記憶體冒充儲存成功。校內請假、圖書、點名等既有學校帳號權限不會與 Google 帳號合併。

## API 與儲存

- GET 回 `{ scope: 'platform-account', accountId, revision, permissions }`。
- POST 只接受 `{ expectedRevision, permissions: { createPersonalEvent, prepareFoodOrder } }`，兩項都必須是布林值。
- 帳號 ID 只從已驗證的 `sessions/current` 取得；不接受 request body、query、Firebase UID 或 email 指定帳號。
- 沿用 HttpOnly session、同源檢查、`x-campus-session` 與上游撤銷驗證，回應 `Cache-Control: no-store`。不重寫登入 cookie。
- 原生 App 沿用既有精確 `Authorization: Platform ps_…` 傳輸，不依賴瀏覽器 cookie；仍向上游驗證主體。帶有 cookie 的混合身分、格式不符的 Authorization、跨來源請求皆拒絕。Web 與 App 共用同一帳號偏好，不新增 Firebase 對應身分。
- 使用 revision 比較後更新。缺省 revision 為 0，首次成功儲存為 1。兩個分頁從同一 revision 更新，只有一個成功；另一個回 `ASSISTANT_PERMISSION_REVISION_CONFLICT`（409），重新讀取後再確認。
- 所有讀取都查 PostgreSQL，不快取權限。助理提出動作及送出確認前各自重查；關閉後不能用舊確認卡開始新的寫入。已經送至上游的操作仍須依原回執核對結果。

## 可重現的 API 候選

既有 `build.py` 新增明確的 `--assistant-permissions-candidate` 選項。它依固定來源重建 composed API，再保留目前版本的完整失物招領程式與 282 migration，最後只新增 `283_platform_assistant_permissions.sql`。`source.json` 固定三份前置 manifest、adapter、SQL checksum、完整 input tree 與 candidate tree；一般建置遇到漂移就失敗，不自行刷新綁定。

```sh
python3 deploy/nuni-api/assistant-permissions/prepare.py --verify-only
python3 deploy/nuni-api/build.py --assistant-permissions-candidate \
  --assistant-permissions-source /absolute/path/to/authorized-nuni-prod \
  --prepare-only --output-dir /tmp/new-assistant-permissions-context
```

輸出目錄必須不存在。提供的 archive 僅作為讀取來源；省略 `--assistant-permissions-source` 時會嘗試從既有固定 GitHub repository clone。驗證完成的 context 可再以 `prepare.py --verify-only --checkout /tmp/new-assistant-permissions-context` 核對。一般 prepare 必須具備完整 Git objects 與工作樹，不能把局部來源當成可建置的 API。

候選 input tree 為 `fffde885da74a84cfd9ae702f955db99507dc855`；新增 283 後為 `841c117c46775fec3af27da9d88abaf0ae13b2f7`。兩者的唯一差異路徑是 `apps/api/src/migrations/283_platform_assistant_permissions.sql`。API 既有 build script 將 `src/migrations/*.sql` 複製到 `dist/migrations/`，原 migration runner 因此會納入 283 的 ID/checksum；不另外建立 BFF migration runner。

沒有 `--prepare-only` 時，builder 只建置本機 `nuni-api:assistant-permissions-candidate` Docker image，標示已核驗 tree，不推送、不部署、不跑資料庫。其他候選選項與它互斥，既有 default/imports/lost-found 來源 manifest 不變。

## 發布順序與存取範圍

發布前先核對實際執行中的 API immutable image、來源 tree 與已套用的 migration 清單。上述 input 是程式庫內固定的 lost-found 候選，**不代表此刻正式站必定是同一來源**。若正式站含有此候選未納入的程式變更或不同的 migration checksum，先以該真實來源重新整合及核驗，不可用這份候選覆蓋。固定來源、完整 typecheck/build、既有 API 回歸與隔離 migration 驗收須對同一個將發布的映像完成。

依既有安全發布環境，用已核驗映像中的 `node apps/api/dist/migrate.js` 套用完整 manifest，再核對 283 checksum 與下表 ACL；API 啟動驗證完成後再發布 Web 與 App。若 282 尚未套用，必須先把它及前置 migration 的範圍納入同一發布審查，不能假設只會跑 283。不能讓 BFF 在 request 中建立資料表，也不能直接裸跑 SQL 規避 migration 紀錄。沒有表或 ACL 時，BFF 回 `ASSISTANT_PERMISSION_STORE_UNAVAILABLE`，不會顯示儲存成功。

連線依序使用 `PLATFORM_ASSISTANT_DATABASE_URL`、既有 `ASSIGNMENT_FILE_DATABASE_URL`、`DATABASE_URL`，必須指向含 `platform_accounts` 的 nuni PostgreSQL。這是既有平台資料庫，不建立另一套 Storage 或 Firebase 權限。程式不讀取瀏覽器提供的連線設定、不輸出連線字串；測試也不使用正式環境連線。

所需最小 ACL：

| 執行角色 | 權限 |
| --- | --- |
| BFF 既有資料庫角色 | `platform_assistant_permissions` 的 SELECT、INSERT、UPDATE |
| BFF 既有資料庫角色 | `platform_accounts` 的 SELECT（id、state）與 UPDATE（id）；後者僅為 PostgreSQL `FOR SHARE` 鎖定的必要權限，程式不更新帳號 |
| 執行平台帳號關閉的 API 角色 | 新表 DELETE 及 SELECT（platform_account_id），讓關帳 trigger 在同一交易清理設定 |
| Migration 角色 | 建表、外鍵及 trigger 所需權限；不把 migration 權限交給 BFF |

API 角色只需用帳號 ID 清理關帳資料，無須讀取或變更偏好值；由 Web BFF 唯一讀寫偏好。帳號硬刪由外鍵 `ON DELETE CASCADE` 清理；狀態改為 closed/deleted 時由 trigger 清理；暫停帳號保留資料但無法使用。寫入鎖住有效帳號列，與關帳序列化。不得為省略 ACL 驗證改用超級使用者連線。

## 驗證範圍

Web 回歸覆蓋嚴格欄位驗證、Google session 驗證、錯誤帳號、撤銷登入、跨來源、跨 session、CAS 衝突與資料庫失敗。實際 PostgreSQL 測試另需明確指定一次性 loopback 資料庫；正式 migration、授權角色與兩個真實 Google 帳號的端到端驗收須對發布版本核對。

封裝回歸：

```sh
python3 deploy/nuni-api/assistant-permissions/prepare_test.py
python3 deploy/nuni-api/food-ordering/build_test.py
python3 scripts/platform-lost-found/prepare_test.py
```

本次來源核對紀錄在 `verification.json`。使用已授權 GitHub connector 取得精確 base 的完整 recursive tree metadata，核對 303 個 Git directory hashes 及 17 個補丁所需原始 blobs 的 SHA，再核對既有 base/composed tree，最後重建保留 282 的完整候選 tree。未變更、未下載的 blobs 保留來源 SHA；這證明 tree 結構與差異，**不是完整 archive 物化、Docker build 或正式部署收據**。產品 prepare 檢查沒有放寬，仍要求完整來源。

回滾只能使用仍保留本次 BFF／V2 權限檢查的相容版本，例如只回退設定畫面的修正。不可將整個 Web 回退到尚未實作這份帳號權限的版本：舊執行流程不讀取新表，單純保留資料表仍會讓已撤銷的動作重新執行。任何回退版本都必須重跑關閉權限與舊確認卡測試；同時保留 API 中 283 的 manifest、設定表與 revision，不刪除使用者選擇，不用舊 cookie 恢復被關閉的動作。
