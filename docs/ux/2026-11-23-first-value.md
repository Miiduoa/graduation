# 首頁第一步與回訪入口

日期：2026-11-23（Asia/Taipei）

開發基準：`15bdca30796646d93263ddf8442eca248aa196b4`

## 要解決的問題

首頁原本只向訪客提供課表匯入與公開服務捷徑。已登入但尚無課表、課程的帳號，反而看到分散的空資料提示；開始使用後，地圖、公車、餐廳與圖書館入口也會消失。使用者必須再次找入口，才能做原本就能完成的事情。

另一個問題是資料可信度：課程清單可以比作業先回來，這時空的暫存作業清單不代表沒有作業。把這個過渡狀態顯示成「沒有作業」，會讓使用者無法判斷首頁是否可靠。

本輪改善聚焦在三件事：打開就有明確下一步、已知任務保持可操作、下次回來能直接找到常用服務。

## 使用者可見的變化

| 情境 | 行為 |
| --- | --- |
| 已登入，課表與課程確認為空 | 顯示一個課表主行動、手動建立的選項，以及加入 nuni 課程與行事曆的入口；保留通知，合併重複的空資料卡。 |
| 尚未選校園 | 主行動先前往選校園流程；公開服務使用 `campus=all`，不帶入個人儲存範圍。 |
| 已有作業或即將上課 | 保留原有優先順序與繳交入口；公開服務列放在課業之後。 |
| 已有課表但今天沒課 | 保留本週課表，不重新要求匯入。 |
| 課程已回來、作業尚未確認 | 顯示正在確認作業與期限，不宣稱沒有作業，也不推導新帳號引導。 |
| 同帳號已有完整資料，回到分頁更新 | 保留既有引導、課程入口與服務連結的 DOM 和焦點，更新狀態另行呈現。 |
| 課表或作業讀取失敗 | 原本的錯誤、重試按鈕與已知作業仍可操作。 |
| 想從主畫面回訪 | 設定的一般分頁提供固定加入入口；支援的瀏覽器可主動安裝，其餘提供加入方式。 |
| 曾選擇暫時不用 | 尊重原本關閉提示的選擇；仍可主動到設定操作，不定期重彈。 |

## 狀態與來源規則

`HomePage` 使用各課程來源的完整回應時間 `updatedAt` 判斷 `courseDataResolved`。初次的局部課程回呼不設定這個時間，必須等目前帳號的所有來源都至少完整回應一次，才可在背景更新期間沿用已確認的引導。來源仍使用原有帳號隔離與權限失效處理。

登入後引導只在沒有已知課堂與作業、課表狀態確定為空或尚未選校園，而且沒有作業錯誤時顯示。有任何已知任務時，任務維持優先。是否曾完整讀取與是否正更新是兩個不同狀態，避免重新進入畫面時拆掉正在聚焦的入口。

課表按鈕使用個人課表的 `importHref`／`timetableHref`。公開服務、加入課程與行事曆使用瀏覽校園的 `campusSearch`；兩個校園不同時不互相覆蓋。沒有新增首次登入旗標、帳號資料搬移或首頁 API 請求。

## 加入主畫面的處理

根層的 `PWAInstallObserver` 沒有畫面，只保存瀏覽器提供的一次性安裝事件。首頁即使不使用 `SiteShell`，也能先收到事件，之後進設定接續操作。

- 被動提示只出現在生活服務 `/life`，跟隨實際路由立即隱藏。
- 設定入口使用 `/settings?section=general` 並保留瀏覽校園。
- 同一事件只消耗一次；快速連點、多處入口、換頁與晚到的 Promise 都共用同一狀態。
- 接受原生提示只表示安裝要求已送出；收到 `appinstalled` 或 standalone 訊號後才顯示已加入。
- 取消、原生提示失敗及瀏覽器儲存封鎖都有明確處理；關閉提示不會關閉設定內的手動入口。
- 不要求通知權限，不新增套件、分析追蹤或伺服器資料。

安裝能力依瀏覽器提供的事件決定。參考 [Google 的安裝提示文件](https://web.dev/learn/pwa/installation-prompt)、[Apple 的 Safari 加入主畫面說明](https://support.apple.com/zh-tw/guide/iphone/iphea86e5236/27/ios/27)及 [Chrome 網頁應用程式說明](https://support.google.com/chrome/answer/9658361?hl=zh-Hant)。

## 驗證方式

專項測試包含首頁資料分段回應、背景更新焦點、帳號與校園來源、通知保留、原生安裝事件生命週期及設定整合。

```sh
pnpm --filter web test \
  src/components/today/TodayWelcome.test.tsx \
  src/components/today/StudentToday.test.tsx \
  src/components/today/StudentToday.schoolNavigation.test.tsx \
  src/components/today/TodayUnreadNotifications.test.tsx \
  src/components/today/TodayUnreadNotifications.schoolNavigation.test.tsx \
  src/app/page.test.tsx \
  src/components/PWAInstallBanner.test.tsx \
  src/app/settings/page.test.tsx \
  src/app/layout.test.tsx

node scripts/qa/first-value/build.mjs
python scripts/qa/first-value/check.py
```

`First Value Browser` workflow 使用產品元件與 CSS，替換帳號、路由及資料邊界；輸出測試 JSON、每個來源檔的 SHA-256 與實際截圖。涵蓋手機與桌面寬度、明暗模式、200% 文字、減少動態、鍵盤焦點、互動尺寸及水平溢位。詳見 [驗收範圍](../../scripts/qa/first-value/README.md)。

合成助理插槽只量測同範圍的子元件連續性。這些測試不代表已完成真實帳號匯入、iOS 分享面板、原生系統安裝或正式環境使用者驗收。合併、部署及每次測試的最終狀態以 PR 對應提交的檢查結果為準。

## 使用意願的成效判斷

本輪沒有取得真實使用者的轉換或回訪資料，不宣稱已提高留存率。上線後應觀察使用者是否更容易完成第一個有效課表、能否直接開啟下一堂課或待交作業，以及後續是否再次完成這些有用的操作。課表完成應以有效資料實際保存為準，不能用按下匯入按鈕代替。

常用服務與加入主畫面的入口，是降低再次使用成本的產品假設；是否改善實際回訪，仍應以真實使用結果判斷。
