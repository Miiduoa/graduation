# TronClass 獨立綁定與作業整合

更新日期：2026-11-23。此文件描述本分支的實作與驗證範圍；先前已完成指定真人帳號的校方唯讀抽樣，尚未完成 nuni 真人綁定、正式繳交及 Web 部署驗收。

## 2026-11-23：可取消的綁定、重新查核與最新 main 整合

接續 `04ca3983` 並合併 main `f7f5acba`，將 Web／Mobile 的登入取消串到 BFF、校方原生登入、CAS 與綁定交易。離頁、真實帳號切換或按「取消連接」時停止舊操作；取消後先重讀綁定狀態，不假設可回滾已完成的交易。相同帳號的 session 物件更新與背景 Firebase 更新不再誤取消正常登入。

同時修正主線整合後的課程快取恢復，清除獨立壞資料列但保留有效課程，並持續拒絕其他課程參照、重複編號、401 與過期部分結果。AI 助理的主線新功能與 TronClass 私人資料隔離均保留。

最後版本 Web 回歸 **2,521 項通過、38 項環境相關略過**，Mobile 指定三檔 **185 項通過**，完整兩端 TypeScript 通過。完整本機服務另確認 Auth／Firestore 與公開測試綁定狀態可運作，但雲端瀏覽器無法連入該本機服務，因此沒有真人綁定、上傳或繳交成功的結論。production writer 維持未開放；本輪程式來源、測試、首次 typecheck 中止與重跑結果、真人驗收限制詳見 [本輪紀錄](tronclass-binding-recovery-2026-11-23.md)。

## 2026-11-18：原生課程接線、草稿生命週期與受控驗收入口

提交前已整合同期 `b19dc420`（含 main `a5d70b68`），保留其個人補交／重繳／校方草稿狀態、較完整的 Session 草稿修正，以及真正 Next／Auth／Firestore 隔離驗證環境。新版 [個人繳交狀態](tronclass-submission-windows-2026-11-18.md) 與 [綁定驗證環境](tronclass-runtime-verification-2026-11-18.md) 也納入本輪回歸；沒有用本輪近似實作覆蓋同期工作。

接續 `a77a2410` 的整合查核發現，Mobile client 雖然會發送新 `courses` action，Platform 與 Firebase 的真實傳輸層尚未將它列入允許清單，請求會在抵達 BFF 前失敗。兩條傳輸路徑現已加入此唯讀操作，沿用固定 BFF、目前身分、取消及一次喚醒重試；上傳與正式繳交仍不重試。新增兩項真實 transport 回歸先重現原錯誤，修補後相關 **5 suites／196 tests 通過**，完整 Mobile TypeScript 與修改檔案 ESLint 通過。

站內 `prepare` 原先沒有將 HTTP 取消訊號傳入課程、作業詳情及本人歷史的完整讀取鏈。現在 public adapter 建立共用 **50 秒總期限**，涵蓋綁定、唯讀準備、歷史及後續即時授權；legacy 唯讀準備沿用同一個 context。每個來源請求使用同一 AbortSignal 與最多 **8 秒、且不超過剩餘總預算**的期限，分頁及每次 await 前後重新檢查。請求已取消或時間耗盡時，來源即使忽略取消並稍後回覆，也不能啟動下一頁、本人歷史、授權或回傳舊 preparation。

取消會回固定 `TRONCLASS_READ_TIMEOUT`；詳情／歷史的降級處理不能把取消改成部分成功。計時器與事件監聽在完成後清除，來源平行查詢也會停止後續工作。這個唯讀請求的取消不操作 final claim 或提交鎖，既有 `cancel-preparation` 與 unknown／reconcile 語意維持各自的用途。

合併同期版本前，以真正 public adapter、legacy reader 與來源 normalizer 搭配合成 provider 驗證，**7 檔／358 項通過、0 失敗、0 略過**；包含 course／page／detail／history 刻意忽略 signal 的晚回、晚到錯誤、永不完成的 binding、下一頁停止、剩餘預算與即時授權取消。合併後個人 availability reader 也接入同一取消鏈，保留其額外 15 秒上限；新增取消與總期限耗盡後晚回的回歸，避免 optional fallback 把整段取消改成成功。合併處含 default factory、公開服務、legacy 與 acceptance 的 **5 檔／197 項通過**。這些是程式回歸，不是校方登入或送交驗收；production `contractVerified: false` 保留。

**背景確認登入不再丟掉同一身分的頁內草稿。** 真正 `NuniSessionProvider` 的 `pageshow` refresh 會暫時卸載授權工作區；文字與 File 現移到依 nuni owner／session context 隔離的記憶體容器。確認期間仍隱藏課程及草稿，重新取得校方 status、相同 student key 與新的 prepare 後才恢復編輯，不保留舊寫入授權。換 owner／context、登出或換校方學生會丟棄草稿。這沒有增加 localStorage、雲端或跨頁持久化。

新增可實際執行的 [本機受控驗收入口](../../scripts/tronclass/ACCEPTANCE.md)：`preflight` 產生最長五分鐘、HMAC 簽署且綁定精確文字 digest 的計畫；`dispatch` 需要同一 operation、內容與明確確認，沿用持久化 final claim；`reconcile` 只查原 operation。只處理 PU 一般期間、首次個人純文字作業，拒絕附件及既有作業版本。私有輸入、固定 server runtime、一次執行標記與未知結果保留原鎖已實作；兩份不同文字的同 operation 計畫競爭時，輸家保留內容衝突，不能借用另一份結果。核心 **33／33**、真正 esbuild runtime CLI **6／6** 合成回歸通過；後者已加入 CI，沒有執行真人 preflight 或校方繳交。

