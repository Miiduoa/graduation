# 校園助手（Campus One）

<p align="center">
  <a href="https://github.com/Miiduoa/graduation"><img src="https://img.shields.io/badge/GitHub-Miiduoa%2Fgraduation-181717?logo=github" alt="GitHub repository" /></a>
  <a href="https://github.com/Miiduoa/graduation/actions"><img src="https://img.shields.io/github/actions/workflow/status/Miiduoa/graduation/ci.yml?branch=main&label=CI&logo=githubactions" alt="CI status" /></a>
  <img src="https://img.shields.io/badge/License-MIT-22c55e" alt="License MIT" />
  <img src="https://img.shields.io/badge/Monorepo-pnpm%20workspace-0f766e" alt="pnpm workspace" />
  <img src="https://img.shields.io/badge/Mobile-Expo%2054%20%2B%20React%20Native%200.81-2563eb" alt="Expo 54 + React Native 0.81" />
  <img src="https://img.shields.io/badge/Web-Next.js%2016%20%2B%20React%2019-111827" alt="Next.js 16 + React 19" />
  <img src="https://img.shields.io/badge/Backend-Firebase%20Functions%20v2%20%2B%20Firestore-ef6c00" alt="Firebase Functions v2 + Firestore" />
  <img src="https://img.shields.io/badge/Runtime-Node%2020%20%2F%20pnpm%2010-7c3aed" alt="Node 20 / pnpm 10" />
</p>

