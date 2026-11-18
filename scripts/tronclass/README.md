# TronClass 離線契約查核

這支工具把**本機 HAR** 裡與靜宜 TronClass 有關的已知請求整理成去值化型別、階段關聯及證據缺口，供開發者檢查正式 adapter 的必要條件。它不登入、不發網路請求、不重播任何操作，也不會把 `contractVerified` 改成 `true`。

## 已支援的官方前端路徑

本版已依 2026-11-16 查核的靜宜官方公開 JavaScript 更新路徑與欄位語意。來源版本、資源 URL、SHA-256、module 定位及未知之處，見 [公開前端契約查核](../../docs/nuni/tronclass-public-contract-2026-11-16.md)。這些是官方 client 的實作證據，不是校方伺服器的正式寫入驗收。

| 階段 | 識別的方法／路徑 | 分析方式 |
| --- | --- | --- |
| 目前登入者 | `GET /api/profile` | 在記憶體核對數字 ID；觀察到換人或 401 後，不沿用原登入脈絡 |
| 活動詳情 | `GET /api/activities/{activityId}` | 核對活動、課程、homework 類型、個人作業及來源可見性 |
| 個人繳交歷史 | `GET /api/activities/{activityId}/students/{studentId}/submission_list` | 讀取 `{ list: [...] }`，核對本人、版本、本文及附件 |
| 新建繳交／草稿 | `POST /api/course/activities/{activityId}/submissions` | `is_draft: false` 才列入 final chain；true 與未知旗標分別計數 |
| 更新既有草稿 | 同一路徑 `PUT` | 另外核對 `submission_id`、回應 ID 與送出前本人草稿 |
| 建立上傳 metadata | `POST /api/uploads` | JSON metadata 與回應的數字 ID、`upload_url`；不視為已傳送檔案 |
| 傳送附件 | `PUT` 回應所指定的 `upload_url` | 只關聯較早成功 metadata 回應中的**完全相同、同來源 URL**，包含 query |
| 完成通知 | `POST /internal-api/upload/callback/{uploadId}` | S3／WRPC 分支須在 binary PUT 之後，且 numeric `file_key` 相同 |

原有 `/api/courses/{courseId}/homework-activities/{activityId}/submissions` 等猜測路徑保留為 `legacy_*` 觀察項目，不再建立官方 final chain。小組 `submission_list` 及個人單筆 `/submission` 可識別，但不代替完整的個人歷史；報告會列出未支援範圍。

**報告格式已升為 `formatVersion: 2`。** 上傳階段計數、狀態與時間欄位已調整；使用舊版報告欄位的程式須先更新，不應把新版與舊版結果直接合併。

## 使用方式

需要 Node.js 22，不需安裝套件。在 repository 根目錄執行：

```sh
node scripts/tronclass/analyze-har.mjs /absolute/path/capture.har > /absolute/path/contract-report.json
node --test scripts/tronclass/analyze-har.test.mjs
```

HAR 必須是你有權使用的本機一般檔案。工具拒絕 URL、符號連結、超過 16 MiB 的檔案，以及超過 1,000 筆的 HAR；不是監聽或網路代理工具。分析失敗時，stderr 只包含固定錯誤代碼，不包含輸入路徑或原始錯誤。

## 準備能查核的紀錄

使用學校核准的測試課程與測試帳號，或你已合法持有的操作紀錄。這版的可比對順序為：

1. 讀取目前登入者 `/api/profile` 及目標作業的活動詳情。
2. 讀取正式送出前的本人 `submission_list`，建立既有版本基準。
3. 有附件時，記錄 metadata、同來源 binary PUT，以及該 storage 分支需要的 callback。
4. 記錄正式 POST，或把既有草稿改為正式繳交的 PUT。
5. 再讀取同一作業、同一學生的 `submission_list`，核對同一筆結果。

