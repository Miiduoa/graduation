# nuni-prod Neon 免費 project 搬遷計畫（2026-10-22）

準備文件，**不是執行紀錄**。這次沒有正式庫密碼，沒有連 `nuni-prod`、沒有部署、沒有改 Fly secrets。實際切換由維護者在另一台機器執行。

決定：晩瑋不升級付費，搬到同一 Neon 帳號新開的免費 project（PG 18、ap-southeast-1、db `neondb`）。正式 QA 測試資料同意清掉。Granola 會議紀錄目前無法讀（帳號未授權），以下依 repo、用量調查、CLEANUP 清單與早上 schema 備份。

## 現況（repo 對過）

| 連線 | App | 變數 | 碰哪 |
| --- | --- | --- | --- |
| 幾乎全部讀寫 | Fly `nuni-api`（`api.nuni.tw`） | `DATABASE_URL` | Neon `neondb`。啟動會核對 `schema_migrations` checksum（`migrate.ts`／`database-deployment-contract.mjs`），並做 role readiness（`database-role-readiness.ts`：`has_table_privilege`）。`/health/live` 不碰 DB；`/health/ready` 會 `SELECT 1`。機器 `min_machines_running=1`、`auto_stop=false`，health 每 15 秒打 live。 |
| 作業檔索引 | Fly `nuni-web`（`nuni.tw`） | `ASSIGNMENT_FILE_DATABASE_URL`，正式未設時才退回 `DATABASE_URL` | 同一套庫的 `class_assignment_submission_files`／`class_assignment_file_idempotency`。pool `max: 4`。Blob 在 Supabase bucket `assignment-submissions`，**不是** Neon。`/health/live`、`/health/ready` 都不碰 DB。 |
| 課班／登入／社群／點餐 | `nuni-web` BFF | `NUNI_API_BASE_URL=https://api.nuni.tw` | HTTP 到 nuni-api，不直連 Postgres。 |
| 公告、Functions | Fly `nuni-functions` | 無 DATABASE_URL | Firestore。用量調查時 0 台、suspended。停寫時仍要看一眼，確認沒被重開。 |
| GitHub Actions | — | 無正式 `DATABASE_URL` secret | `.github/workflows` 只有 loopback 測試庫（`127.0.0.1`／`localhost`）。不連正式庫。 |
| Render `nuni-staging-api`／`nuni-staging-web` | 可疑寫入來源 | 本機 env 曾指向**同一個正式 host** | 用量調查建議先 Suspend。沒有 Render 權限，執行前要在後台確認。 |
| nuni-api 進程內 worker | 隨 `nuni-api` | 同一 `DATABASE_URL` | `outbox-worker`、`food-expiry-worker`、`notification-delivery-worker` 等與 API 同機。停 nuni-api 就停。 |

遷移紀錄表：