前一版 `a77a2410` 的實際 Next／Docker Chromium 驗收在返回清單後恢復草稿時失敗，見 [原始 CI](https://github.com/Miiduoa/graduation/actions/runs/44274879965)。後續 `b19dc420` 與 [`a7fe03f1` 的失敗 artifact](https://github.com/Miiduoa/graduation/actions/runs/44285530398/job/134740135047) 已保存當下畫面與 DOM，確認兩版草稿文字、附件都已恢復，且只有初始 session 讀取與 pageshow；不是背景 session refresh 的另一個資料損失案例。

**已定位並修正恢復後的欄位標籤。** 原本 `<label>` 包住 `<textarea>`；React 回填文字後，textarea 的 `textContent` 也成為 label 的一部分，Playwright 的精確 `作業內容` 標籤便不再匹配。現在將標籤和輸入框分開，用原有 `htmlFor`／`id` 明確關聯，容器沿用原 grid／gap 樣式。既有恢復草稿回歸另檢查標籤文字固定不變。瀏覽器仍使用同一 `get_by_label(..., exact=True)`、原內容斷言與 5000ms；沒有改選擇器或放寬期限。原 DOM 與截圖來自真正 CI Chromium；本機 Chromium 啟動被 socket 權限限制，另做的 React／jsdom 重現不冒稱瀏覽器驗收。

瀏覽器腳本會在失敗頁關閉前保存 actions、DOM、文字、console 與最後畫面；有期限的取證即使再次失敗，也保留原斷言錯誤。本版修補後的完整 Chromium 結果以新 commit 的 CI 為準。

標籤回歸先在原碼重現「作業內容我的心得」不等於固定欄位名稱；修正後真正 Workspace 與 Session Provider **2 檔／65 項通過**，修改的 TSX lint 與 diff 檢查通過。沒有把這個局部結果當成新版本完整瀏覽器驗收。

獨立固定快照 [#710 iOS 驗證](https://github.com/Miiduoa/graduation/actions/runs/44276403344) 已完成 Release 建置與兩條訪客 smoke，兩份 JUnit 各 1 項、0 失敗；測試涵蓋登入與校園地圖的明確不可用／重試狀態，並非校方登入或寫入。其 tree `57f102625d7a6ef4610526215ece72901737e15f` 只涵蓋 `a77a2410` 的固定 merge 快照，不能替代本輪 Mobile 修改的原生驗證。

本輪使用 Node **22.23.5**。合併 `b19dc420` 前，TronClass Web 回歸 **66 檔／2,238 項通過，4 檔／38 項環境相關測試略過**。合併後擴及新增 Login／Admin 隔離案例的 Web 範圍為 **2,464 項通過、38 項略過、1 項 5 秒逾時**；該 final candidate 檔以原斷言和原期限獨立重跑 **34／34 通過**，不將第一次全範圍結果寫成全綠。Mobile TronClass **14 檔／278 項通過**，CLI privacy／TTL／acceptance／隔離 launcher 合計 **42／42**；子集合不重複相加。

完整 Web TypeScript 增量檢查、完整 Mobile TypeScript、修改檔案 ESLint、Python 語法與 diff 檢查通過；合併前最早一次非增量 Web typecheck 曾遭 SIGKILL，沒有據此宣稱那次檢查通過。本輪精確新 SHA 的遠端完整專案、Chromium 與原生結果另以 GitHub Actions 為準。

## 2026-11-18：獨立課程清單、多份頁內草稿與校方媒體下載

本輪接續 `1a1eb8db`，合併 main `dcb1b9af`，修正三個會中斷工作區操作的問題：

- **課程清單不再等全部作業同步完成。** 新增 `courses` action，只讀本人 ongoing／upcoming 課程。Web／Mobile 可先選課；全量同步逾時時，已取得的清單仍可用。選課會讀取該課程作業、公告與教材，較晚回傳的舊結果不會蓋掉新選擇或新課程清單。清單與完整同步各有獨立的 6 次／分鐘配額，總請求仍受既有 60 次／分鐘限制。
- **返回清單或切換作業保留文字與附件。** 同一個已驗證學生最多保留 5 份目前工作區草稿；滿額時先要求繼續或清除，不會默默淘汰舊稿。恢復前重新讀取作業條件，重新預覽及確認；不沿用舊上傳 ID 或送出權限。Mobile 附件清理會合併所有草稿的引用，避免在另一份作業選錯檔案時誤刪原稿附件。離開／重整工作區仍會清除，這不是持久化雲端草稿。
- **支援校方已查明的媒體下載轉址。** 教材與本人繳交附件允許校方 blob 回應一次嚴格受限的 302，目的地只接受已實測的 `media.pu.edu.tw` 簽名下載形狀。第二跳不帶校方 Cookie、平台 Authorization、CSRF 或 Referer，仍保留下載前後授權、整段期限及完整 bytes 核對。公開來源與傳輸驗證見 [媒體下載查核](tronclass-media-download-verification-2026-11-18.md)。

### 本輪驗證與範圍

使用 Node **22.23.5**，整合後 Web TronClass 回歸 **63 個測試檔通過、2,187 項通過**，另有 **4 檔／38 項環境相關測試略過**；Mobile TronClass 回歸 **14 個測試檔、266 項通過**，兩者均為零失敗。完整 Web TypeScript 增量檢查與完整 Mobile 型別檢查、修改 TypeScript 檔案的 ESLint，以及瀏覽器驗收腳本的 Python 語法檢查通過。各局部測試與上述數量重疊，不相加；略過項目不計為通過。

首輪遠端 Mobile 檢查指出共用 decoder 的 `semester` 在 Web／Mobile 不同 null-check 設定下有不同的型別縮窄結果。已改用明確 `typeof` 分支，保留相同 runtime 驗證，不加型別斷言或放寬編譯設定；兩端 compiler 設定及完整 Mobile 型別檢查均通過。修正後 client decoder 回歸為 Web **58／58**、Mobile **55／55**，是上述測試的子集合。

另以真正的 Web 工作區元件及合成、隔離的資料端點，在瀏覽器確認「全量同步失敗後仍可選課」及「文字／附件返回清單再恢復」。畫面明示合成驗證，沒有連線校方或送出作業。CI 的既有實際 Next／Docker 瀏覽器驗收腳本同步新增這兩條路徑；本輪沒有把元件預覽當成 Next production build、nuni 真人綁定或已部署證據。

真人校方帳號只再次抽樣讀取本人課程、作業與已交版本，未送出或改動原作業。公開圖片則以實際新增下載 parser 與完整 bytes reader 取得同樣 **27,422 bytes**，這不等於私人附件的 nuni BFF 端對端驗收。Production `contractVerified: false` 保持；真人 nuni 綁定、CSRF／final POST acknowledgment、附件 storage／callback、正式收件與 Web 部署仍待完成。新版本 CI 與 PR 狀態以該版本完整 SHA 的 GitHub 結果為準。

## 2026-11-18：以課程頁確認學生身分

接續 `8a8d7315` 的 PU 授權 reader，補上正面的選課角色證據。課程清單會將缺少的 role 預設為 `student`，這個展示預設不能用來授權繳交。現在每輪授權都必須以目前綁定的 session 讀取固定 `/course/{id}`，核對唯一且有效的 hidden `courseId` 和 `enrollment-is-student: "True"`，再檢查活動資格與本人完整歷史。

- **課程頁傳輸有明確邊界。** 只允許固定校方 origin 的 GET、200 與 HTML 回應，最多 2 MiB，沿用同一取消訊號與剩餘時間；轉址、登入頁、截斷、壓縮或不一致的長度不改走替代路徑。
- **正面證據必須沒有歧義。** 使用 HTML parser，要求真實、唯一的 hidden input 與精確課程／學生值；重複 ID／屬性、template 內容、script／comment 字串、錯誤課程及非學生標記都不能授權。來源 HTML 不回傳前端或寫入紀錄。
- **預覽不保留舊權限。** 前後兩輪都重新查核角色、綁定、活動與本人歷史。預覽後若第一次提交授權查核已發現角色撤銷，會在 durable claim 前拒絕；claim 後的再次查核若發現撤權，則停止校方 POST，保留原操作及鎖供查證。保留上一版已確認的 UTC 時窗、全班指派、一般個人模式、零次繳交與空先修條件限制。

Node **22.23.5** 的局部整合驗證：Web **5 個測試檔、257 項通過**，後端 **2 個測試檔、184 項通過**，沒有略過或失敗；Web 完整 TypeScript 與所有修改程式檔的 ESLint 均通過。Web 整合測試使用實際 PU reader、candidate、journal 與 readback 程式，來源及 HTTP 回應為合成資料，包含成功讀回及預覽後撤銷角色兩條路徑。各檔局部回歸包含於上述數量，不重複相加。

Production factory 維持 `contractVerified: false`。測試另確認即使環境開關為 true，也不會呼叫未驗證的授權或校方 writer；這次修改沒有完成真人 nuni 綁定／送交、附件 storage 契約、教師收件、PR 核准或部署。新版本完整 CI 以該版本 GitHub Actions 的實際結果為準。

## 2026-11-18：真人唯讀資料、PU 權限來源與系統 PDF

已經使用明確授權的校方帳號核對本人課程、作業清單、兩份活動詳情、已交與空白的本人歷史。實際活動與歷史回應確認現有 reader 的數字 ID、本人／課程歸屬、boolean 狀態及 ISO 時間規則；未將姓名、學號、課程 ID、作業內容或原始 JSON 放入程式庫。直接觀察與尚未完成的項目見 [真人唯讀查核](tronclass-live-read-verification-2026-11-18.md)。

- **新增 PU tenant authorization reader。** 依已確認的本人完整課程／作業範圍與即時活動、空本人歷史，確認一般期間、首次、全班指派、空先決條件的 normal 個人線上作業；不以截止時間單獨授權。重核綁定、活動及歷史，並以共用期限中止後續請求。此版只產生文字能力，附件額度為零，不授予補交、重交、撤回或小組能力。
- **修正校方自動產生 PDF 的讀回。** 真實已交紀錄含兩份原始附件及一份 `source: auto-generated-pdf` 文件。讀回仍完整比對每個原始附件及逐字本文，但可額外接受最多一份符合實測明確形狀的校方 PDF，避免把正常來源紀錄誤判成未知；未知額外附件或缺原始檔仍不確認。
- **修正 Firebase Admin 環境範例。** Web runtime 實際讀取 `FIREBASE_SERVICE_ACCOUNT_JSON`，主要範例原本誤寫為不支援的 BASE64 變數；現已統一，避免依範例設定後無法進入綁定流程。

Production factory 已注入唯讀授權 reader；`TRONCLASS_HOMEWORK_WRITE_ENABLED` 只控制既有 runtime gate，`contractVerified: false` 保留。CSRF、final POST acknowledgment 與附件 storage 尚未取得本輪真實寫入證據，舊課程來源的預設學生角色也不當作原始選課角色證據，所以不把這次校方資料查核宣稱成 nuni 站內繳交成功。附件下載測試亦未取得完成檔案，仍列待驗收。

本輪合併 `7fea550f` 後，以 Node **22.23.5** 執行完整 TronClass 範圍回歸：**60 個測試檔、2,006 項通過，4 檔／38 項環境相關測試略過，0 失敗**。完整 Web `tsc --noEmit --incremental false` 與修改的 TypeScript 檔案 ESLint 均通過；略過的測試不計為成功。這些程式測試與上述校方唯讀查核分開記錄，沒有把合成 final／upload 測試當成真人送交。

## 2026-11-18：登入期限、一般教材與純文字繳交

本輪接續 `be3d2276`，整合 main `0bc54fde` 與同期的 CI 修正 `85896f92`，修正三項會妨礙實際使用的流程：

- **整段登入共用期限。** 原生登入、CAS 入口、GET／307／308 轉址、ticket 與 profile 共用呼叫方指定的總預算。每一跳使用剩餘時間，期限耗盡後不再送下一個請求，也不接受取消後才抵達的成功回應，避免畫面已逾時、伺服器卻稍後完成綁定。正常登入仍保存 profile 輪替後的 cookie。
- **一般教材支援官方數字檔案 ID。** 同步與下載共用識別規則；有 `upload.id` 時使用正整數 ID，沒有 ID 才保留舊 key-only adapter 相容性。無效 ID 不改取另一個 storage key。reference、外部來源、隱藏、刪除、未通過審核及上傳／裁切中或失敗的附件不走一般 blob 路徑。下載前後重查本人課程、活動、同一附件與綁定，並核對來源大小及實際 bytes；途中撤權或來源變動時不回傳檔案。
- **純文字與附件能力分開。** 已驗證的 tenant provider 可以獨立處理純文字，不再強制先配置附件 storage resolver。文字仍需 server 開關、契約確認、可信 authorizer、本人／作業歸屬、CSRF、單次 final claim 與精確讀回。未配置 storage policy 時，prepare 的附件數量／大小／類型歸零，upload 或帶附件的 final 在任何來源寫入前拒絕。只允許附件的作業不會因此變成文字作業；原附件操作仍可唯讀查證，不能重送。

Production default 仍未注入經實測驗證的 tenant provider，`contractVerified: false` 保持不變。以上能力分離不把環境變數或合成回應當成校方寫入授權。

### 本輪驗證

使用 Node **22.23.5**，整合後 TronClass server／Web client／工作區及校方登入回歸：**55 個測試檔通過、1,694 項通過、33 項環境相關測試略過、0 失敗**。各修正的局部測試與此範圍重疊，不相加。完整 Web TypeScript 與全部修改 TypeScript 檔案 ESLint 通過；TypeScript 使用 6 GiB heap 完成，未關閉型別檢查或修改 tsconfig。

前版 `be3d2276` 的 [Build Web 原始紀錄](https://github.com/Miiduoa/graduation/actions/runs/44254641067/job/134638176962) 顯示 Next build、真正 Docker 建置及非 root runtime 均成功，但 Playwright 1.57 安裝在已切換至 Ubuntu 26.04 的 `ubuntu-latest` 上失敗，瀏覽器案例未執行。已整合同期 `85896f92` 的修正，將該 job 固定於專案其他瀏覽器工作流已使用的 `ubuntu-24.04`，保留全部建置與瀏覽器驗證步驟；YAML 結構已核對。新版本的實際 Chromium、Docker 與完整 CI 結果仍以該版本的 GitHub Actions 為準。

本輪尚未完成本人校方登入、真實下載與真實收件驗收；未將其他帳號的私人課務資料放入 repository、fixture 或測試紀錄。

## 功能狀態

Web 入口為 `/tronclass`，`/classroom` 的課程清單提供連接入口。原生 Mobile 入口為 `TronClassWorkspace`，學習首頁與 nuni 課程工作區均有入口；深連結路徑為 `/tronclass`。目前只支援靜宜大學 `https://tronclass.pu.edu.tw`。

Mobile 的 App 內密碼綁定與網頁版走同一條路：校方密碼只送到 nuni 自己的 BFF `https://nuni.tw/api/tronclass`，由伺服器端登入學校。React Native 全域 `fetch` 無法保證遵守 `redirect: 'error'`，收到 307 或 308 時，原生網路層可能在 App 收到回應前就把密碼重送到重新導向目標。因此帶密碼的 `connect` 請求一律改用 Expo 原生 `expo/fetch`，在原生層關閉重新導向（Android OkHttp `followRedirects(false)`、iOS URLSession 拒絕重新導向請求），任何重新導向都不會帶著密碼送出；回應若標示 `redirected` 或為 3xx 一律拒絕；原生 fetch 不可用時直接失敗，不會退回全域 `fetch`。其他不帶密碼的請求維持原本的傳輸方式。

| 能力 | 本分支狀態 |
| --- | --- |
| 使用 nuni 平台登入或 Firebase 登入綁定 TronClass | 已實作；不依賴 E-campus session |
| 重新連接、換綁、解除連接 | 已實作，使用 revision 防止舊請求覆蓋新綁定；校方 session 失效時在原頁開啟重新連接表單 |
| 本人 ongoing / upcoming 課程、作業與截止時間 | 已實作，分頁不完整會顯示部分失敗 |
| 獨立課程清單與單課恢復 | 已實作 Web／Mobile；不等待全量作業同步，逾時後仍可選課重讀，舊回應不覆蓋新結果 |
| Web／Mobile 待辦工作區 | 支援作業／課程搜尋、待繳／未知／已繳篩選與期限排序；送出及查證期間避免切換作業，可信成功結果不被較早同步覆寫 |
| 校方作業詳情與設定 | 已實作本人活動 GET；顯示個人／小組、形式、開放／截止、已用與剩餘次數、重交及撤回設定，不推論寫入權限 |
| 返回清單、切換作業或連接中斷後繼續編輯 | 同一已驗證學生最多保留 5 份工作區草稿；重新讀取作業後才恢復文字與 File，不沿用舊上傳狀態 |
| 本人個人作業的歷次繳交內容 | 已實作官方 GET 來源，顯示本文、附件名稱／大小、來源紀錄時間及五種狀態；與本系統新送出的收據分開 |
| 本人歷次繳交的一般附件下載 | Web 下載及 Mobile 分享已接上相同本人 BFF；來源明確允許的一般附件才提供入口，下載前後重新核對同一版本、身分及權限 |
| 選定課程的公告與教材 | 已實作，包含一般活動與 courseware 活動 |
| 來源隱藏／未發布資料過濾 | 已套用於作業、公告、教材與附件，以及作業歷史的讀取邊界；不因另一旗標允許就忽略明確拒絕 |
| 使用已綁定 session 下載教材附件 | 已實作，重新確認本人課程、活動與附件下載權限；真人下載仍待驗收 |
| 既有 Assistant 直接查詢 TronClass | 已實作，回傳本人課程、作業狀態、公告與教材；私有結果不加入雲端模型歷史 |
| Agent 代理下載與準備作業 | 已實作，需使用者分別授權；在聊天內下載附件、選定作業並開啟預覽 |
| 隨時調整／撤銷 Agent 權限 | 已實作，綁定 revision 與權限版本雙重檢查；換綁後重新授權 |
| 作業文字、附件選擇、預覽、複製內容 | 已實作；Web 草稿及檔案只留在目前頁面記憶體，Mobile 文字留在記憶體、附件使用有清理機制的受控 cache 副本 |
| 依已確認的作業規則編輯與預覽 | 已實作；保留零附件額度，送出前先核對全部文字、檔案與總量，規則未知時只標示本頁整理上限 |
| 作業要求變更後重新確認 | Web／Mobile 在送出前核對使用者確認的題目、說明、期限、次數與附件規則；實質變更保留稿件並要求重新預覽 |
| 上傳中斷後停止準備 | Web／Mobile 可明確停止尚無 final claim 的操作；伺服器先以交易保存停止紀錄，再回到編輯，已開始送出的操作維持查證 |
| 上傳 → 最終送出 → 本人版本確認 | 公開 API、v2 service、持久化 journal 及 Web／Mobile UI 已接線，以注入的合成校方來源驗證；正式 writer 仍停用 |
| 官方送出協定與受控文字候選實作 | 已實作 request builder、acknowledgment parser 及單次 POST；公開 service 的 server gates 通過後才會呼叫，正式 provider 尚未通過校方驗收 |
| 受控附件傳輸及正式版本讀回 | 已實作 metadata → binary → callback、帶附件的 final POST、精確本人版本讀回；公開 API 已接上 v2 prepare／upload／submit／reconcile 與新確認結果，正式寫入仍未啟用 |
| 真正寫入校方 TronClass | **尚未完成契約驗證，production adapter 固定拒絕寫入** |
| 重交、撤回、小組繳交、代替其他人繳交 | 未實作；小組歷史也回傳 `group-unsupported`，引導至原作業查看 |
| 原生 Mobile 的新綁定／作業畫面 | 已實作獨立綁定、選課讀取、作業詳情、文字／選檔／預覽／再次確認、條件式送出與唯讀查證，使用相同 BFF；正式 writer 的停用條件相同 |
| 原生 Mobile 教材下載 | 使用固定、已驗證本人權限的 material-download BFF；限定大小、檔名與完整 bytes，透過原生分享介面儲存，使用後清理暫存 |
| 資料到期與關帳清理 | 已實作 Spark 可用的有上限背景清理與平台關帳 outbox worker；均需明確部署設定。TTL 另有可選設定，不默默啟用計費 |

TronClass 與 nuni 自有課程是兩個不同的來源。nuni 自有課程的收件、附件與教師批改，不是 TronClass 的正式繳交證據。

## 校方最新作業設定與草稿恢復

`getAssignment()` 在本人課程與完整作業清單核對後，讀取固定的 `GET /api/activities/{activityId}`。`prepare.details` 獨立於 `rules`、`canSubmit`，只呈現來源明示的設定：個人／小組、一般／選題作業、開放與截止時間、一般期間狀態、已用與剩餘次數、重交設定與是否允許撤回。公開前端的欄位依據見 [來源查核](tronclass-public-contract-2026-11-16.md)。

缺少資料時保留 `null`／`unknown`，不把未提供期限說成無期限，也不把剩餘零次改成預設額度。次數接受數字及嚴格十進位字串，拒絕空白、前導零、指數、負數、小數及尾隨文字；只有明示有次數限制且上限、已用次數均合法，才計算剩餘次數。這些觀察不等於補交、重交或正式送出的資格。

有可用詳頁時，編輯器與預覽採用最新標題、說明及期限。老師清空說明或期限後，不再回填舊清單的內容。暫時 429／5xx 可保留獨立確認可見的摘要並顯示設定讀取失敗；401、403、活動 404／410、隱藏或範圍錯誤會停止資料回傳。讀取本人歷史途中再次發現活動隱藏、刪除或撤權，也不能被降級為歷史暫時不可讀後回傳較早的內容。只有 `submission_list` 自身的 404 仍可顯示歷史不可讀，不能用它推論活動已刪除。

作業文字與選取的 `File` 只保留在這個頁面的記憶體。連接失效時先撤下資料，重新連接後，比對伺服器產生的 `studentKey`；同一 nuni owner、校方與已驗證的校方使用者才會相同。該值使用既有伺服器密鑰的 HMAC-SHA256，輸入包含用途標記及上述範圍，不公開校方數字 ID，也不是可用來授權 API 的憑證。過期、解除、密文失效時回傳 `null`；舊版回應沒有此欄位可照常連接，但不恢復草稿。

新的同步結果找到原作業後，使用者可按「繼續編輯保留的草稿」；再通過目前 revision 的新 `prepare`，才顯示文字與附件。重新產生附件本地 ID，狀態回到 `ready`，不保留上傳 ID、來源權限或收據。若原操作結果不明，仍以原 pending operation ID 查證，不能重新送出。同一已驗證學生最多保留 5 份工作區記憶體草稿，返回清單或切換作業不丟棄；滿額時阻止開啟第六份新稿，必須明確清除其中一份。換 nuni owner／平台 session、換校方已驗證使用者、解除連接、明確清除或關閉／重整頁面，都會丟棄草稿；沒有建立持久化草稿資料庫。

## 本人歷次作業紀錄

本輪依靜宜官方公開前端確認讀取路徑，新增 `readSubmissionHistory()`。伺服器先以目前綁定的校方學生檢查本人課程與作業清單，再呼叫 `GET /api/activities/{activityId}`，確認活動 ID、課程 ID、`type: homework`、可見性及 `submit_by_group: false`，最後才讀取 `GET /api/activities/{activityId}/students/{studentId}/submission_list` 的 `{ list: [...] }`。學生 ID 來自伺服器已驗證的綁定，不接受瀏覽器指定他人 ID 或來源 URL。官方資源版本、SHA-256、模組定位及尚未驗證的範圍見 [2026-11-16 公開前端契約查核](tronclass-public-contract-2026-11-16.md)。

歷史隨 `prepare` 回傳，顯示五種逐筆狀態：

| state | 畫面名稱 | 判讀原則 |
| --- | --- | --- |
| `submitted` | 已繳交 | `is_draft`、`is_redo`、`submit_by_instructor` 均明確為 false |
| `draft` | 草稿 | `is_draft: true`，且未同時標示退回重做 |
| `returned` | 退回重做 | `is_redo: true`，且未同時標示草稿 |
| `teacher-marked` | 教師標記已繳 | 明確不是草稿或退回，且 `submit_by_instructor`、`marked_submitted` 均為 true |
| `unknown` | 狀態待確認 | 必要旗標不足、型別不符或互相矛盾，不用 JavaScript 的 `!undefined` 推論已繳交 |

只有 `is_latest_version: true` 才建立 `latestId`，保留各版本自己的狀態，不以最大 ID、第一筆或時間猜測最新版。缺少最新版標記時仍可逐筆查看；重複最新版、重複 ID、身分或範圍不符、顯示不完整分頁等情況，整份歷史回報 `unavailable`，不回傳看似完整的部分紀錄。來源 `created_at` 轉成 `createdAt` 顯示為「紀錄時間」，不是已驗證的正式送出時間；無法解析的時間維持 null。

只輸出整理後的本文、附件名稱與大小，本文以純文字顯示，超過 20,000 字元標示截斷。清單及單筆附件各上限 100 筆，超量不默默截成完整結果；符合一般附件下載契約的項目另帶 `download: { uploadId }`，不包含來源 URL、Cookie 或 storage key。外部資源與簡報只顯示另有資源的提示。任何 `submit_by_instructor: true` 的教師建立紀錄均移除本文、附件及其他資源，不透傳建立人、教師評語、分數或 `submission_correct`。

`submit_by_group: true` 直接回傳 `group-unsupported` 並保留原作業入口，不呼叫個人歷史來代替小組結果。一般讀取失敗顯示「暫時無法讀取」，可在頁內重試；空清單只代表這次沒有取得紀錄。校方登入失效或明確撤銷存取權限則保留錯誤，不降級成空清單。

**歷史不是本系統新送出的收據。** `history` 不填入 `receipt`，不參與 `submit`／`reconcile` 的成功判定，也不解除寫入限制。既有正式版本、教師標記或上傳檔案，都不能證明 nuni 的某次新送出已成功。

### 本人歷史附件下載

`POST /api/tronclass/submission-attachment` 只接受 `courseId`、`homeworkId`、`submissionId`、`uploadId`、`revision` 五欄；本人學生 ID 與 Cookie 由目前伺服器綁定取得。下載前完整核對本人課程、作業清單、可見個人活動及本人全部歷史，精確選擇指定版本的附件。只有明確 `allow_download: true`、非教師／不明狀態、一般 upload 且未被隱藏、刪除或審核拒絕時才開放。參照附件、外部 source、批改 PDF、專案／知識圖譜與上傳失敗等不同契約不走這個入口。

後端使用固定靜宜 origin 的數字 upload ID blob 路徑，不接受前端網址、storage key 或他人學生 ID。只允許一次符合 [已查明媒體契約](tronclass-media-download-verification-2026-11-18.md) 的校方 302；媒體第二跳不帶登入憑證，也不跟隨後續轉址。完整 bytes 受 25 MiB 與 30 秒總預算限制，核對 HTTP 長度、來源大小、MIME 及偽裝登入頁。讀完檔案後再讀取本人歷史與活動權限；版本被刪除、撤權、換綁或附件 metadata 變更時，已讀 bytes 不送給使用者。教材與歷史附件共用每程序兩個下載名額及每帳號速率限制，私有回應不快取。

Web 從目前作業的歷史紀錄直接下載。Mobile 使用相同固定 BFF、目前 Platform／Firebase 身分及受控 cache 分享；下載、等待分享能力及分享前後核對 owner、revision、到期時間，離頁時取消傳輸，完成後清理暫存。兩端遇到較晚回傳的舊連線結果都不啟動下載／分享。下載不更動作業狀態，也不建立、清除或重送 pending operation。

以上透過合成來源與真正的 reader／normalizer 路徑測試，校方公開模板的 URL／欄位依據見 [2026-11-18 來源查核](tronclass-public-contract-2026-11-16.md#2026-11-18本人繳交紀錄的一般附件下載)。真人附件下載仍須驗收。

### 綁定後同步與待辦操作

獨立登入會保存 `/api/profile` 回應合併後的最新 Cookie，避免 session／XSRF 輪替後仍保存舊登入憑證。首頁對只有 Firebase 身分的使用者提供 `/tronclass` 入口，E 校園舊資料擷取仍維持暫停。

同步現在以同一個 50 秒總期限涵蓋 binding、課程、作業分頁、教材及公告；`request.signal` 及剩餘預算一路傳入 direct／relay 底層讀取。客戶端取消、登入失效、權限撤回或換綁會取消其他在途工作，不把取消視為部分成功。即使注入來源忽略取消，晚到的回應也不會啟動下一頁請求。

Web／Mobile 均提供全部、待繳交、狀態待確認、已繳交四種篩選，數量依目前課程與搜尋縮小；待處理項目按期限排序。未知狀態維持獨立。上傳、送出或查證途中不能切換作業；收到可信 `submitted`／`confirmed` 結果後更新清單，同時使較早啟動的同步失效。之後使用者主動同步仍可接受校方最新狀態，不永久固定本機成功標記。

## 在既有 Assistant 使用 Agent

先登入 nuni，在 `/tronclass` 連接學校帳號，再於「TronClass 助理權限」選擇允許的能力。三項權限預設全關：讀取課程資料、下載教材、準備作業。下載與準備均需要同時開啟讀取權限，沒有「代為寫入」權限。

使用者可以在既有 `/ai-assistant` 對話中輸入「TronClass 有哪些未交作業」、「查詢 TronClass 公告」、「幫我下載 TronClass 教材」或「幫我準備 TronClass 作業」。結果直接顯示在對話：課程與作業選項、校方繳交狀態、公告、附件下載及作業預覽，不需要另開一個 Agent。一般概念說明、否定操作與不支援的寫入要求不會被當成下載授權。

- Agent 根據當次使用者文字選擇有型別的工具；校方作業內文、公告、歷史訊息與模型輸出不會變成工具指令。
- 未確認的繳交狀態維持 `null`，和已交／未交分開顯示；資料不完整不代表全部作業已完成。
- 課程、作業或附件目標不唯一時，顯示可選項目。只有明確下載要求、完整資料與唯一可確認附件才可直接啟動下載；其他情況由使用者選擇。
- 聊天中的作業流程只可準備與預覽。即使未來人工繳交 adapter 開放，Agent 的 upload、submit、reconcile 仍明確拒絕，不會暗自取得寫入能力。
- TronClass 對話與結果不加入雲端模型 history；資料顯示為文字，不執行校方 HTML 或工具要求。這不代表已具備通用模型分析、背景排程、自動答題或所有校方操作。
- 對話結果列出來源、查詢時間、已執行／部分完成／未執行的操作及可用能力；下載只在取得合格檔案後啟動瀏覽器下載，不宣稱已保存至使用者磁碟。

Agent grant 存在既有 server-only 綁定文件中，每次更新以 `revision` 與 `expectedVersion` 做 transaction compare-and-set。解除連接、重新連接與關帳都會移除原授權；重新開啟權限產生新版本，舊請求仍不能繼續。每次操作前後會重驗目前 nuni actor、綁定與授權；前端對已取消或切換身分的晚到結果不啟動下載。已顯示的資料無法因事後撤權從使用者記憶中收回，撤權約束後續操作與尚未完成的結果。

## 登入與資料隔離

- 平台登入使用伺服器驗證過的 `platform:pa_UUID`；Firebase 使用 `firebase:UID`，兩個身分空間不互相替代。
- 瀏覽器平台請求使用 HttpOnly cookie 與 `X-Campus-Session`。原生平台請求可用 `Authorization: Platform …`；Firebase 使用 Bearer ID token，後端檢查撤銷與帳號狀態。
- 明確但不合法的 Authorization 不會退回另一個 cookie 帳號。平台登入載入、失敗或登出中，UI 不會轉用背景 Firebase 身分。
- 校方密碼只用於當次登入，不寫入 Firestore、localStorage 或 sessionStorage。UI 發出連接請求後即清空密碼欄。
- 校方 session 以 AES-256-GCM 加密存放，驗證資料包含 owner 與 revision；密鑰僅在伺服器。預設有效期 12 小時，重新綁定會更換 revision。
- 解除連接保留失效 revision，刪除帳號與 cookie 等連線資料，防止進行中的舊請求重新寫回。
- 長時間讀取結束會再驗證 nuni 身分與校方綁定；使用者換帳號、重新連線或解除連線後，舊資料不會送回新畫面。
- 本分支不授予校務角色、課程權限或組織成員資格，也不恢復 `alcat.pu.edu.tw` / `mypu.pu.edu.tw` 的暫停流程。

當查詢、歷史讀取或下載收到 `TRONCLASS_RECONNECT_REQUIRED`，Web 會立即撤下依賴舊連線的畫面，清空密碼欄，在原頁顯示重新連接表單並保留 compare-and-set 所需的 revision。即使本地綁定的 12 小時期限尚未到，也不以本地 `connected` 狀態覆蓋校方的登入失效結果。重新連接前先停止舊資料與下載流程，晚到的 status、查詢或繳交紀錄不能恢復舊畫面。

來源資料若提供 `is_hidden`、`hidden` 或 `published`，會依已知 boolean／0、1 編碼檢查；任一拒絕或無法辨識的值都不放行。缺少這些旗標的舊格式仍沿用既有本人課程及附件權限檢查，不能把「沒有隱藏旗標」當成獨立授權。相同活動在一般活動與 courseware 清單出現時，拒絕標記不會被另一份可見資料蓋過。

## HTTP 介面

`POST /api/tronclass`，`Content-Type: application/json`，JSON 上限 96 KiB。請求只接受各 action 已列出的欄位。

| action | 必填欄位 | 用途 |
| --- | --- | --- |
| `status` | 無 | 目前綁定狀態，不包含 cookie |
| `connect` | `schoolId: "pu"`, `account`, `password`, `expectedRevision` | 驗證校方身分後綁定；初次 revision 為 null |
| `disconnect` | `expectedRevision` | 解除目前綁定 |
| `courses` | 無 | 僅讀取本人課程清單，回傳 `kind: "course-index"`；不讀作業、公告或教材 |
| `sync` | 無；可加 `courseId` | 讀取全部本人課程與作業；選定課程時讀公告、教材 |
| `prepare` | `courseId`, `homeworkId` | 讀取作業資訊、可送出條件及獨立的本人歷史 `history`；歷史不構成 `receipt` |
| `submit` | `courseId`, `homeworkId`, `revision`, `operationId`, `content`, `attachments`, `confirmed: true` | 最終送出；attachments 為本次已驗證的 fileId，非來源 upload key |
| `reconcile` | `operationId`, `revision` | 只查證原操作，不重新送出 |
| `cancel-preparation` | `courseId`, `homeworkId`, `operationId`, `revision` | 原子停止尚未取得 final claim 的本次準備；不撤回校方作業、不刪除提交鎖 |

`PUT /api/tronclass` 接收單一附件原始 bytes。query 為 `courseId`, `homeworkId`, `revision`, `operationId`, `fileId`, `name`；Content-Type 為檔案 MIME。單檔最多 10 MiB、每份最多 4 個檔案、總附件最多 20 MiB、文字最多 20,000 字元；校方規則若更嚴格，採更嚴格者。這是應用程式上限，不是校方的通用額度。

`prepare.rules` 為 `{ status: "unknown" }` 或 `{ status: "confirmed", allowsText, allowsAttachments, maxTotalBytes }`；附件數量、單檔上限與 MIME 仍由既有 `maxFiles`、`maxFileBytes`、`allowedContentTypes` 提供。來源 `permissionKnown` 未確認時，不把本頁 4 檔／10 MiB／20 MiB 整理額度當成校方授權。已確認的零值保持為零，不回退成預設額度；較舊的回應若沒有 `rules`，仍能整理與預覽，但不能據此送出。新增的 `prepare.details` 是另一份已去除私有原始欄位的觀察資料，不能取代 `rules`；Client 會核對完整欄位、型別與次數計算一致性，拒絕多出的來源欄位。

使用者確認送出後，UI 先重新取得完整規則，再一次核對文字、所有附件、檔名、空檔、個別大小、合計大小及 MIME。任何一項不合格，都在第一個 upload 前停止並保留草稿。重新讀取失敗會移除舊的送出資格，不讓先前的 `canSubmit` 繼續生效。後端原有規則檢查仍保留。

回應使用 `Cache-Control: no-store, private`，不快取私人校方資料。一般請求每 owner 每程序每分鐘 60 次，課程清單及完整同步各自每分鐘 6 次；另有 Firestore 持久化登入嘗試限制（15 分鐘：每個呼叫者 6 次、每組呼叫者與校方帳號 5 次、同一正規化校方帳號跨呼叫者共 20 次。只有能確認登入請求未送達校方的傳輸失敗才會退回額度。校方拒絕、其他上游回應及無法確認送達狀態的逾時均保留扣額）。一般請求限制不是跨程序全域配額。

綁定只保留由玩課雲網域核發的 cookie。舊版綁定缺少 cookie 來源資訊，更新後需重新連線。

### 教材附件下載

`POST /api/tronclass/material-download` 接收 `courseId`、`activityId`、`uploadKey`、`revision`。伺服器先確認目前校方學生的課程清單，再從該課程的一般／courseware 活動核對附件與 `allow_download: true`，只讀取固定校方 `/api/uploads/{id}/blob`。公開欄位 `uploadKey` 保持相容，但官方一般附件採數字 `upload.id` 的字串表示；只有來源沒有 ID 時才支援既有 key-only adapter。前端傳入任意網址、其他活動的 ID／key、隱藏活動或不允許下載的檔案都不能下載。

回傳 attachment 與經過清理的檔名；不把校方 cookie 帶到瀏覽器。支援一般文件、壓縮檔、圖片、音訊與影片 MIME，拒絕 HTML／JSON 登入回應與未知格式；來源 302 只支援與本人歷史附件相同的單次受限媒體下載。單檔上限 25 MiB、讀取校方來源最多 30 秒，回傳使用 64 KiB 區塊串流、傳送最多 60 秒。每程序最多同時處理 2 個下載，完成、取消或逾時才釋放名額，超過時回傳 429。檔案僅在這次請求記憶體中處理。超過限制或指向未查明儲存目的地的教材保留原始教材入口，不開放任意來源網址。

下載完成前再確認綁定、nuni 身分、本人課程、教材活動與同一附件的權限；附件被撤回、改名或大小改變時不回傳已取得的 bytes。前端也會丟棄舊 owner／revision／課程的晚到結果。下載 bytes、檔名與權限不是由前端原始連結直接採信。

### Agent 介面

三個 Agent 路由沿用同一身分驗證、緊急停止設定與私人不快取回應。JSON 上限 8 KiB，僅接受明列欄位，不接受由客戶端指定 owner。

| 路由 | action／資料 | 用途 |
| --- | --- | --- |
| `POST /api/tronclass/agent-permissions` | `status` | 取得目前綁定的權限與版本，不包含校方 session |
| 同上 | `set`, `revision`, `expectedVersion`, `permissions` | 交易式更新三項權限；其他裝置先更新時拒絕舊版本覆蓋 |
| `POST /api/tronclass/agent` | `capability` | 取得可用能力；正式作業送出固定為 false |
| 同上 | `ask`, `question`；可帶 `courseId`、準備流程的 `homeworkId` | 執行當次唯讀查詢／選目標／準備並回傳結構化結果 |
| 同上 | `prepare`, `courseId`, `homeworkId` | 在 Agent 權限內重新讀取作業準備條件，`canSubmit` 固定 false |
| `POST /api/tronclass/agent/download` | `courseId`, `activityId`, `uploadKey`, `revision` | 重用教材下載器，再加上可撤銷的讀取與下載權限檢查 |

權限管理與 Agent 一般請求每 owner 每程序每分鐘 30 次；昂貴的 ask／prepare 每分鐘 6 次。下載沿用既有大小、時間與並行上限。這些限制不是跨程序全域配額。

## 送出與失敗恢復

### 2026-11-18：中斷後恢復、確認範圍與分頁完整性

**停止準備。** Web 與 Mobile 都在第一次附件上傳或 final 請求之前保存不透明 operation ID。本機儲存失敗時不開始上傳；一旦保存後的請求失敗，就保留同一 ID 與稿件，不直接建立另一筆送出。使用者可在待確認畫面明確選擇「停止準備並返回編輯」。

新 `cancel-preparation` 與唯讀 `reconcile` 是不同操作。伺服器在同一個 Firestore transaction 核對有效綁定、學生身分、課程／作業、原 operation 及共享作業鎖；只有 preparing 且沒有 final lock 時，才把 operation 改為 `cancelled`。手機可能已保存 ID 但第一個請求尚未抵達。正式寫入已開放時，會為不存在的 operation 建立持久的取消紀錄（`purgeAt: null`），防止晚到的上傳或 final claim 建立原操作。正式寫入封鎖時，若 operation 與作業鎖均不存在，直接回傳 `cancelled` 表示無需取消，不新增文件。

已存在 final claim、acknowledgment 或共享作業鎖時，回覆 `unknown`，不更動 operation／lock、不呼叫校方，不把「尚未收到回覆」當成「沒有送出」。同一已驗證學生重新連線後可停止原準備，仍保留原 revision 與檔案紀錄；換成另一學生、錯課／錯作業及舊格式操作都不能覆寫。停止準備不會撤回校方作業，已在途的附件傳輸也可能留下未關聯檔案。

回應獨立為 `{ status: "cancelled" | "unknown", operationId, courseId, homeworkId }`，沒有收據或繳交成功語意。兩端都嚴格核對這四個欄位及原操作範圍；只有 `cancelled` 且本機 pending 清除成功，才解除編輯鎖、保留文字與附件、取消原確認。Mobile 也清除預覽固定的 bytes，要求再次預覽才使用新 operation。錯誤回應、換帳號／換連線、離頁及本機儲存失敗均保留待確認；停止準備不自動重試，Agent 的 prepare-only 畫面沒有此權限。

所有送出、查證及停止準備的回覆均綁定原 client、owner、revision、課程、作業與 operation；只有本機仍保存相同 operation 才清除 pending。另一個畫面已建立新操作時，舊回覆保留新紀錄與稿件，不更新作業為已繳交，改為提示重新開啟核對。Mobile 對同一個 pending key 的 read／save／條件清除使用程序內序列佇列，避免非同步 AsyncStorage 在讀取與刪除之間插入另一個 save；不同 key 不互相阻塞，save 也拒絕覆蓋不同 operation。這是同一程序的本機儲存協調，校方最終送出的跨 client 防重仍由伺服器 Firestore 交易負責。

**重新確認作業要求。** Web 在實際勾選確認時記錄當下要求，送出前 fresh prepare 的題目、說明、截止、作業設定、次數、文字／附件規則或上限改變時，先停止上傳、回到編輯並保留稿件。只有 `details.fetchedAt` 更新不要求重複確認；初次 prepare 尚未完成時不能先勾選未知要求。此修正讓 Web 與既有 Mobile 的條件比對一致。

**分頁完整性。** `tcFetchHomeworkActivitiesPage()` 不再用 `Number()` 把 false、陣列或空字串轉成總數，也不將錯誤 total 降成未知。total、page、page_size 若有值，必須是非負安全整數或標準十進位字串；明示頁碼／頁量須符合本次請求，回應筆數不能超過頁量／總數。錯誤來源會走讀取不完整流程，避免空頁或短頁被誤當成全部作業。缺欄、null 與真正 total 0 保留既有相容性。

取消交易已透過真正 Firestore emulator 與兩個獨立 Admin SDK client 驗證：13 項通過，包括取消與 final 同時競速、兩種先後提交順序、已在途上傳、同學生重連及關帳。測試不包含真實校方寫入，正式 writer 仍維持停用。

本輪先保留同期 head `8b38ca81` 的登入期限、教材一般檔案與純文字能力更新及 main `0bc54fde`，再整合停止準備與 pending 保護。使用 Node 22.23.5 完成下列驗證；重疊的局部測試不重複加總：

| 檢查 | 結果與範圍 |
| --- | --- |
| Web TronClass／登入／relay／instrumentation | 65 檔、1,973 項通過，0 失敗；單 worker，59.51 秒 |
| 需要外部資料庫的 Web 測試 | 一般命令略過 4 檔、38 項；其中本輪修改的 controlled journal 另以真正 emulator 執行 13／13 通過，不把其餘略過項目算成通過 |
| Mobile TronClass 完整指定範圍 | 14 suites、258／258 通過，16.159 秒，無略過 |
| 作業分頁 scraper | 154／154 通過，包含錯誤 total／page／page_size 的失敗回歸 |
| Mobile 完整 TypeScript | exit 0 |
| Web production build | exit 0，包含完整 TypeScript、standalone 輸出與靜態頁面生成；使用 CI 的 mock public Firebase 設定，沒有略過型別檢查 |

前版 `be3d2276` 的真正 GitHub Build Web 已完成 Next 與 Docker standalone runtime，但在安裝瀏覽器驗證工具時失敗：`ubuntu-latest` 已分配 Ubuntu 26.04，而固定 Playwright 1.57.0 不支援該 OS。本輪保留同期 `85896f92` 已將 Build Web runner 固定為既有瀏覽器 workflows 使用的 `ubuntu-24.04`，保留 browser 安裝、16 情境 smoke、bundle 掃描及 Docker runtime 檢查。本機 Chromium 啟動仍因 `socket() failed: Operation not permitted` 失敗，沒有宣稱本機瀏覽器驗收通過；最新提交的實際 Chromium 與 Docker 結果需查看相同 head 的 CI，不能沿用前一版本或將略過視為成功。

### 2026-11-18：公開查證、原生 Mobile 與實際資料庫驗證

`getDefaultTronClassSubmissionService()` 現在回傳 `tronClassPublicSubmissionService.ts`：公開 prepare／upload／submit 均使用 v2 adapter，僅保留舊 service 的唯讀 prepare 與 v1 reconcile，不再讓新的公開寫入建立 v1 ledger。這層可獨立完成的程式接線不列為校方外部 blocker。production factory 已注入依真人唯讀形狀實作的 PU tenant authorization reader，但明確保留 `contractVerified: false`，沒有已驗證的 CSRF／final acknowledgment 契約或 attachment storage policy；既有環境開關不能單獨解鎖，實際學校送交仍關閉。

公開 prepare 重用本人詳情與歷史，只有明確受控的 server authorization、CSRF、完整空歷史、一般期間、個人首次作業及兩個 server gates 都通過，才投影最新規則與 `canSubmit`。公開 upload 必須完成 metadata／binary／callback 且 journal 已持久化，才回傳不透明 fileId、名稱、MIME、大小與 hash；不公開校方 uploadId、owner、studentId、cookie 或儲存 URL。submit 將已確認的 attachments 映射為本次 v2 manifest，使用單次 final claim／POST；新 confirmation 不硬塞進需要 `submittedAt` 的舊收據型別。HTTP request 的 abort signal 會傳至 upload／submit。

送出回應遺失或 acknowledgment 儲存失敗時，原 attempt 與鎖保留；可確認存在原 claim 的暫時錯誤只回 `unknown`，不重送。若後續權限改變，仍會用原 manifest 與同一本文轉換規則核對 digest；更改本文、附件清單或 fileId 不會被誤認為原操作，會回 conflict。這些公開路由整合測試使用真正的 handler／adapter／journal 程式、原子記憶體 DB 與合成校方 fetch，不是校方真人或外部網路驗收；真正 Firestore 交易另有 emulator 測試。

`reconcile` 按持久化版本分流。v1 沿用既有正式收據與時間檢查；v2 只讀取受控 journal 保存的原 attempt 與 acknowledgment，再使用目前綁定重新讀取本人校方歷史。未知版本一律拒絕，不能以 v1 parser 處理 v2 記錄。這條路徑沒有附件上傳或作業寫入依賴，也不會釋放作業鎖、重寫原 revision 或把紀錄改成可重送。校方既有課程查詢使用唯讀用途的 `/api/my-courses` POST，不能把 HTTP 方法本身當作作業寫入證據。

新增 `tronClassRawSubmissionHistory.ts` 在讀取前後核對當下綁定、課程完整清單、作業活動與個人繳交模式，並驗證歷史的完整性、重複 ID 與本人範圍。401／403／隱藏／404／410 不能退回舊內容；外層 15 秒期限的 abort signal 會一路傳入 scraper 的 HTTPS／relay、內部課程分頁與 fallback，每頁亦有 deadline guard，逾時會取消進行中的來源請求且不再啟動下一頁。作業分頁另有預設傳輸時間與回應大小上限。原始 HTML 與附件 ID 只用於伺服器內部精確比對，不回傳給公開介面。

有可信 acknowledgment 且精確讀回成功時，公開回應新增獨立的 `status: confirmed`、`receipt: null`、`confirmation.kind: acknowledged-readback`。確認包含本次 operation、校方版本 ID、課程／作業與 `confirmedAt`；可空的 `sourceRecordedAt` 仍只是校方建立紀錄時間。它沒有虛構 `submittedAt`，也不改變舊收據格式。Web 與 Mobile 都核對 operation 及作業範圍後才清除本地 pending；錯誤範圍、暫時讀取失敗、沒有 acknowledgment 或仍在 preparing 的 v2 操作保留待查證。準備中的另一個 actor 仍可能取得 final claim，因此唯讀查證不能聲稱「確定不會送出」。

原生 Mobile 使用平台 session context；只有沒有平台 session 且 Firebase 登入仍有效時，才使用目前 Firebase token。平台 session handle 留在既有 controller，校方 Cookie 不傳到手機。換 nuni 帳號、換校方 studentKey、解除連接或晚回的舊要求都不能沿用權限或確認。選課會發起帶 courseId 的讀取，取得該課完整作業、公告與教材，並丟棄較早選課的晚回覆。

Mobile 文字草稿留在目前畫面記憶體；附件使用 DocumentPicker 的 cache copy 支援 iCloud／Android 文件來源，再移至本畫面的隨機暫存目錄。預覽固定當時 bytes 與 SHA-256，確認後上傳相同內容。移除、丟棄、換人、解除連接、確認成功與離頁會清理副本；不刪使用者原檔。只能恢復同一已驗證學生的本頁草稿，重連後重新讀取權限與預覽。AsyncStorage 僅保存 owner／作業範圍對應的不透明操作 ID，不保存密碼、草稿文字、附件 URI、上傳狀態或校方 Cookie。教材下載使用固定 BFF、大小與 header 檢查，在原生分享完成後清除暫存。JavaScript export／單元測試不等同於 iOS／Android 真人選檔與校方繳交驗收。

Firestore journal 已用真正的 Java 21／Firestore Emulator 1.22.0／Admin SDK 測試，不再只依賴模擬交易：兩個獨立 client 的檔案／final claim 競爭、跨 owner 同學生共用鎖、同學生重連只讀、換學生拒絕、實際關帳 hook 與晚回 transfer／acknowledgment 都在驗證範圍內。後述 Spark retention 也有真 emulator 的 query／transaction 競態測試。這些使用合成校方資料，沒有真人作業 POST。

另外整合 PR #586 的既有課務 reader 修正：補讀 courseware、隱藏／未發布／跨課資料過濾，以及不完整結果的 60 秒重試。交叉審查再修正損壞 error cache 阻斷手動 refresh 的問題，並加入 projection version；舊快取已遺失隱藏旗標，必須整體重新讀取，不能在升級後繼續回傳舊投影。

### 2026-11-17：受控附件與版本確認

下段保留 11/17 的設計與當日測試紀錄；11/18 的公開 v2 全流程及真實資料庫驗證更新見上節。新增 `tronClassAttachmentCandidate.ts`、`tronClassFinalSubmissionCandidate.ts`、`tronClassSubmissionReadback.ts` 三個協定模組，並以 `tronClassControlledSubmission.ts` 與 `tronClassControlledJournal.ts` 完成服務及 Firestore 交易接線。執行候選與工廠預設停用，`contractVerified` 固定為 `false`，不會由環境變數自行成為正式 provider。公開 route／Agent 寫入限制不變。

**附件傳輸。** 先以 server-only 授權讀取器確認本人作業與限制，再要求原子且持久化的檔案 claim，才建立 metadata。S3／WRPC 分支以原始 bytes PUT，成功後呼叫官方 callback；MEDIA 分支以包含 `file` 的 multipart PUT。multipart 先產生完整 bytes 及相同 boundary 的 Content-Type，避免既有底層把 FormData 轉成字串或遺失 boundary。QINIU、CHINAMCLOUD、未知模式與尚未驗證的 S3 分支拒絕。

Metadata 的 `upload_url` 只能提供待查核的目的地，不能自行授權網路請求。呼叫方必須注入受控、獨立設定的精確 URL／upload ID／傳輸模式 policy；沒有預設可信 storage host，不以「與學校同來源」放行任意 API 路徑。Storage PUT 不帶校方 Cookie、CSRF、平台 Authorization、Origin 或 Referer；不跟 redirect、不重試。MEDIA 目的地若仍要求校方 Cookie，此候選目前不支援，必須先確認精確目的地接受無憑證 PUT 才能由 policy 放行。每個階段有時間／回應大小上限與綁定、開關、期限檢查。參數與 bytes 會先複製，避免等待期間變動。

Binary／callback 的 HTTP 成功僅回傳 `state: transferred`、`confirmation: awaiting-confirmation` 與檔案識別資料；不回傳私有 URL、cookie、教師資料或收據。該結果也不保證遠端 bytes 已經下載核對。候選要求呼叫端用 owner／operation／file 的穩定槽持久化 claim；換 bytes、revision 或程序不能自動重建同一檔案。

**最後送出。** Final candidate 只接受本次選取的 file IDs，由 server-only journal 取得已完成傳輸的 handle，重新核對 owner、校方學生、作業、revision、operation、檔名、大小與 SHA-256 欄位。完整附件集合符合最新限制才可繼續；缺少任一附件時，不送出部分版本。它要求跨 owner／程序的校方學生與作業原子 claim，保存本次本文、附件 manifest、完整空 baseline 與內容摘要後才 POST。

Claim 完成後會再次讀取校方授權與歷史。若使用者已在另一個校方分頁繳交、老師變更限制／期限、或綁定身分改變，就停止正式 POST。這個最小候選只處理個人、normal、一般繳交期間、完整空歷史、零次數的首次送出；沒有推論小組、重交、補交或草稿更新權限。最後的校方競態仍須由伺服器自身權限檢查拒絕。

**讀回確認。** Final HTTP 200／201 先解析本人新版本 acknowledgment，將 ID 保存後，再讀取該學生的官方 `submission_list`。只有以下條件全部成立才回傳 `verified-new-version`：

- 完整事前版本仍保留，清單只多出這次 acknowledgment 的一個 ID，且該 ID 是唯一最新版。
- 同一學生、課程與作業；明確不是草稿、退回或教師標記。
- 原始 canonical HTML 本文逐字相同；附件數字 ID、檔名、大小完整相符，沒有額外資源或簡報。
- 查核前後綁定仍相同；晚到的舊身分資料不能成為確認結果。

`sourceRecordedAt` 只表示校方 `created_at`，缺少或無法解析時保留 null。`confirmedAt` 是本系統完成讀回核對的時間；兩者都不冒稱正式 `submittedAt`。這個結果目前沒有轉成既有公開 `TronClassSubmissionReceipt`，不能直接用校方建立時間填入該舊收據介面。

**查證與防重送。** 有保存 acknowledgment 而讀回失敗時，可用新 candidate instance 的 `reconcile(ownerKey, operationId)` 查原版本。關閉寫入後仍可查證，同一校方本人重新綁定後也可恢復；此方法不呼叫 POST。Claim 的本文與 manifest 會重新比對摘要，避免查證過程換內容。若正式 POST 的整個回應遺失，沒有可信 acknowledgment ID，仍維持 `awaiting-confirmation`；不能靠看到同內容就認定是本次操作，也不會再送一次。

**持久化接線。** `createTronClassControlledSubmission()` 已直接使用 Firestore transaction journal，將附件結果保存後才交給 final。Operation 與舊服務使用相同 owner／operation hash，採明示 version 2 與 candidate 標記；遇到舊 version 1 會拒絕覆寫。校方學生／作業鎖與舊服務共用相同 hash，跨 nuni owner 也只能取得一次。本輪遇到任何既有鎖均拒絕，包含舊 `not-sent`；不自行清除或轉換舊鎖。

每個交易先讀取 `_tronClassBindings` 的關帳／解除／換綁 barrier，核對當下本人、revision 與期限，再讀寫 operation 及鎖。附件有固定 file slot、完整 manifest 與總量限制；保存 acknowledgment 前會重新核對原 attempt 和鎖，不把 acknowledged 標成已完成讀回。所有 v2 記錄與鎖使用 `purgeAt: null`，避免 TTL 讓原操作再次送出。新增的私有資料仍由 ownerKey 清理流程覆蓋；11/18 已加入平台關帳 outbox worker，部署條件見下節。

**驗證與剩餘接線。** `tronClassControlledFlow.test.ts` 直接使用實際工廠與 journal，配合支援原子提交、rollback、先讀後寫的交易測試資料庫，完成文字與兩個 PDF／ZIP MIME 附件的 8 條整合流程：正常順序、三階段失敗、第二檔失敗、少檔後唯讀恢復、跨 instance 防重送及關帳競態。每次操作都可重建工廠，仍讀回資料庫中的原 claim／manifest／acknowledgment。沒有手造已上傳 token，也沒有真人作業送交。

Node **22.23.5** 的整合回歸：37 個測試檔通過、1 個環境相關檔略過；**1,260 項通過、3 項略過、0 失敗**。修改範圍的 12 個 TypeScript 模組／測試連同 imports 依原 Web strict 設定通過型別檢查。完整 Web TypeScript 在本地兩次以 exit 137 結束、沒有診斷輸出，不能列為本地通過，另依 GitHub CI 查核。測試資料庫不是 Firestore emulator；正式 Firestore 與校方 session／CSRF、可信 storage policy、來源權限 reader、正式 adapter／收據介面及本人與教師端收件仍須驗收。

### 既有站內服務的送出狀態

1. 讀取本人課程與作業，確認來源已提供明確規則。
2. 使用者檢視預覽，勾選確認，送出前重新讀取條件。
3. 先以最新條件核對全部文字與附件，全部合格才逐檔上傳並驗證完整集合；任何一檔失敗就不進入最終送出。
4. Firestore transaction 取得操作及作業鎖。鎖以校方、學生、課程、作業為範圍，即使同一校方學生綁定不同 nuni 帳號也共用。
5. 再確認目前綁定與最新作業規則，之後才呼叫來源送出。
6. 讀回來源收據，核對學生、課程、作業、正式 submitted 狀態、有效時間、本次文字與完整附件；排除原本已存在的收據。

HTTP 200、附件上傳完成或 writer 沒有拋例外，都不構成正式繳交成功。結果不明會保留 `unknown`，相同或其他操作不得盲目重送。

v2 一旦取得 final claim 就不會釋放原鎖。純附件上傳失敗時，UI 保留原 operation，只有明確停止準備成功後才恢復編輯；重新預覽與確認後建立新 operation。校方可能留下未關聯的上傳物件，清除方式須等正式上傳契約驗證後補齊。

UI 的 sessionStorage 只保存 owner＋課程＋作業對應的 operation ID，供重開頁面後查證；沒有保存作業文字、附件或密碼。伺服器 ledger 會保存上傳 metadata、內容 digest，以及確認成功後的收據（含收據文字），不可宣稱後端完全不保存作業內容。

同一 nuni owner 重新連接同一校方 studentId 後，可以用新 revision 只讀查證舊 operation；換成不同學生會被拒絕。草稿仍依身分及 revision 隔離。

## 正式寫入開放條件

production `createTronClassSubmissionSource()` 目前為 `contractVerified: false`，`uploadFile`、`submit`、`listSubmissions` 會明確拒絕。把 `TRONCLASS_HOMEWORK_WRITE_ENABLED` 改為 true 仍無法解鎖。

本輪新增的 `readSubmissionHistory` 是獨立唯讀能力，不受 writer 開放條件限制；它不等同於寫入流程的 `listSubmissions` 收據查證。公開前端已提供真正 final 與多階段 upload 的路徑證據，但尚未取得可證明真實寫入成功、完整附件關聯及超時恢復的校方回應。

開放前需要一個可控制、可驗證結果的測試課程及作業，記錄實際上傳、關聯附件、最終送出、讀回本人收據的校方契約；敏感 cookie、帳密及作業內容不得放進版本庫或測試 fixture。需確認：

- CSRF／session 更新、校方課程與學生識別、正式 submitted 與 draft 的差異。
- 檔案類型、大小、數量、可送交時間、補交、剩餘次數、個人／小組作業等權限。
- 文字與完整附件如何從正式收據回讀；超時後如何辨認此次操作，防止誤認舊版本。
- 真正送出後，校方學生頁與教師收件都能看到同一筆結果。
- 在隔離環境驗證之後，才能實作 verified adapter，再開啟 runtime write switch。

2026-11-18 已使用真人校方帳號完成上述唯讀抽樣；未對學校送出作業，也未證明所有寫入契約已成立。

### 受控候選實作的範圍

`tronClassSubmissionProtocol.ts` 已根據官方公開 client 實作新作業 POST 的固定 body、一般檔案 metadata body、S3／WRPC callback body，以及保守的 acknowledgment／metadata parser。純文字先做 HTML escape 再保留換行；一般附件使用數字 ID，不把 `operationId` 或猜測的 upload key 放入校方 body。Metadata 的 `parent_id: 0` 代表個人資源根目錄，不是課程或活動 ID。

Metadata parser 只回傳 `metadata-created` 和數字 ID，二進位能力固定為 `unsupported`；不使用或回傳任意 `upload_url`。Acknowledgment parser 要求明確的本人、活動、新 ID 與非草稿／非教師代標等欄位；課程由已授權的活動與 server context 固定，回應可省略 `course_id`，但明示的課程／活動／本人歸屬若不一致仍拒絕。缺少必要證據保持 `unconfirmed`，後續仍須精確本人版本讀回。這是保守候選 schema，尚無真人 POST 回應證明所有必填欄位一定存在。結果不含本文、教師資料、時間或 `receipt`，尤其不將 `created_at` 改成 `submittedAt`。

`createTronClassTextSubmissionCandidate()` 是供受控環境驗證的獨立候選，不是 production `TronClassSubmissionSource`。其限制為：

- `enabled` 預設 false，`contractVerified` 固定 false；沒有公開 HTTP 入口，也沒有環境變數可把它接入既有正式送出流程。
- 只接受 normal、個人、一般窗口、首次、純文字；呼叫端必須提供從校方資料取得的權限確認、完整空歷史、零送出次數及前置活動已符合的證明。候選不以 raw activity 缺少欄位推論放行。
- 使用固定靜宜 origin 與 `/api/course/activities/{id}/submissions` POST，拒絕任意路徑、query、附件 ID、二進位或其他作業模式。沿用已核對的官方 client header 序列化：`XSRF-TOKEN` 缺少或空值時省略 `X-XSRF-TOKEN`；有值時先 URL decode 並檢查格式，格式不符即停止。這不證明校方已接受 CSRF 或 POST，實際 session／寫入契約仍須驗收。
- 送出前後重新檢查 binding revision；預設 15 秒、最多 1 MiB 回應、無 redirect／fallback／retry。單一 candidate 實例只允許一次外部嘗試，競態或逾時不會再送。
- 上述單一實例保護不能代替既有持久化 operation／作業鎖。接入正式 provider 前，仍須完成真實權限 reader、CSRF／session 契約、持久化 claim 與本人／教師 readback 驗收。

目前測試全部注入記憶體 HTTP 回應與合成身分；本次沒有執行候選的真實校方 POST，也沒有開放附件傳輸或把 acknowledgment 當成成功收據。

### 離線契約查核工具

`scripts/tronclass/analyze-har.mjs` 可在本機檢查已獲授權的 HAR，輸出固定靜宜 origin、白名單路徑模板、HTTP method／status、去值化 JSON 型別與 upload → final → 本人 readback 的證據缺口。原始 header、cookie、query、學生代號、檔名、內容及未知欄位名稱都不輸出；輸入、分析深度與輸出均有限制，錯誤也使用固定代碼。

此工具不連網、不重播操作，不會自行開放 adapter。HAR 可被編輯，HTTP 2xx 或完整觀察鏈也不能取代真人校方驗收，報告的 `contractVerified` 永遠是 false。使用方式、輸入限制與缺口說明見 [`scripts/tronclass/README.md`](../../scripts/tronclass/README.md)。原始 HAR 不應提交 Git 或傳入對話。

本輪分析器已升為 `formatVersion: 2`，辨識官方 activity／本人 `submission_list` GET、POST／PUT final、metadata、可精確關聯的同來源 binary PUT 及 callback。舊猜測路徑保留 `legacy_*` 分類，不再作為正式流程證據。它會核對登入脈絡、事前歷史、相同作業與版本、`created_by`、數字 upload IDs、精確本文及唯一最新版；POST 新送出與 PUT 草稿轉正式分開處理，後續退回或讀取失敗不會被先前成功掩蓋。

Binary 證據只採用先前 metadata 中完全相同的同來源 `upload_url`，包含 query 的一致性；這是離線比對，不代表該 URL 已獲准作為線上 PUT 目的地。跨來源儲存服務、QINIU 或外部資源明確列為未支援。空報告、未識別路徑與不足的 chain 仍不能證明 HAR 沒有操作，完整觀察鏈也不會把 `contractVerified` 改成 true。使用範圍見 [分析器說明](../../scripts/tronclass/README.md)。

## 環境設定

這組 `/api/tronclass` 路由執行於 **Next.js Web server runtime**。沿用既有平台 API、Firebase Admin 服務帳號與校方網路設定；只把設定放在 `nuni-functions` 不會啟用這些 Web 路由。Firebase Admin 由既有 `getFirebaseAdmin()` 初始化，服務帳戶的 project ID 必須是 `campus-one-tw`；不要建立替代資料庫或放寬 Firestore client rules。

| 設定 | 行為 |
| --- | --- |
| `WEB_PUBLIC_ORIGIN` | Web 頁面的完整 origin，例如正式站 `https://nuni.tw`；Platform cookie 操作以此核對同源。測試站須填入其實際來源，不能直接沿用正式站 origin。 |
| `NUNI_API_BASE_URL` | 平台 session 查證的既有 API；預設為 `https://api.nuni.tw`。使用 Platform 帳號時須可連線。 |
| `BFF_SESSION_SECRET` | Platform session 加密及頁面身分核對所需，至少 32 字元；也可作為未另設 TronClass secret 時的加密來源。 |
| `TRONCLASS_INTEGRATION_ENABLED=true` | 整合路由預設停用，只有明確設為 `true` 才開放。正式開放綁定前須先接通關帳清理 worker |
| `TRONCLASS_RETENTION_ENABLED=true` | 綁定與重新連線須明確啟用到期清理，才可保存加密的校方 session |
| `TRONCLASS_SESSION_SECRET` | 至少 32 字元，用來衍生 session 加密密鑰；未設時沿用 `BFF_SESSION_SECRET` |
| `TRONCLASS_HOMEWORK_WRITE_ENABLED=true` | 只有來源契約也已驗證時才可能允許寫入；本分支 adapter 仍固定拒絕 |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | 放在 **Web runtime** 的既有 `campus-one-tw` 服務帳戶原始 JSON。`getFirebaseAdmin()` 不讀 `FIREBASE_SERVICE_ACCOUNT_BASE64`；缺少此設定時綁定狀態、登入限流與 session 保存皆不可用。 |
| `PU_EDGE_RELAY_URL`、`PU_EDGE_RELAY_SECRET` | Web 主機若已使用校方 relay，沿用該組設定；兩者未完整設定時預設 IPv4 直連。備援 relay 另依既有部署設定，不自行改換目的地。 |

密鑰只放既有 Web 主機的 secret store，不可使用 `NEXT_PUBLIC_*` 或 Docker build args。Firebase Admin 初始化失敗會由目前 process 記住；修正設定後須重啟該 Web process。換 session 加密密鑰後，舊綁定需重新連接，不應在錯誤訊息或 log 中輸出密鑰與 cookie。設定範例在 `apps/web/.env.example` 與 `apps/web/nuni.env.example`。

### 測試入口與部署狀態（2026-11-18）

候選站必須包含本分支的 `/tronclass` 頁面與 `/api/tronclass` 路由，並完成上述 Web runtime 設定。使用者先登入 nuni，再於 `/tronclass` 驗證學校帳號；既有校方瀏覽器登入不會自行轉成 nuni 綁定。連接成功後，工作區才會呼叫 `sync` 讀取課程與作業，選擇課程後再讀教材及公告。

截至本輪，PR #616 尚無已驗證可用的 Web 預覽部署。現有 `.github/workflows/preview-deploy.yml` 只發布 EAS Mobile Update，`Preview Deploy` skipped 或其他 CI 成功都不表示 Web 已上線。Web 正式發布依 `deploy/web/RELEASE.md` 的 main 手動流程辦理；沒有候選站發布紀錄前，不能把正式站網址當成此分支的驗收入口。即使綁定與唯讀同步已部署，正式作業繳交仍需 production provider 的契約與收件驗證，不能只切換環境旗標。

新增私有集合 `_tronClassBindings`、`_tronClassLoginAttempts`、`_tronClassSubmissionOperations`、`_tronClassSubmissionLocks` 沿用 server-only 存取；現有 Firestore rules 沒有給它們 client 讀寫權限。不得對 unknown operation 或對應作業鎖設定自動刪除，否則會失去防重送依據。

## 帳號刪除與保留期限

Firebase 既有 `accountDeletion` 在標記關帳後，會呼叫 server-only 的 `closeTronClassOwner()`。清理順序為：

1. 將 binding 改成永久關閉標記，只保留 owner hash、隨機 revision、時間與狀態，先阻止進行中的登入或操作寫回。
2. 對該 owner 的鎖交易式重讀。只有持久化 `not-sent` 才能釋放；其他鎖改成不含身分、檔案或內容的 `owner-deleted` 標記，避免校方同學生換 nuni 帳號後重送。
3. 分頁刪除該 owner 的作業 ledger 與登入嘗試，包含該 owner 各校方帳號的個別配額。

所有 ledger 變更的 transaction 也會讀取關閉標記，防止清理完成後被尚未結束的請求重新建立。已確認收據的 ledger 日後到期清除，仍會保留作業鎖；重放同一 operation ID 也不能重新送交。

**平台帳號（Google／nuni）關帳接線：**本分支新增 PostgreSQL 的帳號狀態／刪除 trigger，與真實 `platform_accounts` 關帳交易一同寫入 durable outbox。背景 worker 以 lease token 領取並呼叫同一 `closeTronClassOwner()`，成功才刪除事件及其 platform ID；失敗固定錯誤碼、退避重試，程序中斷後可重新領取。worker 只讀明確關帳事件，不掃不存在的帳號猜測關帳，也沒有讓客戶端任意傳 owner 的 HTTP 端點。專用資料庫設定、最小權限、候選 migration 與啟用順序見 [平台關帳部署說明](../../deploy/nuni-api/tronclass-account-closure/README.md)。本輪未套用正式 PostgreSQL migration，因此不能宣稱 production 平台關帳已啟用自動清理。

**到期清理：**`TRONCLASS_RETENTION_ENABLED=true` 會在 Node.js Web 程序啟用背景 worker，啟動時立即非同步執行第一輪，每輪結束後等待 4 分鐘加未滿 60 秒的隨機延遲。三個固定集合各自最多掃描 200 筆，每輪合計最多 600 筆。掃描失敗後仍會排定下一輪。新綁定要求目前程序在最近 30 分鐘內至少完整清理成功一輪。若啟動的第一輪仍在進行，新綁定最多等 3 秒再檢查。未曾成功或距上次成功超過 30 分鐘時，綁定會回傳 HTTP 503（`TRONCLASS_RETENTION_REQUIRED`）。失敗或略過的批次不會更新成功時間，重新成功後即恢復接受綁定。同一程序不重疊，跨程序由 Firestore transaction 重讀目前期限及狀態後決定是否刪除。換綁、配額續期或 draft 轉成 unknown 時不會被舊查詢結果刪除。游標與輪換順序避免不應刪除的紀錄堵住其他已到期資料。這個方式保留 Spark 部署相容性，不依賴付費 TTL；仍受實際服務運作與 Firestore 配額影響，不承諾到期瞬間刪除。

程式依以下期限清理，伺服器授權仍即時核對到期時間，不等待背景刪除：

| 文件 | purgeAt |
| --- | --- |
| 已連接校方 session | 12 小時有效期到期 |
| 登入嘗試配額 | 15 分鐘視窗到期 |
| v1 尚未最終送出的 draft operation | 24 小時 |
| v1 已確認成功的 receipt operation | 30 天 |
| unknown / submitting 與所有 v2 operation | null，不自動到期；關帳時清理 |
| closed / disconnected 綁定標記、所有作業鎖 | 不設定 TTL |

Firebase TTL deletion 需要已啟用計費。預設 `firebase.json` 沒有啟用 TTL；[可選 TTL profile](../../deploy/tronclass/README.md) 產生器會保留所有既有索引，另加入三個 `purgeAt` policy，並明確停用作業鎖的 TTL。readiness gate 會核對 exact field 的 `ACTIVE` 狀態、零額外 offset 及鎖 policy 已停用，不能只因一般索引 READY 就通過。本輪未修改 production 計費或套用 TTL policy。正式啟用時需部署 retention worker 設定及平台關帳 migration／worker；若使用可選 TTL，還需先確認該專案已符合計費前提。

## 驗證方式與範圍

使用專案支援的 Node 22，先執行 `node scripts/build-functions-shared.cjs`。Web 測試在 `apps/web` 執行 `vitest run`，包含 binding、auth、reader、route、submission source／service、Agent grants／意圖／工具／下載、client、TronClassWorkspace 與既有 Assistant／NuniApp 回歸；另外驗證 Mobile 五個舊 writer 沒有任何網路送出。HAR 測試使用 `node --test scripts/tronclass/analyze-har.test.mjs`，已加入既有 CI。

### 2026-11-18 本輪工作區與附件下載驗證

本輪已合入 `main` 的 `6b0dbe30` 及前輪公開 v2 service，完成 Web／Mobile 作業待辦、本人歷史附件下載、登入 Cookie 輪替及同步／下載期限取消。以下為這一輪實際執行的本機驗證；最新提交的 GitHub CI 已觸發，結果仍須以該提交的 Actions 為準，不沿用先前 head 的 CI 綠燈。

| 範圍 | 實際結果 |
| --- | --- |
| Web TronClass 整合回歸 | 使用 `maxWorkers: 4`；56 個檔案通過、4 個略過，1,790 項通過、33 項略過、0 失敗 |
| 原生 Mobile／transport／session 回歸 | 8 suites、174 / 174 通過，包含歷史附件分享與作業待辦流程 |
| 底層 scraper 回歸 | 122 / 122 通過 |
| 最後教材下載與底層取消回歸 | 52 / 52 通過；涵蓋下載期限內的 metadata 讀取取消，與上述回歸有重疊，不重複加總 |
| 受影響範圍 ESLint／TypeScript | 通過；既有 lint warnings 保留，未降低規則 |
| 完整 Web Next build | 使用 CI 規定的 public 合成設定、Node 22.23.5 與本機 4 GiB heap，編譯、完整 TypeScript、靜態頁面及產物整理均完成；TypeScript 階段約 65 秒，未略過型別檢查 |

先前一次本機 build 在預設約 2 GiB heap 下於 TypeScript 階段耗盡記憶體；提高該次程序的 heap 上限後完整完成，未因此變更 repository 建置規則。CI 合成 public 設定的 build 不等同正式環境設定驗收；本輪未重新執行原生商店 build、真人裝置或校方登入／收件驗收。33 項 skipped 不計為通過，前輪完整 Web、資料庫與原生 export 結果分開保留於下方。

`main` 的 `6b0dbe30` 已包含 `picomatch` 公告 `GHSA-fc5q-39xc-vjpf` 的既有、具期限風險接受紀錄。本輪隨主線合入該紀錄，沒有另增例外、修改版本號或放寬安全 gate；因此下方前輪「audit 被阻擋」是當時觀察，不能直接當作目前新 head 的檢查結果。新的 CI／security gate 狀態仍須依最新 Actions 核對。

### 2026-11-18 前輪整合證據（截至 `0a4b7db8`）

前輪先合入 `main` 的 `d4bc4cbf`，再接上公開 v2 service。以下保留截至 `0a4b7db8` 的驗證紀錄：完整 Web 測試執行於該輪開發收尾期間；其後變更另跑當時的 TronClass／instrumentation 範圍，兩者有重疊，不能相加，也不代表目前新 head 已重跑全部項目。

| 範圍 | 實際結果 |
| --- | --- |
| 完整 Web Vitest | 770 個檔案通過、16 個略過；16,641 項通過、141 項略過、0 失敗 |
| 前輪最後 TronClass、relay 與 instrumentation 回歸 | 53 個檔案通過、4 個略過；1,574 項通過、33 項略過、0 失敗；包含公開 v2 adapter、default factory 禁寫、HTTP route 整合與底層取消接線後的回歸 |
| 底層 scraper／relay／PU pause 回歸 | 3 suites、152 項通過、0 略過；涵蓋 direct socket 及 relay body 取消、內部分頁／fallback deadline、舊呼叫相容性 |
| 真 Firestore Emulator | controlled journal 8 項與 retention 6 項，合計 14 / 14 通過 |
| 真 PostgreSQL 17.12 | 關帳 outbox、角色權限、lease、rollback 與實際 SQL 逾時，16 / 16 通過 |
| 前輪原生 Mobile／transport／session 測試 | 9 suites、149 / 149 通過 |
| Mobile 受影響導覽回歸 | 4 suites、140 / 140 通過；與上列分開列示，不加總 |
| 完整 Web 與 Mobile TypeScript | Node 22.23.5，均 exit 0 |
| 完整 monorepo ESLint | `pnpm lint` exit 0；既有 warnings 保留，沒有降低規則 |
| 原生 iOS／Android Metro JS export | development 設定下兩平台均 exit 0；不等同原生商店 build 或真人裝置驗收 |
| 正式環境 iOS／Android JS export | 兩平台均在 Expo 設定階段因缺少 `EXPO_PUBLIC_FIREBASE_API_KEY` 停止，尚未進入 Metro；未加入假設定或略過 release gate |
| UI design gate | `--base origin/main` 通過 |

普通 Vitest 未啟動 PostgreSQL／Firestore Emulator 時會略過相應檔案；上表真資料庫結果來自另外實際啟動的隔離 runtime，不把 skipped 計作通過。學校登入回應與作業內容均為合成資料，沒有將其他學生的真實課務資料轉為 fixture，也沒有真人作業送交。

在前輪尚未合入 `main` 的 `6b0dbe30` 時，11/17 更新的 `picomatch` advisory `GHSA-fc5q-39xc-vjpf` 沒有可用已發布修正版，當時的 `workspace-prod`／`workspace-all` audit 都被既有 high gate 阻擋。該輪沒有修改例外名單、改版本號假裝修補，或放寬安全 gate。此處僅保留歷史觀察；本輪合入主線既有風險接受紀錄的狀態與最新驗證見上一節。

### 先前開發回合

前輪（2026-11-16，`ca87994d`）的驗證結果保留如下。這是指定範圍的回歸結果，不代表整個 monorepo 的所有測試均已執行；重跑的子集合不重複累加。最新詳情／草稿恢復的結果另列於下方。

| 範圍 | 結果 |
| --- | --- |
| Web TronClass 回歸 | **30 個測試檔、809 / 809 通過**，包含新規則 UI、protocol 與 candidate |
| 完整 Web TypeScript 檢查 | 通過，exit 0 |
| 本輪修改的 Web TypeScript 檔 ESLint | **12 個檔案，`--max-warnings 0` 通過** |
| nuni UI design gate | `--base origin/main` 通過 |
| 離線 HAR v2 | **32 / 32 通過**，包含交叉審查發現的作者、baseline 範圍、metadata 與同來源 401 邊界 |

本輪新涵蓋零附件額度、文字／附件模式、最新規則變更、全部附件在上傳前核對、prepare 失敗撤銷舊資格；protocol 的數字 ID、純文字處理、metadata 與 acknowledgment 分流；candidate 的預設停用、權限不明停止、deadline 跨過 awaited binding check、固定 POST、有限回應、CSRF 格式、取消／逾時、同時呼叫只送一次，以及綁定變更丟棄晚到結果。protocol 131 項、candidate 45 項與規則 UI 20 項均包含在 Web 809 項之內，不重複累加。

既有本人歷史、Agent 權限、資料可見性、防重與重新連接亦包含在本輪 Web 指定範圍內。前輪 Backend account＋dorm 49 項、scraper 88 項與其他 Mobile 測試未在本輪重新計數；相應實作本輪沒有變更。

測試中的 verified provider、帳號、課程及收據都是合成資料，用於證明權限隔離、防重、失敗與恢復行為。官方公開 JavaScript 的匿名 GET 查核可證明前端使用的路徑與欄位，不能取代真人帳號回應、真實繳交或教師收件驗收。本輪沒有宣告正式部署，也未宣告桌面／窄螢幕／深色模式的瀏覽器視覺驗證通過；UI design gate 是程式檢查，不等同視覺驗收。

## 本輪詳情與草稿恢復驗證（2026-11-16）

本輪本地使用 Node **24.22.1** 與相同鎖檔的依賴，不修改專案 Node **22.23.5** 要求；該指定 runtime 的結果須另讀新提交的 GitHub CI。

| 範圍 | 本輪結果 |
| --- | --- |
| Web 全部非模擬器 TronClass 相關測試及站內連結檢查 | **33 檔、955／955 通過** |
| 納入 main `ab9c8677` 後的整合回歸 | **34 檔、1,025／1,025 通過**；含上述 955 項及主線地圖變更的 70 項 |
| 完整 Web TypeScript | 通過，exit 0 |
| 本輪 TypeScript ESLint | 23 個 Web 檔按 Web config、1 個 shared 檔按其 config，`--max-warnings 0` 通過 |
| nuni UI design gate、git diff 格式檢查 | 通過 |
| 瀏覽器視覺、真人校方登入／繳交 | **未完成驗收** |

955 項已包含草稿重連／換帳號、來源設定、client 邊界、原 Assistant、繳交防重與來源失效情境，各子集合不重複累加。main `ab9c867719d8de71660a539c78346f2173a4c0fd` 僅帶入已合併的地圖三檔變更；整合後重新執行上述 34 檔、完整 Web TypeScript 與 UI design gate 均通過。撤權修補先以順序合成回應重現 9 項失敗，再修正為通過；沒有呼叫真實校方 writer。前輪 GitHub Web Tests 的唯一失敗，來自導航掃描將校方 API `path` 誤判為站內路由，本輪改成明確的 `schoolPath`，保留原掃描與固定來源驗證。未修改 workflow、規則或 allowlist。

本輪嘗試瀏覽器畫面驗收，但本機瀏覽器啟動受執行環境限制、連接的瀏覽器不可用，雲端瀏覽器也無法連到本機測試頁；沒有將程式／DOM 檢查宣稱為實際視覺驗收。HAR、Mobile 真機及教師收件本輪未重新驗收。

## 2026-11-18 收尾修正與瀏覽器驗證入口

原生 client 的繳交狀態不再先做字串轉換。JSON 陣列 `['unknown']` 或 `['submitted']` 必須拒絕，不能進入完成分支而清除草稿及待查操作；同步錯誤類別、作業模式及個人／小組型別也改為嚴格字串 enum。正常 `unknown`、`submitted` 與 `confirmed` 回應維持原本語意。

兩種 Web Docker recipe 及各自的 deny-all build context 必須明列 `tronClassAccountLifecycle.js`，讓平台關帳 worker 的靜態 import 能在容器內解析；一般 Next build 成功不能替代這項容器驗證。既有 release safety 檢查會核對明列的後端來源及相對依賴閉包。

[Web 瀏覽器回歸](../../scripts/tronclass/README.md#web-瀏覽器回歸) 使用實際 Next standalone，測試 1440 px／390 px 的淺色與深色畫面、合成綁定、選課、教材下載、預覽、停用送交及原操作查證。CI 上傳截圖與帶 checkout／tree／Build ID 的報告；此段說明已加入的驗證入口，執行是否通過須查看目前 head 的 CI artifact，不能由腳本存在推定。瀏覽器只接收合成 API 回應，未進行真人校方登入或繳交。

## 官方依據

- [靜宜大學教學發展中心：TronClass 登入說明](https://tdcenter.pu.edu.tw/p/406-1061-45101,r1105.php?Lang=zh-tw)：校方正式入口與登入帳密說明。
- [TronClass 官方作業說明](https://support.tronclass.com/tw/question/homework/)：上傳檔案與正式繳交是不同步驟；作業規則與版本需要依實際作業確認。
- [2026-11-16 官方公開前端契約查核](tronclass-public-contract-2026-11-16.md)：記錄靜宜官方資源 URL、版本、SHA-256、模組及本人歷史／final／upload 證據，並列出完整 schema、CSRF、真實寫入及工具缺口。
- [2026-11-18 真人帳號唯讀查核](tronclass-live-read-verification-2026-11-18.md)：去識別化記錄實際本人活動、歷史及校方衍生 PDF 結構，區分成功讀取、未完成下載與尚未執行的正式寫入。

公開說明與前端程式提供部分接口證據，尚不足以構成經過受控校方驗收的完整學生 REST 寫入契約。
