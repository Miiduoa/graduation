# 281 部署與相容回滾操作手冊

這是待維運執行的流程，本文未代表已建映像或部署。本次僅發布 composed `--imports-candidate` 六檔差異（撤回過濾＋281＋型別＋餐廳文案及回歸測試），**不含安全依賴更新**；security candidate 另次發布，不是「main 全部 API 修正」。278、279、教材分頁已在正式，不重跑、不修改。保留所有既有環境設定與旗標，不需新增 secret。

## 1. 核對與建置兩個映像

先核對機器實際 image 與狀態，不能從 release v24 推定回滾來源。目前審查基線：`857656ef1e7798` started，`d897e35f345428` stopped；正式 digest 為 `be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2`，OCI revision 是 tree `b0a10ac814cd03fbfb45132566035acce8339f17`。若來源或拓撲變動先重新審查，勿覆蓋別人的發布。

```sh
fly image show -a nuni-api
fly machines list -a nuni-api
mkdir -p /tmp/nuniapifix
TMPDIR=/tmp/nuniapifix python3 deploy/nuni-api/build.py --imports-candidate --prepare-only --output-dir /tmp/nuniapifix/candidate
TMPDIR=/tmp/nuniapifix python3 deploy/nuni-api/build.py --imports-compatible-rollback --prepare-only --output-dir /tmp/nuniapifix/rollback
```

候選 tree 必須等於 `composed/source.json` 的 `candidateTree`：`4c7919d6cff32789acb06e2b9f4edb180cdad3a1`。281 SHA256 必須為 `ddc7e73ecb944075fc2f0a75846e91661a2b9489a8a32cad91c95a99cc25f198`，核對候選 `apps/api/src/migrations/`、回滾 context 與 rollback manifest 三處。相容包固定 be815455 為底，278／279 原樣保留。

使用獨立的最小 build-only 設定，避免沿用 archived fly.toml 的 release hook 或拓撲。以下只在發布時執行，遠端建置並推送兩個映像，不部署：

```sh
cat > /tmp/nuniapifix/build.fly.toml <<'TOML'
app = "nuni-api"
primary_region = "nrt"
TOML
fly deploy /tmp/nuniapifix/candidate -a nuni-api --config /tmp/nuniapifix/build.fly.toml --dockerfile apps/api/Dockerfile --remote-only --build-only --push --image-label imports-281-candidate --label org.opencontainers.image.revision=4c7919d6cff32789acb06e2b9f4edb180cdad3a1
fly deploy /tmp/nuniapifix/rollback -a nuni-api --config /tmp/nuniapifix/build.fly.toml --dockerfile Dockerfile --remote-only --build-only --push --image-label imports-281-compatible-rollback --label org.opencontainers.image.base.digest=sha256:be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2
```

保存兩次 builder 回傳的 immutable `registry.fly.io/nuni-api@sha256:...`，並用 registry manifest 查證 digest／平台及 OCI label；不要把 tag 當 digest。回滾包的程式 revision 沿用 base tree，另記 281 checksum，不能標成候選程式 revision。把 PR head、兩個 digest、tree、SQL checksum、建置時間及驗收證據寫入發布紀錄。浮動 `node:24-alpine` 仍屬本次既有來源限制，tree 相同不代表 runtime bytes 相同。

發布前在隔離環境完成完整 typecheck／build／API suite、PostgreSQL migration 成功與失敗原子性、相容回滾啟動及授權邊界驗收。不能以 Python／聚焦單元測試取代。映像或證據任一缺少就不進下一步。

## 2. 先 migration，再切 API

由維運在既有安全 migration 環境核對正式 manifest ID/checksum、281 是否部分建表與 ACL。不得輸出 secret、連線字串或將它們放到 CLI、本文或紀錄。既有 278／279 checksum 不變；280 屬 BFF 既有表，不加入 API manifest。

使用上節已核驗候選 digest 啟動一次性 migration 工作程序，沿用既有安全注入的正式 migrator 身分及網路／TLS 設定。入口在映像 `/app` 下為：

```sh
node apps/api/dist/migrate.js
```

這是正式 runner 的完整 manifest 比對／補缺流程，不是裸跑單檔；已登記的 278／279 只核對，不重跑，本次應只補 281。281 的 DDL 與 manifest INSERT 在同一交易內，由 runner 提交；SQL 本身不得含 BEGIN／COMMIT。依下列步驟在一次性工作程序注入並驗證 timeout。超時或 checksum 不符即停止，不強制解鎖、不手改 manifest。確認 runner 成功退出、281 ID/checksum 一致，API 有 SELECT、BFF 有 SELECT／INSERT。不要更動 serving 機器的啟動命令來跑 migration。

