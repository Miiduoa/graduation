# 281 部署與相容回滾操作手冊

這是待維運執行的部署流程。2026-11-01 已完成兩個映像的遠端只建置及推送，未部署；映像檔案驗證見 [VALIDATION.md](VALIDATION.md)。本次僅發布 composed `--imports-candidate` 六檔差異（撤回過濾＋281＋型別＋餐廳文案及回歸測試），**不含安全依賴更新**；security candidate 另次發布，不是「main 全部 API 修正」。278、279、教材分頁已在正式，不重跑、不修改。保留所有既有環境設定與旗標，不需新增 secret。

## 1. 核對與建置兩個映像

所有 shell 指令均先設 `export EXPO_NO_DOTENV=1`；不得讀取或攜入 `.env`。先核對機器實際 image 與狀態，不能從 release v24 推定回滾來源。目前審查基線：`857656ef1e7798` started，`d897e35f345428` stopped；正式 digest 為 `be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2`，OCI revision 是 tree `b0a10ac814cd03fbfb45132566035acce8339f17`。若來源或拓撲變動先重新審查，勿覆蓋別人的發布。

```sh
export EXPO_NO_DOTENV=1
fly image show -a nuni-api
fly machines list -a nuni-api
mkdir -p /tmp/nuniapifix
TMPDIR=/tmp/nuniapifix python3 deploy/nuni-api/build.py --imports-candidate --prepare-only --output-dir /tmp/nuniapifix/candidate
TMPDIR=/tmp/nuniapifix python3 deploy/nuni-api/build.py --imports-compatible-rollback --prepare-only --output-dir /tmp/nuniapifix/rollback
```

候選 tree 必須等於 `composed/source.json` 的 `candidateTree`：`4c7919d6cff32789acb06e2b9f4edb180cdad3a1`。281 SHA256 必須為 `ddc7e73ecb944075fc2f0a75846e91661a2b9489a8a32cad91c95a99cc25f198`，核對候選 `apps/api/src/migrations/`、回滾 context 與 rollback manifest 三處。相容包固定 be815455 為底，278／279 原樣保留。

使用獨立的最小 build-only 設定，避免沿用 archived fly.toml 的 release hook 或拓撲。以下只在發布時執行，遠端建置並推送兩個映像，不部署：

```sh
export EXPO_NO_DOTENV=1
cat > /tmp/nuniapifix/build.fly.toml <<'TOML'
app = "nuni-api"
primary_region = "nrt"
TOML
fly deploy /tmp/nuniapifix/candidate -a nuni-api --config /tmp/nuniapifix/build.fly.toml --dockerfile apps/api/Dockerfile --remote-only --build-only --push --depot=false --image-label imports-281-candidate-fix3 --label org.opencontainers.image.revision=4c7919d6cff32789acb06e2b9f4edb180cdad3a1
fly deploy /tmp/nuniapifix/rollback -a nuni-api --config /tmp/nuniapifix/build.fly.toml --dockerfile Dockerfile --remote-only --build-only --push --depot=false --image-label imports-281-compatible-rollback-fix3 --label org.opencontainers.image.base.digest=sha256:be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2
```

本輪固定映像（2026-11-01，只建置並推送，未部署）：

- 候選：`registry.fly.io/nuni-api@sha256:962722f3ca6f6ca69f5bef3ccad456fb8c32446c96701e653a9a8022f661c26e`。
- 相容回滾：`registry.fly.io/nuni-api@sha256:b27d87ab9b2736edddd8a40e3d46f1f575e373fcfbddae121439f42e4ecf21e8`。

本輪沿用既有 `fly-builder-hidden-pond-9109`／`891263c6067008`，未新增 app、機器或 volume；明確停用 Depot。重建前必須確認既有 builder 有效；此版本工具對無效 builder 可能自動重建，不可在禁止新增資源時盲目重試。標籤可移動，部署只用上述核驗 digest。

保存兩次 builder 回傳的 immutable `registry.fly.io/nuni-api@sha256:...`，並用 registry manifest 查證 digest／平台及 OCI label；不要把 tag 當 digest。回滾包的程式 revision 沿用 base tree，另記 281 checksum，不能標成候選程式 revision。把 PR head、兩個 digest、tree、SQL checksum、建置時間及驗收證據寫入發布紀錄。浮動 `node:24-alpine` 仍屬本次既有來源限制，tree 相同不代表 runtime bytes 相同。

