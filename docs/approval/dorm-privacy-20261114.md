# 宿舍隱私修正：待核准權限片段

本文件僅供「需晉瑋說『上』」核准檢視，沒有套用規則、部署或執行 migration。

## Firestore：封閉舊包裹文件 ID 的直接讀取

`schools/{schoolId}/packages` 舊文件 ID 可能含登錄者的學號，Firestore 無法只遮蔽文件 ID。即使新前端已改走後端，既有直接讀取權限仍能被舊客戶端利用。核准時應以以下片段**取代**現有同路徑 match（不能另加 deny，因為 allow 會聯集）：

```firestore
match /packages/{packageId} {
  allow read, write: if false;
}
```

新的 Web／Mobile 宿舍包裹列表使用 `dormWorkflow` 的 `parcels` action；伺服器驗證有效校內 membership，只查詢 `recipientId == caller.uid`，只回傳白名單欄位與隨機 `publicId`。即使學校未開通新工作流程，也能讀取自己的既有包裹。`confirmPackagePickup` 可解析新代碼並在交易內驗證收件人，保留舊 ID 呼叫相容。既有包裹原文件及狀態不搬移、不刪除；第一次讀取時僅補隨機別名。

此片段會關閉其他舊版客戶端的包裹 Firestore 直讀，包含未限定棟別的共用 serviceRoles 直讀。核准上線前需協調客戶端版本與其他包裹管理介面的替代路徑；新宿舍工作台使用 backend-only `dormPackages` 與明確棟別授權。不可只部署前端就宣稱舊資料已完全封閉。

## Storage：沿用預設拒絕

新照片由後端寫入 `dorm-private/{randomUUID}`，不含 UID、學號或學校代碼，不建立 Firebase download token，也不把 UID 寫進可由物件回應標頭讀取的 custom metadata。擁有者記錄於 backend-only `schools/{schoolId}/dormPhotoUploads/{randomUUID}`，送單時由伺服器核對本人；刪帳清理一併移除該授權紀錄。現有 Storage rules 的 catch-all 已拒絕此路徑的所有客戶端讀寫，因此無需新增 Storage 規則。

`repairPhoto` 每次驗證有效校內 membership、工單存在、本人或 repairs 值班棟別權限，再簽發 60 秒讀取網址。列表只回傳照片序號。舊照片僅接受本 bucket 下該工單擁有者的 `temp/{uid}/dorm_*` 路徑，授權讀取時複製到隨機私有路徑、清除新舊物件的公開 download token，新物件同時清除全部 custom metadata，再更新該工單的照片欄位；不批次掃描或新增 migration。先前已散布的舊網址在該照片被後端讀取撤銷 token 前仍可能有效，此限制須納入開通驗收；本 PR 沒有操作正式物件。

後端執行身分需具既有 bucket 寫入／複製／metadata 更新與簽署 URL 能力，核准開通時以合成工單驗證，不能使用真實學生資料。照片上傳每張最多 6MB，僅接受 JPG、PNG、WebP；不讓前端直接取得永久公開網址。