### 一次性 timeout 注入與 runner session 核驗

runner 的 production 設定拒絕 `PGOPTIONS`、URL query 與 caller pool options；沒有 `DATABASE_LOCK_TIMEOUT_MS`。`DATABASE_QUERY_TIMEOUT_MS` 必須嚴格大於 statement timeout。以下命令在核驗映像的 `/app` 工作目錄執行，由工作程序管理器沿用既有安全注入的 DATABASE_URL／TLS，不在命令列放入憑證：

```sh
EXPO_NO_DOTENV=1 NODE_ENV=production \
DATABASE_APPLICATION_NAME=nuni-281-migrate \
DATABASE_POOL_MAX=1 \
DATABASE_CONNECTION_TIMEOUT_MS=5000 \
DATABASE_STATEMENT_TIMEOUT_MS=60000 \
DATABASE_QUERY_TIMEOUT_MS=70000 \
DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS=90000 \
node --import /opt/release/verify-migration-session.mjs apps/api/dist/migrate.js
# 工作程序管理器須保存真正的退出碼；非 0 不切 API。
```

此 runner 仍會嘗試載入 `/app/.env`；`EXPO_NO_DOTENV=1` 不會關閉它的 dotenv 呼叫。核驗映像本身不帶 `.env`，工作程序也不得掛入或複製 `.env`，只使用既有安全環境注入。

`verify-migration-session.mjs` 使用本目錄受審查檔案，唯讀掛入工作程序的 `/opt/release/`；它從 `/app/apps/api/dist/migrate.js` 解析映像固定的 pg 套件。在 runner 同一個 client 的 BEGIN 之後、DDL 之前查 `pg_settings`，要求 lock=5000ms、statement=60000ms、idle-in-transaction=90000ms；不符會拋錯並由 runner ROLLBACK。保存 `migration.session_timeouts_verified` 與 `database.migrate.completed`，缺少核驗事件也不得放行。這個檢查器只供上述固定 timeout 演練／發布工作程序使用，不掛入 API。

lock timeout 使用**未與 API 共用的專用 migrator 登入角色**，由 DBA 在啟動工作程序前設定 role/database default。以下 `nuni_migrator`／`nuni_database` 是需替換的識別字，操作走既有安全管理連線：

```sql
-- 先保存原始 setconfig（只保存 lock_timeout 項，勿輸出其他可能敏感的設定）。
SELECT option FROM pg_db_role_setting s
JOIN pg_roles r ON r.oid = s.setrole
JOIN pg_database d ON d.oid = s.setdatabase
CROSS JOIN LATERAL unnest(s.setconfig) AS option
WHERE r.rolname = 'nuni_migrator' AND d.datname = 'nuni_database'
  AND option LIKE 'lock_timeout=%';
ALTER ROLE nuni_migrator IN DATABASE nuni_database SET lock_timeout = '5s';
```

先確認角色沒有其他使用者／工作程序，並記錄原值與還原 SQL。設定只在**新連線**生效，所以之後才建立一次性 runner；不要在另一個 psql session 執行 SET 期待 runner 繼承。runner 的實際 session 核驗事件才是生效證據。不得改 API 共用角色或整個 database default；若無獨立角色，先由維運準備所需最小 migration 權限，未準備好就停止。

不論工作程序成功或失敗，在它完全退出、連線關閉後還原：原先沒有該 role/database lock_timeout 項時執行下面 RESET；有原值時改用保存的 `ALTER ROLE ... SET lock_timeout = '<原值>'`。再查同一筆 catalog 確認與原值相同。移除本次工作程序及唯讀掛載，保存退出碼和安全日誌；不移除既有安全設定或停止 serving 程序。

```sql
ALTER ROLE nuni_migrator IN DATABASE nuni_database RESET lock_timeout;
```

本機演練可透過獨立 PostgreSQL role/database 重現以上設定；本機 loopback 無 TLS 僅搭配 `DATABASE_TLS_MODE=disable DATABASE_TRUSTED_SIDECAR=true`，不可抄成正式遠端 DB 設定。詳細結果見本目錄 [VALIDATION.md](VALIDATION.md)，完整 suite 合併數量見 PR #365 發布驗證紀錄。

281 登記後舊 API 重啟會因精確 manifest 不符而失敗；安排單 serving 切換窗口，migration 成功後立即切換，失敗時使用已驗證的相容回滾包。不要先啟動停機台，也不要套歷史 release migration hook。

## 3. 更新兩台既有機器

