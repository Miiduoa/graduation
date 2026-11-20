# 平台帳號公開任務組裝候選

本機可走完「公開校園導航 → 檢視資料 → 本人確認 → 一次執行 → 來源與路線回執」。
使用地圖頁的 `PublicNavigationTask` 元件與真實 HTTP handler／service／ledger 程式；
`serve-local.mjs` 才注入合成平台 session、序列化 SQL protocol fixture 與既有公開地點目錄。
這不是正式登入、正式資料庫或雲端模型驗證。候選 SQL 已在全新隔離的合成 PostgreSQL 叢集測試，未套用正式服務。

```sh
node scripts/test-platform-public-agent.mjs
node scripts/platform-public-agent/serve-local.mjs
# 開啟 http://127.0.0.1:4319；輸入「從主顧樓到蓋夏圖書館」
```

本機只綁 loopback，紀錄在記憶體，重開會消失；不可拿來服務正式帳號。
地點來自 `packages/shared/src/providenceCampus.ts` 已附 OSM 來源的交叉核對項目。
目錄日期顯示為 2026-10-19，不宣稱即時通行、定位或校方同步。
導航只接受「從完整地點名稱到完整地點名稱」的唯一匹配；不理解任意自然語言。

## 組裝邊界

- `PlatformPublicAdmission` 使用既有 `PlatformAccountService.resolveSession` 結構介面，不接受 JSON 身分、角色、學籍或 Firebase uid。
- `PlatformPublicTaskService` 預設只提供確定性導航；只有 host 明確注入 Groq planner 並在 Fastify 組裝選擇 `freeTierVerified` 才能測試雲端計畫。此布林值不能證明帳戶免費資格，正式部署前須核實。
- Web `/api/nuni/public-agent/{action}` 與地圖 port 僅在 `CAMPUS_PUBLIC_AGENT_ENABLED=true` 且既有 Nuni API gate 啟用時提供；未配置時預設關閉。`createPlatformPublicAgentHandler` 和 Fastify 路由仍未註冊，尚未部署或註冊 migration。正式啟用前還須整合 #433 草稿／切校 scope 與實際 API。
- 未來 host 須以既有受信 signed HttpOnly cookie／platform session 實作 `resolveHttpSession`，提供固定 origin，不能使用本機 fixture 的測試 header。handler 驗 POST、同源、custom header、session context、8 KiB body、完整期限與回應前 session；不接受跨校／跨帳號身分 JSON。
- 確認綁任務、內容雜湊、來源 fingerprint、校園、provider/model 與 session。`deterministic/public-poi-exact-match-v1` 與 Groq 是不同綁定；只有公開導航接受前者。

## 執行與回復

確認消耗、共用 budget、帳號 quota 與 operation 在同一交易。只有首次 claimed 取得隨機 execution token，DB 僅存 hash；HTTP 不暴露 token，重試不再取得執行權或扣次數。
結果須通過公開來源及 canonical 路線驗證才能以 token CAS 完成。completed／failed／unknown 都不能被晚到結果覆寫。
執行逾時或提交回應遺失保留不明狀態；查詢原任務不會觸發 executor。未知工作不自動補送或退款額度。
`readBound` 使用完整內容綁定；每次完成回執交付都重驗身分、來源與路線，不直接信任快取。
JSONB 欄位順序不影響驗證。公開名稱只是資料，不是模型或工具指令。

UI 確認前不執行，取消回輸入並恢復焦點；換帳校會卸載舊工作、清理晚到結果。
正式導航的同帳同校跨頁草稿保留及換校確認仍須由 host 與既有 Agent 草稿管理接合，本機 selector 只是隔離測試控制項，不是正式切校流程。
沒有真正的模型推理、任意任務或私人資料寫入。

## 仍未核實／啟用

- `schema.candidate.sql` 已在新建隔離合成 PostgreSQL 測試，未套用正式服務或新增正式 GRANT；正式 DDL、grants、完整 migration 與未覆蓋鎖、statement timeout／commit 故障及帳號清理仍待驗證。
- fixture 的序列化回滾不是 PostgreSQL 證據。實際 DB transaction 不會因 HTTP abort 自動取消。
- 確認紀錄上限預設 1000，過期／已耗用也計入；未知操作不刪除。保留及容量清理政策尚未核定。
- 身分與來源為順序檢查，不是分散式原子快照，最後來源讀取後仍有 TOCTOU 窗口。
- 正式 API 介面基底 `Miiduoa/nuni-prod@9de47b4b`，account service 已與 `security/source.json` 綁定的 `b0a10ac` patch 單檔核對，保留 password 的有效 operator 指派重驗；整份目前部署來源與 migration/grants 未重建核准。
- 真 session BFF、正式公開來源 reader／包裝註冊、部署與任何免費雲端 provider 帳戶額度均未啟用或實測。
- 歷史安全掃描 22 筆命中／4 筆權屬未明仍待處理；本切片沒有新增 ignore、縮減掃描或放寬安全閘門。

Web BFF 復用 `platformPublicAgentGateway.ts`、固定路徑的 `platformPublicAgentTransport.ts` 和嚴格投影器；沿用同源、加密平台 session cookie 與 session context，單次傳送，不使用會重試的 `platformRequest`。上游九個操作路徑仍是候選，正式 API 尚未註冊。

## 重新載入後的未結案保護候選

帳號、校園及任務的未結案 operation 最多一筆；包含 running、unknown 及尚未由本人結案的 completed／failed。`confirm` 和 `claim` 在帳號交易鎖內檢查，候選 SQL 另有部分唯一索引；不同 request ID、文字、來源快照或新 session 都不能繞過。這是保守串行限制：同範圍其他內容也會暫時被阻擋。

