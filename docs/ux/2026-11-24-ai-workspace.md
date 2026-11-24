# nuni：以任務為中心的 AI 工作區

日期：2026-11-24

## 目標與版本依據

使用者希望 nuni 像一個能理解目標、接住前後文並協助完成事情的產品；動機來自近期使用 ChatGPT 時感受到的 AI 存在感與流暢流程。本設計是對 nuni 現況的產品判斷，不代表 OpenAI 內部設計或未公開做法。

既有助理已具備資料查詢、跨服務任務、待確認操作與結果讀回。這一輪優先修正入口、草稿與對話分散的問題，讓這些能力能在日常操作中被找到並持續使用；不重新建立一套權限或執行引擎。

| 版本依據 | 精確版本與用途 |
| --- | --- |
| 開始查核時的 main | `7232919a8cc68ce01a2eaba9704268ddf3924bc0` |
| 工作區候選原先納入的 main | `7953ae4400295998a7d69dd2e017d53ef97e6160`；含 #746 依賴修正 |
| 既有整合基底 #768 | `fd9fd408f08177b59fb9c9c2954f61fdaab1a329`；含既有跨功能、角色與安全邊界 |
| 本輪納入 #783 | `e664a72ee80472a3d1d85598c895f89de0638b28`；含雙語服務搜尋與訪客／身分隔離修正 |
| 本輪工作區增量的整合基底 | `f74d799998b265e4d185af30dfd4b222e0c6676b`；同步上述 `7953ae44`，保留 #768、#783 原始祖先，仍作為本輪工作區變更的比較基準 |
| 追加 main 前的已驗證工作區候選 | `5514729b5a246fc38dbbe25f69c19ceb107ffcbf`；檔案樹 `3ee34cc1f21aeb57a1d35c7f051826c4cdc37d1b` |
| 課程時效整合納入的 main | `5e82f068d9804baaede6e9d5ce59dedd418dd2f4`；#749 官方課程資料時效提醒，是 `7953ae44` 的直接後繼，僅改 `PublicCourseSearch.tsx` 與其測試 |
| 後續採用的外部整合 | `3ceb81d17b5c7255a3ebbf61a9d50ecedd2b0dc1`；雙親為 `5514729b` 與 `5e82f068`，檔案樹 `fbaec6cac84fa827595646c29f39f3233f0a65a9`；保留其僅在有效結果存在時運作的時效時鐘 |
| 追加地圖 main 前的已發布候選 | `e89dd33ac50bcb202d3be3dab7cc2cec07b9f650`；單親為 `3ceb81d1`，檔案樹 `ff76c8c7e3e626a69de77642ff17c0ff0ffd81c6`；補課程時效測試與版本文件 |
| 後續地圖整合納入的 main | `322d42e045c4dfc23f46abe69a6da84046500e6f`；#773 是 `5e82f068` 的直接後繼，僅改 `MapClient.tsx` 與其測試，加入雙地圖服務導航與路線重驗 |

本文件記錄 `f74d7999` 基底上的工作區變更，以及其後透過 `3ceb81d1` 納入 #749 的整合。保留外部整合的課程產品實作：已接受回覆立即記錄比較時間，只有帶擷取時間的 ready 結果才啟用每分鐘、focus 與 visibility 重新評估，結果離開或元件卸載時清理。勾選課程不改寫擷取時間或匯入來源，也不額外發送查詢。課程整合的後續增量僅補測試與版本文件，不替換外部產品。其後再以 `e89dd33a` 與 `322d42e0` 整合 #773 的地圖行為，維持原工作區功能與資料範圍。原工作區瀏覽器證據記錄驗收當下的 Git 基底；實際驗證版本以 355 份來源 SHA-256 為準，包含當時未提交工作樹的修正。

