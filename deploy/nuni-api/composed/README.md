# 281 與撤回過濾的 API 發布來源

本次範圍固定為 `build.py --imports-candidate`。相較正式映像 `be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2`（OCI revision tree `b0a10ac814cd03fbfb45132566035acce8339f17`），僅六個檔案不同：撤回過濾、281 SQL、匯入型別、餐廳文案及兩個測試檔。**本次不含安全依賴更新**；`--security-candidate` 另案發布，不能宣稱本次是「main 全部 API 修正」。也不含 food-ordering opt-in。

278、279、公開餐廳、課班審核、個人匯入同步與教材穩定游標分頁均已在正式來源。本次唯一新增的 API migration manifest 是 281；不重跑或修改 278／279、不加入缺號 277。280 是既有 BFF 表，並不在 API manifest。正式 DB 狀態來自來源與既有審查推定，發布者仍需安全核對。

`source.json` 綁定每份來源、adapter、patch checksum、overlay tree 與最後 candidate tree。一般重建遇到漂移即停止；只有在已驗證 base 的獨立 checkout 才能執行 `prepare.py --checkout <source> --refresh-manifest`，並審查結果。

建置入口（以下兩個原入口會做本機 Docker build，本次修正作業未執行）：

```sh
python3 deploy/nuni-api/build.py --imports-candidate
python3 deploy/nuni-api/build.py --imports-compatible-rollback
```

低磁碟環境使用 `--prepare-only --output-dir <不存在的目錄>`，只重建、核驗來源或輸出回滾 context，不建映像、不推送、不部署、不套 migration。Fly 遠端 builder、digest 紀錄、migration、兩台機器更新與驗收的完整順序見 [部署與回滾 runbook](RUNBOOK.md)。無參數 builder 仍是歷史 v20，不能用來升級正式 API。

## 遷移與緊急回滾

281 不含 BEGIN／COMMIT，交易由 `database.ts:applyMigration` 擁有：同一 `database.transaction` 內設定 search path、取得 transaction advisory lock、執行 SQL，再寫入 `schema_migrations` 的 ID/checksum，最後由外層提交。任何一步失敗一起回滾。不要裸跑 SQL 取代 runner；建表成功不等於 manifest 已登記。

`rollback-source.json` 與 `Dockerfile.rollback` 固定實際正式 digest／tree；保留原 API 與 278／279，加入與候選相同 checksum 的 281 SQL 至 `/app/apps/api/dist/migrations/`。此包只供緊急相容回滾，DB 不倒退、不刪 280／281 或冪等資料。

負責人已接受：相容回滾會失去撤回過濾，已撤回的本人繳交版本可能重新對其授課老師（含共同授課者）顯示，也可能再次被回饋；此接受範圍不包含其他學生或非成員。隔離驗收若發現超出此授權邊界，停止發布。281 登記後不能直接回原 be815455 digest，必須用事前驗證且記錄 digest 的相容包。

## 發布前證據

須以相同 pinned 來源完成 API typecheck、build、完整既有 suite、真 PostgreSQL migration 原子性與 HTTP 回歸、相容包在新 manifest 下啟動測試。現有 `scripts/verify-nuni-import-api.mjs` 僅允許 loopback 與專用隔離 DB；合成登入不代表正式 Google OAuth 成功。完整點餐測試可明確設定 `ONLINE_ORDERING_ENABLED=true`，正式仍保留既有關閉值。

既有 runtime-grant inventory 的 `BLOCK` 不是 ACL 或 READY 回執；須核對 API 對 281 的 SELECT、BFF 的 SELECT／INSERT 及必要 schema/function privileges。既有 `CAMPUS_COURSE_ACCESS_ENABLED`、`CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED` 及其他線上旗標保留，不因歷史文件重設。
