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
