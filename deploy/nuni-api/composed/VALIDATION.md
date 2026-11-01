# 281 本機發布驗證紀錄

日期：2026-11-01。候選 tree：`4c7919d6cff32789acb06e2b9f4edb180cdad3a1`。
本紀錄只證明隔離本機結果，不構成正式發布放行；未連正式資料庫。

## 固定依賴

從 pinned archived repo 執行 `build.py --imports-candidate --prepare-only` 重建，核對最後 tree。
在乾淨候選目錄執行以下指令，全部設 `EXPO_NO_DOTENV=1`，沒有 `.env` 檔案：

```sh
pnpm install --frozen-lockfile --filter @campus/api...
pnpm --filter @campus/api typecheck
pnpm --filter @campus/api build
pnpm --filter @campus/api test
```

Node 24.22.1、pnpm 10.28.2；固定 Vitest 4.1.10、PGlite 0.5.4。
安裝、typecheck、build 退出碼均為 0；未更新 lockfile／依賴。
完整 suite 採下方的分批方式驗證，最終合併數量與退出碼登錄於 PR #365 發布驗證紀錄；本頁不代表全綠。

另外使用相同固定依賴聚焦執行 `class-workspace-service.test.ts` 的
`hides withdrawn submissions on authoritative reads and feedback replays`：1 passed／11 skipped，退出0（6.85s）。
包含微秒時間、撤回隱藏、回饋寫入／重播拒絕與重繳可見；不以此替代完整 suite。

另跑該 service 整檔：12／12 通過，退出0（47.49s），涵蓋教師／學生正向流程、邀請撤銷及跨 workspace 隔離。這是候選 service 測試，不是相容回滾映像 HTTP 驗收。

## 真 PostgreSQL 成功／失敗與 timeout

Docker client 無法連 `/var/run/docker.sock`，亦無 dockerd／rootlesskit；系統僅 PostgreSQL client。
apt 的 HTTP／HTTPS Debian 索引分別遭 500／TLS 中斷，所以改從 npm 取得
`@embedded-postgres/linux-x64@17.6.0-beta.15` 的原生 PostgreSQL 17.6 binaries
（不是 PGlite），解壓至專用暫存，設定該套件 lib 路徑及 ICU soname 連結。
以目前使用者 initdb，trust 僅限拋棄式本機庫，綁定 127.0.0.1:55465，專用 socket／data 目錄。
沒有安裝系統服務或啟動既有 cluster。

1. 暫時移出**建置產物**的 281 SQL，使用正式 `dist/migrate.js` 建立到 279 的完整 manifest：277 筆，最後 `279_personal_import_sync`；然後原樣放回 281。候選原始碼及 SQL bytes 不變。
2. 在該本機 role/database 設 `lock_timeout=5s`。runner 注入 statement=60000、query=70000、idle-in-transaction=90000，production＋trusted loopback sidecar 設定。透過 `--import verify-migration-session.mjs` 核對同 client／同 transaction 的實際設定為 5000／60000／90000 ms。
3. 在本機 manifest 表裝以下 trigger，**確定 DDL 已存在後**才注入 manifest INSERT 失敗：

```sql
CREATE FUNCTION inject_281_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id = '281_assignment_submission_withdrawals' THEN
  IF to_regclass('public.class_assignment_submission_withdrawals') IS NULL THEN
   RAISE EXCEPTION 'expected DDL before manifest';
  END IF;
  RAISE EXCEPTION 'injected manifest failure' USING ERRCODE = 'P0365';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fail_281 BEFORE INSERT ON schema_migrations
FOR EACH ROW EXECUTE FUNCTION inject_281_failure();
```

