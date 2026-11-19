# TronClass 真人唯讀查核（2026-11-19）

## 範圍

使用者明確回覆已登入後，以本對話的雲端瀏覽器確認校方目前登入身分，讀取本人課程、一門課的作業清單、一筆本人已交作業及其歷次繳交資料。僅沿用瀏覽器既有校方登入，沒有匯出 Cookie、讀取密碼、使用 DevTools 或將瀏覽器憑證移交到其他執行環境。

這份紀錄不包含姓名、學號、真實課程／作業／學生／附件 ID、私人作業本文或原始 profile。本文端點的變數只表示路由結構。

## 本次實際觀察

- 校方個人課程頁正常列出目前修課，且顯示學生身分。
- 選定課程的作業清單包含已交及未交狀態；一筆已交個人作業可開啟本人繳交歷史與附件清單。
- 正常瀏覽器導覽至 `GET /api/profile` 可讀到目前登入者的 profile。後續 student 路徑使用該 profile 的本人 ID，沒有猜測其他學生 ID。
- 同一已交作業的 `GET /api/homework/{activityId}/students/{studentId}/make-up-record` 與 `resubmit-record`，文件可見本文皆為精確的空 JSON 物件 `{}`。瀏覽器頁面觀察本身不證明 HTTP status；正式 reader 仍須先確認 HTTP 成功，錯誤 status 不能轉為無紀錄。
- `GET /api/activities/{activityId}` 有明確個人作業旗標、一般期間已結束、已使用一次繳交、無次數上限等欄位；日期包含 UTC `Z`。未從畫面無時區的日期文字推測時區。
- `GET /api/activities/{activityId}/students/{studentId}/submission_list` 使用 `{ list: [...] }` envelope。選定版本具有 `created_by`、`is_draft:false`、`is_redo:false`、`submit_by_instructor:false`、`marked_submitted:true`，沒有重複的 `student` 物件。附件含一般來源及一份 `source:"auto-generated-pdf"` 的衍生 PDF。沒有因此放寬正式 acknowledgment 或完整附件精確讀回規則。

## 空補交／重繳紀錄的官方 client 證據

重新匿名下載的兩份官方公開程式均為 HTTP 200，SHA-256 與先前記錄一致：

| 官方來源 | SHA-256 |
| --- | --- |
| `https://tronclass.pu.edu.tw/static/55200.e380810d.js` | `a316e55b346db9d7af294e445b0cc689802cebabd51a408a77f6184274fd6a1b` |
| `https://tronclass.pu.edu.tw/static/88788.161d6b6a.js` | `a99eb2e9c80e9d68fb54de90ebe7d224241c68515ed3de22c34c77f9f414529a` |

`55200` 的成功 callback 解出 `response.make_up_record`／`response.resubmit_record`，HTTP 錯誤走獨立 error callback；`88788` 的學生作業 controller 只有在對應 record 存在時才納入補交／重交狀態。因此相容處理應限於**成功回應的精確空物件**及明確 `record:null`，不能將含未知欄位的 envelope、空本文、陣列、解析失敗、401 或 403 當成沒有紀錄。

## 未完成的部分

校方既有附件的下載控制與一次相同連結的下載嘗試均未在期限內取得 completed download；沒有完成檔案可核對，未宣稱下載成功，也沒有改用 Cookie 匯出或其他身分繞過這個限制。

校方登入與 nuni 的獨立綁定是兩個驗證步驟。本次開始時，前輪暫存的 Next／Auth／Firestore runtime 已不存在。已依鎖檔恢復隔離環境，2026-11-19 10:59（台灣時間）的真實 HTTP acceptance 確認 Auth／Firestore、錯密碼與無效／停權 token 拒絕、綁定狀態持久化及帳號隔離；這是公開 emulator fixture 的驗證，沒有假造校方登入。

本次以 `5ebcb0e9` 的實際 Web 開啟 nuni 首頁及 `/tronclass`，可看見正常「學校帳號／學校密碼／連接 TronClass」表單，尚未顯示已連接。之後安全登入工具遇到瀏覽器 frame 讀取逾時，新分頁驗證及後續頁面讀取也逾時，因此沒有可確認的新綁定結果；不把逾時當成登入成功，也不推定使用者輸入錯誤。頁面已保留供之後繼續，未取得或輸出密碼。

上述校方唯讀與 emulator 結果不構成真人 nuni 綁定、BFF 同步／下載、附件上傳、正式 POST 或教師收件的端對端證據。

### 同日續作：恢復預覽與綁定驗證

續作開始時，預覽管理服務明確回報 stopped，原啟動 session 亦不存在；判定依據不是其他終端機對 loopback 的連線失敗。已以相同隔離 launcher 恢復完整 Next、Auth 與 Firestore emulator。11:43（台灣時間）在 daemon 自己的網路環境完成 `GET /health/live` 與 `GET /login`，均為 200；這個新檢查不登入、不帶 Cookie、不呼叫 TronClass binding API。

TronClass launcher 的 seed 改為 `--missing-only`：已存在的公開測試 Auth 帳號不更新，Firestore fixture 只建立缺少的文件，其他錯誤仍中止。原本會驗證及操作 fixture binding 的 acceptance 沒有重新執行。此修正不會保存已停止 emulator 的記憶體，也不表示舊 binding 已復原。

新瀏覽器分頁可開啟實際 Web，以「使用本機測試學生甲」按鈕完成正常 SDK 登入後，頁面顯示已登入帳號及尚未連接的 TronClass 表單。已核對可見欄位的語意、型別及 autocomplete；安全登入請求仍回傳 `locator_invalid`，後續 canonical origin 新分頁驗證遇到導航逾時。沒有可確認的真人綁定結果，也沒有從失敗推論密碼錯誤或綁定成功；未讀取、輸出或轉移帳密。本輪沒有取得可用的新截圖，不使用舊畫面冒充本輪證據。

### 同日程式整合與回歸

整合 `c9a187df` 與 main `b1f38039` 時保留新版登入、帳號切換、圖片辨識與 TronClass 私人下載能力，並補回抽出 `schoolLinking` 後遺漏的 `campus://tronclass` 路徑。真實 navigator parser 與課務入口回歸涵蓋這個缺口；Mobile 五個針對性測試檔共 183 個案例、Web 登入頁 118 個案例均通過，修改的八個 TS／TSX 檔案 ESLint 為零錯誤、零警告。

`c9a187df` 的 [Build Web 工作](https://github.com/Miiduoa/graduation/actions/runs/44449516535/job/135313954182) 在實際 Web／Docker 建置及 standalone 驗證完成後，因 61.2 MB 的 Noto CJK 字型下載三次達到 60 秒期限而失敗，TronClass Chromium 檢查尚未執行。字型的單次有界期限調整為 180 秒，保留三次重試、具權限的 timeout 與持續失敗時阻擋。模擬持續下載 90 秒的回歸先在舊設定重現失敗，修正後 installer 九項檢查通過；seed 四項與 launcher 隔離一項共五項通過。兩組回歸已加入既有 CI readiness 檢查，不略過實際 Chromium 驗收，也未延長任何工作整體期限。

這些是程式與本機 fixture 的驗證；新提交的 CI、指定 App 審查及正式發布仍需獨立取得結果。

沒有新上傳、校方草稿儲存、重新繳交、撤回或正式送交。本次查核不會解除 production `contractVerified: false`。