> **官方倉庫：** [github.com/Miiduoa/graduation](https://github.com/Miiduoa/graduation)  
> 本 README 依據 **2026-04-29** 對目前 repo 的實際檔案、workspace 設定、`package.json`、GitHub workflow、env 範本、登入畫面、runtime 設定與測試配置進行盤點整理。若其他文件與此處衝突，請先以 **本 README 與程式碼本身** 為準。

## 快速連結

| 資源           | 位置                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| 原始碼         | [github.com/Miiduoa/graduation](https://github.com/Miiduoa/graduation)                           |
| GitHub Actions | [Actions](https://github.com/Miiduoa/graduation/actions)                                         |
| CI workflow    | [`.github/workflows/ci.yml`](.github/workflows/ci.yml)                                           |
| Release 流程   | [`docs/RELEASE.md`](docs/RELEASE.md)                                                             |
| 安全說明       | [`docs/SECURITY.md`](docs/SECURITY.md)                                                           |
| 架構邊界       | [`docs/architecture/firebase-data-boundaries.md`](docs/architecture/firebase-data-boundaries.md) |
| 法務文件       | [`docs/legal/`](docs/legal/)                                                                     |

## 本次盤點範圍（2026-04-29）

這次 README 更新不是只改日期，而是重新對照下列來源後整理：

- Root workspace：`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.json`、ESLint / Prettier 設定
- Mobile：`apps/mobile/package.json`、`App.tsx`、`app.config.ts`、`src/config/runtime.ts`、登入與資料同步服務、測試目錄、Maestro flows
- Web：`apps/web/package.json`、`src/app/` routes、`src/lib/` Firebase / SSO / navigation helper、PWA manifest / service worker
- Backend：`backend/functions/package.json`、`index.js` 匯出、PU / TronClass scraper、SSO secret/config helper、security validation、rules 測試
- Shared：`packages/shared/src/` 的型別、學校目錄、PU auth contract、release 設定
- GitHub：`.github/workflows/` 內 5 條 workflow 的觸發條件、測試與 build gate
- 文件：`docs/`、`apps/web/README.md`、各 `.env.example`

本 README 的定位是「目前 repo 的接手入口」。`docs/API.md`、`docs/RELEASE.md`、`apps/mobile/DEMO.md` 等文件仍有參考價值，但若內容與目前程式碼或本 README 不一致，請優先回到程式碼與本 README 判斷。

## 這個專案現在是什麼

這是一個以 `pnpm workspace` 管理的校園平台 monorepo，核心由四個主體組成：

- `apps/mobile`：Expo / React Native 行動端
- `apps/web`：Next.js App Router Web / PWA
- `backend/functions`：Firebase Cloud Functions v2
- `packages/shared`：共用型別、學校資料、發布設定與 PU 驗證契約

除此之外，repo 內還有一條獨立的 AI 服務線：

- `backend/ai-server`：Python AI server，支援 `ollama` / `Together` / `Groq` 類 OpenAI-compatible provider，並有 `prepare` / `train` / `eval` / `grow` 腳本

這個倉庫不是只有畫面樣板，也不是純 demo mock。它已經有：

- Mobile、Web、Functions、Shared 的 workspace 結構
- Firebase Auth / Firestore / Functions / Rules
- GitHub CI、EAS Build、Preview Update、Maestro E2E
- 多個校園服務面向：課務、校園、訊息、支付、圖書館、交通、AI、管理端
- 一套已開始收斂的文件與 release / security / legal 支援面

## 目前最重要的 7 個事實

### 1. 產品入口已收斂成 PU-only

目前真正的登入主路徑是 **靜宜大學（PU）學號與 e 校園密碼登入**。
Web 的 [`apps/web/src/app/login/page.tsx`](apps/web/src/app/login/page.tsx) 與 Mobile 的 [`apps/mobile/src/screens/SSOLoginScreen.tsx`](apps/mobile/src/screens/SSOLoginScreen.tsx) 都明確寫出：

- 目前已鎖定為 `PU-only`
- 登入後會建立 Firebase session
- 會同步課表、成績、TronClass 與校園資料
- 舊的 SSO / email / 訪客登入，不再是現在版本的主要產品入口

### 2. 底層架構仍保留多校能力

雖然目前對外入口是 PU-only，但底層仍保留多校與 SSO 擴充能力，例如：

- `packages/shared/src/schools.ts`
- `apps/mobile/src/data/apiAdapters/`
- `apps/web/src/lib/sso.ts`
- `backend/functions/sso/`

比較準確的說法是：

> **產品入口先收斂到 PU，平台底層仍保留多校擴充能力。**

### 3. Mobile runtime 的「設計目標」與 `.env.example` 預設值不同

這點很容易讓接手者誤判。

- `apps/mobile/src/config/runtime.ts` 內的設計目標模式是 `hybrid`
- 若沒有提供 `EXPO_PUBLIC_DATA_SOURCE_MODE`，開發環境 fallback 也是 `hybrid`
- 但 `apps/mobile/.env.example` 寫的是 `EXPO_PUBLIC_DATA_SOURCE_MODE=mock`

也就是說：

- **你不設 env 時**，程式傾向走 `hybrid`
- **你直接複製 mobile 的 env 範本時**，程式會走 `mock`

README 下方的環境變數章節已把這個差異寫清楚。

### 4. CI 目前有完整 lint / typecheck / test / build gate，但沒有自動跑 rules 測試

目前 GitHub CI 會跑：

- Security audit
- gitleaks secret scan
- lint
- typecheck
- mobile tests
- web tests
- functions tests
- mobile / web build 驗證

但 **`pnpm test:rules` 目前沒有被放進 GitHub workflow**。
Firestore / Storage security rules 測試仍是 repo 內可手動執行的檢查，不是現行 CI gate 的一部分。

### 5. 根層 `.env.example` 很完整，但它比現在產品狀態更廣

根目錄 `.env.example` 仍保留了比較「平台願景 / 多校 / 多支付 / 多外部服務」的變數集合。
它有參考價值，但若目標是快速把目前專案跑起來，請優先看：

- `apps/mobile/.env.example`
- `apps/web/.env.example`
- `backend/functions/.env.example`
- `backend/ai-server/.env.example`

### 6. Web 端已是產品入口，不是附屬展示頁

`apps/web` 已納入 workspace、CI、測試與 build gate。它目前包含：

- PU 學號登入頁
- school-aware navigation / page context
- 公告、地圖、餐廳、圖書館、群組、課表、成績、搜尋、設定等頁面
- PWA manifest、service worker、offline / update / install banner
- Firebase helper 與 mock fallback

所以 Web 端應被視為正式產品的一部分，而不是可忽略的 demo shell。

### 7. Preview / production build 比本機 dev 嚴格很多

本機可以靠 mock 或 hybrid fallback 跑起來，但 `apps/mobile/app.config.ts` 對 `preview` / `production` 會強制檢查 EAS、Firebase、legal URL、error reporting、Google Maps、released school、deep link 與 build number。

換句話說：

- `pnpm dev:mobile` 能跑，不代表 EAS preview 能送出
- `pnpm --filter web build` 能過，不代表 mobile release env 已完整
- release 前必須先檢查 GitHub secrets、EAS profile、Firebase project 與 legal URL

## 專案快照（2026-04-29 盤點）

下列數字來自 repo 內實際檔案與 `backend/functions/index.js` 的匯出盤點，之後若功能再增減，請以當下程式碼為準。

| 面向                | 盤點結果                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Mobile UI           | `81` 個 `*Screen.tsx`、`13` 個 `*Stack.tsx`                                                         |
| Web 路由            | `20` 個 `page.tsx`、`4` 個 `route.ts`                                                               |
| Backend Functions   | `64` 個 `onCall`、`14` 個 `onRequest`、`5` 個 `onSchedule`、`11` 個 Firestore `onDocument*` trigger |
| 測試檔              | Mobile `16`、Web `5`、Backend `4`（其中 Functions `3`、Rules `1`）                                  |
| GitHub workflow     | `5` 個：CI、Release、EAS Build、Preview Deploy、Maestro E2E                                         |
| E2E flow            | `10` 個 Maestro flow                                                                                |
| Shared school list  | `24` 筆學校資料，其中目前產品入口收斂到 `pu`                                                        |
| 文件檔              | `docs/` 內 `13` 個文件，含架構、API、release、安全與 legal                                          |
| Repo utility script | 根層 `3` 個：`bump-version.mjs`、`live-file-review.mjs`、`seedFirestore.ts`                         |
| AI server           | `backend/ai-server/` 約 `27` 個檔案，含 Python service、RAG、self-training 與 cloud deploy 設定     |

## Monorepo 結構

```text
畢業專題/
├── apps/
│   ├── mobile/                  # Expo / React Native app
│   │   ├── src/
│   │   ├── ios/                 # iOS native project
│   │   ├── ios-widget/          # iOS Widget
│   │   ├── android-widget/      # Android Widget
│   │   └── .maestro/flows/      # Maestro E2E
│   └── web/                     # Next.js 16 App Router / PWA
├── backend/
│   ├── functions/               # Firebase Cloud Functions v2
│   ├── ai-server/               # Python AI service / training pipeline
│   ├── firestore/               # Firestore rules / indexes
│   ├── storage/                 # Storage rules
│   └── tests/                   # Security rules tests
├── packages/
│   └── shared/                  # 型別、school、release、PU auth 契約
├── docs/                        # 架構、API、法務、安全、release
├── scripts/                     # 版本、review、seed 工具
├── .github/workflows/           # CI / release / preview / E2E
├── package.json                 # root scripts / workspace tooling
└── pnpm-workspace.yaml
```

`pnpm-workspace.yaml` 目前納入的 workspace 範圍是：

- `apps/*`
- `packages/*`
- `backend/*`

## 技術棧

| 區塊              | 主要技術                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Root runtime      | Node `>=20 <21`、pnpm `10.28.2`                                                               |
| Mobile            | Expo `~54.0.33`、React Native `0.81.5`、React `19.1.0`、React Navigation 7、Firebase `12.8.0` |
| Web               | Next.js `16.1.7`、React `19.2.3`、Vitest `4.1.0`、Leaflet / react-leaflet                     |
| Backend Functions | `firebase-functions` `^6.0.0`、`firebase-admin` `^13.0.0`、Node 20                            |
| Shared package    | TypeScript ESM package `@campus/shared`                                                       |
| Tooling           | ESLint 9、Prettier 3、Jest、Vitest、Maestro、EAS                                              |
| AI server         | Python service，provider 可選 `ollama` / `Together` / `Groq` 類相容端點                       |

## Workspace 對照表

| Workspace / 區域    | 主要語言         | 入口與重點檔案                                                                                 | 常用指令                                     |
| ------------------- | ---------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| root                | TS / JS tooling  | `package.json`、`pnpm-workspace.yaml`、`eslint.config.mjs`、`scripts/`                         | `pnpm lint`、`pnpm typecheck`、`pnpm format` |
| `apps/mobile`       | TypeScript / TSX | `App.tsx`、`app.config.ts`、`src/config/runtime.ts`、`src/screens/`、`src/services/`           | `pnpm --filter mobile start/test/typecheck`  |
| `apps/web`          | TypeScript / TSX | `src/app/`、`src/components/`、`src/lib/firebase.ts`、`src/lib/sso.ts`、`public/manifest.json` | `pnpm --filter web dev/test/build`           |
| `backend/functions` | JavaScript       | `index.js`、`authz.js`、`securityUtils.js`、`puScraper.js`、`tronClassScraper.js`              | `pnpm --filter functions serve/test/lint`    |
| `backend/ai-server` | Python           | `server.py`、`llm_client.py`、`rag/`、`training/`、`self_training/`、`run.sh`                  | `pnpm dev:ai`、`pnpm ai:prepare/train/eval`  |
| `backend/firestore` | Firebase rules   | `firestore.rules`、`firestore.indexes.json`                                                    | `pnpm test:rules`                            |
| `backend/storage`   | Firebase rules   | `storage.rules`                                                                                | `pnpm test:rules`                            |
| `packages/shared`   | TypeScript       | `src/index.ts`、`src/schools.ts`、`src/puAuth.ts`、`src/release.ts`                            | `pnpm --filter @campus/shared typecheck`     |

幾個維護上要注意的點：

- Root `typecheck` 目前包含 mobile / web / shared，沒有對 `backend/functions` 做 TypeScript 檢查，因為 Functions 目前是 JavaScript。
- Root `dev` 目前等同 `dev:web`，不是同時啟動 mobile、web、functions 與 AI server。
- `backend/*` 也被納入 pnpm workspace，所以 `backend/functions` 的套件管理仍應走 pnpm，而不是在子目錄混用 npm lockfile。
- `backend/ai-server` 是 Python 服務，雖然在 workspace 範圍內，但依賴安裝與執行主要走 `run.sh` / `requirements*.txt`。

## 現在產品的主要功能面

### Mobile

行動端的導航邏輯已經不是「首頁 + 功能拼盤」，而是明確的 5-tab 心理模型：

1. `Today`
2. 角色導向第二入口
3. `校園`
4. `收件匣`
5. `我的`

第二個 tab 會依角色切換為：

- `課程`
- `教學`
- `服務`
- `審核`
- `管理`

從 `apps/mobile/src/screens/` 的命名與實作來看，目前主要功能面至少包含：

- 今日首頁、公告、活動、個人化入口
- 課表、課程模組、教室、點名、作業、測驗、成績、學習分析
- 地圖、AR 導航、無障礙路線、公車、圖書館、餐廳、點餐、支付、宿舍、健康中心、列印
- 收件匣、群組、訊息、聊天室、作業協作
- QR Code、Widget Preview、Credit Audit、成就、AI Chat、AI Course Advisor
- Admin / Department / Teaching / Staff 多角色入口

另外還有幾個很重要的基礎能力：

- 離線同步與衝突處理：`src/services/offline.ts`
- cached / hybrid data source：`src/data/cachedSource.ts`、`src/data/hybridSource.ts`
- 推播通知：`src/services/notifications.ts`
- 效能與錯誤回報：`src/services/performance.ts`、`src/services/errorReporting.ts`
- iOS / Android widget：`ios-widget/`、`android-widget/`、`src/widgets/`

`apps/mobile/App.tsx` 目前同時承擔 root navigation、provider composition、deep link config、offline sync toast、conflict modal 與 push notification bootstrap。接手 mobile 功能時，請先看清楚下列 provider / state 的分工：

- `SchoolProvider`：目前選定學校與 school-aware context
- `AuthProvider`：登入身份、角色與 auth state
- `DemoProvider`：demo / mock runtime 相關狀態
- `ThemeProvider`、`AccessibilityProvider`、`PreferencesProvider`：外觀、無障礙與偏好設定
- `NotificationsProvider`、`SearchHistoryProvider`、`ScheduleProvider`、`FavoritesProvider`：功能性 shared state
- `initializeRuntimeDataSource()`：在 app 啟動時決定使用 mock、firebase 或 hybrid data source

### Web

Web 端不是 `create-next-app` 預設模板，現在已經是校園入口型 PWA shell。

目前 `apps/web/src/app/` 可見的頁面與 route 包括：

- `/`
- `/login`
- `/announcements`
- `/map`
- `/cafeteria`
- `/library`
- `/groups`
- `/timetable`
- `/grades`
- `/profile`
- `/settings`
- `/search`
- `/bus`
- `/clubs`
- `/join`
- `/privacy`
- `/terms`
- `/sso-callback`
- `/course/[courseId]`
- `/teacher/course/[courseId]`
- `/.well-known/apple-app-site-association`
- `/.well-known/assetlinks.json`
- `/apple-app-site-association`
- `/sso/acs`

Web 端可明確確認的能力：

- PWA manifest 與 service worker：`public/manifest.json`、`public/sw.js`
- 安裝 / 更新 / 離線提示 banner：`src/components/PWAInstallBanner.tsx`、`UpdateBanner.tsx`、`OfflineBanner.tsx`
- auth shell：`src/components/AuthGuard.tsx`
- school-aware page context 與 navigation helper：`src/lib/pageContext.ts`、`src/lib/navigation.ts`
- Firebase auth helper：`src/lib/firebase.ts`
- Web SSO helper：`src/lib/sso.ts`

Web 端資料讀取策略偏保守：Firebase 已設定時會讀 Firestore / Auth；Firebase 未設定或讀取失敗時，頁面多半會降級顯示 shared mock data，讓 UI 和 PWA shell 在沒有完整後端時仍可開發與展示。

### Backend（Firebase Functions）

`backend/functions/index.js` 已經不是只有幾支登入 API，而是橫跨多個校園領域的 Functions 入口。從匯出名稱可以看到至少有：

- 認證 / SSO：`signInPuStudentId`、`startSSOAuth`、`verifySSOCallback`、`getSSOConfig`、`updateSSOConfig`
- PU / TronClass 整合：`puAuthenticate`、`puFetchData`、`puFetchCampusData`、`puRefreshTronClassSession`、`puFetchTronClassData`
- AI 助理：`askCampusAssistant`
- 使用者與權限：`getUserProfile`、`updateUserProfile`、school member role / service role 相關 callable
- 校園內容：公告、活動、群組、作業、訊息、通知 trigger
- 圖書館與座位：`searchBooks`、`borrowBook`、`renewBook`、`reserveSeat`
- 餐飲與支付：點餐、付款、錢包、退款、webhook
- 宿舍、洗衣、健康、列印、公車
- 成就、即時教室、投票、reaction、daily brief、weekly report

一句話理解目前 backend：

> **Firebase 為中心的校園平台後端，目前同時負責登入、同步、通知、校務代理、校園服務與部分營運管理接口。**

Functions 維護時要特別留意：

- 主要匯出集中在 `backend/functions/index.js`，改動時容易影響多個產品面。
- `puScraper.js` 與 `tronClassScraper.js` 是 PU / TronClass 整合的關鍵，不應在 client 重做敏感登入流程。
- SSO 設定拆成 public / private 文件，private payload 透過 `sso/secretStore.js` 加密。
- `securityUtils.js` 與 `security/validation.js` 處理 CORS、rate limit、runtime env、HTTP JSON 驗證等邊界。
- `authz.js` 定義 school member / service role / admin/editor 等授權邏輯，新增管理端功能時應先對齊這裡。

## 執行模型與資料流

### Runtime modes

Mobile 端目前支援三種資料來源模式：

| 模式       | 用途                                         |
| ---------- | -------------------------------------------- |
| `mock`     | 純前端 / UI 開發、快速展示                   |
| `firebase` | Firebase 驗證、demo runtime、整合驗證        |
| `hybrid`   | 真實校務整合目標模式，搭配 adapter / backend |

關鍵實作位於 [`apps/mobile/src/config/runtime.ts`](apps/mobile/src/config/runtime.ts)。

### Data boundary

目前 repo 的資料邊界與原則，對照 [`docs/architecture/firebase-data-boundaries.md`](docs/architecture/firebase-data-boundaries.md)，可以簡化成：

```mermaid
flowchart LR
    A["Mobile / Web"] --> B["Firebase Auth"]
    A --> C["Firestore / Storage"]
    A --> D["Cloud Functions"]
    D --> E["PU 校務代理"]
    D --> F["TronClass 代理"]
    D --> G["SSO / Admin / Notifications / AI"]
```

目前應遵守的原則：

- Firestore 適合 app-native、realtime、協作型資料
- 校務、成績、出缺席、圖書館、支付等 institutional records 應透過 adapter 或 backend
- 畫面層不應直接在 screen 裡自行拼 Firestore 業務邏輯，應透過 `DataSource` 或 feature repository
- Security Rules 負責 access control；敏感商業驗證應放在 Functions / backend

### 登入與同步流程

目前最主要的登入與同步流程是：

1. 使用者在 Web 或 Mobile 輸入 PU 學號與密碼
2. Backend `signInPuStudentId` 驗證 E 校園帳密
3. Backend 建立 Firebase custom token / session
4. 後端與 client 一起同步 PU 與 TronClass 資料
5. App 載入課表、成績、公告、課程與校園資料

`apps/mobile/src/services/studentIdAuth.ts` 的設計也很清楚：

- 優先走後端統一登入
- 若後端不可用，再降級為部分 hybrid 流程
- TronClass 登入不建議讓手機端直接處理

### Auth / data contract 對照

| 層級    | 目前責任                                                                         | 重要檔案                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Web     | 呈現 PU-only login、呼叫 Firebase / Functions helper、保留 SSO route 基礎        | `apps/web/src/app/login/page.tsx`、`apps/web/src/features/auth/client.ts`、`apps/web/src/lib/sso.ts`                                     |
| Mobile  | 學號密碼輸入、登入進度、SecureStore credential/session handling、hybrid fallback | `apps/mobile/src/screens/SSOLoginScreen.tsx`、`apps/mobile/src/services/studentIdAuth.ts`、`apps/mobile/src/services/tronClassClient.ts` |
| Backend | 驗證 PU 帳密、建立 session、代理 TronClass、回傳課表 / 成績 / 公告等資料         | `backend/functions/index.js`、`backend/functions/puScraper.js`、`backend/functions/tronClassScraper.js`                                  |
| Shared  | 型別、學校資料、PU auth contract、release / tenant 基礎資料                      | `packages/shared/src/index.ts`、`packages/shared/src/schools.ts`、`packages/shared/src/puAuth.ts`                                        |

目前不建議新增第二套登入主流程。若要重新啟用多校 SSO，應先把「PU-only 產品入口」與「多校 SSO 平台能力」拆成明確 feature flag / release strategy，避免 UI 顯示多入口但 backend / data sync 仍只對 PU 完整。

## 本機開發

### 需求

- Node.js `>=20 <21`
- pnpm `10.28.2`
- Java 21
  - `pnpm test:rules` 會使用 Firebase emulator，需要 Java
- Xcode / Android Studio
  - 若要跑原生 mobile build
- Python 環境
  - 若要啟動 `backend/ai-server`

### 安裝

```bash
git clone https://github.com/Miiduoa/graduation.git
cd graduation
pnpm install
```

### 環境變數檔案

目前 repo 內最重要的 env 範本如下：

| 檔案                             | 用途               | 備註                                                 |
| -------------------------------- | ------------------ | ---------------------------------------------------- |
| `.env.example`                   | 根層總範本         | 最完整，但也最泛化，包含較多多校 / 支付 / 願景型設定 |
| `apps/mobile/.env.example`       | Mobile 本機開發    | 預設 `EXPO_PUBLIC_DATA_SOURCE_MODE=mock`             |
| `apps/web/.env.example`          | Web PWA            | 包含 Firebase 與 server-side admin base64            |
| `backend/functions/.env.example` | Firebase Functions | OpenAI、SSO、webhook、email 等                       |
| `backend/ai-server/.env.example` | Python AI server   | `ollama` / `Together` / `Groq` provider 設定         |

常見起手式：

```bash
cp apps/mobile/.env.example apps/mobile/.env
cp apps/web/.env.example apps/web/.env.local
cp backend/functions/.env.example backend/functions/.env
cp backend/ai-server/.env.example backend/ai-server/.env
```

最小可開發組合可以分四種情境看：

| 情境                  | 建議設定                                                                                                      | 適合用途                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 純 UI / demo          | mobile 使用 `EXPO_PUBLIC_DATA_SOURCE_MODE=mock`，Web Firebase 可留 mock placeholder                           | 畫面、navigation、mock data 展示             |
| Firebase 整合         | 補齊 `EXPO_PUBLIC_FIREBASE_*`、`NEXT_PUBLIC_FIREBASE_*`、Functions emulator / project                         | Auth、Firestore、Functions 串接驗證          |
| PU / TronClass hybrid | mobile 使用 `hybrid`，Functions 可連 PU / TronClass 代理，必要 secrets / region / project 都要正確            | 真實校務資料登入、課表、成績、TronClass 同步 |
| Preview / production  | 補齊 EAS、Firebase、legal、error reporting、Google Maps、released schools、deep links、iOS/Android build 編號 | EAS build、release、商店提交                 |

環境變數原則：

- 不要把真實 `.env`、service account JSON、API key、token 或 webhook secret commit 到 repo。
- Web client 可見的變數必須使用 `NEXT_PUBLIC_`；Mobile client 可見的變數必須使用 `EXPO_PUBLIC_`。
- Functions secrets 優先用 Firebase Secret Manager / GitHub secrets，不要只依賴 `.env.example`。
- `apps/mobile/.env.example` 的 `mock` 預設是為了安全展示；真實整合測試要明確改成 `hybrid` 或 `firebase`。

### Release-like build 額外要求

`apps/mobile/app.config.ts` 對 `preview` / `production` build 有更嚴格的 env 檢查。若要跑 release-like build，至少要補齊：

- `EXPO_PUBLIC_EAS_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`
- `EXPO_PUBLIC_RELEASED_SCHOOL_IDS`
- `EXPO_PUBLIC_LEGAL_BASE_URL`
- `EXPO_PUBLIC_ERROR_REPORTING_ENDPOINT`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
- `EXPO_PUBLIC_DEEP_LINK_HOST`
  - 若啟用 deep links
- `IOS_BUILD_NUMBER`
- `ANDROID_VERSION_CODE`
  - release-like build 需要正整數

能在 dev mode 跑起來，不代表能直接進 preview / production build。

### 啟動指令

```bash
pnpm dev
pnpm dev:web
pnpm dev:mobile
pnpm dev:functions
pnpm dev:ai
```

說明：

- `pnpm dev` 目前等同於 `pnpm dev:web`
- `pnpm dev:mobile` 會啟動 Expo
- `pnpm dev:functions` 會啟動 Firebase Functions emulator
- `pnpm dev:ai` 會進入 `backend/ai-server` 執行 `run.sh`

若要直接跑原生 app：

```bash
pnpm --filter mobile ios
pnpm --filter mobile android
```

### AI server 相關命令

根目錄 `package.json` 另外提供：

```bash
pnpm ai:prepare
pnpm ai:train
pnpm ai:eval
pnpm ai:grow
```

## 常用指令

| 指令                                         | 說明                                      |
| -------------------------------------------- | ----------------------------------------- |
| `pnpm lint`                                  | 跑 mobile / web / functions / shared lint |
| `pnpm typecheck`                             | 跑 mobile / web / shared typecheck        |
| `pnpm --filter mobile test`                  | Mobile Jest 測試                          |
| `pnpm --filter web test`                     | Web Vitest 測試                           |
| `pnpm --filter functions test`               | Functions Jest 測試                       |
| `pnpm test:rules`                            | Firestore / Storage security rules 測試   |
| `pnpm --filter web build`                    | Next.js Web build                         |
| `pnpm release:preview`                       | 送出 mobile preview build                 |
| `pnpm release:production`                    | 送出 mobile production build              |
| `pnpm submit:ios`                            | 提交最新 iOS build                        |
| `pnpm submit:android`                        | 提交最新 Android build                    |
| `pnpm version:patch` / `minor` / `major`     | 更新 mobile 版本號                        |
| `pnpm live-review:file --file <path> --once` | 針對單檔跑 live review 腳本               |

### 版本號腳本的真實行為

`scripts/bump-version.mjs` 目前一定會更新：

- `apps/mobile/app.json`
- `apps/mobile/package.json`

它只會在 root `package.json` 存在 `version` 欄位時才更新 root 版本；目前 root `package.json` 沒有 `version` 欄位，因此不要假設 root package 也會一起 bump。

### 建議的本機驗證順序

小改 README / docs 時：

```bash
pnpm format:check
```

改 Web 時：

```bash
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter web build
```

改 Mobile 時：

```bash
pnpm --filter mobile lint
pnpm --filter mobile test
pnpm --filter mobile typecheck
```

改 Functions 或 rules 時：

```bash
pnpm --filter functions lint
pnpm --filter functions test
pnpm test:rules
```

改 shared package 時：

```bash
pnpm --filter @campus/shared lint
pnpm --filter @campus/shared typecheck
```

跨 workspace 或 release 前：

```bash
pnpm lint
pnpm typecheck
pnpm --filter mobile test
pnpm --filter web test
pnpm --filter functions test
pnpm --filter web build
```

## GitHub / CI / Release 現況

目前 `.github/workflows/` 內共有 5 個 workflow。

| Workflow             | 觸發方式                                     | 目前實際作用                                                                                                        |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`             | `push` / `pull_request` 到 `main`、`develop` | audit、gitleaks、lint、typecheck、mobile/web/functions tests、mobile/web build、main push 時可選擇 deploy functions |
| `release.yml`        | 手動 `workflow_dispatch`                     | preflight 後建置 iOS / Android、可選 submit、產生 draft GitHub Release                                              |
| `eas-build.yml`      | 手動 `workflow_dispatch`                     | 針對指定 platform / profile 發送 EAS Build                                                                          |
| `preview-deploy.yml` | PR 打上 `preview` label                      | 發送 EAS Update 到 `pr-<number>` branch 並留言到 PR                                                                 |
| `maestro-e2e.yml`    | 手動、排程、PR（mobile 相關變更）            | 在 macOS runner 上跑 iOS 模擬器的 Maestro E2E                                                                       |

### CI workflow 的重點

`ci.yml` 現在會做這些事：

- `pnpm install --frozen-lockfile`
- `pnpm audit --prod`
- `gitleaks` secret scan
- `pnpm lint`
- `pnpm typecheck`
- `pnpm --filter mobile test --coverage --ci`
- `pnpm --filter web test --coverage --ci`
- `pnpm --filter functions test --runInBand`
- `pnpm --filter web build`
- `expo-doctor`
- `eas-cli config`
- preview Android / iOS build submission 驗證

另外，在 `main` 分支 push 且有 `FIREBASE_TOKEN` 時，`ci.yml` 還會執行：

```bash
pnpm -w firebase deploy --only functions
```

### 目前沒有自動化的檢查

以下項目在 repo 內存在，但目前不是 GitHub CI 預設 gate：

- `pnpm test:rules`
- Android Maestro matrix
- 全 repo 的 link / markdown 檢查

### Workflow 維護注意事項

- `security-gates` 會輸出 `audit-report.json` artifact；`pnpm audit --prod --json` 若找到問題，可能導致 job 失敗或需要人工判讀。
- `test-mobile` 會跑 coverage 並上傳 mobile coverage artifact；目前 mobile 測試用 Jest / `jest-expo`。
- `test-web` 走 Vitest；Web build 會使用 GitHub secrets，沒有 secrets 時用 mock Firebase 值補上。
- `build-mobile` 不是本機編譯 APK/IPA，而是透過 Expo / EAS CLI 檢查設定並送出 preview Android / iOS build submission（`--no-wait`）。
- `deploy-functions` 只在 `main` push 且通過 production environment 時執行 Firebase Functions deploy。
- `preview-deploy.yml` 只有 PR 有 `preview` label 時才會發 EAS Update。
- `maestro-e2e.yml` 會在 macOS runner 上跑 iOS simulator；它比一般 unit test 慢，適合 smoke/full flow 驗證。

### Release / Build 所需 secrets

依 workflow 內容，常見會用到的 secrets 包括：

- `EXPO_TOKEN`
- `FIREBASE_TOKEN`
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `APPLE_ID`
- `ASC_APP_ID`
- `APPLE_TEAM_ID`
- Android submit 所需 service account key

Secrets 應放在 GitHub repository / environment secrets，不要寫入 README、程式碼或 `.env.example` 真值。

## 測試與品質面

### 目前可見的測試分布

- Mobile：16 個測試檔
  - hooks
  - services
  - data
  - runtime config
  - architecture boundary
  - components / utility
- Web：5 個測試檔
  - `firestorePath`
  - `navigation`
  - `pageContext`
  - `sso`
  - `useSchoolSsoConfig`
- Backend：4 個測試檔
  - Functions：`authz.test.js`、`cafeterias.test.js`、`notificationService.test.js`
  - Rules：`backend/tests/security-rules.test.js`

### Maestro E2E flow

`apps/mobile/.maestro/flows/` 目前包含 10 條流程：

1. onboarding
2. authentication
3. announcements
4. events
5. map
6. cafeteria
7. me features
8. settings
9. messages
10. full user journey

## 文件導覽與可信度

### 可當主要入口的文件

- `README.md`（本檔）
- `docs/architecture/firebase-data-boundaries.md`
- `apps/web/README.md`
- 各子專案 `package.json`
- `.github/workflows/*.yml`
- 各 `.env.example`

### 可當補充參考，但要回頭對照程式碼的文件

- `docs/API.md`
  - 可幫助理解 Functions 介面，但實際匯出仍應以 `backend/functions/index.js` 為準
- `docs/RELEASE.md`
  - 可幫助理解 release 思路，但實際指令、submit 與 build gate 應以 workflow 與 `eas.json` 為準
- `docs/SECURITY.md`
  - 可視為較廣義的安全與政策說明，但其中有些 auth / 平台面描述比目前產品入口更寬，閱讀時要記得現在主流程已經收斂為 PU-only

### 明顯帶有歷史狀態的文件

- `apps/mobile/DEMO.md`
  - 仍描述 email/password、多校切換、展示腳本
- 舊的多校登入敘述
  - 若與目前登入畫面衝突，請先以程式碼與本 README 為準

## 接手風險與待清理項

這些不是立即 bug，但會影響後續維護判斷：

| 項目                         | 現況                                                                       | 建議處理方式                                                                          |
| ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| PU-only vs 多校願景          | UI 與登入主流程已收斂到 PU；shared / SSO / school directory 仍保留多校能力 | 未來若恢復多校，先定義 release flag、資料契約與每校支援等級                           |
| `backend/functions/index.js` | Functions 匯出集中，檔案承擔多領域責任                                     | 大改前先補測試；中長期可依 auth、campus、commerce、notifications、integrations 分模組 |
| `apps/mobile/App.tsx`        | root navigation、providers、sync、toast、deep linking 全集中               | 新增 cross-cutting 功能前先評估是否應拆到 app bootstrap / navigation helper           |
| Security rules               | 有 `pnpm test:rules`，但 CI 尚未預設執行                                   | 影響 rules / Firestore schema 時務必本機跑，之後可加進 CI gate                        |
| 文件一致性                   | `docs/API.md`、`docs/RELEASE.md`、`apps/mobile/DEMO.md` 部分內容較舊       | 修改 API / release / demo flow 時同步更新，或在文件頂部加上可信度與最後盤點日期       |
| Web Firebase fallback        | Web 在 Firebase 未設定時會使用 mock fallback                               | 發布前要確認 production env 真正指向正確 Firebase project，而不是只看本機頁面能否打開 |
| Release env                  | Preview / production 需要比 dev 更多 env                                   | 發版前用 EAS config / workflow preflight 檢查，不要只依賴 Expo dev server             |
| Root `.env.example`          | 比目前產品入口更廣，包含願景型多校 / 多支付 / 多服務設定                   | 快速上手看子專案 `.env.example`；平台化規格再回頭整理 root env                        |

## 第一次接手時最值得先看的檔案

建議閱讀順序：

1. `README.md`
2. `apps/mobile/App.tsx`
3. `apps/mobile/src/config/runtime.ts`
4. `apps/mobile/src/services/studentIdAuth.ts`
5. `apps/web/src/app/login/page.tsx`
6. `apps/web/src/app/layout.tsx`
7. `backend/functions/index.js`
8. `packages/shared/src/index.ts`
9. `packages/shared/src/schools.ts`
10. `docs/architecture/firebase-data-boundaries.md`

## 如果只記一件事

> **這是一個已經有 mobile、web、backend、CI/CD、release 與 optional AI server 的校園平台 monorepo；目前產品入口已收斂成 PU-only，但底層仍保留多校與 SSO 擴充能力。**

若你在其他文件看到以下說法，請先視為歷史描述，而不是目前產品定義：

- 「主要登入方式是 email/password」
- 「訪客登入仍是正式流程」
- 「目前是多校入口優先」
- 「Web 只是 Next.js 預設模板」
- 「CI 會自動驗證所有 security rules」

## License

MIT