必須包括相關 JSON 回應。只有 HTTP 狀態碼、只有上傳 metadata 或只有成功畫面，都不構成正式繳交證據。不要為了取得 HAR 對真實作業重複繳交。

原始 HAR 可能包含 session cookie、帳密、學生資料及完整作業。**原始 HAR 留在本機，不要提交 Git、貼到 issue，或傳給 Agent。** 分析器不修改原始檔；分享產生的報告前仍應依學校規範檢查。

## 關聯規則與保留的缺口

### 上傳分階段核對

`POST /api/uploads` 只建立 metadata。分析器要求回應具有數字 `id`，並以該 ID 關聯 final 的 `uploads`；不把 upload key、字串 ID 或另一筆檔案代號當成同一個物件。重複 metadata ID 或多份 metadata 共用相同 URL 時，保留歧義，不任意挑一筆。

metadata 若明示 `parent_type: activity`，`parent_id` 必須是本次目標活動；個人資源根目錄採明確的 `parent_type: null`、`parent_id: 0`。回應若帶有 parent 欄位，也不能與請求矛盾。其他或缺少 parent 語意保留 `upload_parent_scope_unsupported`，不因 upload ID 相同就忽略明示的其他活動歸屬。這些仍是離線關聯規則，不代表已驗證校方所有 parent 模式。

binary PUT 只允許 `https://tronclass.pu.edu.tw`，且必須精確符合較早、成功 metadata 回應的 `upload_url`。可解析同來源的根相對路徑；URL 含帳密、異常路徑、不同 query 或未提供先前 metadata 時，不建立關聯。報告只顯示 `{sameOriginUploadUrl}`，不輸出實際路徑或簽章。**不開放任意儲存網域，也不因 HAR 提供網址就擴大主機白名單。** 跨來源儲存服務和 QINIU 分塊流程明列為 unsupported。

S3／WRPC 的 raw PUT 以 HAR 宣告的 request body size 與 metadata size 比對；multipart PUT 要有唯一的 file part，檔名須與 metadata 相同。這些都只是**傳輸及 payload metadata 的觀察**：工具不計算檔案 digest、不證明 bytes 完整、不解碼 binary，也不把 2xx 當成儲存成功。S3／WRPC 還須有在 binary 之後、final 之前且同 ID 的 callback 2xx；只有 metadata 或只有 callback 不能補足 binary 缺口。

### 正式送出、版本與本人歷史

final 必須使用明確 `is_draft: false`；草稿及旗標未知的請求分開列出。預期本文是 `comment`，附件是去重的數字 `uploads` ID。讀回需以 `created_by.id`、history 路徑中的學生 ID、先前 profile 及可用的範圍欄位核對同一人、同一活動、同一筆 submission。本文必須完全相同，附件 ID 集合須完全相等，不能只吻合其中幾個檔案。

final 回應頂層及 submission 內明示的學生／建立人都必須一致；頂層的本人 `student.id` 不能蓋過 submission 中另一位作者。事前與事後歷史的每一筆，也須符合本人、活動及課程範圍，不能把有其他學生或其他活動的清單當作可靠基準。教師建立的歷史紀錄可保留不同的 `created_by.id`，但其明示學生及課程／活動仍須符合本人範圍，且不會被判為學生正式繳交。

| 來源狀態 | 判讀 |
| --- | --- |
| `submitted` | 明確不是草稿、退回或教師建立紀錄 |
| `draft` | `is_draft: true`，且未同時標示退回 |
| `returned` | `is_redo: true`，且未同時標示草稿 |
| `teacher-marked` | 明確不是草稿／退回，且教師建立及標記已繳均為 true |
| `unknown` | 必要旗標不足、型別不符、互相矛盾或來源不可見 |

只有 `submitted` 可構成學生正式狀態的觀察；教師標記不能代替學生上傳內容。最新版只依唯一的 `is_latest_version: true`，不以最大 ID、第一筆或較晚時間猜測。若最新讀回顯示退回、草稿、錯誤或不完整清單，不退回採用較早的成功結果，也不跨下一次同作業寫入拼接證據。

