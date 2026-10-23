# Campus One 商店審查準備說明

更新日期：2026-10-08。這是待補齊的送審準備文件，不代表已部署正式環境、已提交審查或已上架。提交前須依同一份簽署版本的實測結果更新，不能把開發版本的畫面或測試結果當成正式版證明。

## 版本與建置依據

| 項目             | 目前可確認的內容                                                                                                                 | 送審前仍需確認                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 產品名稱         | 登入畫面、`app.json`、`app.config.ts` 名稱預設及 iOS `Info.plist` 顯示名稱均為 Campus One                                        | 商店名稱、安裝後名稱、截圖與產品品牌一致                                                        |
| 版本             | `app.json` 為 `1.0.0`                                                                                                            | 實際上傳版本、iOS build number、Android version code                                            |
| iOS 最低版本     | 已追蹤的 `ios/Podfile` 與 Xcode target 均為 **iOS 15.1**；React Native 0.81.5 的最低版本亦為 15.1                                | 簽署 IPA 的 `MinimumOSVersion`、最低版本真機驗證                                                |
| Android 最低版本 | 已安裝的 React Native 0.81.5 與 Expo 原生建置基線為 **API 24（Android 7.0）**；`app.config.ts` 沒有覆寫 minSdk                   | 專案尚無已追蹤的 Android native 目錄；須從實際產生的 AAB 核對 minSdk、targetSdk 與裝置相容性    |
| Bundle / package | `app.config.ts` 的 production 預設為 `com.campus.app`，可由環境變數覆寫；目前已追蹤的 iOS Xcode target 仍是 `com.campus.app.dev` | 簽署產物、商店紀錄與正式推播／登入設定使用同一識別碼                                            |
| 語言             | 目前產品主要流程為繁體中文；EAS 的 iOS submit language 為 `zh-Hant`                                                              | 尚無完整英文流程驗證，不宣稱支援英文                                                            |
| 學校             | 目前核對的校務、館藏與校園入口以靜宜大學為主                                                                                     | 正式環境的 `EXPO_PUBLIC_RELEASED_SCHOOL_IDS` 及每所學校的功能驗收；不得由多校架構推論已支援多校 |

原始依據：`apps/mobile/app.json`、`apps/mobile/app.config.ts`、`apps/mobile/eas.json`、`apps/mobile/ios/Podfile`、`apps/mobile/ios/mobile.xcodeproj/project.pbxproj`；Android 基線取自安裝鎖定版本的 `react-native/gradle/libs.versions.toml` 與 Expo 原生 Gradle 設定。平台最低版本是建置要求，不代表已完成全部裝置測試。

## 建置與發布狀態

