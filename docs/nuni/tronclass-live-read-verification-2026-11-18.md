# 靜宜 TronClass 真人帳號唯讀查核（2026-11-18）

本輪已取得使用者對目前登入帳號的明確授權，以校方學生介面及同一瀏覽器正常導覽可見的 JSON 回應核對整合。範圍僅限該帳號的課程、作業與本人繳交紀錄。沒有匯出瀏覽器 Cookie、讀取私人 runtime state、上傳檔案、保存草稿或送出正式作業。

本文件只保存可重現的契約結構與驗證範圍，不保存姓名、學號、email、真實課程／活動／學生／附件 ID、作業內文、檔案內容或原始 JSON。測試案例以替換後的 ID、名稱、內容及日期建立；它們是依實測形狀建立的回歸案例，不是假稱完整封包錄製的 fixture。

## 取得的直接證據

| 來源 | 本輪實際觀察 | 可以據此判定的範圍 |
| --- | --- | --- |
| 學生課程清單與 `/api/profile` | 已登入身分與使用者指定的帳號一致；profile 的本人 `id` 是正整數 | 後續本人歷史 URL 使用該帳號自己的 ID，不指定其他學生 |
| `GET /api/courses/{courseId}/homework-activities?page=1&page_size=50` | 回傳 `homework_activities` 與 `page`、`page_size`、`pages`、`start`、`end`、`total`；抽樣課程共六份作業，其中五份 `submitted: true`、一份 `false` | 作業列的 `submitted` 是 boolean；作業列可省略 `course_id`，不可因此拒絕由已驗證課程清單取得的資料 |
| `GET /api/activities/{activityId}` | 已交與未交兩份活動均有相符的數字 `id`、`course_id`、`type: "homework"`、`submit_by_group: false` | 詳情與本人歷史 reader 現有的活動範圍核對與本次樣本相容 |
| `GET /api/activities/{activityId}/students/{studentId}/submission_list` | 外層只有 `list`；已交樣本為一筆，未交樣本為空陣列 | 與官方 client 直接讀 `.list` 的流程相符；沒有觀察到通用 `data` wrapper，也沒有藉此主張所有部署／所有模式都不分頁 |
| 未交作業的學生介面 | 可開啟具有本文、Add File、Submit、Save Draft 的編輯器；空內容時正式 Submit 停用 | 正常個人作業介面確實提供文字及檔案編輯；只開啟及取消編輯器，不代表已執行上傳或正式送出 |

上述 GET 透過正常瀏覽器導覽取得，讀取的是頁面可見 JSON；未經 shell、獨立 HTTP client 或 browser evaluate 的網路呼叫重用登入狀態。

## 一般期間首次個人作業的實際形狀

未交樣本的以下欄位直接取自活動 JSON，不由截止時間或 UI 按鈕反推：

```json
{
  "type": "homework",
  "published": true,
  "submit_by_group": false,
  "is_assigned_to_all": true,
  "has_assign_student": false,
  "has_assign_group": false,
  "is_started": true,
  "is_in_progress": true,
  "is_closed": false,
  "need_make_up": false,
  "non_submit_times": true,
  "submit_times": null,
  "user_submit_count": 0,
  "prerequisites": [],
  "teaching_model": "online",
  "data": {
    "mode": "normal",
    "homework_type": "file_upload",
    "has_assign_target": false,
    "allow_retract": true
  }
}
```

該活動的 `start_time`、`end_time` 均為有 `Z` 的 ISO 時間，當下位於一般開放期間；本人歷史精確為 `{ "list": [] }`。另一份已截止活動的 `start_time` 是明確的 `null`、`is_in_progress: false`、`is_closed: true`、`user_submit_count: 1`。缺欄位與明確 `null` 必須分開處理。

`is_resubmit_open` 與 `data.allow_retract` 在樣本中為 true，但已截止作業介面仍顯示不可再繳。不能以這兩個設定單獨授予補交、重交或撤回能力。第一版授權 reader 僅處理本人完整課程／作業範圍內、全班指派、空先決條件、普通期間、尚無任何歷史版本的 normal 個人線上作業；其他模式保留未開放。

公開 client 的文字可交證據仍由 [公開契約查核](tronclass-public-contract-2026-11-16.md) 中 `66297.9aa2f6d5.js` module `473669` 提供：正常提交可有非空 `comment`。本次不猜測不存在的 `can_submit`、`allowsText` 或 `allowsAttachments` 通用欄位，也不把「file_upload」解讀成必然禁止本文。

