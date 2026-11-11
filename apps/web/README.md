# nuni Web

nuni 的網頁端將課程待辦、個人課表、行事曆與校園服務接在同一個入口。AI 助理依目前帳號可讀取的資料整理待辦、提出安排，並在使用者確認後執行已開放的個人行程操作。

使用 Next.js 16 App Router、React 19 與 TypeScript，提供 PWA 基礎。套件版本以本目錄的 [package.json](package.json)、根目錄的 [版本覆寫](../../package.json) 與 [lockfile](../../pnpm-lock.yaml) 為準。

[專案首頁](../../README.md) · [兩分鐘導覽](../../docs/REVIEW_IN_2_MINUTES.md) · [架構說明](../../docs/ARCHITECTURE_OVERVIEW.md) · [新環境設定](../../docs/SETUP_NEW_MACHINE.md)

## 主要入口

| 路徑                                     | 用途                                       | 資料與操作條件                                 |
| ---------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| `/`、`/today`                            | 今日課程、待辦與常用服務                   | 依帳號、所選學校及已有資料呈現                 |
| `/ai-assistant`                          | 查詢課業、整理安排、執行個人行程、開啟服務 | 平台助理與雲端寫入各有開關；完成結果須讀回核對 |
| `/classroom`                             | 課程空間、教材、作業、測驗與老師回饋       | nuni 平台帳號與課班成員權限                    |
| `/import`、`/timetable`、`/calendar`     | 匯入、核對及整理自己的課表與行程           | 裝置資料與平台同步分開處理                     |
| `/community`、`/groups`、`/messages`     | 校園交流、群組與訊息                       | 依各服務的身分及可見範圍存取                   |
| `/map`、`/bus`、`/library`、`/cafeteria` | 校園地點、交通、館藏與餐廳入口             | 依學校提供公開來源；即時資料另需服務設定       |
| `/food`、`/merchant`、`/admin`           | 點餐、店家及管理工作區                     | 依服務開通與後端授權提供操作                   |

這份表描述原始碼中的入口。線上版本、服務開關與資料來源請對照 [發布紀錄](../../docs/PLATFORM_RELEASE.md)；選到一所學校不等於已取得該校校籍或私人資料權限。

## 帳號怎麼分

公開資訊可先瀏覽。需要平台課班、交流或店家服務時，由登入頁提供當前可使用的 Google 平台登入；顯示的方式同時受 Web 設定與 API 能力影響。

個人校務、學校成績與校方 LMS 另走學校連線。平台帳號、課班教師、學校教師及管理員權限各自驗證，Google 登入不能代替學校授權。學號登入只在服務已開通的學校提供。

程式入口：[登入頁](src/app/login/page.tsx) · [平台 session 與 BFF](src/lib/nuni/server.ts) · [帳號與校園存取說明](../../docs/ACCOUNT_AND_SCHOOL_ACCESS.md)

## 本機開發

以下指令都在 repository 根目錄執行。先依 [.nvmrc](../../.nvmrc) 使用 Node.js 22，並啟用 [packageManager](../../package.json) 指定的 pnpm 10.28.2。

```bash
pnpm install --frozen-lockfile
pnpm dev:web
```

預設開啟 `http://localhost:3000`。若要連接自己的開發服務，再從 [.env.example](.env.example) 建立 `apps/web/.env.local`，填入相應設定。已有檔案時保留原內容；範例中的占位值不能作為有效憑證。

nuni 課程與 Google 登入的伺服器設定另見 [nuni.env.example](nuni.env.example)。其中的正式網址只是設定範例，本機開發應使用經授權的開發服務、自己的 callback origin 與開發用憑證。

