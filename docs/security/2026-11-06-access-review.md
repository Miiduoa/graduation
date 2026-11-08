# Campus One 權限與輸入安全測試紀錄

檢查基準為 `main` 的 `5bf3c43f85b6bbfdd413373551011db25b00f07e`。第三輪已合併 `main` 的 `0bbb08ef7aadc46d6c0b462f69a39ad3f141bc43`，課表與 Today 相關四個套件 57/57、手機匯入頁 80/80 在 Node 22.23.4 通過。攻擊案例使用合成帳號與測試資料，涵蓋 Firebase 模擬器、Web 請求處理程式，以及 PostgreSQL 15.19 與 PostgREST 16.5 的本機 HTTP 介面。本次未對正式站或學校系統發送攻擊流量。

| 檢查項目 | 修補前的重現結果 | 修補後的驗證 |
| --- | --- | --- |
| LMS 繳交紀錄 | 學生直接修改自己作業的繳交時間，遲交計分由 64 回到 80。手機顯示的已批改限制亦可繞過。 | 資料庫為首次繳交和內容異動記錄時間。單改時間無法改分，批改不重設繳交時間，已批改紀錄拒絕學生替換本文或附件路徑。 |
| 教材搜尋與播放 | 學生從教材表讀不到未發布的項目，搜尋 RPC 卻傳回標題與摘要。兩個同時被鎖住的請求均可兌換同一枚一次性播放權杖。 | 搜尋沿用呼叫者的資料列政策。領取與兌換皆核對課程資格和發布狀態。以相同鎖定條件複測，兩個請求只有一個成功。 |
| 點名、課堂投票與反應 | 參與寫入缺少成員或課堂狀態檢查。特定 UID 能影響另一人的選票，同一人重送反應會使計票失準。 | 在交易內檢查校籍、群組資格和課堂狀態，選票使用完整 UID 當作欄位名。兩個實作的點名入口也檢查校籍。 |
| 討論區與課堂提問 | 一般成員可將貼文改成公告或更改作者。撤銷資格後的作者仍能寫入。學生可修改別人的提問作者與票數。 | 驗證目前資格與可修改欄位。學生只能加減本人一票。課堂結束後，學生停止寫入，授課者仍可標記已回答。 |
| 校園社群 | 編輯貼文或回覆時可改寫作者身分。按讚時只檢查人數差額，成員能順手替換其他人的紀錄。 | 編輯須保留原作者、校別與匿名身分。建立時票數為零，每次按讚或取消只可增減目前使用者。四個定向攻擊案例在原版均能重現，修後通過。 |
| 共用附件 | 在六類路徑，測試帳號 A 建立物件後，帳號 B 可在原路徑覆寫，兩次請求皆回傳 200。 | 群組貼文、校園貼文、失物、問題回報及兩種私訊附件路徑只接受新物件。同一組測試的首次上傳回傳 200，第二人覆寫回傳 403。 |
| Firebase 作業附件 | 作業標為已提交或已批改後，提交者仍能透過 Storage SDK 覆寫老師已收到的原物件。兩個回歸案例在原規則皆失敗。 | 私有附件改由伺服器入口提供。作業與貼文附件使用 GCS 原子建立條件，直接 SDK 讀寫受到封鎖。提交者與有資格的教師可經授權入口讀取，其他學生、外人與匿名讀取被拒絕。不同新檔名可正常建立。 |
| 公開課表 | 有分享連結的匿名讀者能讀到原始 metadata 中額外放入的測試信箱。 | 兩個建立入口只儲存允許公開的欄位。Firestore 拒絕直接讀取未標記的舊資料。既有連結改由伺服器過濾，過期、撤銷或狀態異常時拒絕提供內容。 |
| 登入返回網址與請求大小 | 特製的站內路徑正規化後可變成站外網址。匿名 callable 請求即使超出 64 KiB，原版仍讀完 16 個區塊。SAML 回呼也接受超大表單。 | 正規化後再次驗證返回路徑。兩個入口在讀取過程累計大小並設逾時。以 32 KiB 區塊測試，callable 在第三個區塊取消串流，SAML 超過 256 KiB 回傳 413。 |

## 可重跑的測試

- Firebase 使用 `pnpm test:rules` 啟動隔離模擬器。新增的課堂 callable 攻擊回歸 11/11、資料規則定向案例 14/14 通過，第二輪完整 Storage 測試 14/14 通過。另對點名交易執行 8 項案例，涵蓋撤銷校籍後的收據重送、開課、簽到、結束課堂與交易競爭。這些數量有重疊。
- Web 回歸涵蓋串流上限、SAML 回呼、返回網址、課表建立和舊分享連結，八個套件共 175 項通過。後續課表共用模組調整另通過 5 項路由測試，Functions 測試擴充至 20 項，在 Node 20.19.0 與 22.23.4 皆通過，涵蓋真實 Timestamp、到期邊界、異常資料與缺少課程 ID 的相容性。
- Nuni 商家與課程 API 七個套件共 182/182 通過，其中新增 7 項，驗證偽造身分標頭、上游權限拒絕、失效 session 與待登出狀態。測試呼叫實際 BFF handler，外部 HTTP 連線使用替身，上游資料庫權限採原始碼審查。這輪的修改集中於測試。兩個修改檔的 ESLint 及定向 TypeScript 檢查皆通過。
- 使用一次性的本機資料庫，可執行 `node scripts/supabase-permissions/run-local.mjs`。本輪四次 HTTP 套件各 52/52 通過，涵蓋全新安裝、從歷史結構升級，以及重建前後。另有每輪 2,499 項 relation ACL 與 246 項函式權限檢查。
- 第二輪使用專案指定的 pnpm 10.28.2 與 Functions 獨立鎖檔執行依賴稽核。當時三個範圍均無已知高風險或重大公告，全工作區有 5 筆中度、1 筆低度公告。第三輪 Hono 修補後的實際 CI 報告列於下方，範圍間有重疊。
- 雲端 Python AI 服務按雜湊安裝鎖定的 50 個套件，pip-audit 回報無已知漏洞。助理工具寫入權限、身分驗證、監聽介面與啟動邊界等 63 項測試通過。新增測試以替身涵蓋報修、訂餐及提醒三種工具，確認各自的設定、缺少身分、下一次呼叫前撤銷權限及讀取設定失敗的情況。
- Gitleaks 對基準 Git 歷史依專案既有排除清單掃描，沒有新增命中。另對原始碼快照獨立掃描的 13 筆命中，為 Firebase 用戶端設定、雜湊、儲存鍵及測試用識別碼。未查詢正式金鑰限制或管理後台。

## 建置回歸

第一輪提交 `f059dab85ca63b882d2c87fe5fa403e2e35e697d` 的遠端 Web、Functions、手機、Firestore 規則、Security Gates、Lint 與型別檢查皆通過，Supabase 權限、CodeQL、Mobile Agent Regression 與 Maestro iOS 工作流程亦通過。

該提交的 Web 容器建置在舊課表讀取路由失敗，原因是路由引用的 `backend/functions/personalCampus.js` 超出 Web 映像的複製範圍。後續將公開課表資料過濾與讀取邏輯移至共用套件，兩個伺服器入口共用此實作。以只包含 Web 與共用原始碼的環境重現舊版編譯失敗，修正後成功編譯。共用套件型別、路由型別及個別 ESLint 檢查通過。完整容器及整合結果由 PR 的最新提交重新執行 CI。

## 發布與適用範圍

### PR #517 合併後補查（2026-11-09）

