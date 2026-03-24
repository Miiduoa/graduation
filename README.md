# 畢業專題 - 多校園平台應用程式

<p align="center">
  <img src="https://img.shields.io/badge/React_Native-0.74-blue?logo=react" alt="React Native" />
  <img src="https://img.shields.io/badge/Expo-51-000?logo=expo" alt="Expo" />
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Next.js-14-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Firebase-10-orange?logo=firebase" alt="Firebase" />
</p>

> 一個功能完整的多校園平台型應用程式，支援 iOS、Android 和 Web 平台。

## 快速開始

### Demo 腳本
- Mobile Demo：`apps/mobile/DEMO.md`（完整操作流程）

### 安裝與執行

```bash
# 安裝依賴
pnpm install

# 檢查程式碼品質
pnpm lint
pnpm typecheck

# 格式化
pnpm format

# 建立 Mobile 環境變數
cp apps/mobile/.env.example apps/mobile/.env

# 啟動 Mobile App（Expo）
pnpm dev:mobile

# 啟動 Web App（Next.js）
pnpm dev:web

# 啟動 Firebase Functions Emulator
pnpm dev:functions
```

### 通用測試帳號

以下兩組帳號僅供 `development / preview / shared demo` 使用，`production` 應關閉：

| 角色 | 帳號 | 密碼 |
|------|------|------|
| 學生 | `demohan513@gmail.com` | `nickkookoo` |
| 教師 | `miiduoa@icloud.com` | `nickkookoo` |

補充：

- Mobile 以 `EXPO_PUBLIC_ENABLE_UNIVERSAL_DEV_ACCOUNTS` 控制是否顯示
- Web 以 `NEXT_PUBLIC_APP_ENV` / `NEXT_PUBLIC_ENABLE_UNIVERSAL_DEV_ACCOUNTS` 控制
- Shared demo Firebase Functions 以 `backend/functions/.env.campus-demo-3a869` 控制 preview runtime
- 舊的 `TEST_SCHOOL_*` 設定已棄用，不再參與登入流程

### Workspace Scripts

| 指令 | 說明 |
|------|------|
| `pnpm dev:web` | 啟動 Next.js Web App |
| `pnpm dev:mobile` | 啟動 Expo Mobile App |
| `pnpm dev:functions` | 啟動 Firebase Functions emulator |
| `pnpm lint` | 依序檢查 `mobile/web/functions/shared` |
| `pnpm typecheck` | 依序檢查 `mobile/web/shared` TypeScript 型別 |
| `pnpm format` | 用 Prettier 格式化整個 monorepo |
| `pnpm format:check` | 檢查格式是否符合 Prettier |

### Web Demo Firebase 設定

若要在本地 Web 使用一般登入或通用測試帳號，至少需要設定：

