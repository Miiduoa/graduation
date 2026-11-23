# 平台帳號關閉後清除 TronClass 資料

本目錄提供 **尚未部署的 SQL 候選**。Web 的 server-only worker 已接入 `instrumentation.register()`，預設不啟用；不會在啟動或 HTTP request 中建立資料表、套用 migration，亦沒有讓 HTTP caller 指定 owner 的清理端點。外部 nuni-api 的正式 source、migration manifest 及 image 未由本目錄修改。

## 事件與清除流程

`platform_accounts` 的 `state` 改為 `closed`／`deleted`，或帳號硬刪除時，PostgreSQL trigger 在**同一交易**建立 outbox 事件。交易 rollback 不會留下事件；未 commit 的事件不能被 worker 領取。migration 也會將資料庫中明確已是 closed／deleted 的列放入 outbox。暫停帳號不觸發清除。

事件只包含經平台帳號列確認的 account ID、原因與重試／租約資訊，不包含學校帳號、密碼、cookie、作業或檔案。outbox 刻意沒有指向帳號的外鍵，讓硬刪帳號後仍保留可處理的關帳證據。每個 account ID 同時至多一筆待處理事件。

worker 用 `FOR UPDATE SKIP LOCKED` 與隨機 lease token 原子領取事件，再呼叫既有 `backend/functions/tronClassAccountLifecycle.js` 的 `closeTronClassOwner()`。該 hook 先建立永久、無憑證的 Firestore 關帳 barrier，才清除本人操作與登入資料；可能已送出的校方作業鎖保留匿名阻擋狀態，不因關帳解除防重送。

只有 hook 成功後，worker 才以原事件 ID **及相同 lease token** 刪除 outbox 列，同時移除已無用途的 platform ID。沒有無限期保留帳號 ID 的 completed 表。若程序在 Firestore 清完、SQL 刪除前中斷，租約到期後會重試同一個冪等 hook。關帳與後續硬刪除可能產生兩次合法事件；重複清理同一 owner 仍安全。

本流程不掃描所有 Firestore owner，不因查不到平台帳號就推論已關帳。**migration 前已硬刪，且沒有可追溯關帳事件的帳號，不能由本流程猜測處理**；這類歷史資料仍需平台的權威關帳紀錄。

## 明確啟用及執行時設定

只讀取以下兩項專用設定：

```dotenv
TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED=true
TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL=postgresql://<dedicated-worker-role>:<secret>@<nuni-postgres>/<database>
```

必須同時明確設定，且 Next.js 執行於 Node runtime；不接受 `TRUE`／`1` 等替代旗標。**不會 fallback 到 `DATABASE_URL`、`ASSIGNMENT_FILE_DATABASE_URL` 或 `PLATFORM_ASSISTANT_DATABASE_URL`。** 不使用瀏覽器輸入的連線字串，不把連線設定或原始例外寫入 log。

`ENABLED=true` 但 URL 缺少／格式錯誤時，不建立連線，並發出固定的設定錯誤訊息；其他初始化及執行失敗也只有固定訊息。應由既有 server log／錯誤監控監看這些訊息與待處理事件數，不公開事件內容。

- 啟動後 0–5 秒首次檢查，此後每次完成再等待 60–65 秒，單一程序不重疊執行。
- 每輪預設至多 10 件，程式允許的上限為 20 件。
- 租約 5 分鐘；程序中斷後其他 instance 可在租約到期重新領取。
- 清理失敗保留事件，只存固定 `cleanup_failed`，退避從 30 秒倍增，最高 30 分鐘。
- 專用 PostgreSQL pool 最多 2 條連線，連線逾時 5 秒、client query 與 server `statement_timeout` 均為 10 秒。server 會取消逾時 SQL，失敗的 pool client 會被移除；不使用只有停止等待、卻讓 SQL 無期限執行的 `Promise.race`。
- SQL 故障不刪除事件；若尚持有租約，留待到期恢復。舊 lease token 不能完成或延後新 worker 領取的事件。

私人檔案清理、平台關帳清理、TronClass retention 各自在獨立 `try/catch` 啟動；其中一個初始化失敗不阻擋另外兩個。此 worker 不依賴 Firestore TTL，也不假設已開啟需要帳務支援的 TTL delete。

## Schema、角色與最小權限

SQL 以 nuni PostgreSQL 既有的 `platform_accounts(id, state)` 為來源。正式部署使用受信任角色擁有的 `public` schema；一般 API 與 worker 角色不得在此 schema 建立／替換資料表、function 或 trigger。測試使用隨機獨立 schema，與正式資料完全分開。

