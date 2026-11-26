# 兩分鐘認識 nuni

nuni 是整合課表、課業與校園服務的 AI 校園助理。這份導覽給第一次接觸專案的評審、面試官與開發者，先看一個學生任務，再追到操作與實作證據。

## 先看一個完整任務

**學生要準備作業，但還沒決定什麼時候做。**

手機助理先從有權使用的課程整理作業與測驗。學生在即時計畫中選一份作業，助理重新核對來源，再依已存課表與個人行程找出三十分鐘的候選時段。學生選擇時間、看過原作業與期限，按下確認後才建立準備行程。

寫入之後會重新讀回同一筆行程，核對成功才顯示回執；學生可以直接開啟該行程或原作業。若結果不明，留下原操作讓使用者核對，避免重複建立。

這條路徑可以在下列文件與程式對照：

| 想確認的事           | 對應內容                                                              |
| -------------------- | --------------------------------------------------------------------- |
| 畫面長什麼樣子       | [操作截圖與來源](SCREENSHOTS.md)                                      |
| 實際要怎麼操作       | [手機展示流程](../apps/mobile/DEMO.md)                                |
| 計畫怎麼接到確切作業 | [計畫接續作業準備](assistant/2026-11-08-plan-coursework-execution.md) |
| 空堂怎麼算、何時重查 | [找準備時間](assistant/2026-11-08-coursework-free-time-execution.md)  |
| 怎麼知道行程真的保存 | [執行與回執](assistant/2026-11-07-verified-execution.md)              |
| 重開 App 後如何查核  | [手機操作恢復](assistant/2026-11-08-mobile-task-recovery.md)          |

保存讀書計畫、勾選個人進度、建立準備行程與繳交作業各有自己的狀態。歷史計畫不是新的寫入授權；開始新操作前要重新核對目前資料。

## 再看系統如何接起來

Web 使用 Next.js，手機使用 Expo／React Native，兩端共用 TypeScript 契約與部分業務規則。平台課程與帳號經 nuni API 處理；既有校園功能另使用 Firebase 及校方連線。

| 程式位置                                                                                    | 可以看到什麼                           |
| ------------------------------------------------------------------------------------------- | -------------------------------------- |
| [`apps/mobile/src/screens/`](../apps/mobile/src/screens/)                                   | 手機助理、課業計畫、確認與結果畫面     |
| [`apps/mobile/src/services/`](../apps/mobile/src/services/)                                 | 作業來源解析、可用時段、行程執行與恢復 |
| [`apps/web/src/lib/nuni/assistantV2/`](../apps/web/src/lib/nuni/assistantV2/)               | Web 助理的工具、提議、確認與執行       |
| [`packages/shared/src/assistantServices.ts`](../packages/shared/src/assistantServices.ts)   | 跨端服務目錄與固定入口                 |
| [`packages/shared/src/assistantExecution.ts`](../packages/shared/src/assistantExecution.ts) | 實際執行回執的共用契約                 |
| [`deploy/nuni-api/`](../deploy/nuni-api/)                                                   | 平台 API 的來源與重建方式              |
| [`backend/`](../backend/)                                                                   | Firebase Functions、資料權限與測試     |

深入看 [架構總覽](ARCHITECTURE_OVERVIEW.md) 與 [帳號及學校資格](ACCOUNT_AND_SCHOOL_ACCESS.md)。公開選校、平台登入、課程成員、校方職務是不同的授權範圍。

## 最後看證據與實際開放範圍

- **網站**：[nuni.tw](https://nuni.tw/) 提供公開訪客入口；私人課程與服務依登入資格開放。
- **截圖**：[圖庫](SCREENSHOTS.md) 區分線上公開頁面與合成資料的正式元件展示，並記錄擷取日期、來源版本及尺寸。
- **測試**：[GitHub Actions](https://github.com/Miiduoa/graduation/actions) 按提交查看 CI、CodeQL 與實際觸發的原生／助理回歸；[測試紀錄](TESTING_EVIDENCE.md) 是各次驗證的歷史證據。
- **版本**：[平台發布紀錄](PLATFORM_RELEASE.md)、[商店發布紀錄](STORE_RELEASE.md) 與 main 分開判讀。已合併程式不自動代表所有校園或裝置已上線。

目前能直接描述的成果，是從來源資料、明確確認到核對結果的任務流程。服務目錄列出的入口，仍由目的服務判斷能讀什麼、能做什麼；三維建模、讀書白板與 NFC 等獨立開發分支，以各自 PR 的合併與驗證結果為準。

其他操作、設定與工程文件可從 [文件目錄](README.md) 接著閱讀。