- `NEXT_PUBLIC_APP_ENV=development`
- `NEXT_PUBLIC_ENABLE_UNIVERSAL_DEV_ACCOUNTS=true`
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_CLOUD_FUNCTION_REGION=asia-east1`

### Mobile 資料來源切換（mock / firebase / hybrid）

`apps/mobile/App.tsx` 已支援以環境變數切換資料來源，不需要再改程式碼常數。

架構邊界請見 `docs/architecture/firebase-data-boundaries.md`。

| 變數 | 可選值 | 預設 | 說明 |
|------|--------|------|------|
| `EXPO_PUBLIC_DATA_SOURCE_MODE` | `mock` / `firebase` / `hybrid` | 開發時 `mock`、正式時 `firebase` | 主資料來源模式 |
| `EXPO_PUBLIC_API_ENV` | `development` / `staging` / `production` | 開發時 `development`、正式時 `production` | Hybrid adapter API 環境 |
| `EXPO_PUBLIC_HYBRID_TIMEOUT_MS` | 整數（毫秒） | `10000` | Hybrid 呼叫真實 API timeout |
| `EXPO_PUBLIC_HYBRID_FALLBACK_TO_MOCK` | `true` / `false` | `true` | Hybrid 失敗時是否退回 mock |
| `EXPO_PUBLIC_PREFER_REAL_API` | `true` / `false` | `true` | Hybrid 是否優先走真實 API |

常見情境：

- 本機純前端開發：`EXPO_PUBLIC_DATA_SOURCE_MODE=mock`
- Firebase 串接驗收：`EXPO_PUBLIC_DATA_SOURCE_MODE=firebase`
- 逐步導入學校 API：`EXPO_PUBLIC_DATA_SOURCE_MODE=hybrid`

補充：

- `hybrid` 是最終整合目標模式
- `firebase` 保留給 emulator、demo 與 Firebase 驗證
- app-native / 即時資料仍以 Firebase 為主幹，校務正式資料逐步接 adapter 或 backend API

## 專案目標

| 平台 | 技術 | 說明 |
|------|------|------|
| **Mobile** | Expo + React Native | iOS/Android 跨平台原生應用 |
| **Web** | Next.js 14 | PWA/響應式網站 |
| **Backend** | Firebase | Firestore + Auth + Cloud Functions |
| **SSO** | OIDC/CAS/SAML | 學校單一登入整合架構 |

## Monorepo 結構

```
畢業專題/
├── apps/
│   ├── mobile/           # Expo React Native App（62+ 畫面）
│   │   ├── src/
│   │   │   ├── screens/  # 所有畫面元件
│   │   │   ├── data/     # DataSource 抽象層
│   │   │   ├── hooks/    # 12+ 自定義 Hooks
│   │   │   ├── services/ # 推播/離線/AI 等服務
│   │   │   ├── state/    # 狀態管理（Context）
│   │   │   ├── ui/       # 35+ UI 元件
│   │   │   ├── i18n/     # 多語言（5 種）
│   │   │   └── utils/    # 工具函數
│   │   └── App.tsx
│   │
│   └── web/              # Next.js 網站（12 頁面）
│       └── src/
│           ├── app/      # App Router 頁面
│           └── components/
│
├── packages/
│   └── shared/           # 共用型別/學校資料
│       └── src/
│           ├── schools.ts    # 學校列表與代碼處理
│           └── types.ts      # 共用型別定義
│
└── backend/
    ├── functions/        # Firebase Cloud Functions
    │   └── index.js      # 推播/提醒/通知邏輯
    └── firestore/
        └── firestore.rules  # 多租戶安全規則
