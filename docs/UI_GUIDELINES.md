# UI Guidelines

本文件定義 App/Web 共同使用的 UI 規範，對應 A+C+D 混合風格（現代簡約 + iOS 乾淨感 + 校園品牌識別）。

## Design Tokens

- **Color**
  - 背景：`bg`
  - 卡片：`surface` / `surface2`
  - 文字：`text` / `muted`
  - 品牌：`accent` (`--brand`)
  - 狀態：`success` / `warning` / `danger` / `info`
- **Spacing**
  - `xs=4`, `sm=8`, `md=16`, `lg=24`, `xl=32`, `xxl=48`
- **Radius**
  - `sm=12`, `md=16`, `lg=20`, `xl=24`
- **Typography**
  - `display`, `h1`, `h2`, `h3`, `body`, `bodySmall`, `label`, `labelSmall`

## Mobile 規範

- 主要容器使用 `Screen`，避免各頁自定義根層背景與 padding。
- Stack 標題樣式統一透過 `createStackScreenOptions()`。
- Tab 樣式統一透過 `createTabScreenOptions()`。
- 列表頁統一使用 `Card + SearchBar + Filter` 組合：
  - 頂部資訊區
  - 搜尋列
  - 篩選/排序
  - 結果列表

## Web 規範

- 殼層統一使用 `SiteShell`。
- 全域樣式與 token 只在 `globals.css` 維護。
- 固定 Banner 層級：
  - `offlineBanner` > `pwaInstallBanner` > `updateBanner` > `topbar`
- 優先使用共用 class（`.card`, `.btn`, `.input`, `.grid-*`），減少 inline style。

## 驗收檢查清單

- 各頁背景、卡片、按鈕狀態色一致。
- 行動端與網頁端的標題階層一致（h1/h2/body）。
- 離線、更新、PWA 安裝提示不遮擋主要操作區。
- 新增頁面時不需要重新發明樣式，只組合 token 與共用元件。
