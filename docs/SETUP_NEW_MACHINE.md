# nuni 開發環境設定

先把需要修改的那一端跑起來，再接對應資料來源。一般 Web／App 開發不需要先安裝本機模型、下載 LoRA，或取得所有正式環境憑證。

本文件依 repository 的 [.nvmrc](../.nvmrc)、[package.json](../package.json) 與 [CI 設定](../.github/workflows/ci.yml) 整理；外部服務的開通與部署另按各自文件處理。

## 1. 準備工具

| 工具                        | 什麼時候需要                  | 本專案基準                                            |
| --------------------------- | ----------------------------- | ----------------------------------------------------- |
| Git                         | 取得及更新程式碼              | 可使用 HTTPS clone                                    |
| Node.js                     | Web、Mobile 與 Node 後端      | `.nvmrc` 為 **22.23.4**，與 CI 一致                   |
| pnpm                        | 安裝 workspace 依賴           | 根目錄固定 **10.28.2**                                |
| Xcode、CocoaPods            | 在 macOS 編譯 iOS App         | 需要完整 Xcode、iOS simulator 與對應原生環境          |
| Android Studio／Android SDK | 編譯 Android App              | 使用已設定的模擬器或實機                              |
| Java                        | Firebase 規則與隔離環境測試   | CI 使用 Java **21**                                   |
| Python                      | 選用的本機 AI、來源重建等腳本 | 本機 AI `run.sh` 要求 **3.12 以上**；其餘依各腳本需求 |

根目錄 `engines` 仍允許 Node 20.19.4–20.x，但 Functions 的執行環境為 Node 22，新環境直接對齊 `.nvmrc`。Web 與一般 Node 開發不限定 macOS；iOS 編譯與 MLX 本機模型另有平台限制。

## 2. 取得程式碼與安裝依賴

```bash
git clone https://github.com/Miiduoa/graduation.git
cd graduation
```

若使用 nvm：

```bash
nvm install
nvm use
```

啟用專案指定的套件管理器後安裝：

```bash
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm install --frozen-lockfile
```

從根目錄安裝會包含 `apps/*`、`packages/*`、`backend/*` 與 `workers/*`。遇到 lockfile 不符時，先確認 Node／pnpm 版本及分支，保留 lockfile 供檢查。

## 3. 啟動 Web

```bash
pnpm dev:web
```

預設網址為 `http://localhost:3000`。這個指令會先建立必要的共用模組與匯入資產，再啟動 Next.js。

需要外部服務時，在新 clone 中建立設定檔：

```bash
cp apps/web/.env.example apps/web/.env.local
```

已有 `.env.local` 時不要覆寫。依需要填入自己的開發服務；未使用的範例占位值應清空。尚未設定資料源時，登入、校務或即時服務可能顯示未開通／無法連線，需依該功能設定完成後驗證。

平台課程與 Google 登入另參考 [Web nuni 設定](../apps/web/nuni.env.example) 及 [Web README](../apps/web/README.md)：

- `NUNI_CLASSROOM_ENABLED` 控制平台 API；`NUNI_API_BASE_URL` 指向經授權的 API 環境。
- 本機 `WEB_PUBLIC_ORIGIN` 應與瀏覽器來源一致，例如 `http://localhost:3000`；Google callback 也需是該 OAuth 設定允許的來源。
- `BFF_SESSION_SECRET` 至少 32 字元，使用獨立的開發用值。Google client secret 與模型金鑰只放在伺服器設定。
- 直接複製範例不會替本機註冊 OAuth、建立帳號、開通學校，或提供正式 API 的管理權限。

正式模式的本機檢查：

```bash
pnpm --filter web build
pnpm --filter web start
```

## 4. 啟動 Mobile

在新 clone 建立 App 設定；已有設定檔時保留原內容：

```bash
cp apps/mobile/.env.example apps/mobile/.env
pnpm dev:mobile
```

`pnpm dev:mobile` 啟動 Expo 開發伺服器。原生 Google 登入、裝置功能與自訂 module 需要重新編譯 App，不能只用 Expo Go 代表完整原生功能。

| 目標                  | 在 repository 根目錄執行       |
| --------------------- | ------------------------------ |
| iOS simulator         | `pnpm ios:sim`                 |
| Android               | `pnpm --filter mobile android` |
| React Native Web 預覽 | `pnpm --filter mobile web`     |

iOS 需要完整 Xcode 與 simulator；需要簽署時依自己的開發帳號設定。原生 Google 登入另依 [Mobile 環境範例](../apps/mobile/.env.example) 設定與 bundle ID 相符的公開 client ID，再執行：

```bash
pnpm --filter mobile native:configure-google
pnpm --filter mobile native:check-google
```

更改原生設定後重新編譯。React Native Web 預覽可檢查部分版面與邏輯，不能替代 iOS／Android 的相機、通知、NFC 或原生登入驗收。

### 使用模擬資料時