```

## 產品路線

| 階段 | 策略 | 狀態 |
|------|------|------|
| **Phase 1** | 平台型、多校通用（無需深度整合即可使用） | ✅ 完成 |
| **Phase 2** | 深度整合（SSO + 校務/課表/成績/出缺席 API） | 🚧 架構就緒 |

## 功能總覽

### 核心功能

| 功能模組 | 說明 | 狀態 |
|----------|------|------|
| **多校架構** | School Code 切換，支援代碼撞碼處理 | ✅ |
| **認證系統** | Email/Password + SSO（OIDC/CAS/SAML） | ✅ |
| **公告系統** | AI 摘要、搜尋、收藏、分類 | ✅ |
| **活動系統** | 報名、名額控管、倒數計時、提醒 | ✅ |
| **地圖導覽** | 分類篩選、即時人潮、AR 導航、無障礙路線 | ✅ |
| **餐廳菜單** | 營業狀態、營養資訊、評價、線上點餐 | ✅ |
| **群組/課程** | 發文、Q&A、作業管理、成績發布 | ✅ |
| **即時訊息** | 私訊對話、群組聊天 | ✅ |
| **推播通知** | FCM 整合、免打擾時段、分類管理 | ✅ |
| **iCal 同步** | 匯入/匯出/訂閱行事曆 | ✅ |
| **AI 助理** | 自然語言對話、選課推薦 | ✅ |
| **成就系統** | 20+ 獎章、等級、排行榜 | ✅ |
| **校園支付** | 餘額查詢、交易紀錄、儲值 | ✅ |
| **校園公車** | 即時動態、到站提醒、時刻表 | ✅ |
| **圖書館** | 借閱管理、館藏搜尋、座位預約 | ✅ |
| **失物招領** | 發布/搜尋/認領/歸還追蹤 | ✅ |
| **成績查詢** | 本學期/歷史/GPA 統計分析 | ✅ |
| **學分試算** | 畢業條件追蹤、AI 選課建議 | ✅ |
| **列印服務** | 印表機狀態、雲端列印、列印紀錄 | ✅ |
| **宿舍服務** | 報修、包裹通知、洗衣機預約 | ✅ |
| **校園健康** | 門診預約、健康紀錄、緊急聯絡 | ✅ |
| **小工具預覽** | iOS/Android Widget 預覽與設定說明 | ✅ |

### 使用者體驗

| 功能 | 說明 | 狀態 |
|------|------|------|
| 亮暗模式 | 自動/手動切換 | ✅ |
| 多語言 | 繁中/簡中/英/日/韓 | ✅ |
| 無障礙 | 文字大小、高對比度、色盲輔助 | ✅ |
| 離線模式 | 自動快取、離線佇列 | ✅ |
| Onboarding | 首次使用引導 | ✅ |
| Widget | 主畫面小工具預覽 | ✅ |

### 管理功能

| 功能 | 說明 | 狀態 |
|------|------|------|
| 管理控制台 | 公告/活動/成員管理 | ✅ |
| 權限系統 | Admin/Editor/Member | ✅ |
| 課程認證 | 教師課程驗證 | ✅ |
| GDPR 合規 | 資料匯出/帳號刪除 | ✅ |

### 🆕 最新功能（v2.5）
- **🔐 SSO 學校單一登入**
  - 支援 OIDC (OpenID Connect) 協議
  - 支援 CAS (Central Authentication Service)
  - 支援 SAML 2.0 企業級認證
  - 自動同步學校資訊（姓名/學號/系所）
  - 與 Firebase Auth 無縫整合
  - 多校 SSO 設定獨立管理
  - 安全的 Custom Token 機制
- **📦 資料可攜與隱私**
  - GDPR 合規資料匯出功能
  - 支援 JSON/純文字格式匯出
  - 選擇性匯出不同類別資料
  - 帳號永久刪除功能
  - 安全的身份驗證流程
- **♿ 無障礙功能**
  - 文字大小調整（小/標準/大/特大）
  - 高對比度模式
  - 減少動態效果
  - 色盲輔助模式
  - 螢幕閱讀器完整支援
  - 觸覺回饋設定
- **🌐 多語言支援**
  - 繁體中文 / 简体中文
  - English / 日本語 / 한국어
  - 自動偵測系統語言
  - 即時切換無需重啟
- **📴 離線模式**
  - 自動快取重要資料
  - 離線時顯示快取資料
  - 連線恢復自動同步
  - 離線操作佇列
- **🎯 使用者體驗**
  - 首次使用 Onboarding 引導
  - Bug 回報功能
  - 完整的設定選項
- **☁️ Firebase Cloud Functions 推播系統**
  - 公告發布自動推播通知
  - 活動提醒（開始前 1 小時/1 天）
  - 群組新貼文/作業通知
  - 私訊即時通知
  - 成績公布通知
  - 作業截止提醒（未繳交者）
  - 免打擾時段支援
  - 失物招領配對通知
- **📅 iCal 訂閱功能**
  - webcal:// 訂閱連結支援
  - 訂閱校園活動行事曆
  - 訂閱個人作業行事曆
  - 一鍵加入 iOS/Android/Google 日曆
  - 複製/分享訂閱連結
- **🔧 管理員控制台**
  - 管理員/編輯者權限系統
  - 公告管理（新增/編輯/刪除/置頂）
  - 活動管理（新增/編輯/刪除）
  - 成員管理（權限調整）
  - 統計總覽（公告/活動/成員數量）
  - 課程認證管理
  - SSO 設定管理

### v2.3 功能
- **🔍 失物招領系統**
  - 遺失物品發布（詳細描述、特徵標籤）
  - 拾獲物品登記（保護隱私設計）
  - 分類篩選（電子產品/證件/衣物/配件/書籍/鑰匙）
  - 狀態追蹤（尋找中/已認領/已歸還）
  - 物品詳情頁（聯絡發布者、認領功能）
  - 即時統計（遺失中/待認領/已歸還數量）
  - 搜尋功能（名稱/描述/地點）
  - 常用地點快選
  - 分享功能（社群分享協尋）

### v2.2 功能
- **📊 成績查詢系統**
  - 本學期課程成績（期中/期末）
  - 歷史成績查詢（依學期篩選）
  - 成績統計分析（GPA 趨勢、等第分布）
  - 累積 GPA 計算
  - 學分分類統計（必修/選修/通識/英文）
- **🎯 快捷功能擴充**
  - 新增 12 個快捷入口
  - 成就、行事曆、小工具入口
  - 成績查詢入口

### v2.1 功能
- **🚌 校園公車即時動態**
  - 多條路線支援（環線/接駁/宿舍專車）
  - 即時到站時間預估
  - 車輛擁擠程度顯示（人少/適中/擁擠/客滿）
  - 站點列表與收藏
  - 時刻表查詢
  - 到站提醒設定
- **📚 圖書館服務**
  - 借閱管理（續借/到期提醒）
  - 館藏搜尋（書名/作者/ISBN）
  - 預約圖書
  - 座位預約系統
  - 即時空位查詢
  - 各區域座位狀況
- **📱 QR 碼相機掃描增強**
  - 真實相機掃描支援（expo-camera）
  - 掃描框視覺指引
  - 閃光燈控制
  - 震動回饋
  - 優雅降級（無相機時模擬掃描）
- **🤖 AI 服務架構**
  - 支援 OpenAI (GPT-4o-mini)
  - 支援 Google Gemini
  - 本地模擬模式（開發用）
  - 上下文感知（公告/活動/餐廳/地點）
  - AI 摘要生成
  - 重要日期擷取

### v2.0 功能
- **公告 AI 智慧分析**
  - 自動生成摘要、關鍵資訊擷取
  - 重要日期辨識 + 一鍵加入行事曆
  - 公告情感/緊急程度標籤
  - 相關公告推薦
- **活動功能增強**
  - 即時倒數計時
  - 報名進度視覺化
  - 活動提醒設定（1小時/1天/1週前）
  - 相似活動推薦
- **地圖功能增強**
  - 即時人潮顯示（低/中/高/非常擁擠）
  - 人潮趨勢預測（上升/下降/穩定）
  - AR 導航入口（準備中）
  - 無障礙路線（準備中）
  - 附近設施推薦（500m 內）
  - 地點評分系統
- **餐廳功能增強**
  - 即時營業狀態
  - 等候時間估計
  - 排隊人數顯示
  - 營養資訊（卡路里、蛋白質等）
  - 用戶評價系統（評分 + 留言）
  - 售完回報功能
  - 同餐廳其他餐點推薦
- **🤖 AI 校園助理（Chatbot）**
  - 自然語言對話
  - 快捷指令（公告/活動/餐廳/地點）
  - 上下文理解
  - 一鍵跳轉相關頁面
  - 智慧建議回覆
- **🏆 成就與積分系統**
  - 20+ 種成就獎章
  - 5 大類別（探索/社交/學業/互動/特殊）
  - 4 種稀有度（普通/稀有/史詩/傳說）
  - 等級系統（經驗值累積）
  - 校園排行榜
  - 成就進度追蹤
- **UI/UX 大幅改進**
  - 動畫卡片效果
  - 倒數計時元件
  - 進度環圈視覺化
  - 狀態標籤（營業/人潮等）
  - 評分星星元件
  - 骨架屏載入動畫

## Firebase

### 安裝/指令
本 repo 已包含 Firebase CLI（devDependencies）。

```bash
# 查看版本
pnpm -w firebase --version

