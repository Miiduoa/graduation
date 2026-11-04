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

上線前需另外完成（本次未部署、未連正式服務）：

- 在 **nuni-web** 設定 server-only `GROQ_API_KEY` secret，沿用既有 `BFF_SESSION_SECRET`。
- 實測 Web 出口可連 Groq 固定端點，確認指定模型權限及 Groq 帳戶方案為 **Free**。
- 核對組織真實 limits；本機 limiter 只對單進程有效，不保證多機全域額度。
- personal-import API 同步 gate 必須可用；API 本身拒絕同步時，不繞過 gate。
- `/realms` 目前可能只有 tenantId/name/services，沒有學校對照。
  可由服務端 `CAMPUS_ASSISTANT_V2_REALM_MAP` 提供明確的 JSON `{ "school-slug": ["verified-tenant-slug"] }` 對照。
  此設定只能縮限 API 已投影的 realm，不能新增可存取的 tenant；若 API 未提供 schoolId 且無對照，餐點／社團工具回 scope 不可用，不能猜 schoolId 就是 tenantId。
  不將該設定或任何環境變數值寫入 log。

回滾：關閉 V2 旗標並依既有 Web 設定生效程序重啟，即回 #454；只關寫入旗標則保留 v2 讀取。
尚未執行的寫入卡會被拒絕。已新增事件由原個人曆管理，沒有 DB rollback 或 migration。

## 工具

所有 schema 都禁止額外欄位，日期／時間／ID 有界；workspace/order/community/location/entity ID 必須先由本題可信結果取得。
模型不能提供帳號、session、任意 URL、SQL 或 confirm；學校固定於本題 scope。

| 工具 | 資料／行為 |
| --- | --- |
| get_today_context | 本題快取的台北時間、今日／下一堂、7 日作業／事件及缺漏 |
| get_schedule | 最多 7 日同步課表，重用 period、學期及 classExceptions 計算 |
| get_calendar | 最多 31 日同步個人事件，標來源 |
| list_courses | API 可讀且 active/student 的 workspace，最多 20 門 |
| get_course_work | workspaceId、可選 kind；作業／測驗截止與自己的提交狀態，不外送提交全文／評語 |
| get_materials | workspaceId、cursor；教材標題、日期與站內課程入口 |
| list_food_orders | 已驗證 scope 的 tenant，最多 5 筆，可選 state/limit/cursor |
| get_food_order | 必須先列出自己可見訂單；只投影店名、狀態、品項與取餐時間／號碼，不外送付款／取餐憑證 |
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

每題重建本題情境，不跨帳號快取。情境以 UTF-8 bytes 保守上界限制至 400，必要時標 truncated/partial，完整資料可再用工具讀。
情境只涵蓋同步資料，裝置未同步課表不視為雲端已知，也不作權限依據。
前端送最近 6 輪 user/assistant；伺服器拒絕 system/tool/額外欄位，歷史截至 400 bytes。
外送同意在對話層取得；換帳、切校、pending logout 清除對話並 abort，忽略晚到結果。

模型固定 `openai/gpt-oss-120b`；固定 Groq HTTPS endpoint、redirect:error、reasoning_effort:low、include_reasoning:false。
按問題選最多 8 個工具，模型自行選擇工具、順序及次數。多 tool_calls 依序處理；每題最多 8 個工具結果、12 次既有 API 呼叫。
最多 4 次模型呼叫，最後一次 tools 關閉；輸出最多 384 tokens，整題預算 7000 tokens、deadline 55 秒，單次模型 12 秒／工具 4 秒。
沒有本地相容 tokenizer，先用 JSON UTF-8 bytes 加 framing 預留作保守 token 上界（含 schemas），再以 provider usage 結算；不宣稱精準 tokenizer。
工具回覆最多 600 bytes，同題同參數讀取快取，第三次同呼叫停止工具；預算不足使用已有結果或明示未完成，不做第 5 次修復。
單進程每帳號 3 題/分鐘、10 題/小時，每 session 同時 1 題；provider 24 calls/min、800/day、7000 tokens/min、160K/day 的保守預留。

HMAC-SHA256 使用獨立 domain，綁帳號／session／conversation／school／tool／canonical args hash／revision／mutationId／iat/exp（5 分鐘），timing-safe 比對。
confirm 必須重新驗 session；只新增 events，驗證合併後完整 records，保留其他紀錄，以 API CAS 寫入。
不確定回覆後可重送原 token；ledger 中相同 mutationId/精確內容回 replay，不重複新增，不更換 mutationId。
這是個人事件，不是推播提醒／通知排程。

Groq 401、403（egress/model/unknown）、429、timeout、network、5xx、invalid response 分類。
已知 403 body pattern `Access denied. Please check your network settings.` → PROVIDER_EGRESS_DENIED；403 短路 60 秒。
錯誤 body 只在記憶體讀最多 2 KiB，不記錄原文。BFF 429 回有界 Retry-After，不自動重試；401 不繼續私人回答。
每請求有 assistant.completed/failed 白名單 JSON log，只記 requestId、stage/status/class、耗時、工具名稱、模型次數、usage/stopReason/simulation；不記問題、參數、資料、帳號、session、token、key 或原始錯誤。

## 本機 preview

只使用 `fixtures.ts` adapter；fake 完全離線。groq 也只用合成業務資料，網路僅允許固定 Groq chat completions URL，拒絕 redirect／任意 base URL，不讀 dotenv。
固定台北 2026-11-04，含課表、未交／已交／過期作業、事件、未讀通知、訂單、社團惡意貼文及公開餐廳／公車 fixture。
第 8 題接第 3 題歷史，模擬確認兩次，驗證只新增一筆。JSONL 的 actionCards 不輸出 token；fake usage 為合成計數，不代表真模型品質或 token 成本。

在 repo 根目錄（使用既有 esbuild，不安裝套件）：

```sh
node scripts/nuni-assistant/v2-preview.mjs --model=fake --cases=all --output=/tmp/nuni-v2-preview.jsonl
node scripts/nuni-assistant/v2-preview.mjs --model=groq --cases=all --output=/tmp/nuni-v2-groq.jsonl
```

Groq 模式由執行環境讀金鑰，不印出。題間至少 61 秒、call 間至少 2.1 秒並預留 tokens；429 依 Retry-After 最多重試一次，也計入 4 call 上限，若等待會超過 55 秒則停止，不另起無限重試。
本次僅執行 fake，沒有連 Groq 或任何正式服務。

打包成單一 .mjs，複製到另一台機器後只需 Node 22（fake 不需 node_modules、網路或設定）：

```sh
node_modules/.bin/esbuild apps/web/src/lib/nuni/assistantV2/preview.ts --bundle --platform=node --format=esm --target=node22 --tsconfig=apps/web/tsconfig.json --outfile=/tmp/nuni-v2-preview-bundle.mjs
node /tmp/nuni-v2-preview-bundle.mjs --model=fake --cases=all
```

測試不依賴 scripts 的隔離 Fastify 套件；harness.mjs 沒有被 Web tsc 引用。
CI 的 assistant integration job 安裝 workspace 及既有 isolated dependencies 後執行 node tests；Web job 另跑 Vitest/typecheck/lint/build。此次依限制未執行完整 Next build。