`status` 以目前有效 platform session 查詢，只回狀態及不透明 operation ID，不回前次輸入、session、確認碼、結果或執行權。只有 completed／failed 可由使用者明確確認 `ack` 結案；pending／unknown 無法結案或重送。`ack` 同 ID 重試冪等且不影響後續任務。目前僅可和解已過期或未知、且資料庫可靠證實尚未派送的操作；一旦已開始派送或證據不足，仍維持未知並阻擋。

本機 PostgreSQL 17 隔離驗證可用 `node scripts/platform-public-agent/postgres-local-run.mjs`（目前 runner 使用 macOS Homebrew 的 `/opt/homebrew/opt/postgresql@17/bin`）。runner 自建私有暫存叢集，禁止 TCP，只在自有 Unix socket 及合成最小帳號表上套用候選 schema；清理僅限它所建叢集。一般 `node scripts/test-platform-public-agent.mjs` 不啟動資料庫，會將 PG 整合項標為 skip。

該 SQL 仍未編號、未註冊、未套到任何連線服務。正式導入前需核現有未結案資料是否與唯一索引衝突並停下處理，不可自動刪除或自動結案；另須核 migration 執行順序、正式帳號 DDL／grants、連線與 lock／statement timeout、備份／保留、未知任務和解及故障恢復。Web 單次 transport 與回執投影已有本機組裝；正式上游 route、可信來源及 #433 UI scope／切校確認仍未整合，不能啟用。

## Groq 公開導航計畫候選（未註冊）

`prepareGroq` 只讀公開校園來源，列出將送出的校園、問題及公開地點 ID／名稱、Groq 與固定模型，並以來源 fingerprint、明確 model 和 payload 綁定確認內容；尚不呼叫供應商。本人明確確認後，`confirm`／`execute` 在 ledger 原子入場並保守扣內部額度，一次呼叫注入的 planner；規劃器最後讀取來源後、外送前重新驗證 session，不處理工具呼叫、不自動重送或 fallback。模型只回傳源內不同地點 ID，plan 存為未結案結果；第二次明確確認並傳同一 operation ID、完整 request 與 ID，`route` 才在重新核對未結案狀態、帳號與公開座標後建立 Google Maps 連結。已結案 plan 不再交付。身分／來源檢查仍非分散式原子保證。

確定收到 429、unclear 或不合 schema 回應時，須成功持久寫入各自的 failed code 後才回 failed，並由本人明確結案；失敗寫入的 commit 回覆遺失、逾時、中止與網路失聯皆回 unknown，不能自動重送。內部共享額度非 Groq 即時餘額；目前 deterministic 與 Groq 使用同一 server budget。只有持久標記證明未派送時可申請和解；其他未知結果不可自動解除。

重跑真 Fastify／PostgreSQL 合成整合：在符合 pin integrity 的 Fastify 5.12.7 已安裝目錄執行 `node scripts/platform-public-agent/postgres-local-run.mjs --fastify-root /absolute/path/to/installation`。省略 `--fastify-root` 時該 Fastify 測試明確 skip。測試重建 Fastify 實例與另一 Node 程序的 ledger，模擬 provider fetch，不呼叫 Groq；安裝的 npm transitive 依賴不代表正式 pnpm lock，rate-limit plugin、正式全域守衛與 body parser 期限未覆蓋。

## 派送前 fence 與證據式和解候選

執行器呼叫 provider 或任何副作用之前，必須在有效 session、完整 payload 與一次性 token 綁定下，透過 `beginDispatch` transaction CAS 持久記錄 `dispatch_started_at`，而且收到明確 commit 回應；commit 回應不明或過時即不可派送。`reconcileNoDispatch` 只能以新有效平台 session 在同帳校 task 的鎖內，確認狀態為未知／已過期且 `dispatch_started_at IS NULL`，CAS 標記 `NOT_DISPATCHED`，不自動 ack 或退額度；一旦開始、缺少證據或版本不明均維持未知。客戶端不能提出未派送證據。

候選表要求 `dispatch_fence_version=1` 且無 DEFAULT，新的 claim 明確寫入，舊版缺欄 INSERT 被拒並回滾 confirmation/quota。這只保護受相同 schema 約束的正常程式，無法抵擋有直接資料庫寫入權的惡意或錯誤程式。正式導入前必須證實所有執行路徑遵守 fence，並拒絕任何已有未標記 operation 的舊表／歷史資料；不得對歷史 NULL 補 1 或假稱未派送。若未確認 rolling mix、舊程序已停與 ACL，停止發布。

`node scripts/platform-public-agent/full-migration-isolated-run.mjs --source <固定 tree b0a10ac 的獨立 checkout>` 只允許匹配 tree 且沒有未追蹤／工作樹漂移的來源，使用自行新建、無 TCP 的 PostgreSQL 17，透過該來源真正 `createDatabase` 套用完整原有 manifest，再以僅供測試的 `999_public_agent_isolated_test_only` 驗證增量、碰撞、checksum 失配、DDL／登記一體回滾及相同 manifest 的候選／回滾來源 verify。該測試使用本機 esbuild／Node 22 與合成角色，不是 OCI 映像、部署、正式 migration 編號、完整 ACL 或現況驗收；舊 image 不能直接回滾，需另建含完全一致新 manifest/checksum 的相容映像並驗證。

Web signed-session 合成鏈可執行 `node scripts/platform-public-agent/web-bff-local.mjs`，再開啟 http://127.0.0.1:4319/web-bff.html。它使用實際 NuniSessionProvider、加密合成 HttpOnly cookie、handleNuni、gateway、單次 transport、投影器和 task service／ledger；上游由合成 API 攔截，交易是 protocol fixture，沒有真 Fastify、真 PostgreSQL、正式帳號、模型呼叫或正式部署。