本輪30檔來源比對結論為原135項中118項既有、17項逾時因素、0項候選獨有回歸；逐檔與重跑證據見 [VALIDATION.md](VALIDATION.md) 及 [FAILURE-COMPARISON.md](FAILURE-COMPARISON.md)。分類完成不等於全套通過。

發布前在隔離環境完成完整 typecheck／build／API suite、PostgreSQL migration 成功與失敗原子性、相容回滾啟動及授權邊界驗收。不能以 Python／聚焦單元測試取代。映像或證據任一缺少就不進下一步。

## 2. 先 migration，再切 API

由維運在既有安全 migration 環境核對正式 manifest ID/checksum、281 是否部分建表與 ACL。不得輸出 secret、連線字串或將它們放到 CLI、本文或紀錄。既有 278／279 checksum 不變；280 屬 BFF 既有表，不加入 API manifest。

使用上節已核驗候選 digest 啟動一次性 migration 工作程序，沿用既有安全注入的正式 migrator 身分及網路／TLS 設定。入口在映像 `/app` 下為：

```sh
export EXPO_NO_DOTENV=1
node apps/api/dist/migrate.js
```

這是正式 runner 的完整 manifest 比對／補缺流程，不是裸跑單檔；已登記的 278／279 只核對，不重跑，本次應只補 281。281 的 DDL 與 manifest INSERT 在同一交易內，由 runner 提交；SQL 本身不得含 BEGIN／COMMIT。依下列步驟在一次性工作程序注入並驗證 timeout。超時或 checksum 不符即停止，不強制解鎖、不手改 manifest。確認 runner 成功退出、281 ID/checksum 一致，API 有 SELECT、BFF 有 SELECT／INSERT。不要更動 serving 機器的啟動命令來跑 migration。

### Fly 一次性 machine 入口（執行者 Miiduoa）

唯一發布路徑是固定候選內建 `migrate.js` runner 套 281；psql 僅供 DBA 保存、設定及還原專用 role timeout，不用於手動套 281。

以下為待正式窗口執行的樣板，本輪未建立 Fly machine。前置條件：既有 `nuni-api` app 安全環境已注入獨立 migrator 的 `MIGRATION_DATABASE_URL`，且有既有安全網路與 TLS 設定；不能沿用 API 共用身分。若缺少此既有注入，停止並記錄，不執行 `fly secrets set`。Miiduoa 先準備 `/tmp/nuniapifix/migration-machine.json`，由既有審查過的非敏感設定填入 TLS／受信任網路等必要 env；不得複製含 secret 的 config dump。最小設定如下，正式 TLS 值須照既有安全環境補齊，不能套用本機 disable 設定：

```json
{
  "init": { "cmd": ["node", "/opt/release/fly-migrate.mjs"] },
  "services": [],
  "mounts": [],
  "restart": { "policy": "no" },
  "env": {
    "EXPO_NO_DOTENV": "1",
    "NODE_ENV": "production",
    "DATABASE_APPLICATION_NAME": "nuni-281-migrate",
    "DATABASE_POOL_MAX": "1",
    "DATABASE_CONNECTION_TIMEOUT_MS": "5000",
    "DATABASE_STATEMENT_TIMEOUT_MS": "60000",
    "DATABASE_QUERY_TIMEOUT_MS": "70000",
    "DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS": "90000"
  }
}
```

同 app／nrt machine 使用該 app 的私網與既有 secret 注入；仍須確認 migrator DB 主機可達且 TLS 驗證配置完整，否則停止。不得設定公開 port、service、volume、schedule 或 autostart；不 clone serving，也不變更既有機器的 CMD。兩個受審查檔以 Fly file injection 放入專用 machine，必須對映像非 root 使用者唯讀；wrapper 啟動前會驗證檢查器不可寫，失敗退出 1，不會跑 DDL。無 `.env` 掛載。