`5514729b` 的 GitHub 檢查測試的是合成合併 `13bc9e8b423e1c9d902195a318dd0bbea22518cb`（`5514729b` ＋ `7953ae44`），其檔案樹與候選完全相同。main 後來前進到 `5e82f068`；舊檢查不能視為新整合提交已通過 CI。最終提交、CI、合併與部署狀態應以 PR 的精確 head 與檢查結果為準；本機驗證不表示已發布。

`e89dd33a` 的中央 CI snapshot 為 `7f54aa486947cc296eaa90ad53d0cdd8064b4939`，雙親是 `5e82f068` 與 `e89dd33a`，tree 為 `ff76c8c7`。此 snapshot 不包含後來的 main `322d42e0`；其檢查結果不能移轉為 #773 後續合併提交的驗證。

## 全產品設計原則

1. **先說想完成的事。** 首頁先給可輸入的任務入口，再提供課務與服務。範例只協助起筆；開啟入口不自動送出、不自動授權。
2. **沿著同一件事接續。** 在同一個已確認的帳號、session 與校園內，首頁、頁首及目的地頁面共用目前草稿與工作區。去看課程或地圖後能接著問，不必重述問題。
3. **情境清楚，能力有依據。** 顯示所選校園；工作情境決定建議與用語。學生、教師或店家的選項不等於取得該身分，資料存取仍由各服務核對。
4. **在需要時展開細節。** 首屏以問題與結果為主；工作情境保留一個選單，資料使用說明可展開。送到雲端的同意仍須明確勾選，不能以收合說明替代同意。
5. **把結果和下一步說準確。** 已讀到、缺漏、待確認、受阻與前往服務分別呈現。準備好購物車不是已付款，建立個人行程不是完成作業、報名或通知。
6. **中斷後能理解發生什麼。** 等待有可讀狀態；可中止的回答能停止，失敗保留原問題與已完成部分。重查沿用原任務範圍，不偷偷再次確認寫入。
7. **原功能與無障礙操作仍完整。** 熟悉的課表、圖書館、地圖、公車及管理頁繼續可直接使用。輸入法組字、鍵盤焦點、大字、深色與減少動態都屬於產品行為。

## 本輪實作

### Web：共用一個持續存在的工作區

- `CampusProviders` 內新增 `AssistantWorkspaceProvider`，由首頁入口、頁首按鈕與「接續任務」共用。對話第一次開啟時才掛載；收合保留已掛載的對話。
- 學生與教師的 Today 入口改為直接可輸入的任務區。首頁和工作區雙向共用草稿；建議問題只填入，送到助理後仍由本人確認內容再送出。
- 同校園的一般換頁、篩選與返回不清除對話。前往結果頁時收合工作區，保留來源頁的導覽條件；再次打開能接續。
- inline 對話把問題放在主要位置，只留一個工作情境選單；完整雲端資料說明放在可展開設定內，同意勾選保持可見。既有權限、待確認卡片、草稿保護、停止、重試與完整頁面流程繼續使用原引擎。
- 訪客沿用校園服務搜尋；不把公開服務入口假裝成私人課務查詢。服務搜尋的草稿可與首頁接續，工作區草稿不另寫入服務目錄的返回紀錄。
- 登入返回使用已提交網址的錨點判斷是否重開工作區，避免 App Router 更新早於 hash 訂閱時把返回意圖清掉。登入的完整頁面跳轉會清空記憶體草稿；返回仍保留服務分類／搜尋條件並開啟助理。

### Mobile：Today 的主要任務入口

- `StudentTodayScreen` 將既有 `QuickCampusEntry` 以 `workspace` 呈現放到上方，先顯示「今天想完成什麼？」；回答後可接著提問。
- 輸入列整合送出／停止，保留訪客服務搜尋、建議起筆、帳號與校園隔離、錯誤後恢復。
- 沿用 `mode: 'device'` 與原生既有能力。這一輪未把 Web V2 的所有工具移植到手機，也未建立跨原生頁面或跨裝置的永久對話。

