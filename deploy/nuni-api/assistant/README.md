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

API 每個請求重新呼叫既有 `PlatformAccountService.resolveSession`。精確 allowlist 只繞過原本的另一種校園 Bearer guard，不繞過 platform session 驗證。沿用現有 trusted proxy 設定。8 KiB body、每 IP 30 次／分鐘、每帳號 ask 5 次／分鐘與 20 次／小時、全程序 provider 並行 1、等待佇列 0。記憶體限額不跨程序，也會因重啟清零；不是硬性免費帳單上限。

## 開關與 provider

Web 與 API 分別要求 `CAMPUS_ASSISTANT_ENABLED=true`；缺值或其他值均關閉。Web 同時沿用既有 nuni backend gate。關閉時 BFF 回 404、nuni UI 顯示未啟用。既有 Firebase 頁面保留為獨立元件，不作 nuni 失敗後的 fallback。

API 的 `CAMPUS_ASSISTANT_PROVIDER` 預設 groq；可選 fake。production 選 fake 會拒絕啟動該候選。fake 無網路、無金鑰，UI 明示模擬。

Groq 只使用固定 HTTPS endpoint、`llama-3.3-70b-versatile`、15 秒 deadline、64 output tokens、8 KiB response 上限；不 redirect、不 retry、不切換供應商。不具 `GROQ_API_KEY` 時回 provider unavailable。模型可用性、免費資格與帳戶硬額度尚未對外核實，正式啟用前需另行驗證；確定性公開入口不依賴模型。

Web BFF 使用既有 HttpOnly cookie、同源檢查與 `x-campus-session`；assistant transport 不使用 wake retry。換帳、切校或 pending logout 會卸載對話、中止請求，晚到回應不呈現。nuni 頁不掛私人 snapshot、寫入面板或訂單卡。設定頁說明既有設定不會開啟 nuni 寫入。

## 本機 preview 對話（無網路、金鑰與資料庫）

從 repo 根目錄執行：

```sh
pnpm install --frozen-lockfile
pnpm --dir scripts/nuni-assistant install --ignore-workspace --frozen-lockfile
node --test scripts/nuni-assistant/*.test.mjs
pnpm --filter web exec vitest run src/lib/nuni/assistant.test.ts -t 'preview conversation'
```

第一次安裝依賴需要 registry 或本機套件快取；測試執行本身完全離線。這個 preview 使用真實 BFF handler、加密 HttpOnly cookie fixture、session context、同源檢查、assistant 單次 transport 與真 Fastify routes。測試將 `NUNI_API_BASE_URL` 指向固定 loopback origin，將 fetch 接至 Fastify inject，不需要監聽埠。流程為 capability → preview → 同意外送 → ask → 第二次確認 → `/map?schoolId=pu`，最後撤銷 fixture session 並確認遭拒。只有 session resolver 使用合成 fixture；不代表真實資料庫 ACL／登入已驗證。

UI 另以 `src/features/nuni/Assistant.test.tsx` 驗證兩次按鈕確認、未啟用、換帳切校與晚到回應。preview 是可重現的測試流程，沒有另加瀏覽器測試登入後門。

測試專用套件在 `scripts/nuni-assistant` 與根 workspace 隔離，使用本機可取得的 archived Fastify 5.10.0／rate-limit 11.1.0；不進入候選映像。候選仍保留 security overlay 的 Fastify 5.12.7。測試版本差異不能視為新版 runtime 的完整驗收。

## 來源重建（僅建立本機 context）

`source.json` 固定 security manifest checksum、security input tree、所有 assistant 模組及兩份共用模組 checksum、最終 candidate tree。先重建 security overlay，保留既有公開餐廳、課程、匯入、分頁與安全修正，再加入 assistant。builder 預設路徑完全不變；不可與其他 candidate flags 混用。

```sh
python3 deploy/nuni-api/build.py --assistant-candidate \
  --assistant-source /path/to/archived-nuni-prod \
  --prepare-only --output-dir /tmp/new-assistant-context
```

輸出目錄必須不存在。來源只讀取；clone、index 與 tree 計算在新目錄內，不建立 commit。未提供本機來源時會嘗試 clone manifest 固定的 repository。任何 checksum、input tree、註冊 anchor 或 candidate tree 不符都中止。

`--assistant-candidate` 未帶 `--prepare-only` 時只會用同一份校驗來源建置本機 Docker image，不會推送、部署或改 DB。本次未執行 Docker build。

此來源是 repo 已記錄的 security 候選基線，未核對現行正式 API digest；不得據此直接取代正式站。正式啟用前仍需新版 runtime 的完整 build／回歸、真 platform session／ACL、供應商免費硬額度及相容回滾映像驗證。回滾先關閉 Web/API 同名開關，必要時使用另行驗證的前一映像；本候選沒有 schema 回滾步驟。