```sh
export EXPO_NO_DOTENV=1
RECORD=/workspace/nuni-api-release-records/2026-11-01-281
mkdir -p "$RECORD"
sha256sum deploy/nuni-api/composed/fly-migrate.mjs deploy/nuni-api/composed/verify-migration-session.mjs > "$RECORD/runner-files.sha256"
date -u +%FT%TZ > "$RECORD/migration-start.txt"
fly machine run registry.fly.io/nuni-api@sha256:962722f3ca6f6ca69f5bef3ccad456fb8c32446c96701e653a9a8022f661c26e \
  -a nuni-api --region nrt \
  --name nuni-281-migrate-20261101 --restart no --autostart=false \
  --skip-dns-registration --detach \
  --machine-config /tmp/nuniapifix/migration-machine.json \
  --file-local /opt/release/fly-migrate.mjs=deploy/nuni-api/composed/fly-migrate.mjs \
  --file-local /opt/release/verify-migration-session.mjs=deploy/nuni-api/composed/verify-migration-session.mjs \
  > "$RECORD/machine-create.txt" 2>&1
# 從建立回應填入本次 ID；不可填 serving 或 stopped 台 ID。
MIGRATION_ID='<本次一次性 machine ID>'
fly machine wait "$MIGRATION_ID" -a nuni-api --state stopped --wait-timeout 300s
fly machine status "$MIGRATION_ID" -a nuni-api > "$RECORD/machine-status.txt"
fly logs -a nuni-api --machine "$MIGRATION_ID" --no-tail > "$RECORD/migration.log"
date -u +%FT%TZ > "$RECORD/migration-end.txt"
```

工作程序整體上限為 **300 秒**（含啟動、完整既有 manifest 核對及 281）；依據與唯讀量測收據見 [DURATION-MEASUREMENT.md](DURATION-MEASUREMENT.md)。原 60 秒是本手冊操作上限，並非 wrapper／runner 的整體計時器；不可與每條 SQL 的 `statement_timeout=60000ms` 混淆。保留 lock=5000ms、statement=60000ms、query=70000ms、idle-in-transaction=90000ms 及原 verifier 的全部檢查，不因工作總時間較長而放寬單條 SQL 限制。

wait 只表示狀態，不能當 runner 退出碼。以 stopped machine 的 exit event 及 `migration.job.exit` 的 code 核對真正退出碼；兩者均須為 0，且有 `migration.session_timeouts_verified`、`database.migrate.completed`（count=278、latest=281）。缺事件、非零、超過 300 秒未 stopped、TLS／ACL／checksum／timeout 不符都停止切換；若仍運行，僅停止本次 ID，保存事件後清理，不能以 wait 成功冒充 migration 成功。Miiduoa 在既有安全核對入口確認 manifest 281 精確 checksum 及 API SELECT／BFF SELECT、INSERT，記錄結果但不輸出連線字串。沒有完成核對不得切換。

保存日誌、退出碼、281 checksum、PR head、兩 digest、操作者與時間於 `$RECORD`，並在 PR #365 連結發布收據。DBA 還原 role timeout 後，核對 ID 確為本次工作程序再清理：

```sh
fly machine destroy "$MIGRATION_ID" -a nuni-api --force
```

只清本次 machine 及其注入檔；不刪既有 secrets、不改 serving 啟動命令。此 Fly 樣板已對本機工具 help 核對旗標，尚未於 Fly 執行；正式窗口必須保存實際事件，不能沿用本機容器結果作為正式 migration 收據。

### 一次性 timeout 注入與 runner session 核驗

runner 的 production 設定拒絕 `PGOPTIONS`、URL query 與 caller pool options；沒有 `DATABASE_LOCK_TIMEOUT_MS`。`DATABASE_QUERY_TIMEOUT_MS` 必須嚴格大於 statement timeout。以下命令在核驗映像的 `/app` 工作目錄執行，由工作程序管理器沿用既有安全注入的 DATABASE_URL／TLS，不在命令列放入憑證：

```sh
export EXPO_NO_DOTENV=1
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

下列使用本輪已核驗的完整 registry digest；不改 env、services、resources、旗標或 secrets。單 serving 台更新可能短暫不可用。

```sh
export EXPO_NO_DOTENV=1
fly machine update 857656ef1e7798 -a nuni-api --image registry.fly.io/nuni-api@sha256:962722f3ca6f6ca69f5bef3ccad456fb8c32446c96701e653a9a8022f661c26e --yes
fly machine update d897e35f345428 -a nuni-api --image registry.fly.io/nuni-api@sha256:962722f3ca6f6ca69f5bef3ccad456fb8c32446c96701e653a9a8022f661c26e --skip-start --yes
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

### 切換後 15 分鐘觀察與回滾觸發

Miiduoa 切換前保存相同 API 路由範圍最近 15 分鐘的請求數、5xx 比例及 p95 延遲作基線；切換後連續觀察至少 15 分鐘，每分鐘保存累積與最近 5 分鐘視窗的數字至上述 `$RECORD/observation.csv`，包含 UTC、digest、總請求、5xx、比例、p95 毫秒及 ready 結果。排除 health 流量，分母為相同 API 路由的全部請求；由既有監控查詢，不改 serving 設定。

