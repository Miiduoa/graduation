# 職涯 PR 3：實習學分進度與公開來源防護

基準 `e44462628`（#625、#630），分支 `feat/career-internship-credits-20261114`。完整閱讀職涯規格 v1，競品查核見 [研究紀錄](../competitive/career-internship.md)。

## 可審查成果

- 共用實習資料契約、未註冊的 callable handler、網頁與手機學生／承辦／校方營運元件，沒有假實習或預載企業。測試資料只在 `packages/shared/testFixtures`。
- 系所承辦設定學期、學分、每學分時數（規格底線 60 小時）、校方來源、產業實習網連結，及申請、計畫書、時數登錄、成果報告、指導老師確認五步驟的文件／收件對象／明確期限。規則採版本檢查，紀錄保留建立時的規則快照。
- 學生建立機構與指定本校有效指導老師的實習紀錄。卡片同時顯示已登錄／所需／已確認時數、進度條、下一份未確認文件、收件對象與臺灣時間期限。固定告知「實習申請目前在產業實習網，這裡只幫你記進度。」；保留校方入口與各系所申請外連。
- 實際日期時數以 15 分鐘為單位；禁止未來日期、負數、每日超過 24 小時。可更正或移除未確認項目，已確認者須先由負責老師／承辦撤銷確認。文件登錄 HTTPS 佐證連結；可以撤回未確認繳交、確認或附原因退回。
- 校方職涯承辦可確認本校紀錄；系所承辦只可確認負責系所；指定老師只可確認指導紀錄。最後結案限指定老師，須達到已確認時數與全部文件確認；結案紀錄唯讀，畫面不宣稱已正式取得學分。
- 透過現有 personalImports 儲存期限到個人行事曆，兩端使用相同的穩定事件編號與臺灣時間轉換，重複加入去重；沿用既有鎖、帳號／學校範圍及同步偏好，沒有新提醒集合。未確認文件顯示逾期或七天內到期。日曆為期限快照，不自動建立推播；規則或校方期限變動仍須回原文確認。
- 每 10 秒與手動重新讀取。換帳號／學校／檢視範圍會卸載舊資料；失去權限或讀取失敗也清除紀錄。收到新紀錄版本時重載該紀錄編輯區；送出攜帶看到的版本，交易防止互相覆蓋。
- 營運端僅顯示規則與最近 100 筆校務操作中的實習稽核，不讀學生名冊。既有 #630 來源設定功能維持原有隔離，沒有可關閉職涯的旗標。
- 建立紀錄重送使用同一編號；交易保證重複請求只有一份紀錄。建立、規則更新、文件、時數與結案皆同交易寫入既有 adminLogs，不會只改狀態而漏稽核。

## 公開資料強化（直接作用於原有 route）

`/career/data` 的 PU 與 tw-pu 是同校別名，使用同一個校別快取槽；其他學校直接回原有不支援狀態，既不讀來源也不配置新快取。沒有新增登入要求或改動現有入口。

- 應用程式與 HTTP 公開回應 TTL 都是 30 秒。
- 同校並發請求共用同一個 Promise，完成或失敗後釋放。
- 每個程序、每校每分鐘最多 10 次來源載入嘗試。命中快取與等待同一請求不計次；超過時回既有快取或既有不可用狀態，保留公開存取。這是上游保護，不是分散式用戶配額。
- 外部回應逐塊解碼，沿用原本 2,000,000 個 UTF-16 code units 的長度門檻；另以 6,000,003 bytes（每個 code unit 最多 3 bytes，另含 UTF-8 BOM）作相容的安全上限。超限立即 abort 並 cancel reader，不先呼叫 response.text()。TextDecoder 支援跨塊中文字元；10 秒 timeout 涵蓋串流讀取，並在 finally 清理 timer。
- 三個來源依舊獨立失敗，不影響其他區塊，也不爬取 104／1111／Cake。

## 需晉瑋說「上」

所有下列新資料權限均只存在隔離模組與文件；沒有註冊到 dispatch、API route、Functions export、正式頁面、App 導航或 shared index。