### 狀態與中斷規則

| 發生的事 | 應有結果 |
| --- | --- |
| 開啟首頁範例或工作區 | 只填入／帶入草稿；不呼叫問答、不替使用者同意 |
| 收合或同校園換頁 | 保留對話、草稿與本次同意；停止語音聽寫／播放；重新開啟不重送問題 |
| 同一身分重新驗證 | `paused` 期間隱藏並使舊對話不可互動；入口停用且不顯示草稿。保留已確認的同校園對話實例，停止可中止的進行中回答；確認相同身分後恢復，不自動重送 |
| 暫停時收到舊草稿回呼 | 不允許寫回；也不能開啟或啟動新任務 |
| 帳號、session、校園、助理模式或有效性真正改變 | 以新的 scope 與遞增 generation 重建助理，立即清空先前草稿、對話與本次同意；一般頁面編輯器不因助理重建而重掛載 |
| A → B → A 後收到第一次 A 的回呼 | generation 不同，舊回呼失效；不能因字串身分再次相同而復活 |
| 已確認操作尚未取得確定結果 | 保留既有執行紀錄及原確認內容，依原流程讀回／核對；停止回答不表示撤回已送出的寫入 |

`hidden`／`inert` 用來暫時移除可見與可互動內容，不是授權機制；真正的帳號與資源權限仍在原 API 核對。對話保留目前僅限同分頁的記憶體；重新載入、登出或真正切換範圍後，不承諾完整歷史恢復。原有執行紀錄只處理未確定操作，不等於一般聊天紀錄儲存。

## 功能對應與完成邊界

下表描述既有 **Web V2** 能力在新工作區中的入口與接續方式。每個 reader 仍取決於部署、學校來源、登入及實際授權；Mobile 與學校帳號的舊助理不因此自動取得相同工具。能力依據以 [`assistantTaskPlan.ts`](../../packages/shared/src/assistantTaskPlan.ts) 與各實際工具為準。

| 功能 | 目前可由工作區接續 | 仍需原服務或尚未完成的自動操作 |
| --- | --- | --- |
| 課務、課表與學業紀錄 | 查本人已同步課表、nuni 課程／作業／教材、已保存的匯入紀錄；依期限與空檔準備讀書行程；已接通的清大／暨大公開開課查詢 | 正式選課、校方即時成績與畢業資格認定；匯入紀錄不能冒充正式最新成績 |
| 校方 LMS／TronClass | 保留既有已啟用且已授權的查詢、教材及 Agent 接續；不支援時明確帶回對應服務 | 不宣稱所有學校 LMS 已接通；正式作業繳交、作答、點名及批改未因本輪介面改版取得自動執行能力 |
| 個人行事曆 | 查行程、核對空檔；準備個人、讀書、取餐或工作時段，明確確認後走既有寫入與讀回 | 建立行程不代表已通知對象、完成原任務或活動報名；來源不完整時不能宣稱有空 |
| 圖書館 | 讀所選學校的官方名稱、館藏目錄網址與已列出的官網／開館資訊頁，接續原服務 | 不直接查書目、即時館藏、借閱紀錄或實際開館時間；續借、預約座位仍由圖書館服務辦理 |
| 校園導覽與地圖 | 查所選校園地點及有來源的樓層／設施；從下一堂課接續找教室，開地圖核對 | 同名或資料缺漏須澄清；不宣稱所有學校皆有完整室內／3D／無障礙路線資料 |
| 公車 | 查校園站點與來源可用的到站資訊，區分即時、表定與不可用 | 不把表定時間當即時預估；票務、叫車與旅程保證不在本輪範圍 |
| 餐廳、點餐與本人訂單 | 查可用店家、菜單及本人平台訂單；準備餐點提議、接續點餐，或準備取餐行程 | 購物車／入口備妥不代表下單付款；不自動取消、支付或完成取餐。學校帳號 App 訂單與平台店家訂單分開 |
| 宿舍、請假與核閱 | 開啟宿舍、請假、教師核閱及課務申訴的正式服務 | 尚未透過工作區代查宿舍包裹、代送報修、填送假單或批准申請 |
| 公告、活動、社群與社團 | 查公開校園公告／活動／交流、可讀社團目錄與動態；明確選定活動後重新核對時間並準備個人行程 | 私人訊息／群組內容、發文、邀請、入社、活動報名與通知傳送不自動執行；貼文與教材內容不能改變工具指令或權限 |
| 教師與助教 | 查本人已授權且已核對校園的授課概況；接續安排備課時間與課務頁 | 已交數不等於待批數；批改、成績發布、學生請假與課程通知仍依正式工作區授權操作 |
| 店家 | 查本人已授權門市的訂單與當班概況，多門市先選擇；接續安排盤點等個人工作時間 | 不替任何帳號授予店家資格；接單、退款、菜單變更、結班由門市工作區處理 |
| 校務與平台管理 | 查公開校園聯絡資訊及公告，接續核閱、資格及管理入口；可準備個人行政／維運時段 | 不因選擇情境取得校務或管理權限；資格核發、管理寫入及對他人帳號的操作不自動執行 |

