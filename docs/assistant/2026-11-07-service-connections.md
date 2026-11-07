# 助理服務接通紀錄（2026-11-07）

維護基準：本次工作樹以 `main` 的 `d155530` 為基底。本文記錄實際接通範圍、權限邊界及驗證結果，供後續整合與驗收使用。

這次將 **41 項既有服務加入共用目錄與聊天入口**，新增個人匯入成績／學分的唯讀摘要，以及 V2 的服務目錄、已同步學業紀錄工具。41 項代表可以探索與前往的服務數量；各服務能否讀取資料、能否寫入，仍取決於既有介面、登入狀態及角色權限。本次沒有建立競品評測，不能據此宣稱已超越競品。

## 1. 三種能力必須分開描述

| 層級 | 本次接通方式 | 可以宣稱的結果 |
| --- | --- | --- |
| 功能入口 | 共用服務目錄、明確開啟指令、Web 連結及手機原生導覽；V2 擴充既有 `propose_open_page` 的服務清單 | 找到入口並讓使用者選擇前往。尚未查詢該服務的私人資料，也尚未完成點名、申請、報名、下單或訊息發送。 |
| 真實讀取 | 保留既有課表、課程／作業、公告、通知、餐飲等已接通的讀取；新增個人匯入成績／學分摘要 | 只根據本次成功讀到、屬於當前帳號與學校的資料回覆，明示來源、時間、缺漏及不可用狀態。 |
| 確認後寫入 | 繼續使用既有行事曆、訂餐等提議卡與確認流程，或到目的服務確認 | 只有既有流程完成授權與確認、且後端回覆成功後，才可描述為已完成。新增目錄及學業摘要本身都是唯讀能力。 |

服務目錄中的 `access` 是用途描述，不能拿來授予帳號、校務、店家或管理員權限。進入頁面後，原服務仍負責驗證使用資格。

## 2. 共用目錄與各端導覽

唯一目錄來源為 [`assistantServices.ts`](../../packages/shared/src/assistantServices.ts)。`resolveAssistantServiceIntent` 只辨識完整、明確的功能開啟指令，例如「你能做什麼？」「打開校園社群」「開啟圖書館頁面」。資料問題、否定句、引用文字、寫入要求及多目標複合指令不會被泛用關鍵字改成導覽。實體方向問題「帶我去圖書館」也保留給原本的問答流程。

Web 的 `assistantServiceHref` 依固定服務 ID 產生路徑，驗證並保留 `schoolId`；既有 query，例如助理權限的 `section=assistant`，不會被覆蓋。平台訂單入口使用 `/food`，校園訂單維持 `/orders`。

手機導覽由 [`assistantServiceNavigation.ts`](../../apps/mobile/src/services/assistantServiceNavigation.ts) 在顯示及點擊時重新解析。下表的原生名稱是候選目的地，**仍須確認目前或父層 navigator 真正掛載該路由／分頁**。無可用原生目的地時顯示「在網頁開啟」，由使用者點擊固定的 `https://nuni.tw` 網址；不會把問題、登入憑證或帳號識別塞進網址。手機轉網頁時不轉移登入狀態或學校設定，介面會提醒在網頁確認帳號與學校。

「平台手機」欄以目前 `PreAuthStack` 搭配有效 Nuni 平台 session 為準。`NuniWorkspace(courses)` 等標記代表 `NuniWorkspace` 與對應的 `tab` 參數；「網頁」代表沒有對應的已掛載原生入口。

### 學習：14 項

| ID | 顯示名稱 | Web 路徑 | 校園手機原生入口 | 平台手機原生入口 |
| --- | --- | --- | --- | --- |
| `today` | 今天 | `/today` | `TodayHome` | 網頁 |
| `timetable` | 我的課表 | `/timetable` | `PersonalTimetable` | `PersonalTimetable` |
| `classroom` | 課程與作業 | `/classroom` | `CoursesHome` | `NuniWorkspace(courses)` |
| `calendar` | 個人行事曆 | `/calendar` | `PersonalCalendar` | `PersonalCalendar` |
| `grades` | 成績 | `/grades?tab=semester` | `Grades` | 網頁 |
| `grade-feedback` | 成績回饋 | `/grades?tab=feedback` | 網頁 | 網頁 |
| `credits` | 學分規劃 | `/credit-planner` | `CreditAuditStack` | 網頁 |
| `import` | 匯入我的資料 | `/import` | `PersonalImport` | `PersonalImport` |
| `school-courses` | 校方課程 | `/school-courses` | 網頁 | 網頁 |
| `school-lms` | 玩課雲作業 | `/school-lms` | 網頁 | 網頁 |
| `attendance` | 點名與出席 | `/classroom` | `CoursesHome`，先選課程 | `NuniWorkspace(courses)`，先選課程 |
| `leave-review` | 請假核閱 | `/leave/review` | 網頁 | 網頁 |
| `appeals` | 課程申訴 | `/appeals` | 網頁 | 網頁 |
| `teacher` | 課務申訴審核 | `/teacher` | 網頁 | 網頁 |