```sql
CREATE TABLE public.schema_migrations (
  id text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

API 映像內嵌的 SQL 檔 checksum 必須與這張表一致，否則**重啟會失敗**（先前 275／276 之後舊映像不能單獨回來，就是這個機制）。早上的 schema dump 是 `--schema-only`、`Owner: -`、沒有 GRANT、沒有 extension、沒有資料，**不能拿來當正式還原檔**。正式匯出必須在停寫之後用下面的 `01-export.sh`。

早上 dump 檔名寫 before-280；用量調查記錄 11:10 dump、隨後 280 建表。正式庫現在應已有 `class_assignment_submission_files`。還原後若缺這兩張表，套用 `deploy/nuni-api/assignment-files/280_assignment_submission_files.sql`（`IF NOT EXISTS`，可重跑）。

角色：用量調查寫正式連線是 `neondb_owner`。這是 **Neon 專案內建名稱**，新 project 也會有同名角色，但**不是同一個角色、密碼必須重設**。API 是否另有 runtime role，這份 schema dump 看不出來；執行當日要先唯讀 `pg_roles` 與 `information_schema.role_table_grants`。不要假設存在 `nuni_api` 這類名稱。

## 0. 切換前（可提前做，幾乎不燒舊庫 CU）

1. Neon console 開新免費 project：PG **18**、region **ap-southeast-1**、db `neondb`。立刻在 console 把 `neondb_owner` **換成新密碼**。建議另建 `nuni_web_files`（LOGIN，只能碰作業檔三張表＋外鍵需要的 SELECT），nuni-web 不要繼續用 owner。
2. 記下直連 host（`ep-….ap-southeast-1.aws.neon.tech`）與 pooler host（`ep-…-pooler.…`）。**Fly 用直連 + `sslmode=require`**。Pooler（PgBouncer transaction mode）跟 node-pg 的 prepared statement／連線期 SET 不相容，nuni-api 啟動檢查也比較像 session 行為。
3. Render：確認並 Suspend `nuni-staging-api`／`nuni-staging-web`。沒暫停的話，切換後它仍拿舊密碼打舊 host，或被改成新 host 後把新庫叫醒。
4. Agent／本機 preview／橋接：不要再連舊庫。
5. 準備機器：`psql`／`pg_dump`／`pg_restore` **18.x**、`flyctl`、本目錄腳本。密鑰放 repo 外檔案。
6. 選低流量時段。13:50–14:15 曾連續 25 分鐘 api 除 health 外 0 請求，但不要當成永遠如此。
7. 寫下 CUTOVER_TS（開始停寫的時間，含時區），回滾補資料會用到。
8. **先不要清 QA**。理由見下方。

## 1. 停止寫入（學生會看到什麼）

這個產品**沒有維護模式頁**。不要為了搬家額外部署一版 web。

建議順序：

1. `fly machine list -a nuni-api`、`fly machine list -a nuni-web`，記下 machine id 與**目前映像 digest**（回滾用）。
2. **先停 `nuni-api` 全部機器**（`fly machine stop`）。`min_machines_running=1` 可能把機器拉起來，若發生就暫時 `fly scale count 0 -a nuni-api`（web 同樣）。
3. **再停 `nuni-web`**。否則 BFF 在 `ASSIGNMENT_FILE_SUBMIT_ENABLED=true` 時仍會用 `ASSIGNMENT_FILE_DATABASE_URL` 寫 Neon。文字課班寫入走 API，所以只停 web、留 api 仍會寫入。
4. 確認 Render staging 已 Suspend、沒有本機／agent／Cursor cloud 還拿著舊 `DATABASE_URL`。GitHub Actions 沒有正式庫密鑰，但不要在停寫窗口另外跑會連 DB 的手動 workflow。

學生端（停機期間）：

| 入口 | 實際行為 | 畫面上大致會看到 |
| --- | --- | --- |
| `https://nuni.tw` 整站 | Fly 沒有健康機器 | 瀏覽器連線失敗／Fly 錯誤頁，不是我們寫的維護文案 |
| 只停 api、web 仍開 | 靜態頁、公告（Firestore）、公車（TDX）仍可用 | Google 登入：`目前無法使用帳號登入，請稍後再試。`；課班：`目前無法連線。請保留填寫內容，稍後重試。`（`nuniErrorMessage` 對 503／網路錯誤的預設句）；作業傳檔：`目前無法上傳檔案。請保留已選內容，稍後重試。` |
| App | 打同一組 api／web | 同樣是暫時無法連線，草稿應保留 |
| `/health/live`（Fly 自己打的） | 機器停了就不會過 | 與學生流量無關 |

不要只改 DNS 或只關其中一個 app。也不要依賴「沒人在用」——停機器才是凍結寫入。

停妥後再連舊庫看 `pg_stat_activity`：只應剩下你的 dump 連線。

## 2. 匯出（舊庫，直連）

```sh
DUMP_DIR=/path/outside/repo/neon-20261022
SOURCE_DATABASE_URL_FILE=/path/outside/repo/old.url
scripts/ops/neon-migrate/01-export.sh
```

腳本實際使用的 `pg_dump`：

```text
pg_dump --dbname="$SOURCE_DATABASE_URL" \
  --format=custom --compress=9 --encoding=UTF8 \
  --no-owner --no-acl \
  --verbose --file="$DUMP_DIR/neondb.dump"
```