trigger function 使用 `SECURITY DEFINER`、固定 `search_path = pg_catalog, pg_temp`，並以 `TG_TABLE_SCHEMA` 明確限定 outbox 表名。建立 function 與 `REVOKE ... FROM PUBLIC` 必須包含在同一 migration 交易，不能把中間狀態對其他連線開放。worker／一般 API role 不取得該 function 的直接 EXECUTE 權限；trigger 在帳號交易內執行。

**worker 必須使用專用的非 owner、非 superuser 角色**，不能有 `CREATEDB`、`CREATEROLE` 或 schema `CREATE`，不能繼承具有上述權限的角色。依平台的憑證管理流程配置登入角色與 DB CONNECT；不要將真實密碼加入此檔案。對已建立的角色，最小物件權限為：

```sql
GRANT USAGE ON SCHEMA public TO tronclass_closure_worker;
GRANT SELECT, DELETE ON public.tronclass_account_closure_outbox TO tronclass_closure_worker;
GRANT UPDATE (attempts, next_attempt_at, lease_token, lease_expires_at, last_failure)
  ON public.tronclass_account_closure_outbox TO tronclass_closure_worker;
```

worker 不需要 `platform_accounts` 的 SELECT、UPDATE 或 DELETE；**不可授予 outbox INSERT、修改 `platform_account_id`／`id`／`reason`，或 sequence 使用權**。正常 worker SQL 只刪除自己持有 token 的事件。專用 pool 固定連線 search path 為 `pg_catalog, public, pg_temp`；禁止一般角色在這些受信任 schema 建立物件。專用 URL 必須指定角色，允許 TLS 參數；拒絕 `options`、`statement_timeout`、`query_timeout`、`connectionTimeoutMillis`、`connect_timeout` 等可能覆寫 trusted schema／逾時設定的參數。

平台既有關帳 API role 仍只操作經驗證帳號的 `platform_accounts`，不直接寫 outbox，也不取得 outbox SELECT／INSERT。trigger 的受信任 owner 必須能寫入 outbox 與 identity sequence。migration role 負責建表、function、trigger 與授權，相關能力不交給 Web worker。

## 發布順序

1. 核對實際 nuni-api immutable image、來源 tree、`platform_accounts` schema、account ID 格式與已套用 migration。`001` 是本目錄候選檔名，不是已登錄的外部 API migration 編號。
2. 將 SQL 整合進**該實際來源**的既有 migration runner，分配正確新編號、登錄 checksum，驗證完整 image 及既有 API 回歸。不可直接用舊候選來源覆蓋正式 API，也不可讓 Web 裸跑 SQL 規避 manifest。
3. 以受信任 schema/search path，在同一 migration 交易套用候選及 PUBLIC 撤權，核對 trigger、歷史 closed/deleted 事件與最小角色權限。正常 API role 必須能關帳，但不能直接建立任意清理事件。
4. 先保持 worker 旗標關閉發布相容 Web；migration 與專用角色驗收完成後，再設定專用 DB URL 及精確啟用旗標，重啟 Node instance。
5. 以受控平台帳號驗證關帳事件、Firestore barrier／私人紀錄清理、outbox 成功刪除及故障後重試。此驗收不需要寫入校方作業。

Web 端平台帳號的新綁定會檢查 worker 旗標與專用 DB URL 皆已設定，否則回覆 `TRONCLASS_RETENTION_REQUIRED` 且不保存校方 session；因此步驟 4 的 migration 驗收完成前，平台帳號無法新綁定。

回滾 worker 時可關閉旗標並保留 outbox／trigger，事件會等待恢復；不能刪除 Firestore 永久關帳 barrier 或不確定的校方作業鎖。

## 隔離測試

測試只接受明確 `NUNI_TEST_POSTGRES_PORT`，固定連到 `127.0.0.1`、測試帳號 `box`、資料庫 `postgres`、合成測試密碼；不讀取任何產品 DB URL。每次使用隨機 schema 和測試角色，完成後刪除。

```sh
NUNI_TEST_POSTGRES_PORT=<disposable-loopback-port> \
  pnpm --filter web exec vitest run \
  src/lib/server/tronClassPlatformClosure.postgres.test.ts
```

SQL 只使用 PostgreSQL 15 已支援的功能；CI Web Tests 的 PostgreSQL 15 service 可直接執行。測試涵蓋真正的 trigger、transaction rollback、硬刪後事件存活、worker 故障退避、程序重建、雙連線競爭、租約到期／舊 token、最低 ACL 及完成後移除 platform ID。worker／scheduler 與 `instrumentation` 另有單元與接線回歸。
