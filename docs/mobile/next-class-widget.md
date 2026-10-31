# 下一堂課小工具

小工具讀取 App 已儲存的個人課表與已確認匯入紀錄；不直接連線學校服務。沿用今日課表的學期選擇、學校節次與去重規則，使用台北時區。畫面標示「週課表」，不推測校方假日、停課或學期結束日期；沒有日期範圍的週課表仍須由使用者自行核對。

快照只含課名、時段、教室、課程識別碼及直達連結，不含帳號、權杖、原始匯入文字。登入、換校、匯入編修、手動保存及回到前景時更新；切換帳號、登出或關閉功能旗標先清除 App Group，再要求重新載入。寫入佇列與版本檢查阻止舊請求覆蓋清除結果。讀取失敗保留同帳號最近快照的原更新時間；七天後顯示需更新，不再顯示過期課名與教室。

預先提供七天的上課、下課、午夜、到期節點，不依賴每分鐘背景工作。下一堂可能在隔天或週末之後；今天無課時仍說明下一堂。無法放入時間的課程不會被誤稱為完整空堂。重疊課程標示需核對。點擊後開啟目前帳號與學校的課表，顯示該課與教室；刪除或換校後的舊連結不會顯示快照中的舊內容。教室是使用者保存的文字，沒有座標時不推測地圖位置。

## 原生建置

- `src/widgets/expo-widget-plugin.js` 會複製 Swift、建立編譯 phase、Extension dependency 與 appex 嵌入，重跑不會增加 target。`ios-widget/CampusWidget.swift` 是來源；已提交的 `ios/CampusWidgetExtension` 供既有原生建置使用。
- App Group 為 `group.<App bundle ID>`，Extension bundle ID 為 `<App bundle ID>.widget`。EAS 設定宣告 Extension，使建置前可以準備兩個 target 的簽署。原生模組透過 Expo 本機模組自動連結；Mac 建置先執行 pod install。
- 原生 target 固定存在，功能旗標只控制資料分享；既有正式版與預覽版旗標仍預設關閉。驗收建置以 `EXPO_PUBLIC_FEATURE_WIDGETS=true` 啟用；預覽／正式設定仍須提供既有 `EXPO_PUBLIC_RELEASED_SCHOOL_IDS` 核驗學校清單，停用會清除共享快照。正式版開關調整屬發行決策，這次沒有部署。
- 正式版準備腳本同時改寫兩個 target、兩份 entitlement 與群組設定。正式版 runtime 已更新為 `campus-one-native-widget-2`，需新安裝包；不能只向舊安裝包傳送更新。

## 驗證與限制

本機單元測試涵蓋快照內容、學校與學期、課前／課中／課後、跨日與週末、無課、資料不完整、過期、課表變更、帳號切換、登出與延遲寫入。隔離目錄已通過不載入環境檔、跳過 Pods 安裝的 iOS prebuild；未提供地圖設定時也可產生原生專案。原生設定測試涵蓋 target 嵌入、來源路徑、重跑、正式版群組同步及發行準備流程。測試只使用合成資料。

仍需 macOS CI 編譯 Swift、安裝 Pods、驗證 provisioning、Extension 與主程式版本相同及 archive。實機需驗收桌面小／中尺寸、鎖定畫面三種尺寸、深淺色／大字體、冷啟動與前景點擊、飛航模式、七天到期、改課與登出後重載。系統控制重載時機；清除共享儲存會立即提出重載要求，但不能保證系統已快取的畫面在固定秒數內消失。

回滾可先關閉 `EXPO_PUBLIC_FEATURE_WIDGETS` 並重新建置，使 App 清除共享資料；若要移除 Extension，完整還原本變更並重建原生安裝包，勿將舊 runtime 的更新送至新安裝包。

參考：[WidgetKit 更新與預算](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date)、[Expo Extension 簽署宣告](https://docs.expo.dev/build-reference/app-extensions/)。