### 校園：6 項

| ID | 顯示名稱 | Web 路徑 | 校園手機原生入口 | 平台手機原生入口 |
| --- | --- | --- | --- | --- |
| `announcements` | 校園公告 | `/announcements` | `公告總覽` | `公告總覽` |
| `events` | 校園活動 | `/events` | `活動總覽` | 網頁 |
| `library` | 圖書館 | `/library` | `Library` | `Library` |
| `map` | 校園地圖 | `/map` | `MapV2` | `Map` |
| `bus` | 公車 | `/bus` | `BusV2` | `BusSchedule` |
| `school-info` | 學校資訊 | `/school-info` | `SchoolInfo` | `SchoolInfo` |

### 生活：6 項

| ID | 顯示名稱 | Web 路徑 | 校園手機原生入口 | 平台手機原生入口 |
| --- | --- | --- | --- | --- |
| `cafeteria` | 校園餐廳 | `/cafeteria` | `餐廳總覽` | `NuniWorkspace(food)` |
| `food` | 點餐與取餐 | `/food` | 網頁 | `NuniWorkspace(food)` |
| `orders` | 我的訂單 | 校園 `/orders`；平台 `/food` | `StudentOrders` | `NuniWorkspace(food)` |
| `dormitory` | 宿舍服務 | `/dormitory` | `Dormitory` | `Dormitory` |
| `leave` | 請假 | `/leave` | 網頁 | 網頁 |
| `lost-found` | 失物招領 | `/lost-found` | `LostFound` | 網頁 |

### 交流：6 項

| ID | 顯示名稱 | Web 路徑 | 校園手機原生入口 | 平台手機原生入口 |
| --- | --- | --- | --- | --- |
| `community` | 校園社群 | `/community` | `CampusSocialScreen` | 網頁 |
| `messages` | 私人訊息 | `/dms` | `Dms` | 網頁 |
| `notifications` | 通知 | `/messages` | `Notifications` | 網頁 |
| `groups` | 群組 | `/groups` | `Groups` | 網頁 |
| `friends` | 好友 | `/friends` | `FriendsManage` | 網頁 |
| `clubs` | 社團 | `/clubs` | 網頁 | 網頁 |

### 帳號與工作區：9 項

| ID | 顯示名稱 | Web 路徑 | 校園手機原生入口 | 平台手機原生入口 |
| --- | --- | --- | --- | --- |
| `account` | 我的帳號 | `/profile` | `MeHome` | `NuniWorkspace(account)` |
| `school-account` | 學校資格 | `/classroom/account` | 網頁 | 網頁 |
| `account-deletion` | 刪除帳號說明 | `/account-deletion` | 網頁 | 網頁 |
| `settings` | 設定 | `/settings` | `Settings` | 網頁 |
| `assistant-permissions` | 助理權限 | `/settings?section=assistant` | `AssistantPermissions` | 網頁 |
| `assistant` | 校園助理 | `/ai-assistant` | 網頁 | 網頁 |
| `merchant` | 店家工作區 | `/merchant` | 網頁 | `NuniWorkspace(merchant)` |
| `admin` | 平台管理 | `/admin` | 網頁 | 網頁 |
| `support` | 使用說明與支援 | `/support` | `Help` | 網頁 |

### 不可替換的目的地與權限邊界

