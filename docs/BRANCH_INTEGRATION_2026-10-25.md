# 2026-10-25 分支整合紀錄

## 範圍與決策

第一批以 `main` 的 `3f5c998734c96b698c47fc54e136bb6986274649` 為基準，核對當時全部 26 個遠端分支：主線 1 個、功能與修正分支 8 個、Dependabot 分支 17 個。處理期間新增 #203，第一批因此涵蓋 27 個分支，其中 18 個工作分支完成整合、8 個依賴分支保留為遞延草稿；整合 PR #204 已合併為 `32989e6a206a296602c9d428eabc3880cd412a2c`。

後續又出現 #205、#206、#207，本輪範圍擴為 **30 個分支：主線 1 個、納入整合的工作分支 21 個、遞延草稿 8 個**。這是各階段納入處理的分支總數；整合用的 #204 PR 本身不重複計入來源分支。本報告保留每一階段的來源及本機證據，最後的遠端 CI、實際合併提交與結果以各 PR 的 Checks 及合併紀錄為準。

| 階段 | 工作分支數 | 狀態與基準 |
| --- | ---: | --- |
| 第一批 #204 | 18 | 已合併，main `32989e6a`；原 27／18 的盤點與 7,702 項測試屬於這一批。 |
| 後續 #206：LMS 學習工作區 | 1 | 已合併，main `61eaac263009c9e7aa27d8a8e9ea608357af8bee`。 |
| 後續 #205：平台頁面 | 1 | 完成本機合成、針對性測試、正式建置、窄螢幕修正及瀏覽器複驗；最後遠端組合驗證與合併紀錄見 [#205](https://github.com/Miiduoa/graduation/pull/205)。 |
| 後續 #207：校園服務流程 | 1 | 完成獨立審閱與跨分支合成測試；原分支 CI、iOS 及合併紀錄見 [#207](https://github.com/Miiduoa/graduation/pull/207)。 |

#201 及其包含的四個功能分支、#202、#203 在第一批處理期間先進入主線；#204 保留當時最新主線 `c5de91e232918cf734096ffdb3d59cffbfeafa47` 的歷史。後續合成持續保留各來源 head 與已合併主線的祖先關係，不重寫原始提交，也不以版本較新作為相容性證明。

## 功能與修正分支

| PR | 分支 | 處理 |
| --- | --- | --- |
| #165 | `fix/school-service-details-20261024` | 由 #201、#202 完整納入；保留各校課務來源與公開服務邊界。 |
| #169 | `redesign/admin-workflows-20261024` | 由 #201、#202 完整納入；保留校方、教師、服務承辦權責及交易內授權檢查。 |
| #170 | `improve/school-accuracy-20261024` | 由 #201、#202 完整納入；跨校公開資訊、活動報名與行程提醒。 |
| #171 | `chore/docs-wording-scan-ignore` | 納入文件與既有掃描紀錄修正；12 筆提交 SHA 映射已核對相同檔案 blob，未增加忽略項目。 |
| #172 | `feat/daily-workflow-reliability-20261024` | 由 #201、#202 完整納入；失物刊登恢復、教材查找與學分試算。 |
| #191 | `fix/functions-server-readiness` | 納入登入、secret 讀取與輸入限制，另修正 preflight 執行順序及客戶端公車登入狀態。 |
| #201 | `improve/campus-experience-20261025` | 完整包含於 #202，不重複套用補丁。 |
| #202 | `improve/campus-daily-flow-20261025` | 納入最新 `d8a47453`，保留手機課表、大字體、圖片重新編碼及取消任務資源釋放。 |
| #203 | `fix/account-return-context-20261025` | 保留登入 query 白名單、安全內容錨點、OLED 頁尾及原生驗證紀錄，與 #202 登入交接一併整合。 |
| #205 | `feat/platform-pages-rebuild` | 保留來源 `906fe1abef5929e8dcb0d16e10d6e8b45fc868c4` 與主線完整歷史；補齊平台操作契約、工作階段隔離、課堂流程與手機排版，另與 #207 完成跨分支合成驗證。 |
| #206 | `improve/lms-study-workspace-20261025` | head `c65f753f12f75cca5094b4ba509c9b655bee9504` 已合併；Web／App 課程目錄與學習待辦，保留授權拒絕清除與晚回應隔離。 |
| #207 | `improve/campus-service-flows-20261025` | head `76e0eedcb63d6c59d601c10b289ece575495923d`；校園公告、活動與生活服務流程，獨立審閱與合成驗證完成，遠端結果見該 PR。 |