## 工作情境對應

工作情境是使用者目前要做的事，與帳號的實際角色分開。單一選單沿用 [`assistantRoleWorkflows.ts`](../../packages/shared/src/assistantRoleWorkflows.ts) 與 [`assistantRoleProfiles.ts`](../../packages/shared/src/assistantRoleProfiles.ts)，不另建角色判斷。

| 情境 | 優先協助的事 | 權限與確認界線 |
| --- | --- | --- |
| 學生／個人 | 課務、時間安排、生活服務與取餐 | 讀自己的資料；個人行程需確認與讀回 |
| 教師／助教 | 授課概況、備課與課務入口 | 每門課仍須已授權，不以選單認定教師身分 |
| 店家 | 授權門市概況與工作安排 | 買家訂單不等於門市營運資料，多門市不自行猜選 |
| 社團 | 可讀動態、公開活動與個人籌備時間 | 不代表取得社團管理權或替他人報名 |
| 校務人員 | 公告、聯絡資訊與行政工作入口 | 核閱與資格操作由服務端再驗權 |
| 平台營運 | 公開服務資訊與維運工作入口 | 不授予管理員權限，不自動修改平台資料 |

有未完成的確認操作時沿用原情境鎖定；切換情境不能確認、取消、重送或改寫既有簽署操作。只有原服務核對的回執能使操作顯示為完成。

## 可重現驗收

### 使用者旅程

| 情境 | 操作 | 通過條件 |
| --- | --- | --- |
| 首次開始 | 在 Today 填入問題，按「開啟任務」 | 原文帶到工作區，尚無 ask 請求；需要雲端回答時須明確同意再送出 |
| 跨功能接續 | 取得回答、輸入第二題草稿，開課程／地圖，再從頁首或「接續任務」開啟 | 同一對話實例、既有回答與草稿仍在；不重查 capability、不重送已問問題 |
| 草稿雙向共享 | 在工作區修改草稿後收合，回首頁；也反向操作 | 顯示同一草稿，遲來的上一題結果不清掉後來輸入 |
| 注音與鍵盤 | 組字時按 Enter／Escape，再用一般 Enter／Escape | 選字不開啟、送出或關閉；一般鍵盤動作遵循原語意，收合回到有效觸發處 |
| 同 session 恢復 | 保留草稿與已回答內容，觸發登入／校園重新驗證 | 暫停時看不到且無法操作私人對話；原身分恢復後接續，不自動提問、不搶走已移到其他欄位的焦點 |
| 停止與遲來回覆 | 讓問答保持 pending，停止或觸發身分重新驗證，之後才 resolve 舊回覆 | AbortSignal 已中止，舊回覆不回填；原結果及待確認內容仍保留，不自動重送 |
| 真正切換範圍 | 更換帳號、session 或校園，再測 A → B → A | 草稿、同意、對話清除；舊 setter、問答與導覽回呼不可恢復先前內容 |
| 訪客 | 輸入圖書館／公車需求並開啟入口 | 接到所選校園的服務搜尋，不送私人查詢、不偷開雲端問答 |
| 角色與寫入 | 切換教師／店家等情境，查看建議；已有待確認卡時嘗試切換 | 不新增權限；鎖定與原確認語意有效，重試只重查原任務允許的部分 |
| 待確認卡片接續 | 準備個人行程後先不確認，前往行事曆，再開工作區 | 原卡片與確認控制保留；不自動 confirm、reconcile 或重送 ask |
| 小螢幕與輔助操作 | 320px、390px、桌面、深色、200% 文字、減少動態 | 無橫向溢位，主要輸入可到達，控制有可讀名稱；減少動態依系統與站內偏好生效 |

