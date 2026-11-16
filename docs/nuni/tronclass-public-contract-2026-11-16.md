# 靜宜 TronClass 公開前端契約查核（2026-11-16）

本次以匿名 HTTPS GET 查核靜宜官方首頁、公開課程頁及其列出的 JavaScript，確認學生介面實際使用的作業讀取、送出與上傳路徑。沒有登入校方帳號、取得真人作業回應、上傳檔案或送出作業。以下是**官方前端的實作證據**；不代表伺服器已通過端對端驗收，也不構成開啟 production writer 的條件。

首頁 `<html>` 在查核時標示版本 `1.78.118597-hotfix-v1-78-eefefe8e`。查核日期為 2026-11-16（台灣時間）。這份紀錄只對該次資源內容負責；將來資源版本或雜湊改變時，需要重新確認。

## 來源與定位

公開入口為 [首頁](https://tronclass.pu.edu.tw/) 與 [公開課程頁](https://tronclass.pu.edu.tw/public-course)。先從 HTML 的 script 清單取得資源，再依公開 runtime 的 chunk 對照取得 homework 與 activity 模組。沒有列舉或嘗試私人課程 ID。

| 來源 | 可定位的用途 |
| --- | --- |
| [47485-e4f87a33.js](https://tronclass.pu.edu.tw/static/47485-e4f87a33.js) | module `508568` 為按需載入器；`985871` 列出 homework／activity 等模組依賴 |
| [main-public-course-e9dcc59d.js](https://tronclass.pu.edu.tw/static/runtime~js/main-public-course-e9dcc59d.js) | runtime 的 `.u` 對照 chunk ID 與實際資源檔名；動態 chunk 使用 `ID.hash.js` |
| [55200.e380810d.js](https://tronclass.pu.edu.tw/static/55200.e380810d.js) | module `429800` 的學生繳交讀取流程；`946650` 的 homework API 方法 |
| [88788.161d6b6a.js](https://tronclass.pu.edu.tw/static/88788.161d6b6a.js) | module `150664` 的學生作業詳頁、版本選擇、內容與評閱顯示 |
| [66297.9aa2f6d5.js](https://tronclass.pu.edu.tw/static/66297.9aa2f6d5.js) | module `473669` 的草稿／正式送出；`539963` 的繳交狀態 helper |
| [98133-ef5ebb8f.js](https://tronclass.pu.edu.tw/static/98133-ef5ebb8f.js) | `activityApi.getActivity` 的詳情 GET 路徑 |
| [72914-965f4ad4.js](https://tronclass.pu.edu.tw/static/72914-965f4ad4.js) | module `995651` 的 `updateServerData`，建立上傳 metadata |
| [56834-67be8618.js](https://tronclass.pu.edu.tw/static/56834-67be8618.js) | module `345230` 的二進位上傳與 callback；`611733` 判斷 callback 條件 |
| [56029-a5e838cb.js](https://tronclass.pu.edu.tw/static/56029-a5e838cb.js) | Angular HTTP library 的 XSRF 預設值；不能單靠 library 推論伺服器要求 |

以下 SHA-256 以下載的原始 bytes 計算，未重新排版或改寫：

| 檔名 | SHA-256 |
| --- | --- |
| `47485-e4f87a33.js` | `17ac532be024dff8a52e1649fa805ee82158c60c7a48521e2c4386a81f234724` |
| `main-public-course-e9dcc59d.js` | `b1ab26188160701c416c081e8b09e861bf5c92c82d94a45a1669a27e9592ed58` |
| `55200.e380810d.js` | `a316e55b346db9d7af294e445b0cc689802cebabd51a408a77f6184274fd6a1b` |
| `88788.161d6b6a.js` | `a99eb2e9c80e9d68fb54de90ebe7d224241c68515ed3de22c34c77f9f414529a` |
| `66297.9aa2f6d5.js` | `08ed09a5bdf77bf915fa581a4884875d41d4fe730f0be159ad764e8aabcd995b` |
| `98133-ef5ebb8f.js` | `47905b472e8dd221f37520329cc81d9744c373486dcafb624d605a121defec53` |
| `72914-965f4ad4.js` | `ec0f18dd4da0b05bc656334e0a05306d0e61fe912d34130c288efd398f7d1d77` |
| `56834-67be8618.js` | `72f95909ee245893dcd801813bf5365c47b0097ebb8c3635da86d9c361c54e14` |
| `56029-a5e838cb.js` | `37bafc79c18dab3b41830a33a05cb308b0fd4605d0433dc7412a7662b017a094` |

不把整份第三方 bundle 存入 repository；保留可重查的 URL、版本、雜湊與定位即可。

## 本人作業讀取

| 用途 | 官方前端使用的方法與路徑 | 已觀察到的呼叫方式 |
| --- | --- | --- |
| 作業／活動詳情 | `GET /api/activities/{activityId}` | `getActivity`；可選參數為 `fields`、`sub_course_id` |
| 個人繳交歷史 | `GET /api/activities/{activityId}/students/{studentId}/submission_list` | `loadSubmissionForStudent` 及 `loadSubmissionListForStudent` 使用當前頁面本人 ID，讀回 `{ list: [...] }` |
| 個人單一繳交 | `GET /api/course/activities/{activityId}/students/{studentId}/submission` | 學生詳頁所選內容不在已讀清單時的補讀 |
| 小組繳交歷史 | `GET /api/activities/{activityId}/groups/{groupId}/submission_list` | 先依 `group_set_id` 取得本人小組，再使用回傳的 group ID |

個人與小組由活動的 `submit_by_group` 區分。nuni 應先驗證綁定帳號與本人課程、活動歸屬，再建立固定來源 URL；不得接受前端任意指定學生、小組或來源網址。小組內容的 `created_by.id` 可能是另一位組員，不能直接用個人作業的擁有者規則處理。尚未實作小組歸屬核對時，應明確回傳該能力未開放。

### 有證據的繳交欄位

學生詳頁 module `150664` 使用以下欄位，而非猜測的 `content`、`attachments`、`status`、`submitted_at` 通用形狀：

| 欄位 | 官方前端的使用方式與本整合應保留的語意 |
| --- | --- |
| `id` | 選擇器把選項轉成整數後與 row 比對；可證明此 client 預期數字 ID，尚非完整伺服器型別規格 |
| `is_latest_version` | 以明確 `true` 選最新版；不能自行以第一筆、時間或最大 ID 取代 |
| `is_draft` | 草稿與歷史分開顯示 |
| `is_redo` | 退回重做；不能讓舊正式版本遮蓋最新版狀態 |
| `marked_submitted`、`submit_by_instructor` | 判斷繳交次數及教師標記；不能一律解讀為學生本人透過 nuni 送出 |
| `comment`、`uploads` | 本文與附件；本文可能含 rich text，顯示前仍需處理 |
| `created_by.id`、`group_id`、`group` | 建立人與小組；需連同本人來源範圍核對 |
| `created_at` | 官方顯示使用的來源時間；不得重命名成已證實的正式送出時間 |
| `other_resources`、`slide_references` | 另有外部資源及簡報參照，不保證都存在於 uploads |
| `submission_correct` | 教師評閱欄位；其可見性受活動設定控制，不應整包透傳 |

module `539963` 判斷「已提交」時，同時檢查教師代標、草稿與退回旗標：

```ts
(!row.submit_by_instructor || row.marked_submitted) && !row.is_draft && !row.is_redo
```

這段來源使用 JavaScript truthiness。本整合不應把缺少欄位當成 false；必要狀態旗標缺少、型別不符或最新版不唯一時，保留「無法確認」。舊版正式提交可保留於歷史，但不代表最新版仍有效。教師代標也不等同於我們已驗證學生上傳內容。

公開 client 沒有在 `submission_list` 請求傳入分頁參數，也沒有讀取 total／count。這不能證明伺服器永遠不分頁、清單一定完整或不存在部署差異。目前亦無真人回應可證明每筆都附 `activity_id`／`course_id`；不得把推測欄位寫成實測 fixture。

## 正式送出契約

學生送出 module `473669` 對新繳交使用 **`POST /api/course/activities/{activityId}/submissions`**。編輯已存在的草稿時，改用同路徑 **PUT**，並帶 `submission_id`。這與分析器先前列為候選的 course homework 路徑不同。

| 請求欄位 | 已查明的用途 |
| --- | --- |
| `comment` | 去除頭尾空白後的本文 |
| `uploads` | 去重後的 upload **數字 ID**，不是 upload key |
| `slides` | 簡報 ID 清單 |
| `is_draft` | 正式送出為 false；true 只代表保存草稿 |
| `mode` | 使用活動設定，無值時 client 採 normal |
| `other_resources` | LARK 等資源另列，不放入一般 uploads ID 清單 |
| `uploads_in_rich_text` | 從內文圖片解析出的資源參照 |
| `multiple_choice_title` | multiple 模式另外要求的選題欄位 |
| `submission_id` | 更新既有草稿時指定的草稿 ID |

成功回應由官方介面讀取 `submission`、`student`、`is_announce_score_time_passed`；隨後重新讀取活動、繳交次數與本人歷史。HTTP 2xx 或 response 裡有一個 ID，仍不能取代同帳號、同活動、同版本、本文與完整附件的讀回核對。

期限及剩餘次數也不能只靠 deadline 判斷。學生詳頁另使用 `is_in_progress`、`non_submit_times`、`submit_times`、`user_submit_count`、補交紀錄及重交開放狀態。本輪沒有驗證上述伺服器拒絕條件與所有作業模式。

## 附件上傳是多個階段

1. **建立 metadata**：module `995651` 以 JSON 呼叫 `POST /api/uploads`。欄位包括檔名、大小、父層／用途、來源、SCORM／WMPKG、批改附件等設定。這一步建立上傳資料，不代表二進位已傳完。
2. **傳送檔案**：module `345230` 使用前一步回傳的 `upload_url`。S3 且 transcoder 為 WRPC 時，以 PUT 傳原始 File 並設定檔案 Content-Type；其他 local 分支以 PUT 傳 FormData 的 file。QINIU 則另取得 uptoken，再走分塊及完成請求。
3. **完成通知**：module `611733` 對 S3／WRPC 判斷需要 callback；呼叫 `POST /internal-api/upload/callback/{id}`，body 使用該 ID 作為 `file_key`。
4. **關聯作業**：最終送出時，uploads 使用預建檔案的 ID。仍須讀回作業，確認完整附件確實關聯到該次繳交。

目前沒有真實上傳回應可確認 storage host、presigned URL、有效期、上傳結果或 callback 成功語意。不得因此允許任意 upload_url、把學校 Cookie 轉送到第三方，或把 metadata 建立當成附件上傳完成。正式 writer 仍需固定可信來源及受控環境驗證。

## 尚未取得的證據

- 登入後 Cookie 輪替、CSRF、Origin／Referer 與 session 到期時的真實行為。Angular library 有 `XSRF-TOKEN` → `X-XSRF-TOKEN` 預設支援；這不證明校方伺服器一定要求或一定不要求。
- 真人回應的完整 schema、清單完整性、所有模式的狀態型別與邊界。本文的欄位證據來自官方 client，未冒稱受控伺服器驗收。
- 上傳二進位、final、本人讀回與教師收件的一致結果，以及逾時後防重送方式。
- 小組、補交、重交、撤回、多選題式作業與教師代標的完整權限驗收。

因此可根據這份證據修正唯讀來源及其回歸測試，production writer 仍維持 `contractVerified: false`。官方資源的雜湊可追溯程式版本，不能證明一次真實操作成功。

## 離線分析器的目前缺口

截至本輪，`scripts/tronclass/analyze-har.mjs` 尚未更新為上述已觀察路徑。它原有的候選路徑、receipt 欄位與鏈結邏輯，不能完整辨識真正的 `submission_list`、`/api/course/activities/.../submissions`、二進位上傳及 callback。**空 entries 或缺少 chain 可能是分析器不認識路徑，不代表 HAR 中沒有這些動作。**

後續更新應同時處理固定路徑識別、草稿與正式送出分流、本文 comment／uploads ID 關聯、本人 created_by、is_latest_version、草稿／退回／教師代標旗標、來源 created_at，以及預建 metadata → 二進位 → callback → final → 本人歷史的各階段。仍須保留去值化輸出、輸入上限、未知狀態及 `contractVerified: false`；不得為了通過分析就把所有上傳 host 或未知欄位放行。

操作與工具限制另見 [離線查核說明](../../scripts/tronclass/README.md)。[TronClass 官方作業 FAQ](https://support.tronclass.com/tw/question/homework) 亦說明資源庫檔案必須與作業活動建立關聯，單有檔案不等於繳交完成；容量、次數與補交規則依校方及教師設定。