- `development` 使用內部分發及 iOS simulator；`preview` 是內部分發，Android 產物為 APK；`production` 的 Android 產物設定為 App Bundle。
- production 設定要求 Firebase 真實資料，關閉本機假登入與資料失敗後的假資料回退。Preview／production 還需要 Firebase、EAS、法律頁面、錯誤回報、地圖金鑰及已開放學校等必要設定；檔案存在不代表正式環境已備齊。
- SSO、課程、成績、付款、widget 與 deep link 在 release 類型建置預設關閉，須逐項明確設定。審查說明必須依實際啟用的功能填寫。
- `eas.json` 的 Android submit 目標目前是 `internal`、`draft` 且 `changesNotSentForReview: true`，不能宣稱公開上架。Apple／Google 帳號、簽署、商店 App 紀錄與提交結果尚需證據。
- 已有 iOS Development 模擬器訪客登入導覽通過的基準：[GitHub Actions 37705225138](https://github.com/Miiduoa/graduation/actions/runs/37705225138)，對應 commit `28bd6dd0806150a2fb5acee8a4bff8a9c2a4667a`。這只驗證啟動、登入入口及前往學校登入畫面；不涵蓋後續程式修改、真正登入、已登入功能、簽署正式版本或商店審查。

## iOS production 識別碼阻塞

目前 `APP_ENV=production` **不會自動把已追蹤的 iOS 專案改成正式商店識別碼**。已存在的 native 專案由 EAS 直接建置，不會自動執行 Prebuild 來套用 app config。[Expo 官方建置說明](https://docs.expo.dev/workflow/continuous-native-generation/#usage-with-eas-build)

可重現的來源鏈：

1. `apps/mobile/eas.json` 的 `build.production.env.APP_ENV` 設為 `production`，但沒有另外指定 iOS scheme／build configuration 或執行識別碼同步。
2. `apps/mobile/app.config.ts:152` 起的 `bundleIdentifier` 選擇會讀 `IOS_BUNDLE_IDENTIFIER`，否則 production 預設為 `com.campus.app`。這是 Expo 設定值，不能代替已存在 Xcode 專案的值。
3. `apps/mobile/ios/mobile.xcodeproj/project.pbxproj:406`（Debug）及 `:437`（Release）的 `PRODUCT_BUNDLE_IDENTIFIER` 都固定為 `com.campus.app.dev`，沒有 `APP_ENV` 條件映射。
4. `apps/mobile/ios/mobile.xcodeproj/xcshareddata/xcschemes/mobile.xcscheme` 的 `ArchiveAction` 選擇 Release；`apps/mobile/ios/mobile/Info.plist` 的 `CFBundleIdentifier` 使用 `$(PRODUCT_BUNDLE_IDENTIFIER)`。因此目前 Archive 仍取 `.dev`。
5. `.github/workflows/eas-build.yml:55` 直接執行所選 profile 的 `eas build`；專案沒有 `.easignore` 排除 iOS，且 iOS 目錄已追蹤。`.github/workflows/maestro-e2e.yml:101` 另記錄 native 專案含 Firebase／llama-rn 整合設定，不能為了改識別碼直接清空重建。

本次僅修正可見名稱，保留 Xcode target／scheme、bundle identifier、Apple team、Android package 與服務憑證。`PRODUCT_NAME=mobile` 仍用於編譯產物；`CFBundleDisplayName`／`CFBundleName` 及原生權限提示中的產品名稱已使用 Campus One。

已以 EAS CLI 唯讀確認可沿用的 Nuni 專案為 `@miiduoa/campus-one`（project ID `8955b97c-802c-463c-bd1d-d5f02e30a966`）。Nuni 原始碼的 production 設定使用 `com.nuni.app`，但未取得商店端註冊及簽署資產證據，因此尚未把它套入此專案。

**尚缺輸入：** 需要核對 Nuni 既有 App Store Connect App／Apple Team／bundle identifier、Google Play package 與對應簽署資產。不能由 Nuni 品牌或網域推導 `com.nuni.*`，也不能把目前 Expo production 預設 `com.campus.app` 當成已存在的商店身分。

**可供下一步 review 的最小修法，尚未套用：** 保留目前 native 專案與所有整合；在取得既有商店識別碼後，建立明確的 development／production Xcode build configuration 與 scheme，讓 EAS profile 用 `ios.buildConfiguration`／`ios.scheme` 選擇相應配置，與既有 `APP_ENV` 同步。每個配置使用已核對的既有識別碼與簽署資產，並在 Archive 前比對 `xcodebuild -showBuildSettings`、Expo config 及商店記錄，缺值或不一致即停止。只切換 `APP_ENV` 或只新增 `ios.buildConfiguration: Release` 不能解決目前兩個 configuration 都指向 `.dev` 的問題。[Expo 原生專案變體說明](https://docs.expo.dev/build-reference/variants/#in-an-existing-react-native-project)

## 登入與審查帳號

啟動後顯示 Campus One 登入頁，選擇「前往登入」進入「學校登入」。個人校務資料需要使用者自己的有效帳號與學校權限。第三方登入是否可用，以正式版本的提供者設定與實測為準。

送審帳號尚未提供。送出審查前，需由有權管理帳號的人準備可合法供審查使用、且不含真實學生敏感資料的帳號，並在商店後台提供：

- 學校、登入方式及帳號；密碼透過商店的審查資訊欄位提供，不寫入 Git。
- MFA／校方驗證步驟、有效期間，以及審查期間可聯絡的人員。
- 可驗證的課程、作業、成績與角色範圍；需額外教師或店家權限的流程分別說明。
- 外部校方網站是否需要另一組帳號，以及不提供該帳號時可檢查的功能範圍。

開發用捷徑與假帳號不能充當審查帳號，也不保證可存取全部功能。

## 目前功能與審查邊界

下列內容依目前程式與局部回歸測試整理；每項仍須以待送審的簽署版本及其後端完成端到端驗證。

| 流程           | 目前行為                                                                                                                     | 不可宣稱的內容                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 課程與校務     | 依已登入帳號、學校及可取得的校方資料顯示；來源失敗需顯示錯誤或無法取得                                                       | 全校／多校資料同步皆已完成、尚未取得的成績或學分                               |
| 課程查詢與助理 | 課程搜尋使用校方目錄；助理經後端取得授權範圍內的內容，失敗不以固定推薦或預寫答案充當回應                                     | 保證回答正確、固定高評價推薦、自動完成選課或無法繞過的安全保證                 |
| 校園資訊       | 提供校園資訊、服務入口與公告；可用內容依實際來源及權限                                                                       | 即時空教室、人潮、館舍使用率或預估候位時間，除非該版本有可驗證來源             |
| 圖書館         | 館藏關鍵字查詢；提供圖書館官方館藏網站、開館資訊及資源入口                                                                   | App 已替使用者完成借閱、續借、預約或圖書館付款                                 |
| 我的借閱與續借 | 開啟校方圖書館個人帳戶頁，由使用者在館方網站登入，成功與否以館方回覆為準                                                     | 在本機更新狀態就代表校方已受理；App 內固定到期日或借閱清單                     |
| 餐廳           | 讀取所選學校的真實菜單；僅明確開放接單的店家與可售餐點能送出到店付款訂單。金額由後端核對，持久化請求識別碼用於重試及回執確認 | 線上已付款、店家已接單、固定營養／評分／消費紀錄；`pending` 只代表等待店家確認 |
| 文件列印       | 選取文件並使用裝置可用的預覽、分享或系統列印功能                                                                             | 遠端校園印表機已列印、機器即時狀態或未經正式服務確認的扣款                     |

圖書館外部頁面可能有獨立登入、服務條款及可用時間。App 只提供入口，不能代替館方保證操作結果。

## 金流與付費

**線上儲值與線上付款尚未開放。** 目前不能宣稱 Stripe、TapPay、LINE Pay、Apple／Google 內購或正式電子支付已完成整合，也不能提供虛構測試卡、付費訂閱、點數購買或退款保證。

付款頁在功能及資料權限允許時可查已存在的餘額／明細；沒有可信來源時應顯示尚無資料或錯誤，不能用假餘額代替。餐廳的到店付款訂單與線上扣款是不同流程，送單回執不等於付款成功。

餐廳下單依賴新版 `createOrder` 後端、相符的資料權限規則、實際店家及其管理者設定；目前程式與測試不能作為已部署的證明。重新啟用任何金流前，需另行提供商家契約、正式交易／回調／退款驗收與商店要求的付費資訊。

## 權限與資料揭露待核對

`app.config.ts` 宣告相機、相簿、前景位置與生物辨識用途；Android 亦列有開機通知、震動等權限。iOS 設定含位置 Always 用途文字及 `fetch`、`remote-notification` background modes。這些是目前設定，不能據此宣稱背景定位、通知到達、定時同步或任何資料保存政策已獲驗證。

送審前須以實際 IPA／AAB 的權限清單與操作結果逐項確認用途、拒絕權限的行為，以及未使用的權限／背景模式是否應移除。推播憑證、真機接收、偏好設定與拒絕後行為尚需驗收。

App Privacy／Data Safety、助理提供者的資料傳輸、帳號刪除、資料匯出、保存期限、第三方 SDK、年齡分級、使用者內容檢舉及無障礙測試，均須以目前實作與正式環境證據填寫。本文件不宣稱 WCAG／PCI／COPPA 等認證，也不新增或取代隱私政策及服務條款。

## 送審前仍缺的證據

- [ ] 同一 release commit 的簽署 IPA 與 AAB、實際識別碼、版本、最低 OS、簽署與建置紀錄。
- [ ] 正式後端版本、已啟用學校／功能、可用法律與支援網址，以及真正可聯絡的審查聯絡資訊。
- [ ] 有效審查帳號與登入步驟；最低支援 OS 和代表性真機的登入／登出／切換帳號測試。
- [ ] 真實課程、館藏、圖書館轉交、餐廳菜單／店家確認等已開放流程的端到端結果；不可用狀態亦須可理解。
- [ ] 上傳版本的權限拒絕、推播、資料安全揭露、帳號刪除與使用者內容處理驗收。
- [ ] 從待送審版本取得的商店截圖、產品名稱、繁體中文描述與實際可用功能一致。
- [ ] App Store Connect／Google Play Console 的實際提交及審查結果。未取得前維持「尚未提交／待驗證」狀態。