- 私有 Firebase 附件的 canonical `users/{uid}` 文件必須存在；文件已刪除時，即使群組與學校會員文件仍為 active，GET／POST 均回傳相同的 403 `File access denied`，不揭露拒絕原因。單元、transport 及 emulator 的正常授權 fixture 均建立帳號文件。
- 下載方案選擇保留現有的「每次驗權後直接串流」，不另發 signed URL：`privateGroupFiles.js` 每次重新查核帳號、群組及學校資格，GET 只回傳附件 bytes，POST 只回傳 path，不回傳或保存 Firebase token URL。回歸測試使用帶有 legacy token metadata 的物件，確認回應不含 token／導向網址，並驗證同一 ID token 在撤權後再次下載會被拒絕。這比增加 60 秒 bearer URL 更少改動，也沒有新簽發 URL 的撤權空窗。
- Supabase 作業附件目前已拒絕新的 signed URL 簽發，保留每次受 RLS 驗權的 authenticated 下載；另一個 materials bucket 的教材入口 `lmsV2MaterialAccess.ts` 已使用每次開啟重新簽發的 60 秒網址，不延長或保存它。
- **上述方案不會追溯撤銷已發出的 bearer URL。** Firebase 舊 token 仍須由既有清理工具清除並驗證；Supabase 舊 signed URL 仍須等原期限結束，或另行完成既有部署程序的撤銷處置。不得將入口修補視為舊網址已立即失效。本次沒有執行清理、正式環境腳本或新增 migration。
- 範圍判斷以 `git diff origin/main HEAD` 為準，以下均保留：SSO ACS 的 256 KiB 串流上限與對應測試防止匿名過量讀取；GET 回應建構方式確保可設定既有安全標頭。登入返回網址的正規化後檢查與回歸測試防止 open redirect。RAG indexer 的 Rust backend 與原始 embedding/schema 白名單避免不受信任的持久化設定重建可執行 loader，相關邊界／相容性測試與 CI 是這項安全限制的驗證。`package.json` 和 `pnpm-lock.yaml` 的 Hono adapter 1.19.17 → 2.1.3 是下述安全公告修補，MCP JSON／SSE 測試驗證相容性；`test:rules` 新增的兩個 emulator 套件則直接涵蓋課堂與附件安全。本次沒有無關片段需要還原，也沒有改動依賴版本或 lockfile。
- 本次驗證：工作目錄未安裝依賴，借用本機既有依賴，以 Node 24.22.1／Jest 關閉 Babel transform 執行 `privateGroupFiles.test.js`，57/57 通過；不是專案指定 Node 22 的乾淨安裝驗證。擴大執行時，migration 套件 20 項通過、2 項 CLI 子行程受 `spawnSync EPERM` 限制失敗；transport／HTTP adapter 因借用依賴的 ESM 載入問題未能啟動。預設 Babel 設定亦缺少 plugin，未改動專案測試設定來掩蓋環境問題。`git diff --check` 通過。

部署時先更新含舊連結讀取路由的 Web 及兩個課表分享寫入入口，再發布限制直接讀取的 Firestore 規則。Storage 規則、Cloud Functions 與 Supabase migration 也都需要各自發布。既有繳交紀錄保留原時間，本次未嘗試回推歷史繳交時間。

