# 校園私訊媒體：舊網址撤銷與分階段交付驗證

狀態：本次相容修正可合進 main；合併不會部署、不會自動撤銷既有 token，也不會關閉舊版 Storage SDK 讀取或既有範圍的建立／上傳。撤銷是日後部署時另作決定的手動步驟，不是合併條件。模擬器和 Jest 的成功不等於真實 GCS / Firebase 服務驗證。

## 權限與流量分界

- 既有私訊附件儲存在 `conversations/{conversationId}/messages/{messageId}/{fileName}` 或 `conversations/{conversationId}/media/{mediaId}/{fileName}`。新版聊天室傳送的照片使用下方的 `photos` 路徑。
- Firebase Storage Rules 保留這兩種路徑的舊版 SDK 讀取與 create：只讀 users 與 conversations 兩份不同文件，要求有效且存在的帳號與對話成員資格。messages 維持圖片／文件小於 20 MiB；media 維持圖片 10、影片 100、音訊 20、文件 50 MiB 以下的原有限制。不可覆寫、修改 metadata 或刪除。callable 的核對範圍如下；群組檔、作業附件等其他伺服器授權路徑維持原限制。
- `dmAttachmentDelivery` 的舊附件 `read`／`upload` callable 檢查 Firebase Auth 與對話成員名單（包含群組，不要求 DM 類型），並要求呼叫者的 `users/{uid}` 文件存在且帳號可用，再提供有效期 60 秒的 GCS V4 POST 或 GET。既有對話不重新核對校籍或學校會員資格，也不核對對方帳號及收件人校籍；下述照片流程共用的 `inDmConversation` 亦不讀取封鎖文件。新訊息只應儲存物件 `path`，不能儲存短效 URL、POST policy 或長效 Firebase 下載 URL。
- **已簽發的 60 秒 GCS GET/POST 仍是 bearer capability**：身分被撤銷後，舊簽章可能在到期前繼續使用。若產品要求零延遲撤銷，必須改為逐次身分核對的下載代理／串流，不能宣稱短效簽章提供即時撤銷。

## 聊天室照片的發布與讀取

1. 選取照片後，客戶端為這次傳送保留一組訊息 ID。`dmAttachmentDelivery` 的 `uploadPhoto` 操作核對呼叫者帳號、DM 類型與成員名單；首次建立對話時另要求呼叫者具備該校有效會員資格，不核對收件人校籍或雙向封鎖，簽發只能寫入 `conversations/{conversationId}/photos/{mediaId}/photo.{ext}` 的短效表單。
2. `sendDmPhoto` 核對暫存檔的上傳者、訊息 ID、格式、大小和檔頭。它把指定版本複製到同一資料夾的 `sent.{ext}`，以 GCS 的 `ifGenerationMatch: 0` 保護已發布的物件。在 Firestore 交易裡重新核對權限，寫入訊息和收件匣摘要。訊息只存物件路徑與版本。確認送達後重試相同 ID 不會新增訊息。
3. 收件人點「查看照片」時，伺服器核對呼叫者帳號、DM 類型、對話成員、訊息及附件版本，既有對話不重新核對校籍或封鎖狀態，再對指定版本簽發 60 秒 GET。撤回會拒絕新的讀取授權。物件使用 `private, no-store`，已發出的連結仍可能在有效期內開啟。

正式驗收需以專用測試 bucket、實際網頁來源與兩支手機走完相簿選圖、POST、確認送達、讀取、撤回和過期。用同一張尚未過期的表單重送不同圖片後，收件人應仍讀到原本的位元組。另需盤點中斷上傳留下的 `photo.*`、失敗交易留下的複本，再訂定清理方式，避免刪到仍有訊息引用的 `sent.*`。

## 第一次與同學開聊

進入同學的私訊頁時，客戶端先呼叫 `prepareDmConversation`，由伺服器確認呼叫者帳號可用與既有對話的 DM 類型、學校 ID 和成員名單；尚未建立時要求呼叫者具備該校有效會員資格，不比對使用者資料上的校籍、不核對收件人校籍，也不讀取封鎖文件，並取得既有格式的固定對話 ID。這個步驟只有讀取。尚未建立的對話透過自己的同校私訊查詢等待對方第一則訊息，對話文件與訊息的直接監聽會在確認建立後啟動。

第一則文字透過 `sendDmText` 傳送。第一張照片的上傳授權與 `sendDmPhoto` 同時帶入 `peerUid`，伺服器再次核對固定對話 ID、呼叫者與成員名單，並依上述首次建立或既有對話的條件授權。送出交易會一起建立對話、訊息及收件匣摘要，重試沿用同一組訊息 ID。雙方同時開始聊天時，Firestore 交易會處理同一對話的競爭建立。收件匣會在第一則訊息實際送出後出現這段新對話。

既有私訊的 Firestore Rules 與上述 callable 不因 `blockedUsers` 或 `friendBlocks` 文件新增而撤銷成員權限。封鎖後既有成員仍可讀寫訊息、更新收件匣預覽、排序時間及已讀標記，也可依原有條件取得附件授權。Rules 允許成員在保留 `schoolId` 與 `memberIds` 時更新對話類型，包括替缺少 `type` 的舊文件補值；新增的文字與照片 callable 仍自行要求既有對話為 `type: 'dm'`。