### 自動驗證命令

使用儲存庫指定的 Node 與已安裝依賴。以下提供主要定向驗收命令，從 repo 根目錄建置共用程式，再執行指定測試；兩組包含相同案例，不得把測試數相加當作不重複總數。

```bash
node scripts/build-functions-shared.cjs
cd apps/web
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts \
  src/components/AssistantWorkspaceProvider.test.tsx \
  src/components/AssistantWorkspace.integration.test.tsx \
  src/components/TodayCampusEntry.test.tsx \
  src/components/AppHeader.test.tsx \
  src/components/AppHeader.popovers.test.tsx \
  src/components/QuickCampusEntry.test.tsx \
  src/components/QuickCampusPublicCourse.test.tsx \
  src/app/ai-assistant/LegacyAssistant.workspaceDraft.test.tsx \
  --maxWorkers=2
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts \
  src/features/nuni/assistant/AssistantThread.inlineWorkspace.test.tsx \
  src/features/nuni/assistant/AssistantThread.test.tsx \
  src/features/nuni/assistant/AssistantThread.draftSafety.test.tsx \
  src/features/nuni/assistant/AssistantThread.scroll.test.tsx \
  src/features/nuni/assistant/AssistantWorkContext.integration.test.tsx \
  src/features/nuni/Assistant.roleContext.test.tsx \
  src/features/nuni/assistant/AssistantTaskPlan.test.tsx \
  src/components/TodayCampusEntry.test.tsx --maxWorkers=2
node --max-old-space-size=6144 ../../node_modules/typescript/bin/tsc --noEmit --pretty false
```

原生入口回歸，從 repo 根目錄執行：

```bash
cd apps/mobile
node --max-old-space-size=4096 ../../node_modules/jest/bin/jest.js \
  src/__tests__/QuickCampusEntry.test.tsx \
  src/__tests__/StudentTodayScreen.test.tsx --runInBand
```

Web 真實元件與 CSS 的瀏覽器 fixture，從 repo 根目錄執行：

```bash
node scripts/qa/ai-workspace/build.mjs
python scripts/qa/ai-workspace/check.py
```

fixture 使用實際 Provider、首頁、頁首、TodayCampusEntry、Conversation、AssistantThread 與 CSS；登入、校園、導覽及傳輸回覆由合成邊界提供。檢查前後比對來源 SHA-256，截圖與幾何量測輸出到 `artifacts/ai-workspace/`；產品程式修改後必須重建。詳細環境與隔離規則見 [`scripts/qa/ai-workspace/README.md`](../../scripts/qa/ai-workspace/README.md)。

### 本輪驗證紀錄

以下為追加 #749 前、最終成為 `5514729b` 工作區候選的本機驗證。Web 478 項是一次執行的去重結果；Provider 與真實 Conversation 的最後重跑都是其中子集，不另加總。地圖是另一個回歸批次，亦不與其他批次相加宣稱整個產品的測試總數。這些紀錄保留原驗證範圍，後續整合提交的 GitHub CI 與審查仍須對應該提交的精確 head。

