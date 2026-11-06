# 校園私訊媒體：舊網址撤銷與分階段交付驗證

狀態：**尚未能合併、部署或宣稱舊網址已全部撤銷**。本檔只定義可重現的操作與通過條件；模擬器和 Jest 的成功不等於真實 GCS / Firebase 服務驗證。

## 權限與流量分界

- 既有私訊附件儲存在 `conversations/{conversationId}/messages/{messageId}/{fileName}` 或 `conversations/{conversationId}/media/{mediaId}/{fileName}`。新版聊天室傳送的照片使用下方的 `photos` 路徑。
- **Firebase Storage Rules 對這兩種路徑禁止直接 SDK 讀寫**，避免一次讀取三份 Firestore 文件而超過規則的兩份文件限制。
- `dmAttachmentDelivery` callable 每次檢查 Firebase Auth、DM 雙方名單、當前學校的使用者資料與有效會員資格，再提供有效期 60 秒的 GCS V4 POST 或 GET。新訊息只應儲存物件 `path`，不能儲存短效 URL、POST policy 或長效 Firebase 下載 URL。
- **已簽發的 60 秒 GCS GET/POST 仍是 bearer capability**：身分被撤銷後，舊簽章可能在到期前繼續使用。若產品要求零延遲撤銷，必須改為逐次身分核對的下載代理／串流，不能宣稱短效簽章提供即時撤銷。

## 聊天室照片的發布與讀取

1. 選取照片後，客戶端為這次傳送保留一組訊息 ID。`dmAttachmentDelivery` 的 `uploadPhoto` 操作核對兩人的校籍及雙向封鎖狀態，簽發只能寫入 `conversations/{conversationId}/photos/{mediaId}/photo.{ext}` 的短效表單。
2. `sendDmPhoto` 核對暫存檔的上傳者、訊息 ID、格式、大小和檔頭。它把指定版本複製到同一資料夾的 `sent.{ext}`，以 GCS 的 `ifGenerationMatch: 0` 保護已發布的物件。在 Firestore 交易裡重新核對權限，寫入訊息和收件匣摘要。訊息只存物件路徑與版本。確認送達後重試相同 ID 不會新增訊息。
3. 收件人點「查看照片」時，伺服器核對對話、訊息、校籍和封鎖狀態，再對指定版本簽發 60 秒 GET。撤回會拒絕新的讀取授權。物件使用 `private, no-store`，已發出的連結仍可能在有效期內開啟。

正式驗收需以專用測試 bucket、實際網頁來源與兩支手機走完相簿選圖、POST、確認送達、讀取、撤回和過期。用同一張尚未過期的表單重送不同圖片後，收件人應仍讀到原本的位元組。另需盤點中斷上傳留下的 `photo.*`、失敗交易留下的複本，再訂定清理方式，避免刪到仍有訊息引用的 `sent.*`。

## 第一次與同學開聊

進入同學的私訊頁時，客戶端先呼叫 `prepareDmConversation`，由伺服器確認雙方校籍、帳號及封鎖狀態，並取得既有格式的固定對話 ID。這個步驟只有讀取。尚未建立的對話透過自己的同校私訊查詢等待對方第一則訊息，對話文件與訊息的直接監聽會在確認建立後啟動。

第一則文字透過 `sendDmText` 傳送。第一張照片的上傳授權與 `sendDmPhoto` 同時帶入 `peerUid`，伺服器再次核對固定對話 ID 和雙方身分。送出交易會一起建立對話、訊息及收件匣摘要，重試沿用同一組訊息 ID。雙方同時開始聊天時，Firestore 交易會處理同一對話的競爭建立。收件匣會在第一則訊息實際送出後出現這段新對話。

既有私訊的客戶端寫入也會核對雙向 `blockedUsers` 與 `friendBlocks`。封鎖期間新增訊息、單獨更改收件匣預覽或排序時間都會被拒絕。對話類型固定，已讀標記仍可更新。

`backend/functions/dmConversations.emulator.cjs` 已納入 `pnpm test:rules`，使用真實 Firestore emulator 與完整規則驗證首次讀取拒絕、雙方併發傳送、首次照片與文字競爭、回條重播、封鎖後寫入與預覽保護、交易重試時撤銷校籍，以及照片發布期間封鎖的處理。該測試的 Storage 使用固定測試資料，GCS 簽章與實體裝置仍依本文件的真實服務流程驗收。

## 仍存在的舊版風險

- Firebase `getDownloadURL` 的舊下載 token 可能已被分享，單純改 Storage Rules **不會撤銷**那些網址。
- GCS signed GET 可在回應 headers 中暴露物件自訂 metadata。因此，讀取授權前必須移除 `firebaseStorageDownloadTokens`，再次查核 metadata 不再包含 token，失敗則不簽 GET。
- 這個「被讀取時撤銷」只處理使用者重新開啟的物件；**尚未被開啟的歷史物件仍需完整清查與批次撤銷**。
- 正式 GCS bucket、IAM／公開 ACL、Cloud Storage CORS、App Check、實體手機與網頁介面均須獨立驗證。

## 操作前條件與順序

1. 在獨立測試 bucket 先完成。部署具備簽章能力的 callable，確認兩位同校有效成員能從實際 UI 重新取得短效網址；跨校、轉校、刪除帳號與陌生人必須被拒。任何部署前均需先核對 CI、CodeQL、Maestro、指定 App 審查與主線分支保護。
2. 盤點既有 Firestore 文件是否仍只存 `imageUrl/fileUrl`；完成轉為不可公開的物件 `path` 的雙端讀寫遷移。**不要先撤銷唯一的可用網址以致合法學生無法存取。**
3. 完成切流至 callable 後，再關閉原 SDK Storage 路徑；確認受保護物件沒有以 GCS bucket IAM/ACL 意外公開。
4. 在曾有舊 Firebase token 的測試物件，事先保留 **一個只供測試**的舊網址（保存在本機秘密變數，不提交 Git、不貼到 PR、不寫入日誌）；用匿名 HTTP GET 記錄修正前狀態碼。
5. 先盤點，再挑一筆測試物件執行撤銷，最後才以分批工具處理完整 bucket。

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

## 真實服務證據的最低要求

| 情境 | 必須看到 |
|---|---|
| 合法同校雙方 | 兩個不同 Firebase Auth 使用者能 POST、重新 GET 同位元附件；聊天室能從持久化 `path` 再開啟 |
| 拒絕外人、跨校、轉校 | callable 拒絕且沒有 GCS grant；原有 60 秒 grant 另外量測到期 |
| 舊網址撤銷 | **同一個曾經成功 HTTP 200 的舊 Firebase 下載網址**，在更新 metadata 後變成無法下載；保存前後 HTTP 狀態、匿名驗證時間，但不記錄 token |
| 新網址過期／重放 | 真實 GCS 在 60 秒期限之後拒絕舊 V4 GET／POST；使用者可重新授權成功 |
| 網站／手機 | 320、390、1366px；觸控／鍵盤、VoiceOver/TalkBack、操作失敗重試、切校及離線保護 |
| 主線合併 | 重新對最新 main 差異檢查、CI、CodeQL、Maestro、指定 App 審查與未解決討論 |

只有當上述真實服務與 UI 證據具備，才能解除 #490 Draft。測試結論需註明 commit SHA、bucket 所屬**測試專案**、時刻與 HTTP 狀態，避免混淆測試與正式環境。

官方參考：[Storage Rules limits](https://firebase.google.com/docs/rules/rules-behavior#security_rules_limits) · [GCS metadata preconditions](https://cloud.google.com/storage/docs/generations-preconditions)。
