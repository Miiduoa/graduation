# 校園助手 Web

這個目錄是校園助手的 Web / PWA 客戶端，使用：

- Next.js 16 App Router
- React 19
- Firebase Web SDK
- Vitest

這不是 create-next-app 預設樣板。專案整體說明、workspace 結構、CI/CD 與目前產品定位請先看根目錄 [`README.md`](../../README.md)。

## 目前定位

Web 端目前是 school-aware 的校園入口與 PWA shell，包含：

- 首頁 / Today-style landing
- PU 學號登入
- 公告、地圖、餐廳、圖書館、社團、群組、課表、成績
- 個人資料、設定、搜尋
- teacher course 頁面
- SSO callback / ACS 路由基礎

目前對外主要登入流程是 **PU 學號登入**；SSO 相關 helper 與 route 仍保留在程式中，作為未來多校整合基礎。

## 本機開發

安裝 workspace 依賴：

```bash
pnpm install
```

建立 Web env：

```bash
cp apps/web/.env.example apps/web/.env.local
```

啟動開發：

```bash
pnpm dev:web
```

或直接在 package 範圍執行：

```bash
pnpm --filter web dev
```

## 常用指令

```bash
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web typecheck
```

## 重要檔案

- `src/app/`：App Router pages 與 route handlers
- `src/components/`：Web UI 與 site shell
- `src/lib/firebase.ts`：Firebase 初始化與資料存取 helper
- `src/lib/pageContext.ts`：school-aware page context
- `src/lib/sso.ts`：Web SSO helper
- `public/manifest.json`、`public/sw.js`：PWA 基礎

## 備註

如果你在其他文件或舊截圖中看到 Web 被描述成「Next.js 初始樣板」，那已不是目前狀態。這個目錄現在已經是專案正式的一部分，而且已被納入 root workspace、測試與 GitHub Actions 流程。
