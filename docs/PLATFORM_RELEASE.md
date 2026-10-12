# Campus One 平台管理與跨校社群發布紀錄

更新日期：2026-10-09（Asia/Taipei）。

## 正式 Web

https://nuni.tw 的 Web 已於 2026-10-09 11:56（Asia/Taipei）核對完成，Fly release 35，執行版本 `9a77ed2e2ebc1c6edc87da1e43d800b25d2f01b4`。本批更新平台／學校登入分流、登入原頁返回、多校資格、店家申請及課程操作；App 程式與 Web 部署狀態分開追蹤。

- 平台管理員入口：https://nuni.tw/admin/login。使用者指定的既有帳號已完成正式密碼登入設定；密碼、雜湊、session 和 cookie 不寫入來源或發布文件。
- 管理台：https://nuni.tw/admin。可管理學校狀態、功能模組、限時代理、公開看板、社群檢舉和操作紀錄，並保留原 Nuni 完整管理與教學入口。
- 共用選校包含 138 所真實學校，137 所尚未開放。選校是瀏覽篩選，不會建立在學資格或授予校方權限。
- 跨校公開社群：https://nuni.tw/social。原校內 `/community` 及其權限保留；登入後可跨校使用公開看板，貼文、封鎖、檢舉與下架使用實際 API 和資料庫。
- 既有帳號、法務、支援、刪除帳號、靜態資產及 Google callback 相容路徑保留。沒有變更 DNS 或啟用線上付款。

## 正式 API 與映像

API Fly release 20 執行 `cb57e78aa5f09155ec045ea4b5c130827cdf4fad`；Web 為 release 35。兩個服務各有兩台既有 nrt 主機，全部健康檢查通過。

| 服務 | 映像索引 | amd64 映像 |
| --- | --- | --- |
| Web | `31eb9925eb1cf68582b80735ae4186feb7e0daa5b4181dc40c6aac3f352b3a48` | `830c204240bec42b0b915cd6e438f145336e54589f545b3ebc41c0aae22972de` |
| API | `e63321d1b7afd8fb19200d44b557799e25fdb153a2f5349552a0d755cd8f47b7` | `445f5da3125041f093604fb5dc575a20a89c9abed8350bad311a5cfe96029813` |

值皆為 SHA-256，位於原有 `registry.fly.io/nuni-web`／`registry.fly.io/nuni-api`。API release 18 已執行 275／276 migration；19 增加 scoped installer、20 修正既有 persona，兩者沒有新 SQL，因此沿用已驗證 schema，不重跑 release migration。

回復程式可使用 API 相容索引 `2d520ef52b111315c52dcc93599b4f6ad31cfa3ca27efd9149838dbcb18f273d`（amd64 `08c7935e3cf6fe23dac61cb55fe46f17e30803c52b3eeccdc248beeeae4421d8`）。Web 前一版 release 34 amd64 映像為 `registry.fly.io/nuni-web@sha256:0b69ce818258337a4d070bc058483e6912afca4eda7e06d8c3f5a24d3ccb897f`；回復使用現行 `deploy/web/fly.nuni.toml` 及 rolling/update-only，不改 API 或資料庫。回復會停用本批新功能；必須再驗證登入、健康與舊路由。

## 正式社群初始化

已使用部署映像的官方 CLI，在真實開放校園安裝 30 份社群事件契約。保持 `CAMPUS_EVENT_SCHEMA_ENFORCEMENT=enforce`，逐份核對 active／version 2／SHA-256，以及 register、activate 的兩個 system governance 身分；新增 60 筆稽核，原有 33 份餐飲契約不變。這兩個身分是既有系統治理角色，不是兩位真人簽核。

CLI 執行前，缺少正式契約的建板請求回 503 並拒絕發布；修補及治理設定之後才重試。保留首次失敗證據，不把先前回應描述成成功。

2026-10-09 02:15 已建立正式「跨校交流」看板，歸屬真實開放的靜宜大學 tenant，登入者可跨校參與；在「所有校園」範圍可看到此看板，指定其他學校只顯示該校資料。BFF 重送相同 idempotency key 回到同一看板，公開看板總數為 1、貼文為 0。登入／新舊 session／管理資料／選校／看板／封鎖與檢舉／登出隔離共 21 項檢查通過。沒有送出正式測試貼文。

## Release 35 驗證

- 從 `9a77ed2` 的乾淨 git archive 建置 Linux amd64 映像，兩台 nrt 主機 rolling 更新成功、readiness 回報相同完整 SHA。
- 正式站 16/16 公開路由、49/49 HTML 實際引用同源資源通過；Google options 回傳 `true`。
- Web 測試 907 通過、1 略過，Web／App 型別檢查與 Web production build 通過；Web lint 0 errors、72 warnings。App 相關 11 suites／179 tests 通過，仍不代表正式 binary 或實機驗收。
- 本次未改 API 映像、secrets、資料庫或 DNS。HTTP 驗證不代表真人 Google 授權與全部登入後角色流程已驗收。

