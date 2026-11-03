# API 組裝驗證候選

這是本機驗證材料，不是可部署的 image。`production-host.ts` 將既有 route、平台 session、資料庫及受信公開目錄接在一起；不注入選項時既不註冊路由，也不改動全域驗證。這份候選沒有環境變數啟用入口，沒有注入 Groq provider。

測試 host 使用目前專案中的靜態靜宜大學公開目錄，只收交叉核對且符合 OpenStreetMap 格式的地點；來源日期沿用原始資料，並非即時資料。瀏覽器提供的列、身分與座標都不是來源。

`prepare-pinned-host.py` 和 `prepare-pinned-rollback.py` 僅接受此工作樹 `output/` 下、index tree 為 `b0a10ac814cd03fbfb45132566035acce8339f17` 且受追蹤檔案無工作樹差異的獨立 checkout。它們分別準備測試 host 和相同 SQL 的回滾 manifest，記錄 SHA-256；`999_public_agent_isolated_test_only` 只可用於本機測試，不是正式 migration 編號。腳本不連線或執行 migration。`full-migration-isolated-run.mjs` 檢查真實原有 migration runner、增量、失敗回滾與同 manifest 驗證；舊程式直接回滾會拒絕多出的 migration。

`pinned-host-postgres-run.mjs --prepared output/<checkout>` 核對測試 manifest 後，自建全新 0700 目錄與 Unix socket PostgreSQL，不接受資料庫 URL；透過真實 `createApp`、`PlatformAccountService.resolveSession`、`CampusDatabase`、靜態公開目錄及合成帳號完成導航確認和重送。僅測試注入明確啟用選項；沒有真模型呼叫。測試完成停止並清理自己建立的叢集。執行需要本機 PostgreSQL 17、Node 22、該 checkout 依其 frozen lock 安裝依賴，且系統允許本機 IPC。不要將現有資料庫的設定帶入。

目前 b0a lock 為 Fastify 5.10.0，存在已知安全問題，僅供基線比較，不能作為安全發布建議；5.12.7 是獨立安全更新候選，不能推定已部署。相同資料表清單不能證明正式 runtime 權限、rolling 混版安全、恢復策略或正式部署版本；正式 migration 編號、目前 manifest、授權角色、來源更新政策及相容回滾 image 均須另行確認。正常例外的合成 canary 測試不等於所有日誌均已完成秘密稽核。