## 本人已交紀錄與系統產生的 PDF

已交樣本具有以下結構：

- `activity_id` 為匹配的數字；沒有 `course_id`。
- `created_by.id` 與目前本人 profile ID 相同，`group`、`group_id` 均為 null。
- `is_latest_version: true`、`is_draft: false`、`is_redo: false`、`marked_submitted: true`、`submit_by_instructor: false`、`mode: "normal"`。
- `comment` 為字串，`other_resources`、`slide_references` 為空陣列。
- `created_at` 與 `submitted_at` 在這一筆相同，均為有 `Z` 的 ISO 字串。單一樣本不證明兩者永遠等價；既有顯示與讀回仍把 `created_at` 視為來源紀錄時間。
- `uploads` 含兩份原始附件，以及一份 `source: "auto-generated-pdf"` 的校方衍生文件；校方介面將最後一項顯示為 Text content。

兩份原始附件的 `id`、`size` 為 number，`name` 為 string；`allow_download: true`、`deleted: false`、`reference_id: 0`、`source: ""`、`status: "ready"`，`type` 分別為 `document` 與 `file`。衍生文件同樣有正整數 ID，`source: "auto-generated-pdf"`、`type: "document"`、`status: "ready"`，其餘上述下載與刪除旗標相同。

這個實際差異暴露了原本 readback 的錯誤：要求回傳附件總數等於原始送出附件數，會把帶有校方衍生 PDF 的正常紀錄判成未知。修復仍完整核對原始 acknowledgment、本人、活動、唯一最新版本、逐字本文及全部原始附件 ID／名稱／大小，只額外接受最多一份具有實測明確形狀的系統 PDF。其他額外附件、缺原始檔、重複 ID、未知來源，或以系統 PDF 冒充原始 ID，仍不能確認成功。

純文字提交也可在上述嚴格條件下容許這份系統 PDF，因為原始 `uploads` 仍為空且正文仍須完全相符。這只修正讀回比對，不建立任何新 upload handle，也不視為一次真實 POST 已驗收。

## 已完成與未完成的驗收分界

| 項目 | 本輪結果 |
| --- | --- |
| 指定校方帳號身分、本人課程與作業 UI | 已實際核對 |
| 已交與未交活動的 GET 結構 | 已實際核對 |
| 本人歷史、空歷史及一般附件／系統 PDF 差異 | 已實際核對 |
| nuni parser 與上述去識別形狀的相容性 | 以真正 normalizer 與回歸測試核對；不冒稱是 nuni 的線上綁定測試 |
| 本人歷史附件下載 | 未取得可驗證的完成檔案；校方連結轉到媒體主機後進入瀏覽器錯誤頁，錯誤頁因 URL 協定政策無法讀取。停止此下載測試，未繞過瀏覽器政策 |
| nuni Web 綁定 → 同步 | 未完成真人端對端驗收；分支功能未有已驗證的 Web 預覽部署 |
| CSRF、正式 POST acknowledgment、上傳 storage host／callback | 尚無本輪真實寫入證據 |
| 正式作業繳交或教師收件 | 未執行；沒有以測試內容改動校方作業 |

`contractVerified` 仍保持 false。新增的唯讀 tenant authorization reader 可補上上述活動資格來源，但不等於已證明 CSRF、POST 回應或附件儲存契約；環境旗標不能單獨取代這些驗收。既有 `tcFetchCourses` 在來源沒有角色時會預設 `student`，因此 normalized role 本身不能作為原始選課角色的正面證據。

2026-11-18 後續實作已補上獨立課程頁證據：在每輪活動／本人歷史查核前，使用同一綁定 session 讀取固定的 `/course/{id}`，要求唯一、有效的 hidden `courseId` 與 `enrollment-is-student: "True"`。缺失、重複、錯誤課程、非學生、來源失敗或逾時一律拒絕；這個標記來自官方公開課程模組的明確使用方式，見 [公開來源定位](tronclass-public-contract-2026-11-16.md#2026-11-18一般個人純文字授權讀取的最小範圍)。角色檢查已接入 reader 並以合成來源驗證；本輪真人唯讀抽樣沒有取得這條新 nuni 傳輸路徑的端對端成功證據，仍須於開放寫入前驗收。

CI、GitHub PR 合併及 Web 部署狀態須以當時的完整 SHA 另行查核；本文件不把一輪測試成功或 Mobile Preview 工作流程視為 Web 已上線。