## Release 34 與先前 API 驗證

- Campus One Web 746 passed、1 skipped；型別、production Docker build、lint 無 error。71 項既有 lint warnings 保留。
- 本機真實 Web 容器 60 項 HTTP 檢查；正式站 34 項公開路由、資產、readiness、登入起始與原 Nuni 相容性檢查通過。
- 正式瀏覽器用指定帳密操作實際表單：17 項檢查、14 張遮罩截圖通過。涵蓋四個管理頁籤、138 校選單、社群登入狀態、真實看板選取、空白內容禁止送出、登出與資料撤銷；320px／1280px 沒有橫向溢出或 page error。
- 瀏覽器 console 並非零錯誤：4 筆既有 Cloudflare beacon 受 CSP 阻擋、6 筆其他 console error；已記錄的失敗 GET 僅兩筆登出後預期 401，但不能因此把所有未分類訊息都歸因為 401。
- 新 API 已完成密碼／鎖定／併發、公開社群權限與操作、路由及限定 persona 的專項驗證；實際 PostgreSQL 雙連線池驗證鎖定和同時建立。
- Nuni 完整 API 在 `946e29f` 自然完成，450 files（427 passed／14 failed／9 skipped）、3386 tests（3272 passed／50 failed／64 skipped），耗時 4236.58 秒。失敗分類為舊 staged-schema seed 35、calendar 版本斷言 5、leave 固定日期過期 4、既有靜態來源斷言 5、school proxy fixture 1。其中 10 個失敗在原始版本實際重現，其餘 40 個依 byte-identical 來源與共用失敗路徑分類；沒有宣稱 50 個全數在基準重跑。後續 `cb57e78` 的 persona 專項 5 tests、既有相關 11 tests、grant matrix 48 tests、API typecheck／build 通過；真 PostgreSQL 併發和副本 HTTP 驗證另行綁定此版本。
- 全域 Nuni 測試仍有既有失敗：舊 Web 為 1798 passed／5 failed，原始版本完整重跑的失敗集合相同；mobile 為 1344 passed／1 failed，基準重現。不能宣稱整個工作區全綠。
- 既有 release gate 499 tests 通過，派生 grant matrix 仍為 BLOCK／10749 unresolved；未修改規則或手動清空發現來取得綠燈。這不是完整安全或商店發布認證。

## 發布與資料保護

API 沿用既有 Nuni PostgreSQL，已套用新增 migration 275／276。舊來源庫 `Miiduoa/nuni-prod` 保持封存；Campus One 的 `deploy/nuni-api/source.json`、checksum patches 及 build.py 能重建實際 API 來源樹，沒有把另外的 `nuni-v2` 改寫當成正式來源。

正式變更前已保留資料庫備份分支（到期 2026-10-16 00:00 UTC），並用獨立資料庫副本演練。驗收後已刪除本次副本分支與測試容器，保留正式分支和備份分支。副本中的測試帳密與貼文不會回寫正式站。正式環境沒有建立示範貼文或假互動數。

副本演練發現並修正既有帳號 persona 編號與新格式不同時的讀取問題。`cb57e78` 以持久化 mapping 為準，帳號／tenant 鎖保護首次建立；不採用不屬於該帳號的既有人物，也不復活停用身分。修正後副本實際 HTTP 發文 201、相同 key 重送 201 且同資源、feed 200／1 則、outbox 3 筆契約 hash 相符、登出後 401。先前副本中失敗留下的貼文保持原狀，未宣稱修復歷史資料。

真 PostgreSQL 17.11 的兩個獨立 pool 同時等待帳號鎖後成功，共用唯一 person／mapping；既有 mapping 重用、停用身分拒絕，校籍與校務角色新增皆為 0。副本 runtime 使用 production／TLS verify-full／event enforcement enforce。副本 OTEL 指向不存在的 loopback sink，停止時出現 flush 失敗，因此不把這段演練當成正式 observability 驗收。

API 舊映像本身不能在 migration manifest 已前進後直接重啟；相容回復映像保留舊 API 程式加上 275／276 SQL 檔。回復應替換程式映像，不以舊資料庫覆蓋使用者新資料。

## 商店狀態

這次是正式 Web／API 發布，沒有提交或公開發布新的 App Store／Google Play 版本。原生 Nuni session／校方資料接軌、正式簽署、實機驗收、商店測試與提交仍由 `docs/STORE_RELEASE.md` 追蹤。Google Play 既有 versionCode 3 是原 Nuni 內部測試版。

## 版本與持續整合

Campus One 功能執行版本 `6868053` 的 CI 與 Maestro E2E 成功；封存最終 API patches 的 `92bf7c6` CI 亦成功。E2E 是 CI 環境檢查，不代表商店或真實裝置驗收。本批 `9a77ed2` 直接發布 Fly release 35；PR #29 仍為 stack base，因此沒有觸發既有 GitHub CI，不能沿用先前提交的 CI 當作本批證據。
