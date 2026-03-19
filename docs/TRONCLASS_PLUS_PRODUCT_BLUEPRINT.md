# TronClass+ 產品重設藍圖

查核日期：2026-03-19

本文件不是空泛企劃，而是根據目前專案實際程式結構、現有功能成熟度，以及 2026-03-19 當天可查到的 TronClass 官方公開資料整理出的重設方案。

## 1. 先講真話

你現在的專案不是「功能太少」，而是「主軸不夠集中」。

目前狀態比較像：

- 一個很有野心的校園超級 App 原型
- 有不少比一般校務 App 更進階的功能雛形
- 但還不是一套可以正面對打 TronClass 的學習平台

真正的差距不在畫面數量，而在三件事：

1. 學習主流程沒有被做成一條完整鏈路  
   從課程首頁、教材、作業、點名、測驗、成績、學習分析，到課中互動與課後追蹤，現在散在多個頁面與資料結構裡。
2. 真實資料整合不足  
   `apps/mobile/src/data/hybridSource.ts` 目前只有少數能力走 `fetchWithFallback()`，大量能力仍直接委派到 `mockSource`。粗略靜態計數約為 14 個 real-api/fallback 入口，對比 122 個 `mockSource.*` 委派。
3. 角色導向體驗不完整  
   TronClass 的強項不是只有學生能看資料，而是教師、學生、助教、管理者都能在同一條教學流程內工作。

## 2. 目前專案真正已經有的資產

這個專案不是推倒重來。你已經有一些很好、而且能直接升級成核心能力的模組。

### 可直接保留並升級的能力

| 現有資產 | 現況 | 可升級方向 |
|---|---|---|
| `apps/mobile/App.tsx` 的多分頁主架構 | 已成型 | 重新調整 IA，不重寫整個 App Shell |
| `HomeScreen.tsx` 的時間情境首頁 | 已有雛形 | 升級成 `Today / 今日駕駛艙` |
| `GroupDetailScreen.tsx` | 已有課程群組、公告、Q&A、貼文 | 升級成真正的 `Course Hub` 動態牆 |
| `GroupAssignmentsScreen.tsx` + `AssignmentDetailScreen.tsx` | 已有作業、繳交、批改、發布、同儕互評雛形 | 升級成正式作業與評量系統 |
| `ClassroomScreen.tsx` | 已有即時反應、匿名提問、投票 | 升級成課中互動主畫面 |
| `LearningAnalyticsScreen.tsx` | 已有學習分析畫面，但尚未接入導航 | 升級成差異化核心功能 |
| `sso.ts` + `AdapterRegistry.ts` + `NCHUAdapter.ts` | 已有多校 SSO / API adapter 架構 | 可作為多校深整合底座 |
| `backend/functions/index.js` | 已有推播、提醒、live session callable functions | 可升級為事件驅動後端 |
| 地圖/公車/餐廳/圖書館/宿舍/健康/支付 | 已有大量校園服務 | 這是超越 TronClass 的主戰場 |

### 目前的隱性問題

- `LearningAnalyticsScreen.tsx` 存在，但沒有被接進主要導航。
- `ClassroomScreen.tsx` 已做出來，但沒有成為課程流程中的標準入口。
- Web 端目前偏展示型與靜態資料頁，還不是完整教學工作台。
- 多校能力目前偏架構可行，還不是資料上真的可大量落地。

## 3. 2026-03-19 的 TronClass 功能基準

依 2026-03-19 查核到的官方公開資料，TronClass 的核心競爭力仍然是 LMS 主幹，而不是校園生活服務。

我整理出的 TronClass parity 必備能力如下：

