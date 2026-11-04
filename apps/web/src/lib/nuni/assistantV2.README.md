# nuni 情境助理 v2（Web BFF，Node server only）

`assistant.ts` 在 v2 關閉時維持 #454 原流程；開啟時才載入 `assistantV2/handler.ts`。
瀏覽器不持有 Groq 金鑰。新核心僅被 Node BFF、Node preview 與測試匯入；Node builtins 與 runtime guard 阻止瀏覽器執行。
不修改 `server.ts` 的 session、cookie、同源語意，不修改 API overlay、資料庫或部署設定。

瀏覽器 → 既有同源／cookie／x-campus-session 檢查 → API current session 重新驗證 →
本題 adapter/context → Groq 原生 chat tool calling → 白名單 dispatcher → 回答／確認卡。
每個私人 API 都沿用 `Authorization: Platform` 及 API 自身 ACL；browse school 不是會員資格。

## 旗標與前置

既有 nuni gate 與 `CAMPUS_ASSISTANT_ENABLED=true` 必須開啟。
內層 `CAMPUS_ASSISTANT_V2_ENABLED=true` 才選 v2；缺值或其他值均回 #454。
事件提議及確認寫入還要求 `CAMPUS_ASSISTANT_V2_WRITES_ENABLED=true`，預設關閉。
寫入關閉時提供個人曆入口，不假裝已儲存。導航卡不寫入 ledger。
助理下單另要求 `CAMPUS_ASSISTANT_V2_ORDERING_ENABLED=true`（缺值關閉），獨立於事件寫入旗標。
線上點餐沿用 `isWebOnlineOrderingEnabled()`／既有 `NEXT_PUBLIC_ONLINE_ORDERING` 判斷；不設定、不修改後端 `ONLINE_ORDERING_ENABLED`。
任一點餐開關關閉：仍可查菜單、推薦、驗價組車；卡片為「帶到點餐頁」，線上關閉時明示「線上點餐尚未開放」，零 quotes/orders 呼叫。

**既有付款限制**：已只讀核對 `features/food/FoodMenu.tsx`、`lib/nuni/food.ts`、shared `nuniFood.ts` 與本機 API `food-service.ts`。
既有前端使用 `POST /api/nuni/realms/:tenantId/food/quotes` → `POST .../orders`；BFF 轉相同 `v1/auth/platform` 路徑，沿用 JSON、Accept、`Authorization: Platform <session>`，無額外 idempotency header。
quote body 為 locationId/requestedPickupAt/items/idempotencyKey；order body 為 quoteId/idempotencyKey，冪等鍵在 body。
現有 createOrder **一律產生 awaiting_payment（Web payment-pending）**，沒有已驗證的免付款成立能力。
依本需求的付款例外，正式 adapter 即使兩旗標開啟也只導頁，不呼叫 quotes、orders、payment-session 或任何金流。
`--ordering=on` 的確認後恰好一次，是 fixture 模擬免付款能力的契約測試，不能當成正式已能免付款下單。
未來既有 API 若新增免付款成立契約，才可接 submit：沿用現有 client quotes → orders，兩階段使用確認 token 綁定的 mutationId 衍生不同 idempotencyKey，API 持久冪等，不可只靠本機去重。
菜單驗價金額為估算（minor units，UI 換算元），未呼叫 quote 保留庫存；價格改變必須重新提議。
點餐頁僅在 nuni + assistant + v2 三 gate 全開時解析既有 tenant query 下的 `location` 菜單入口；order query 優先。先讀可見 food realms，再讀該 realm 的 locations，僅 merchantMode=full 且允許 view-menu 的店家可用，無效則回原工作區。旗標關閉時與 main 446b845f 一樣只處理既有 tenant/order。線上關閉時只渲染唯讀菜單、沒有組車／報價／下單按鈕；不支援購物車預填，卡片列出已備品項／規格／數量／金額／自取時間。