表中 #165 至 #203 屬第一批 #204。已用 Git ancestry 核對 #165、#169、#170、#172 最新 head 都是 #201 的祖先，#201 最新 head 又是 #202 的祖先。

## 第一批 #204 的依賴決策

| PR | 分支 | 處理 |
| --- | --- | --- |
| #173 | `dependabot/npm_and_yarn/backend/functions/functions-patch-minor-f08d2cd172` | 納入 jose、Functions 測試工具、globals 小版本，修正根 pnpm lock 與獨立 npm lock 不同步。 |
| #178 | `dependabot/github_actions/actions/setup-java-6` | 納入，維持 Java 21 設定。 |
| #179 | `dependabot/github_actions/expo/expo-github-action-9` | 納入，保留原發布條件與權限。 |
| #180 | `dependabot/github_actions/dorny/test-reporter-3` | 納入，維持既有 Maestro 報告流程。 |
| #181 | `dependabot/github_actions/gitleaks/gitleaks-action-3` | 納入，未放寬掃描或安全閘門。 |
| #182 | `dependabot/github_actions/actions/github-script-9` | 納入，保留既有預覽流程條件。 |
| #185 | `dependabot/pip/backend/ai-server/langchain-text-splitters-gte-1.1.3` | 納入；隔離環境驗證實際文字分段器與既有 indexer。 |
| #187 | `dependabot/pip/backend/ai-server/apscheduler-gte-3.11.3` | 納入；隔離環境驗證臺灣時區工作執行與取消。 |
| #193 | `dependabot/npm_and_yarn/backend/functions/babel/core-7.29.7` | 納入，更新 Functions 獨立 npm lock 中的 Babel。 |
| #174 | `dependabot/npm_and_yarn/backend/functions/jest-30.5.2` | 遞延草稿；需核對 Jest 30 與跨 workspace 測試工具、同步雙鎖檔。 |
| #175 | `dependabot/npm_and_yarn/backend/functions/zod-4.6.7` | 遞延草稿；需核對工具參數的 schema 轉換、required/properties 與驗證錯誤。 |
| #176 | `dependabot/npm_and_yarn/backend/functions/eslint-10.13.0` | 遞延草稿；應與 #177 及 workspace lint 工具鏈一起處理。 |
| #177 | `dependabot/npm_and_yarn/backend/functions/eslint/js-10.0.1` | 遞延草稿；不可單獨將 recommended config 升到不同於執行器的主要版本。 |
| #184 | `dependabot/pip/backend/ai-server/numpy-gte-2.5.4` | 遞延草稿；需核對 NumPy 2 與本機 ONNX、Chroma、MLX wheel 圖。 |
| #186 | `dependabot/pip/backend/ai-server/mlx-lm-gte-0.32.2` | 遞延草稿；需在 Apple Silicon 驗證載模、LoRA 與訓練腳本。 |
| #188 | `dependabot/pip/backend/ai-server/chromadb-gte-1.5.9` | 遞延草稿；需驗證既有向量庫與 PersistentClient，且不能將此版本視為已修復所有 advisory。 |
| #192 | `dependabot/npm_and_yarn/backend/functions/multi-a01711886d` | 遞延草稿；Admin 14 與現有 Functions 6.6 的 peer 範圍不相容，須協同升級 SDK。 |

本機 `requirements.txt` 使用最低版本約束；保留 #184、#186、#188 不會限制解析器選到較新版本，亦不代表本機執行期已鎖在舊版。實際已安裝的 NumPy、Chroma 與 MLX 版本不在本輪確認範圍。

其中 9 個依賴分支已隨 #204 整合；8 個草稿保留原分支與獨立遷移原因，沒有因延後而刪除或覆寫。各依賴原始 head、來源及雙鎖檔維護方式見 [依賴分支紀錄](DEPENDENCY_BRANCHES_2026-10-25.md)。未停用 Dependabot 的 major 或安全掃描。

## 第一批 #204 補上的修正