| 類別 | TronClass 基準 | 你目前狀態 | 判定 |
|---|---|---|---|
| 課程空間 | 課程首頁、課程管理、課程內容整理 | 目前以群組/課表分散呈現 | `必補` |
| 教材內容 | 單元、教材、檔案、影片、學習內容 | 目前缺正式教材模組 | `必補` |
| 課程公告 | 有 | 已有 | `可沿用` |
| 作業與繳交 | 有 | 已有不錯雛形 | `強化即可` |
| 測驗/考試 | 有 | 型別有 `quiz/exam`，但缺完整引擎 | `必補` |
| 題庫 | 有 | 缺 | `必補` |
| 點名/出缺席 | 有 | 只有活動簽到，不是課程點名 | `必補` |
| 成績簿/成績發布 | 有 | 有部分成績頁與作業分數，但不是完整 gradebook | `必補` |
| 討論/Q&A | 有 | 已有 | `可沿用` |
| 分組/協作 | 有 | 已有群組、貼文、成員、私訊 | `強化即可` |
| 課中互動 | 有課堂互動/點名/即時操作 | 你有投票、匿名提問、反應條 | `可升級成亮點` |
| 學習分析 | 有 | 你有隱藏雛形 | `要正式化` |
| 行動端與通知 | 有 | 你已有推播/離線/Widget/多語 | `優勢` |
| SSO/權限/管理 | 有 | 已有架構 | `強化即可` |

## 4. 不要做成「TronClass + 校園工具很多」

如果只是把 TronClass 功能硬塞進現在的架構，結果會變成：

- 首頁很花
- 功能很多
- 學生不知道先去哪裡
- 教師不知道從哪裡開始管理教學

新的產品定位應該是：

**Campus Learning OS**

一句話版本：

**先做出完整 LMS 主幹，再把校園服務變成教學情境的一部分。**

也就是：

- TronClass 解決的是「教學管理」
- 你的產品要解決的是「教學管理 + 校園行動執行」

這才是真正超車。

## 5. 新的資訊架構

### 新頂層 IA

我建議把現在的 `首頁 / 課業 / 地圖 / 訊息 / 我的` 重排成：

1. `Today`
2. `課程`
3. `校園`
4. `收件匣`
5. `我的`

### 為什麼這樣排

#### 1. `Today`

這不是一般首頁，而是當天行動面板。

使用者一打開就看到：

- 下一堂課
- 距離上課剩餘時間
- 去教室最佳路徑
- 今日待繳作業
- 今日公告與異動
- 今日校園提醒
- AI 今日摘要

#### 2. `課程`

這是 TronClass parity 的核心頁。

每門課都應該有標準化結構：

- 課程總覽
- 公告
- 單元教材
- 作業
- 測驗
- 點名
- 討論
- 成績
- 課中互動
- 學習分析

#### 3. `校園`

把原本散在首頁與我的頁面的校園服務，集中成第二主軸：

- 地圖與教室導航
- 公車
- 餐廳
- 圖書館
- 宿舍
- 健康中心
- 列印
- 支付
- 失物招領

這一區是你超越 TronClass 的關鍵，但它不能吃掉課程主軸。

#### 4. `收件匣`

把現在分散在公告、推播、群組未讀、作業提醒、活動提醒、系統訊息的東西整合成一個「可執行的收件匣」。

收件匣不是單純通知列表，而是要能直接做事：

- 去繳交作業
- 去上課簽到
- 去開啟地圖導航
- 去回覆問題
- 去確認成績異動

#### 5. `我的`

保留：

- 個人資料
- 學分試算
- 偏好設定
- 無障礙
- 多語系
- 帳號安全
- 資料匯出

但不要再讓太多核心服務都塞在這裡。

## 6. 真實情境下的使用邏輯

### 情境 A：學生上課前 15 分鐘

現在你應該讓使用者做的不是「自己找課表」，而是：

1. 打開 `Today`
2. 看到下一堂課、教室、老師、課前公告
3. 系統自動判斷目前位置與距離
4. 提供「帶我去教室」
5. 若已接近教室，自動浮出課堂簽到或課中模式入口

### 情境 B：學生正在上課

課程畫面應自動進入 `Classroom Mode`：

