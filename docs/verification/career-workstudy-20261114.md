# 校內工讀 Spec PR 2 驗證紀錄

基準：`c14d71fd`（PR #625），分支：`feat/career-workstudy-20261114`。
完整閱讀 `/workspace/agent-backend/lanes-1114/職涯-規格-v1.md`；本 PR 只做第二階段，實習學分紀錄仍屬 PR 3。

## 可審查的成果

- 網頁及手機 `components/career/CareerWorkstudy` 有相同的學生、承辦、校方營運介面。`audience` 只決定呈現；API 每次自行確認學校與承辦資格，不能靠切換畫面取得權限。
- 學生看單位、待遇、每週時段、名額、臺灣時間截止日、學分與課號、原公告。原有課表由各端既有 `loadPersonalTimetable` 讀取，不另存課表或傳給承辦。使用既有 PU／NCKU／NTPU 節次，無法確認時明說。衝堂機會保留。
- 應徵進入獨立權益畫面，讀該機會的校方說明、勾「我看過了」、填聯絡方式才可送件。API 驗證機會及權益版本、截止時間、上架狀態與工讀類型。確認正文、來源網址、版本與伺服器時間隨收件保留。
- 同一學生同一機會使用決定性收件編號；併發送出及逾時後重試都回原收件，不重複建立或覆寫確認紀錄。
- 承辦分「機會｜申請｜活動」。新增／編輯／上下架機會；讀取申請與聯絡方式，依序改為已讀、約面談、錄取或未錄取。面談須填回覆；版本過舊或跳過已讀時拒絕更新。保留原申請與每次操作紀錄。
- Firestore `onSnapshot` 觸發 API 重新讀取，另有 10 秒更新及手動重試。卸載、換帳號／學校會解除訂閱、清除先前畫面資料；學生只訂閱自己的申請。
- 「活動」直接從本校既有 `clubEvents`／`events` 讀取 `category=career` 清單，保留活動 id 與來源。點選活動時交給既有詳情頁，沿用 `registerCampusEvent` 報名與名額；沒有新造活動資料庫。
- 校方營運檢視來源設定與近期稽核，不預設顯示學生名冊；來源設定可由隔離的 `createCareerSourceFeed` 套用到 PR #625 的公開資料轉接器。沒有關閉職涯模組的設定。

## 正式入口隔離

本次沒有修改任何既有產品入口、登入／驗證／session／SSO callback、路由 dispatch、已部署 Functions export、Firestore 規則或索引。新檔案沒有被正式頁面、App 導航或 shared index 匯入。`careerWorkstudyIsolation.test.ts` 鎖住這個條件。

`careerWorkstudyHandlers.ts` 是可直接接受既有 `CallableRequest` 的 Firestore 交易工廠，沒有自行實作登入或信任前端角色。測試用既有 callable `data/result/error` 介面、真實 Firestore 模擬器及獨立規則測試環境驗證。沒有正式資料寫入，也沒有 seed 或 migration。

`packages/shared/testFixtures/careerWorkstudy.ts` 僅供測試匯入，刻意標為測試資料，產品程式沒有預載職缺、假公司或測試帳號。

## 需晉瑋說「上」

以下內容全部只存在未註冊的模組或文件，這次不啟用：

| 項目                                            | 核准後才可做的接線／資料變更                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 新集合 `schools/{schoolId}/careerOpportunities` | 工讀／實習／校徵機會；僅 API 交易寫入；訪客可讀上架項目，承辦可讀未上架項目。                                                                                                                                            |
| 新集合 `schools/{schoolId}/careerApplications`  | 含聯絡方式、補充說明、權益確認與狀態；學生只能讀自己，承辦只看本校；只由 API 交易寫入。                                                                                                                                  |
| 新承辦資格                                      | 沿用 `members/{uid}.status=active`，加上既有 `serviceRoles/{uid}` 的 `status=active` 及新欄位 `career_staff=true`；本校 active admin 保留管理能力。這次不改角色指派 API、既有 staff 分流或登入資料。不得由客戶端自授權。 |
| 新來源設定                                      | `schools/{schoolId}/settings/careerSources`：office、departments、taiwanjobs、revision；本校 admin 可寫，來源停用不會關閉工讀或職涯入口。                                                                                |
| 稽核寫入                                        | 既有 `schools/{schoolId}/adminLogs` 新增 `career_*` 操作、actorUid、targetId、at 與既有格式的 createdAt；與申請／審查／機會／設定在同一交易寫入。營運顯示最近 100 筆校務操作中的職涯紀錄，不假裝是完整歷史匯出。         |
| 新權限判斷                                      | `createCareerWorkstudyHandlers` 內全部 career 專用判斷；未註冊到 fnDispatch／Functions，不影響現有讀取。                                                                                                                 |
| Firestore 訂閱規則                              | `docs/approval/career-workstudy/firestore.rules.fragment`；沒有放進正式規則，也沒有被 `firebase.json` 引用。只在模擬器測試時嵌入正式規則的副本，驗證訪客、學生、承辦與跨校隔離。                                         |
| 接上入口與 API                                  | 在既有已驗證的 callable dispatch 註冊 `careerWorkstudy`，把學生元件放入現有職涯頁、把 staff／ops 元件掛入既有工作台。不得移除、合併或改嚴既有入口。                                                                      |
| 來源套用                                        | 公開資料端核准後才用 `createCareerSourceFeed({ db, loadFeed })` 包住現有唯讀轉接器；本次公開 route 完全不變。                                                                                                            |