runner 退出 1，`database.migrate.failed.errorCode=P0365`。
之後 `to_regclass('class_assignment_submission_withdrawals') IS NULL = true`、281 manifest count=0、總數仍277。
這證明本支 281 的 DDL 與 manifest 一起回滾，不代表所有歷史 migration 共用一個交易。
移除本機 trigger/function 後重跑同 runner：退出0，manifest=278 筆、最後281。
281 表存在且為空；在281之前先保存基線，再比對原有277筆 ID／checksum／applied_at 逐筆完全相同，沒有重跑歷史 migration。role/database 的查詢、RESET 與還原 SET 也已在本機測試。278／279 checksum 未改，281 checksum：
`ddc7e73ecb944075fc2f0a75846e91661a2b9489a8a32cad91c95a99cc25f198`。

4. 複製本機測試庫至另一拋棄式庫，未設定該 role/database lock timeout；相同 preload runner 退出1，訊息 `Migration session timeout verification failed`，驗證檢查器會拒絕錯誤設定。
5. 另一個本機 clone 移除281表及登記以回到本機前置狀態，持有 assignments 的 ACCESS EXCLUSIVE lock，再跑 runner。
實際收到 `55P03 / canceling statement due to lock timeout`，整個 Node 程序約7秒（包含啟動及清單讀取）；表不存在、281 manifest=0。持鎖程序自行 ROLLBACK 並退出。
這裡的移表／刪登記僅用於拋棄式 fixture，**禁止套用於正式庫**。

## HTTP smoke 與限制

以候選固定依賴建置出的 `dist/index.js`、production verify 模式連上述新 manifest 啟動原生 Node 程序：

- `/health/live`：200，status=ok。
- `/health/ready`：200，status=ready、database=reachable。
- 未登入的 assignments 與 current session：401／PLATFORM_SESSION_INVALID。
- 使用本次隨機產生的拋棄式簽章值，無實際 Google provider；ready 中 `login.ready=false`、`platformGoogleReady=false`，**不代表正式 OAuth 成功**。
- 本機未啟 OTEL collector，loopback exporter 在結束時報連線拒絕；本次 HTTP 結果不證明 observability 可用或長時間穩定運行。

前輪未建候選或回滾 Docker 映像：沒有可用 daemon，也無可啟動的 daemon binary；本輪遠端建置結果見後節。
前輪回滾僅完成 prepare-only 與 SQL checksum 核對；未以其他來源建置替代指定 be815455 base。
當時也缺 immutable registry digest，本輪已補齊（見後節）；兩個映像的容器內實際啟動、相容回滾在281 manifest下的 HTTP／跨學生與非成員授權驗收、正式 ACL／Google 登入及發布觀察仍待完成。
前輪未推映像；兩輪均未部署 Fly。API suite 的撤回與授權測試也不能替代相容回滾映像驗收。

## 完整 suite 的分批方式與已確認失敗

標準 `pnpm --filter @campus/api test` 使用兩個 worker。第一批完整完成30檔後保存逐檔結果：612通過、31失敗、17略過；取消當下未完整完成的檔案不計入該批結果，重新納入剩餘423檔，以同一份來源／固定依賴及四個 worker 續跑。`vitest list --filesOnly --json` 得到453檔，須以兩批逐檔結果核對聯集等於原清單、交集為空，再登錄最終結果。第一個標準指令因取消而退出1，不能稱為全套完成或通過。

第一批已取得實際斷言失敗（不是 timeout）：
請假案例的固定2026年9月日期回409 `LEAVE_RETROACTIVE_WINDOW_EXCEEDED`；
行事曆案例預期1.1.0但實際1.2.0；點餐／採購案例在點餐關閉時預期201／200而得到412等。
全檔合併結果與續跑退出碼由 PR #365 發布驗證紀錄保存；不得以部分核心回歸通過或本 repo 的 CI 狀態代替候選 API suite 全綠。

重新以 pinned base 加 production bind patch 得到正式 tree
`b0a10ac814cd03fbfb45132566035acce8339f17`，與候選全量 diff 仍恰好六檔；
上述失敗測試檔與請假／行事曆／點餐服務不在差異內。
這是來源比對，不宣稱已另跑一遍正式 tree 的完整 suite。
本輪不擴大候選功能範圍、不開啟點餐，也不修改時間政策或依賴來讓結果變綠。

## 第三輪：實際映像只建置與檔案核驗