# 登入
pnpm -w firebase login
```

### 設定專案
編輯 `.firebaserc`：把 `YOUR_FIREBASE_PROJECT_ID` 換成你的 Firebase project id。

然後執行：

```bash
pnpm -w firebase use --add
```

### Firestore Schema（multi-tenant）
- `schools/{schoolId}`
- `schools/{schoolId}/members/{uid}`（role: admin|editor|member）
- `schools/{schoolId}/announcements/{id}`
- `schools/{schoolId}/pois/{id}`
- `schools/{schoolId}/clubEvents/{id}`
- `schools/{schoolId}/cafeteriaMenus/{id}`
- `schools/{schoolId}/registrations/{id}`
- `users/{uid}/pushTokens/{tokenId}`（推播 Token 管理）
- `users/{uid}/settings/notifications`（通知偏好設定）

### Rules
- 規則檔：`backend/firestore/firestore.rules`
- 目前策略：公共資料（公告/POI/活動/菜單）可讀；寫入需 admin/editor。

部署（之後要真的 Firebase project 才能用）：

```bash
pnpm -w firebase deploy --only firestore:rules
```

## 技術架構

### Mobile App (React Native + Expo)

#### 資料層架構
```
                 DataSource Interface
                         │
                ┌────────┴────────┐
                ▼                 ▼
        Firebase Source       Mock Source
                │                 │
                └──────┬──────────┘
                       ▼
                 Cached Source
                       │
                       ▼
                 Hybrid Source
                       │
                       ▼
              School API Adapters
          (Generic REST / NCHU / …)
