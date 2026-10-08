# 發布流程

Web、Firebase 與商店產物分別驗證。GitHub CI 通過不代表正式站已更新；EAS build 完成也不代表商店審查通過。

## Firebase

`main` 的 CI 使用 GitHub `production` environment：

- Variable `FIREBASE_PROJECT_ID`：明確的目標專案 ID。
- Secret `FIREBASE_TOKEN`：該專案授權的 Firebase `login:ci` refresh token。

先部署 Firestore／Storage rules 與索引，再由 `wait-for-firestore-indexes.cjs` 查詢目標資料庫的實際索引狀態。全部必要索引 READY 才部署 Functions；20 分鐘仍未完成就停止。此版本使用 refresh token 換取短效 access token，不接受把原始 access token 當作 refresh token。憑證及服務錯誤的回應內容不寫入日誌。

此流程不部署 Web、不遷移歷史資料，也不切換 Nuni 網域。舊點名、失物、訂單與帳號資料須先完成對應遷移及還原驗證。

## App

手動執行 GitHub `Release` workflow，選擇平台及 `preview`／`production` profile。`submit` 預設關閉；開啟才將驗證通過的正式產物交給商店服務。Android 維持 internal track、draft、changesNotSentForReview；iOS 上傳並不自動完成 App Store 審查。

對應 GitHub environment 必須提供：

| 類別     | 名稱                                      | 用途                                                      |
| -------- | ----------------------------------------- | --------------------------------------------------------- |
| Variable | `EAS_PROJECT_ID`                          | 已核對的既有 EAS 專案 UUID，同時供 Expo config 與產物比對 |
| Variable | `IOS_BUNDLE_IDENTIFIER`                   | 已核對的 iOS 商店識別碼                                   |
| Variable | `ANDROID_PACKAGE_NAME`                    | 已核對的 Android 商店識別碼                               |
| Secret   | `EXPO_TOKEN`                              | 該 EAS 專案的存取權限                                     |
| Secret   | `APPLE_ID`、`ASC_APP_ID`、`APPLE_TEAM_ID` | iOS 提交帳戶、App Store Connect App ID 與 Team ID         |

Firebase、學校、法律頁與功能開關等 build profile 所需設定仍須在 EAS 環境備妥；上述項目並不替代 `app.config.ts` 的必要設定。簽署與商店服務帳號須先在既有 EAS 專案確認。不要在 GitHub 或 EAS 日誌輸出憑證值。

流程以 EAS CLI **24.12.0** 執行 `build --wait --json`。`verify-eas-build.mjs` 要求唯一的完成結果，逐一核對來源 SHA、EAS 專案、平台、profile、distribution、原生識別碼及產物網址；iOS 必須是裝置產物。未完成、錯誤、缺欄位或識別碼不一致都會停止，不會改選其他建置。build receipt 以 workflow artifact 保存，提交只使用該 receipt 驗證過的 ID，不能使用 `--latest`。

`prepare-eas-submit.mjs` 在提交前驗證 Apple 設定，將實際值寫入 CI checkout 的 `eas.json`；它不建立帳戶、簽署或商店 App。Android 預設使用既有 EAS 遠端提交憑證。若另行使用 `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`，必須是已準備好的絕對路徑、可讀的一般檔案，且不可含環境變數展開字元。不要將包含提交帳戶資料的暫存設定提交到 Git。

根目錄的手動 `submit:ios`／`submit:android` 指令必須明確設定 `EAS_BUILD_ID`；它們只供已另行核對產物與提交設定的操作使用。建議使用上述有完整比對的 Release workflow。

目前追蹤的 iOS native project 仍使用 `.dev` 識別碼，Expo 的 `APP_ENV=production` 不會自動改寫它。這項原生設定、Nuni 商店識別碼及簽署資產尚未完成核對，不能直接送審。發布 gate 會拒絕不符合目標的產物，而不會改寫商店帳號來遷就錯誤建置。

## 本機驗證

使用 Node 22：

```sh
node --test scripts/wait-for-firestore-indexes.test.cjs scripts/verify-eas-build.test.mjs scripts/prepare-eas-submit.test.mjs
pnpm typecheck
pnpm lint
pnpm --filter web test
pnpm --filter mobile test --ci
```

提交設定另提供 EAS 真實 schema 整合測試。將 `EAS_JSON_PACKAGE_ROOT` 設為隔離安裝的 `@expo/eas-json@24.9.0` 絕對路徑後執行上述 node tests。這是 EAS CLI 24.12.0 使用的版本；未設定時該項測試會明確跳過，不能把它列為通過。schema 通過只證明設定格式可解析，不證明憑證有效或商店已接受產物。
