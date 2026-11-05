# 公開校園助理候選

此 overlay 預設關閉，不包含 migration、背景工作、聊天儲存或任何業務寫入。

## 功能與安全邊界

API prefix 為 `/v1/auth/platform/assistant`；Web BFF 為 `/api/nuni/assistant`。

- `GET capability`：有效登入、provider readiness、公開服務目錄、共用 12 項寫入權限全部 false。
- `POST preview`：接受 schoolId 與固定 intent，或最長 1000 字的 question；自由文字僅在本地解析，無法辨識時回 `PUBLIC_SELECTION_REQUIRED`。BFF 會先移除原文再傳 API。
- `POST ask`：只接受 schoolId、intent、confirmation、consent=true，單次 provider 呼叫。
- `POST route`：使用第二份確認取得固定站內入口與可信學校導覽。
- `POST execute/enqueue`：登入檢查後立即回 `ASSISTANT_WRITE_UNAVAILABLE`，不解析動作、不呼叫 provider、不寫 DB。

固定項目為校園地圖、公車、餐廳與靜宜蓋夏圖書館。校園必須存在於共用官方地圖清單；圖書館項目只允許 `pu`。未接入可信座標的地點只提供官方導覽與地圖入口，不產生步行指示或假座標。

模型只看到固定 intent 與該項目的公開名稱、摘要；原文、對話歷史、校園選擇、帳號、session、姓名、學號、email 與私人快照均不送出。模型只能回同一 intent 的單欄 JSON；任何額外欄位、工具呼叫或不同 intent 都拒絕。最終文字、來源及連結由伺服器固定目錄決定。

確認以既有 `options.attendanceCodeSecret` 專用 HMAC domain 派生 key，綁 stage、school、intent、來源 fingerprint、provider/model、session hash，期限 5 分鐘。兩份確認不可互換，也不能跨帳號、跨校或修改項目。確認可重播，僅支援純讀取；每次 ask 仍計次。

API 每個請求重新呼叫既有 `PlatformAccountService.resolveSession`。精確 allowlist 只繞過原本的另一種校園 Bearer guard，不繞過 platform session 驗證。沿用現有 trusted proxy 設定。8 KiB body、解析 session 前每 IP 每路由 600 次／分鐘的粗粒度保護、驗證後每帳號公開查詢 30 次／分鐘（跨 session 與 action）、每帳號 ask 5 次／分鐘與 20 次／小時、全程序 provider 並行 1、等待佇列 0。記憶體限額不跨程序，也會因重啟清零；不是硬性免費帳單上限。

## 開關與 provider

Web 與 API 分別要求 `CAMPUS_ASSISTANT_ENABLED=true`；缺值或其他值均關閉。Web 同時沿用既有 nuni backend gate。僅兩個 gate 同時成立才掛載新 UI。助理旗標缺值、false 或 nuni gate 關閉時，`/ai-assistant` 完整使用原 Legacy 頁（含登入、q／courseId、草稿及既有對話），不發 assistant capability；設定頁也不顯示新增的 nuni 助理說明。關閉時 assistant BFF 回 404。這是旗標選路；已啟用的新助理失敗時不 fallback。

API 的 `CAMPUS_ASSISTANT_PROVIDER` 預設 groq；可選 fake。production 選 fake 會拒絕啟動該候選。fake 無網路、無金鑰，UI 明示模擬。

