# Campus One 跨模組驗收快照

核對日期：2026-11-01。程式基準：`c93b4ac3851df68f76d607af29b086030735dc55`（main）。本表由目前原始碼、既有測試入口及當次 open PR 盤點整理；沒有執行正式帳號、正式資料、原生裝置或競品比較驗收。表中的「待驗收」是下一次必須取得的證據，不能解讀成已確認的程式缺陷或已完成能力。

## 共通完成條件

- 使用者從既有導覽找到入口，完成主要操作並返回；取消、重複點擊、失敗後重試不造成重複寫入或遺失已保存資料。
- 區分讀取中、空資料、部分資料、過期資料、讀取失敗及無權限；明示來源、資料時間與可採取的下一步，不能把失敗當成「沒有」。
- 切換帳號、校園、課程或工作階段後，舊資料與晚到回應不能跨範圍顯示或寫入。
- Web 320／390px 與桌面、深淺色、200% 文字均不遮擋主要操作；鍵盤焦點、讀屏名稱及動態狀態可理解。原生 iOS／Android 的文字縮放、返回、鍵盤與讀屏另行驗收。
- 測試、CI、畫面證據須綁定精確提交。元件替身、瀏覽器轉譯及建置成功，不能替代真實資料、原生裝置或部署驗收。

## 模組與可驗收目標