```

- `DataSource Interface`：統一所有資料操作（公告/活動/課程/成績…）
- `Firebase Source`：以 Firestore 為主的預設實作
- `Mock Source`：離線開發/展示用假資料
- `Cached Source`：記憶體 + 永久化快取，支援離線模式與背景刷新
- `Hybrid Source`：可根據 `schoolId` 決定要走 Mock / Firebase / 各校 API，並提供自動降級到 Mock 的保護機制
- `School API Adapters`：以 Adapter Pattern 封裝各校 API（如中興大學 `NCHUAdapter`、通用 `GenericRestAdapter`），統一轉換為共用型別

#### 狀態管理
- `AuthProvider` - 認證狀態
- `SchoolProvider` - 學校選擇
- `ThemeProvider` - 主題切換
- `DemoProvider` - Demo 模式
- `FavoritesProvider` - 收藏功能
- `NotificationsProvider` - 通知狀態
- `PreferencesProvider` - 使用者偏好

#### 自定義 Hooks
| Hook | 功能 |
|------|------|
| `useAsyncList` | 非同步列表載入 |
| `useNetworkStatus` | 網路狀態監控 |
| `useDebounce` | 防抖處理 |
| `useThrottle` | 節流處理 |
| `usePagination` | 分頁載入 |
| `useForm` | 表單驗證 |
| `useGeolocation` | 地理位置 |
| `useStorage` | 持久化儲存 |
| `useKeyboard` | 鍵盤處理 |

### Web App (Next.js 14)

- App Router 架構
- Server Components
- 響應式設計
- 共用 SiteShell 元件
- 以 `pageContext` / `navigation` helper 共用學校上下文與導頁規則

### Backend (Firebase)

#### Cloud Functions
| Function | 觸發條件 | 功能 |
|----------|----------|------|
| `onAnnouncementCreated` | 新公告 | 推播通知 |
| `onEventCreated` | 新活動 | 推播通知 |
| `eventReminder` | 15min cron | 活動提醒（1h/1d 前） |
| `onGroupPostCreated` | 新貼文 | 群組通知 |
| `onAssignmentCreated` | 新作業 | 作業通知 |
| `onGradePublished` | 成績發布 | 成績通知 |
| `onMessageCreated` | 新訊息 | 私訊通知 |
| `onLostFoundMatch` | 配對成功 | 失物招領通知 |

### 認證與 SSO 邊界

```
Mobile/Web UI
    │
    ├─ 發起學校登入（OIDC / CAS / SAML）
    │
    ▼
School IdP Callback
    │
    ▼
Firebase Function: verifySSOCallback
    │
    ├─ 驗證學校票證 / assertion
    ├─ 同步 users / ssoLinks / school members
    └─ 簽發 Firebase custom token
    │
    ▼