2026-11-01，先以 `flyctl v0.4.118 deploy --help` 核對 `--remote-only --build-only --push --depot=false`。
使用最小 build-only 設定，無 release hook；沿用既有 builder app `fly-builder-hidden-pond-9109`、機器 `891263c6067008` 及其原有 50GB volume，未新增任何 app／機器／volume，未使用 Depot。
兩個建置退出0，只有建置及 registry 推送，API／Web 未產生 release，既有 API 機器的版本、image 及狀態相同。
所有程序設 `EXPO_NO_DOTENV=1`，context 與映像均不含 `.env`；未讀 secrets、未連正式資料庫、未執行正式 migration。

| 項目 | 候選 | 相容回滾 |
|---|---|---|
| immutable image | `registry.fly.io/nuni-api@sha256:962722f3ca6f6ca69f5bef3ccad456fb8c32446c96701e653a9a8022f661c26e` | `registry.fly.io/nuni-api@sha256:b27d87ab9b2736edddd8a40e3d46f1f575e373fcfbddae121439f42e4ecf21e8` |
| revision label | `4c7919d6cff32789acb06e2b9f4edb180cdad3a1` | `b0a10ac814cd03fbfb45132566035acce8339f17`（沿用正式 base） |
| base digest label | 無 | `sha256:be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2` |
| 平台 | `linux/amd64` | `linux/amd64` |
| ENTRYPOINT／CMD | `docker-entrypoint.sh`／`node apps/api/dist/index.js` | 同左 |
| WORKDIR／USER | `/app`／`node` | 同左 |
| 映像內 Node 實測 | `24.22.2` | `24.22.0`（原正式 base） |
| dist migration SQL 數 | 277 | 277 |
| 281 SHA256 | `ddc7e73ecb944075fc2f0a75846e91661a2b9489a8a32cad91c95a99cc25f198` | 同左 |

透過 registry API 讀取 immutable manifest／config，核對回傳 digest 及本機計算 SHA256；每一層下載後先核對 layer digest，再依真實檔頭解碼並以記憶體方式讀取 tar，不需要本機 daemon。
回滾第一層的 media type 標成 gzip、實際檔頭為 Zstandard；初次 tar 解碼失敗，加入依檔頭解碼後完成核驗，未重建或更換 digest。

候選全部 466 個 dist 檔案與本機 Node24.22.1／pnpm10.28.2、同一 frozen lockfile 建置的檔案逐檔 SHA256 完全相同，無缺漏、無差異。
相容回滾的 rootfs diff_ids 完整保留正式 base 的11層前綴，僅追加3層SQL COPY；完整保留正式映像全部 466 個既有 dist／入口腳本檔案的 bytes，唯一新增 `281_assignment_submission_withdrawals.sql`，共467個檔案；278／279 bytes 原樣保留。
候選與回滾的 migration 清單及全部 checksum 完全相同，均未含API280。完整 migration 檔名及 SHA256 保存在本機證據 `candidate-inspection.json`、`rollback-inspection.json`，不以 SQL 檔案數冒充 schema_migrations 筆數。

另外只匯出映像的 Node、musl／必要函式庫及入口 JS，以該映像自己的 musl loader 在本機執行 `node --version`、`node --check index.js`／`migrate.js`，兩個映像全部退出0。沒有啟動 API 或載入入口模組，沒有資料庫連線。浮動 `node:24-alpine` 實際得到24.22.2，本機固定依賴測試／建置仍是24.22.1；dist bytes 相同不等於 runtime bytes 相同。

本輪沒有啟動 OCI 容器；映像檔案一致性不能取代相容回滾在281 manifest下的 HTTP／跨學生與非成員授權驗收、正式 ACL／Google 登入及發布觀察。
候選浮動 Node base 的限制與安全依賴 P1 仍存在，不宣稱正式可發布。
證據目錄：`/workspace/nuni-api-fix3-evidence/`。

## 第三輪：30個失敗檔的精確正式基線對照

