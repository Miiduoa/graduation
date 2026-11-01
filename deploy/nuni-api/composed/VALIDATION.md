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

未建候選或回滾 Docker 映像：沒有可用 daemon，也無可啟動的 daemon binary。
回滾僅完成 prepare-only 與 SQL checksum 核對；未以其他來源建置假冒指定 be815455 base。
因此尚缺兩個映像的實際啟動、相容回滾在281 manifest下的 HTTP／跨學生與非成員授權驗收、immutable registry digest、正式 ACL／Google 登入及發布觀察。
未推映像、未部署 Fly。API suite 的撤回與授權測試也不能替代相容回滾映像驗收。

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