- 新登入頁保留白名單 query 與安全內容錨點（含匯入 `kind`）；移除巢狀 redirect 與 credential 參數。外部網址、控制字元、編碼路徑分隔字元、登入循環及過長輸入仍拒絕，Campus One 任務經既有 `/login` 交接。
- OLED 登入頁頁尾改用主題色，實際瀏覽器檢查文字對比至少 4.5。
- 助理請求先檢查登入與輸入上限，再讀取帳號；帳號刪除與停用保護維持有效。
- 公車 callable 回覆未登入時，Web／App 顯示登入需求並停止自動重試；Web 提供登入及公開站牌入口，App 保留公開站牌與官方查詢。
- 管理授權程式與 #169 原始 blob 核對，學校、教師與承辦的範圍限制未被合併覆蓋。
- 瀏覽器登入測試的合成 session 補齊格式正確的帳號 ID、非管理員旗標與 context；維持實際點擊返回及參數清除檢查。

## 第一批 #204 的驗證（歷史基準）

執行環境為 Node 22.23.4、pnpm 10.28.2。以下對應 #204 的整合程式；Web、App、Functions 共 **7,702 項通過**，只屬第一批，不能作為 #205、#206、#207 最終組合的測試總數。各分支原有 CI 或重疊的針對性測試沒有重複加總。#204 的 GitHub CI 與 iOS 驗證亦已通過後合併。

| 檢查 | 結果 |
| --- | --- |
| Frozen lockfile 安裝 | 通過 |
| 獨立 Functions 部署包 | 隔離 npm ci 成功，121 個 exports 及來源邊界驗證通過 |
| 完整 Web 測試 | 3,230 通過、11 既有略過、0 失敗 |
| 完整 App 測試 | 3,300 通過、1 既有略過、0 失敗 |
| 完整 Functions 測試 | 1,172 通過、0 略過、0 失敗 |
| 型別檢查 | App、shared 通過；Web 正式建置內型別檢查通過 |
| 全套 lint | 0 errors；保留 App 554、Web 99、Functions 6、shared 3 項既有 warnings |
| Web 正式模式建置 | 通過，standalone 可啟動 |
| 瀏覽器視覺／操作 | 29 項通過；涵蓋 320/390/768/1440 px、200% 字級、OLED、搜尋與登入返回 |
| 課表瀏覽器 | 9 項通過；涵蓋切校隔離、拖曳、鍵盤操作、取消與草稿保存 |
| Python 小版本 | 隔離環境的相依檢查、實際 indexer 及排程 smoke 通過；範圍見依賴紀錄 |

Web 首次與建置平行執行時，一項商家帳號切換測試逾時；單檔 14 項通過後，在原設定、無平行建置的情況下完整重跑 3,230 項通過。沒有提高逾時門檻或增加略過項目。

## 後續 #206：已合併的 LMS 學習工作區

將 #206 head `c65f753f` 與 #204 合併後的 main 實際合成，無衝突，沒有另加產品程式修正。合成 tree 與已合併 main `61eaac26` 一致，為 `33f572403c760bf2fa5175d717968ad7b91f07ab`。

審閱涵蓋 Web／Mobile 課程目錄、課程內容與學習待辦：登入載入或登出中卸載私有內容，帳號／context／課程切換隔離晚回應；401、403、404、`SESSION_CHANGED` 清除受拒資料，待辦依最新有效學生資格過濾，單門課的作業或測驗被拒絕時不殘留該課舊資料。