沒有新索引、回填或 migration。申請資料生命週期與刪帳清理需在啟用前配合既有刪帳流程確認；其共用檔案由 PR #628 擁有，本 PR 未修改。沒有建立 `internshipRecords`。

核准後宿主接線範例（文件，不會執行）：

```tsx
const transport = createCareerCallableTransport({
  endpoint: approvedCallableEndpoint,
  authHeaders: existingFirebaseAuthHeaders,
});
const ports = createCareerWorkstudyPorts({ schoolId, uid, localOwner, transport });
// ports 要依帳號與學校 memoize；換身分時 ownerKey 必須一起換。
<CareerWorkstudy
  schoolId={schoolId}
  ownerKey={accountScopeKey}
  {...ports}
  audience="student" // 工作台使用 staff；校方來源／稽核使用 ops
  onLogin={existingLoginAction}
  onCareerEvents={({ category, event }) =>
    event
      ? existingCampusEventDetail({ eventId: event.id, source: event.source, schoolId })
      : existingCampusEventAction({ category })
  }
/>;
```

HTTP transport 沿用 callable envelope；headers 由既有宿主提供，不存 token、不建立新 session。`createCareerWorkstudyHandlers({ db })` 接受既有 dispatch 驗證完成的 request，不可把未驗證的 JSON 當成 `request.auth`。

## 重現驗證

不執行 `pnpm install`，不替換共用 `node_modules` symlink，不新增套件。此工作樹共用依賴的 `@campus/shared` 解析指向其他分線，標準 typecheck 因而出現既有大量找不到模組錯誤；新增的 `tsconfig.career.json`／`jest.career.config.cjs` 僅把測試解析固定到本工作樹，沒有更動正式編譯設定或略過原始碼。

```sh
pnpm --filter web exec tsc -p tsconfig.career.json --noEmit
pnpm --filter mobile exec tsc -p tsconfig.career.json --noEmit
pnpm --filter @campus/shared typecheck
pnpm --filter web exec vitest run src/components/career/ src/lib/server/careerSourceFeed.test.ts src/lib/server/careerWorkstudyIsolation.test.ts src/app/career/
pnpm --filter mobile exec jest --config jest.career.config.cjs src/__tests__/CareerWorkstudy.test.tsx src/__tests__/CareerScreen.test.tsx --runInBand
pnpm exec firebase emulators:exec --config firebase.career-emulator.json --project demo-career-workstudy --only firestore 'pnpm --filter web exec vitest run src/lib/server/careerWorkstudy.emulator.test.ts src/lib/server/careerWorkstudyRules.emulator.test.ts'
```

模擬器需要 Java 21。這次僅在 `/tmp` 準備測試用 JRE，沒有加入應用程式依賴。測試 project 為 `demo-*`，資料只寫本機模擬器。

實作限制：單次 API 最多 500 筆機會／申請；超過會明確要求分批處理，不靜默截斷名單。名額顯示為公告名額，本階段不自動搶位或替承辦決定錄取數。沒有 email／推播寄送，學生於開啟頁面時接收即時更新。未執行真機或實際校方帳號測試，未宣稱已完成正式串接。

## 本次結果

- 網頁職涯與新增流程：7 個檔案、180 項通過（含既有公開頁／來源轉接測試）。
- 手機原有職涯頁與新增流程：2 個套件、14 項通過。
- 真實 Firestore 模擬器交易與隔離規則：2 個檔案、24 項通過；測到併發重送、併發審查、撤銷承辦、跨校、權益版本、上下架、來源設定及既有職涯活動篩選。
- 網頁、手機專用 typecheck 及 shared typecheck 通過；修改範圍的 web／mobile／shared ESLint 通過。
- PR #627、#628、#629 的檔案範圍已透過 GitHub 查核；未修改其擁有的檔案。


## 第一輪審查修正

- 修正兩項 P2；審查未列 P0／P1。未建立或空課表回傳未知，不顯示「沒有衝堂」。手機職涯 adapter 對雲端課表使用伺服器確認讀取；讀取失敗回傳未知，不沿用一般課表 loader 的靜默快取 fallback。既有課表儲存模組未修改。
- 狀態更新的 `message` 改為可省略，伺服器在同一交易內保留原回覆；兩端編輯欄帶入原值，只有編輯過才送出回覆，另提供明確清除按鈕（隨狀態更新儲存）。面談仍須有有效回覆。
- 新增兩端 adapter、重開承辦工作台保留／清除回覆，以及模擬器交易回歸測試。網頁 8 個檔案 185 項、手機 3 個套件 21 項、Firestore 模擬器 2 個檔案 26 項全部通過。網頁／手機職涯 typecheck、shared typecheck 及變更程式 ESLint 通過。
- 本次未修改登入、session、ACL、Firestore 規則或 migration；只修正原先已隔離 handler 的回覆更新邏輯，既有隔離權限判斷及規則片段均未更動。未接入正式入口。
- 執行環境為 Node 24.22.1，pnpm 提示專案指定 Node 20／22 的版本警告；上述檢查仍全部通過。
