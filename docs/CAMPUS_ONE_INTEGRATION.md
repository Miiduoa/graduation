# Campus One 整合邊界與驗收

核對日期：2026-10-08（Asia/Taipei）。本文件記錄已核對的來源、整合決策與尚未完成的驗收；不代表三個專案已整合或部署。

Campus One 保留主要介面與操作流程；沿用 Nuni 的網域、既有帳號及部署基礎設施；從 Nolu 採用經確認有用的資料隔離與可靠性做法。採用功能時保留來源、授權與變更紀錄。

## 來源版本

| 來源 | 已核對的遠端版本 | 用途 |
| --- | --- | --- |
| [Campus One / graduation](https://github.com/Miiduoa/graduation) | main `d602fce4e167be404704a01ecff2fcaf7082a5ae`；feature/production-home-and-attendance `e8252c5832a16b4be092404a5819e4cae62606d5` | 本次介面與課程功能的起點；本工作分支後續修改尚未包含於這兩個 SHA |
| [Nuni / nuni-prod](https://github.com/Miiduoa/nuni-prod/tree/9de47b4b3492325e430562c37bcad552867162db) | main `9de47b4b3492325e430562c37bcad552867162db` | 既有 API、PostgreSQL、身份及部署契約的參考來源 |
| [Nuni / nuni-v2](https://github.com/Miiduoa/nuni-v2/tree/caa4cd313678c9b450f1932682f003fe281f748d) | main `caa4cd313678c9b450f1932682f003fe281f748d` | 新版方向；README 明確沿用 nuni.tw、api.nuni.tw、Cloudflare、Fly 及商店帳號 |
| [Nolu / web](https://github.com/Miiduoa/web/tree/a8e6804ef971de9eb68074a4499924c823fab733) | main `a8e6804ef971de9eb68074a4499924c823fab733` | 快取與身份切換隔離；備援文件及測試參考 |

這些是整合開始時核對的 GitHub 分支版本，不能用來推定正式站正在執行的版本。後續候選已合併 main `70675dd` 的架構文件與 GitHub Actions 更新，保留已測過的依賴修補，並採用主分支的 shell-quote 1.12.0。

## 沿用與轉接

| 項目 | 保留內容 | 必須完成的轉接或驗證 |
| --- | --- | --- |
| Campus One 介面 | 今日、課程、簽到與服務入口的主要操作方式 | 把資料取得與寫入接到選定的服務契約，保留載入、無資料、無權限與失敗狀態 |
| Nuni 網域及基礎設施 | `nuni.tw`、`api.nuni.tw`、既有 Cloudflare／Fly／商店資產 | 核對實際 app、部署版本、資料庫、secret 名稱與可回復版本，再決定路由切換；不先覆蓋現站 |
| Nuni 帳號及資料 | 既有使用者識別、學校／課程關係、歷史資料及權限 | 建立可追溯且唯一的 Nuni account ID ↔ Firebase UID ↔ Nolu 身份映射；不得只按姓名或電子郵件自動合併 |
| 登入與 session | Nuni 現有登入與撤銷語意 | Campus One 使用 Firebase Auth／Firestore／Cloud Functions；Nuni 使用 PostgreSQL 及自己的 session／BFF secrets。需明確的 API adapter、伺服器端 token 驗證與權限對映；密鑰不能互填 |
| Nolu 私人快取 | 身份確認前隔離可顯示快取；換帳號／訪客模式清除原帳號資料 | 將瀏覽器事件、storage key、帳號 owner marker 與身份驗證接到 Campus One 的 Web／Mobile lifecycle，涵蓋登出、跨分頁與離線狀態 |
| Nolu outbox／備援 | 文件描述的 durable outbox、版本遞增、主站單向同步與重播防護設計 | 尚未移植或執行驗證。先定義 authoritative store、冪等鍵、衝突及撤銷規則，再決定是否採用 SQL／worker；不得擴稱已涵蓋社群、動態與聊天 |
| 課程點名 | 本分支的 token 驗證、本人出席紀錄及教師私有簽到碼 | 若改由 Nuni API 寫入，須保持相同的會員檢查、原開場教師權限、冪等與結束場次語意；不能讓兩個後端各自累計出席 |

Nolu 已讀取的具體來源是 [`pu-plan/guest-privacy.js`](https://github.com/Miiduoa/web/blob/a8e6804ef971de9eb68074a4499924c823fab733/pu-plan/guest-privacy.js) 與 [`.github/tests/guest-privacy.cjs`](https://github.com/Miiduoa/web/blob/a8e6804ef971de9eb68074a4499924c823fab733/.github/tests/guest-privacy.cjs)。`clearPrivateCaches`、`clearResilienceFor`、`quarantineRenderableCache`、`clearPrivateAccountState` 及 profile/guest 事件處理可作移植參考；本次未執行該測試。備援能力只依 [`docs/NOLU_HOT_STANDBY.md`](https://github.com/Miiduoa/web/blob/a8e6804ef971de9eb68074a4499924c823fab733/docs/NOLU_HOT_STANDBY.md) 與 review guide 核對，尚未完整審查 SQL／relay／ingest／worker 實作。

## 目前真正的部署阻塞

- 實際 HTTP 核對：`https://nuni.tw` 回應 307 至 `/auth/account?returnUrl=%2F`，登入頁回應 200；headers 顯示 Cloudflare 與 Fly，CSP 允許連線至 `https://api.nuni.tw`。這只證明公開登入入口可達，不證明帳號流程、API 資料或整合候選已上線。
- 已透過現有 Fly 登入讀取 release metadata：`nuni-web` 最新 complete release 為 v31（2026-09-29 20:25:35 +08:00），image 為 `registry.fly.io/nuni-web:deployment-01M3PHVXNPYED2PG4T825J8VDJ`；`nuni-api` 為 v17（2026-09-29 18:57:09 +08:00），image 為 `registry.fly.io/nuni-api:deployment-01M3PCYQSJ6PQSHRXZ3ED726CS`。Release metadata 沒有提供來源 commit SHA。
- 真正阻塞是把這些部署映像對應到來源 SHA、實際資料庫與身份契約，再完成帳號 adapter 驗收及可回復的發布。`nuni-prod` 名稱或 GitHub main 不能代替查證；驗收前不將 Campus One 路由接到正式網域。
- 本機已可讀取 Firebase 專案清單及 EAS 帳號；Firebase 包含 `campus-one-tw` 與 `campus-demo-3a869`。不應重複要求使用者提供已有的登入憑證。Firebase 專案存在仍不等於 Nuni 的 PostgreSQL 帳號已完成轉接。
- 本 repo `.firebaserc` 預設仍是 demo 專案，正式部署不可省略明確 project ID。核對時 GitHub repository 及 production environment 的 secrets／variables 名稱清單皆為空；此事不代表 Fly、Render 或其他既有服務也沒有設定。
- 過去 [CI run 37393275660](https://github.com/Miiduoa/graduation/actions/runs/37393275660) 的 Firebase job 在缺少 token 時輸出跳過訊息並成功結束，不能視作部署證據。本分支已改為缺少 production variable `FIREBASE_PROJECT_ID` 或 secret `FIREBASE_TOKEN` 即失敗，且等 Functions／Firestore rules 測試通過後才部署至指定專案。

上述 CI job 只部署 Functions，不會部署 Web、Mobile、Firestore rules 或 indexes；完整發布仍須核對各部分的版本及相容性。

## 不遺失資料的前提

1. 在任何遷移前記錄来源版本、schema、筆數、主鍵集合、關聯與資料摘要；備份資料庫和物件儲存，並在隔離環境完成還原與比對。不得以清空、重新 seed 或把錯誤顯示為空資料完成整合。
2. 帳號映射與資料遷移採可重跑、可稽核的版本步驟。保留原 ID、來源、時間、權限、刪除／撤銷／保留狀態；無法映射的資料進入待處理清單，不丟棄或猜配。
3. 每類寫入只指定一個權威服務。遷移期间若需要同步，記錄游標與冪等鍵；重試、斷線、重播及回復不得建立重複作業、簽到、付款或訊息。
4. 點名 v1 公開文件曾包含 QR token／attendees map，不能直接加上 `schemaVersion: 2` 放行。先保留逐人出席資料及正確計數，再移除公開秘密、撤銷舊 QR 並開始新場次；rules、indexes、Functions 及兩端 client 必須協調發布。
5. 切換前保留舊部署與可回復資料格式；記錄回復後如何接回切換期間的新增寫入。正式流量與帳號資料只在下列驗收完成後切換。

## 依序驗收

1. **確認目標**：記錄 nuni.tw／api.nuni.tw 的 app、網域、TLS、部署 SHA、資料庫 schema 及設定名稱；與本次候選 commit 對應，確認備份可還原。不得記錄 secret 值。
2. **驗證身份 adapter**：使用獨立測試帳號完成現有 Nuni 登入、Campus One 讀取、寫入與登出；核對 UID/account 映射。換帳號、跨分頁登出、會員撤銷與過期 session 後，不得顯示或提交前一帳號的資料。
3. **驗證課程閉環**：教師建立場次，Web 顯示 QR、Mobile 掃碼；同一學生重試只增加一次出席，另一學生不能讀其紀錄或取得簽到碼。過期／錯課程／已結束 QR 均被拒絕；只有原開場教師可結束場次。
4. **驗證快取與 outbox**：在已登入、訪客、登出、離線重啟及帳號切換下測試資料隔離。模擬 timeout、相同請求重送、晚回應、主站不可達與恢復；對照事件和資料庫確認無重複、越權或撤銷資料復活。
5. **驗證遷移**：在備份副本執行一次及重跑一次遷移，比對主鍵、內容摘要、關聯、歷史紀錄及刪除／保留語意；執行回復並驗證切換期間新增的寫入仍可追溯。
6. **驗證發布**：執行 workspace lint/typecheck、Functions、rules、Web/Mobile 測試與 production build；在隔離的實際服務驗證上述流程。記錄部署 URL 與版本，再對正式站做登入、讀寫、登出及監控驗證。App 另需簽署產物、實機、TestFlight／Play internal 及商店審查證據。

完成標準是每一步都有對應版本與執行證據。文件、編譯通過、模擬器或 GitHub 綠燈不能替代正式部署及商店驗收。

## 管理登入與角色權限的本機驗收

目前沒有經驗證的 Firebase／Supabase 身份連結，因此教學管理頁保持關閉，不掛載管理內容，也不讀取或顯示先前 Supabase 帳號的個人資料。校園帳號初始化、切換與登出時會清除本機教學服務 session；清除失敗仍不開放管理內容。`RequireAdmin` 與 `AuthGuard` 的 10 項 React 測試已通過，涵蓋登出、換帳號，以及延遲或失敗的 session 清除回應。

新增的 `supabase/migrations/20261008000000_protect_profile_role.sql` 僅補上角色變更防護，保留既有 RLS；尚未套用至正式資料庫。已在自建、用後移除的 PostgreSQL 18 測試資料庫執行實際 migration 與 `supabase/tests/profile_role_authority.sql`，使用既有 profiles schema／RLS、`SET ROLE` 與 JWT claims 的本機 auth 函式替身，確認一般使用者無法自改或自行插入管理員／教師角色、可修改一般個人資料，既有管理員及 service role 可執行授權的角色變更，缺少 profile 不會取得管理權限。此驗證未更動共享或正式資料庫，也不等於已驗證託管 Supabase 的完整設定。部署前必須核對目標 schema／RLS，稽核現有教師與管理員 profile 的授權來源；新增防護不會自動撤銷過去已被錯誤授予的角色。

## 視覺與功能候選的驗收範圍

Web 與 Mobile 共用紙白／墨綠主色、語意狀態色、字級層次及深色模式。Web 頁首、服務選單、頁尾、登入回呼、條款與錯誤頁使用共同框架；Mobile 的今日、課程、個人、交通與 LMS 畫面沿用共同元件及 tokens。這是程式與本機畫面的驗收，尚未完成所有角色的實機逐頁驗收。

- 自動檢查：Web 133 項、Mobile 1,307 項、Functions 165 項與 Firestore／Storage rules 46 項測試通過；Web／Mobile 各保留 1 項既有跳過測試。Workspace TypeScript 與 Web production build 通過；Mobile 以 development 設定完成 iOS／Android export，並未產生簽署安裝包。
- Web：55 個路由的未登入狀態均回應 200，390px 寬度沒有橫向溢出或未處理的頁面錯誤；另複查個人、登入回呼、教學管理、助理、公車、條款與隱私頁的深／淺模式共 14 種狀態。使用占位 ID 的詳情頁只驗證登入／不存在狀態，不能替代有資料的功能驗收。
- 公車只接受來源為 TDX 且仍在有效時間內的即時結果；尚未設定學校路線、站牌與正式服務憑證時不顯示預估時間。Mobile 尚無可驗證的車輛追蹤服務，因此不提供模擬位置、到站震動或假位置分享。
- Mobile 個人資料使用實際寫入及回讀確認；舊成績／學業總覽／成就／教師評分路由已移除固定 GPA、比較排名、假徽章、示範學生及假儲存完成。成績只呈現本人目前學校已發布資料，教師入口先核對授課關係及課程 ID；缺資料顯示空或錯誤狀態。
- 校園助理僅呈現實際 callable 回覆，失敗保留草稿；對話不送出訂單或顯示未經確認的交易成功。登入、課程切換與清除對話會隔離舊回應。
- iOS／Android export 驗證 JavaScript 與資產可打包；不等於原生簽署、TestFlight、Play internal、真機或商店通過。Expo Doctor 依目前專案設定通過 16 項檢查；既有排除項仍須在正式發布前核對。
- 正式依賴稽核仍有 4 high、13 moderate、3 low、0 critical；完整 lint 無 error，但仍有既有 warning。這些問題與登入資料轉接、點名歷史遷移、真實資料驗收及簽署發布共同列入發布阻塞，不能只以本機編譯成功宣稱產品已上架。

## 原生 iOS 建置修正

主要 [CI 37652160901](https://github.com/Miiduoa/graduation/actions/runs/37652160901) 在 `0c21fa0` 通過；獨立 [Maestro run 37652160826](https://github.com/Miiduoa/graduation/actions/runs/37652160826) 的原生階段則因 `prebuild --clean` 覆蓋已提交的 Podfile 設定，在 FirebaseCoreInternal／GoogleUtilities 模組整合時失敗，未執行 UI 測試。後續修正改為直接安裝、編譯已提交的 iOS 專案，保留 static frameworks 及 llama-rn／RNFirebase hooks；已在暫存副本成功安裝 118 個 Pods，確認 workspace、scheme 與原生設定。

Workflow 改成選擇已安裝且可用的 iPhone simulator、等待啟動、編譯後讀取實際 bundle ID 並安裝 App，確認 Metro 可用才執行測試。失敗不再由 continue-on-error 隱藏。預設 smoke 驗證全新安裝的未登入首頁與登入入口；登入後角色流程需要另外準備正式測試帳號，不可用未登入測試替代。完整原生 build／UI 結果仍須以後續對應 commit 的 workflow 為準。