- `school-courses` 指向已開通的 WOW Class／TronClass 校方來源。Firebase 群組／課班使用的 `CoursesHome` 不能代替這個入口；公開 `CourseCatalog` 也不等同本人校方課程。
- `grades` 明確開啟校方學期成績頁籤；`grade-feedback` 明確開啟課程作業／測驗評分與教師評語頁籤，不因帳號種類暗中切換。手機既有 `Grades` 映射保留；新增成績回饋入口先使用網頁。
- `admin` 是 Nuni 平台管理工作區。手機的 Firebase `AdminDashboard` 是校園管理用途，兩者不可混用。
- 校園的 Firebase `MerchantHub` 與 Nuni 店家工作區不是相同授權範圍，不能僅因名稱相似就互相導向。
- `attendance` 只先開啟課程選擇，不會自動送出點名、宣稱已到課，或猜測應操作哪門課。
- 新增的成績回饋、請假核閱、課程申訴、課務申訴審核、玩課雲作業、校園助理、刪除帳號說明、學校資格共 8 項，尚未指定經確認的原生映射，均使用固定網頁。刪除帳號入口只開啟說明，不執行刪除。「點餐與取餐」在平台手機沿用已驗證的 food workspace；校園手機及未掛載該 workspace 時使用 `/food` 網頁。
- 平台帳號的私人服務不會借用 Firebase 分頁。訪客只使用已掛載的公開原生入口與登入入口；私人資料仍需目的服務驗證。
- 未知服務 ID、`__proto__`、`constructor`、任意 URL 及帶有自行指定 `href` 的物件不會成為手機導覽目的地。

## 3. 個人匯入成績與學分：來源及限制

[`importedAcademicSummary.ts`](../../packages/shared/src/importedAcademicSummary.ts) 提供窄範圍意圖解析、資料驗證及固定格式摘要。可查詢「查我的匯入成績」「查看我的匯入成績」「查我匯入的學分紀錄」，也可使用明確的學年度與學期。其他人的紀錄、GPA、已修得學分、畢業資格、模糊的相對學期或複合讀寫要求，不會由本機解析器冒充已完成的學業查詢。

### 三種來源不可混稱

| 使用端 | 實際資料來源 | 帳號與學校範圍 | 更新時間的意義 |
| --- | --- | --- | --- |
| 手機直接查詢 | `snapshotPersonalImports` 讀取這台手機的個人匯入 ledger | `nuni:${accountId}` 或經驗證的 `firebase:${uid}`，加上 `schoolId` | `checkedAt`／`fetchedAt` 是這次查閱時間，不能稱為校方更新時間。沒有來源更新時間時不自行補造。 |
| Web 直接查詢 | `readPersonalImports` 讀取此瀏覽器保存的個人匯入紀錄 | 既有 `platform:…` 或 `school:…` owner namespace，加上 `schoolId` | 同樣清楚區分查閱時間與資料更新時間；沒有重新查詢校方成績。 |
| V2 後端工具 | 透過既有授權 adapter 讀取已同步的個人匯入 ledger | 伺服器 `binding` 的帳號／session／學校；工具參數不能指定另一個 owner | 使用 ledger 提供的 `updatedAt`，另列此次 `fetchedAt`。不保證與此裝置尚未同步的資料相同。 |

本機解析先於模型呼叫，無須下載 GGUF 或提供模型金鑰。校園即時模式中，一般「查我的成績」仍由既有校方讀取流程處理；明確指定「匯入／儲存／保存」的查詢才改讀本機紀錄。

Web 先確認登入身分再選擇助理來源：只有學校帳號時維持 Legacy；平台雲端關閉且同時有學校帳號時，也保留校方引擎。僅有平台帳號時，即使雲端關閉仍可使用本機入口。雙重登入的明確匯入查詢沿用匯入功能既有的 platform owner，普通校務查詢仍使用學校帳號；對話會隨任一相關帳號、session 或學校變更而重建。

### 摘要規則

- 保留原始成績字面值，例如 `85`、`A-`、`通過`、`待公布`；不把字母或文字分數換算成數字。
- `listedCredits` 只加總有填寫學分且沒有歧義的紀錄，不能命名成「已取得」「已通過」或「校方認列」學分，也不計算 GPA、重修採計、抵免或畢業資格。
- 精確重複的課程資料合併後保留來源線索；同學期課程資料互相衝突時標示疑義，排除於學分加總。不同學期的同門課分開保留。
- 缺成績、缺學分、重複、疑義及分頁範圍都要明示。共用摘要預設每頁 10 筆、最多 25 筆，最多處理 2,000 筆輸入；V2 工具另限制每頁最多 10 筆，預設 5 筆。
- 區分 `ready`、`empty`、`unavailable`、`invalid`。資料無法讀取或跨學校時，不可回覆「沒有成績」或把殘留資料當成成功結果。
- 輸出包含必要來源資訊，但不包含匯入來源的 `rawText`。`official` 固定為 `false`，附上個人匯入紀錄與正式採計限制。

