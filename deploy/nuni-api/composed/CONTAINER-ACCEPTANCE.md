# 固定映像容器驗收（2026-11-01）

本輪未推映像、未部署 Fly、未連正式資料庫。只用 box 本機專用 Docker daemon、拋棄式 PostgreSQL（127.0.0.1:55474）及合成帳號；API 使用 production 模式、原始 ENTRYPOINT／CMD、USER node、唯讀 rootfs，沒有替換入口或掛入 `.env`。候選與回滾 digest 沿用 RUNBOOK 固定值，未重建。

本機原無 Docker daemon；下載獨立 Docker 28.5.2，於本次暫存啟動 overlay2 daemon、停用 bridge／iptables，以 host 網路接本機 DB。空白 daemon 的 image prune／builder prune 均回收 0；未刪除其他工作目錄或快取。測試結束移除本次映像、程序與暫存。

候選內建 runner 在隔離 DB 首次建完整 schema，退出 0；timeout 同 client 核驗 lock=5000、statement=60000、idle=90000ms；manifest 278 筆，281 checksum `ddc7e73ecb944075fc2f0a75846e91661a2b9489a8a32cad91c95a99cc25f198`。此次 migration 用本機管理身分初始化，沒有把它當成正式 migrator 最小權限驗收；本輪最小權限驗收範圍是 API 測試路由。

API 使用獨立 local_api：非 superuser／createdb／createrole／replication／bypassrls，非物件 owner，無 public schema CREATE、無 manifest INSERT、281 僅 SELECT。只授予本輪路由必需的具名表 SELECT 及 session DELETE；CREATE TABLE 實測被拒。初始 session 投影缺 platform_tenant_personas 等 SELECT 回 500，補上四個具名表後為 200；ready login 摘要缺 tenant_identity_providers SELECT 亦已補齊，最終 checked=true。這是隔離 fixture 權限修正，非程式修補或正式 ACL 證明。

| HTTP／資料驗收 | 候選 | 相容回滾 |
|---|---|---|
| live／三次 ready | 200／200 | 200／200 |
| 預建有效 session current | 200 | 同一筆 session 200 |
| 未登入 current | 401 | 401 |
| provider 列表／不完整登入 | 200 空列表／400 | 200 空列表／400 |
| 老師、兩學生作業列表 | 200 | 200 |
| 非成員作業列表 | 404 | 404 |
| 學生及非成員 submissions／跨學生 feedback | 403 | 403 |
| 學生 B 只見自己 body；學生 A 看不到 B body | 通過 | 通過 |
| 微秒 submitted_at 對應毫秒撤回紀錄 | A 本人與老師均看不到撤回 body | A 本人及老師重新看到，B 看不到 A body |

切換 UTC 07:50:24 開始，07:50:34 回滾完成 HTTP 驗收；先停候選，再以同 DB、同 API role、同 port、同 session 啟動相容映像，未重跑 migration 或修改 manifest。回滾上登出 200，原 session 隨即 401。逐項結果由斷言腳本核對 HTTP 與 response body，非只看 status。

限制：沒有真實 Google／Apple provider、未完成正向 OAuth 登入；login.ready／platformGoogleReady=false。session 是本機預建資料，不能代表 Google 換票成功。未驗正式既有 session、正式 ACL、BFF 寫入、完整路由權限矩陣、正式 15 分鐘監控或完整 API suite；既有 118 項斷言問題保持前輪結論。未啟動本機 OTEL collector，exporter 連接本機失敗不當成正式觀察通過。初始化試跑曾因 production OTEL 參數不足退出，補齊本機 HTTPS endpoint／protocol 後原始 CMD 成功；未關閉 production gate。

一次性 Fly wrapper 已用候選容器及唯讀 verifier 實際執行，退出 0 並記錄 migration.job.exit=0；Fly machine 樣板只核對本機 CLI help，未在 Fly 建立 machine，正式事件／網路／TLS／既有 migrator 注入仍由 Miiduoa 在窗口核對，缺任一即停止。

原始證據：`/workspace/nuni-api-fix4-evidence/` 下的 candidate-http.json、rollback-http.json（每筆 UTC／HTTP／耗時／body）、assertions.txt、logout.json、role-manifest.txt、role-ddl-denied.txt、migration.log、job-wrapper.log、兩個 cmd／digest 記錄及 runtime 日誌。指令與限制見該目錄 README.md。安全另案 [#370](https://github.com/Miiduoa/graduation/issues/370)；撤回重新曝光由維護者 Miiduoa 於 2026-11-01 接受，範圍限本人及原授課關係。