上線前需另外完成（本次未部署、未連正式服務）：

- 在 **nuni-web** 設定 server-only `GROQ_API_KEY` secret，沿用既有 `BFF_SESSION_SECRET`。
- 實測 Web 出口可連 Groq 固定端點，確認指定模型權限及 Groq 帳戶方案為 **Free**。
- 核對組織真實 limits；本機 limiter 只對單進程有效，不保證多機全域額度。
- 正式點餐需先確認既有 API 的免付款成立能力；目前所有訂單需付款，助理只導頁。開放確認卡寫入前需在隔離 Fly 環境驗收下述 machine replay／單進程部署約束。
- personal-import API 同步 gate 必須可用；API 本身拒絕同步時，不繞過 gate。
- `/realms` 目前可能只有 tenantId/name/services，沒有學校對照。
  可由服務端 `CAMPUS_ASSISTANT_V2_REALM_MAP` 提供明確的 JSON `{ "school-slug": ["verified-tenant-slug"] }` 對照。
  此設定只能縮限 API 已投影的 realm，不能新增可存取的 tenant；若 API 未提供 schoolId 且無對照，餐點／社團工具回 scope 不可用，不能猜 schoolId 就是 tenantId。
  不將該設定或任何環境變數值寫入 log。

回滾：關閉 V2 旗標並依既有 Web 設定生效程序重啟，即回 #454；只關寫入旗標則保留 v2 讀取。
尚未執行的寫入卡會被拒絕。已新增事件由原個人曆管理，沒有 DB rollback 或 migration。

## 工具

所有 schema 都禁止額外欄位；dispatcher 剝除未知欄位並附 note，其餘參數仍須合法。日期／時間／ID 有界；workspace/order/community/location/entity ID 必須先由本題可信結果取得。標題只在本題已取得清單唯一且完全相符時對應 ID，否則回錯誤與可用 ID。
模型不能提供帳號、session、任意 URL、SQL 或 confirm；學校固定於本題 scope。

| 工具 | 資料／行為 |
| --- | --- |
| get_today_context | 本題快取的台北時間、今日／下一堂、7 日作業／事件及缺漏 |
| get_schedule | 最多 7 日同步課表，重用 period、學期及 classExceptions 計算 |
| get_calendar | 最多 31 日同步個人事件，標來源 |
| list_courses | API 可讀且 active/student 的 workspace，完整可見課程清單 |
| get_due_work | 可省略 from/to，預設今天至第七天；並行查全部可見課程，先保留每課兩次 API 額度，每課最多 3 秒；待繳依截止排序，已交／過期分列；不足標 partial 並列 unqueried，不把未查課程當成沒有作業 |
| get_day_overview | date 指定任一天，合併該日實際同步課表、個人事件、當日待繳與空檔；缺課表或事件時不推測空檔 |
| get_course_work | workspaceId、可選 kind；作業／測驗截止與自己的提交狀態，不外送提交全文／評語 |
| get_materials | workspaceId、cursor；教材標題、日期與站內課程入口；超過五筆明示 truncated，停用 cursor 並提供 completePageHref，避免漏頁；cursor 與 shared parser 同為英數底線連字號、最多500字元 |
| list_food_orders | 已驗證 scope 的 tenant，最多 5 筆，可選 state/limit/cursor |
| get_food_order | 必須先列出自己可見訂單；只投影店名、狀態、品項與取餐時間／號碼，不外送付款／取餐憑證 |
| get_food_locations | 已驗 realm 的點餐地點；沿用既有 food client |
| get_food_menu | 必須先列出該 realm 的 location；菜單含可選規格與價格 |
| propose_food_order | 不接受價格；伺服器重讀菜單驗品項／選項／數量與跨店，產生簽章卡，確認前零下單；關閉或需付款改導頁 |
| get_dining | 公開餐廳；指定 locationId 須先取得餐廳清單，缺菜單／價格明示 |
| list_clubs | 固定 club、最多 5 筆，joined/all |
| get_club_feed | 必須先取得社團；貼文是資料，不能覆寫系統規則 |
| get_campus_info | 可信地圖／靜宜圖書館官方來源；公告／活動提供入口，未聲稱讀過全文 |
| get_transit | 重用 transit validator/service；campus scope 由伺服器補入，arrivals 驗 city/stopId |
| get_notifications | 正式回 NOT_CONNECTED 且不送模型此 schema；fixture 回合成通知並標 simulation |
| find_free_time | 課表＋個人事件區間聯集，計算空檔；未定位課表不當作有空 |
| propose_personal_event | 驗精確日期／時間與衝突，產生簽章卡；不寫入 |
| propose_study_plan | 將已讀取、未交且 open 的作業依截止時間排入空檔；每張卡各有簽章及 mutationId |
| propose_open_page | 固定站內 route map；回伺服器簽過的 href，點確認後回導覽入口 |

