# Google 平台帳號失物招領

這是加在既有 composed API 上的獨立候選來源。Google 平台帳號可依所選學校瀏覽、搜尋、刊登、編輯、結案、下架及匯出本人的失物招領，不建立 Firebase 使用者、學校會員或管理角色，也不讀取／搬移原本 Firestore 的刊登紀錄。

## 資料與操作

API 全部使用 `POST /v1/auth/platform/lost-found/{action}`，請求上限 16 KiB。Web 經既有同源、session context 與 HttpOnly cookie 保護的 BFF；App 使用既有綁定 session 的 Platform transport。

| action | 請求 | 回應 |
| --- | --- | --- |
| `list` | `schoolId`，可帶 `mine`、`q`、`type`、`category`、`status`、`cursor`、`limit` | `schoolId, items, nextCursor`，摘要不含聯絡方式 |
| `get` | `schoolId, id` | `item`，有效登入可查看開啟案件的聯絡方式 |
| `create` | `schoolId, id, mutationId, fields` | `item`，`open`、version 1，核對本次內容 |
| `update` | `schoolId, id, mutationId, expectedVersion, fields` | `item`，只有本人可改開啟案件，version +1 |
| `resolve` | `schoolId, id, mutationId, expectedVersion` | `item`，version +1、`resolved`，清除聯絡方式 |
| `remove` | `schoolId, id, mutationId, expectedVersion` | `removed: true, id, schoolId` |
| `export` | `schoolId`，可帶 `cursor, limit` | 只含本人此學校尚未下架的紀錄及其目前聯絡方式 |

`schoolId` 是公開刊登的瀏覽分組，不代表已驗證學校身分。拒絕 `personal`、`all`、`unavailable-campus` 等非學校範圍，不接受 client 指定擁有者、權限或狀態。列表預設只顯示尋找中；本人列表預設包含結案紀錄。每頁至多 50 筆，游標綁定帳號、學校、篩選條件與匯出範圍，資料庫以毫秒時間及 ID 穩定排序。

### 寫入與重試

用戶端為每次刊登固定產生 `plf_UUID`，為每個操作固定產生 `mutationId`；傳送結果不確定時沿用原值，不自動新增第二筆。資料庫在一個交易內重新確認帳號、憑證與 session，鎖定本人的寫入序列，再檢查版本及操作指紋。

冪等紀錄只保存指紋、物件 ID、操作及結果版本，不另存貼文或聯絡方式。重試時只有目前版本仍與該次成功版本相同才回傳成功；後續已被編輯則回 `LOST_FOUND_REPLAY_CHANGED`，已下架則回 `LOST_FOUND_REMOVED`。不會把舊聯絡方式重新放回回應，也不會拿較新的內容冒充原操作回執。

下架會清除類型、標題、說明、分類、地點、日期與聯絡方式，只保留防止延遲刊登復活所需的 ID、所屬帳號／學校、版本與時間。冪等紀錄保留最近 1,000 次；即使舊回執已修剪，穩定 ID、最小下架紀錄及版本檢查仍會拒絕舊請求。每帳號限制每分鐘 20 次實際寫入、每天 50 次刊登、200 則未下架紀錄、5,000 個累計紀錄 ID。路由另有每 IP 的讀／寫速率限制。相同成功操作的重試不重複計入寫入數。

### 帳號生命週期

282 migration 在 `platform_accounts.state` 改為 `deleted`／`closed` 時，以同一交易刪除該帳號的刊登、聯絡方式、下架紀錄及冪等紀錄；直接刪除帳號也有外鍵 cascade。現有 `closeOwnAccount` 不需另加一個可能遺漏的 API 後置清理步驟。

暫停帳號不刪除可恢復的內容，但讀取端會立即隱藏該作者的所有紀錄。已停用的 session 無法讀寫或匯出。此功能不修改舊 Firestore 帳號的資料或關閉流程。

## 重建與驗證

`source.json` 固定現有 composed input tree、app checksum、來源 manifests、adapter 與每個複製檔案的 checksum。它不捏造尚未重建的 candidate tree。只有取得完整、已授權的 archived source checkout 並通過重建檢查後，工具才輸出實際的新 tree。

```sh
python3 deploy/nuni-api/lost-found/prepare.py --verify-only
python3 deploy/nuni-api/build.py --lost-found-candidate --prepare-only \
  --lost-found-source /absolute/path/to/authorized-nuni-prod \
  --output-dir /absolute/path/to/new-lost-found-candidate
python3 deploy/nuni-api/lost-found/prepare.py --verify-only \
  --checkout /absolute/path/to/new-lost-found-candidate
```

省略 `--lost-found-source` 時使用原本 repo URL。來源權限不足就會停止，不以不同來源取代、不猜測樹內容。`--verify-only` 沒有 `--checkout` 時只驗證本 repo 的綁定檔案，不代表完整 API 型別、編譯或 HTTP 驗收已完成。

對已審查的來源改動，明確執行 `prepare.py --refresh-manifest` 才更新綁定。一般重建遇到漂移就失敗。預設 build、既有 imports／security／food／assistant 候選與 composed manifest 都不因此變動。

### 測試

