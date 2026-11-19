# 靜宜 TronClass：草稿、再次繳交、補交、重交與撤回（2026-11-18）

本次以匿名 HTTPS GET 重新取得校方公開 JavaScript，對照現有程式後，新增**本人作業的唯讀繳交時段與校方草稿狀態**。沒有取得瀏覽器 Cookie、登入私人 API、建立校方草稿、正式繳交、撤回或修改小組資料。本文記錄可重查的前端契約，以及仍需真人驗收的部分；合成測試不是校方收件證據。

## 公開來源與版本

以下三份資源本次均為 HTTP 200，原始 bytes 的 SHA-256 與先前查核相同。來源發現流程見 [公開前端契約查核](./tronclass-public-contract-2026-11-16.md)，不把第三方 bundle 複製到 repository。

| 官方資源 | SHA-256 | 本次定位 |
| --- | --- | --- |
| [55200.e380810d.js](https://tronclass.pu.edu.tw/static/55200.e380810d.js) | `a316e55b346db9d7af294e445b0cc689802cebabd51a408a77f6184274fd6a1b` | module `429800` 的本人讀取組合；`946650` 的 homework API |
| [88788.161d6b6a.js](https://tronclass.pu.edu.tw/static/88788.161d6b6a.js) | `a99eb2e9c80e9d68fb54de90ebe7d224241c68515ed3de22c34c77f9f414529a` | module `150664` 的個人資格、版本與撤回 |
| [66297.9aa2f6d5.js](https://tronclass.pu.edu.tw/static/66297.9aa2f6d5.js) | `08ed09a5bdf77bf915fa581a4884875d41d4fe730f0be159ad764e8aabcd995b` | module `473669` 的草稿／正式保存；`465857` 的本人分組 API |

官方 [作業 FAQ](https://support.tronclass.com/tw/question/homework) 說明繳交次數由教師設定，另開補交與一般再次繳交不同；資源庫檔案也必須關聯作業才算繳交。官方 [1.66 更新說明](https://support.tronclass.com/cn/updated/updated_1_66/) 說明：撤回須符合教師允許、尚未評分與尚未截止等條件；撤回後回到草稿。分組作業可由組員撤回，會影響全組，不能套用個人建立人的單一擁有者規則。這些產品說明不等於靜宜每個 API 回應的完整 schema。

## 已定位的端點與語意

| 用途 | 方法與固定路徑 | 前端語意 |
| --- | --- | --- |
| 本人的補交紀錄 | `GET /api/homework/{activityId}/students/{studentId}/make-up-record` | 讀取 `make_up_record`；成功的 exact `{}` 或明確 null 表示沒有個人紀錄，與讀取失敗不同。 |
| 本人的重交紀錄 | `GET /api/homework/{activityId}/students/{studentId}/resubmit-record` | 讀取 `resubmit_record`，還須結合作業的 `is_resubmit_open`。 |
| 建立新草稿 | `POST /api/course/activities/{activityId}/submissions` | `is_draft: true`；不是正式繳交。 |
| 更新既有草稿 | 同路徑 `PUT` | 學生 editor 已有 `draft_id` 時，附 `submission_id`；仍可保存為草稿。 |
| 新版正式繳交 | 同路徑 `POST` | `is_draft: false`；已有正式版本也不代表應 PUT 舊正式版本。 |
| 草稿轉正式 | 同路徑 `PUT` | `submission_id` 指向目前本人草稿，`is_draft: false`。 |
| 撤回某版 | `PUT /api/submissions/{submissionId}/retract` | 官方 client 未傳 body；成功後移入草稿並重新讀取歷史。 |
| 本人所屬小組 | `GET /api/group-sets/{groupSetId}/group` | 使用目前 session，回應的 `group.id` 才是後續讀取依據。 |
| 本人小組歷史 | `GET /api/activities/{activityId}/groups/{groupId}/submission_list` | 先完成上述小組歸屬查核；不能接受 client 任意指定 group ID。 |

草稿與正式繳交共用的正常 payload 為 `comment`、去重後的數字 `uploads`、`slides`、`is_draft`、`mode`、`other_resources`、`uploads_in_rich_text`。既有草稿才增加 `submission_id`；multiple 模式另有 `multiple_choice_title`。官方 `mode: normal` 是作業模式，與本文件的 ordinary／make-up／resubmit 時段分類是不同概念，不能把後者寫進 `mode`。

官方 editor 會優先取草稿填入內容與附件並設定 `draft_id`；退回重做的版本只供複用內容，沒有因此設定 `draft_id`，而且會移除 `source: auto-generated-pdf` 的系統批改檔。nuni 不以「最大 ID」、「第一筆」或「內容相同」猜測可更新哪個草稿。

### 再次繳交不等於另開重交

module `150664` 的 `canSubmitHomework` 分別檢查：

- 一般時段：`is_in_progress`，以及不限次數或未用完次數。
- 補交：本人 `make_up_record` 尚未使用，且 `make_up_is_closed` 為 false。
- 重交：本人 `resubmit_record` 尚未使用，`is_resubmit_open` 開啟，且目前介面選用重交狀態。

當補交與重交紀錄同時存在，前端還比較兩者 `last_updated_time` 決定提示狀態。新 DTO 分別保留兩個觀察結果，不自行猜測優先使用哪個授權，也不把一個 `is_resubmit_open: true` 當成學生本人可重交。

**兩組欄位不能混用。** 個人詳頁使用 `has_submitted`、`make_up_is_closed`／`resubmit_is_closed`、`last_updated_time`。其他清單模組使用 `submitted`、`closed_time`、衍生的 `is_closed`、`created_at`／`updated_at`。本次固定讀取個人端點，遇到其他投影只回傳 unknown，不用相近名稱補成成功。

### 撤回的逐版條件

官方 client 的顯示條件同時包含 `row.can_retract`、非 `row.is_redo`、非 `row.submit_by_instructor` 與 `homework.data.allow_retract`。成功後將該版移入草稿、重算剩餘次數、重讀本人歷史；特定錯誤碼 `40001` 會取消前端的可撤回狀態並更新頁面。

這不是刪除端點，也不能只憑作業設定允許就撤回任一版本。真正實作仍須鎖定目前本人版本、重新確認伺服器逐版資格、記錄操作及不明結果，並讀回該版的草稿狀態。小組操作還需要獨立的目前組員關係與共同影響確認。

## 本次新增的唯讀能力

`createTronClassSubmissionAvailabilityReader({ bindings, source?, now?, timeoutMs? })` 回傳 reader：

```ts
readAvailability(ownerKey, { courseId, homeworkId }, expectedRevision, signal?)
```

DTO 為 `TronClassSubmissionAvailability`，保留 courseId、homeworkId、revision、fetchedAt；共用 boundary `isTronClassSubmissionAvailability(value, scope, expectedRevision)` 會核對準備畫面的同一份歸屬。

| 區塊 | 狀態與用途 |
| --- | --- |
| `ordinary` | open／not-started／closed／attempts-exhausted／unknown；另外區分 first／repeat／unknown，以及可確認的剩餘次數。 |
| `makeUp` | none／open／used／closed／unknown；成功的 exact 空物件 `{}` 或明確 null 才是 none。 |
| `resubmit` | 同上，另有 disabled，表示紀錄存在但作業未開啟重交。 |
| `draft` | none／available／ambiguous／unknown；只有唯一且明確屬於本人、非教師代標、非退回版本的草稿才提供 submissionId。 |

`remainingAttempts: null` 可能是不限次數，也可能未知，client 不得自行顯示成無限次。整體 unavailable／group-unsupported 時，子欄位一律 unknown，不帶草稿 ID。`open` 只表示相應來源的時段與用量觀察，不代表 prerequisites、作業模式、附件、CSRF 或寫入契約已完成授權。

reader 使用伺服器綁定的 student ID，不接受前端學生或小組 selector。起始、各項本人讀取前、結束都核對 expectedRevision；前後重新確認課程、作業歸屬與固定課程 HTML 的明確學生 enrollment。原始 course list 的展示用 student 預設值不能取代學生身分證據。活動由個人改成小組、角色撤銷或換綁都不返回先前個人的資料。

兩個新低層方法只建立固定 PU origin 的 GET，不重試、不轉址、不探測替代端點；沿用取消訊號、時間與大小上限。HTTP 失敗或缺少欄位的非空物件保留未知，401／403 不降級成無紀錄。回應只投影明確欄位，不回傳原始紀錄、老師資料、本文、Cookie 或來源 URL。

### 2026-11-19：空的個人紀錄回應

在本人正常已登入頁面，以一般 GET 開啟自己的上述兩個個人端點時，document 可見內容皆為 exact `{}`。此處只記錄無私人欄位的形狀，不保存真人 ID、姓名、profile、完整回應、Cookie 或簽章 URL；單靠 document 文字不推定 HTTP 狀態。沒有使用被停用的 DevTools，也沒有執行校方寫入。

同日以匿名 HTTPS GET 重查 `55200.e380810d.js` 與 `88788.161d6b6a.js`，均回 HTTP 200，SHA-256 與上表一致。`55200` 的 module `946650` 將成功與錯誤 callback 分開；module `429800` 在成功 callback 直接讀取回應的 `make_up_record`／`resubmit_record`，因此 `{}` 會解析成不存在的值。`88788` 的 module `150664` 只在這些紀錄存在時套用個人補交／重交狀態。這共同支持將**已確認成功的 exact 空 JSON 物件**投影為 `none`。

修正只接受低層 HTTP 200 且 JSON 解析成功的 `{}`，並保留原始空 envelope；availability projection 另檢查 plain prototype 及沒有任何 own key，以防測試或注入 source 的 `Date`、`Map`、自訂 prototype、非 enumerable 欄位或 symbol 被誤當空紀錄。陣列、null envelope、空本文、非空錯誤／未知欄位 envelope、以及 `{ make_up_record: {} }` 這類缺少必要狀態的紀錄，均不推導為 `none`。低層 401／403 仍拒絕；reader 收到 401／403 時仍保留授權錯誤，不轉成 `none` 或 `unknown`。

新增測試只使用既有合成 ID，涵蓋兩個端點的成功空物件、錯誤 HTTP、異常 envelope、正常擁有者與 revision 查核，以及不產生 writer capability；沒有加入真人紀錄 fixture。

## 尚缺的真人證據與開放寫入條件

2026-11-18 初次研究尚無真人 `make-up-record`／`resubmit-record` 的回應形狀；2026-11-19 補查到的可見空物件及其公開來源語義見上節。測試中的**非空特殊紀錄仍全部是合成情境**。已觀察的一般 activity 與 personal history 形狀仍見 [真人唯讀查核](./tronclass-live-read-verification-2026-11-18.md)。後續仍須在本人正常作業頁核對實際特殊紀錄的使用中、已使用與截止形狀，再調整明確適用的來源投影。

若要宣稱某個寫入能力已完成，還須取得該能力本身的受控結果：

1. 從 nuni 正常登入／綁定建立的 server session，完成對應校方請求；確認實際 Cookie／CSRF、Origin／Referer 的接受方式，而非從 library 預設推論。
2. 草稿保存需有具體 acknowledgment ID，並以本人同活動歷史讀回相同版本、本文與附件且仍是草稿；正式收件須另外確認 `is_draft: false` 與正確最新版。草稿成功不等於已交作業。
3. 既有草稿的 PUT、普通再次 POST、另開補交／重交、撤回與小組是不同情境，各自驗證資格、版本與結果；不能由首次 POST 成功推廣成所有功能。
4. 附件須完成 metadata、經獨立來源確認的 storage target、binary 與必要 callback，再確認完整附件關聯。已驗證的 media 下載 host 不能直接當成上傳允許清單。
5. acknowledgment 遺失、逾時或綁定改變時保持結果不明並讀回查核，不能自動重送。資料庫 ledger 與合成 route 測試只能驗證本地流程，不代替校方收件。

個人時段觀察不變更 production writer 開關或寫入授權。同批整合的請求 header 序列化與 acknowledgment parser 調整，僅對齊官方 client 的可選 XSRF header 及可省略 `course_id` 的回應形狀；明示錯誤歸屬仍拒絕，真正校方接受與精確讀回仍須驗收。availability 資料不替代這些條件。