| 批次 | 已回報結果 | 證據限制 |
| --- | --- | --- |
| Web 工作區與直接相關回歸 | 18 檔、478 tests 通過，0 skipped | Node 22.23.5、`maxWorkers=2`，單次去重執行 |
| Provider 與登入返回回歸 | 36／36 通過 | 包含 4 個 Next 導覽提交時序案例；隔離載入舊版時 4 個皆失敗，新版通過，屬於上述子集 |
| 真實工作區 Conversation 最後重跑 | 7／7 通過 | 包含同 session 恢復不搶焦點、遲來回覆，以及待確認卡片換頁後不重送；傳輸仍為合成資料 |
| Mobile 入口回歸 | 91 tests 通過 | 原生元件測試，不等於實機驗收 |
| 既有地圖與相關回歸 | 192 tests 通過 | 獨立回歸批次，不表示所有學校資料與真實導航已驗證 |
| Web TypeScript 與 production build | 最後 `next build` exit 0，型別檢查及路由產生完成 | 不等於正式部署或真實登入／後端驗收 |
| 變更 Web 檔靜態檢查 | 16 個變更檔 ESLint exit 0、0 errors；diff whitespace 檢查通過 | `CampusProviders` 有 2 個既有 warnings，未宣稱零警告 |
| Chromium 真實元件 fixture | 6／6 情境、36 個流程檢查通過，30 張截圖 | 合成身分與傳輸；不代表 Next server、真後端、Safari 或原生裝置 |
| 正式建置的助理返回旅程 | `campus-visual-smoke.py` 中完整返回流程通過，page errors 0 | 使用真正 Next standalone 與合成服務；驗證返回、網址／分類、重載清稿、首頁雙向草稿及焦點，不代表正式帳號登入或全部服務；本機整份 campus-visual 在未修改的離線模擬遇到版本差異，保留原斷言並交由 CI 版本驗證 |

瀏覽器六個情境分別為 1440px 桌面淺色、390px 手機淺色、320px 深色、320px／200% 文字、系統減少動態且站內旗標關閉，以及站內減少動態且系統無偏好。全部沒有 console warning／error、page error、非預期／外部網路或水平溢位。355 份來源的 SHA-256 在執行前後及最後複核一致，兩份 React／DOM runtime manifest 也一致。本機工具版本為 Playwright 1.56／Chromium 141；CI 工作流固定 Playwright 1.57，遠端結果須依最後 head 另行核對。

完整產物為 `artifacts/ai-workspace/results.json`、`source-sha256.json` 及 30 張截圖。來源 manifest SHA-256：`638d4a92a14b3220b1a8d696f8949e6d5b5d0b812e1df978d247d4d282e2c57d`；結果 SHA-256：`476134a0c68d3f105712bb7979322655b557096cf0fdf6c8b491615a00404831`。

可隨原始碼審閱的畫面：[桌面首頁](evidence/ai-workspace-20261124/desktop-home.png)、[手機回答與草稿](evidence/ai-workspace-20261124/phone-answer.png)、[320px 深色訪客服務搜尋](evidence/ai-workspace-20261124/small-dark-guest-search.png)。畫面保留合成資料與未連正式服務的標示。

### 追加 main 前的 GitHub 驗證

