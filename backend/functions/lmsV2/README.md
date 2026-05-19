# LMS v2 Firebase Functions

這個資料夾放 LMS v2 整合所需的 Firebase Callable。**全部模組目前都是「程式碼準備好但未匯出」狀態,要正式啟用須在 `backend/functions/index.js` 加上 `require('./lmsV2').issueSupabaseJwt` 等。**

## 部署前置

```bash
# 在 backend/functions 內安裝
npm i @supabase/supabase-js
# jose 已在現有依賴中

# 設定 Secrets (Production 用 GCP Secret Manager)
firebase functions:secrets:set SUPABASE_URL
firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
firebase functions:secrets:set SUPABASE_JWT_SECRET
```

## 啟用步驟

1. 在 `backend/functions/index.js` 文末加入:
   ```js
   exports.issueSupabaseJwt = require('./lmsV2/issueSupabaseJwt').issueSupabaseJwt;
   ```
2. `firebase deploy --only functions:issueSupabaseJwt`

## 回退

若要關閉 LMS v2 橋接,直接從 index.js 移除該行 `exports`,或設 `EXPO_PUBLIC_LMS_V2=false` 讓前端不再呼叫此 callable。