以 security/source.json 記錄的 archived base `9de47b4b3492325e430562c37bcad552867162db` 加上核驗 checksum 的 `0000-production-tree-b0a10ac.patch` 重建，`git write-tree` 恰為正式映像 OCI revision `b0a10ac814cd03fbfb45132566035acce8339f17`；不是拿其他版本替代基線。
候選仍為 `4c7919d6cff32789acb06e2b9f4edb180cdad3a1`。完整追蹤檔案比對恰有原定六檔差異，30個失敗測試檔 bytes 全部相同。
兩邊使用 Node24.22.1、pnpm10.28.2、Vitest4.1.10、PGlite0.5.4，同一份 frozen lockfile（SHA256 `72f883e6cedd2b64c821ce388ecdfb40bdeda8c0a94fa2390a7d87eb874d11d8`），均設 `EXPO_NO_DOTENV=1`，無 `.env`。

本輪只重跑前輪30個失敗檔，共306項；不重跑其餘423檔，不將重跑拼成另一份完整 suite：

| 條件 | 正式來源基線 | 候選來源 |
|---|---|---|
| 預設5秒、兩個worker、30檔 | 176通過／130失敗／0略過，退出1 | 175通過／131失敗／0略過，退出1 |
| 逾時4檔，test／hook timeout=60000ms、兩個worker | 21通過／0失敗，退出0 | 21通過／0失敗，退出0 |
| 點餐單項，60000ms，其他12項未選取 | 1失敗／12未選取，退出1 | 同左，錯誤首行完全相同 |

預設結果逐檔失敗集合有130個同名交集；唯一只候選失敗的是 outbox 持久化 fixture，在候選先觸發5秒逾時。另有1個兩邊同名點餐失敗，在基線為 `ONLINE_ORDERING_DISABLED`、實際412／預期201，候選本次先逾時；以60秒單項重跑後兩邊都重現完全相同的412／201斷言。
其餘129個預設同名失敗的錯誤首行相同；暫存路徑、堆疊位置與錯誤類型前綴不當作根因差異，完整原始訊息仍保留。

原135項最終分類：

- **基線也失敗（既有）：118項**，兩邊實際斷言／錯誤首行完全相同。包含請假日期、行事曆版本、點餐關閉、migration fixture缺少unit_id及來源覆蓋斷言；不因本次分類就視為修復。全路由預設授權案例的點餐412／預期401也屬既有失敗，不宣稱授權邊界全部通過。
- **只有候選失敗（回歸）：0項**。在全部306項中，補跑後沒有任何只在候選失敗的實際斷言；本輪程式、測試及lockfile維持原定來源。
- **環境因素：17項**，前輪日誌皆為5秒逾時；分布為notification 2、social capability 5、social report 5、outbox 5。4檔本輪60秒重跑兩邊各21／21通過，包含這17項。預設唯一單邊失敗亦在此集合。該點餐單項仍是既有斷言，不重複計入17項。

套用上述選定重跑結果到這306項的逐項對照，得到188項兩邊通過、118項兩邊失敗、0項單邊失敗；這是來源比對結果，不是再跑一次全套，也不覆寫預設timeout下的原始數字。
逐檔數量及全部135個失敗名稱見 [FAILURE-COMPARISON.md](FAILURE-COMPARISON.md)；原始JSON、日誌、命令、退出碼與分類工具保留於 `/workspace/nuni-api-fix3-evidence/`。
本輪兩個指定缺口已補齊，完整suite既有失敗、安全依賴P1、相容回滾容器HTTP／授權與正式ACL／Google登入驗收仍未解除，不構成發布放行。


2026-11-01 補驗：兩個既有固定 digest 原始 CMD／隔離 PostgreSQL／最小 API role／HTTP 隔離及候選→相容回滾已完成，詳 [容器驗收](CONTAINER-ACCEPTANCE.md)。此新增證據取代上述「尚未容器驗收」的歷史限制；正向真實 OAuth、正式 ACL／監控仍待驗。安全追蹤為 [#370](https://github.com/Miiduoa/graduation/issues/370)，Miiduoa 負責，期限 2026-11-08。