### 帳號隔離與對話歷史

手機在非同步讀取前後驗證目前帳號、學校及取消狀態，畫面再次核對 `academicRead.owner` 與 `schoolId`。帳號切換、學校切換、session 到期或取消後，不套用晚到的回覆；舊服務按鈕也不能繼續操作。原有 `ownerUid` 遮蔽規則維持。

手機的 `saved-academics` 回覆及其前一則問題會排除於後續模型歷史。Web 的本機回覆，以及 V2 含有 `get_imported_academics` 步驟的問答，也會排除於後續模型歷史。V2 本次工具摘要仍沿用既有遮蔽流程，最終成績內容由驗證後的摘要直接格式化，避免模型臆測分數或畢業結論。

手機學業摘要上的「匯入我的資料」按鈕會帶入 `PersonalImport` 的 `{ kind: 'grades' }`，讓使用者回到目前帳號的成績檢視／匯入介面。一般服務開啟指令不會自行讀取成績。

## 4. V2 工具與既有確認機制

實作位置是 Web 伺服器的 [`assistantV2/tools.ts`](../../apps/web/src/lib/nuni/assistantV2/tools.ts)、[`actions.ts`](../../apps/web/src/lib/nuni/assistantV2/actions.ts) 與 [`runner.ts`](../../apps/web/src/lib/nuni/assistantV2/runner.ts)。本次沒有建立另一套帳號授權或確認 API。

| 工具 | 本次變更 | 邊界 |
| --- | --- | --- |
| `list_campus_services` | 新增；可指定服務 ID 或以 `offset`／`limit` 取得目錄，每頁最多 6 項，附 `nextOffset` | 回傳固定目錄、來源、學校與入口描述；不代表已連到私人資料。 |
| `get_imported_academics` | 新增；讀取目前授權 ledger，支援明確學年度、學期與分頁 | `getLedger` 重新核對學校，共用摘要再驗證紀錄。工具只接受查詢條件，不接受任意帳號或學校覆寫。 |
| `propose_open_page` | 擴充既有工具的 `page` allowlist 至共用 41 項服務 | 仍產生既有提議卡；不接受模型任意提供內部或外部 URL。特定課程／訂單入口仍依既有範圍檢查處理。 |

既有 `propose_personal_event`、`propose_study_plan` 與 `propose_food_order` 流程維持。寫入前仍需使用者確認提議卡，確認端驗證簽章、綁定的帳號／session／對話／學校、參數摘要、5 分鐘期限、撤銷／被新提議取代狀態及執行來源。

行事曆寫入仍受開關、ledger revision、mutation ID 與衝突檢查約束；重複確認不應產生第二筆相同行程。訂餐仍重新核對可用門市範圍及當前價格；既有設定要求付款或無法直接送單時，確認結果會導向原服務頁面。功能目錄不會放寬這些條件。

V2 的既有訂單入口改用實際 FoodWorkspace 的 `/food?schoolId=…&tenant=…&order=…`。tenant 只能從本次已讀取、已授權的唯一訂單推得，不接受模型提供；不同 realm 出現相同訂單 ID 時拒絕猜測。tenant 連同其餘卡片參數一起受簽章約束。

直接在前端點選固定服務連結只是導覽，不經資料寫入；它與 V2 的後端簽章提議卡是兩條既有用途不同的路徑。兩者都不應在尚未取得操作結果前顯示「已申請」「已下單」「已發送」。

## 5. 已取得的驗證結果與待完成事項

以下是本次開發工作已觀察到的結果，不等同目前 HEAD 已完成全量重新驗證。後續整合以實際 CI 結果補記，不把資源中止列為通過。