為什麼 `--no-owner --no-acl`：

- Neon 內建角色（`cloud_admin`、`neon_superuser`、`neon_auth`…）**不能**在新 project `CREATE ROLE`，也不能建 PostgreSQL superuser。帶 ACL 的 restore 常在這裡失敗。
- `pg_dump --no-owner` 對 **custom 格式會被忽略**；真正不改 owner 的是 `pg_restore --no-owner`。腳本兩邊都帶。
- 新 project 的 `neondb_owner` 與舊的同名不同憑證；`--no-owner` 讓物件落到還原時的角色（請用新庫的 `neondb_owner` 連）。
- **權限不是丟掉**：同一腳本會另外寫可重放的 `inventory/grants.sql`（表／sequence／**帶參數的函式**／schema USAGE／default privileges）、`login_roles.txt`、`functions.tsv`、`triggers.tsv`。還原後只重放**非 Neon 內建、非擁有者自己**的 GRANT。角色不存在只跳過該行並留下 `grants-skipped.txt`；`relation does not exist` 會整段失敗。
- `pg_restore` 加 `--no-comments`：Neon 上 extension 多半屬 `neon_superuser`，`COMMENT ON EXTENSION` 會讓 `--exit-on-error` 在資料進來之前就停。
- nuni-api 啟動核對（來源在封存的 `nuni-prod`：`migrate.ts`、`database-deployment-contract.mjs`、`database-role-readiness.ts`）是 `schema_migrations` 的 `(id, checksum)` 以及 `has_table_privilege`／function EXECUTE。本倉庫對得上的實作是 `scripts/verify-nuni-import-api.mjs` 與 `deploy/nuni-api/composed/README.md`。這次 API **繼續用 `neondb_owner`**：該角色在 Neon 繼承 `neon_superuser` 的 `pg_read_all_data`／`pg_write_all_data`，缺額外 GRANT 通常仍能過 readiness；缺的是**自訂 LOGIN 角色**（例如只靠 SQL 建的 `nuni_web_files`，沒有 schema USAGE 就會 `permission denied for schema public`）。`03-verify.sh` 會查目前連線角色對 public 表／函式的 privilege，LOGIN 角色少了就失敗（除非 `IGNORE_MISSING_ROLES=yes`）。

另外會再 dump 一份 plain `--schema-only` 方便 diff。custom 格式本身包含：

- public schema 物件（表、視圖、函式、觸發器）
- extension（若來源有）
- sequence **目前值**
- 全部列資料

連線字串用直連。Pooler 上跑 `pg_dump` 不穩定。43 MB 估計 1–3 分鐘；盤點每張表 `count(*)` 可能再加數分鐘。

## 3. 還原（新庫，直連，新密碼）

```sh
DUMP_DIR=/path/outside/repo/neon-20261022
DEST_DATABASE_URL_FILE=/path/outside/repo/new.url
scripts/ops/neon-migrate/02-import.sh
```

`pg_restore --no-owner --no-acl --exit-on-error`。目標 public 若已有表會拒絕（除非 `ALLOW_NONEMPTY_DEST=yes`）。

若要 nuni-web 最小權限：

```sh
CREATE_WEB_ROLE=yes WEB_ROLE_NAME=nuni_web_files WEB_ROLE_PASSWORD=… \
  ./02-import.sh
```

它只 GRANT：

- `class_assignment_submission_files`：SELECT, INSERT, UPDATE
- `class_assignment_file_idempotency`：SELECT, INSERT
- `class_workspaces`、`class_workspace_assignments`、`platform_accounts`：SELECT（外鍵檢查）

nuni-api 這次**繼續用 `neondb_owner`**，不要順便換 runtime role，以免 readiness 檢查失敗。

## 4. 核對（通過才能換 Fly）

```sh
COMPARE_INVENTORY=yes DEST_DATABASE_URL_FILE=… DUMP_DIR=… ./03-verify.sh
```

來源已停、且你不想再叫醒舊 compute 時，用 dump 當下的 inventory 比即可。若舊庫還連得上，也可兩邊即時 `count(*)`。

