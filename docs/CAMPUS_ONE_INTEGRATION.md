# Campus One 整合邊界與驗收

核對日期：2026-10-08（Asia/Taipei）。本文件記錄已核對的來源、整合決策與尚未完成的驗收；不代表三個專案已整合或部署。

Campus One 保留主要介面與操作流程；整合目標是沿用 Nuni 的網域、既有帳號及部署基礎設施，並採用 Nolu 經確認有用的課表處理與資料隔離做法。這些目標不代表帳號、金流、資料庫或網域已完成切換。採用功能時保留來源、授權與變更紀錄。

## 來源版本

| 來源                                                                                                   | 已核對的遠端版本                                                                                         | 用途                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [Campus One / graduation](https://github.com/Miiduoa/graduation)                                       | main `621dc7f98e5ead4dd717a754fe7d468dd7214487`；本輪 PR 起點 `c79b757754ea1afa4a461fd7a44038fc0de5f045` | 主要功能實作為 `5e609faeedc19153a5055aa9b755d2b3c08afc99`，已納入所列 main 的變更；後續提交另修正教師工作台換行、部署依賴與 Functions 封裝 |
| [Nuni / nuni-prod](https://github.com/Miiduoa/nuni-prod/tree/9de47b4b3492325e430562c37bcad552867162db) | main `9de47b4b3492325e430562c37bcad552867162db`                                                          | 既有 API、PostgreSQL、身份及部署契約的參考來源                                                                                             |
| [Nuni / nuni-v2](https://github.com/Miiduoa/nuni-v2/tree/caa4cd313678c9b450f1932682f003fe281f748d)     | main `caa4cd313678c9b450f1932682f003fe281f748d`                                                          | 新版方向；README 明確沿用 nuni.tw、api.nuni.tw、Cloudflare、Fly 及商店帳號                                                                 |
| [Nolu / web](https://github.com/Miiduoa/web/tree/a8e6804ef971de9eb68074a4499924c823fab733)             | main `a8e6804ef971de9eb68074a4499924c823fab733`                                                          | 課表匯入、重複／衝堂判定、快取隔離及備援契約的參考來源                                                                                     |

這些是本輪核對的來源版本，不能用來推定正式站正在執行的版本。主要功能實作已提交為 `5e609faeedc19153a5055aa9b755d2b3c08afc99`；下列完整驗證對應這批程式碼，後續版面、依賴與封裝修正另記錄對應驗證。原生顯示名稱另以 plist 與 development Expo config 驗證；尚未產生同版本的正式簽署產物。發布時仍須對應最終提交、建置產物與實際部署版本。

## 沿用與轉接

| 項目                | 保留內容                                                                                    | 必須完成的轉接或驗證                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campus One 介面     | 今日、課程、簽到與服務入口的主要操作方式                                                    | 把資料取得與寫入接到選定的服務契約，保留載入、無資料、無權限與失敗狀態                                                                                                           |
| Nuni 網域及基礎設施 | `nuni.tw`、`api.nuni.tw`、既有 Cloudflare／Fly／商店資產                                    | 核對實際 app、部署版本、資料庫、secret 名稱與可回復版本，再決定路由切換；不先覆蓋現站                                                                                            |
| Nuni 帳號及資料     | 既有使用者識別、學校／課程關係、歷史資料及權限                                              | 建立可追溯且唯一的 Nuni account ID ↔ Firebase UID ↔ Nolu 身份映射；不得只按姓名或電子郵件自動合併                                                                                |
| 登入與 session      | Nuni 現有登入與撤銷語意                                                                     | Campus One 使用 Firebase Auth／Firestore／Cloud Functions；Nuni 使用 PostgreSQL 及自己的 session／BFF secrets。需明確的 API adapter、伺服器端 token 驗證與權限對映；密鑰不能互填 |
| Nolu 私人快取       | 身份確認前隔離可顯示快取；換帳號／訪客模式清除原帳號資料                                    | 將瀏覽器事件、storage key、帳號 owner marker 與身份驗證接到 Campus One 的 Web／Mobile lifecycle，涵蓋登出、跨分頁與離線狀態                                                      |
| Nolu 課表處理       | 匯入時的重複與衝堂判定、保留原始課程資訊                                                    | 本輪新增獨立純函數處理校方資料；未移植 Nolu 的 DOM、OCR 匯入或登入系統                                                                                                           |
| Nolu outbox／備援   | 原始碼中的 IndexedDB snapshot、按 owner 分隔的 outbox，以及文件描述的單向同步與重播防護設計 | 尚未移植或完成跨服務驗證。先定義權威資料來源、冪等鍵、衝突及撤銷規則；不得擴稱已涵蓋社群、動態與聊天                                                                             |
| 課程點名            | 本分支的 token 驗證、本人出席紀錄及教師私有簽到碼                                           | 若改由 Nuni API 寫入，須保持相同的會員檢查、原開場教師權限、冪等與結束場次語意；不能讓兩個後端各自累計出席                                                                       |

Nolu 的實際專案是 `Miiduoa/web`，原始碼主要位於 `pu-plan/`，公開入口是 [miiduoa.github.io/web/](https://miiduoa.github.io/web/)，並非 `/web/pu-plan/`。本輪讀取 `pu-plan/import.js`、`features/schedule.js`、`durable-store.js`、`guest-privacy.js`、`provider-config.js`，以及 `supabase/functions/_shared/session-v4.ts` 與瀏覽器 gateway。可參考其重複／衝堂處理、owner 隔離和快取清理；未執行 Nolu 全套測試，也未完整驗證 SQL／relay／ingest／worker 與跨服務復原。來源設定啟用 Neon／Netlify，Render 則停用並標示待資料庫設定，不能宣稱三方備援已完成。

身份契約仍各自獨立：Campus One 使用 Firebase UID；Nuni 的 `apps/api/src/auth.ts` 使用含 personId、tenantId、roles、credentialId 的 campus-account JWT；Nolu 使用帶 uid、iat、exp、cv 的 HMAC session。Nolu gateway 的來源白名單尚未包含 `nuni.tw`。本輪沒有部署 token 交換、帳號映射或資料遷移，也未互換任何服務密鑰。`nuni-v2` 的 preview 登入、Map session 及記憶體資料目前不適合作為正式帳號與交易的權威服務。

## 本輪線上服務核對與部署阻塞

- `https://nuni.tw` 導向 `/auth/account?returnUrl=%2F`，最終登入頁 HTTP 200。`https://api.nuni.tw/health/ready` 與 Fly API 的對應健康端點均回應 200，並回報資料庫可達及平台登入路徑 ready；Fly Web 的 `/health/live` 回應 200。這些是公開入口與健康檢查證據，尚未證明個別帳號登入、校務資料或本輪候選已上線。
- Fly 唯讀查詢確認 `nuni-web`、`nuni-api` 為 deployed，`nuni.tw`、`www.nuni.tw`、`api.nuni.tw` 憑證為 Ready，並沿用 Cloudflare。API 設定為 `AUTH_MODE=campus-account`、`PAYMENT_ONLINE_ENABLED=false`；現有 secret 名稱清單未見 ECPAY／TAPPAY／PAYMENT 項目。這不代表其他 app 或商戶帳號沒有設定。
- `nuni-prod/apps/api/src/payments/config.ts` 與 `app.ts` 已有 ECPay／TapPay 設定、付款 session、簽署轉交網址與 webhook 驗證路徑；本輪未執行商戶交易、退款或對帳，線上付款仍關閉。Campus One 的 Firebase 帳本也尚未與 Nuni 支付系統接通。
- Nolu 公開頁 HTTP 200，主要校務函式入口對 GET 回應 405，只能證明該入口可達，不能替代帶本人 session 的校務查詢。
- 尚缺正式部署映像與來源 SHA 的對應、目標資料庫及帳號轉接的完整驗收。需完成備份還原、身份 adapter、真實資料閉環與可回復發布後，才切換 Campus One 正式流量。

本輪以已登入的 EAS CLI 唯讀確認 Nuni 的既有專案為 `@miiduoa/campus-one`，project ID `8955b97c-802c-463c-bd1d-d5f02e30a966`。已核對的 Nuni production 原始設定使用 iOS／Android `com.nuni.app`，staging 使用 `com.miiduoa.campusone`；這是來源設定與 EAS 專案存在的證據，尚非 App Store Connect／Google Play 上已註冊識別碼與簽署資產的證明。沒有建立新 EAS 專案或覆寫 Campus One 的建置設定。

本輪沒有變更 DNS、正式部署、付款開關或帳號資料。前一版曾讀取的 Fly release 是 Web v31／API v17（均為 2026-09-29），但當時 metadata 沒有來源 SHA；這些 release 編號不是本輪重新確認的最新版本。前一版亦曾確認本機 Firebase／EAS 登入、Firebase 專案清單，以及 GitHub repository／production environment 當時沒有 secrets／variables；這些設定會變動，發布前須重查，不據此推定目前仍為空，也不重複索取已有的憑證。

本輪 CI 與 Functions runtime 使用 Node.js 22；`backend/functions/package.json` 已宣告 `engines.node: "22"`。Firebase 官方文件列出 [Node.js 22 與 runtime 設定方式](https://firebase.google.com/docs/functions/manage-functions#set_nodejs_version)。本 repo 的 `.firebaserc` 預設指向 demo，正式發布必須明確指定已核對的 project ID；CI 缺少 production variable `FIREBASE_PROJECT_ID` 或 secret `FIREBASE_TOKEN` 會失敗，不沿用歷史 [CI 37393275660](https://github.com/Miiduoa/graduation/actions/runs/37393275660) 跳過部署仍成功的語意。

新的本人 session 查詢依賴 `_puSessions` 的 `ownerUid ASC`／`expiresAt DESC` 複合索引。發布順序必須先建立索引、確認目標專案該索引為 `READY`，再發布依賴它的 Functions 與 Web；索引建立包含非同步回填，送出部署不等於可查詢，參見 [Firestore 索引建置文件](https://firebase.google.com/docs/firestore/query-data/indexing#index_build_time)。CI 現在以 `scripts/wait-for-firestore-indexes.cjs` 查詢目標 Firestore Admin REST，包含分頁與隱含的 `__name__` 排序；全部必要索引 `READY` 才繼續。缺少或仍在建立的索引最多等待 20 分鐘，維修狀態、權限錯誤及無法確認的回應會阻擋發布。這個 gate 已完成本機回歸，尚未以正式專案執行。該 job 已包含 Firestore／Storage rules 與 indexes，再部署 Functions；不部署 Web 或 Mobile。完整發布仍須核對各部分版本與相容性。

## 2026-10-08：地圖、校園資訊與發布流程

以 PR #21 的 `00914c6457ae3ca5d2fd0359346110a237f679a1` 為起點，延續既有紙白／墨綠設計。

- **Web 地圖**：只讀伺服器校園地點，移除台北示範座標、營業時間及直線步行估時；以地點座標開啟 Google 步行導航。修正 Leaflet 延遲載入、地點更新及名稱被解讀為 HTML 的問題。收藏使用本人／學校範圍的交易，寫入失敗不顯示已收藏，換帳號清除舊狀態。
- **App 設定**：顯示真實帳號與版本，主題即時切換；登出執行身份與快取清理流程。移除虛構裝置數、同步時間與無作用操作。法律連結沿用正式環境設定。
- **App 公告與活動**：列表與詳情改讀校園來源；只在正式集合成功且空時才查舊集合，讀取失敗保留重試。附件僅開啟有效 HTTPS 網址，活動支援分享及行事曆匯出。換帳號、學校或詳情即隔離舊回應。已掛載頁面切換主題時，內文與錯誤文字同步更新。
- **發布**：補齊公告／活動的舊集合複合索引，以及索引 READY gate。修正 Release workflow 的 Jest／Vitest 無效參數；固定 EAS CLI 24.12.0，核對本次產物的來源提交、專案、平台、profile、原生識別碼與完成狀態，再以確切 build ID 提交。Apple 提交值經驗證後只寫入 CI 暫存 checkout，不使用 EAS 不支援的字串插值。所有指定平台成功才建立 GitHub draft release。詳見 [發布流程](RELEASE_PIPELINE.md)。

本機已執行完整 Web／Mobile 測試、workspace typecheck／lint、Web production build 與 iOS／Android development export。地圖新增 22 項測試；Mobile 新增設定、來源讀取、公告／活動操作及已掛載主題切換回歸。地圖另在只替換來源的隔離 fixture 檢查 390／1365px × 深／淺色 × 有資料／錯誤／空資料共 12 個版面狀態，搜尋、分類、標記選擇、重試及導航網址均已操作；沒有水平溢位或頁面例外。fixture 明確使用合成資料，未寫入正式來源。完整套件數與最終 SHA 以 PR 對應 CI 為準；下節的測試數保留原版本範圍。

仍待正式環境驗收：本人收藏、校園地點正確性、公告／活動實際資料及實機分享。活動列表目前取 startsAt 降序前 100 筆，尚無完整分頁；活動報名需要伺服器交易與權限契約，不能把行事曆匯出當作報名成功。Nuni 身份映射、帳本轉接、線上金流、資料遷移、商店識別碼／簽署及正式部署仍未完成。

本次唯讀查到 Nuni 的 EAS 專案確為 `@miiduoa/campus-one`（`8955b97c-802c-463c-bd1d-d5f02e30a966`），已將 Campus One 的 Expo slug／owner 對齊。最近的 Android build metadata 中 appIdentifier 是 Gradle 運算式，不能視作實際安裝包或商店登記 ID；原生識別碼仍需以正式產物與商店帳戶核對。GitHub repo 與 production environment 當時皆未配置 secrets／variables，發布 workflow 尚不能據此執行正式建置或部署。

## 歷史檢查點：00914c6 之前的整合實作與驗收

主要功能版本：`5e609faeedc19153a5055aa9b755d2b3c08afc99`；後續提交另修正教師工作台換行、部署依賴與 Functions 封裝。尚未部署正式環境、切換 Nuni 網域、提交或通過商店審查。

### 已實作的真實流程

- **Web 服務頁**：公告與詳情讀取正式校園來源；群組／社團只列本人有效成員關係，邀請碼加入與退出透過伺服器並確認結果。私訊只顯示本人本校既有對話，訊息送出與已讀使用 transaction；列表依更新時間顯示最近 100 個對話。通知使用正式資料及已讀寫入，不再提供本機假核准／假下單。
- **課務與教學**：延續本人課表、成績與學分規劃。教師工作台與成績簿核對學校、課程及角色後才讀取教材／作業／成績；帳號、學校、課程或權限變動會清除舊結果。舊教材網址共用此工作台；測驗、題庫與評分規準仍未開放，不再顯示虛構測驗或發布成功。
- **設定、搜尋與圖書館**：儲存個人資料時固定帳號，鎖住編輯欄位並讀回確認；讀取或確認失敗禁止續寫，需先重新讀取。移除沒有實際作用的公開頁、活動分析、自動同步及英文介面開關。搜尋改為真實服務入口。圖書館提供正式館藏查詢及本人借閱帳號入口，續借與預約在館方網站辦理，不在本機模擬成功。
- **Mobile**：失物招領使用正式同校列表、刊登、本人編輯與結案；選課助理讀取校方目錄並使用實際後端回覆，不提供固定推薦／GPA 或假選課成功。餐廳使用正式菜單，明確啟用的店家與餐點才提供到店付款訂單；舊 Ordering 路由共用此流程。文件列印、付款紀錄沿用前一檢查點的真實來源與裝置功能。
- **訂單交易**：三個可呼叫的建立入口（`createOrder`、`executeAgentWrite` 的訂單工具、`aiOrderFood`）共用同一 transaction 核對會員、店家、營運者、菜單價格與可售狀態。固定 `requestId` 綁定 UID，同一意圖重試回原單；換意圖拒絕。確定未建立的結果也原子保存，提交成功後才允許清除重試記號；收據使用私有摘要驗證。Mobile 跨畫面操作序列化，舊回執不能清掉新 pending，SDK 切換帳號不能替新帳號送出舊草稿。線上付款並未啟用。
- **權限與部署順序**：正式訂單及本人訂單鏡像均禁止客戶端直接寫入，價格與狀態改由既有 callable 管理。群組成員、本人索引與人數在同一 transaction 更新。CI 現包含真 Firestore 並行測試；正式部署先發佈 rules／indexes，再發佈 Functions。仍須確認 index 已 READY 才開放新查詢，CLI 部署返回不代表索引已完成。
- **視覺與名稱**：延續 Campus One 紙白／墨綠、共用頁首與服務框架，統一新增頁面的手機／桌面及深淺色樣式；原生可見名稱亦統一為 Campus One。保留有用助理能力與原始授權／變更紀錄，移除過度標籤、虛構成果及模板操作。

### 執行證據

| 驗證                   | 最新本機結果                                                                                                                | 邊界                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Web                    | 336 通過、1 跳過；43 suites 通過、1 跳過                                                                                    | 含來源錯誤、帳號切換、收據與權限相關測試；不是正式帳號 E2E                                     |
| Mobile                 | 1,487 通過、1 跳過；117 suites 通過、1 跳過                                                                                 | 非真機全功能驗收                                                                               |
| Functions              | 337 通過，39 suites                                                                                                         | 含三個訂單入口與交易處理器                                                                     |
| Rules + Firestore 並行 | 56 通過、0 跳過：47 rules／既有點名測試 + 9 新群組／訂單並行測試                                                            | 真本機 emulator；隔離 project，不更動正式資料                                                  |
| TypeScript / lint      | 全 workspace typecheck 通過；0 error、724 warnings                                                                          | 既有警告尚未全部清理；不是零警告承諾                                                           |
| Web build              | production build 通過                                                                                                       | 建置未部署                                                                                     |
| 瀏覽器                 | 19 個更新路由 × 390／1365px × 深／淺色，共 76 未登入狀態，無頁面例外、HTTP error 或水平溢位；搜尋「借書」命中正式圖書館入口 | placeholder 詳情只驗證登入／不存在／未開放狀態；另有私訊 12 個合成資料版面狀態檢查，非真實傳訊 |
| iOS / Android export   | development 設定 JavaScript 與資產打包通過，各約 13 MB                                                                      | 未簽署；原生名稱變更另通過 plist、development Expo config 驗證，ID 未修改                      |

共 2,216 項通過、2 項既有跳過。已核對 [CI 37705225149](https://github.com/Miiduoa/graduation/actions/runs/37705225149) 在 `28bd6dd0806150a2fb5acee8a4bff8a9c2a4667a` 全部九個驗證 job 通過，部署 job 跳過；下載 Web artifact 確認包含 1,268 個建置檔案及 manifests，沒有 cache。該提交僅在主要功能版本後更新文件，尚不包含後續版面、依賴與封裝修正。PR 後續狀態仍須查對當前 SHA，不能把先前 CI 綠燈套到新提交。[iOS smoke 37705225138](https://github.com/Miiduoa/graduation/actions/runs/37705225138) 亦在同一 `28bd6dd` 提交完成原生建置、JavaScript bundle 及訪客登入導覽測試，完整／指定功能 suites 依 workflow 條件跳過。這不涵蓋真正登入、已登入流程、簽署商店版本，以及之後的 Web／後端部署修正。

後續教師工作台版面修正另以合成資料保留真實頁面、hook 與 CSS，重驗教師／成績簿／群組三頁的 390／1365px 與深／淺色，共 12 種狀態。修正長標題與教材連結換行後，各頁 `scrollWidth` 均等於視窗；長文字完整保留。成績簿的寬表只在表格容器內橫向捲動，零分與未登錄維持不同狀態。教師頁原有三項行為測試也通過。此驗證不是正式教師帳號或真實資料 E2E。

後續發布依賴修正將 Firebase Admin 固定到 [`13.10.0`](https://firebase.google.com/support/release-notes/admin/node)，從正式 Functions 依賴移除 `node-forge`，並同步 pnpm 與 Functions 獨立 npm 鎖檔。部署目錄的舊 npm 鎖檔另有 2 critical，先前 workspace audit 未涵蓋；本輪採相容版本修補 proxy-addr、websocket-driver、busboy、grpc-js、xmldom、fast-xml-builder、form-data 及 protobufjs，並讓 xmlbuilder2 使用保留 `safeLoad` 的已修補 [js-yaml 3.15.2](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh)，避免全域 4.x override 破壞既有 API。

修正後重新稽核：Functions 正式 npm 依賴為 **0 critical／0 high／14 moderate／2 low**；workspace 為 **0 critical／4 high／11 moderate／3 low**。兩種報告範圍不同，不能用其中一份代替另一份。Functions 的完整 337 項測試及使用新版 Admin 的 56 項 rules／實際 Firestore 並行測試均通過。CI Security Gates 新增 Functions 部署套件的隔離驗證與獨立 npm audit，保留兩份稽核報告且阻擋 critical；隔離驗證包含 `npm ci --omit=dev --ignore-scripts`，不等於已執行雲端部署或 install lifecycle。

隔離部署驗證曾實際發現 Functions 從 source 目錄外載入 `packages/shared/dist-cjs` 的失敗。本輪讓部署前與測試前使用同一 TypeScript 編譯流程，產物位於 `backend/functions/generated/shared`，八個 runtime 消費檔改用部署目錄內的路徑。驗證腳本使用 Firebase CLI 真正的 archive packer，解壓到獨立目錄、執行正式 npm 乾淨安裝，再載入入口與所有共用模組消費者；實測成功載入 107 個 exports，所有檔案模組均位於封裝目錄內，並於完成後清理暫存。另修正 Firebase CLI 所需 minimatch 函式 API 被全域 9.x override 破壞的問題，針對該 CLI 固定到已修補且相容的 3.1.5。此驗證已接入 CI，不依賴 monorepo 旁邊的共用資料夾，也沒有呼叫正式 Firebase 服務。

建置工具亦另行稽核：針對 get-uri 6.0.5 原本允許的 5.x 範圍，將 basic-ftp 固定到 5.3.1，清除 CLI 依賴的 critical 與三項 high；未強制升到 6.x。含 dev 的完整 workspace 稽核為 **0 critical／31 high／68 moderate／8 low**，CI 另保存這份報告並阻擋 critical。basic-ftp 的另項 high 及其他工具鏈風險仍存在，不得把 Functions 正式套件的零 high 延伸為整個 repo 零 high。

workspace 剩餘 high 包含 Metro 圖片解析、Expo 工具鏈的 node-forge 與 braces；本輪未以跨 major override 改動 Expo／Metro。仍須處理剩餘 moderate／low 與工具鏈風險，不能以零 critical 宣稱所有依賴風險已排除。文件末尾的可達性核對保留為歷史紀錄；其中「Functions 存在 node-forge」已由此次 Admin 升級解除。

### 仍需完成的發布關卡

1. Nuni 帳號 ↔ Firebase UID 的可驗證身分轉接、正式服務目標、真實校務帳號與店家資料驗收；未按姓名或 email 自動合併。
2. Firestore 索引完成、歷史失物所有權與舊訂單／對話的資料稽核及必要遷移。手動 backfill 會保留舊價款，不代表那些歷史價款可信。
3. 商家金流憑證、交易／回調／退款驗收。現有到店付款訂單不等於線上支付整合。
4. 既有 Nuni 商店 App ID／Team／簽署身分核對。tracked iOS 的 Debug／Release 仍固定 `.dev`，`APP_ENV=production` 不會自動覆寫；正式 IPA／AAB 與審查帳號均尚缺。詳見 [商店審查準備說明](legal/app-store-review-notes.md)。
5. 教學管理身分綁定、尚未開放的測驗／題庫／評分規準及新對象私訊建立，需完成各自的正式資料契約後才能宣稱可用。舊助理下單呼叫若缺固定編號或確認金額，會明確拒絕；不能把後端安全 adapter 當成完整對話下單已開放。

## 歷史檢查點：課務、付款紀錄與列印（faace6a）

### 真實校務資料與本人權限

Web 的成績、課表與學分規劃共用 `AcademicPage` 和 `useAcademicRecords`，透過 `getMyAcademicRecords({ dataType: 'courses' | 'grades' })` 取得校方來源資料，不以 Firestore 私人自寫快取當成校方結果。服務端以 Firebase UID、token 與 profile 的靜宜學校識別、active membership，查詢本人最新且未過期的 `_puSessions`，只使用服務端保存的校務 cookies。呼叫者不能指定其他 UID、session ID 或學期；校方查詢返回後再次檢查 membership。成功回應包含 ownerUid、schoolId、source 與伺服器 fetchedAt，前端核對身份並阻擋換帳號或較舊請求的晚回應。

`backend/functions/academicRecords.js`、`apps/web/src/lib/academicClient.ts` 與 `useAcademicRecords.ts` 區分需重連、無權限與來源暫時失敗；明確校方登入失效才回覆重連狀態，不把網路或版型解析失敗當成空資料。`backend/functions/lib/puCourseTime.js` 與 `apps/web/src/lib/academicRecords.ts` 保留星期一至日、節次與原始上課時間；未知或無法完整解析的多段跨日時間保留原文及提示，不捏造 08:10 或只取第一段冒充完整課表。衝堂檢查依實際節次處理，不把中間空堂算成重疊；沒有有效課程群組對應時不建立假深連結。

成績保留來源中的數字或文字，包括 0、Pass、未到及未知文字。加權均分只使用已知數字成績與對應學分；修課學分包含來源紀錄中的重修及未通過科目，不宣稱是 GPA、已取得學分或畢業資格。學期只採用來源；學分規劃的可採計學分、目標與預計修課由本人填寫，試算不更改學校紀錄，也不在離頁後保留。

### 付款紀錄與文件列印

Mobile 付款頁從目前 Firebase UID／school 範圍的伺服器帳本讀取餘額與最近 100 筆交易，核對幣別、金額及狀態；缺少錢包時顯示未提供餘額，不造零元或樣本交易。可搜尋／篩選與匯出目前資料；CSV 防止文字被當成公式，換帳號及延遲回應不沿用舊帳戶畫面。這是 Campus One 既有帳本的讀取能力，不表示 Nuni 歷史交易已匯入。儲值、帳號間轉帳及付款碼仍未開放，後端拒絕轉帳 intent，不能由前端顯示假交易完成。

文件頁可選取裝置上的 PDF、PNG、JPEG 或 Word，檔案上限 25 MB；PDF／圖片交給系統列印或文件預覽，Word 交由其他 App 開啟或先轉 PDF。瀏覽器只開啟選取的檔案，不把整個 App 頁面送去列印；分享與儲存依裝置能力提供明確錯誤。取消不顯示成功，切換帳號／學校後不顯示之前選取的文件。此能力不包含校園印表機接單、排隊、收費或完成回報；`submitPrintJob` 維持拒絕未提供的遠端列印服務，不建立假訂單或增加假佇列。本輪未完成實體印表機及真機分享驗收。

### 本輪執行結果

下表是本輪程式碼候選 `faace6a` 在 Node.js 22 的驗證結果；正式發布前須綁定產物與實際部署版本。本輪結果與後面的上一版歷史數字分開記錄。

| 檢查                     | 本輪結果                                                     | 範圍與限制                                           |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| Web 測試                 | 173 通過、1 跳過；27 suites 通過、1 跳過                     | 不等於正式校務服務連線驗收                           |
| Mobile 測試              | 1,365 通過、1 跳過；109 suites 通過、1 跳過                  | 不等於實機或商店驗收                                 |
| Functions 測試           | 259 通過，35 suites                                          | 包含本人校務資料及尚未開放服務的邊界                 |
| Firestore／Storage rules | 46 通過，5 suites                                            | 本機 emulator 結果，未表示 rules 已部署              |
| Workspace TypeScript     | 全部通過                                                     | Web、Mobile、shared                                  |
| Lint                     | 0 errors；Mobile 637、Web 96、Functions 4、shared 2 warnings | 包含本輪新增的 1 項 hook warning，不能全部歸類為既有 |
| 建置                     | Web production build、iOS／Android development export 通過   | 雙平台 export 沒有產生簽署安裝包                     |
| Expo Doctor              | 16/16 通過                                                   | 另有 2 項既有停用檢查，發布前仍須核對                |
| 依賴 audit               | 0 critical、4 high、13 moderate、3 low                       | 本輪重新執行；不是零風險或可直接發布的證明           |

有資料狀態另以暫存、明確標記的合成測試資料驗證成績、課表、學分頁，保留真實頁面、共用外框、hook、正規化及 CSS，只替換身份與資料邊界。三頁各測 390px／1280px 與深／淺色，共 12 種狀態；最終每頁 `scrollWidth` 均等於對應的 390 或 1280，未見橫向溢出。長課名、長文字成績、週末課程與無法完整解析的跨日時間均保留可讀內容；學期篩選、搜尋、成績排序、星期篩選及學分試算已操作驗證。過程找到並修正成績頁長文字在 390px 溢出的問題，修正後重跑全部 12 種狀態。

這些測試資料、harness 與截圖只存在暫存工作目錄，未放入產品程式或作為正式校務成果。此驗證不涵蓋真實校務帳號登入、正式索引就緒、跨專案身份串接、付款交易或商店發布；上述事項仍待對應環境的實際驗收。

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

## 歷史紀錄：上一版管理登入與角色權限驗收

本節保留上一版的實作與獨立 SQL 實驗證據。React 權限測試已包含在本輪完整 Web 測試；PostgreSQL 實驗本輪未重跑，也未套用到正式資料庫。

目前沒有經驗證的 Firebase／Supabase 身份連結，因此教學管理頁保持關閉，不掛載管理內容，也不讀取或顯示先前 Supabase 帳號的個人資料。校園帳號初始化、切換與登出時會清除本機教學服務 session；清除失敗仍不開放管理內容。`RequireAdmin` 與 `AuthGuard` 的 10 項 React 測試已通過，涵蓋登出、換帳號，以及延遲或失敗的 session 清除回應。

新增的 `supabase/migrations/20261008000000_protect_profile_role.sql` 僅補上角色變更防護，保留既有 RLS；尚未套用至正式資料庫。已在自建、用後移除的 PostgreSQL 18 測試資料庫執行實際 migration 與 `supabase/tests/profile_role_authority.sql`，使用既有 profiles schema／RLS、`SET ROLE` 與 JWT claims 的本機 auth 函式替身，確認一般使用者無法自改或自行插入管理員／教師角色、可修改一般個人資料，既有管理員及 service role 可執行授權的角色變更，缺少 profile 不會取得管理權限。此驗證未更動共享或正式資料庫，也不等於已驗證託管 Supabase 的完整設定。部署前必須核對目標 schema／RLS，稽核現有教師與管理員 profile 的授權來源；新增防護不會自動撤銷過去已被錯誤授予的角色。

## 歷史紀錄：上一版視覺與功能驗收

以下測試數、路由數、Expo Doctor、lint 與 audit 數值皆為較早版本紀錄，不是最新候選結果；以「最新候選實作與驗收」為準。

Web 與 Mobile 共用紙白／墨綠主色、語意狀態色、字級層次及深色模式。Web 頁首、服務選單、頁尾、登入回呼、條款與錯誤頁使用共同框架；Mobile 的今日、課程、個人、交通與 LMS 畫面沿用共同元件及 tokens。補查後將社群、好友、私訊、點名、商家輸入欄位、通知與共用表單的靜態顏色改為隨主題更新；品牌底文字使用對應前景色，避免深色模式白字配淺綠底。這是程式與本機畫面的驗收，尚未完成所有角色的實機逐頁驗收。

- 自動檢查：Web 133 項、Mobile 1,319 項、Functions 165 項與 Firestore／Storage rules 46 項測試通過；Web／Mobile 各保留 1 項既有跳過測試。Workspace TypeScript 與 Web production build 通過；Mobile 以 development 設定完成 iOS／Android export，並未產生簽署安裝包。
- Web：55 個路由的未登入狀態均回應 200，390px 寬度沒有橫向溢出或未處理的頁面錯誤；另複查個人、登入回呼、教學管理、助理、公車、條款與隱私頁的深／淺模式共 14 種狀態。使用占位 ID 的詳情頁只驗證登入／不存在狀態，不能替代有資料的功能驗收。
- 公車只接受來源為 TDX 且仍在有效時間內的即時結果；尚未設定學校路線、站牌與正式服務憑證時不顯示預估時間。Mobile 尚無可驗證的車輛追蹤服務，因此不提供模擬位置、到站震動或假位置分享。
- Mobile 個人資料使用實際寫入及回讀確認；舊成績／學業總覽／成就／教師評分路由已移除固定 GPA、比較排名、假徽章、示範學生及假儲存完成。成績只呈現本人目前學校已發布資料，教師入口先核對授課關係及課程 ID；缺資料顯示空或錯誤狀態。
- 校園助理僅呈現實際 callable 回覆，失敗保留草稿；對話不送出訂單或顯示未經確認的交易成功。登入、課程切換與清除對話會隔離舊回應。
- iOS／Android export 驗證 JavaScript 與資產可打包；不等於原生簽署、TestFlight、Play internal、真機或商店通過。Expo Doctor 依目前專案設定通過 16 項檢查；既有排除項仍須在正式發布前核對。
- 上一版正式依賴稽核記錄為 4 high、13 moderate、3 low、0 critical；當時完整 lint 無 error，仍有 warning。這些歷史數字不能代替本輪或發布前的重新稽核；依賴問題、登入資料轉接、點名歷史遷移、真實資料驗收及簽署發布均須處理，不能只以本機編譯成功宣稱產品已上架。

## 歷史紀錄：上一版原生 iOS 建置修正

以下 CI run、Pods 數量、bundle 大小／時間及 17 項登入測試屬於對應歷史版本；本輪未以這些數字宣稱新的原生 UI 測試、簽署產物或商店發布成功。

主要 [CI 37652160901](https://github.com/Miiduoa/graduation/actions/runs/37652160901) 在 `0c21fa0` 通過；獨立 [Maestro run 37652160826](https://github.com/Miiduoa/graduation/actions/runs/37652160826) 的原生階段則因 `prebuild --clean` 覆蓋已提交的 Podfile 設定，在 FirebaseCoreInternal／GoogleUtilities 模組整合時失敗，未執行 UI 測試。後續修正改為直接安裝、編譯已提交的 iOS 專案，保留 static frameworks 及 llama-rn／RNFirebase hooks；已在暫存副本成功安裝 118 個 Pods，確認 workspace、scheme 與原生設定。

Workflow 選擇已安裝且可用的 iPhone simulator、等待啟動、編譯後讀取實際 bundle ID 並安裝 App；失敗不再由 continue-on-error 隱藏。[Maestro 37653836784](https://github.com/Miiduoa/graduation/actions/runs/37653836784) 在 `654a60b` 已完成原生編譯、App 安裝與 Metro 啟動，但首次程式打包超過畫面等待時間；失敗截圖顯示 Bundling 67%，尚未通過登入畫面驗收。

後續 workflow 在測試前，以 AppDelegate／RCTBundleURLProvider 相同入口與參數取得實際 iOS bundle，要求 HTTP 成功、JavaScript content type 及非空內容，設 600 秒上限；只等待 `/status` 不再視作畫面可啟動。獨立本機 Metro 驗證 HTTP 200、24,963,236 bytes，首次 6.745 秒、暖快取 0.082 秒，未更動畫面等待條件。預設 smoke 只驗證全新安裝的未登入首頁與登入入口；登入後角色流程需要另外準備測試帳號，不可用未登入測試替代。完整 UI 結果仍須以後續對應 commit 的 workflow 為準。

[Maestro 37657286564](https://github.com/Miiduoa/graduation/actions/runs/37657286564) 在 `ba66daa` 已取得 HTTP 200、24,943,461 bytes 的 iOS bundle，並通過未登入首頁檢查。進入學校登入頁時，Google provider 因缺少 `iosClientId` 在 render 階段丟出例外。後續修正讓 Google 登入僅在目前平台有設定時初始化，未設定時保留學校帳密表單；原生授權碼以 PKCE 交換憑證，取消或交換失敗會解除表單等待，不能顯示登入成功。17 項登入回歸測試保留實際 Google provider 的平台檢查與回應型態；模擬底層授權／交換成功、失敗與重試。修正後的完整 UI 結果仍以對應 commit 的 workflow 為準。Debug 截圖僅作驗證證據，不作商店素材。

## 歷史紀錄：上一版依賴可達性核對

以下為 2026-10-08 上一版針對 audit report、lockfile 與呼叫位置的核對。該段保留歷史判斷；最新稽核與 Functions 修補以「最新候選實作與驗收」為準，不能把下列舊依賴鏈當作當前狀態。當時 4 項 high 來自 3 個套件，不能直接等同正式站有 4 個遠端可利用入口：

- `image-size@1.2.1` 的 [JXL／HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) 與 [ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) DoS 影響 Metro 素材解析；惡意圖片進入本機或 CI 建置輸入時可達，未找到使用者上傳接到此解析器的流程。修正版為 2.0.3 以上，但 Metro 0.83.3 仍使用 v1 同步檔案路徑 API，不能直接 override 2.x。待相容修補、惡意／正常素材回歸及 Mobile export 驗證。
- `node-forge@1.4.0` 的 [RSA 簽章公告](https://github.com/advisories/GHSA-86w9-cpqp-85rv) 在上一版核對時尚無已發布修正版。它也存在於 Functions 的 firebase-admin 依賴；當時核對 Admin 呼叫點為 service-account 私鑰解析，JWT 驗證走 jsonwebtoken，未發現外部簽章進入 forge verify 的現有路徑。Expo CLI 的使用限本機簽署／憑證設定，App 未設定 codeSigningCertificate。這是當時的可達性核對，未執行漏洞 payload。
- `braces@3.0.3` 的 [遞迴 DoS 公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 在上一版核對時尚無修正版；當時經 Expo／Jest／Metro 工具鏈引入，未找到外部輸入作為 pattern 的 runtime 入口。若增加外部 pattern、憑證驗證或素材建置入口，必須重新核對。

上述條件仍須在發布前處置或留下明確風險決定；目前只阻擋 critical 的 CI 綠燈不能替代這些項目的安全驗收。