- 課堂 QR / 地理圍欄簽到
- 即時投票
- 提問牆
- 反應條
- 今日教材
- 課堂筆記
- 下課前 exit ticket

### 情境 C：下課後

學生回到課程頁後應直接看到：

- 本次課程摘要
- 新作業
- 截止時間
- 教材回放 / 投影片
- 討論串
- AI 幫你整理今天重點

### 情境 D：教師開課

教師不該先去建群組再補公告再補作業。

應該是一條完整流程：

1. 建立課程空間
2. 輸入課綱與週次
3. 匯入學生名單
4. 建立單元與教材
5. 建立評量項目
6. 設定點名方式
7. 進入每週授課節奏

### 情境 E：考試週

你的產品不能只顯示成績。

要能做到：

- 顯示所有考試與作業壓力熱區
- 按課程排列重要評量
- 提醒交通、教室變更、圖書館座位狀況
- 提供 AI 讀書順序建議

這就是超越 TronClass 的地方。

## 7. 核心創新點

下面這些功能不是為了炫，而是有真實校園情境價值。

### 1. 時間感知首頁

不是靜態首頁，而是根據「現在時間、今日課程、地理位置、待辦壓力」重新排序內容。

### 2. 課程與校園服務聯動

例如：

- 上課地點異動時，自動連動地圖導航
- 晚間課程結束後，推薦校車或餐廳
- 考前週自動顯示圖書館座位與延長開放資訊

### 3. AI 不是聊天玩具，而是學習代理人

AI 功能只保留能落地的幾種：

- 今日摘要
- 作業切分
- 學習風險提醒
- 選課與畢業規劃
- 根據課程資料回答問題

原則是必須吃得到真實課程、作業、成績、公告資料。

### 4. 學習風險雷達

把學習分析從「看圖表」升級成「可執行建議」：

- 哪一門課最危險
- 哪些作業常晚交
- 哪些時段最容易漏交
- 建議優先處理什麼

### 5. 課中互動正式產品化

你目前的 `ClassroomScreen.tsx` 已經有好底子，應該升級成正式賣點：

- 匿名問題牆
- 即時投票
- 理解度回饋
- 課堂簽到
- 下課 exit ticket

### 6. 離線優先

真實校園裡，教室 Wi‑Fi、地下室、校車移動都可能不穩。

你要把以下能力做成離線優先：

- 查看教材
- 看作業要求
- 暫存繳交內容
- 課堂筆記
- 待同步佇列

## 8. 一定要補齊的資料模型

現在很多功能還綁在 `groups` 之上，這對原型夠用，但對正式 LMS 不夠。

建議新增或正式化以下主體：

- `courseSpaces`
- `courseModules`
- `courseMaterials`
- `attendanceSessions`
- `attendanceRecords`
- `quizzes`
- `questionBanks`
- `questionItems`
- `gradeItems`
- `gradebookEntries`
- `rubrics`
- `discussionThreads`
- `learningSignals`
- `studentRiskSnapshots`
- `inboxItems`

### 建議結構

```text
schools/{schoolId}
  terms/{termId}
    courseSpaces/{courseId}
      announcements/{id}
      modules/{moduleId}
      materials/{materialId}
      assignments/{assignmentId}
      quizzes/{quizId}
      attendanceSessions/{sessionId}
      discussions/{threadId}
      liveSessions/{sessionId}
      gradeItems/{gradeItemId}
      members/{uid}

users/{uid}
  enrollments/{courseId}
  inbox/{itemId}
  analytics/{snapshotId}
  planner/{taskId}
```

### 遷移原則

- `groups.type === "course"` 不要馬上砍掉
- 先把它當 `courseSpace` 過渡層
- 後續再把社團/讀書會/社交群組與正式課程空間拆開

## 9. 功能補齊順序

### Phase 1: 先做 TronClass parity

第一階段只做「一定要有」：

1. 課程首頁與課程空間
2. 教材單元
3. 作業與繳交流程正式化
4. 測驗 / 題庫
5. 點名 / 出缺席
6. 成績簿與成績發布
7. 收件匣
8. Web 教師端基本可用

