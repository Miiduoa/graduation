# 個人資料同步與課班連結的 API 發布來源

這份組裝把公開餐廳、課班審核、個人資料同步依序套用到 `../source.json` 的固定 API tree。`source.json` 記錄每份來源、adapter、完成後的 app 與 Git tree。一般建置遇到來源漂移、重複目標、未知 runtime 檔案或不同 tree 會停止，不會改寫 manifest。

```sh
python3 deploy/nuni-api/build.py --imports-candidate
python3 deploy/nuni-api/build.py --imports-compatible-rollback
```

兩個指令只建置本機 `linux/amd64` image，不部署、不套用正式遷移、不啟用服務。候選 image 的 `org.opencontainers.image.revision` 是組裝完成的 tree。必須先取得相同來源的完整 API typecheck、build、完整既有 API suite、真 PostgreSQL 遷移及完整 HTTP 驗收證據，才能交給發布者。

維護者在已重建且驗證 base tree 的獨立 checkout 才能執行 `prepare.py --checkout <source> --refresh-manifest`。一般重建只用 `prepare.py --checkout <source>`。檔案更動後必須重新產生並審查 manifest，不能保留舊 image 或舊驗收版本。

## 驗收

`scripts/verify-nuni-import-api.mjs` 只接受明確的 loopback PostgreSQL 與專用資料庫 `campus_nuni_import_acceptance`。它核對組裝 tree，建立隨機 schema，跑全套遷移、沒有 demo auth 的真 HTTP nonce／JWT／session 流程、老師獨立審核、學生審核入班、兩個 session 的同步與刪除、舊 mutation 重送及撤銷課班連結，最後刪除本次 schema。IdP 金鑰、帳號、課班都是合成驗收資料；不代表真實教師認證或正式 OAuth 驗收。

```sh
node --import <source>/apps/api/node_modules/tsx/dist/loader.mjs \
  scripts/verify-nuni-import-api.mjs --source <source> \
  --database-url postgresql://127.0.0.1:55478/campus_nuni_import_acceptance \
  --output <evidence.json>
```

完整既有 API suite 的點餐情境要明確設定 `ONLINE_ORDERING_ENABLED=true`，它們測試開放點餐時的授權與訂單流程。另跑公開餐廳的開關測試，確認未設定時寫入被拒絕。**正式環境維持點餐關閉，不設定這個變數。**

基本型別與 PostgreSQL 回歸入口是 `scripts/test-personal-import-sync.mjs`、`scripts/test-course-access.mjs`。型別 runner 使用 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`；完整 API 另外使用來源指定的 TypeScript 版本。這些聚焦測試不取代完整 API 和正式站驗收。

## 遷移與回滾

此版只新增 `278_course_access_review`、`279_personal_import_sync`，不套用目錄中另存的 277。發布者須在正式資料庫以唯讀交易核對每個既有 migration ID／checksum，並確認沒有其他工作已改過來源或機器 image。

正式 API 啟動會精確核對遷移 manifest，因此加完 SQL 後不能直接回原 image。`Dockerfile.rollback` 的不可變 base 是發布前實際運行的 image，僅加上這兩份相同 checksum 的 SQL 檔案，保留原 API 程式及所有新寫入資料。`rollback-source.json` 綁定 base digest 及 SQL checksum。若正式 image 已變更，必須重新核對和更新這份復原來源，不能套用舊的回滾包。

發布前先建好並保存候選與回滾的 registry digest，然後用候選 image 的 `node apps/api/dist/migrate.js` 執行正式遷移。確認遷移及 runtime table/function privileges 後才更新既有機器的 image，並明確設 `CAMPUS_COURSE_ACCESS_ENABLED=true`、`CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED=true`。保留所有其他機器設定。最後用兩個各自登入的正式 session 驗證上傳、下載、衝突、刪除與撤銷連結；不可用偽造 session 取代正式登入。

既有 runtime-grant inventory 分析器對此來源仍回報 `BLOCK`，它不是可套用的 ACL 或 READY 回執。此組裝保留固定 base 的分析檔，將重新分析結果另存驗收 artifact；發布證據需包含實際 runtime role 的 `has_table_privilege`／必要 function privileges 和真資料庫操作。不得把分析器的輸出稱為通過的授權證明。