| 項目                             | 核准後才可接線／啟用                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schools/{id}/internshipRecords` | 新集合，含學生 uid、機構、指定老師、規則快照、文件佐證、時數與確認結果；透過 API 交易寫入。學生只看自己、老師看指定紀錄、職涯承辦看本校、系所承辦看負責系所。                                                                                                                           |
| `schools/{id}/internshipRules`   | 新集合，含系所／學期規則、來源、流程文件與期限；本校 active 成員可讀，職涯承辦或負責系所承辦可寫。沒有 seed 或回填。                                                                                                                                                                    |
| 新實習權限判斷                   | 隔離 handler 每次交易查 `members/{uid}.status=active`；沿用 #630 的 active admin 或 active serviceRoles.career_staff。新增 active serviceRoles.internship_departments 字串陣列；不可由客戶端自授權。指導老師建立時需為本校 active teacher／staff／admin。未更改既有授權或角色指派 API。 |
| 新稽核寫入                       | 既有 adminLogs 新增 internship\_\* action、actorUid、targetId、at、createdAt。營運清單不回學生紀錄或 actorUid。                                                                                                                                                                         |
| 規則草案                         | `docs/approval/career-internship/firestore.rules.fragment`；只於測試中嵌入正式規則副本，正式 Firestore rules／firebase.json 均未更動。用戶端寫入一律交給交易 API；沒有刪除既有 allow。                                                                                                  |
| 宿主接線                         | 未註冊 `createCareerInternshipHandlers`；未掛載兩端 `CareerInternship` 或 ports。核准後由現有 callable 驗證宿主提供 authHeaders／request.auth，不新增登入流程。                                                                                                                         |
| 行事曆接線                       | 隔離 ports 呼叫既有個人行程儲存；宿主需提供符合目前身分的 scope 與即時 active()，不得在切換帳號後沿用舊 scope。                                                                                                                                                                         |
| 資料生命週期                     | 啟用前需接上帳號刪除／保存期限；accountDeletion 為 #628 擁有檔案，本次未修改。新集合在核准及完成清理整合前不可開放正式流量。                                                                                                                                                            |

沒有 migration、索引變更、正式資料寫入、部署或登入／session／SSO callback 修改。未修改 #627、#628、#629 擁有檔案。

## 核准後接線範例（目前不會執行）

```tsx
const transport = createInternshipCallableTransport({
  endpoint: approvedCallableEndpoint,
  authHeaders: existingVerifiedAuthHeaders,
});
const ports = createCareerInternshipPorts({ schoolId, transport, scope, active: isCurrentScope });
<CareerInternship
  schoolId={schoolId}
  ownerKey={accountScopeKey}
  uid={uid}
  audience="student"
  {...ports}
  onLogin={existingLoginAction}
/>;
```

依學校／帳號 memoize ports。承辦用 audience=staff；校方營運用 ops；老師用 student 可讀自己的及被指定的指導紀錄，非本人紀錄顯示確認操作。API 不信任 audience 來授權。

## 重現驗證

未安裝新依賴，未替換 node_modules symlink。沿用 #630 為此工作樹準備的 tsconfig.career.json／jest.career.config.cjs，避免共用依賴 symlink 解析至其他分線。

```sh
pnpm --filter web exec tsc -p tsconfig.career.json --noEmit
pnpm --filter mobile exec tsc -p tsconfig.career.json --noEmit
pnpm --filter @campus/shared typecheck
pnpm --filter web exec vitest run src/components/career/ src/app/career/ src/lib/server/careerWorkstudyIsolation.test.ts src/lib/server/careerSourceFeed.test.ts
pnpm --filter mobile exec jest --config jest.career.config.cjs src/__tests__/CareerInternship.test.tsx src/__tests__/careerInternshipPorts.test.ts src/__tests__/CareerWorkstudy.test.tsx src/__tests__/CareerScreen.test.tsx --runInBand
pnpm exec firebase emulators:exec --config firebase.career-emulator.json --project demo-career-internship --only firestore 'pnpm --filter web exec vitest run src/lib/server/careerInternship.emulator.test.ts src/lib/server/careerInternshipRules.emulator.test.ts --testTimeout=30000'
```

Java 21 使用既有 `/tmp/career-jre`，僅本機 demo-\* 模擬器資料。執行環境 Node 24.22.1，pnpm 對專案指定 Node 20／22 有版本警告。沒有真機／真實校方帳號驗證，不宣稱已串接產業實習網；文件採校方既有繳件管道與 HTTPS 佐證連結，不新增檔案上傳儲存。

單次 API 最多 500 個規則／紀錄，單紀錄最多 500 筆時數；超過明確要求分批處理，不靜默截斷。保存的日曆期限為參考，不自動追蹤外部校方網站變動。

## 最終驗證結果

- 網頁：12 個檔案、203 項通過（含原有職涯首頁、來源轉接及工讀回歸）。
- 手機：4 個套件、25 項通過（含原有職涯與工讀回歸）。
- 真實 Firestore 模擬器：2 個檔案、15 項通過，包含完整結案、並發重送／版本衝突、跨校／跨系、撤銷資格、時數／文件及規則隔離。
- web／mobile 的 tsconfig.career.json 與 shared typecheck 通過；變更程式三端 ESLint、Prettier 及 git diff --check 通過。
- 重新查核 PR #627、#628、#629 的擁有檔案，與此 PR 變更交集皆為空。

## 第二輪審查修正

- 修正 P2：來源大小限制恢復依解碼後 UTF-16 長度計算，避免原本可接受的中文公告／職缺被 bytes 門檻拒收，保留串流超限中止與相容的 bytes 上限。
- 新增 70 萬中文字、含 BOM 的長度邊界、emoji 邊界與解碼器結尾補字超限測試；既有跨塊中文字及超限 abort／cancel 測試持續通過。
- 本輪職涯網頁與來源隔離回歸共 6 個檔案、174 項測試通過；web tsconfig.career.json 型別檢查、變更程式 ESLint、Prettier 與 git diff --check 通過。
- 本輪未修改登入、權限、session、正式或草案 Firestore rules、migration；原有待核准模組維持隔離。