### Phase 2: 把你現有亮點接回主流程

1. `ClassroomScreen.tsx` 接入課程流程
2. `LearningAnalyticsScreen.tsx` 接入學生個人面板
3. AI 今日摘要與作業規劃
4. 課程和地圖/交通/圖書館聯動

### Phase 3: 做出真正超越 TronClass 的差異化

1. 學習風險預警
2. 畢業進度與選課策略
3. 校園服務聯動推薦
4. 課程事件驅動通知中心
5. 多校 adapter 正式擴充

## 10. 直接對應到你現在程式的改造建議

### 先保留

- `apps/mobile/src/screens/HomeScreen.tsx`
- `apps/mobile/src/screens/GroupDetailScreen.tsx`
- `apps/mobile/src/screens/GroupAssignmentsScreen.tsx`
- `apps/mobile/src/screens/AssignmentDetailScreen.tsx`
- `apps/mobile/src/screens/ClassroomScreen.tsx`
- `apps/mobile/src/screens/LearningAnalyticsScreen.tsx`
- `apps/mobile/src/services/sso.ts`
- `apps/mobile/src/data/apiAdapters/*`
- `backend/functions/index.js`

### 優先重構

- `apps/mobile/src/screens/HomeStack.tsx`
- `apps/mobile/src/screens/AcademicStack.tsx`
- `apps/mobile/src/screens/MessagesStack.tsx`
- `apps/mobile/src/screens/MeStack.tsx`
- `apps/mobile/src/data/source.ts`
- `apps/mobile/src/data/hybridSource.ts`
- `apps/web/src/app/*`

### 第一批要新建的模組

- `apps/mobile/src/screens/CourseHubScreen.tsx`
- `apps/mobile/src/screens/CourseModulesScreen.tsx`
- `apps/mobile/src/screens/QuizCenterScreen.tsx`
- `apps/mobile/src/screens/AttendanceScreen.tsx`
- `apps/mobile/src/screens/InboxScreen.tsx`
- `apps/mobile/src/data/courseSpaceSource.ts`
- `apps/web/src/app/teacher/*`
- `apps/web/src/app/course/[courseId]/*`

## 11. 最重要的產品決策

### 決策 1

**不要再新增更多校園生活功能，先補齊 LMS 主幹。**

你現在最容易犯的錯，是繼續擴充很多看起來很厲害的服務，結果 TronClass 最核心的課程閉環反而還沒做完整。

### 決策 2

**群組不是課程的最終模型。**

群組可以保留，但正式 LMS 必須有 `course space` 概念。

### 決策 3

**超越 TronClass 的方式，不是做更多，而是做更連續。**

真正差異化是：

- 課前可導航
- 課中可互動
- 課後可追蹤
- 校園服務能連動

## 12. 我對這個專題的最終定位建議

如果你要把它做成一個夠強、夠像真產品、又能在畢業專題裡講得漂亮的題目，我建議你的正式敘述改成：

**「一個整合課程教學、學習分析與校園行動服務的 Campus Learning OS」**

不是單純「校園整合 App」。

也不是單純「校務版 TronClass」。

而是：

**完整 LMS 主幹 + 真實校園場景聯動。**

這個定位才夠高，也真的有機會超車。

## 13. 官方參考來源

以下為本次比對使用的官方公開來源：

- [TronClass 官網](https://www.tronclass.com/)
- [TronClass 教師快速指引 PDF](https://support.tronclass.com/quickguidance_teacher/WGTCQuickGuidance%28teachers%29.pdf)
- [TronClass 學生快速指引 PDF](https://support.tronclass.com/quickguidance_student/WGTCQuickGuidance%28students%29.pdf)
- [TronClass 課程管理相關說明](https://support.tronclass.com/tw/question/course)
- [TronClass 學習分析相關說明](https://support.tronclass.com/tw/question/analytics/)