App 的 [資料來源設定](../apps/mobile/src/config/runtime.ts) 支援 `mock`、`firebase`、`hybrid`。開發展示可明確選 `EXPO_PUBLIC_DATA_SOURCE_MODE=mock` 與 `EXPO_PUBLIC_API_ENV=development`；真實服務測試則保留相應資料源。平台 API 與校園 DataSource 是不同路徑，切換成 mock 不會自動模擬 nuni 課程 API。

離線 AI 可用 `EXPO_PUBLIC_AI_PROVIDER=offline`；若也不需要公開網路查詢，將 `EXPO_PUBLIC_AI_ENABLE_WEB_SEARCH`、`EXPO_PUBLIC_AI_WEB_LEARNING_ENABLED` 設為 `false`。需避免 TronClass 取數的展示，另設 `EXPO_PUBLIC_TRONCLASS_DATA_ENABLED=false`。這些設定不會停用 App 所有網路請求。

## 5. 選用後端與隔離測試

### nuni 平台 API

目前平台帳號、課程與相關資料透過 nuni API 使用。Web BFF 與手機 transport 各自持有平台 session，與 Firebase 校園登入分開。後端可重建來源與候選修補位於 [deploy/nuni-api](../deploy/nuni-api/README.md)。

該目錄包含多個明確指定的候選組合；請依對應 runbook 選擇。建置映像不會自動部署、套用 migration 或授予資料庫權限。

### Firebase／校園服務

`pnpm dev:functions` 目前只顯示設定說明，並不啟動 Functions emulator。已有伺服器環境與憑證時，可使用現有 HTTP host：

```bash
pnpm --filter functions serve:fly
```

這是本機啟動指令，會依環境設定接觸資料服務；先依 [Functions HTTP host 說明](deploy/functions-on-fly.md) 準備正確的開發來源與權限。不要以正式資料庫測試寫入。

專案另有固定 `demo-` 專案的隔離測試入口，需要 Java 21：

```bash
pnpm test-env:start
```

此腳本啟動 Firebase Auth、Firestore、Functions 模擬器、建立測試資料並開啟 `http://127.0.0.1:3291`。它驗證 Firebase 路徑，不會建立完整 nuni API 或模擬 Google OAuth。實際埠號與環境設定見 [env.sh](../scripts/test-env/env.sh)；啟動流程見 [start.sh](../scripts/test-env/start.sh)。

### 本機 AI 與 Supabase

本機 AI 是選用路徑。`backend/ai-server/run.sh` 會檢查 Python 3.12 以上，安裝含 Chroma／MLX 的本機依賴，再按 provider 啟動服務；MLX 需要相容的 Apple Silicon 環境。只改 `LLM_PROVIDER` 不會移除 `requirements.txt` 裡的 MLX 安裝需求。其他平台應依 [Python AI server 說明](security/python-ai-server.md) 檢查獨立 cloud 依賴路徑，而非照抄本機 LoRA 安裝流程。

已備妥相容環境與自己的設定時，從 repository 根目錄啟動：

```bash
pnpm dev:ai
```

公開綁定仍要求 Firebase 驗證；詳細設定見 [AI 環境範例](../backend/ai-server/.env.example)。一般 Web／Mobile 開發無須下載私人模型或訓練 checkpoint。

Supabase 是既有 LMS v2 的另一條整合路徑，依 [LMS v2 遷移文件](LMS_V2_MIGRATION_RUNBOOK.md) 與 [資料權限說明](SUPABASE_DATA_API_PERMISSIONS.md) 設定。不要為了啟動前端就對遠端執行 `db push` 或部署 functions。

## 6. 驗證修改

依實際修改的範圍選擇檢查：

| 範圍              | 指令                                                          |
| ----------------- | ------------------------------------------------------------- |
| Web 型別／規則    | `pnpm --filter web typecheck`、`pnpm --filter web lint`       |
| Web 測試          | `pnpm --filter web test`                                      |
| Mobile 型別／規則 | `pnpm --filter mobile typecheck`、`pnpm --filter mobile lint` |
| Mobile 測試       | `pnpm --filter mobile test`                                   |
| 共用契約          | `pnpm --filter @campus/shared typecheck`                      |
| Firebase 授權規則 | `pnpm test:rules`，需 Java 21                                 |
| 完整靜態檢查      | `pnpm lint`、`pnpm typecheck`、`pnpm format:check`            |

原生流程另外依 [Maestro 說明](../apps/mobile/.maestro/README.md) 驗證；雲端建置及商店交付見 [App 發布文件](STORE_RELEASE.md)。一般安裝與測試不需要 `EXPO_TOKEN`。

## 7. 設定與交接

交接程式碼、環境變數名稱和必要權限說明即可。服務帳戶、正式 `.env`、存取權杖與模型金鑰由各環境的秘密管理機制配置，避免和程式碼一起打包。服務帳戶檔案留在 repository 外；`NEXT_PUBLIC_*` 與 `EXPO_PUBLIC_*` 會進入用戶端，不能放私密金鑰。

若畫面可啟動卻沒有資料，依序核對目前帳號、所選學校、服務開關、API 來源及回應；不要把模擬資料顯示正常當成正式串接已完成。發布前再對照 [測試證據](TESTING_EVIDENCE.md) 與 [發布紀錄](PLATFORM_RELEASE.md)。