| 模組 | 本次確認存在的程式入口 | 下一次驗收需要回答的問題 | 已有工作與獨立範圍 |
| --- | --- | --- | --- |
| 首頁／下一步 | [Mobile StudentTodayScreen](../apps/mobile/src/screens/StudentTodayScreen.tsx)、[Web StudentToday](../apps/web/src/components/today/StudentToday.tsx)：課表、待辦及分別重試狀態。 | 課表成功但待辦失敗時，成功來源是否可繼續用？沒有課、未連結與讀取失敗能否區分？開啟項目再返回，位置與內容是否合理保留？ | 首頁與導覽有既有 PR；先以精確 head 核對，避免重做入口。 |
| 課表／行事曆 | [PersonalTimetableScreen](../apps/mobile/src/screens/PersonalTimetableScreen.tsx)、[PersonalCalendarScreen](../apps/mobile/src/screens/PersonalCalendarScreen.tsx)、[Web PersonalCalendar](../apps/web/src/components/calendar/PersonalCalendar.tsx)。 | 跨日、月份邊界、停補課、匯入與手動資料能否分辨？返回保留月份／選日；空檢視提供下一步；匯出要清楚說明快照與範圍。 | #372 課表期間預覽／ICS；#376 校園／個人行程／課表入口，均不重做。 |
| 成績／學分 | [GradesAiFirstScreen](../apps/mobile/src/screens/GradesAiFirstScreen.tsx)、[CreditPlanningScreen](../apps/mobile/src/screens/CreditPlanningScreen.tsx)、[CreditTranscriptReviewScreen](../apps/mobile/src/screens/CreditTranscriptReviewScreen.tsx)：來源、未知分數、本機規劃與核對。 | 0、缺值、待評、未通過與重修是否分開？方案修改、草稿、跨分頁／帳號變更及失敗保存能否安全恢復？規劃不能被讀成正式畢業認定。 | #326 方案採用／復原及其他既有學分工作先核對；不恢復校務資料抓取。 |
| LMS 教材／作業 | [CrossCourseMaterialSearch](../apps/mobile/src/screens/nuni/CrossCourseMaterialSearch.tsx)、[CampusAssignmentWorkbench](../apps/mobile/src/screens/CampusAssignmentWorkbench.tsx)、[Web 課程入口](../apps/web/src/app/course/[courseId]/page.tsx)：跨課教材搜尋、部分來源與作業整理。 | 搜尋未完成與零結果是否不同？撤權或教材刪除後能否阻擋舊入口？作業送出／撤回後是否有伺服器收據，未知結果是否保留同一請求？ | #375 裝置教材收藏；其他 LMS 登入／繳交 PR 屬既有工程，不把本機展示當正式學校驗收。 |
| 通知 | [NotificationsAiFirstScreen](../apps/mobile/src/screens/NotificationsAiFirstScreen.tsx)：分頁、已讀同步失敗、讀取重試與安全導頁。 | 內容可開但已讀失敗時，是否保留未讀與重試？已載入數量是否被誤讀成全部歷史？來源、目的地權限與跨校通知是否一致？ | #373 未讀篩選／校園來源，避免修改其通知及共用 UI 範圍。 |
| 社團／通訊 | [ClubSummary](../apps/mobile/src/screens/ClubSummary.tsx)、[Web ClubAdmin](../apps/web/src/app/groups/ClubAdmin.tsx)、[Web Messaging](../apps/web/src/components/messaging/Messaging.tsx)：社團報名／取消、名單及訊息。 | 社團資格撤銷、額滿、截止、未知寫入結果與連點是否有可恢復路徑？訊息失敗保留草稿，對話離開／切帳號後不回填舊結果；Mobile 簽到及管理移交 Web 要明示。 | Mobile 社團摘要明列「簽到與管理請使用網頁版」；Web Messaging 與 #373 有交集，先核對變更。 |
| 活動／點名 | [Web EventDetail](../apps/web/src/components/events/EventDetail.tsx)、[AttendanceLiveScreen](../apps/mobile/src/screens/AttendanceLiveScreen.tsx)、[Web CourseAttendance](../apps/web/src/components/CourseAttendance.tsx)。 | 額滿／候補／取消、已結束點名、相機拒絕權限及重複簽到是否可理解？兩位教師更正同一收據、離頁後晚到回應，是否保留正確版本與稽核？ | 已有 #324／#327／#330 等點名工作；#360 實機驗收不能用模擬 smoke 取代。 |
| 訂單／付款 | [Mobile NuniFood](../apps/mobile/src/screens/nuni/NuniFood.tsx)、[Food 共用契約](../packages/shared/src/nuniFood.ts)、[啟用判斷](../apps/mobile/src/utils/onlineOrdering.ts)。 | 報價過期、店家停止接單、送出後斷線、取消及取餐憑證能否安全恢復？過期狀態不可用於確認付款／取餐；到店付款與線上扣款分清。 | #374 取餐快捷／時間範圍，避免重做。程式有功能開關，本次未查正式設定，也未開啟線上點餐或金流。 |
| 交通／地圖 | [Mobile PublicTransitExplorer](../apps/mobile/src/components/PublicTransitExplorer.tsx)、[Web TransitExplorer](../apps/web/src/components/TransitExplorer.tsx)、[MapClient](../apps/web/src/app/map/MapClient.tsx)。 | 背景更新失敗是否保留可辨識的上次資料？過期 ETA 不繼續倒數；換站與晚到回應不混用；定位拒絕／逾時仍可站名搜尋。靜態站牌、直線距離與真正導航分清。 | 此次實作為 Mobile 站牌詳情即時可見、返回原搜尋清單及外開失敗重試；地圖已有來源失敗重試與部分校園內建資料，不重做整個地圖。 |
| 匯入 | [PersonalImportScreen](../apps/mobile/src/screens/PersonalImportScreen.tsx)、[Web PersonalImportCenter](../apps/web/src/components/imports/PersonalImportCenter.tsx)：文件準備、待核對草稿、分段重試、取消及本機保存。 | 中段失敗能否保留已完成內容且不重複加入？空文件、錯欄位、超限、取消、返回及重新掛載後，來源與草稿是否一致？只有明確確認後才保存。 | #323 Web 標題列／來源對照已有 PR；本次不讀取校務資料或學生文件。 |
| AI 助理 | [CampusAssistantScreen](../apps/mobile/src/screens/CampusAssistantScreen.tsx)、[campusAssistantActions](../apps/mobile/src/features/campusAssistantActions.ts)。 | 本機模型缺失、網路失敗、停止生成及切帳號後，問題和已完成回答能否保留？資料來源／時效是否可辨識？開啟建議頁不應被稱為已完成申請或交易。 | #337 行動代理與本機模型工作先核對；不以模型回答正確的一例宣稱能力完整。 |
| 圖書／宿舍／生活服務 | [LibraryAiFirstScreen](../apps/mobile/src/screens/LibraryAiFirstScreen.tsx)、[DormitoryScreen](../apps/mobile/src/screens/DormitoryScreen.tsx)、[PaymentScreen](../apps/mobile/src/screens/PaymentScreen.tsx)。 | 正式服務入口是否屬於所選學校？外連失敗能否重試？本機備忘／洗衣計時與校方受理／設備連線是否明確區隔？使用者能否理解哪些服務尚未開通？ | 此次已發現舊 Demo 能力敘述與程式不一致，見下節；不是確認正式服務故障。 |

