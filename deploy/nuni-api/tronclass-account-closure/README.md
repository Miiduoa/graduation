# 官方 284：TronClass 平台帳號關閉 outbox

本目錄把已審查的候選 SQL 封成 nuni-api 官方 migration `284_tronclass_account_closure_outbox`。內容與審查候選位元組相同（SHA-256 `9c5057739cf89222bc69ee2bcbfffbf74b0705d522d4478f75fc01a2d826381a`）。**本輪不連正式庫、不跑 migration、不部署、不開 worker、不建 `tronclass_closure_worker`、不補 GRANT。** 旗標維持關閉。

graduation 因 `pnpm-workspace.yaml` 的 `apps/*` 不能放 nuni-api 套件。權威 SQL 在本檔 `284_tronclass_account_closure_outbox.sql`；`prepare.py` 只把它寫進授權生產 API checkout 的 `apps/api/src/migrations/284_tronclass_account_closure_outbox.sql`。映像 build 再抄到 `dist/migrations/`。禁止任何 `001_…` 檔名進入該目錄。

`inputTree` 必須是現況正式 tree `2e7cc189…`，不可用舊 283 候選 `2d7a325c5d4cd185d0ba32c6603a1e703684199b`。

## 建置候選與相容回滾

```sh
python3 deploy/nuni-api/tronclass-account-closure/prepare.py --verify-only
python3 deploy/nuni-api/build.py --tronclass-account-closure-candidate \
  --tronclass-account-closure-source /absolute/path/to/authorized-production-api \
  --prepare-only --output-dir /tmp/new-tronclass-closure-context
```

授權來源的 `git write-tree` 必須以 `2e7cc189` 開頭。省略來源、或來源是 283 候選 tree，都會失敗。

相容回滾映像**不要**用 `deploy/nuni-api/composed/Dockerfile.rollback`（那是過期 digest `be815455`＋278／279／281）。改用本目錄 `Dockerfile.rollback`：以現況正式 `nuni-api` digest 為 `FROM`，只 COPY 284 SQL。建置時提供 64 位 hex digest（不要 `sha256:` 前綴）：

```sh
export NUNI_API_PRODUCTION_DIGEST=<現況正式映像 64 hex>
python3 deploy/nuni-api/build.py --tronclass-account-closure-compatible-rollback \
  --prepare-only --output-dir /tmp/new-tronclass-closure-rollback
# 實際 docker build 時同一支 Dockerfile 只 COPY 284；digest 由 NUNI_API_PRODUCTION_DIGEST 注入。
```

284 只加 SQL，候選（現況 tree＋284）與相容回滾（現況 digest＋COPY 284）對 runner 等價。發布時仍建議用「FROM 現況 digest COPY 284」，避免重建時浮動 base。

## 套用前核對（必須為 0）

帳號 ID 必須符合 outbox CHECK。不符的列會讓 backfill 整筆失敗並回滾：

```sql
SELECT count(*) AS invalid_platform_account_ids
FROM public.platform_accounts
WHERE id !~ '^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
-- 必須為 0，否則停止。

SELECT id FROM public.schema_migrations ORDER BY applied_at DESC LIMIT 1;
-- 必須為 283_platform_assistant_permissions。
```

## Neon pre-284 備份

在 **migrate 之前**對正式庫建立 Neon branch（名稱例如 `pre-284-tronclass-outbox`）當還原點。不要在該 branch 上當正式套用。本包裝不建立、不連線該 branch。

## Fly one-off（nrt）

唯一套用路徑是候選／相容回滾映像內的 runner，不是 psql、不是 Web。nrt 開一次性 machine：

```sh
export EXPO_NO_DOTENV=1
# init.cmd: ["node", "/opt/release/fly-migrate.mjs"]
# 注入 deploy/nuni-api/composed/fly-migrate.mjs 與 verify-migration-session.mjs
# env: lock 5s、statement 60s、query 70s、idle-in-tx 90s；DATABASE_POOL_MAX=1
fly machine wait "$MIGRATION_ID" -a nuni-api --state stopped --wait-timeout 300s
```

工作程序上限 **300s**。成功必須同時具備：

- `migration.session_timeouts_verified`
- `database.migrate.completed`
- latest = `284_tronclass_account_closure_outbox`
- checksum = `9c5057739cf89222bc69ee2bcbfffbf74b0705d522d4478f75fc01a2d826381a`

缺事件、非零退出、逾時或 checksum 不符：不切 serving，只停本次 machine。

## 立刻切映像

284 一登記，舊映像重啟會因 manifest 不符而失敗。migration 成功後立刻把 nuni-api serving 切到含 284 的 digest；失敗則不要切。

## 相容回滾映像用法

緊急回滾切到「現況正式 digest + 同一份 284 SQL」的相容映像。資料庫**不倒退**、不刪 `schema_migrations`、不 DROP outbox／trigger。不可切回不認識 284 的舊映像。

## 本輪明確不做

- 不設 `TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED`、不設專用 DB URL
- 不 `CREATE ROLE tronclass_closure_worker`
- 不 GRANT outbox 給任何 API／BFF／worker 角色
- 不啟用 Web worker

Trigger 仍會在關帳／刪帳時寫 outbox；事件會等待之後另一步才開的 worker。誤開 worker 且沒有 GRANT 時，就緒檢查會失敗並關閉，不會清資料。
