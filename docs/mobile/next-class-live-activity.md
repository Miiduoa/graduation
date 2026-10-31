# 下一堂課即時動態

沿用 #353 的 `NextClassSnapshot`、App Group 資料橋接、課表變更訂閱與 Widget timeline；沒有另一份時段解析。原本桌面／鎖定畫面小工具保持原有 timeline。即時動態共用同一個 Widget Extension，ActivityAttributes 從本機模組複製到 extension，各自編譯，沒有反向 target 相依。extension 嵌入仍位於 resources 之後、處理 App bundle 的腳本之前。

## 使用方式

啟用 widgets 功能的 iOS 安裝包，可從「我的 → 設定」開啟「下一堂課即時動態」。預設關閉；需使用者主動開啟且系統允許。iOS 16.2 以上提供鎖定畫面，支援動態島的機型另有精簡與展開版。舊系統、缺少原生模組、Android 與 Web 隱藏此入口。系統關閉權限時，畫面提供系統設定入口，並提示仍可在 App 課表查看。

開始範圍為下一堂課上課前一小時至下課，內容包含課名、教室、上課倒數、時段重疊提醒、課程直達及教室搜尋。課程入口沿用快照的課表深連結；找教室會帶入原教室文字與學校 ID，在目前學校地圖搜尋，不把未驗證的教室轉成座標或導航目的地。學校不符或中途切換學校會清除搜尋。

App 啟動、回到前景、匯入或手動改課時，原本快照寫入佇列接著同步即時動態；前景每 30 秒僅重新挑選快照中的下一堂課，不重新載入資料、不連網。相同堂課更新，換堂先結束舊動態再開始新動態。無近期課、快照失效、登出、帳號／學校切換與關閉功能都會結束。舊帳號未完成的讀取不能蓋回清除結果。使用者開關保存在本機，不加入快照，登出清除課程但保留裝置偏好。

## 本機執行限制

**不保證 App 從未開啟時自動產生新動態。** 不需要推播伺服器、付費服務或常駐主機。App 可執行時，以本機計時結束動態並立即移除；下課時間同時設為 ActivityKit 的 staleDate，系統將內容標示過期時，鎖定畫面與動態島只顯示下課提示，移除課名、教室與教室入口。App 被暫停／強制關閉時，本機計時不保證準時執行，staleDate 也不是系統自動結束 API；系統過期畫面的刷新時間由 iOS 決定，不能保證精準到秒。再次開啟 App 會核對並清除過期動態。若要保證 App 完全不執行時準時移除，需要另一種系統執行機會或推播，不在本次本機方案承諾內。

過期與結束機制依據 [ActivityKit 顯示與更新文件](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) 及 [結束動態文件](https://developer.apple.com/documentation/activitykit/activity/end(_:dismissalpolicy:))。

原生內容不超過 4KB。新原生方法需要新安裝包，已更新 runtimeVersion，舊原生安裝包不應接收這版更新。

## 驗證

合成資料的 Mobile 測試涵蓋：快照轉內容、一小時邊界、上課／下課、過期快照、改教室更新、登出與舊 revision 清除、原生方法缺席、主動開關、系統權限關閉退路、回到前景重查權限、Android／Web 隱藏、教室搜尋的跨校隔離。原生設定測試涵蓋既有／全新 target、重複生成、同一份 Attributes 來源與嵌入順序。

已通過相關 Mobile 6 組／79 項測試、原生設定 7 項測試、`pnpm typecheck`、`pnpm lint` 與 `git diff --check`；lint 有既有警告，沒有錯誤。

本次 Linux 環境可跑 Expo iOS prebuild（`--no-install`），不載入環境檔，不下載 Pods。沒有 Xcode／iOS SDK，尚未編譯 Swift 或執行模擬器／實機驗收。

合併前需用既有簽署環境測試：iOS 16.2 無動態島機型與較新動態島機型，各跑開始、改教室、下課、登出、關閉系統權限及切帳號；另測 App 在背景／被強制關閉後的 stale 畫面。確認過期時不顯示教室、兩個連結正確，並檢查完整 Xcode build 沒有循環相依。

## 回滾

關閉 widgets 功能可停止分享並清除動態；單一使用者也能關閉即時動態開關。若需程式回滾，還原本次提交並重建 iOS 安裝包，恢復原 runtimeVersion；不要把含新原生方法的更新送到舊 runtime。已安裝版本的動態需先在 App 中關閉或由系統移除。