POST 還需在送出前本人歷史中未觀察到該回應 ID；PUT 則須觀察到同 ID、同作者的草稿轉換。缺少事前歷史或重用已存在的正式版本時，明列 freshness 缺口。這只是離線紀錄內的前後比較，無法證明伺服器清單完整或操作真正發生。

`created_at` 只標示為 `sourceCreatedAtCaptured`，**不改稱已驗證的正式送出時間**。多選題模式、簡報、LARK／其他資源及 rich text 附件尚未具備完整鏈結，會列為 unsupported；不把一般 `uploads` 符合就當成所有資源已回讀。

## 報告如何解讀

| 欄位 | 代表什麼 |
| --- | --- |
| `entries` | 固定來源的明列路徑，以及依 metadata 精確關聯的同來源 PUT。只輸出模板、HTTP method／狀態、去值化 JSON 型別與固定分類。 |
| `requestBody` / `responseBody` | 只含型別及允許的欄位名稱；沒有原始值、enum、examples 或 required 推論。未擷取、非 JSON、編碼、過大及無法解析的 body 均明確標記。binary request body 一律省略。 |
| `entries[].submissionIntent` | 正式送出、草稿或未知；由明確 `is_draft` 區分。 |
| `entries[].history` | 受限樣本內五種狀態的計數、最新版標記及 schema／分頁一致性；不輸出 submission ID 或作者 ID。 |
| `homeworkEvidence.missingTracePhases` | 在已識別路徑內，缺少 activity、metadata、binary、callback、final 或個人 history 的哪些觀察階段。它是整份 HAR 的階段清單；純文字作業沒有附件、非 S3／WRPC 沒有 callback，都可能正常出現在此清單。 |
| `homeworkEvidence.chains` | 每次明確 final 的同人、同活動、事前歷史、metadata／binary／callback、最新讀回之關聯。`observed` 是逐項觀察，`missingEvidence` 是尚缺條件；沒有「正式成功」判定。 |
| `chains[].uploads` | 每個 numeric upload reference 的 metadata、binary、callback entry 序號及缺口；不輸出檔案 ID、檔名或 URL。 |
| `homeworkEvidence.unsupportedTraceKinds` | legacy 路徑、小組、單筆紀錄替代完整歷史、跨來源儲存及 QINIU 等未支援範圍。 |
| `homeworkEvidence.unlistedSessionInterruptions` | 未列入公開 endpoint 清單的同來源 401 次數；只保留身分失效事件，不輸出其路徑或 body。 |
| `manualReviewRequired` | 仍須確認的身分／session、真正 bytes 完整性、storage 契約、權威狀態與時間、政策、冪等及逾時處理。 |
| `contractVerified` | **固定為 `false`**。HAR 可被編輯，且觀察鏈不代表伺服器真正接受操作；即使 `missingEvidence` 為空，也不能開啟 writer。 |

未知欄位名稱可能就是姓名或 token，因此只輸出 `x-omitted-field-count` 計數，連未知欄位名稱都不保留。已知欄位的值、URL query、header、cookie、檔名、作業內文、學生及檔案 ID 均不輸出。關聯只在記憶體比對，不產生可反查私人值的 hash。

entry 順序與先後關係來自 HAR，本工具不信任其真實性，也不把它當成可信伺服器時鐘。profile 前後一致不代表已完成 session／CSRF 驗證；工具不讀取或輸出那些私人 header。即使 endpoint 未列入公開清單，同來源 401 仍會使後續身分失效，須重新觀察成功 profile；不沿用中斷前的 metadata／授權脈絡。其他來源的 401 不影響學校身分。

未知路徑不列入 `entries`，上述 401 也只保留無路徑、無 body 的失效標記。因此**空 entries 或缺少 chain 不能解讀成完整 HAR 沒有該動作**；應先查看識別範圍、unsupported 與分析上限。