Mobile/Web Firebase Auth Sign-In
```

- `mobile` 與 `web` 現在共用同一個 SSO 契約型別與欄位正規化邏輯。
- 學校 SSO 驗證與 Firebase token 簽發集中在 `backend/functions/index.js`，避免 client 直接建立 custom token。
- 通知偏好欄位統一為 `announcements/events/groups/assignments/grades/messages/quietHours`。

#### Firestore Schema（多租戶）
```
schools/{schoolId}/
├── announcements/{id}
├── clubEvents/{id}
├── pois/{id}
├── cafeteriaMenus/{id}
├── registrations/{id}
├── groups/{groupId}/
│   ├── posts/{postId}
│   ├── members/{uid}
│   └── assignments/{assignmentId}
├── courses/{courseId}
├── enrollments/{id}
├── grades/{gradeId}
├── busRoutes/{routeId}
├── libraryBooks/{bookId}
├── seatReservations/{id}
├── lostFoundItems/{id}
└── members/{uid}

users/{uid}/
├── profile
├── settings/notifications
├── favorites/{id}
├── pushTokens/{tokenId}
└── achievements/{id}
```

## 專案統計

| 項目 | 數量 |
|------|------|
| Mobile 畫面 | 62+ |
| Web 頁面 | 12 |
| 資料型別 | 50+ |
| DataSource 方法 | 45+ |
| Cloud Functions | 10+ |
| 自定義 Hooks | 12 |
| UI 元件 | 35+ |
| 支援語言 | 5 |
| 總程式碼行數 | ~50,000+ |

## 開發指南

### 新增畫面
1. 在 `apps/mobile/src/screens/` 建立新檔案
2. 使用 `Screen` 元件包裝
3. 在 `App.tsx` 中註冊導覽

### 新增資料類型
1. 在 `apps/mobile/src/data/types.ts` 定義型別
2. 在 `apps/mobile/src/data/source.ts` 新增介面方法
3. 在 `firebaseSource.ts` 和 `mockSource.ts` 實作

### 新增 Cloud Function
1. 在 `backend/functions/index.js` 新增函數
2. 更新 `firestore.rules` 如需要
3. 執行 `pnpm -w firebase deploy --only functions`

## 部署

### Firebase 設定

1. 建立 Firebase 專案
2. 編輯 `.firebaserc` 設定專案 ID
3. 啟用 Firestore、Authentication、Cloud Functions

```bash
# 部署所有服務
pnpm -w firebase deploy

# 只部署 Functions
pnpm -w firebase deploy --only functions

# 只部署 Rules
pnpm -w firebase deploy --only firestore:rules
```

### Mobile App

```bash
# 開發模式
cd apps/mobile && pnpm start

# 建置 iOS
eas build --platform ios

# 建置 Android
eas build --platform android
```

### Web App

```bash
# 開發模式
cd apps/web && pnpm dev

# 建置
pnpm build