| 範圍 | 已取得結果 | 說明 |
| --- | --- | --- |
| 手機三個新 focused suites | **49 / 49 通過** | 使用最終 41 項目錄與平台 food 映射，同一次執行通過：feature integration 16、navigation 29、reply UI 4，約 10.6 秒。 |
| 共用服務目錄 | **55 / 55 通過** | 最新 41 項目錄；41 個服務 ID、40 個唯一 href，完整覆蓋既有 `CAMPUS_SERVICES` 的 37 / 37 個 href。 |
| 共用學業摘要 | **99 / 99 通過** | 包含來源、學校隔離、無效／不可用、重複疑義、字面成績及窄範圍解析。 |
| 手機 scoped TypeScript | **4 個 runtime 修改檔，0 diagnostics** | 檢查實際相依型別及這 4 個檔案的診斷；不是完整手機專案 typecheck。 |
| 手機 changed-file ESLint | **0 errors** | 8 個修改／新增檔；`CampusAssistantScreen` 有 2 個既有 hook dependency warnings。 |
| Web V2 回歸 | **16 suites，187 / 187 通過** | root 回報的最後一輪結果；不重複累加先前重跑次數。 |
| 獨立 V2 preview／模型失敗復原 | **2 / 2 通過** | `scripts/nuni-assistant/v2.test.mjs`；保留原有四輪復原及預算斷言，沒有放寬測試。 |
| Web UI／入口回歸 | **8 suites，118 / 118 通過** | root 回報的最後一輪結果。 |
| 既有步行導航／來源卡片回歸 | **1 suite，15 / 15 通過** | 使用實際後端 card builder，驗證學校範圍、座標及固定步行網址契約。 |
| Web scoped TypeScript | **25 個修改檔，0 diagnostics** | 分為 server 6、UI 8、client 11 個檔案，包含修改的測試；使用實際相依型別、Next 樣式宣告及各組必要 ambient types。不是完整 Web typecheck。 |
| 共用套件 TypeScript／ESLint | **完整 shared typecheck 通過；4 個修改檔 lint 0 errors** | 使用鎖定的 Node 22 與本專案相依套件。 |
| Web changed-file ESLint | **25 個檔案，0 errors** | 保留 QuickCampusEntry 既有測試的 1 個 any warning。 |
| 完整 Web／Mobile 型別與 lint | **首版 CI 通過** | `b8e62ab` 的 GitHub Lint & Type Check 已成功；最新提交仍須以對應 Checks 為準。本機完整 Web typecheck 曾因資源限制中止。 |
| 瀏覽器視覺驗收 | **未完成** | 本次兩次瀏覽器連線嘗試逾時，沒有取得可用的視覺驗收證據。 |
| 手機真實 PreAuth 導航新增案例 | **首版 Mobile Agent CI 通過** | 既有導航 suite 及新增 2 個案例已在 `b8e62ab` 的 Mobile Agent Checks 成功；本機載入大型 suite 時 exit 137，沒有把該次中止列為通過。 |
| 完整手機回歸、真機視覺驗收 | **待 CI／人工驗收** | focused tests 不能替代這些結果。 |

手機新增的兩個真實導航案例分別驗證「服務目錄 → 個人行事曆 → 課程工作區」及「本機成績回答 → 成績匯入檢視頁」。既有 [`mobile-agent-regression.yml`](../../.github/workflows/mobile-agent-regression.yml) 已包含此真實導航 suite，本次另加入以下三個 focused suites；未調降 CI 的權限或失敗條件：

- [`assistantServiceIntegration.test.ts`](../../apps/mobile/src/__tests__/features/assistantServiceIntegration.test.ts)
- [`assistantServiceNavigation.test.ts`](../../apps/mobile/src/__tests__/services/assistantServiceNavigation.test.ts)
- [`AssistantServiceReply.test.tsx`](../../apps/mobile/src/__tests__/AssistantServiceReply.test.tsx)

共用回歸位置：[`assistantServices.test.cjs`](../../packages/shared/tests/assistantServices.test.cjs) 與 [`importedAcademicSummary.test.cjs`](../../packages/shared/tests/importedAcademicSummary.test.cjs)。

上述本機不重複計數的回歸共 **525 項通過**；不包括遠端 CI 的其他測試。兩個共用測試檔也已加入一般 CI 的 Web 測試工作，防止後續服務目錄與跨端來源契約退化。

首版 CI 的獨立模型復原案例發現：把新增領域說明放進所有問題的系統提示，會壓縮原本的重試預算。因此改為只有選到相關服務／學業工具時才加入該領域說明，維持原本的呼叫次數及成本限制。原案例的四輪復原斷言與 V2 的 187 項回歸均重新通過。

## 6. 跨端人工 QA 清單

