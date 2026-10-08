# Campus One 與 nuni.tw 發布紀錄

更新：2026-10-09（Asia/Taipei）。目標包含 Campus One 的商店上架與 nuni.tw 正式 Web；兩邊都保留完整功能及既有資料，不能用其中一邊的驗證代替另一邊。

## 已核對的發布目標

- Expo：`@miiduoa/campus-one`，project `8955b97c-802c-463c-bd1d-d5f02e30a966`。
- Google Play：既有 `nuni` App，package `com.nuni.app`。後台目前唯一已上傳套件為 versionCode 3 / 0.1.0，已提供給內部測試人員。這是既有 Nuni 版本，不是本次 Campus One 提交。
- EAS production 的公開 Android 與 iOS identifier 都是 `com.nuni.app`。iOS 仍需 App Store Connect 紀錄核對；Expo 設定不能代替商店證據。
- EAS 有 Android upload keystore 的 secret 設定名稱；沒有讀取金鑰、密碼或檔案內容。EAS credentials 的 applicationIdentifier 卻記錄成 Gradle 表達式，不能直接證明它與 Play 的上傳憑證一致。該專案的 iOS credential list 為空。
- 正式 Web 為 `nuni-web`，API 為 `api.nuni.tw`。現站 Web/API readiness 回 200；`/privacy`、`/support`、`/account-deletion` 也回 200。這沒有驗證某個使用者的登入或本次候選已部署。

## 本批發布修正

一般 EAS Build workflow 只接受 development/preview。production 統一走 Release workflow 的目標、原生身分、完成產物與提交檢查；即使 API 傳入未列出的 profile，也會在安裝或建置之前拒絕。

EAS 改用 remote build version，production 保持 autoIncrement。此次查詢 `com.nuni.app` 的 remote counter 尚未建立；Android 初始值設為 4，避開已上傳的 3，以及 EAS 歷史中的 4。首次 production build 預期分配 5，實際版號仍須以建置結果核對。之後不把臨時 checkout 的版號當成跨次執行的唯一來源。參考 [Expo 版號管理](https://docs.expo.dev/build-reference/app-versions/)。

preview/production 的 manifest 不再包含開發用 Gemini key；用戶端程式也移除會被 Metro 展開成字串的 EXPO_PUBLIC 環境 fallback。開發模式仍從 Expo config 讀取該設定。iOS config 保留既有 Info.plist 宣告，不再覆蓋 app.json 的 export-compliance 欄位。

商店文案統一使用 Campus One，刪除未經本版本驗收的 AR、即時校車、即時擁擠度與「全新 AI 上線」等宣稱。年齡分級由商店問卷及實際內容決定，不沿用檔案中的 FOUR_PLUS／Everyone 預設。`store.config.json` 是待驗收版本使用的文案來源，本批未推送商店 metadata。

Web 容器健康檢查改為讀取 PORT，兼容 nuni-web 既有的 3000，不再固定探測 8080。此次沒有替換正式 Web 映像；兩台現站機器仍使用 release 31、image digest `sha256:120b9d015a94810d6180bce0af6f03442963fd7fd52c0570235d2f54609c208c`。正式切換前需保存此回復目標，並完成候選版的登入與角色驗收。

## 實際驗證

- Release scripts：43 項通過，含 EAS CLI 24.12.0 對應的 @expo/eas-json 24.9.0 schema/resolver，無略過。
- Mobile：型別檢查、助理服務 9 項測試通過。
- 使用合成設定輸出 Android production JavaScript，95 個產物均未含注入的開發 key 標記。這是封裝測試，不是簽署 AAB。
- Workflow YAML 可解析；development/preview 通過入口檢查，production、空值、未知值及 shell 注入字串皆拒絕。
- Web standalone 使用 PORT=3131 實際啟動，以容器相同的健康檢查邏輯取得 200。

## 還需要完成的交付

1. **後端接軌**：EAS production 目前是 Nuni API／原生帳號設定，Campus One mobile 仍要求 Firebase 設定，兩者不是換名稱就能互通。必須完成原生 Nuni session、校方 provider、功能資料與跨帳號撤銷驗收。這是工程缺口，並非要求啟用 Firebase 付費方案。
2. **簽署**：核對 Play upload certificate 與實際使用的 key，修復 EAS 正式 App identifier 關聯；取得 Apple 登入後確認 App Store Connect、Team、Bundle ID 與簽署資格。目前 tracked iOS project 仍是 `.dev`，發布 guard 會拒絕。
3. **Google Play**：後台封閉測試參加者為 0，正式版申請停用。先完成 App 設定與可用測試版本，再由至少 12 位真實測試人員連續參加 14 天，才能申請正式版。內部測試不能取代這項要求。參考 [Google 官方要求](https://support.google.com/googleplay/android-developer/answer/14151465)。
4. **nuni.tw 並行交付**：維持既有 Web/API 運作，將 Campus One 候選與同一正式後端的帳號、權限及資料契約核對；完成登入、角色、重要既有路由及回復驗收後更新現站。不能把 readiness 200 當作整個 Web 已更新。
5. **商店驗收**：同版本簽署檔、真實裝置、審查帳號、資料安全與隱私問卷、截圖和測試回饋仍需完成。沒有提交或公開發布本次候選。