| 檢查 | 結果 |
| --- | --- |
| 實際合成後 Web／shared 針對性測試 | 16 個檔案、255 項通過 |
| 實際合成後 Mobile 針對性測試 | 3 個 suites、97 項通過 |
| GitHub CI | 全部通過，見 [#206 Checks](https://github.com/Miiduoa/graduation/pull/206/checks) |
| iOS | 兩項流程的 smoke 驗證通過 |

## 後續 #205：平台頁面整合與驗證

本機合成保留來源 `906fe1ab` 的 Campus One session／BFF 架構，以及已含 #206 的 main `61eaac26` 全部歷史。平台邏輯測試的基準為本機提交 `965a15874dba8fe91ec8c7c5680b12f6621bb5a2`、tree `9923bb1eaa9d0bc576ea771426bc7cda328a6d8c`。畫面檢視找出管理台直排篩選區仍使用 180px flex basis，造成手機按鈕過高；在 mobile media query 將子項改為 `flex: 0 1 auto` 後，已重建並完成全部瀏覽器複驗。修後受驗證的產品 tree 為 `50089058e220163699906d87af8c7d6041a9baf4`，與前一版僅差該 CSS。

另以本機候選 `4bbc75c4` 實際合入 #207，與另一工作樹已完成測試的跨分支組合 `a0337741` 比對，僅差上述 CSS 及新增的瀏覽器驗證腳本；其餘產品內容完全一致。這份合成用於確認相容性，兩個功能仍各自經原 PR 進入主線。#205 自身的完整測試與建置記錄在 [#205 Checks](https://github.com/Miiduoa/graduation/pull/205/checks)，兩者進入主線後另核對完整 main CI。下列分階段結果不冒充同一版本的完整測試總數。

### 整合時確認及修正的邊界

- **工作階段與校別隔離：** 沿用 Campus One session、`X-Campus-Session`、同源 JSON 請求及拒絕自動轉址。新管理表單依帳號／context／tenant 重建；授權載入、登出中或撤權時停止私有操作，過期請求的成功與失敗都不能更新新工作階段、導頁或繼續寫入。課班工作區另以 workspace ID 隔離名冊、教材與掛靠資料。
- **登入返回：** `/admin/ops`、`/admin/school-review` 使用明確的平台目的地分類，保留 #204 的 query 白名單、安全 hash、巢狀返回與憑證參數排除，不放寬任意轉址。
- **加人契約：** 使用正式 `POST /api/platform-admin/people/bind`，body 帶 `tenantId`、`email` 或 `personId`、`role`、`idempotencyKey`。先讀同校的嚴格授權投影；沒有管理員時只能建立 `school_admin`，確認 `hasRoleAdmin` 後才提供 `school_staff`。已開通學校還需要未到期的代操作資格；畫面引導至學校分頁明確啟用，不自動授予。成功回應按同一校別的完整授權狀態解析，再更新可用角色與名單。
- **店家審核契約：** 意向使用 `merchants/interest/:mpi/decision` 與 `idempotencyKey`；進件使用 `merchants/applications/:tenant/:fma/decision` 與當前 `expectedVersion`，不混用 idempotency key。GET 清單採既有嚴格解析器；成功後重載，409 重新讀取並請操作者確認最新資料，不自動重送舊決策。Gateway 僅加入對應的精確路徑與驗證，沿用後端授權。
- **課班生命週期：** 建立、加入、工作區、邀請及掛靠皆隔離卸載後的回應；建立成功後若帳號已切換，不繼續產生邀請或導頁。課堂讀取與操作具請求世代及生命週期保護，401／403／404／`SESSION_CHANGED` 清除對應工作區、名冊與操作按鈕。簽到維持是否已簽到及短碼條件；學生申請與教師核准／拒絕補簽都只在課堂 `closed` 時開放。
- **真實 API 回應：** 教師從 `roster.absent` 成員的 `makeupRequestState === 'pending'` 判斷待補簽，移除不存在的 GET `makeup-requests`，另以負向契約測試確認不會送往上游。學生 POST `makeup-requests` 仍保留。簽到、結束、補簽申請回傳直接的課堂物件，GET 課堂清單才回 `{sessions: [...]}`，補簽決策回名冊；空參數 POST 傳 `{}`。受控瀏覽器資料與斷言依這些正式契約建立，未知 API 路徑視為失敗。

上述修正不改伺服器端教師、成員或營運權限。先用具體切換帳號、切校與晚回應案例重現失敗，再驗證修正後通過；沒有以延長逾時、略過測試或虛構成功端點掩蓋問題。

### 驗證狀態

| 檢查 | 已確認結果／待辦 |
| --- | --- |
| Ops／Auth／Gateway 針對性測試 | 9 個檔案、416 項通過 |
| Class 針對性測試 | 10 個檔案、119 項通過；最終 `965a1587` 組合另重跑同組 119 項通過 |
| 型別與正式模式建置 | Web production build 全部通過；窄螢幕 CSS 修正後依原設定重建亦通過，沒有略過 TypeScript |
| 既有瀏覽器 smoke | 修後重跑 30 項檢查通過、0 page errors |
| 新嚴格 API／操作 harness | 修後重跑 11 項檢查通過、0 page errors、0 unknown API、0 contract failures；10 次受控合成寫入 |
| 窄螢幕與放大檢視 | 320／390 CSS px 及等效 200% 縮放皆無水平溢出；篩選按鈕高度 44 CSS px，過高留白已消除 |
| 最終遠端 CI／合併 | 精確 head、完整組合測試與合併結果見 [#205 Checks](https://github.com/Miiduoa/graduation/pull/205/checks) 及 PR 驗證紀錄 |

416 與 119 兩組含重疊的契約測試，不能直接相加；119 的組合重跑也不是新增 119 個獨立案例。新腳本 [platform-browser-smoke.py](../scripts/platform-browser-smoke.py) 限定本機 server，使用合成工作階段及嚴格 API fixtures；未知私有端點或不符合契約的請求直接使驗證失敗。使用與既有 campus-visual-smoke 相同的 Playwright 環境，透過 `PLATFORM_BROWSER_URL`、`PLATFORM_BROWSER_CHROMIUM` 指定本機正式產物及 Chromium，輸出位於 `artifacts/platform-browser`。

## 後續 #207：校園服務流程與跨分支驗證

#207 在前述工作期間新增，改善公告、活動與生活服務操作流程。已完成原 head `76e0eedc` 的獨立審閱與跨分支合成，沒有需要追加的產品修正。下列是原 PR 的 CI，與另行執行的 #205 合成驗證分開記錄。

| 原 PR CI（run `40168584607`） | 結果 |
| --- | --- |
| Web | 276 suites 通過、4 suites 略過；3,337 項通過、11 項略過 |
| Mobile | 300 suites 通過、1 suite 略過；3,348 項通過、1 項略過 |
| Functions | 92 suites、1,174 項通過 |
| 其餘常規 CI、CodeQL、SQL | 全部通過 |
| iOS（run `40168584638`） | native build 與 JavaScript bundle 通過；首次執行在 driver 階段未產生 flow JUnit 或畫面，遠端已啟動同 head 重跑；最終兩項 smoke 結果見 Checks |

獨立工作樹將 `76e0eedc` 與 #205 基準 `965a1587` 實際合成，tree 為 `dde392855d2628ac40ffb8bdd4087445c9e85fe1`，沒有衝突。僅 `legacyLogin.ts` 及對應測試重疊；結果同時保留服務列表的搜尋／篩選／頁數，以及管理頁與課班返回限制。合成後 **Web 13 套／327 項、Mobile 4 套／107 項、Functions 1 套／9 項全部通過**，Web typecheck 及 diff check 亦通過，沒有調整測試門檻。

審閱確認公告完整正文與受眾 metadata 保留，`visible:false` 不會被舊資料 fallback 重新顯示；活動不猜測未知結束時間，ICS 保留正確學校／來源、UTC、escaping 及 UTF-8 folding。圖書館 CSP 僅列入靜態目錄的 14 個 HTTPS origins；App 定位取消、逾時與最後操作優先邏輯會丟棄舊回應。此分支不變更依賴、資料庫或 BFF 授權。原作者的瀏覽器／RN Web 證據見 [校園服務驗證](https://github.com/Miiduoa/graduation/blob/76e0eedcb63d6c59d601c10b289ece575495923d/docs/verification/campus-service-flows-20261025.md)，遠端結果見 [#207 Checks](https://github.com/Miiduoa/graduation/pull/207/checks)。

## 風險紀錄與發布邊界

既有 [依賴風險處置](security/dependency-risk-acceptance.json) 的 9 筆例外仍於 **2026-10-31** 到期，本輪沒有新增、擴大或延長例外；也未增加 gitleaks 忽略項目。既有風險處置不代表上游已修補，新增依賴路徑、版本或 range 仍須重新核對，詳見 [安全修正紀錄](security/2026-10-24-remediation.md)。

本機瀏覽器使用正式模式產物、Chromium 143 和受控訪客／工作階段資料，不讀取正式帳號；它驗證畫面與 API 契約，不能代替真實 Google／學校 OAuth、實體裝置或完整本機 ML 環境驗收。已通過的 GitHub iOS smoke 依各階段記錄，與這些限制分開看待。

**本輪沒有進行 production 部署。** 正式模式 build 通過證明可建置與啟動；正式發布仍走專案原有獨立發布流程。最終遠端驗證使用各 PR 的精確 head，合併前核對完整 Checks，並在合併後比對主線 Git tree，確認與送驗內容一致。