以下核取方塊表示待人工驗收，不能以已有單元測試直接勾選。至少分別使用校園帳號、Nuni 平台帳號與訪客；私人紀錄測試應準備兩個帳號、兩個學校及彼此不同的測試資料。Web 需包含桌面及窄螢幕，手機需在實際原生環境確認導覽。

### 入口及可用性

- [ ] Web 舊版助理、V2 助理、手機校園助理及平台課表助理都能找到服務目錄；41 項沒有重複、遺漏或不存在的目的頁面。
- [ ] 沒有下載手機模型、沒有模型金鑰，或 V2 capability 不可用時，已提供的本機服務入口仍可使用；本機查詢沒有意外送出模型請求。
- [ ] 輸入「打開校園社群」「開啟圖書館頁面」「開啟助理權限」能到正確入口；一般「設定」與「助理權限」不互相混淆，學校與既有 query 都保留。
- [ ] 「我還有哪些作業待交？」「現在有課嗎？」「查今日公告」「帶我去圖書館」仍進入適用的資料查詢／方向流程；否定句、引述、未知 URL 及複合寫入句不會誤開頁面。
- [ ] 手機平台頁使用 `Map`／`BusSchedule`，校園頁使用適用的 `MapV2`／`BusV2`；跨分頁後能返回助理，沒有 unhandled navigation action。
- [ ] 平台訂單到 food workspace 或 `/food`；校園訂單到 `StudentOrders` 或 `/orders`。學期成績與課程評分使用各自明確頁籤；TronClass、平台管理及店家頁不會被名稱相近的其他系統頁面取代。
- [ ] 網頁 fallback 只在明確點擊後啟動，顯示瀏覽器與登入提示；快速重複點擊、開啟失敗及重試不造成重複操作或卡住。
- [ ] 窄螢幕、長服務名稱、深色模式、螢幕閱讀器及鍵盤操作下，分類、按鈕、回覆及錯誤內容可讀可達，沒有水平溢出或遮住輸入列。

### 學業紀錄及隱私

- [ ] 帳號 A 在學校甲的查詢只顯示 A／甲的資料；登入 B、切換學校、登出或 session 到期後，舊回覆及舊按鈕不會暴露另一個範圍。
- [ ] 在讀取途中切換帳號／學校或取消，晚到結果不出現在新對話；手機目前帳號及學校的 metadata 一致。
- [ ] `85`、`A-`、`通過`、`待公布` 等字面值保持原樣；缺學分、精確重複、同學期衝突與不同學期重修能清楚區分。
- [ ] 查閱時間與來源更新時間分開；本機、此瀏覽器及已同步 ledger 的文案符合真實來源，沒有「校方最新」的誤稱。
- [ ] 儲存區損毀、禁止存取、跨校紀錄及來源不可用時，不會顯示成功／空資料誤導；輸出不含 `rawText`。
- [ ] 校園即時模式的一般成績問題仍使用既有校方來源；明確指定匯入資料時才顯示個人匯入紀錄。未推算已得學分、GPA 或畢業資格。
- [ ] 手機從摘要開啟匯入頁時，進入 `kind=grades` 並維持當前帳號；後續一般聊天請求的模型歷史不含先前本機／V2 學業回覆。

### V2 提議與寫入

- [ ] 目錄分頁能取得後續服務；未知服務、任意 URL、跨學校／帳號條件與不允許的工具欄位都不會被接受。
- [ ] 未確認行事曆或訂餐提議前沒有寫入；取消、過期、換帳號、換學校、修改卡片參數或被新提議取代後，舊卡無法執行。
- [ ] 重複確認不重複新增行程；ledger revision 改變、價格改變、門市權限不足或付款／送單能力未開通時，保留原有阻擋及回到服務頁的行為。
- [ ] 開啟請假、點名、社群、私訊、店家或管理頁，只呈現原服務真實結果與權限要求；沒有因目錄新增而多出任何隱含寫入或管理權限。

## 7. 後續整合時的檢查點

調整助理入口、快速動作、公共 navigator 或帳號 session 的變更，應一起核對共用目錄、Web 連結與手機映射。不要只增加路由字串就認定能力已接通，也不要把另一個 provider 的同名工作區視為相同服務。

若後續要讓某項入口升級為真實讀取或確認後寫入，需另行定義來源、帳號／學校範圍、不可用狀態、結果證據及操作確認，並新增對應的整合回歸。這份 41 項清單不會自動授予這些新能力。