`5514729b` 的 [中央 CI 45393845135](https://github.com/Miiduoa/graduation/actions/runs/45393845135) 已通過九項驗證／建置與 CI Summary；Firebase backend 部署為條件性 skipped。[CodeQL 45393845223](https://github.com/Miiduoa/graduation/actions/runs/45393845223) 亦通過。[Web Tests job](https://github.com/Miiduoa/graduation/actions/runs/45393845135/job/138450051932) 在 2026-11-24 13:12:58 UTC 完成：950 test files passed、15 skipped；37,828 tests passed、146 skipped、0 failed。這是一次 Web coverage 執行的結果，不與前置 PostgreSQL 回歸或本機批次相加。

Web job 的 checkout 日誌明確使用 `refs/pull/788/merge` 的 `13bc9e8b`；其 parents 是 `7953ae44` 與 `5514729b`，tree 為 `3ee34cc1`。這段驗證保留為追加 #749 前的證據，沒有把結果移轉到新 head。

### 追加 #749 的整合驗證

遠端 `3ceb81d1` 已以 `5514729b` 與 `5e82f068` 為雙親完成兩個 PublicCourseSearch 檔的整合。本次隔離工作樹直接採用該外部提交，再以它為單一 parent 追加必要測試與本文件。`PublicCourseSearch.tsx` 與外部版本完全相同，保留時效提醒、官方目錄連結、來源紀錄與帳號／校園草稿邊界；比較時鐘僅於有效結果存在期間運作，原始 `fetchedAt`、來源網址、已選課程與網路請求均不因重新判時而改寫。

以下結果來自採用 `3ceb81d1` 產品並補足測試後的實際重跑，沒有沿用先前本機合併預演的通過數。本機定向驗證使用 Node 22.23.5：`PublicCourseSearch.test.tsx` 與 `school-courses/page.test.tsx` 共 2 檔、128 tests 通過、0 skipped，`maxWorkers=2`；兩個相關程式檔 ESLint exit 0，Web TypeScript exit 0。案例覆蓋 focus、visibility、60 秒間隔跨越 24 小時、新回覆在下一次間隔前的 5 分鐘容許邊界，以及重新判時後的選取／來源保留與卸載清理。focus／visibility 案例以 `await act` 涵蓋已解析查詢到 ready 的 React 更新與 effects，補足測試的非同步生命週期邊界，再送出原本的頁面事件。測試只推進 0ms 以完成 jsdom 的 storage event 排程，之後確認產品 interval 仍有 1 個、卸載後為 0，未清空所有 timers 來掩蓋清理問題。

```bash
cd apps/web
node ../../node_modules/vitest/vitest.mjs run \
  src/app/school-courses/PublicCourseSearch.test.tsx \
  src/app/school-courses/page.test.tsx --maxWorkers=2
node ../../node_modules/eslint/bin/eslint.js -c eslint.config.mjs \
  src/app/school-courses/PublicCourseSearch.tsx \
  src/app/school-courses/PublicCourseSearch.test.tsx
node --max-old-space-size=6144 ../../node_modules/typescript/bin/tsc --noEmit --pretty false
```

新整合提交的瀏覽器重建、遠端 CI、審查與合併狀態仍須依該提交另行記錄；上述 `5514729b` 的遠端綠燈不代表已驗證新 main 的合併結果。

### 追加 #773 的地圖整合驗證

在隔離工作樹以已發布 `e89dd33a` 三方合併 main `322d42e0`，保留雙親來源。保留 #773 的 Google／Apple 步行導航、手選起終點的位置快照重新確認、清除或改選後的登入返回路線，以及未觸碰深鏈在校方來源暫時失敗時的返回資訊。公開靜態地點的來源警語使用 `publicSchool`；遠端地點查詢、收藏、裝置資料範圍及登入返回網址繼續使用原本的 `school`，因此 `tw-pu` 不會被改寫成另一個資料範圍。

兩點路線及詳細地點的 Google／Apple 連結各自共用相應的 `aria-describedby` 警語，仍明確區分地點標記與已核實的建築入口。回歸涵蓋 `pu`／`tw-pu` 兩種 ID、正反向兩點路線、單一來源停車場的警語及已核對圖書館不被誤標；另外確認原 ID 的資料／收藏載入與完整手選、清除、重新選路後的登入返回資訊。

實際本機重跑使用 Node 22.23.5、`maxWorkers=2`：以下 4 檔共 **204 tests 通過、0 skipped**，耗時 12.86 秒；兩個 MapClient 檔 ESLint exit 0、Web TypeScript exit 0、diff whitespace 檢查通過。這是新增 main 後的地圖專項批次，與工作區 478 或課程 128 分開記錄，不相加宣稱不重複的全產品測試數。

```bash
cd apps/web
node ../../node_modules/vitest/vitest.mjs run \
  src/app/map/MapClient.test.tsx \
  src/app/map/campusClassroomNonBuildingPoi.test.ts \
  src/lib/nuni/assistantV2/campusMap.test.ts \
  src/lib/nuni/assistantV2/campusMapAdapter.test.ts --maxWorkers=2
node ../../node_modules/eslint/bin/eslint.js -c eslint.config.mjs \
  src/app/map/MapClient.tsx src/app/map/MapClient.test.tsx
node --max-old-space-size=6144 ../../node_modules/typescript/bin/tsc --noEmit --pretty false
```

此合併候選的 CI、審查與部署仍須核對其最後發布 head；`e89dd33a` 的既有 run 只證明其原先的合成合併 snapshot。

## PR 與合併驗收

此整合候選應對 `main` 開 PR，保留 #768／#783 來源，並揭露對 main 的差異包含既有整合內容。中央 [`ci.yml`](../../.github/workflows/ci.yml) 與新增的 [`ai-workspace-browser.yml`](../../.github/workflows/ai-workspace-browser.yml) 只在對 main／develop 的 PR 啟動，CodeQL 的 PR 則只對 main 啟動。一般本機測試或舊 PR 綠燈不能代替最後候選的完整檢查。

2026-11-24 直接查核的 [main ruleset 26004626](https://github.com/Miiduoa/graduation/rules/26004626) 要求 PR，並要求 App `5504170` 提供 `審查通過`，沒有 bypass actor。普通 PR approval 不等於該 status。中央 CI Summary 另要求九項驗證工作全部成功；合併與正式部署是後續獨立狀態。

## 後續差距與順序

1. **完成實際裝置與輔助閱讀驗收。** 同 session 暫停／恢復、焦點、遲來回覆與待確認卡片接續已有整合案例；元件事件與 Chromium fixture 不替代 Safari 注音、VoiceOver／TalkBack 與 iOS／Android 實機。
2. **把暫停變成引擎明確介面。** 本輪以可中止回答控制接上既有 abort；capability、舊版公開資訊及展示資料等背景讀取仍需逐項定義暫停生命週期，不能概括宣稱所有背景 I/O 均已停止。已確認寫入與純讀取必須分別處理。
3. **依服務補上真正可驗證的執行。** 優先選有穩定 API、權限及回執的狹窄流程，例如特定 LMS 的已授權操作或圖書館可用查詢；每一項先定義讀取、準備、確認與讀回，不用更多聊天入口掩蓋缺少的後端能力。
4. **完成原生角色與持續任務的一致性。** Mobile 本輪先修 Today 入口；教師、店家、校務情境和跨原生頁面接續需另行設計與實機驗證，不能直接宣稱與 Web 等效。
5. **決定歷史與跨裝置產品範圍。** 永久儲存、搜尋、刪除、跨裝置續接及資料保留規則尚未實作。先完成明確的帳號／校園／權限邊界，才延長保存生命週期。
6. **以完成任務的證據判斷成效。** 後續量測從首頁開始到有效結果的步驟、重述問題次數、跨功能返回後的續接成功率，以及停下／復原成功率；目前沒有這些線上數據，不宣稱完成率或模型品質已提升。

正式驗收應另外核對實際登入、服務來源、伺服器授權、寫入回執與部署版本。本輪完成的是可用且可延續的任務入口與對話流程，整個產品的自動執行範圍仍以逐項能力和實際服務證據為準。