- 每 30 秒探測 live／ready。連續兩次非 200、DB verify／manifest 或 ACL 錯誤、程序反覆退出，立即停止後續發布並切相容回滾。
- 最近 5 分鐘至少 100 請求時，5xx 比例超過 1% 且高於基線 0.5 個百分點，連續兩次每分鐘取樣即回滾；任意 1 分鐘達 5 筆 5xx，立即回滾。
- 最近 5 分鐘 p95 超過 1000ms 且超過基線 2 倍，連續三次每分鐘取樣即回滾；任意 1 分鐘 p95 超過 3000ms 即回滾。基線為零或無樣本時以 1000ms 絕對門檻處理。
- 真實登入／舊 session 失敗、撤回讀取失敗，立即停止後續發布並回滾；跨學生／非成員越權立即限制受影響入口並停止發布，使用相容映像後仍須重驗隔離，不能只靠回滾當成修復。
- 流量不足 100 筆／5分鐘時，15 分鐘內每 30 秒補一次授權合成帳號唯讀抽查，要求全部成功、p95 ≤1000ms；既有監控不可用、無法取得路由基線或無合成帳號，就不放行後續前端發布，保留窗口並記缺口。達到回滾條件即執行，不等待滿 15 分鐘。

## 5. 緊急相容回滾：DB 不倒退

風險紀錄：維護者 Miiduoa 於 2026-11-01 決定接受此緊急風險：舊 API 不理解撤回，已撤回的**本人繳交版本可能重新對其授課老師（含共同授課者）顯示，也可能再次被回饋**。此接受僅限上述關係；不接受其他學生／非成員存取。向驗收與支援人員記錄風險及回退時段，優先另備保留過濾的修復版。

281 已登記後，使用事前核驗的「be815455＋同 checksum 281 SQL」相容映像，禁止直接回原 be815455 或用 release v24：

```sh
export EXPO_NO_DOTENV=1
fly machine update 857656ef1e7798 -a nuni-api --image registry.fly.io/nuni-api@sha256:b27d87ab9b2736edddd8a40e3d46f1f575e373fcfbddae121439f42e4ecf21e8 --yes
fly machine update d897e35f345428 -a nuni-api --image registry.fly.io/nuni-api@sha256:b27d87ab9b2736edddd8a40e3d46f1f575e373fcfbddae121439f42e4ecf21e8 --skip-start --yes
fly machines list -a nuni-api
fly image show -a nuni-api
```

重做 live／ready、登入、授權邊界與既有功能驗收，確認 stopped 台仍未啟動。保留 DB 新表、撤回紀錄、附件及冪等資料；不執行 280／281 rollback SQL、不刪 schema_migrations、不移除 278／279 triggers。2026-11-01 已以兩個固定 digest、原始 CMD、獨立非超級使用者及隔離 PostgreSQL 完成 live／ready、預建 session、跨學生／非成員 HTTP 與候選→相容回滾演練，見 [CONTAINER-ACCEPTANCE.md](CONTAINER-ACCEPTANCE.md)。真實 Google 登入、正式 ACL 與正式觀察仍未驗，不能當成正式發布完成。

發布記錄及必要證據移出暫存後，只清理本次 `/tmp/nuniapifix`；不要清其他工作目錄、停止別人的程序。磁碟低於 3GB 即停止並記錄進度。

## 6. 安全依賴另案追蹤

既有 P1 尚未技術性解除；本 PR 不升級依賴、不修改 lockfile 或 Dockerfile。追蹤基準為 `docs/security/2026-10-24-remediation.md` 及 `deploy/nuni-api/security/source.json`，追蹤 issue 為 [nuni-api 依賴安全更新 #370](https://github.com/Miiduoa/graduation/issues/370)，負責人 Miiduoa，期限 2026-11-08。暫時措施：此候選不新增暴露面，僅沿用正式映像既有依賴。維護者 Miiduoa 於 2026-11-01 決定：「維護者接受此候選沿用既有依賴上線，期限內另案升級」。13 個 GHSA／18 條 high 的套件清單與連結已列於 issue（Fastify、Zod、fast-uri 兩版、@grpc/grpc-js、brace-expansion）。由 Miiduoa 在後續安全修補 PR 引用該 issue 及本 PR #365，列出各套件／Node 基底的修正版本、固定來源與 digest、掃描結果、完整 API 回歸及 281 manifest／撤回過濾的整合證據。追蹤 issue、負責人、期限及候選風險決定已登錄；後續修補 PR 與驗收仍須回填 issue／#365，未修復不得宣稱安全修補已結案。本機驗證通過不代表安全 P1 已關閉。