# 部署到 Vercel
vercel deploy
```

## 最新開發進度（v2.7）

### ✅ 已完成功能

| 項目 | 說明 | 檔案位置 |
|------|------|----------|
| **iOS/Android Widget** | 今日課表、下一堂課、公車到站、公告等小工具 | `src/widgets/`, `ios-widget/`, `android-widget/` |
| **E2E 測試** | Maestro 端到端測試（10 個測試流程） | `.maestro/flows/` |
| **效能監控** | Performance Service、監控面板、HTTP 追蹤 | `src/services/performance.ts` |
| **AR 導航服務** | 方向計算、導航步驟、AR Overlay 生成、路徑尋找、語音導航 | `src/services/ar.ts` |
| **支付系統** | 校園卡、Apple/Google Pay、Line Pay、街口支付、Firebase 整合 | `src/services/payment.ts` |
| **Web PWA** | Service Worker、離線支援、推播、安裝提示 | `apps/web/public/sw.js` |
| **宿舍服務完整化** | 門禁申請、夜歸登記、訪客登記、報修、包裹、洗衣機預約 | `src/screens/DormitoryScreen.tsx` |
| **健康服務完整化** | 門診預約、預約更改、健康資訊、健康紀錄 | `src/screens/HealthScreen.tsx` |
| **AR 相機整合** | 真實相機畫面、羅盤整合、觸覺回饋、感測器資料 | `src/screens/ARNavigationScreen.tsx` |
| **環境變數範本** | Mobile/Web/Functions 環境變數配置範本 | `.env.example` files |
| **CI/CD 工作流程** | 完整的 GitHub Actions（Lint/Test/Build/Deploy） | `.github/workflows/` |

### Widget 功能

- **今日課表 Widget**：小/中/大尺寸，顯示每日課程
- **下一堂課 Widget**：即時倒數、地點提示
- **公車到站 Widget**：即時到站資訊、人潮顯示
- **公告 Widget**：最新公告、未讀數量
- **快捷功能 Widget**：常用功能入口

### E2E 測試涵蓋

| 測試檔案 | 測試範圍 |
|----------|----------|
| `01_onboarding.yaml` | 首次使用引導 |
| `02_authentication.yaml` | 登入/註冊流程 |
| `03_announcements.yaml` | 公告列表與詳情 |
| `04_events.yaml` | 活動報名 |
| `05_map.yaml` | 地圖與 POI |
| `06_cafeteria.yaml` | 餐廳菜單 |
| `07_me_features.yaml` | 我的頁面功能 |
| `08_settings.yaml` | 設定功能 |
| `09_messages.yaml` | 訊息與群組 |
| `10_full_user_journey.yaml` | 完整使用流程 |

### 支付系統支援

- 學生證（校園卡）
- Apple Pay / Google Pay
- Line Pay
- 街口支付
- 信用卡/金融卡（Stripe/TapPay）

### PWA 功能

- 離線支援（Cache-first / Network-first 策略）
- 安裝提示（iOS/Android）
- 推播通知
- 背景同步
- App Shortcuts

### v2.7 新功能

- **AR 導航進階功能**
  - Dijkstra 最短路徑演算法
  - 室內導航支援（多樓層）
  - 羅盤方向校正與平滑處理
  - 語音導航提示生成
  - 路線偏離偵測

- **宿舍服務完整功能**
  - 門禁延長申請
  - 臨時出入申請
  - 夜歸登記（自動時段判斷）
  - 訪客登記（含預計離開時間）

- **健康服務完整功能**
  - 預約時段更改
  - 健康資訊查詢（流感疫苗/健檢/心理健康/急救）
  - 多科別時段查詢

- **開發者體驗改善**
  - 完整 `.env.example` 配置範本
  - CI/CD 工作流程優化
  - DataSource 方法擴充

## 下一步開發計畫（v2.8 之後）

> v2.7～v2.8 已完成：真實校園資料串接、SSO 真實對接、多主題支援、效能優化與測試覆蓋率提升。以下為後續可延伸方向。

| 項目 | 建議優先級 | 說明 |
|------|------------|------|
| 真實校園資料串接（二期） | 高 | 擴充更多學校 API、完善課表/成績/出缺席等整合 |
| 校務系統 API（二期） | 高 | 深化 SSO 與校務系統整合（選課/請假/成績申覆） |
| 單元測試擴充 | 中 | 持續提升核心模組（DataSource / SSO / 主題系統）的測試覆蓋率 |
| 多主題支援（二期） | 中 | 更進階的品牌客製（Logo 套用、元件層級主題變體） |
| 效能優化（二期） | 中 | 針對大資料量與低階裝置進一步優化（列表虛擬化、預載策略） |

## 專案統計

| 項目 | 數量 |
|------|------|
| Mobile 畫面 | 66+ |
| Web 頁面 | 15 |
| 資料型別 | 55+ |
| DataSource 方法 | 50+ |
| Cloud Functions | 15+ |
| 自定義 Hooks | 12 |
| UI 元件 | 40+ |
| 支援語言 | 5 |
| E2E 測試流程 | 10 |
| Widget 類型 | 10 |
| 總程式碼行數 | ~60,000+ |

## License

MIT License - 歡迎自由使用於學術或商業用途。