`backend/functions/dmConversations.emulator.cjs` 已納入 `pnpm test:rules`，使用真實 Firestore emulator 與完整規則驗證首次讀取拒絕、雙方併發傳送、首次照片與文字競爭、回條重播、封鎖後既有寫入與預覽仍可用、對話類型變更與舊文件補值、收件人無校籍仍可首次開聊、交易重試時撤銷發起者會員資格，以及首次照片發布期間撤銷發起者會員資格的處理。該測試的 Storage 使用固定測試資料，GCS 簽章與實體裝置仍依本文件的真實服務流程驗收。

## 仍存在的舊版風險

- Firebase `getDownloadURL` 的舊下載 token 可能已被分享，單純改 Storage Rules **不會撤銷**那些網址。
- GCS signed GET 可在回應 headers 中暴露物件自訂 metadata，包括既有下載 token。為保留既有功能，本次一般讀取及簽發短效網址不修改 metadata、不撤銷 `firebaseStorageDownloadTokens`；舊下載網址繼續有效，不能宣稱歷史附件已只有短效授權。
- 撤銷工具預設唯讀，僅供日後人工盤點及另行決策。合併、CI 與一般讀取流程皆不會自動執行撤銷。
- 正式 GCS bucket、IAM／公開 ACL、Cloud Storage CORS、App Check、實體手機與網頁介面均須獨立驗證。

## 操作前條件與順序

1. 在獨立測試 bucket 先完成。部署具備簽章能力的 callable，確認對話成員能從實際 UI 重新取得短效網址；未登入、非成員及呼叫者帳號不可用時必須被拒。另驗證首次建立要求呼叫者具備有效學校會員資格，既有成員轉校、收件人無校籍或雙方封鎖後仍保留既有存取。任何部署前均需先核對 CI、CodeQL、Maestro、指定 App 審查與主線分支保護。
2. 盤點既有 Firestore 文件是否仍只存 `imageUrl/fileUrl`；完成轉為不可公開的物件 `path` 的雙端讀寫遷移。**不要先撤銷唯一的可用網址以致合法學生無法存取。**
3. 持續保留舊 SDK 相容路徑；任何日後撤銷決策均須先驗證所有既有功能可用，不能因切流關閉舊功能。另確認受保護物件沒有以 GCS bucket IAM/ACL 意外公開。
4. 在曾有舊 Firebase token 的測試物件，事先保留 **一個只供測試**的舊網址（保存在本機秘密變數，不提交 Git、不貼到 PR、不寫入日誌）；用匿名 HTTP GET 記錄修正前狀態碼。
5. 日後另行決定部署及手動撤銷時，先唯讀盤點，再核准測試物件撤銷；正式 bucket 的每批撤銷均須另行決策，本次不執行。

## 操作工具（需具備相應 GCS 權限的 ADC）

從儲存庫根目錄執行。工具預設唯讀、最多檢查 100 筆，**不輸出物件名稱或 token**，僅顯示物件路徑 SHA-256 前 16 碼與狀態；每個批次有上限 1,000 筆。

```bash
node backend/functions/scripts/revokeDmAttachmentTokens.cjs --bucket YOUR_TEST_BUCKET --max-objects 100
```

如果回傳的 `summary.truncated` 為 `true`，以 `summary.nextPageToken` 作為下一批的 `--page-token`；**不能把第一批完成誤稱整個 bucket 完成**。實際修改需要同時提供兩道明確確認：

```bash
node backend/functions/scripts/revokeDmAttachmentTokens.cjs \
  --bucket YOUR_TEST_BUCKET \
  --path conversations/DM_ID/messages/MESSAGE_ID/file.png \
  --execute --confirm-bucket YOUR_TEST_BUCKET
```

批次執行同樣須 `--execute --confirm-bucket YOUR_TEST_BUCKET`，並於每一批檢查 `nextPageToken`。程式以 GCS `ifMetagenerationMatch` 防止意外覆蓋同時發生的 metadata 修改，寫入後重新查核是否真的移除 token；失敗即中止。請在審核上線順序後才執行正式 bucket，不要讓單次測試直接批次更動正式資料。

## 日後部署與手動撤銷的真實服務驗收

| 情境 | 必須看到 |
|---|---|
| 合法同校雙方 | 兩個不同 Firebase Auth 使用者能 POST、重新 GET 同位元附件；聊天室能從持久化 `path` 再開啟 |
| 拒絕未登入、非成員與不可用的呼叫者帳號 | callable 拒絕且沒有 GCS grant；原有 60 秒 grant 另外量測到期 |
| 校籍與封鎖相容性 | 首次建立要求呼叫者有效學校會員資格；既有成員轉校、收件人無校籍或雙方封鎖後，仍可依既有條件傳送、讀取與取得附件授權 |
| 舊網址撤銷 | **同一個曾經成功 HTTP 200 的舊 Firebase 下載網址**，在更新 metadata 後變成無法下載；保存前後 HTTP 狀態、匿名驗證時間，但不記錄 token |
| 新網址過期／重放 | 真實 GCS 在 60 秒期限之後拒絕舊 V4 GET／POST；使用者可重新授權成功 |
| 網站／手機 | 320、390、1366px；觸控／鍵盤、VoiceOver/TalkBack、操作失敗重試、切校及離線保護 |
| 主線合併 | 重新對最新 main 差異檢查、CI、CodeQL、Maestro、指定 App 審查與未解決討論 |

上述證據用於日後部署與手動撤銷驗收，不阻擋本次相容修正合進 main。測試結論需註明 commit SHA、bucket 所屬**測試專案**、時刻與 HTTP 狀態，避免混淆測試與正式環境。

官方參考：[Storage Rules limits](https://firebase.google.com/docs/rules/rules-behavior#security_rules_limits) · [GCS metadata preconditions](https://cloud.google.com/storage/docs/generations-preconditions)。
