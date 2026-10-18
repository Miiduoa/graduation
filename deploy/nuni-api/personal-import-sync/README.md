# 個人匯入同步 API

這個 overlay 使用平台帳號 session 儲存個人的課表、成績及活動。匯入的教師姓名、課班名稱與成績均是個人資料，不會寫入正式學籍、課班成員或教師權限。

部署必須同時包含 `279_personal_import_sync.sql`、本目錄的 service/routes、`prepare.py` 指定的共用驗證檔案，並設定 `CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED=true`。`prepare.py` 僅提供純檔案映射與 app adapter；外層建置負責核對固定來源、overlay 順序及最後 source tree。

## 契約

- `POST /v1/auth/platform/personal-imports/read`：`{ schoolId }`
- `POST /v1/auth/platform/personal-imports/write`：`{ schoolId, expectedRevision, mutationId, records }`
- 兩者使用既有 `Authorization: Platform …` session，回應 `Cache-Control: no-store`。
- 回應：`{ schoolId, revision, records, updatedAt, detachedCourseLinks }`。尚未建立的校園為 `revision: 0`、`records: []`、`updatedAt: null`。
- `detachedCourseLinks` 是已取消連結的個人紀錄 ID；個人成績、來源文字和手填教師姓名仍保留。
- 帳號身分、權限或 owner 欄位不接受客戶端指定。`personal` 未選校園範圍不能同步；尚未與學校串接的實際校園可以同步。

寫入以 `expectedRevision` 做比較後更新。相同 revision 的並行寫入只有一個成功；另一個回 `PERSONAL_IMPORT_REVISION_CONFLICT`（409），由用戶端重新讀取、合併並確認衝突。同一個 `mutationId` 和相同內容可重試；更換內容會回 `PERSONAL_IMPORT_MUTATION_CONFLICT`（409）。重試回傳目前快照，不能恢復後來已刪除的紀錄。

刪除最後一筆資料仍保留空快照及新 revision，阻止離線裝置用舊版本復活資料。帳號正式關閉時，資料庫 trigger 在同一交易刪除個人快照與重試雜湊；暫停帳號僅停止存取，不刪資料。硬刪帳號由外鍵 cascade 清理。

## 邊界

每份快照最多 2,000 筆、JSON 內容最多 8 MiB。HTTP 寫入上限另外保留 16 KiB 給 envelope，讀取請求上限 4 KiB；每個帳號最多 20 個校園快照，每個校園保留最近 100 個 mutation keys。僅保存原始文字，不保存來源圖片。伺服器不記錄匯入內容或 session handle。

交易內重新檢查並鎖住帳號、憑證及特定 session，以涵蓋登出／停用競態。課班連結必須存在於有效 workspace 與有效成員關係；存在校園掛靠時也必須有效且校園相同。個人 workspace 可以作為個人參考，但不代表學校審核。每次讀取和重試都重新檢查連結；失效連結被移除，不以資料錯誤為由丟棄個人成績。

Runtime grants：`personal_import_ledgers` 需要 SELECT、INSERT、UPDATE、DELETE；`personal_import_mutations` 需要 SELECT、INSERT、DELETE。原有帳號、憑證、session、workspace、成員及掛靠表需要 SELECT；關閉帳號的路徑也要能執行 trigger 的 ledger DELETE。

## 驗證

`scripts/test-personal-import-sync.mjs` 編譯真正的 service 與共用驗證，再對專用 PostgreSQL schema 執行隔離、CAS、重試、刪除、權限、帳號關閉及 HTTP 路由測試。測試自行建立並刪除該 schema，不碰正式資料。需要 `IMPORT_SYNC_TEST_DATABASE_URL`、`IMPORT_SYNC_TEST_TSC`、`IMPORT_SYNC_TEST_TYPE_ROOTS`、`IMPORT_SYNC_TEST_DEPS`；deps 內需有 TypeScript、pg、Fastify。沒有 PostgreSQL 時會明確跳過，不能列為資料庫驗收通過。

此套件的最小既有 schema fixture 不是完整遷移驗證；發布仍須另外執行固定私有 API 的全部遷移、完整型別檢查、runtime grants 與正式站兩個獨立瀏覽器 context 實測。
