# Campus One

[![CI](https://github.com/Miiduoa/graduation/actions/workflows/ci.yml/badge.svg)](https://github.com/Miiduoa/graduation/actions/workflows/ci.yml)

課程、作業與校園生活。學生從待辦回到課程，老師查看繳交並留下回饋；平台管理員處理學校接入與公開交流。

[開啟網站](https://nuni.tw) · [角色與使用流程](docs/ROLE_WORKFLOWS.md) · [部署版本紀錄](docs/PLATFORM_RELEASE.md) · [原生版本發布條件](docs/STORE_RELEASE.md)

## 使用流程

| 使用者                   | 從哪裡開始             | 完成什麼                                           |
| ------------------------ | ---------------------- | -------------------------------------------------- |
| 修課學生                 | 今日 → 待繳作業 → 課程 | 查看教材、繳交內容、確認收件與老師回饋             |
| 課程負責老師／共同授課者 | 我的課程 → 授課課程    | 發布教材與作業、查看繳交、回覆學生                 |
| 校園使用者               | 校園服務、課表與成績   | 查詢可用的校園資訊；私人校務資料另需學校帳號       |
| 平台管理員               | 平台管理 → 權責與待辦  | 審核學校接入、檢查服務狀態、處理檢舉與追查操作紀錄 |

一個帳號可以在不同課程扮演不同角色。選擇瀏覽校園、加入課程或建立課程，都不會授予校籍或校方管理權限。

## 帳號與資料來源

- **Nuni 帳號**：課程空間、公開跨校交流、平台管理。課程權限依各課成員資格判定；平台管理員也不會自動加入私人課程。
- **學校帳號**：學校提供的課表、成績及校務紀錄。與課程空間的資料分開；尚未接通的服務會明確提示。
- **訪客**：可瀏覽公開服務並調整本機外觀。登入後返回原本要處理的工作。

作業收件以伺服器回覆為準；送出失敗不會顯示完成。切換帳號、登出與權限重新確認時，私人資料會暫時隱藏。校園助理是選用功能，核心課務不需要先對話才能操作。

## 實作與發布狀態

Web 已有正式站；每次部署的來源版本與驗收範圍記錄在 [PLATFORM_RELEASE](docs/PLATFORM_RELEASE.md)。分支內的新功能需要另外驗收與部署，不能從網站可開啟或本機測試通過推定已上線。

原生 App、學校資料整合與課程空間並非全部使用同一套帳號後端。原生 Nuni session、正式學校權限接軌、實機驗證與商店簽署仍須依 [STORE_RELEASE](docs/STORE_RELEASE.md) 完成。課程交接、共同授課指派等治理工作另見 [角色流程與缺口](docs/ROLE_WORKFLOWS.md)。

## 專案結構

```text
apps/web/          Next.js Web 與同源 API 入口
apps/mobile/       Expo / React Native App
packages/shared/   共用型別、課程契約與驗證
backend/           Firebase Functions、Firestore／Storage 規則及後端工具
deploy/web/        Web 容器與部署設定
deploy/nuni-api/   可重建的 Nuni API 來源與 patches
docs/              架構、發布與驗收紀錄
```

Web 使用 Next.js 16、React 19；App 使用 Expo 54、React Native 0.81。Nuni API 與既有校務整合各自保留授權邊界。更多技術資料：[架構總覽](docs/ARCHITECTURE_OVERVIEW.md)、[決策紀錄](docs/adr/README.md)、[API](docs/API.md)。

## 本機開發

需要 Node.js 22 與 pnpm 10.28.2。

```bash
git clone https://github.com/Miiduoa/graduation.git
cd graduation
pnpm install --frozen-lockfile
pnpm dev:web
```

App 使用 `pnpm dev:mobile`；iOS 模擬器使用 `pnpm ios:sim`。環境設定請參考各 app 的 `.env.example`。未設定後端時只能查看公開頁面與未連線狀態，不會自動載入私人資料或建立示範帳號。

## 驗證

```bash
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter web build
pnpm --filter mobile test
pnpm --filter mobile typecheck
pnpm lint
pnpm test:rules
```

Web 使用 Vitest；App 使用 Jest 與 Maestro；資料存取規則另由 Firebase emulator 驗證。CI 結果、正式部署、實機驗證與商店發布是不同的交付狀態。

[測試證據](docs/TESTING_EVIDENCE.md) · [依賴風險紀錄](docs/DEPENDENCY_RISK_REGISTER.md) · [GitHub Actions](https://github.com/Miiduoa/graduation/actions)