將下列 placeholder 換成已核驗並保存的完整 registry digest；不改 env、services、resources、旗標或 secrets。單 serving 台更新可能短暫不可用。

```sh
fly machine update 857656ef1e7798 -a nuni-api --image registry.fly.io/nuni-api@sha256:<VERIFIED_CANDIDATE_DIGEST> --yes
fly machine update d897e35f345428 -a nuni-api --image registry.fly.io/nuni-api@sha256:<VERIFIED_CANDIDATE_DIGEST> --skip-start --yes
fly machines list -a nuni-api
fly image show -a nuni-api
```

確認兩台 digest 一致，第一台 healthy、第二台仍 stopped；health 不提供 revision，不能單靠 health 判版。

## 4. 上線驗收

- `GET /health/live`：200 ok；多次 `GET /health/ready`：200 ready、database reachable、Google ready。觀察 5xx、DB verify／ACL 錯誤、延遲與記憶體；無法 ready、持續 5xx 或授權越界即停止後續 Web／App 發布並處置回滾。
- `GET /v1/auth/platform/providers`；由授權驗收者以真實 Google 流程 `POST /v1/auth/platform/sessions`，再 `GET /v1/auth/platform/sessions/current`；舊 session 可用、登出後拒絕。未登入 401 不算正向驗收。
- 學生 `GET /v1/auth/platform/class-workspaces/:id/assignments` 與單筆回執、老師 `GET .../:id/assignments/:assignmentId/submissions`：未撤回可見、撤回不可見、重新繳交可見。老師對撤回版本回饋及原鍵重播拒絕；包含微秒時間 fixture、跨學生及非成員拒絕。寫入只用授權合成帳號。
- `GET .../:id/materials`、`GET .../:id/materials/page` 保持既有行為；隔離資料超過 50 筆驗證無重漏及跨課游標拒絕。正式資料不足就記限制，不擅自新增教材。
- `GET /v1/public/schools/pu/cafeterias` 正常，核對文案，點餐保持既有關閉。以授權合成帳號抽查 course-access match／requests 與 personal-imports/read，確認既有路由無退化。
- 最後才發布依賴撤回過濾的 Web／App／BFF，驗附件上傳下載、撤回、重繳、截止邊界與失敗重試；不可只靠附件開關推定平台 API 讀取受保護。

## 5. 緊急相容回滾：DB 不倒退

負責人已接受此緊急風險：舊 API 不理解撤回，已撤回的**本人繳交版本可能重新對其授課老師（含共同授課者）顯示，也可能再次被回饋**。此接受僅限上述關係；不接受其他學生／非成員存取。向驗收與支援人員記錄風險及回退時段，優先另備保留過濾的修復版。

281 已登記後，使用事前核驗的「be815455＋同 checksum 281 SQL」相容映像，禁止直接回原 be815455 或用 release v24：

```sh
fly machine update 857656ef1e7798 -a nuni-api --image registry.fly.io/nuni-api@sha256:<VERIFIED_COMPATIBLE_ROLLBACK_DIGEST> --yes
fly machine update d897e35f345428 -a nuni-api --image registry.fly.io/nuni-api@sha256:<VERIFIED_COMPATIBLE_ROLLBACK_DIGEST> --skip-start --yes
fly machines list -a nuni-api
fly image show -a nuni-api
```

重做 live／ready、登入、授權邊界與既有功能驗收，確認 stopped 台仍未啟動。保留 DB 新表、撤回紀錄、附件及冪等資料；不執行 280／281 rollback SQL、不刪 schema_migrations、不移除 278／279 triggers。兩個映像目前尚未建置，沒有可填寫的已驗證 digest。

發布記錄及必要證據移出暫存後，只清理本次 `/tmp/nuniapifix`；不要清其他工作目錄、停止別人的程序。磁碟低於 3GB 即停止並記錄進度。

## 6. 安全依賴另案追蹤

既有 P1 尚未技術性解除；本 PR 不升級依賴、不修改 lockfile 或 Dockerfile。追蹤基準為 `docs/security/2026-10-24-remediation.md` 及 `deploy/nuni-api/security/source.json`，由 Miiduoa 在後續安全修補 PR 引用本 PR #365，列出各套件／Node 基底的修正版本、固定來源與 digest、掃描結果、完整 API 回歸及 281 manifest／撤回過濾的整合證據。後續 PR 連結、負責人、預計日期與未修風險處置必須登錄於 #365 發布紀錄；未有連結／日期不得宣稱追蹤或修補已結案。發布前由負責人明確記錄先發布本候選的風險決定；本機驗證通過不代表安全 P1 已關閉。