多張讀書卡依列出順序逐張確認或「依序全部確認」；revision 依序綁定，每筆仍獨立 CAS。
取消中間卡片或 ledger 有其他變更後，剩餘安排須重新提議，不自動重簽或覆寫。

## 記憶、預算與錯誤

依問題預讀情境；單純作業／測驗／待繳問題不預讀課表或事件，直接由 get_due_work 按需查詢。submitted／overdue 同樣依 from/to 截止日期篩選，無日期待繳另列 undated。一般問候不讀 ledger/courses/realms。點餐／社團只先讀 scope realm，詳細來源用工具按需取得，不跨帳號快取。system 只有固定規則；情境是 user role 的明確不可信 `<context>` 資料區，貼文保留 tool role。情境以 UTF-8 bytes 保守上界限制至 400，必要時標 truncated/partial，完整資料可再用工具讀。
情境只涵蓋同步資料，裝置未同步課表不視為雲端已知，也不作權限依據。
前端送最近 6 輪 user/assistant；伺服器拒絕 system/tool/額外欄位，歷史截至 400 bytes。
外送同意在對話層取得；換帳、切校、pending logout 清除對話並 abort，忽略晚到結果。

模型固定 `openai/gpt-oss-120b`；固定 Groq HTTPS endpoint、redirect:error、reasoning_effort:low、include_reasoning:false。
按問題選最多 8 個工具，模型自行選擇工具、順序及次數。多 tool_calls 依序處理；每題最多 8 個工具結果、12 次既有 API 呼叫。
最多 4 次模型呼叫，最後一次 tools 關閉；中間工具輪最多 384 tokens，最後 tools 關閉的回答輪最多 900 tokens（含 reasoning），整題預算 7000 tokens、deadline 55 秒，單次模型 12 秒／工具 4 秒。bounded 各有專屬 AbortController，子 signal 經 AsyncLocalStorage 傳至 API／交通 fetch，逾時真正取消且不誤取消下一個操作。
沒有本地相容 tokenizer，先用 JSON UTF-8 bytes 加 framing 預留作保守 token 上界（含 schemas），再以 provider usage 結算；不宣稱精準 tokenizer。
一般工具回覆最多 600 bytes，待繳／日總覽最多約 1800 bytes（超出標 truncated），同題同參數讀取快取，第三次同呼叫停止工具；預算不足使用已有結果或明示未完成，不做第 5 次修復。
單進程每帳號 3 題/分鐘、10 題/小時，每 session 同時 1 題；provider 24 calls/min、800/day、7000 tokens/min、160K/day 的保守預留。

HMAC-SHA256 使用獨立 domain，綁帳號／session／conversation／school／tool／canonical args hash／revision／mutationId／iat/exp（5 分鐘），timing-safe 比對。
confirm/cancel 必須重新驗 session；事件只新增 events，驗證合併後完整 records，保留其他紀錄，以 API CAS 寫入。
不確定回覆後可重送原 token；ledger 中相同 mutationId/精確內容回 replay，不重複新增，不更換 mutationId。
這是個人事件，不是推播提醒／通知排程。