| 設定                                                             | 作用                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| `NUNI_CLASSROOM_ENABLED`                                         | 啟用 nuni 平台 API；保留既有校園頁面                              |
| `NUNI_API_BASE_URL`                                              | nuni API 的來源網址                                               |
| `WEB_PUBLIC_ORIGIN`                                              | BFF 的同源檢查與 OAuth 公開來源；本機例如 `http://localhost:3000` |
| `BFF_SESSION_SECRET`                                             | 伺服器端 session 加密金鑰，至少 32 字元                           |
| `PLATFORM_GOOGLE_LOGIN_ENABLED`、`PLATFORM_GOOGLE_CLIENT_SECRET` | 平台 Google 登入開關及伺服器憑證                                  |
| `NEXT_PUBLIC_FIREBASE_*`                                         | Firebase 用戶端設定；與平台 session 分開                          |
| `NEXT_PUBLIC_FUNCTIONS_BASE_URL`                                 | 已設定的校園服務 HTTP 端點                                        |

模型金鑰、Google client secret、服務帳戶與 session secret 都留在伺服器設定；不要放進 `NEXT_PUBLIC_*`、截圖或 repository。

完整設定、原生 App 與選用後端的啟動方式見 [新環境設定](../../docs/SETUP_NEW_MACHINE.md)。

## AI 助理的執行範圍

目前 Web 內有本機查詢／服務導覽與平台雲端助理兩條路徑。雲端 v2 透過 BFF 讀取已授權來源，再產生回答或確認卡；開放個人行程寫入後，使用者確認，系統才執行並讀回相同事件。回應遺失時保留原操作，提供重新核對，避免建立重複行程。

| 伺服器開關                                | 作用                                 |
| ----------------------------------------- | ------------------------------------ |
| `CAMPUS_ASSISTANT_ENABLED=true`           | 在 nuni 平台入口啟用助理             |
| `CAMPUS_ASSISTANT_V2_ENABLED=true`        | 選用 v2 工具呼叫與確認卡流程         |
| `CAMPUS_ASSISTANT_V2_WRITES_ENABLED=true` | 在其他前置條件成立時允許個人行程寫入 |

缺少開關、模型或資料時，畫面依實際能力提供本機查詢或服務入口。點餐備單與導頁不能視為已送出訂單，個人行程保存也不代表作業已繳交或通知已排程。詳細工具、額度、確認及核對契約見 [助理 v2](src/lib/nuni/assistantV2.README.md) 與 [行程執行說明](../../docs/assistant/2026-11-07-verified-execution.md)。

## 常用指令

| 指令                          | 用途               |
| ----------------------------- | ------------------ |
| `pnpm dev:web`                | 啟動開發伺服器     |
| `pnpm --filter web build`     | 建立正式模式產物   |
| `pnpm --filter web start`     | 執行已完成的 build |
| `pnpm --filter web lint`      | ESLint             |
| `pnpm --filter web typecheck` | TypeScript         |
| `pnpm --filter web test`      | Vitest 測試        |

`dev`、`build` 與相關檢查會先準備必要的共用模組；`dev`／`build` 也會準備匯入所需資產。請使用 package scripts，保留這些前置步驟。

## 維護時從哪裡找

| 位置                                                                           | 負責內容                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| [`src/app/`](src/app/)                                                         | 頁面與 API route handlers                 |
| [`src/features/nuni/`](src/features/nuni/)                                     | 平台課程、帳號與助理介面                  |
| [`src/lib/nuni/`](src/lib/nuni/)                                               | BFF session、平台 API、助理工具及執行邊界 |
| [`src/components/`](src/components/)                                           | 共用介面、校園選擇、服務導覽              |
| [`src/lib/firebase.ts`](src/lib/firebase.ts)                                   | 校園 Firebase 資料與驗證                  |
| [`src/lib/personalImports.ts`](src/lib/personalImports.ts)                     | 裝置端個人匯入資料                        |
| [`src/lib/assistantExecutionJournal.ts`](src/lib/assistantExecutionJournal.ts) | 同分頁待核對行程紀錄                      |
| [`public/manifest.json`](public/manifest.json)、[`public/sw.js`](public/sw.js) | PWA manifest 與 service worker            |

發布前依精確 commit 核對 CI、相關瀏覽器流程及必要審查；部署流程見 [Web 發布說明](../../docs/WEB_RELEASE.md)。
