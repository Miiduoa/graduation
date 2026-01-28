# 畢業專題（校園應用）

目標：
- **Mobile**：iOS/Android（跨平台）
- **Web**：PWA/網站
- **Backend**：Firebase（先假資料，後續接 Firestore/Auth/Functions）
- **SSO**：學校單一登入（暫以「可插拔 SSO」架構做 placeholder；待取得學校 SSO 規格/OIDC/SAML）

## Monorepo 結構
- `apps/mobile`：Expo（React Native + TypeScript）
- `apps/web`：Next.js（TypeScript）
- `packages/shared`：共用型別/假資料/介面
- `packages/ui`：共用 UI 元件（可逐步抽）
- `packages/config`：eslint/tsconfig 等
- `backend`：Firebase（functions / firestore rules / indexes）

## 先做 MVP（本週可交付）
- 假登入（後續換學校 SSO）
- 公告：列表/詳情
- 課表：週視圖/日視圖（假資料）
- 校園地圖：點位列表 + 地圖（web 用 leaflet；mobile 用地圖套件）
- 社團活動：列表/報名（假資料）
- 校園餐廳：菜單/營業時間（假資料）

## 問題（需要你補資料才能真的做 SSO）
1. 你的學校名稱/網址？
2. SSO 規格：OIDC / SAML / CAS / 其它？（Tronclass 常見為 LMS，本身不等於學校 SSO）
3. 是否有 client_id / issuer / redirect URI 規範？