必須一致：

- public 表清單與每一張的列數
- `schema_migrations` 的 `(id, checksum)`（`applied_at` 可能因還原時間略差，腳本比 id+checksum）
- `pg_sequences.last_value`（PG 18 沒有 `is_called`；`NULL` 代表還沒 nextval）
- extension 名稱與版本
- public 函式簽名、非內部 trigger
- 應用程式角色對 public 表的 GRANT（目標必須包含來源的每一條；Neon 內建角色允許不同）
- 來源有、目標沒有的 LOGIN 角色（可 `IGNORE_MISSING_ROLES=yes`，預設失敗）
- 目前連線角色對每張 public 表的 `has_table_privilege(SELECT)`，以及 public 函式 `EXECUTE`

人工再看：

```sql
SELECT current_user, count(*) FROM public.schema_migrations;
SELECT has_table_privilege(current_user, 'public.class_workspaces', 'SELECT');
```

用**即將給 nuni-api 的角色**連一次。缺權限時 API 會在啟動時直接不起來，不是晚一點才 500。

## 5. 換 Fly secrets（先 api、再 web）

兩個 URL 都要 `sslmode=require`，而且必須是**直連**（host 不得含 `-pooler`）。腳本讀 stdin，只接受該 app 的那一個鍵，不印值。`STAGE=no` 會建新 Fly release、可能把機器拉起來，必須再設 `CONFIRM_RESTART=yes`。

```sh
printf 'DATABASE_URL=%s\n' "$(cat /path/outside/repo/new-api.url)" \
  | APP=nuni-api APPLY_SECRETS=yes STAGE=yes \
    scripts/ops/neon-migrate/04-switch-fly-secrets.sh

printf 'ASSIGNMENT_FILE_DATABASE_URL=%s\n' "$(cat /path/outside/repo/new-web.url)" \
  | APP=nuni-web APPLY_SECRETS=yes STAGE=yes \
    scripts/ops/neon-migrate/04-switch-fly-secrets.sh
```

`--stage` 不重啟。機器仍停著時再：

1. `fly machine start`（或 `fly scale count 1`）**只開 nuni-api**
2. 等 `https://api.nuni.tw/health/ready` 回 200 且 `database: reachable`（這一下會叫醒新庫，屬預期）
3. 再啟動 nuni-web
4. `https://nuni.tw/health/ready` 回 200（**不證明 DB**，只證明兩個 web 程序）

不要 `fly deploy` 新映像。這次只換 secret，沿用記下的 digest。

若 `fly secrets import --stage` 之後機器起來仍用舊 URL：再查 `fly ssh console` 的環境變數名稱（不要 `echo` 值），必要時設 `STAGE=no CONFIRM_RESTART=yes` 再 import 一次讓 Fly 滾一次。機器必須仍是你要的那一台 app。

## 6. 上線後抽查

Health：

- `https://api.nuni.tw/health/live` 200（不碰 DB）
- `https://api.nuni.tw/health/ready` 200、database reachable、平台 Google 登入就緒
- `https://nuni.tw/health/live`、`/health/ready` 200、revision 仍是切換前的 SHA

畫面（用既有帳號，不要再造 QA 資料）：

1. `https://nuni.tw` 能開，不是 Fly 錯誤頁
2. 平台登入選項：`/api/nuni/sign-in-options` 仍是 Google 開、學號關
3. 課班列表能讀到**真實課班**（不是 QA測試課班）
4. 若傳檔已開：老師／學生看得到既有作業附件；新傳一張再刪，確認走新庫（舊 Neon 的 `pg_stat_activity` 應沒有 Fly 連線）
5. 停 nuni-api 時會壞的路徑現在要好：登入、課班、作業文字繳交
6. 不該壞的：公告、公車、地圖（不走 Neon）

## 預估停機時間（由心）

不是人天估算，是這次步驟的牆鐘時間：

| 步驟 | 估計 |
| --- | --- |
| 停機器、確認無寫入 | 2–4 分 |
| pg_dump 43 MB + 精確 count | 3–8 分 |
| pg_restore + GRANT | 3–8 分 |
| 核對 | 2–5 分 |
| 換 secret、先開 api 再開 web | 3–6 分 |
| health + 抽查 | 4–8 分 |
| **學生看到整站打不開** | **約 15–30 分** |

