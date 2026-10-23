# Campus One 與 nuni.tw 發布紀錄

最新正式 Web 已部署帳號、學校資格、店家與登入返回修正：Web release 35（`9a77ed2`），API 沿用 release 20（`cb57e78`）。正式 16 條公開路由與 49 個同源資源檢查通過；先前管理員／社群真人驗收屬 release 34，尚未重跑本批全部登入後流程。見 [平台發布紀錄](PLATFORM_RELEASE.md)。本次沒有提交新的 App Store／Google Play 版本；下列原生接軌、簽署、實機與商店事項仍需完成。

## 2026-10-09 Google 與原生候選補充

Google Console 已新增 `campus-one-android-play`，綁定 `com.nuni.app` 與 Play app signing SHA-1 `04:8E:5F:F0:A1:0D:68:08:DE:CF:1C:E3:D7:04:EC:4F:5E:CC:77:23`，公開 client ID `1096741064465-39b13khidhmohvo1go3nlmomgk3p07d4.apps.googleusercontent.com`。原 `nuni-android-prod` F7:ED 指紋是 upload certificate，保留供原流程使用。iOS 既有 `nuni-ios-prod` 已由 Console 確認為 `com.nuni.app`。

Google 專案目前 Testing，品牌尚未完成；基本 `openid email profile` 登入符合 Google 的測試名單例外，但仍未完成真人／實機授權驗收。不得把 Console 設定成功描述成 App 已發版。

正式候選新增獨立 `campus-one-native-google-1` runtime，避免舊 native binary 收到新增原生模組的 OTA。EAS production 尚缺此 repo 必填公開服務設定；Firebase 公開值有 Hosting 來源，法務頁在 nuni.tw，其餘 endpoint、Maps 與 released school IDs 尚需依實際服務驗收，未填造假值或關閉 gate。iOS 的簽署、entitlements、商店目標與最終 artifact 身分另行驗收。

## 先前 Web 批次與商店準備紀錄