本機 RAG 使用嵌入式 ChromaDB。1.5.9 仍有上游重大公告，雲端鎖檔未包含此套件。現有邊界測試確認 FastAPI 沒有掛載 Chroma HTTP API，程式碼追蹤也尚未找到遠端使用者能控制 collection 模型設定的完整路徑。完整本機 ML 相依圖仍待驗證。[上游安全公告](https://github.com/advisories/GHSA-f4j7-r4q5-qw2c)

第三輪檢查官方 PyPI 的 Chroma 1.5.9 wheel 並核對 SHA256，確認 collection 設定和 schema 皆可能重建 embedding function。修補在任何查詢、索引或刪除之前，檢查原始設定只使用既有預設模型，並明確固定 Rust backend，避免環境變數選到含 pickle 載入路徑的 legacy Python backend。自訂 persisted embedding、非空 CMEK 與未知 schema 根欄位會停止該次操作。

RAG 新增 8 個測試方法，套用在原始 indexer 時有 31 個拒絕斷言失敗，修補後全部通過。測試使用不會載入模型的替身，同時驗證預設、空設定、舊 HNSW JSON 與名稱為 embedding_function 的正常 metadata。完整 Python 套件現為 71/71 通過。這些結果涵蓋應用程式防禦，上游 critical 公告仍保留追蹤。

Chroma 持久化 CI 的 seed 與 rollback 使用固定提交 `1bca9d770e996106c4a495442d16bba9d413f455` 的舊版應用程式及 Chroma 0.5.23。候選版本以目前程式、Chroma 1.5.9 與兩個 NumPy 版本驗證遷移、重啟及重新寫入。原始備份按 SHA256 核對，再由舊版程式讀取還原副本。提交 `569324438b6bd1c3556b2fb18e55f9db4d81164a` 的 NumPy 1.26.4 與 2.5.4 兩組均完成通過。[原生相容性 CI](https://github.com/Miiduoa/graduation/actions/runs/42220923913)

Firebase 作業附件採建立後不可變更的策略。現有 Firebase Web 與手機送交流程使用文字，程式庫中的 Nuni 檔案送交另走獨立 BFF。依目前原始碼使用狀況，本輪關閉三個 legacy 私有 namespace 的直接 Storage SDK 存取，並提供相同路徑的 Bearer token HTTP 入口。

## 第三輪私有附件與撤權

### Firebase 授權入口

第三輪在原規則的隔離模擬器重現校籍撤銷缺口。學生與教師原本都可讀取群組貼文及學生作業附件，僅將 canonical school member 改為 inactive 後，四次讀取仍全部回傳 200。作業路徑原本已使用兩份 Firestore 文件，新增校籍查詢會超過 Storage 規則上限，因此改用伺服器入口逐次驗證 canonical 資料。[Firebase 官方規則限制](https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_cloud_firestore)

`privateGroupFile` 接受 GET 與 POST，物件路徑放在 `path` 查詢參數，身分使用 Firebase Bearer ID token 並檢查 token 是否撤銷。入口在唯讀交易內確認帳號狀態、群組、群組成員、校籍及作業歸屬。本人或目前有管理權的教師才可讀取作業附件，本人才能上傳自己的作業附件。

- 群組封面、貼文附件、作業附件大小上限分別為 5、20、50 MiB，沿用既有嚴格小於上限的規則。HTTP 平台本身的限制仍適用。
- 上傳有 30 秒絕對期限，每個 handler 最多同時處理兩筆，讀完內容後再次查核資格。
- 貼文與作業使用 `ifGenerationMatch=0`，封面替換使用讀到的 generation。讀取也釘選 generation，並累計解壓後實際輸出量。
- 回應使用 `private, no-store`、`nosniff` 與 attachment 檔名。未授權先回 403，授權通過後才檢查物件是否存在。
- Fly HTTP adapter 將這個入口的串流交由專用 handler 管理。兩個新增回歸在舊版分別得到 413 與等待未授權本文逾時，修補後完整 adapter 套件 15/15 通過。

### Firebase 舊下載權杖

`scripts/revoke-private-group-file-tokens.cjs` 預設 dry-run，要求明確 project 與 bucket。工具以 `versions: true` 分頁掃描兩個固定 prefix，再由共用路徑解析器限縮為三個私人 namespace，逐一處理目前與非目前版本。加上 `--apply` 後，只清除下載 token 並保留其他 metadata。寫入同時比對 generation 與 metageneration，隨後重新讀取同一版本確認生效。衝突、驗證失敗或任何讀寫失敗皆會使 CLI 回傳非零，輸出僅包含目標與統計。

追加檢查確認，GCS 非目前版本具有獨立 metadata，普通列表會略過這些版本。原清理程式在三版本合成案例中回報成功 1 筆、失敗 0 筆，另外兩個版本仍保留 token metadata。修補改用列舉結果的原始 `metadata.generation` 字串，於 metadata GET、PATCH 及驗證 GET 明示相同 generation。取得的版本不符時，即使回應沒有 token 也記錄失敗。這項重現確認版本 metadata 清理漏項，Firebase bearer URL 對 generation 參數的實際支援仍待 staging 確認。[GCS 版本 metadata](https://docs.cloud.google.com/storage/docs/object-versioning#noncurrent_object_metadata)

Firebase Admin 實際依賴的 `@google-cloud/storage 8.4.0` 會將 `File.generation` 轉為 Number，合成值 `9007199254740993` 因而失去精度。回歸測試使用該 SDK 的公開 API，僅替換 transport，確認原始字串能完整傳入三次請求與兩項 CAS。測試亦涵蓋同名目前／非目前版本、只有非目前版本的檔案、逐筆分頁、metadata 保留與重跑冪等性。相同測試套用修補前程式得到 8 failed／14 passed，修補後 22/22 通過。[GCS 版本列舉與 selector](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/list)

Firebase CLI 15.34.1 的 Storage emulator 缺少 GCS generation precondition 實作，metadata PATCH 也不會清除其獨立的 downloadTokens 陣列。整合測試因此驗證 canonical 授權、正常 HTTP 讀寫及清理未生效時的錯誤回報，GCS SDK 序列化測試另外確認版本條件有送到請求。真正 Cloud Storage 的原子競爭與舊 token 失效，仍需隔離 staging bucket 驗收。

部署時先準備授權入口與必要的呼叫端，再發布關閉直接存取的 Storage 規則，接著執行 token 清理與確認。既有 bearer 下載網址須在清理完成後才可視為已撤銷。本輪正式環境尚未執行這些發布與清理。

### Supabase 作業附件

新增 migration `20261106123311_enforce_submission_storage_integrity.sql` 核對路徑中的課程與作業關係、學生身分及目前修課資格。既有物件禁止 authenticated 角色覆寫、刪除與跨 bucket 搬移，新的附件版本使用新檔名。繳交紀錄的新指標必須對應已存在且可讀的本人附件，保留未改動 legacy 指標的正常批改能力。

原始 32 項政策測試中有 15 項失敗，重現錯課程路徑、覆寫、刪除與偽造附件指標。修補後擴充至 53 項 SQL 權限測試與 53 項 PostgREST HTTP 測試，全新、升級及重建前後四輪均通過。HTTP 新案例實際驗證正常附件建立收據、拒絕他人或缺少的附件，以及保留原指標的教師批改。

Storage 的預簽上傳會在授權檢查後，使用提升權限的寫入路徑。對尚未存在的檔名預先取得可覆寫 token，會使日後的 UPDATE RLS 無法完整保護物件。因此本輪另限制 Storage operation，只允許標準 authenticated 上傳、讀取、列出與資訊查詢，拒絕新的簽名上傳與下載 URL。Data API 的附件指標查核，僅允許在 trigger 內以空 operation 讀取。實際 Storage HTTP 測試由一次性 Supabase CI stack 執行。[Supabase Storage 官方實作](https://github.com/supabase/storage/blob/master/src/http/routes/object/uploadSignedObject.ts)

已經發出的 Supabase signed URL 仍受既有期限與簽名金鑰控制。部署前須盤點有效期限及撤銷方式，才能完成正式環境驗收。這輪程式政策會阻擋後續簽發，無法單靠 RLS 使舊 bearer URL 立即失效。

### 本輪驗證狀態

私有附件 handler 54/54、HTTP adapter 15/15、token migration 22/22，以及真實 Node socket transport 4/4，共 95 項在 Node 22.23.4 合跑通過。後者使用實際 onRequest wrapper 與 function registry，包含 11 MiB binary 上傳、撤權及驗證期間與上傳途中斷線，確認後續正常請求可立即成功。新增的 5 項 Firebase emulator 與更新後 15 項 Storage 規則案例已接入 `pnpm test:rules`。提交 `1ef078d2` 的 CI 已取得完整 Node emulator 250/250 與 Web emulator 32/32，新增案例均有執行。

Supabase 一次性 stack 追加 10 個真實 Storage HTTP 子情境，包含 bytes 讀寫、PUT/upsert、刪除、單筆及批次簽名 URL、路徑綁定，以及持有相同 JWT 的學生與教師撤權。提交 `1ef078d2` 的 CI 在全新、第二次重建、歷史升級三個情境中，各完成 53 Storage SQL、53 PostgREST HTTP 與 10 個真實 Storage HTTP 子情境，全數通過且沒有略過。本機的原生 PostgreSQL runner 另取得四輪 53 SQL 與 53 PostgREST HTTP 全綠。[Supabase 整合結果](https://github.com/Miiduoa/graduation/actions/runs/42232908690)

同一提交的主 CI 已完成 Functions 124 套件共 1,760 項、Web 10,143 項與 Assistant HTTP 13 項。Web 40 項略過中，32 項在上述 emulator 工作執行，7 項需要 `NUNI_TEST_POSTGRES_PORT`，另 1 項為主線既有停用測試。兩個需要 archived source 的部署來源檢查亦維持條件式略過。Web 容器建置後實際啟動，`/health/live` 與 `/search` 驗證通過。版本清理追加修補的完整 CI 與 Maestro 狀態以 PR 的精確 head 紀錄為準。[主 CI](https://github.com/Miiduoa/graduation/actions/runs/42232908763)

針對 PostgreSQL 條件式測試，使用一次性 PG15 補跑 assignmentFileStore 7/7 與 assignmentFileService 36/36，合計 43/43 通過。後者另含 6 項在 CI 環境變數缺少時未加入清單的 PG 變體，因此共補足 13 項真實 PG 案例。資料索引使用真實 PostgreSQL，附件 bytes 與上游平台使用既有合成 fixture。既有 CI 尚未接入這組資料庫條件，測試後已移除暫存 cluster。

### 資料庫函式安全檢查

本機 security advisors 發現四個未固定 search_path 的內部函式。新增 `20261106131129_pin_internal_function_search_paths.sql`，只為 `_quiz_normalize_answer(text,jsonb)`、`_quiz_answer_correct(text,jsonb,jsonb)`、`quiz_attempts_before_insert_guard()` 及 `set_updated_at()` 固定 `pg_catalog, public, pg_temp`。identity arguments、SECURITY INVOKER 與原本 volatility 均核對，四個新 catalog 斷言在原版先失敗，修補後隨四輪完整資料庫測試通過。

Advisors 從 1 ERROR、6 WARN 降為 1 ERROR、2 WARN。剩餘 ERROR 是既有的 SECURITY DEFINER 公開課程目錄，專案已明確固定公開欄位及公開／未封存條件，匿名 API 測試驗證 enrollment_code、owner_id 無法外露。兩個 WARN 是原生 PostgreSQL 測試環境的 pgcrypto、pg_trgm 位於 public，實際 Supabase 預裝 extension 的位置須依 CI stack 核對。

### Hono 相依修補與稽核限制

現有 MCP SDK 1.32.2 支援 Hono Node adapter 的 1.x 及 2.x，但專案 override 固定在受公告影響的 1.19.17。本輪將這個限定相依更新至修補版 2.1.3，Node >=20 的要求符合專案範圍。鎖檔只有六行替換，官方 tarball SHA-512 與 registry integrity 核對相符，workspace importers 均相同。一般解析工作區進度過慢後，使用已核對的官方 package metadata 產生這個節點的最小變更，再由 pnpm 10.28.2 的 frozen/offline lockfile 檢查確認。[Hono 官方安全公告](https://github.com/advisories/GHSA-rmxm-3fg6-px4f)

既有 dependency compatibility 檔案擴充後 5/5 通過，涵蓋真實 MCP JSON／SSE HTTP、session、notification 202、auth context、關閉流程與 ESM export。本機使用 Node 22.15.0 及隔離下載的 Hono 2.1.3，CI 使用乾淨安裝與固定 Node 22.23.4。

本輪本機直接重掃遭自動核准審查拒絕，理由為送出依賴名稱與版本清單到 npm registry 需要更明確的授權。後續沿用專案既有 CI 的 audit 工作，提交 `1ef078d2` 已取得三份實際政策報告。workspace-prod 為 0 critical、0 high、3 moderate、1 low，workspace-all 為 0 critical、0 high、4 moderate、1 low，functions-prod 為 0 critical、0 high、2 moderate、0 low。數量是公告項目，範圍之間有重疊。

其餘依賴的唯讀追蹤顯示，現有 uuid 呼叫主要為 v4，該公告描述的是自訂 buffer 的 v3／v5／v6 邊界。OpenTelemetry Core 的已查得路徑是 Firebase CLI／PubSub 的 trace-context。deepmerge 的 low 告警位於手機 Jest 設定相依。這些結論代表已檢查的呼叫路徑，套件告警仍維持可見。

glob、minimatch 同時出現在工作區 pnpm 與 Functions 獨立 npm 圖，包含 Firestore 經 google-gax／gaxios、rimraf、glob 的正式 optional 依賴。核對精確官方 tarball 後，尚未找到 google-gax／gaxios 執行時呼叫 rimraf，亦尚未找到應用請求可達的 pattern 入口。有界測試確認 minimatch 在 optimizationLevel 2 會放大特定 pattern，因此仍保留修補需求。

隔離相容性測試確認，單獨將 minimatch 換成 11.0.1 會使 glob 10.5.0／13.0.0 的正常兩檔查詢回傳空集合。Functions 全域 brace-expansion 1.1.21 override 也與其獨立 npm dev 圖中的 minimatch 10.2.6 具名 expand API 不相容。後續調整須協同 glob、minimatch 與 brace-expansion，並驗證兩套鎖檔、ESLint、Jest、Expo 與使用 `npm ci --ignore-scripts` 的 Firebase／Fly 封裝。

### Supabase CI 結構差異回歸

提交 a4d4351d 的真實 Supabase CI 發現 SQL 測試使用的 ON CONFLICT(bucket_id,name) 在目前 Storage schema 沒有對應 arbiter。上游 migration 已移除此索引，原生測試 bootstrap 的額外 unique 掩蓋了差異。本輪移除測試專用的多餘 unique，先重現相同的 42P10，再讓兩個 upsert 案例使用兩邊都存在的 PRIMARY KEY(id)。預簽案例維持 sign_upload_url context，真正覆寫案例明確使用正常 upload context，拒絕判定仍要求 42501。四輪 53 SQL、53 HTTP 再次通過，真正 Storage API 的 upsert 案例持續由 CI 執行。


## 2026-11-07：真實 PostgreSQL 附件回歸納入主 CI

既有 `Web Tests` job 未設定 `NUNI_TEST_POSTGRES_PORT`，因此 `assignmentFileStore.postgres.test.ts` 的 7 項競態案例與 `assignmentFileService.test.ts` 的 6 項 PostgreSQL 變體未納入正式 Web CI 計數。本輪已調整 `.github/workflows/ci.yml`：在 `test-web` job 加入獨立 PostgreSQL 15 服務，使用僅供 CI 的 `box` 測試帳號與 `postgres` 測試資料庫，並在定向與完整 Web Vitest 執行時明確傳入 `NUNI_TEST_POSTGRES_PORT=5432` 及測試密碼。定向步驟先執行兩個附件套件，避免資料庫不可用時誤將略過當作通過；完整 Web 測試沿用先前的 coverage 步驟。

**驗證狀態：** 修改已提交，但此變更的 GitHub CI 新提交結果尚待確認，不得把上輪在一次性本機 PG15 測得的 13／13 當作本提交的雲端 CI 成功。確認後需核對定向步驟實際執行 PostgreSQL 案例，且主 Web、Functions、CodeQL、Supabase、Python、Mobile 與適用 Maestro 均對應精確 head。若另有測試在 CI 出現競態超時，應先保留失敗證據並修復測試隔離／邏輯，而非停用案例。

本次只修改 CI 測試環境與本文件；沒有執行正式資料庫 migration、下載 token 寫入、發布或 GitHub App 核可。先前列出的 GCS staging 憑證、舊網址撤權驗收、主線審查閘門及相依相容性缺口仍未解除。


## 2026-11-07：Storage 停權狀態與校園貼文附件存取

本輪讀取完整的 GitHub 精確 head `358a9fd8`，其 CI、CodeQL、Supabase permission migrations、Python、Mobile Agent Regression 與適用 Maestro 都顯示成功；審查紀錄與未解決 review thread 目前均為空，但指定 App `nuni-merge-gate` 的「審查通過」尚未出現。main `cacea7e6`，分支相較 main ahead 12 / behind 2，新的主線整合仍待獨立驗證。

從 Storage 規則查得另一項授權一致性缺口：原 `isActiveAccount()` 對明確設為 `disabled`、`suspended`、`inactive` 的帳號不拒絕（只擋 `deleted` 與刪除程序）；`schools/{schoolId}/campusPosts` 原先只看學校成員文件，對保留 `active` 的舊校籍資料未檢查帳號狀態。此缺口可使停權身分持舊 ID token 在規則允許的私人附件與校園貼文路徑繼續讀取或上傳。新增的規則將這四種終止狀態視為拒絕；校園貼文用相同帳號檢查，保持未建立 users 文件的既有相容情境。

回歸補強 `backend/tests/security-rules.test.js`：原關閉帳號私人檔案測試增加 disabled、suspended、inactive 三種狀態，覆蓋 temp、health、printjobs、兩類私訊及報修附件的讀寫拒絕；獨立校園貼文附件案例涵蓋正常寫入／讀取、停權後的舊物件讀取與新物件上傳拒絕，以及恢復 active 後正常讀取。原規則對非 deleted 狀態及保留校籍的路徑缺少這些拒絕條件；本輪變更提交後的 Firebase 模擬器／主 CI 以新精確 head 的執行結果為準，未將先前 CI 綠燈當成此修補已驗證。

**剩餘邊界：** 校園限時動態讀取目前同時查學校成員及 story 文件，部分公告／活動編輯路徑同時查目標與學校管理員文件；Firebase Storage 規則的 Firestore 文件查詢上限限制了直接再加一份 user 文件的方法。此輪不在這些路徑套用會導致合法請求全面拒絕的第三份文件查詢；後續應比照私有群組檔案的 HTTP 授權入口或調整權限資料模型，單獨對停權及撤權做模擬器驗收。真 GCS staging 與既有 token 移除、Supabase 已簽發 URL、minimatch 相容性、正式發布條件仍未解除。

本輪變更只包含 Storage 規則、隔離測試及本紀錄；沒有寫入正式資料、清理真實 token、改動正式金鑰或部署。

## 2026-11-07：校園貼文 Storage 規則在 CI 的相容性修正

精確 head `83b45fdb9571b3252f56863325cba17dfc3b1753` 的主 CI [42292144769](https://github.com/Miiduoa/graduation/actions/runs/42292144769) 失敗於 Firebase Storage 規則：`a shared upload cannot be replaced at schools/pu/campusPosts/one/photo.jpg` 的首筆合法建立回傳 `storage/unauthorized`；251 個 Firestore/Storage 案例通過 250、失敗 1。CodeQL、Supabase、Python、Mobile Agent、Functions、Web、型別檢查均成功，Maestro 當時仍在進行中。本輪先處理這個實際 CI 失敗，沒有把被拒絕的合法操作改成預期失敗。

原因候選為 `isSchoolMemberStorage()` 先對相同 membership 文件呼叫 `firestore.exists()`，接著 `firestore.get()`，與 `isActiveAccount()` 的 canonical user 文件查詢一起增加了 Storage Security Rules 的跨服務文件查詢負擔。獨立的校園貼文停權案例已明確建立 `users/alice` 文件並通過，失敗的共用檔案覆寫回歸則只建立了學校 membership，符合現有無 user 文件的 legacy 身分相容案例。

本次將 membership 判斷簡化為單次 `firestore.get(...).data.status == 'active'`。文件不存在時評估拒絕，不再另做 `exists()`；`isActiveAccount()` 對已存在帳號的 `deleted/disabled/suspended/inactive` 拒絕保持不變。原有合法建立、不可覆寫、停權與撤權回歸均保留，沒有為了讓 CI 變綠而停用案例。這是有待在新精確 head 的 emulator CI 實測的修補，**不能在執行前宣稱通過**。

**重要剩餘風險：** `isActiveAccount()` 仍為兼容 legacy 無 canonical user 文件的身分而允許缺少 `users/{uid}` 文件的 token。若刪除／停權程序只移除 user 文件卻留下 active school membership，可能延遲撤權；需在實際 deletion workflow 驗證清除學校 membership，或以可信的單一權限來源改造這一資料模型。在完成驗證前不得宣稱所有已刪帳號的舊 token 都已撤銷。此輪未修改正式資料或執行正式發布。

### 21:14 UTC 再驗與正式收斂

第一次最小化相同 membership 的 `exists + get` 為單次 `get`，但精確 head `8503c10b` 的 [Rules CI](https://github.com/Miiduoa/graduation/actions/runs/42294746416) **仍在相同合法建立案例失敗**（250/251），因此先前「僅因重複查詢上限」的原因假設未被驗證，不視為已解決。這一輪繼續追查缺失的前置條件，而不是跳過測試。

對照兩組 storage 回歸發現，正常建立成功的 `schools/pu/campusPosts` 案例有 `users/alice` canonical 文件；共用覆寫案例只有 `schools/pu/members/alice`。為避免帳號已刪除、canonical 文件遺失而校籍 membership 孤留時繼續持舊 token 存取校園附件，這個 namespace 現在**明確要求 canonical user 文件存在**，並保留 `isActiveAccount()` 的停權狀態拒絕以及 `members/{uid}.status == active` 的跨校授權。此策略僅修改校園貼文附件，不擴大至未驗證的其他命名空間。

更新既有「上傳不可被其他人覆寫」測試，使 Alice/Bob 都有真實 `status: active` 的 canonical 文件，維持首筆合法上傳成功、第二人覆寫與刪除失敗；新增無 canonical user 文件而學校 membership 留存時**必須拒絕讀取既有檔案及新上傳**的負向案例；既有檔案由規則停用的 emulator fixture 預先建立。此方式不削弱授權來讓測試通過，但會讓歷史上只有學校 membership、未完成 user profile 建立的帳號暫時無法上傳／讀取該類私有校園附件。發布前須盤點、補齊真實 legacy 帳號的 canonical profile，不能盲目在正式環境打開規則。不同套件仍在各自隔離 emulator 中驗證。

此修正推送後才可由精確 head 的 CI、CodeQL、Supabase、Python、Mobile Agent 與適用 Maestro 判斷結果；截至本段記錄時**尚未取得新版本完整 CI 成功結果**，沒有合併、正式資料修改或部署。

### 同一檔名的跨案例隔離檢查

再次查核精確 head `3bcdb64b` 的 GitHub [Rules CI](https://github.com/Miiduoa/graduation/actions/runs/42295543338)，在明確建立 `users/alice,bob` 且增加孤兒校籍的負面回歸後，252 個模擬器案例仍有 1 個失敗：共用覆寫案例的首筆合法 `schools/pu/campusPosts/one/photo.jpg` 上傳被拒絕。新孤兒校籍拒絕讀取及寫入案例、停權與恢復案例均通過。`one/photo.jpg` 同時被前一個「停權帳號校園貼文附件」案例建立過，雖然共用 beforeEach 有 clearStorage，本輪將共用覆寫案例改用獨立 `replacement-proof/photo.jpg` 路徑，避免不同測試共用同一物件名稱。原來的「合法建立成功、他人不可覆寫、不可編輯 metadata、不可刪除」斷言沒有移除。此為跨測試隔離的待驗證假設；若新 CI 仍失敗，須保留證據進一步查權限前置資料、條件執行或模擬器資料清理，不能直接宣稱已修補。

### 會話附件：canonical user 刪除後的殘留會員授權

本輪在原 PR #517 進一步檢查 `conversations/{conversationId}/messages` 與 `conversations/{conversationId}/media` 的 Storage 規則。`conversationMember()` 原先允許 `users/{uid}` 文件不存在，而若 `conversations/{id}.memberIds` 殘留舊 UID，仍可能憑先前簽發且尚有效的登入 token 讀取既有私訊附件或上傳新檔案。這不同於已公開的 Firebase Storage bearer 下載 URL；下載 URL 撤銷另有遷移流程，不能被本次 SDK 規則變更替代。

將 `conversationMember()` 加入必須存在 canonical `users/{uid}` 文件的檢查，同時保留既有 `isActiveAccount()` 對刪除中、deleted、disabled、suspended、inactive 的拒絕。此路徑最多查詢兩份不同 Firestore 文件（canonical user 與 conversation），沒有超過 Cloud Storage Rules 的兩份文件上限；同一路徑重複查詢會由規則引擎快取。已新增兩種私訊附件路徑的隔離 emulator 回歸，驗證：只有殘留 `memberIds` 時，舊附件讀取及新附件寫入被拒絕；補回合法 active profile 時，合法讀取及上傳可用；再次刪掉 profile 後，同一個登入 context 再次被拒絕。

**變更驗證：** 這一段更新所對應的程式與測試已推到安全分支，尚須以提交後精確 head 的 Firebase Storage emulator 及完整 CI 結果判定，未在此預先宣稱通過。此修補可能使只有殘留 conversation 成員清單、卻缺少 canonical profile 的 legacy 帳號無法存取私訊附件。正式發布前須盤點該類帳號並完成適當身分恢復與資料保留決策，不應恢復無 profile 的廣泛授權。其餘舊下載 URL、stories／events 兩文件查詢上限、GCS staging、正式 App 審查與 deployment 缺口維持開放。

### 校園帳號狀態：Firestore 與 callable 的停權拒絕一致化

進一步檢查發現 Storage 的 `isActiveAccount()` 已拒絕 `disabled`、`suspended`、`inactive` 與 `deleted`，但 Firestore `isSignedIn()` 只拒絕 `deleted`；包裝多數 callable 的 `accountLifecycle.assertAccountAvailable()` 也只拒絕 `deleted`。若 canonical `users/{uid}` 明確停權而校籍 membership 或過去取得的登入 token 仍有效，Firetore client 與部分 callable 原本仍可執行以 `isSignedIn` 為入口的操作。已同步擴充 Firestore 與 callable admission 的拒絕狀態，保留 `accountDeletionInProgress` 與匿名／新帳號既有邊界，也保留 callable 原本 `account-deletion` 機器可讀 reason，避免破壞既有客戶端契約。

將 Firestore 現有帳號關閉測試從 2 個狀態擴充至 5 個，驗證個人資料、群組、學校權限的正常與拒絕路徑；將 callable guard 單元回歸擴充至 5 個狀態，確認 handler 不執行。這些案例屬新變更，須以精確提交的 Firestore emulator、Functions、完整 CI 結果驗收，不預先視為測試通過。Firestore 公開資料 `allow read: if true` 不受此登入狀態判斷影響。仍需獨立查核所有未採用 `isSignedIn` 或 `createAccountGuardedOnCall` 的授權入口，並確保停權流程原子更新 canonical user 與會員資料。

此輪為隔離原始碼修補和新增測試，沒有修改正式資料、發布環境、金鑰、舊 token 或主線閘門。

### 將 canonical 帳號狀態標記改為伺服器管理

追查 Firestore `users/{uid}` 的更新規則，發現既有 affectedKeys 欄位清單保護 role、accountDeletionInProgress 等，但沒有保護 `status`。新提交將 `status` 納入禁止由客戶端修改／移除的權限欄位，不更動既有合法 displayName 和 notificationsEnabled 更新。現有權限欄位測試增加對缺少 status 的插入、已有 active status 的變更與移除三種拒絕斷言。此調整與停權判斷一致，避免客戶端竄改 canonical 帳號狀態。Admin SDK 伺服器對既有帳號的合法停權、恢復與刪除流程不使用 Firestore Security Rules 的 client update，因此不受此 denylist 影響。是否存在舊版客戶端直接操作該狀態欄位，仍待實機／版本相容性查核。

以精確 head 的 Firebase emulator 與 CI 結果驗證；若仍在佇列或執行中，不將它記為已通過。正式環境資料與發布沒有變動。

### 21:50 UTC 精確提交 CI 失敗與隔離 fixture 修正

GitHub 精確 head `c86ad270` 的 [Rules CI](https://github.com/Miiduoa/graduation/actions/runs/42299579448) 實際執行 257 個 Firestore／Storage 模擬器案例，256 通過、1 失敗。新增兩個「孤兒 conversation member」測試均通過；唯一失敗是既有 `closed, disabled and suspended accounts cannot reuse issued tokens for private files or uploads` 在尾端斷言 Bob 仍可讀私人會話附件。該 fixture 只建立 Alice 的 canonical user 文件，Bob 有 conversation memberIds 卻無 `users/bob` 文件。新規則應拒絕缺少 canonical user 的 Bob，因此測試舊資料配置不再符合「合法 Bob」前提。

本次只在該回歸的 seed 新增 `users/bob = {status:'active'}`，保留 Alice 停權後所有既有路徑的拒絕斷言，以及合法 Bob 的正常讀取斷言。沒有放寬 Storage 規則，也沒有移除任何新增失效案例。完整規則與其他工作在修補提交後重新執行，**尚待精確 head 結果，不視為已驗證成功**。


### 2026-11-07 08:45+08：撤銷店家帳號後的殘留 operator 權限（待精確 head CI 驗證）

Firestore 的 `requesterIsCafeteriaOperator()` 過去允許 canonical `users/{uid}` 不存在時，單靠餐廳 `operators/{uid}` 殘留記錄通過權限判定；而 operator 狀態只排除 `inactive`，使 `revoked`／`suspended` 亦可被當作有效。已針對餐廳營運員權限單點修補：要求 canonical user 文件存在且帳號不在停權或刪除狀態，同時 operator.status 必須**明確等於** `active`。涉及使用者與 operator 兩份文件，不依賴跨校角色推斷或第三份查詢。涵蓋店家訂單讀取、營業時間更新、菜單建立三個受影響入口。

新增 Firebase Rules emulator 回歸：殘留 operator 但無 canonical profile、active 恢復、disabled／suspended／inactive／deleted、operator revoked、再次刪除 canonical profile 的存取重驗；原有合法店家與即時訂單監聽測試補齊 active canonical profile fixture，拒絕其他店家與停用店員的測試不移除。這一輪尚未取得**新精確 head** 的整體 CI／CodeQL／Supabase／Maestro 成功結果，不應用前次提交代替。

**相容性注意：** 歷史上如果存在只有 operator 記錄、沒有 canonical profile 的合法店家帳號，更新規則後其訂單與菜單操作會拒絕；正式發佈前先盤點並透過受控 onboarding 補齊真正的 active profile，不應為求相容放寬「沒有 profile 仍授權」的條件。未改動正式環境或主線，尚待獨立 GCS、歷史簽發網址及正式審查核可。


### 2026-11-07 00:51 UTC：精確 head `b868d8ed` 的 Rules CI 失敗與資料前提修補

[Rules CI / run 42320495648](https://github.com/Miiduoa/graduation/actions/runs/42320495648) 已實際跑完第一輪規則測試：**258 案例、256 通過、2 失敗**。兩個失敗均為原本假設「合法店家 operator」但未建立 canonical `users/{uid}` 的測試 fixture：`school-responsibility-rules.test.cjs` 的外部 merchant 合法更新，以及 `security-rules.test.js` 的「學生和別家店不得改網址」中的 owner 合法更新。此次安全修補前，這兩組可因孤兒 operator 記錄而通過；新規則應拒絕缺失 canonical profile，所以原 fixture 已不滿足成功前提。

本輪只補 `users/merchant` 與 `users/merchant-1`／`users/merchant-2` 的 `status: active` 合法身分 fixture，保留「外部 merchant 不能繼承校方管理權」、非 owner 拒絕修改、可用性與輸入檢查，沒有放寬任何 Firestore 規則；新增的孤兒或停權 operator 侵入測試原本已在同輪通過。修補提交須以新精確 head 的 Rules CI、全套 CI 與必要工作流重新驗證，在完整驗證前仍不能合併或部署。


## 2026-11-07：敏感私人檔案的 canonical 帳號撤權

精確 head `9e9f97d7` 的主 CI、Firestore Rules、CodeQL、Supabase permissions、Python security、Mobile Agent Regression、Zod、Chroma 與適用 Maestro 均已完成 success；PR #517 的 reviews／未解決 thread 均為空，但尚無指定 nuni-merge-gate 的「審查通過」。主線已更新到 `36317460d47e1c977e2f78b6e0701e79b3f45077`，原安全分支與 main 仍 diverged，推送前未嘗試合併 main。

檢查 Storage `isActiveAccount()` 發現：當 canonical `users/{uid}` 文件不存在時，函式為保留部分 legacy 流程會回傳 true。若刪除帳號時先移除 canonical 文件、但 Firebase Auth 舊 ID token 尚有效，使用者仍可依 owner UID 或殘留報修單指標存取 `health`、`printjobs`、`temp`、`repairs` 私有檔案。既有狀態檢查只防範保留文件且標記 disabled／deleted 等情況；無法處理被直接刪掉的文件。

本輪新增 `hasCanonicalActiveAccount()`，對上述四種敏感私有命名空間的讀取與寫入同時要求 canonical user 文件存在且未停權，不改動無關 namespace 與既有最大容量、Content-Type 條件。新增隔離回歸在同一個 Auth context 驗證無 user 文件時舊檔不能讀、不能新寫；補回合法 active profile 後讀寫正常；再次移除 profile 後同一個 token 立即被拒絕。另一使用者即使 canonical profile active 也不能跨帳號讀取。使用真實 Firebase Storage/Firestore 規則模擬器，fixture bytes 和報修資料均為合成。

**狀態：** 上述為新提出的程式與測試，須以此變更提交後精確 head 的 Rules CI／完整 CI／CodeQL／Supabase／Mobile／Maestro 實際結果驗收；此處不預先宣稱通過。對 legacy 尚未建立 canonical user profile 的合法使用者，這四類附件會被拒絕，正式發布前應盤點、受控補齊真正 active profile，不可透過恢復孤兒 token 存取解決。已發 GCS Firebase bearer URL、Supabase signed URL、stories 兩文件查詢上限及真正 GCS staging 仍需獨立驗證。本輪未執行正式部署、金鑰變更、正式 token 清理、migration 或 App 核可。


### 2026-11-07：遭刪除管理員舊 token 的 bugreports 讀取與上傳撤權

上一輪 `aa135a0c` 的完整 CI、CodeQL、Supabase permissions、Python security、Mobile Agent Regression 與適用 Maestro 全數成功；該 PR 仍無指定 nuni-merge-gate「審查通過」。本輪另查到 Storage `isAdmin()` 只核對 ID token 的 `role: admin` 與 `isActiveAccount()`。後者為兼容部分 legacy 路徑，在 canonical `users/{uid}` 不存在時仍回傳 true，讓尚有效的舊管理員 ID token 在帳號文件刪除後仍可能讀取 `bugreports/{reportId}/{fileName}` 的私有照片。相同缺口也讓已失去 canonical profile 的普通登入使用者繼續建立新 bugreport 圖片。

這次只對管理員 role helper 與 bugreports 建立權限使用已存在的 `hasCanonicalActiveAccount()`，要求 canonical user 文件存在、未停權或刪除，並維持既有 token role、影像 Content-Type、大小與不可覆寫條件。管理員必須有 active profile 才可讀取私人報告；正常 active 使用者仍可新建報告，不把一般回報權限誤改成只有管理員可以上傳。

新增 Firebase Storage emulator 回歸，在同一個舊 token context 驗證管理員正常讀取、非管理員／訪客無法讀取、正常使用者上傳、刪除 canonical profile 後的讀取與新建拒絕、補回 active 後恢復、改為 suspended 後再拒絕。上述為**待精確 head 的 CI 執行驗證**，程式邊界的推論不等同已完成模擬器測試。

風險與相容性：沒有 canonical profile 的舊管理員將無法讀取 bugreports，沒有 profile 的登入使用者也無法新上傳該類附件；發布前應由受控帳號流程補齊真正有效的 profile，而非放寬舊 token。Firebase 下載 URL token 撤銷不受本規則變更取代，仍須隔離 GCS staging 驗收。此次未操作正式資料、金鑰、token、migration 或發布；仍須由既有主線窗口確認精確 head CI、CodeQL、Maestro、指定 App 核可。


### 2026-11-07：公開頭像與失物照片的孤兒 token 寫入邊界

核對前一精確提交 `8e8de2035ef383281df53f4d7526434ac05d6a22` 的 GitHub Actions：主 CI、CodeQL、Supabase permission migrations、Python AI Server Security、Mobile Agent Regression、Chroma、Zod、Course access review 及適用 Maestro 均為 completed/success；PR reviews 與 review threads 為空，但仍未看到指定 `nuni-merge-gate` App 5504170 對 head 核發「審查通過」。GitHub compare 回報當時 main `33e65c2b26848b60a9fea9b4272d19b73cb29760`，PR ahead 36、behind 8，尚未做正式主線整合。

前輪已將 health、temp、printjobs、repairs、bugreports 等敏感附件改為強制 canonical profile，但公開頭像 `avatars/{uid}.ext` 及失物照片 `lostfound/{itemId}/{filename}` 的寫入仍使用容許 `users/{uid}` 文件不存在的 legacy `isActiveAccount()`。因而在帳號主文件被直接移除而 Auth ID token 尚未失效時，舊 token 仍可能發佈新的公開頭像／失物照片，繞過帳號撤銷的寫入邊界。

此次僅將兩個公開上傳 namespace 的 **寫入／建立** 改為 `hasCanonicalActiveAccount()`，保持原有檔名約束、Content-Type、大小、建立／不可覆寫條件與公開讀取規則。新增 Firebase Storage emulator 測試用同一 Auth context 驗證：正常 active upload、直接刪除 canonical profile 後兩類新上傳拒絕、受控重建 profile 後恢復、再次 suspended 時拒絕、其他 active user 不得改 Alice 頭像；原有合法頭像測試補齊 active canonical profile fixture。原版在孤兒狀態的兩項拒絕斷言應失敗；本輪需以**新精確 head** 的 Rules CI 和完整工作流結果確認，不預先宣稱成功。

公開讀取仍是既有產品功能；此修補**不會**撤銷已發公開物件網址或過去已公開影像。缺少 canonical profile 的合法 legacy 帳號將無法建立這兩類附件，正式發布前需由受控 onboarding 修復資料。stories 和 events 編輯路徑受跨服務兩文件查詢上限限制，尚未解除；GCS 歷史下載 URL、Supabase 已簽發 URL、隔離 staging bucket 驗證、minimatch 相容性與正式審查仍待完成。本輪只修改原始碼、隔離測試與紀錄，未合併、部署或操作正式資料／金鑰／token。


## 2026-11-08：校園限時動態過期媒體與超長效期邊界

原 schools/{schoolId}/stories/{storyId} Storage 規則僅檢查學校成員、作者 metadata 與故事型態；已發布故事的 expiresAt 即使過期，其他同校帳號仍可對舊物件進行受規則管控的讀取。作者的直接讀取分支也不要求 published metadata 有效。另 campusStories Firestore 建立規則只要求 expiresAt 非空，允許客戶端自行寫入任意未來期限，與手機端一日限動的產品期限不符。

此次在既有兩份 Firestore 跨服務文件查詢額度內，區分未發布草稿（僅 owner 可 preview）與已發布故事（包含 owner 在內須由 story 的作者、媒體型態及毫秒期限驗證）。校園限動發布時要求 expiresAt 為 epoch milliseconds 整數，晚於伺服器現在且不超過未來 24 小時加 5 分鐘時鐘容差。原有效草稿與正常發布讀取仍應可用。

新增 Firebase emulator 定向回歸：草稿本人可讀、他人不可讀；七日未來期限與過去期限拒絕建立；正常兩分鐘期限可以發布且兩個帳號可讀；將故事改成過期後，原本同一枚登入身分對作者與同校成員的規則讀取都必須拒絕。這項是程式與可重跑測試的修補，**GitHub 精確 head CI 尚待驗證**，不得借用先前 head 綠燈。

**仍受限的範圍：** Firestore campusStories 的舊資料讀取規則，以及已簽發的 Firebase/GCS bearer download URL，不能由這次 Storage SDK 規則變更立即撤銷；前者的列表查詢目前只以客戶端過濾過期項目，需要另設與查詢相容的服務端策略，後者仍需隔離 GCS staging 進行網址失效驗證。原 stories 的身份撤權仍受 Storage 最多兩份 Firestore 文件查詢限制；已刪帳號舊 token 且 school membership 尚存的全面撤權未在本輪完成。正式環境未修改、未執行 migration／token 清理、未合併部署。


## 2026-11-08：已過期限動的 Firestore 單筆查詢與觀看紀錄撤權

本次接續 `4a6e1e0e` 的 Storage 過期媒體修補，獨立追查 Firestore `campusStories` 的 `allow read`。原規則僅檢查學校成員，不核對 `expiresAt`；同校帳號可利用已知 storyId 直接 `get` 已過期本文，並透過 `storyViews` 的讀取／建立路徑繼續存取或寫入過期故事的觀看者資料。

將根文件的單筆 `get` 限定為毫秒整數期限且必須晚於伺服器時間；`storyViews` 的讀取與建立需重新驗證父故事有效期限、學校成員資格與 viewerUid。保留刪除權限與既有建立流程，對無有效期限的舊資料採 fail-closed。新增既有 Firebase emulator 限動案例的正常／過期 Firestore 單筆讀取、正常 viewer 建立讀取，以及過期後同一 token 拒絕讀取／新增觀看紀錄斷言。

**已知限制：** 為不在沒有查詢遷移與索引的情況下直接切斷目前手機端 `listActiveStoriesForSchool`（schoolId + createdAt 的列表查詢），此次保留 `allow list` 與既有學校資格檢查。因此過期故事的 Firestore 列表 metadata **仍可經原始 SDK 列表讀取**；這不是全面過期撤權，必須在後續版本把客戶端列表改成與伺服器授權相容的有效故事查詢或受權限控管的後端列表，再收斂 `allow list`。已簽發的 Firebase/GCS bearer URL 也不受此修補影響。

**驗證界線：** 已以原始碼及官方 Firebase rules timestamp 文件確認 `request.time.toMillis()` 的型別與方法；目前隔離執行環境沒有 Firebase emulator／依賴，未在本機實際跑 Firebase 規則。本提交測試案例需要 GitHub 對精確 head 的 Rules CI 才能驗證；前一 head `4a6e1e0e` 於本輪查核沒有 GitHub check runs，PR 因與最新 main 衝突顯示 `mergeable_state=dirty`，不得宣稱已通過。未操作正式資料／token／migration／部署，指定 App 核可仍需獨立驗收。


## 2026-11-08：修正精確 head 的 Firebase Rules 編譯失敗

整合 main 的提交 `98eb9eaa` 啟動了真正的 Rules CI [42412749640](https://github.com/Miiduoa/graduation/actions/runs/42412749640)。模擬器於規則載入階段報錯 `L1756:75 Unexpected '_700_000'`，原因是前輪新增限動建立時使用 JavaScript 風格數字底線 `86_700_000`，Firestore Security Rules 文法不接受。該次 263 項測試的失敗／取消是**規則未能編譯**，不能據此認定授權回歸通過或不通過。

本次只將該數字字面值改為 `86700000`（仍為 24 小時加 5 分鐘的毫秒值），保留過期邊界、原有安全限制與新增測試。已比對整份 Firestore 規則中唯一含底線的數字；修補需再次以新精確 head 的 Firebase emulator 與完整 CI 重新驗證。CI 未完成前不得合併或部署。


## 2026-11-08：限動觀看者紀錄的同校橫向讀取邊界

核對精確 head `60fdfed2d284184ede02f9d1ecbef24c1d286f00`：主 CI [42413042242](https://github.com/Miiduoa/graduation/actions/runs/42413042242)、CodeQL [42413042235](https://github.com/Miiduoa/graduation/actions/runs/42413042235)、Supabase permissions、Python security、Mobile Agent Regression 與 Maestro [42413042436](https://github.com/Miiduoa/graduation/actions/runs/42413042436) 已 completed/success；PR reviews／review threads 為空，`main` 是 `c686b16cc250e54c529a83043b0bb9489a360f05`，PR head 領先 41 提交、落後 0 提交。未發現由指定 nuni-merge-gate App 5504170 核發的「審查通過」證據，不能以 CI 綠燈取代。

新增檢查發現 `campusStories/{storyId}/storyViews/{viewerUid}` 既有 `allow read` 只驗證故事尚未過期及同校有效會員，並未限制 `viewerUid` 或故事作者。即使不是觀看者、也不是原作者的同校成員，也可能讀取已知觀看紀錄甚至列舉觀看者，造成觀看活動的橫向隱私曝露。

本次將 `allow read` 拆成 `get` 與 `list`：在既有故事有效期限與校籍檢查外，`get` 只允許觀看者本人或原故事作者；`list` 只允許原故事作者。新的故事作者判斷沿用 `activeParentStory()` 已讀取的同一份父故事文件，Firestore 規則引擎可對相同路徑使用快取。保留既有由本人新增觀看紀錄的權限，並未改動父故事列表、媒體或其他服務。

加入 Firebase 規則模擬器回歸：本人與作者可讀單筆；第三位同校成員讀取被拒；作者可查觀看列表、非作者的同校成員不得列舉；訪客被拒。舊版規則會允許第三位同校成員讀取及列舉；**目前僅新增可重跑測試與原始碼，應以新精確提交的 emulator 和完整 CI 結果判定，不預先聲稱通過**。如果舊版手機端嘗試讓非作者列舉別人限動觀看紀錄，新的限制會拒絕該行為；需要以實機操作確認此預期隱私邊界。

仍未處理：`campusStories` 的舊 SDK `allow list` 可返回過期 metadata；已簽發 Firebase/GCS bearer URL 及 Supabase signed URL 的即時失效、隔離真實 GCS staging、legacy canonical profile 資料修復、minimatch 相容性與正式發布前核可。沒有操作正式環境、資料、金鑰、token 或 migration，也沒有合併 `main`。

## 2026-11-08：限時動態列表 metadata 過期撤權（精確 head CI 待驗證）

前輪已禁止過期限動的單筆 `get` 與 Storage SDK 讀取，但 `campusStories` 的 `list` 仍只驗證校籍，手機原查詢只帶 `schoolId` 並在下載後才過濾 `expiresAt`。已過期限動的文字、媒體網址及 metadata 仍可能先送到用戶端；前端 `filter` 不構成撤權。

本輪將 Firestore 的 `get/list` 共用伺服器時間界線：`expiresAt` 必須是 epoch milliseconds 整數，且嚴格晚於 `request.time.toMillis()`。手機 `listActiveStoriesForSchool` 加入 `where('expiresAt','>',Date.now()+120000)`，依過期時間降冪查詢，限量後僅再做有效期防護；兩分鐘提前量避免在傳輸途中到期的資料讓整個查詢被拒絕。移除未使用到期條件的舊 school-only fallback，錯誤依既有 `throwOnError` 契約回報或回傳空陣列。新增 schoolId+expiresAt DESC 組合索引。

隔離回歸涵蓋不帶到期條件的廣泛查詢應拒絕、允許包含過期的弱界線查詢應拒絕、有效界線只回傳目前有效紀錄、非同校及匿名查詢應拒絕。若在精確 head CI 因 Firestore 動態數值比較的查詢可證明性、索引或 emulator 差異失敗，必須保留失敗證據並修正，不得放寬過期撤權或關閉斷言。

**部署相容性：** 正式環境必須先建成複合索引並發布支援有效期查詢的手機版本，再啟用收緊後的 Firestore 規則；舊手機版將因 school-only 列表查詢遭拒絕。這是刻意 fail-closed 而非相容回退，需由發布窗口檢查舊版客戶端覆蓋率與降級畫面後分階段切換。本輪只變更開發分支並等待 CI、CodeQL、Supabase、Python、Mobile Agent 與適用 Maestro 的精確提交結果。舊 GCS bearer URL、Supabase 已簽網址、GCS staging、相依套件與指定 App 審查仍屬未處理缺口，沒有正式資料、金鑰、migration、token 清理或部署操作。

### 04:43 UTC Firebase emulator 失敗：列表證明與型別檢查

精確 head `ca1db5eb` 的 [Firestore Rules CI #42447833539](https://github.com/Miiduoa/graduation/actions/runs/42447833539) 真正執行 264 個測試，263 通過、1 失敗。失敗的是新增的 `story lists cannot include expired metadata or cross-school rows`，合法、已帶有效期限範圍的列表查詢仍回傳 `permission-denied`、`false for 'list' @ L1744`；沒有把此版列為已驗證成功。

候選原因為 `resource.data.expiresAt is int` 不能由單純 `where('expiresAt','>', 整數)` 的查詢約束證明。這次保留單筆 `get` 的嚴格整數型別判斷，將 `list` 拆開為伺服器時間的 `expiresAt > request.time.toMillis()`，仍嚴格拒絕過期資料，不回退 school-only 的廣泛讀取。原有測試完整保留，是否可由 Firestore 查詢分析器證明範圍仍待新的精確 head CI。若再次失敗，應停止嘗試放寬清單規則，改為由可信後端逐筆確認期限的清單入口。

### 04:47 UTC 第二次 Firebase CI：有效清單查詢已被允許，修正測試 API

精確 head `0ac481dc` 的 [Rules CI #42448027270](https://github.com/Miiduoa/graduation/actions/runs/42448027270) 確認新的有效期範圍列表查詢已由規則允許，原本的 `false for list` 授權錯誤解除。263/264 通過，唯一失敗是新測試誤用本檔沒有匯入的 Jest `expect`，拋出 `ReferenceError: expect is not defined`，不是資料被錯誤允許或拒絕。本次更正為本檔已有的 Node `assert.deepEqual`，維持查詢前的拒絕與合法查詢後內容比對，並依新 head 重跑完整驗證；不以此暫時修正宣稱整套通過。

## 2026-11-08：修復完整 Mobile CI 的舊回退測試（待新精確 head 驗證）

精確 head `a6a53604749bc616922398415e6fa99cee522273` 的 [主 CI 42448246208](https://github.com/Miiduoa/graduation/actions/runs/42448246208) 已 completed/failure，非全綠：**Mobile Tests 7171 passed、1 failed、1 skipped**；Web Tests、Web Build、Functions、Rules 264/264、Security Gates、CodeQL、Supabase permissions、Python Security、Mobile Agent Regression、Chroma、Zod、Maestro 均 completed/success（Build Mobile 是受 CI Summary 影響的 skipped）。唯一 Mobile 失敗為 `apps/mobile/src/__tests__/services/socialOptionalReads.test.ts` 原 `story read failures reach recovery after the fallback also fails` 要求 `getDocs` 被呼叫兩次，實際只有一次。這不是安全功能失效：上輪修正 `listActiveStoriesForSchool` 時，已刻意移除會在 Firestore 規則外洩過期限動 metadata 的 **school-only fallback**。舊測試錯把不安全的第二次讀取當作正常行為。

本次先修 CI：保留 `throwOnError` 將原始錯誤交給畫面復原邏輯，將預期呼叫次數明確改為一次，並新增不要求丟錯時的測試，確認 optional-read 回傳空列表且同樣只發出一次查詢。這些斷言在舊版的 school-only fallback 實作上應會失敗，避免之後為了相容誤恢復第二次廣泛查詢。未修改 Firestore 授權、服務程式、E 校園暫停政策或正式資料；請以新 head 的 Mobile Jest 和完整 CI 實際結果驗收，**不得拿舊 head 成功結果替代**。

**保留風險：** 此修補是測試與預期行為的一致化，並不處理已簽發 GCS／Supabase URL 撤銷、真 GCS staging CAS、legacy 主資料、minimatch 兩圖相容升級或索引／行動端／Rules 正式分階段發布。主線現已至 `067436cd830f92d9ebbd301408b9500bbf29c295`，本 PR 落後主線 4 提交；正式合併仍需最新 main 精確整合、全項 CI 與指定 `nuni-merge-gate` App 5504170 對精確 head 核發審查通過。未合併 main／部署／migration／清理正式 token。

## 2026-11-08：限動建立資料邊界與 Maestro 安裝 HTTP 504

核對精確 head `1ea5587af4d29809d20e719586eac0513df25c43` 的檢查結果：主 CI `42464432189`、Firestore Rules、Web/Mobile、Web/Mobile Build、CodeQL、Supabase permissions、Python security、Mobile Agent Regression、Chroma、Zod 均 completed/success。**Maestro workflow `42464432188` 為 failure**：job `128680537683` 的 `https://get.maestro.mobile.dev` 安裝入口回應 HTTP 504；舊 `curl -Ls ... | bash` 因未啟用 pipefail 導致安裝步驟被誤判成功，下一步 `maestro --version` 才以 command not found (127) 失敗。iOS 模擬器、App 建置與 smoke **都未執行**，不應誤稱行動功能失敗或已成功。本次安裝修補增加 HTTP 失敗判定、有界重試、先下載至暫存檔且確認非空再執行。沒有 JUnit 時不執行報告發布器，避免製造第二個失敗；不隱藏真正的 installer 失敗。新版本 iOS smoke 須等精確 head 工作流實跑才能驗證，無本機 macOS 安裝證據。

另一項可重現的 Firestore 輸入邊界：`campusStories` 的 create 原先只驗作者、同校與到期，允許有效同校帳號注入任意新欄位、偽造初始 `viewCount`，或在 1 MiB Firestore 文件上限內使用極長 `text` 造成資料量放大。新規則以固定欄位白名單、`kind` 列舉、初始觀看數必須為零、文字字串型別與上限 2,000 字元封閉此範圍，保留原有手機發布欄位、有效期限與正常閱讀。新 Firebase emulator 回歸測試涵蓋合法發文、偽造觀看數、陌生欄位、超長文字、非法媒體種類與跨校發布。舊規則會錯誤放行前三種非法資料；**本輪先記錄修補與可重跑測試，待精確新 head 的 Rules CI 驗證後才能標為隔離測試通過。**

尚未解決的發布風險包括已發 Firebase/GCS 與 Supabase URL 撤權、隔離真 GCS bucket CAS、legacy 帳號、限動索引／手機／Rules 分階段推出、minimatch 的 pnpm 與 Functions 兩圖，以及指定 `nuni-merge-gate` App 5504170 對精確 head 的審查通過。本輪不重新發送未獲授權的 npm/pnpm audit payload，未碰觸正式資料、金鑰、token、migration、部署或 main 合併。


## 2026-11-09：私有檔案入口的群組根目錄讀取範圍修補

原 `parsePrivateGroupFilePath()` 為歷史下載 token 清理涵蓋所有 `groups/{groupId}/{filename}` 三段式物件；HTTP `privateGroupFile` 入口卻直接將這類路徑視為群組封面。寫入僅允許 `cover.<副檔名>`，但 **GET 沒有相同檔名限制**。因此合法群組成員只要知道非封面物件名稱，便可透過群組封面入口嘗試下載 `groups/{groupId}/roster.pdf` 等不屬於封面的根目錄檔案。這是 URL namespace 的授權範圍問題，不能以群組成員身分已通過驗證取代物件類型限制。

最小修補是在 HTTP 入口解析路徑後、查詢授權與建立 bucket 物件前，對 group-cover 統一強制 `^cover\\.[A-Za-z0-9]+$`；有效封面的 GET/POST 流程不變。**保留既有 parser 的廣泛辨識供歷史 token 清理**，避免因此遺漏非封面、但曾誤暴露在相同 namespace 的舊物件。新增合成物件 `roster.pdf`、`private-notes.txt`、`cover.jpg.backup` 的 GET/POST 負向回歸，要求全部在操作 Storage 前返回 400；原既有測試已涵蓋正常封面、跨帳號與校籍撤銷。

驗證界線：此提交只涵蓋應用程式 HTTP 入口的路徑授權，不證明既有 bearer 下載 URL 已失效；GCS 真實 staging、Firebase bearer token 全版本清理、Supabase 已簽 URL、legacy 帳號與限動索引/手機/規則分階段發布仍需獨立處理。新精確 head 的 Functions、Rules、完整 CI、CodeQL、Supabase、Python、Mobile Agent 與適用 Maestro 須依實際 GitHub 結果核對。未合併 main、部署、執行 migration、清除正式 token 或重送未核准的 npm/pnpm audit。
