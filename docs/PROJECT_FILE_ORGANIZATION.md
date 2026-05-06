# 專案檔案整理索引

本文件整理目前專案內應該被版本控制的檔案分區。依賴、快取、build output、debug log、`.env`、`.DS_Store`、AI/IDE 本機狀態不列入正式專案檔案，請讓 `.gitignore` 排除。

截至 2026-05-05，本次整理後正式版本控制檔案目標為 509 個：

| 區塊        | 檔案數 | 責任                                                   |
| ----------- | -----: | ------------------------------------------------------ |
| `apps/`     |    404 | Mobile app、Web app、assets、native 專案與 E2E flow    |
| `backend/`  |     50 | Firebase Functions、Firestore/Storage rules、AI server |
| `docs/`     |     15 | 架構、API、安全、法務、release 與專案說明              |
| `packages/` |     14 | 跨 app / backend 共用的 TypeScript 契約與資料          |
| `.github/`  |      5 | CI、release、preview deploy、EAS、Maestro workflows    |
| `scripts/`  |      3 | root utility scripts                                   |
| root files  |     18 | workspace、tooling、env 範本、README、部署設定         |

## 目錄職責

| 路徑                          | 用途                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `apps/mobile/`                | Expo / React Native 行動端主程式。                                 |
| `apps/mobile/src/app/`        | App 層 hook，例如推播、背景同步、主動式 AI reporter。              |
| `apps/mobile/src/config/`     | runtime 設定與環境變數解析。                                       |
| `apps/mobile/src/data/`       | mock / firebase / hybrid data source、校園靜態資料、API adapters。 |
| `apps/mobile/src/features/`   | domain repository，讓 screen 不直接碰資料來源細節。                |
| `apps/mobile/src/screens/`    | React Navigation screen 與 stack。                                 |
| `apps/mobile/src/services/`   | 外部整合、AI、通知、SSO、校園服務、engine 類商業邏輯。             |
| `apps/mobile/src/state/`      | React context / provider / app-wide state。                        |
| `apps/mobile/src/ui/`         | theme、通用元件、視覺系統、互動 primitives。                       |
| `apps/mobile/src/utils/`      | 無狀態 helper。                                                    |
| `apps/mobile/src/widgets/`    | native widget bridge 與資料提供。                                  |
| `apps/mobile/assets/`         | App icon、splash、sound 等靜態資產。                               |
| `apps/mobile/ios/`            | iOS native project；`Pods/` 與 `build/` 不進 Git。                 |
| `apps/mobile/ios-widget/`     | iOS Widget 原生程式。                                              |
| `apps/mobile/android-widget/` | Android Widget 原生程式。                                          |
| `apps/mobile/.maestro/`       | Maestro E2E 測試設定與流程。                                       |
| `apps/web/`                   | Next.js App Router / PWA。                                         |
| `apps/web/src/app/`           | Web route、page、route handler。                                   |
| `apps/web/src/components/`    | Web UI component 與 shell。                                        |
| `apps/web/src/features/`      | Web feature client，例如 auth。                                    |
| `apps/web/src/lib/`           | Web runtime、Firebase、navigation、PWA 與共用 hooks。              |
| `backend/functions/`          | Firebase Cloud Functions v2 與 Functions 測試。                    |
| `backend/firestore/`          | Firestore rules / indexes。                                        |
| `backend/storage/`            | Storage rules。                                                    |
| `backend/tests/`              | Emulator-based security rules tests。                              |
| `backend/ai-server/`          | Python AI service、RAG、training、self-training pipeline。         |
| `packages/shared/`            | 共用型別、school config、release、PU auth、通知與 mock data。      |
| `docs/`                       | 專案文件；架構細節放 `docs/architecture/`，法務放 `docs/legal/`。  |
| `scripts/`                    | repo-level utility script。                                        |
| `.github/workflows/`          | GitHub Actions workflow。                                          |

## 新檔案放置規則

| 要新增的內容                                  | 放置位置                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Mobile 畫面                                   | `apps/mobile/src/screens/<Feature>Screen.tsx`，再接到對應 stack。                       |
| Mobile data repository                        | `apps/mobile/src/features/<domain>/repository.ts`。                                     |
| Mobile data source / adapter / canonical data | `apps/mobile/src/data/`。                                                               |
| Mobile 外部整合或商業邏輯 engine              | `apps/mobile/src/services/`。                                                           |
| Mobile 通用 UI                                | `apps/mobile/src/ui/`。                                                                 |
| Web 頁面                                      | `apps/web/src/app/<route>/page.tsx`。                                                   |
| Web route handler                             | `apps/web/src/app/<route>/route.ts`。                                                   |
| Web 共用 UI                                   | `apps/web/src/components/` 或 `apps/web/src/components/ui/`。                           |
| Shared type / enum / school data              | `packages/shared/src/`。                                                                |
| 需要 secret、權限或 server validation 的 API  | `backend/functions/`。                                                                  |
| Firestore / Storage schema change             | 同步更新 `backend/firestore/`、`backend/storage/`、測試與文件。                         |
| AI prompt / RAG / training code               | `backend/ai-server/prompts/`、`backend/ai-server/rag/`、`backend/ai-server/training/`。 |
| 文件                                          | `docs/`，長期架構放 `docs/architecture/`，法務放 `docs/legal/`。                        |
| 一次性輸出或簡報暫存                          | `tmp/` 或 `outputs/`，不要進 Git。                                                      |

## 不應進 Git 的檔案

這些檔案已由 `.gitignore` 排除；如果曾被追蹤，應使用 `git rm --cached` 移出版本控制。

- 依賴與安裝產物：`node_modules/`、`Pods/`
- build / cache：`.next/`、`.expo/`、`build/`、`dist/`、`web-build/`、`*.tsbuildinfo`
- 本機設定與 secret：`.env`、`.env.*`，但保留 `*.env.example`
- log / debug：`*.log`、`firebase-debug.log*`、`firestore-debug.log*`
- OS / IDE / agent state：`.DS_Store`、`.claude/`、`.cursor/`、`.playwright-cli/`
- 暫存輸出：`tmp/`、`outputs/`
- Python runtime data：`__pycache__/`、`*.pyc`、`backend/ai-server/.venv/`、`backend/ai-server/data/`

## 快速盤點指令

```bash
git status --short --ignored
git ls-files | sort
find . -name .DS_Store -type f -print
```