grant／role readiness 失敗時會拉長；那種情況應回滾舊庫，不要在停機中改 API 程式。最糟先預留 45 分。流量低，但課班繳交是同步寫入，沒有「只讀模式」可縮短。

**15–30 分合理，前提是舊庫 dump 一次成功。** 最大風險是舊 project CU 只剩約 2%：dump 與精確 `count(*)` 會叫醒 compute，失敗重試會把額度燒光。本機用精簡 schema 演練約數秒，**不能**拿來證明 43 MB／539 張表的牆鐘時間。

## 回滾

任何一步失敗，原則是：**還沒換 Fly 就不算切換；換了以後以 Fly 指到誰為準。**

| 失敗點 | 做法 |
| --- | --- |
| dump 失敗／舊庫連不上 | 立刻把 api／web 機器開回去，secrets 未改。學生恢復。 |
| restore／核對失敗 | 不要動 Fly。刪新庫重來或修 GRANT 後再核對。開回舊機器。 |
| api 起來但 ready 失敗（schema／role） | `APP=nuni-api` 把舊 `DATABASE_URL` 送進 `05-rollback-fly-secrets.sh`，啟動舊機器。新庫那幾分鐘若已有寫入，用 `06-replay-delta.sh` 在**開回舊庫之前**補。 |
| api 正常、web 作業檔失敗 | 只回滾 nuni-web 的 `ASSIGNMENT_FILE_DATABASE_URL`。 |
| 切換後才發現資料缺漏 | 停寫 → delta 從新補舊或從舊補新 → 再決定指向。 |

切換後寫進新庫、要退回舊庫：

```sh
NEW_DATABASE_URL_FILE=… OLD_DATABASE_URL_FILE=… \
CUTOVER_TS='2026-10-22T16:00:00+08:00' \
WORKDIR=/path/outside/repo/delta \
  ./06-replay-delta.sh          # 乾跑
APPLY_DELTA=yes ./06-replay-delta.sh
```

只自動處理有 `updated_at`／`created_at`／`applied_at`／`occurred_at`／`submitted_at` 且有主鍵的表。預設**略過 `schema_migrations`**，避免把 checksum 寫回舊庫害舊映像起不來。沒有時間欄的表會列在 `delta-report.json` 的 `no_timestamp`，要人工看。不會重放 DELETE，也不保證 FK 順序；缺主鍵或 COPY 失敗會停，不要當完整 logical replication。必須先乾跑出報告，再 `APPLY_DELTA=yes`。補完再把 Fly 指回舊庫。

舊 project **先留著、不要刪**。免費 CU 用完只是 compute 暫停，資料還在。至少留到 11 月帳期、確認新庫穩定。

## 風險清單