正式 Web 已於 2026-10-09 00:32（Asia/Taipei）部署至 [nuni.tw](https://nuni.tw)，版本 `ddbbed104b444cb95b85c82681fbc0cb85385e54`，Fly release 33。兩台既有 nrt 主機的 readiness 都回傳同一版本；公開站 33 項檢查通過。商店上架與原生驗收仍分開追蹤。

更新：2026-10-09（Asia/Taipei）。目標包含 Campus One 的商店上架與 nuni.tw 正式 Web；兩邊都保留完整功能及既有資料，不能用其中一邊的驗證代替另一邊。

## 已核對的發布目標

- Expo：`@miiduoa/campus-one`，project `8955b97c-802c-463c-bd1d-d5f02e30a966`。
- Google Play：既有 `nuni` App，package `com.nuni.app`。後台目前唯一已上傳套件為 versionCode 3 / 0.1.0，已提供給內部測試人員。這是既有 Nuni 版本，不是本次 Campus One 提交。
- EAS production 的公開 Android 與 iOS identifier 都是 `com.nuni.app`。iOS 仍需 App Store Connect 紀錄核對；Expo 設定不能代替商店證據。
- EAS 有 Android upload keystore 的 secret 設定名稱；沒有讀取金鑰、密碼或檔案內容。EAS credentials 的 applicationIdentifier 卻記錄成 Gradle 表達式，不能直接證明它與 Play 的上傳憑證一致。該專案的 iOS credential list 為空。
- 正式 Web 為 `nuni-web`，API 為 `api.nuni.tw`。新版 Campus One 已上線，`/health/ready` 回傳本次部署 SHA；API、隱私、支援、刪除帳號及原有帳號路由皆通過公開站檢查。Google 登入入口可導向正式 Google 授權網址；尚未以真人完成授權及所有角色流程。

## 本批發布修正

一般 EAS Build workflow 只接受 development/preview。production 統一走 Release workflow 的目標、原生身分、完成產物與提交檢查；即使 API 傳入未列出的 profile，也會在安裝或建置之前拒絕。

EAS 改用 remote build version，production 保持 autoIncrement。此次查詢 `com.nuni.app` 的 remote counter 尚未建立；Android 初始值設為 4，避開已上傳的 3，以及 EAS 歷史中的 4。首次 production build 預期分配 5，實際版號仍須以建置結果核對。之後不把臨時 checkout 的版號當成跨次執行的唯一來源。參考 [Expo 版號管理](https://docs.expo.dev/build-reference/app-versions/)。

preview/production 的 manifest 不再包含開發用 Gemini key；用戶端程式也移除會被 Metro 展開成字串的 EXPO_PUBLIC 環境 fallback。開發模式仍從 Expo config 讀取該設定。iOS config 保留既有 Info.plist 宣告，不再覆蓋 app.json 的 export-compliance 欄位。

商店文案統一使用 Campus One，刪除未經本版本驗收的 AR、即時校車、即時擁擠度與「全新 AI 上線」等宣稱。年齡分級由商店問卷及實際內容決定，不沿用檔案中的 FOUR_PLUS／Everyone 預設。`store.config.json` 是待驗收版本使用的文案來源，本批未推送商店 metadata。

新版 Web 使用原有 3000 埠，並把 release 31 的既有 Nuni 服務固定在同容器的 127.0.0.1:3001。Campus One 新路由優先，舊帳號、公開法務頁與舊版靜態資產仍可使用；登入回呼依密封交易 state 分流。原有 API、資料庫與登入 secrets 未變更。兩個 Web 程序都正常時 readiness 才會成功；任何一個異常退出會使容器停止。已保存 release 31 的映像與設定供回復。

## 本次 Web 部署驗證

- production 容器建置通過，使用實際 Firebase 公開設定，沒有放入私密金鑰。
- 本機容器 HTTP smoke 59/59 通過，包含 41 個新舊 JS／CSS 資產與舊登入來源驗證。
- 新舊 callback state 分流實測通過；120 個請求、20 個並行連線皆成功，512 MB 限額內峰值約 329 MB，無 OOM。
- 正式站 33/33 檢查通過：新版首頁、既有公開路由、未登入 session、Google 登入起始轉址及 Nuni API。
- 正式瀏覽器呈現新版 Campus One，首頁沒有 console error。

## 商店封裝修正驗證

- Release scripts：43 項通過，含 EAS CLI 24.12.0 對應的 @expo/eas-json 24.9.0 schema/resolver，無略過。
- Mobile：型別檢查、助理服務 9 項測試通過。
- 使用合成設定輸出 Android production JavaScript，95 個產物均未含注入的開發 key 標記。這是封裝測試，不是簽署 AAB。
- Workflow YAML 可解析；development/preview 通過入口檢查，production、空值、未知值及 shell 注入字串皆拒絕。
- Web standalone 使用 PORT=3131 實際啟動，以容器相同的健康檢查邏輯取得 200。

## 還需要完成的交付

1. **後端接軌**：EAS production 目前是 Nuni API／原生帳號設定，Campus One mobile 仍要求 Firebase 設定，兩者不是換名稱就能互通。必須完成原生 Nuni session、校方 provider、功能資料與跨帳號撤銷驗收。這是工程缺口，並非要求啟用 Firebase 付費方案。
2. **簽署**：核對 Play upload certificate 與實際使用的 key，修復 EAS 正式 App identifier 關聯；取得 Apple 登入後確認 App Store Connect、Team、Bundle ID 與簽署資格。目前 tracked iOS project 仍是 `.dev`，發布 guard 會拒絕。
3. **Google Play**：後台封閉測試參加者為 0，正式版申請停用。先完成 App 設定與可用測試版本，再由至少 12 位真實測試人員連續參加 14 天，才能申請正式版。內部測試不能取代這項要求。參考 [Google 官方要求](https://support.google.com/googleplay/android-developer/answer/14151465)。
4. **正式帳號驗收**：nuni.tw 新版部署已完成；後續仍需真人完成 Google 授權、各角色操作及學校 provider／資料接軌驗收。這次只驗證登入入口與相容路由，沒有宣稱原生和全部校務功能已完成。
5. **商店驗收**：同版本簽署檔、真實裝置、審查帳號、資料安全與隱私問卷、截圖和測試回饋仍需完成。沒有提交或公開發布本次原生商店候選。
