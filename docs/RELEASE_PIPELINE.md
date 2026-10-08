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

2026-10-08 已從既有、已登入的 Google Play Console 確認 Nuni Android package 為 `com.nuni.app`；該 App 仍是草稿／內部測試，並非公開上架。EAS 專案為 `@miiduoa/campus-one`，UUID `8955b97c-802c-463c-bd1d-d5f02e30a966`。GitHub `production` environment 已設定並讀回核對 `ANDROID_PACKAGE_NAME`、`EAS_PROJECT_ID` 兩項非機密變數。iOS 商店識別碼尚未從 Apple 帳戶確認，相關 Apple 設定及發布 secrets 尚未設定，不能從 Android package 推定 iOS bundle ID。

建置前，`prepare-eas-build.mjs --prepare` 將已核對的識別碼、project ID 與 profile 寫入 CI checkout 的 `eas.json` 共用及平台 `env`，並明確選擇同名 EAS `production`／`preview` environment。這修正只有 `EXPECTED_APP_IDENTIFIER` 比對值、卻沒有把 `ANDROID_PACKAGE_NAME`／`IOS_BUNDLE_IDENTIFIER` 傳入 `app.config.ts` 的缺口。工作流程再以 EAS `config --json` 的真正解析結果比對 Expo app identifier、project ID、updates URL、profile、distribution 與裝置建置設定，成功才建立 build。

本地 [EAS config 的環境合併](https://github.com/expo/eas-cli/blob/v24.12.0/packages/eas-cli/src/build/evaluateConfigWithEnvVarsAsync.ts) 與 [worker 的合併](https://github.com/expo/eas-cli/blob/v24.12.0/packages/build-tools/src/context.ts) 順序不同，不能只靠本地 env 就宣稱遠端一致。因此 preparation 也會在暫存 checkout 產生非機密 `.release-build-target.json`，並保留既有 `eas-build-post-install` hook，在其成功後執行 worker guard。guard 在 [Android](https://github.com/expo/eas-cli/blob/v24.12.0/packages/build-tools/src/builders/android.ts)／[iOS](https://github.com/expo/eas-cli/blob/v24.12.0/packages/build-tools/src/builders/ios.ts) prebuild 後，重新比對實際環境、Expo 設定與原生識別碼；遠端環境覆寫、native 產物缺失或不一致都會停止。Android gate 目前只支援這個專案的單一 application、literal applicationId，不接受動態 Gradle ID、多 flavor 或 applicationIdSuffix。這些暫存 `eas.json`、`package.json` 與 target receipt 僅供當次 build archive，不能提交回 Git。

流程以 EAS CLI **24.12.0** 執行 `build --wait --json`。`verify-eas-build.mjs` 要求唯一的完成結果，逐一核對來源 SHA、EAS 專案、平台、profile、distribution、原生識別碼及產物網址；iOS 必須是裝置產物。未完成、錯誤、缺欄位或識別碼不一致都會停止，不會改選其他建置。build receipt 以 workflow artifact 保存，提交只使用該 receipt 驗證過的 ID，不能使用 `--latest`。

`prepare-eas-submit.mjs` 在提交前驗證 Apple 設定，將實際值寫入 CI checkout 的 `eas.json`；它不建立帳戶、簽署或商店 App。Android 預設使用既有 EAS 遠端提交憑證。若另行使用 `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`，必須是已準備好的絕對路徑、可讀的一般檔案，且不可含環境變數展開字元。不要將包含提交帳戶資料的暫存設定提交到 Git。

根目錄的手動 `submit:ios`／`submit:android` 指令必須明確設定 `EAS_BUILD_ID`；它們只供已另行核對產物與提交設定的操作使用。建議使用上述有完整比對的 Release workflow。

目前追蹤的 iOS native project 仍使用 `.dev` 識別碼，Expo 的 `APP_ENV=production` 不會自動改寫它。iOS 目標尚未設定時 preparation 立即失敗；未來填入已核對的正式識別碼後，只要追蹤的 native project 仍不相符，同樣會在 EAS build 前失敗且不改寫檔案。原生設定、Apple 商店識別碼與簽署資產仍待核對，不能直接送審。

## 本機驗證

使用 Node 22：

```sh
node --test scripts/wait-for-firestore-indexes.test.cjs scripts/verify-eas-build.test.mjs scripts/prepare-eas-submit.test.mjs scripts/prepare-eas-build.test.mjs
pnpm typecheck
pnpm lint
pnpm --filter web test
pnpm --filter mobile test --ci
```

建置與提交設定提供 EAS 真實 schema 整合測試。將 `EAS_JSON_PACKAGE_ROOT` 設為隔離安裝的 `@expo/eas-json@24.9.0` 絕對路徑後執行上述 node tests。這是 EAS CLI 24.12.0 使用的版本；本機未設定時兩項 schema 測試會明確跳過，不能把它們列為通過。CI 與 Release preflight 會隔離安裝此版本並設定該路徑，實際執行 resolver/schema 測試，不修改 workspace 鎖檔。測試同時執行 repo 的真正 `app.config.ts`，驗證繼承 profile 的 override、本機／worker 設定、原生不一致及 iOS `.dev` 阻擋。這些是本機證據，不證明遠端已建置、憑證有效或商店已接受產物。

### 單欄位 collection-group 索引

活動報名的刪帳清理需要 `registrations.userId` 的 `COLLECTION_GROUP` 單欄位索引，已由 `firestore.indexes.json` 的 `fieldOverrides` 宣告。相同 readiness gate 會驗證各欄位設定的每一種 scope／排序皆已 READY；REST 欄位列表有分頁，繼承的設定會在同專案、同資料庫內讀取並驗證。建立中、回復繼承中、遺漏或無法確認的狀態都不能繼續部署 Functions。測試使用合成 REST 回應，尚未對正式專案執行此 gate。