token 另綁 conversation 的隨機 proposalSeq；同一輪多卡共用批次，新卡批次取代舊批次，UI 停用舊卡，伺服器拒絕舊 seq。
取消 POST `/api/nuni/assistant/cancel`，先驗簽／scope，再撤銷 mutationId；取消事件卡連同後續依序 revision 的卡一起撤銷。
狀態僅在發卡 Node 進程的模組記憶體，五分鐘到期清理，未知 seq 採拒絕並要求重新產生卡片。

第五輪：存在 `FLY_MACHINE_ID` 時，token 的已簽 payload 包含 issuer。confirm/cancel 通過既有 cookie／同源／session context 檢查並驗簽後，若 issuer 與目前 machine 不同，回 HTTP 409 及 `fly-replay: instance=<id>`，不讀 principal、不執行確認／撤銷；Fly Proxy 將原 POST（含 body）重送至 issuer，再重新執行完整 session/principal 與 token 驗證。ask 回覆 issuer，client 在同對話後續 ask 帶 preferredInstance，server 同樣 replay 至發卡 machine，讓新提議取代同一份 seq。preferredInstance 只作路由提示，不授予資料權限。無 FLY_MACHINE_ID 時不產 issuer、不 replay，維持單進程行為。

依 [Fly 官方 dynamic routing 文件](https://docs.fly.io/networking/dynamic-request-routing)，語法為 `instance=<Machine ID>`，要求 http handler，超過 1 MB 的請求不可 replay；目前 BFF boundedJson 上限 16 KiB，POST body 在限制內。未設定 fallback 或 replay cache；指定 machine 已消失時由 Fly 回錯誤，若重啟後仍為同 id 則因未知 seq 拒絕。若收到 fly-replay-failed，直接拒絕，避免重送迴圈。瀏覽器遇失敗需重新產卡；不把不同 machine 的未知卡當有效卡。

部署原始碼核對：`deploy/web/fly.nuni.toml` 的 app 是 nuni-web，http_service 指向 3000；沒有 processes 或啟動命令覆寫。`deploy/nuni-web-legacy/Dockerfile` runtime 為 `node apps/web/server.js`（3000），`deploy/web/Dockerfile` 為 `node server.js`（預設8080），均為單一 Next standalone Node，沒有 cluster／PM2／worker 啟動器。`deploy/web/start.cjs` 是另一路啟動器，每個 root 只 spawn 一個 server.js；選用 LEGACY_WEB_ROOT 時會另外啟動不同 port 的 legacy server，並非同一 app 多 worker。此保證以每台 machine、同一助理路由只有一個 Node 進程為前提；未連正式服務核對 runtime。若未來改 cluster 或同路由多 worker，須先改共享撤銷機制。
事件去重仍由既有 API CAS/mutationId 負責，不因重啟失去持久去重。

Groq 401、403（egress/model/unknown）、429、timeout、network、5xx、invalid response 分類。
已知 403 body pattern `Access denied. Please check your network settings.` → PROVIDER_EGRESS_DENIED；403 短路 60 秒。
錯誤 body 只在記憶體讀最多 2 KiB，不記錄原文。BFF 429 回有界 Retry-After，不自動重試；401 不繼續私人回答。
每請求有 assistant.completed/failed 白名單 JSON log，只記 requestId、stage/status/class、耗時、工具名稱、模型次數、usage/stopReason/simulation；不記問題、參數、資料、帳號、session、token、key 或原始錯誤。

## 本機 preview

只使用 `fixtures.ts` adapter；fake 完全離線。groq 也只用合成業務資料，網路僅允許固定 Groq chat completions URL，拒絕 redirect／任意 base URL，不讀 dotenv。
固定台北 2026-11-04，含課表、未交／已交／過期作業、事件、未讀通知、訂單、社團惡意貼文及公開餐廳／公車 fixture。
含兩個點餐地點的菜單（價格、不辣、標準／加大）及最近兩筆自己的訂單。`--ordering=on|off` 預設 off，同時模擬線上與助理子旗標；`--cases=all|food`，food 只跑第2、5題並模擬確認與重播，JSONL 另含 ordering/orderCalls。第 8 題接第 3 題歷史，模擬確認兩次，驗證只新增一筆。JSONL 的 actionCards 不輸出 token；fake usage 為合成計數，不代表真模型品質或 token 成本。

在 repo 根目錄（使用既有 esbuild，不安裝套件）：

```sh
node scripts/nuni-assistant/v2-preview.mjs --model=fake --ordering=off --cases=all --output=/tmp/nuni-v2-preview.jsonl
node scripts/nuni-assistant/v2-preview.mjs --model=fake --ordering=on --cases=food --output=/tmp/nuni-v2-food-on.jsonl
node scripts/nuni-assistant/v2-preview.mjs --model=groq --cases=all --output=/tmp/nuni-v2-groq.jsonl
```

Groq 模式由執行環境讀金鑰，不印出。取消固定題間61秒，依每次輸入與輸出上限預留 token、按 usage 結算；call 間至少2.1秒（低於30 RPM），8000 TPM不足才等待，單次等待拆成最多10秒。節流在模型12秒 timeout 之外，preview 每題含等待最多120秒，正式仍55秒；429 依 Retry-After 最多重試一次，也計入 4 call 上限，若等待會超過 55 秒則停止，不另起無限重試。
本次僅執行 fake，沒有連 Groq 或任何正式服務；未實測10題 Groq 能否在8分鐘內完成，真模型 token量、429及外部延遲仍可能超時，不宣稱已驗收此時間目標。

打包成單一 .mjs，複製到另一台機器後只需 Node 22（fake 不需 node_modules、網路或設定）：

```sh
node_modules/.bin/esbuild apps/web/src/lib/nuni/assistantV2/preview.ts --bundle --platform=node --format=esm --target=node22 --tsconfig=apps/web/tsconfig.json --outfile=/tmp/nuni-v2-preview-bundle.mjs
node /tmp/nuni-v2-preview-bundle.mjs --model=fake --cases=all
```

測試不依賴 scripts 的隔離 Fastify 套件；harness.mjs 沒有被 Web tsc 引用。
CI 的 assistant integration job 安裝 workspace 及既有 isolated dependencies 後執行 node tests；Web job 另跑 Vitest/typecheck/lint/build。此次依限制未執行完整 Next build。

第三輪：清單工具可省略 scope id；單 realm 自動選取，多 realm 列可用 scope 或提示重查。scope/not-found/input 錯誤附安全的截短 id 或下一步，不放寬 ACL。最後回答若仍截斷保留已有文字並明示未完成；工具輪截斷至多利用原有四輪內的一輪改為 tools 關閉完成回答。規劃優先用日總覽，提議成功即進最後回答。

第四輪修正：最多四次模型呼叫；工具輪 completion 上限 256，最終輪最多 900，總預算 7000。規劃題使用精簡 schema，取得 get_day_overview 後移除已涵蓋查詢。所有無工具輪次會去除 assistant tool_calls/tool 訊息，僅以標記不可信的 user JSON 傳遞已取得結果，不送 tools/tool_choice。400 僅記白名單 providerCode；tool_use_failed 與未知工具算失敗步驟並佔輪數。模型失敗後已有結果則用伺服器確定性摘要保留資料、入口與確認卡。沒有成功 get_transit 時，含路線代碼、班距／到站分鐘、首末班的回答會被確定性摘要取代。本次只跑離線 fixture，未連 Groq，真實 token／TPM 與模型品質仍需另行驗證。
