# 在新機器把整個專案完整跑起來

這份是「拿到 `畢業專題_完整可跑_*.zip`（或從 GitHub clone）之後，把整個 monorepo 在另一台機器跑起來」的步驟。涵蓋 mobile（Expo）、web（Next.js）、Firebase Functions、Supabase、AI server（含 LoRA）。

---

## 0. 先看新機器是什麼

| 元件 | 必要 | 建議 |
|---|---|---|
| OS | macOS（Apple Silicon 強烈建議，因 ai-server 走 MLX） | macOS 14+ |
| Node | 20.x | 用 `.nvmrc` 對齊 |
| pnpm | 10.x | `corepack enable && corepack prepare pnpm@10 --activate` |
| Python | 3.11–3.13 | ai-server 用 |
| Xcode | iOS dev 需要 | `xcode-select --install` |
| CocoaPods | iOS dev 需要 | `sudo gem install cocoapods` |
| Ollama | ai-server 預設用 | `brew install ollama` |
| Hugging Face CLI | LoRA pull 用 | 由 ai-server `requirements.txt` 帶入 |

> **ai-server + LoRA 推理目前依賴 MLX**（Apple Silicon）。若新機器是 Intel Mac / Linux / Windows，請改設 `LLM_PROVIDER=groq` 或其他雲端 provider；MLX 推理鏈不可用。

---

## 1. 取得程式碼 + secrets

選一條路：

### 路線 A：拿到 `畢業專題_完整可跑_*.zip`（含 secrets + .git + 最終 LoRA）

```bash
cd ~/Desktop
unzip 畢業專題_完整可跑_*.zip
cd 畢業專題
```

zip 內含：
- 全部原始碼、`.git/`（可直接 `git pull`）
- 全部 `.env.local` / 各 backend `.env`（**含 secrets，請用安全通道傳輸：AirDrop / iCloud Drive 個人資料夾 / 加密 USB；切勿傳上任何公開或共用平台**）
- LoRA 推理用的 `adapters.safetensors`（44 MB，最終版）+ `adapter_config.json`
- `chroma_db`（RAG 向量庫）

### 路線 B：從 GitHub clone + 手動補 secrets

```bash
git clone https://github.com/Miiduoa/graduation.git 畢業專題
cd 畢業專題
# 把以下檔案從舊機器經安全通道搬過來：
#   ./.env.local
#   ./apps/web/.env.local
#   ./apps/mobile/.env.local
#   ./apps/mobile/.env
#   ./backend/ai-server/.env
#   ./backend/functions/.env.campus-demo-3a869
```

---

## 2. 裝 Node 依賴（root + 所有 workspace）

```bash
corepack enable
corepack prepare pnpm@10 --activate
pnpm install
```

`pnpm-lock.yaml` 鎖好版本，`apps/web`、`apps/mobile`、`packages/*`、`backend/functions`、`workers/*` 一次到位。

---

## 3. Mobile（Expo + iOS）

```bash
cd apps/mobile
# JavaScript 依賴已隨 pnpm install
# iOS 原生（如要在 iOS 模擬器跑）：
cd ios && pod install && cd ..
# 啟動 dev server
pnpm start              # 或 pnpm web / pnpm ios / pnpm android
```

EAS Build 設定在 `apps/mobile/eas.json`，CI 設定在 `.github/workflows/`。

---

## 4. Web（Next.js）

```bash
cd apps/web
pnpm dev                # http://localhost:3000
# production build
pnpm build && pnpm start
```

---

## 5. AI server + LoRA

### 5a. 取得 LoRA（若用路線 A 已含最終 adapter，僅需此步補 checkpoint）

LoRA 在 Hugging Face private repo `miiduoa/campus-lora-qwen2.5-7b`。

```bash
# 在 backend/ai-server/.venv 已建好之後（步驟 5b 後第一次跑 run.sh 會建好）
backend/ai-server/.venv/bin/hf auth login   # 貼 HF token
backend/ai-server/.venv/bin/hf download \
  miiduoa/campus-lora-qwen2.5-7b \
  --repo-type model \
  --local-dir backend/ai-server/data/lora_adapters/campus_lora
```

只要 inference（不再訓練）：zip 內的 `adapters.safetensors` + `adapter_config.json` 已足夠，這步可跳過。

要 resume training：HF 上有全部 ~450 個 checkpoint，download 後可從任一 step 繼續。

### 5b. 啟動 ai-server

```bash
cd backend/ai-server
./run.sh                # 自動建 venv、裝 requirements.txt、起 Ollama、跑 server.py (port 8100)
```

LLM provider 切換：在 `backend/ai-server/.env` 設 `LLM_PROVIDER=ollama`（預設，需 Apple Silicon 或本機 GPU）或 `groq` / 其他（需對應 API key）。

---

## 6. Firebase Functions

```bash
cd backend/functions
pnpm install            # 已隨 root pnpm install 完成
# 本機 emulator
pnpm emulator
# 部署（要 firebase login 過）
firebase deploy --only functions
```

---

## 7. Supabase（LMS v2，可選）

預設 `EXPO_PUBLIC_LMS_V2_ENABLED=false`，無 Supabase 也能跑離線 demo。要啟用：

```bash
cd supabase
# 套 migrations
supabase db push
# 部署 edge functions（依需要選）
supabase functions deploy dispatch-notification-push
supabase functions deploy send-expo-push
# ... 詳見 docs/LMS_V2_MIGRATION_RUNBOOK.md
```

---

## 8. 驗證

| 檢查 | 指令 | 預期 |
|---|---|---|
| Mobile 起得來 | `cd apps/mobile && pnpm start --web` | 瀏覽器 18081 看到登入頁 |
| Web 起得來 | `cd apps/web && pnpm dev` | http://localhost:3000 |
| ai-server 起得來 | `cd backend/ai-server && ./run.sh` | port 8100 healthcheck OK |
| LoRA loaded | `curl localhost:8100/health` | response 含 adapter 資訊 |
| Functions emulator | `cd backend/functions && pnpm emulator` | functions:emulator UI 起來 |

---

## 9. 安全提醒

- **zip 內含的 `.env.local` / `.env` 是真實 secrets**。請：
  - **只**透過安全通道搬（AirDrop 到自己另一台 Mac、iCloud Drive 個人資料夾、加密 USB）
  - **永不**上傳到 GitHub（含 private repo）、Slack、Email、共用雲端硬碟
  - 完成 onboarding 後，建議把 zip 從新機器刪除，只留解壓出的工作目錄
- 若 zip 流入第三方手中（誤傳、遺失裝置），**立即 rotate** 以下 keys：
  - Firebase service account
  - Supabase service role key
  - Groq / OpenAI / Anthropic / HF token
  - Google OAuth client secret
  - Expo push token credentials

---

## 10. 常見問題

**Q: 新機器是 Intel Mac，ai-server 報 MLX 錯**  
A: 改 `backend/ai-server/.env` 的 `LLM_PROVIDER=groq` + 設 `GROQ_API_KEY`；MLX-only 的 LoRA 推理會失效，改用雲端模型。

**Q: `pod install` 卡住**  
A: 先 `cd apps/mobile/ios && pod repo update`；M 系列 Mac 可能需要 `arch -arm64 pod install`。

**Q: HF download 慢/中斷**  
A: 改用 `--max-workers 16` 或 `hf download ... --resume`；private repo 要先 `hf auth login`。

**Q: 不想下 LoRA，純前端 demo**  
A: 設 `EXPO_PUBLIC_AI_PROVIDER=cloud` + 對應 cloud key，前端走雲端 AI，不需 ai-server。