## 分析上限與測試

單一 JSON body 最多分析 256 KiB；每份 schema 最多 64 個節點、6 層、每個陣列 16 個樣本。正式送出最多檢查前 32 筆，每筆最多比對 64 個後續讀回請求，每個 history 及附件清單最多取 64 筆。超量會留下明確缺口，不宣稱完整比對；完整 JSON 輸出另有 8 MiB 上限。這些型別只反映捕捉樣本，不是完整 API 規格。

回歸使用合成 HAR，不含真人資料。測試涵蓋官方 POST／PUT、五種狀態、最新版與草稿轉換、metadata-only、同來源精確 URL、外部主機拒絕、callback 順序、完整附件集合、final／baseline 的身分與範圍矛盾、parent 活動錯配、未知同來源 401、晚到錯誤、隱私去值化，以及檔案、entry、schema 和 evidence 上限。另以 fetch spy 驗證分析過程未呼叫網路，CLI 失敗訊息不包含路徑或原始內容。

## 下一步：實際介面驗收

先以已獲授權的受控操作紀錄確認靜宜站點實際使用的 storage 分支及完整 response schema，再決定是否擴充固定來源範圍。跨來源 upload_url、QINIU、多選題、外部資源、小組與重交政策均不因本次分析器更新而開放。完成正式 adapter 前，仍須驗證 binary／callback 的真正結果、完整附件與 final 的關聯、本人與教師收件一致，以及網路逾時後如何避免重複提交。

參考來源：[官方公開前端契約查核](../../docs/nuni/tronclass-public-contract-2026-11-16.md)、[TronClass 官方作業說明](https://support.tronclass.com/tw/question/homework)、[官方操作手冊](https://support.tronclass.com/public-manual/manual-teacher.html)。公開前端與操作文件可定位接口及政策差異，仍不能替代靜宜站點的受控 HTTP 寫入驗收。


## Web 瀏覽器回歸

`check-browser.py` 會啟動已完成的 Next standalone 產物，使用真正的頁面、CSS、client codec 與互動元件。Playwright 僅在瀏覽器攔截 API 回覆，提供合成平台 session、綁定、課程、教材、作業和確認結果；所有外部來源請求都會中止，server 不載入私人環境設定。這不會登入真實帳號或打開正式校方 writer，也不驗證伺服器端認證或真實收件。

在已安裝 Node 22、pnpm 與 Web 建置所需公開設定的環境執行：

```sh
pnpm --filter web build
python -m pip install playwright==1.57.0
bash scripts/qa/browser/install-playwright.sh --fonts-noto-cjk
python scripts/tronclass/check-browser.py
```

CI 的 Build Web 會在 Docker runtime 檢查後執行此回歸，並上傳 `tronclass-browser` artifact。四種版面是 1440 px／390 px，各自搭配淺色與深色；每種版面檢查未登入、綁定表單、正式 writer 關閉，以及合成 provider 允許寫入的操作流程。

檢查包括課程隔離、公告／教材切換、真實瀏覽器檔案下載、文字與附件預覽、停用 writer 時即使勾選確認仍不能送交，以及未知結果只保留原 operation 並透過查證取得確認，期間不得再發第二次 submit。截圖同時檢查水平溢出、控制元件超出畫面及未捕捉的頁面錯誤。

`artifacts/tronclass-browser/report.json` 記錄實際 checkout、程式樹、parents、PR head、Next Build ID、Chromium 版本、合成操作紀錄及每張截圖結果；失敗時保留失敗原因。報告沒有校方密碼、cookie 或真實學生作業。`TRONCLASS_BROWSER_OUTPUT` 可指定輸出目錄，`TRONCLASS_BROWSER_NODE` 和 `TRONCLASS_BROWSER_CHROMIUM` 可選擇已安裝的執行檔。瀏覽器未能啟動或任何情境失敗，都不能算驗收通過。