```sh
npm install --prefix /tmp/lost-found-tools --ignore-scripts --no-audit --no-fund \
  fastify@5.10.0 @fastify/rate-limit@11.1.0
LOST_FOUND_TEST_FASTIFY_DEPS=/tmp/lost-found-tools/node_modules \
  NODE_OPTIONS=--max-old-space-size=768 node scripts/test-platform-lost-found.mjs --embedded
python3 -m unittest discover -s scripts/platform-lost-found -p '*_test.py' -v
```

嵌入式模式使用既有鎖定依賴中的 PGlite 建立一次性資料庫，驗證真正 SQL、外鍵、交易回滾及帳號關閉觸發器；不宣稱已驗證 PostgreSQL 多連線鎖競爭。測試也以實際 Fastify／rate-limit 插件執行新路由，確認登入、方法、旗標、大小限制、CRUD 回讀及安全錯誤回應。這個隔離 HTTP host 使用合成 session，並不代表完整產品登入或真實 Google OAuth 驗收。

GitHub `Platform lost-found` workflow 使用獨立 PostgreSQL 16，對同一組案例加跑關閉帳號／登出與等待中寫入的競爭測試，完全不需要產品 secrets 或私有 API 來源。

本機 PostgreSQL 模式必須明確指定 loopback、port 與資料庫 `platform_lost_found_test`；測試只建立並清除隨機測試 schema，不讀取 `DATABASE_URL` 或替代正式連線設定。

```sh
LOST_FOUND_TEST_DATABASE_URL=postgresql://127.0.0.1:55432/platform_lost_found_test \
  node scripts/test-platform-lost-found.mjs
```

取得精確候選 checkout 並依其鎖檔安裝 API 依賴後，可另跑完整 API 的實際 HTTP 驗收：

```sh
LOST_FOUND_TEST_DATABASE_URL=postgresql://127.0.0.1:55432/platform_lost_found_test \
  node scripts/test-platform-lost-found-runtime.mjs \
  --checkout /absolute/path/to/verified-lost-found-candidate --postgres
```

這個 runner 先驗證來源 tree，使用候選的原始 `tsup.config.ts` 編譯所有 API entrypoints，再載入真正的 `createApp` 與 `createDatabase` bundle。測試使用隨機 schema、完整 migration manifest、真正的 Platform 登入／登出／關閉帳號服務；只有 Google 的 JWKS 回應及 ID token 改用本機測試金鑰。校園帳號模式保持啟用且不建立校園身分，也確認未開放路由回 404 而非讓有效 Google session 失效。它不沿用產品環境變數，PostgreSQL 仍限明確指定的 loopback 測試資料庫。

省略 `--postgres` 時使用一次性 PGlite；完整 migration manifest 比隔離模組測試需要更多記憶體。若遭環境中止，不能把它記為 HTTP 通過。本輪的實際 PostgreSQL 16.15 驗證為 81 個共用契約／SQL／隔離 HTTP 案例及 6 個完整 API HTTP 案例全部通過。完整 API bundle 可建置，新增模組也已與真正的 database／session／Fastify 型別一起通過原始嚴格編譯設定，包含 `exactOptionalPropertyTypes` 與 `noUncheckedIndexedAccess`；全 API 型別檢查遭環境 SIGKILL，仍屬正式發布前待完成項目。精確 tree、工具版本與驗證範圍記錄在 `verification.json`。

## 發布與相容回滾

此候選預設不註冊新路由；只有 `CAMPUS_PLATFORM_LOST_FOUND_ENABLED=true` 才啟用。七個確切的 POST 路徑無論旗標狀態都會略過校園身分驗證；旗標關閉時回傳 404，避免把尚未開放的功能誤判為 Google 登入過期。旗標開啟後，每個路由仍獨立驗證 Platform session；其他方法、未知 action 和多餘路徑仍保留原本的校園身分驗證。重建、檢查或本輪前端合併都不會替正式 API 設定旗標、套 migration 或授予資料庫權限。

發布前須在精確候選來源完成完整 API typecheck/build、新路由的 HTTP 驗收及既有服務回歸，記錄 immutable image digest／source tree；核對 API runtime 對新表的必要權限及帳號關閉 trigger 的刪除權限。用既有 migration runner 登記 282，不能裸跑 SQL 略過 migration manifest。新表與帳號清理需一起驗收，不能只開前端入口。

相容回滾保留相同 282 SQL manifest，在父 composed API 保留七個確切 POST 路徑的校園驗證例外，讓暫停的失物功能回傳 404；不複製或註冊失物模組，其他方法與路徑仍走原校園驗證：

```sh
python3 deploy/nuni-api/build.py --lost-found-compatible-rollback --prepare-only \
  --lost-found-source /absolute/path/to/authorized-nuni-prod \
  --output-dir /absolute/path/to/new-lost-found-rollback
```

回滾會使新失物功能暫停服務，使用者資料保留，帳號關閉觸發器仍清理新資料。不能刪表／覆寫資料庫倒退使用者操作，也不能直接回到不含 282 manifest 的舊 image。應先驗證此相容來源能在含 282 的隔離資料庫啟動，再安排正式發布。