1. **Neon 原生角色**：dump 若含 `CREATE ROLE neon_superuser` 之類會炸。腳本用 `--no-acl` 避開。
2. **假設的 role 名稱**：repo 裡沒有寫死 `nuni_api`。正式可能就是 `neondb_owner`。執行當日以 `pg_roles` 為準；inventory 裡多出來的 LOGIN 角色要在新庫手動建（密碼新的）。
3. **Pooler 對直連**：nuni-api 用 node-pg Pool，閒置約 30 秒；web 作業檔 pool max 4。請用直連。誤用 pooler 常見症狀是偶發 `prepared statement already exists`、啟動檢查掛住、session 級 SET 無效。
4. **連線字串外洩**：新庫一開始就用新密碼。不要把 URL 貼進 issue、PR、chat、shell history（用 `*_FILE` 或 stdin）。`fly secrets import` 不要加 `--verbose`。建議 nuni-web 用 `nuni_web_files`，不要把 owner 密碼放進 web 機器。
5. **早上那份 schema dump**：無資料、無 GRANT、在 280 之前。拿它還原會得到空庫且缺作業檔表。
6. **API 啟動檢查**：migration manifest 或 privilege 不符 → 機器不斷重啟。這時 `/health/live` 可能還過（不碰 DB），不要被 live 騙。
7. **雙寫窗口**：只換 api、忘了 web，作業檔仍寫舊庫。先停 web 再換，開的順序是 api 然後 web。
8. **Render staging**：舊密碼繼續打舊 host，或之後被改成新 host 卻沒 Suspend，11 月又把新免費額度燒光。
9. **sequence**：目前 schema 看起來幾乎都是文字 id（`pa_`／`cw_`／`cwa_`），sequence 可能為 0。仍要核對；若有漏設，之後插入會撞 PK。
10. **QA 清理誤傷**：腳本只用 CLEANUP.md 的精確 id＋`qa-file-smoke-*`／`smoke-*` 前綴＋nocard 學生 id。不依 email 模糊刪、不刪課班本身、不刪 product-qa session。
11. **Supabase 物件**：SQL 清了但 bucket 沒刪，會留測試 jpg；反過來只刪物件、SQL 還在，畫面上傳檔 404。
12. **舊庫 CU 見底**：dump 當下還會叫醒舊 compute。剩 ~2% 時這是最大執行風險。先把 staging／agent 連線斷乾淨，dump 一次成功，不要重試連打。

## QA 測試資料：搬之前還是之後清？

**建議：先搬家、核對、切換、health 通過，再對新庫跑清理。**

理由：

- 舊庫只剩約 2% CU。DELETE 一樣要叫醒 compute，失敗還得重來，擠壓 dump 的額度。
- 舊庫保持「切換當下完整快照」（含 QA 列），列數核對比較單純，回滾也比較像當時的正式庫。
- QA 列很少，43 MB 幾乎不變。
- 清理若寫錯條件，傷的是新庫；舊庫還在，可再還原那幾列。

若晩瑋希望新庫上線時學生就看不到 QA 作業：在新庫切換**之前**、核對通過之後清也可以（此時 Fly 仍指舊庫，學生還沒看到新庫）。**不要在舊庫、停寫前清**——那會改到回滾基準，又燒舊 CU。

清理範圍（CLEANUP.md，只這些）：

- 課班 `cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2` 裡：**不刪課班**
- 邀請 `cwi_2ab1b7f3-…`（exhausted）及其 `qa-file-smoke-invite-` 冪等列
- 成員 `pa_2e7c9b14-…`（qa-student-nocard，student）及其 `qa-file-smoke-join-` 冪等列
- 作業 `cwa_b5d32f94-…`「QA 拍照傳檔測試作業」及繳交、檔案、相關冪等
- Storage 前綴 `cw_b7db89dd-…/cwa_b5d32f94-…/` 底下測試 jpg
- **不清** product-qa 登入 session（到期失效）

```sh
DATABASE_URL_FILE=… MODE=list ./qa-cleanup.sh          # transaction 內 SELECT，ROLLBACK
# 看 receipts/qa-list.txt
DATABASE_URL_FILE=… MODE=apply CONFIRM=yes ./qa-cleanup.sh
```

晉瑋若要留作業當示範：不要跑 apply，只刪檔案列與 Storage（需另寫更窄的指令，本腳本預設整份 QA 作業都刪）。

## 新庫上線後怎麼省量（避免 11 月再爆）

免費額度是 **每個 project 100 CU-h／月**，不是帳號共用。舊 project 用完不影響新的；但新的一樣會爆。

優先（都不改 schema）：

1. Agent 不要連正式庫；本機用 embedded／本機 Postgres。Neon branch 與**同一 project** 共用 CU-h，不能拿來省。
2. Render staging 保持 Suspend；不要再把正式 `DATABASE_URL` 配給 staging。
3. 外部監控打 `https://nuni.tw/health/ready`（不碰 DB），不要打 `https://api.nuni.tw/health/ready`。
4. 非必要的 nuni-api 部署／重啟延後（啟動 schema 檢查會叫醒 DB）。
5. 確認沒有第二條橋接、cron、bot 拿著舊或新密碼。
6. Neon autoscaling 上限 0.25 CU（要晉瑋同意；尖峰 1 GB RAM）。
7. nuni-web 用最小權限角色之後，owner 密碼只留在 api 與維護者檔案，降低外洩後被拿去開一堆連線的機會。

