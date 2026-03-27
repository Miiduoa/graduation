# 畢業專題 - Campus One

<p align="center">
  <img src="https://img.shields.io/badge/Expo-54-000?logo=expo" alt="Expo 54" />
  <img src="https://img.shields.io/badge/React_Native-0.81-blue?logo=react" alt="React Native 0.81" />
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-149eca?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Firebase-12-orange?logo=firebase" alt="Firebase 12" />
</p>

> 目前版本的產品入口已鎖定為靜宜大學（PU）學號登入，底層仍保留多校抽象、混合資料來源與學校代碼正規化能力，供後續擴充使用。

## 現況摘要

- Mobile 與 Web 的主要登入流程都已切換為靜宜學號登入，不再以多校入口作為目前版本的對外流程。
- Mobile 端會在登入後同步靜宜 e 校園核心資料、TronClass 課程資料與 Firebase session。
- Web 端提供公告、地圖、餐廳、課表、成績、群組、圖書館、設定與登入等頁面。
- Backend 使用 Firebase Cloud Functions，除通知、管理與 SSO 外，也包含 PU 學號登入、校園資料代理與 TronClass 代理流程。
- `apps/mobile/ios/` 原生 iOS 專案已納入版控；`Pods`、`build`、`xcuserdata` 和本機環境檔仍保持忽略。

## Monorepo 結構

```text
畢業專題/
├── apps/
│   ├── mobile/              # Expo / React Native App（含 iOS 原生專案）
│   └── web/                 # Next.js App Router Web
├── backend/
│   ├── firestore/           # Firestore rules
│   ├── functions/           # Firebase Cloud Functions
│   ├── storage/             # Storage 規則與素材
│   └── tests/               # Firestore / backend 測試
├── packages/
│   └── shared/              # 共用型別、學校資料、PU auth 契約
├── docs/                    # 架構與法務文件
└── scripts/                 # 版本、seed、review 等腳本
```

## 主要技術

| 區塊 | 技術 |
|------|------|
| Mobile | Expo 54, React Native 0.81, React Navigation 7, Firebase 12 |
| Web | Next.js 16 App Router, React 19, Vitest |
| Backend | Firebase Functions v2, Firebase Admin, Firestore |
| Shared | TypeScript workspace package (`@campus/shared`) |
| Tooling | pnpm 10, ESLint 9, Prettier, Jest, Vitest |

## 目前可驗證的產品能力

### Mobile

- 靜宜學號登入與 Firebase session 建立
- 課表、成績、公告、活動、地圖、餐廳、群組、收件匣、學分試算、AI 助理
- TronClass 資料同步與課程待辦整合
- 快取 / Hybrid data source / school context 正規化
- iOS Widget、Android widget、Maestro E2E flow

### Web

- 首頁、公告、地圖、餐廳、社團、群組、圖書館、成績、課表、搜尋、設定、個人資料
- PU 學號登入頁與 SSO callback 頁
- School-aware navigation 與 page context helper

### Backend

- 公告、活動、群組、作業、訊息、失物招領等通知流程
- `signInPuStudentId`、`puFetchCampusData`、`puFetchTronClassData`
- `verifySSOCallback`、`startSSOAuth`、`createCustomToken`
- 個人資料、管理後台、館藏、公車、支付、健康、列印、成就等 callable / HTTP functions

## 開發環境

### 需求

- Node.js `>=20 <21`
- pnpm `10.28.2`
- Firebase CLI（repo 已透過 devDependencies 提供）

### 安裝

```bash
pnpm install
```

### 環境變數

此 repo 已提供多份範本檔：

- `/.env.example`
- `apps/mobile/.env.example`
- `apps/web/.env.example`
- `backend/functions/.env.example`

常見做法：

```bash
cp apps/mobile/.env.example apps/mobile/.env
cp apps/web/.env.example apps/web/.env.local
```

Functions 可依你的 emulator / Firebase project 配置建立對應本機 env 檔；不要把實際密鑰提交到版本控制。

### 啟動開發

```bash
pnpm dev:mobile
pnpm dev:web
pnpm dev:functions
```

若要直接啟動原生 App：

```bash
pnpm --filter mobile ios
pnpm --filter mobile android
```

## 常用指令

| 指令 | 說明 |
|------|------|
| `pnpm lint` | 執行 mobile / web / functions / shared lint |
| `pnpm typecheck` | 執行 mobile / web / shared typecheck |
| `pnpm --filter mobile test` | 執行 mobile Jest 測試 |
| `pnpm --filter web test` | 執行 web Vitest 測試 |
| `pnpm test:rules` | 執行 Firestore rules 測試 |
| `pnpm release:preview` | 觸發 mobile preview build |
| `pnpm release:production` | 觸發 mobile production build |
| `pnpm submit:ios` | 提交最新 iOS build |
| `pnpm submit:android` | 提交最新 Android build |

## 架構備忘

### Mobile 資料層

目前行動端仍採用抽象資料來源設計：

```text
DataSource
  ├─ mockSource
  ├─ firebaseSource
  ├─ cachedSource
  └─ hybridSource
       └─ school adapters / PU-specific flows
```

- `hybridSource` 會在資料來源、school context 與 fallback 策略之間協調
- `cachedSource` 負責快取與學校切換時的清理
- `packages/shared/src/puAuth.ts` 提供靜宜登入與同步流程共用契約
- `apps/mobile/src/data/schoolIds.ts` 負責 `pu` / `tw-pu` 對應

### 登入與同步

目前版本的使用者流程是：

1. 使用者在 Mobile 或 Web 輸入 PU 學號與密碼
2. Backend 驗證靜宜登入並建立 Firebase custom token / session
3. Backend 同步 e 校園核心資料與 TronClass 工作階段
4. Client 端載入課表、成績、待辦與校園資料

### Firebase 與規則

- Firestore rules：`backend/firestore/firestore.rules`
- Functions 入口：`backend/functions/index.js`
- 架構文件：`docs/architecture/firebase-data-boundaries.md`

部署範例：

```bash
pnpm -w firebase deploy --only functions
pnpm -w firebase deploy --only firestore:rules
```

## 文件與備註

- `apps/mobile/DEMO.md`：Mobile Demo 操作腳本
- `apps/mobile/.maestro/flows/`：Maestro E2E flows
- `docs/legal/`：法務頁內容

如果你看到舊文件提到多校登入入口、訪客登入或通用測試帳號，請以目前的程式碼流程為準：這個版本的主要產品路徑是 PU-only 學號登入。

## License

MIT
