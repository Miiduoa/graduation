# 畢業專題（校園應用）

目標：
- **Mobile**：iOS/Android（跨平台）
- **Web**：PWA/網站
- **Backend**：Firebase（先假資料，後續接 Firestore/Auth/Functions）
- **SSO**：學校單一登入（暫以「可插拔 SSO」架構做 placeholder；多校通用，後續可接 OIDC/SAML/CAS）

## Monorepo 結構
- `apps/mobile`：Expo（React Native + TypeScript）
- `apps/web`：Next.js（TypeScript）
- `packages/shared`：共用型別/假資料/介面（含 schools mock + 代碼撞碼處理）
- `backend`：Firebase（functions / firestore rules / indexes）

## 產品路線
- **路線1（先做）**：平台型、多校通用（不靠各校深度整合也能使用）
- **路線2（後做）**：深整合（SSO + 校務/課表/成績/出缺席等）

## 目前完成
- Web/Mobile：多校通用骨架（school code + schoolId）
- Code 允許撞碼：輸入縮寫代碼，若多校符合則讓使用者選擇

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

### Rules
- 規則檔：`backend/firestore/firestore.rules`
- 目前策略：公共資料（公告/POI/活動/菜單）可讀；寫入需 admin/editor。

部署（之後要真的 Firebase project 才能用）：

```bash
pnpm -w firebase deploy --only firestore:rules
```