Groq 只使用固定 HTTPS endpoint、`openai/gpt-oss-120b`、`reasoning_effort: low`、`include_reasoning: false`、`max_completion_tokens: 512`（推理與最終 JSON 共用額度）、`response_format: json_object`、15 秒 deadline、8 KiB response 上限；不 redirect、不 retry、不切換供應商。不具 `GROQ_API_KEY` 時回 provider unavailable。依 [Groq deprecations](https://console.groq.com/docs/deprecations)，舊模型於 2026-08-16 對 free／developer tier 下架；新模型參數依 [reasoning 文件](https://console.groq.com/docs/reasoning) 設定。帳戶模型權限、免費資格與硬額度尚未對外核實，正式啟用前需另行驗證；確定性公開入口不依賴模型。

Web BFF 使用既有 HttpOnly cookie、同源檢查與 `x-campus-session`；assistant transport 不使用 wake retry。換帳、切校或 pending logout 會卸載對話、中止請求，晚到回應不呈現。nuni 頁不掛私人 snapshot、寫入面板或訂單卡。設定頁說明既有設定不會開啟 nuni 寫入。

## 本機 preview 對話（無網路、金鑰與資料庫）

從 repo 根目錄執行：

```sh
pnpm install --frozen-lockfile
pnpm --dir scripts/nuni-assistant install --ignore-workspace --frozen-lockfile
node --test scripts/nuni-assistant/*.test.mjs
pnpm --filter web exec vitest run src/lib/nuni/assistant.test.ts -t 'preview conversation'
```

第一次安裝依賴需要 registry 或本機套件快取；測試執行本身完全離線。真整合位於 `scripts/nuni-assistant/bff.test.mjs`；上述 Web Vitest 的 preview conversation 使用 upstream stub。真整合使用真實 BFF handler、加密 HttpOnly cookie fixture、session context、同源檢查、assistant 單次 transport 與真 Fastify routes。測試將 `NUNI_API_BASE_URL` 指向固定 loopback origin，將 fetch 接至 Fastify inject，不需要監聽埠。流程為 capability → preview → 同意外送 → ask → 第二次確認 → `/map?schoolId=pu`，最後撤銷 fixture session 並確認遭拒。只有 session resolver 使用合成 fixture；不代表真實資料庫 ACL／登入已驗證。

UI 另以 `src/features/nuni/Assistant.test.tsx` 驗證兩次按鈕確認、未啟用、換帳切校與晚到回應。preview 是可重現的測試流程，沒有另加瀏覽器測試登入後門。

測試專用套件在 `scripts/nuni-assistant` 與根 workspace 隔離，使用 Fastify 5.10.0／rate-limit 11.1.0，與正式組合來源的 package／lockfile 一致。security 候選的 Fastify 5.12.7 不屬於這次正式來源。

## 來源重建（僅建立本機 context）

`source.json` 固定發布來源 commit `c93b4ac3851df68f76d607af29b086030735dc55`、歷史 composed manifest checksum、正式來源 tree `4c7919d6cff32789acb06e2b9f4edb180cdad3a1`、所有 assistant 模組及兩份共用模組 checksum、最終 candidate tree。從歷史 Git 來源重建 base patches 與 composed overlays，保留既有公開餐廳、課程、匯入、教材分頁及 migration 281 撤回過濾，再加入 assistant。builder 預設路徑完全不變；不可與其他 candidate flags 混用。

```sh
python3 deploy/nuni-api/build.py --assistant-candidate \
  --assistant-source /path/to/archived-nuni-prod \
  --prepare-only --output-dir /tmp/new-assistant-context
```

執行工具的 repo 必須包含固定發布 commit 的 Git object；淺層 checkout 若缺少該歷史版本會拒絕準備來源。輸出目錄必須不存在。來源只讀取；clone、index 與 tree 計算在新目錄內，不建立 commit。未提供本機來源時會嘗試 clone manifest 固定的 repository。任何 checksum、input tree、註冊 anchor 或 candidate tree 不符都中止。

`--assistant-candidate` 未帶 `--prepare-only` 時只會用同一份校驗來源建置本機 Docker image，不會推送、部署或改 DB。本次未執行 Docker build。

發布收據、歷史 manifest、RUNBOOK 與重建 tree 相符；這證明來源重建結果等於映像 OCI revision 所聲明的 tree，並非獨立的映像逐位元供應鏈證明。此候選沒有 schema 變更；不包含尚未發布的 security overlay。

## 隔離 PostgreSQL 與真正 createApp 回歸

預設跳過，不進 CI 必要檢查。先以上述方式重建候選，再在候選安裝固定依賴與執行完整 typecheck／build：

```sh
cd /tmp/new-assistant-context
pnpm --store-dir /tmp/nuni-pnpm-store --filter @campus/api... install --frozen-lockfile --ignore-scripts
pnpm --filter @campus/api typecheck
pnpm --filter @campus/api build
cd /path/to/this/repo
NUNI_ASSISTANT_CONTEXT=/tmp/new-assistant-context \
NUNI_ASSISTANT_LOCAL_DB=postgresql://nuni_test@127.0.0.1:55432/postgres \
node scripts/nuni-assistant/local-regression.mjs
```

此 URL 僅為無密碼的本機 trust 測試端點。啟動器嚴格拒絕其他 host、port、user、密碼、query 與 fragment，不讀 dotenv，也不傳遞 shell 既有服務設定。每次建立獨立 schema，以正式來源 createDatabase migration runner 建表，最後刪除該 schema；不修改 migration 檔。真正 createApp 使用真正 PlatformAccountService.resolveSession 驗證有效、刪除撤銷、過期、帳號停用及 credential 停用，並驗 guard、body limit、同出口不同帳號、跨 session 額度、未認證 IP 保護與可信代理。production logger 的 stdout／stderr 在父程序擷取，斷言沒有合成姓名、學號、email、authorization、session 原文與問題原文。

IP 只使用 Fastify request.ip；不讀自訂 client header。沿用正式來源 `TRUSTED_PROXY_CIDRS` → `trustedProxyCidrs`，預設 false，只有設定範圍內的直接代理可提供 forwarded IP。600 額度是各路由、各程序的粗粒度入口保護，仍可能因大型共享出口耗盡；主要公平限流為驗證後的帳號，換 session 或偽造 header 無法避開。多台機器額度目前不共用，不能當供應商支出硬上限。


## CI 與回滾

`test-nuni-assistant` job 以 `contents: read` 與 checkout `persist-credentials: false` 執行，根與隔離套件均 frozen 安裝；pnpm cache 同時追蹤兩份 lockfile。此 job 是 summary 與手動 Firebase 發布的 needs，失敗會阻擋該發布。隔離套件不承接 workspace audit／overrides，更新依賴時須另行審查其 lockfile 與執行獨立 audit（`pnpm --dir scripts/nuni-assistant audit`）。

此 job 的三個 action 暫保留版本標籤；本輪未取得可核實的完整 commit SHA，不填入未驗證值。後續須從官方 action repository 核對版本對應 commit，審查後固定完整 SHA 並保留版本註解；更新時重新審查。

回滾腳本只留在工作區：`/workspace/agent-backend/rollback-api.sh` 與 `/workspace/agent-backend/rollback-web.sh`，不納入 repo。API 腳本固定既有回滾映像；Web 腳本需發布前 capture baseline 或明確指定映像。兩者只有顯式 `--execute` 才修改機器；本輪不執行任何模式。操作說明與限制見 `/workspace/agent-backend/impl-notes-2.md`。