Free 的 scale-to-zero 固定 5 分鐘，改不了。每叫醒一次至少約 0.02 CU-h。11 月用 Monitoring 看實際清醒時間，不要用 10 月（含 QA／dump／migration）的數字當基準。

## 執行檢查清單（給操作者）

- [ ] 新 project PG18／新加坡／新密碼／直連 URL 帶 `sslmode=require`
- [ ] Render staging Suspend
- [ ] 記下舊／新 URL 檔（repo 外）與目前 Fly 映像 digest
- [ ] 停 nuni-api、停 nuni-web
- [ ] `01-export.sh` → `02-import.sh` → `03-verify.sh` 通過
- [ ] Fly：api `DATABASE_URL`，再 web `ASSIGNMENT_FILE_DATABASE_URL`
- [ ] 先開 api ready，再開 web
- [ ] 抽查登入／課班／（若已開）傳檔
- [ ] 舊庫 `pg_stat_activity` 沒有 Fly
- [ ] QA `MODE=list` → 確認 → `MODE=apply`（新庫）
- [ ] 舊 project 保留

## 可能壞掉什麼（自我審查）

這份準備**不能**保證切換當天一次成功。最可能壞的，依嚴重程度：

1. **nuni-api 起不來**  
   缺表、`schema_migrations` checksum 不符、role 沒有 GRANT。學生整站課班／登入／點餐／社群都停。Web 若已起來，會一直顯示「目前無法連線／無法登入」。回滾：secrets 換回舊 URL，開舊機器。

2. **API 看起來活著，其實連錯庫或連到空庫**  
   `/health/live` 不查 DB。一定要看 `/health/ready` 的 database 欄，並用真實課班列數對一下。連到空庫會讓登入變成「找不到帳號」，比 503 更可怕。

3. **只換 api、沒換 web**  
   文字作業在新庫，傳檔索引在舊庫，或相反。畫面可能「繳了但看不到檔」。開機順序與兩條 secret 都要做。

4. **nuni-web 用 owner 以外的角色但 GRANT 不足**  
   傳檔 503／權限錯誤；文字作業仍走 api 所以看起來「一半好」。先用 owner 切換、穩定後再縮權限也可以。

5. **誤用 pooler URL**  
   間歇 500、偶發啟動失敗，難當場看出是連線模式問題。URL host 看到 `-pooler` 就停。

6. **舊 staging／橋接仍連舊庫**  
   切換成功但舊庫繼續被叫醒；或寫入落到沒人看的舊庫。學生資料「有時消失」。切換後立刻看兩個 project 的連線數。

7. **QA 清理刪到真課班**  
   腳本把作業標題與 id 綁在一起，且不刪 `class_workspaces`。仍要先 `MODE=list` 看 preview。若 list 出現非 QA 標題，立刻停。

8. **回滾沒補 delta**  
   切換後學生交的作業留在新庫，Fly 指回舊庫就「繳了卻沒了」。回滾前跑 `06-replay-delta.sh`。

9. **這份本機演練的盲點**  
   審查後改用 `neondb_owner` NOSUPERUSER＋精簡 schema，證明工具鏈、權限重放、失敗即停、QA 條件與 delta 安全閥。**沒有**早上那份 537 張表備份（不在此環境），也沒測 43 MB 資料還原時間、Neon TLS、Fly 重啟。正式 dump 必須現場重做。先前用 SUPERUSER 跑 539 張表的演練**不能**代表 Neon。

10. **沒有正式庫密碼，所以沒有驗證 production 的 `pg_roles`**  
    若正式其實還有第二個 LOGIN 角色（報表、readonly、舊 Render），還原後那個角色不存在，對應服務會掛。執行當日 inventory 的 `roles.txt` 是最後一道。

沒有改程式、沒有部署，因此**不會**因為這份 PR 本身讓正式站壞掉。風險全在操作者執行那 15–30 分鐘。