## 文件與能力敘述差距

以下記錄基準 main 的文件落差；本次已校正兩分鐘導覽及 Demo 的圖書館、宿舍與錢包段落，並將歷史展示索引與正式驗收分開。未逐項重驗其他舊展示情境；修正文件不得被算作功能驗收通過。

| 文件宣稱 | 可核對程式事實 | 建議驗收方式 |
| --- | --- | --- |
| [兩分鐘導覽](REVIEW_IN_2_MINUTES.md) 寫「Today → 角色入口 → 校園 → 收件匣 → 我的」五分頁。 | [README](../README.md) Mobile 段落與 [App.tsx](../apps/mobile/App.tsx) 的導覽說明是「今天／課務／生活／我」四個入口。 | 導覽文件及示範步驟與目前各角色實際可見入口逐一核對。 |
| [DEMO.md](../apps/mobile/DEMO.md) 圖書館段落寫一鍵續借、即時空位及座位預約。 | [LibraryAiFirstScreen](../apps/mobile/src/screens/LibraryAiFirstScreen.tsx) 的「我的借閱與續借」開啟館方網站；成功與否以館方回覆為準，空間預約也是正式入口。 | 將 App 內查詢、官方外連及尚未提供能力分開；不把開啟網頁當作續借／預約成功。 |
| DEMO 宿舍段落寫洗衣設備即時狀態、預約、正式報修與包裹通知。 | [DormitoryScreen](../apps/mobile/src/screens/DormitoryScreen.tsx) 明示此裝置個人紀錄；設備問題不會傳給學校，洗衣是個人倒數，並非即時空機查詢。 | 示範實際備忘、分享與校方入口；正式受理與機台連線另需真實後端證據。 |
| DEMO 完成功能清單列校園支付儲值；流程描述支付方式與安全設定。 | [PaymentScreen](../apps/mobile/src/screens/PaymentScreen.tsx) 有「校園支付尚未開通」及「線上儲值尚未開放」；[NuniFood](../apps/mobile/src/screens/nuni/NuniFood.tsx) 的送單確認明示到店付款、不會線上扣款。 | 文件寫明功能開關與當前能力；正式交易、退款及對帳須另有授權與證據，本輪不操作。 |

## 本次證據邊界與後續順序

本表只做原始碼盤點，沒有新增測試、沒有跑完整測試，沒有連接正式服務。相關既有測試可從 `StudentTodayScreen.test.tsx`、`PersonalTimetableScreen.test.tsx`、`CreditPlanningScreen.test.tsx`、`NotificationsAiFirstScreen.test.tsx`、`ClubSummary.test.tsx`、`NuniFood.test.tsx`、`PublicTransitExplorer.test.tsx`、`MapClient.test.tsx`、`PersonalImportScreen.test.tsx`、`CampusAssistantScreen.test.tsx` 開始；「檔案存在」不等於本次測試通過。

本次站牌詳情與文件校正的驗證另列於 PR；接續可核對社團流程中的實際操作與跨端交接，以及其餘 Demo 情境的能力契約一致性。競品研究應使用同角色、同資料、同任務與相同裝置比較任務完成率、所需步驟、錯誤恢復、無障礙及視覺可讀性，取得可重現結果前不宣稱全面超越。
