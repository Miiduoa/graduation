# 作業附件繳交

沿用 nuni 課程作業 API、`class_workspace_assignment_submissions` 文字繳交、`class_assignment_submission_files` 附件索引及私有 Supabase Storage bucket `assignment-submissions`。2026-10-22 正式站已啟用附件上傳下載，本次不建立另一套儲存，也不重新建立 bucket。

Web 與 App 都支援多檔繳交、繳交時間、準時／遲交、老師查看與下載。圖片最多 8 張，每張 10 MiB；文件最多 2 份，每份 20 MiB。白名單為 JPEG、PNG、WebP、HEIC／HEIF、PDF、DOC、DOCX、TXT、ZIP；同時驗證副檔名、宣告類型、實際檔頭及實際長度。檔名拒絕路徑、控制字元會清除；Storage key 使用隨機 UUID，下載網址不暴露 bucket key。

上傳只接受課程內的學生；學生只能查看自己的繳交，授課老師與共同授課者可查看全班。現有課程角色沒有獨立助教角色，協助授課者使用既有 `co-teacher` 權限。下載透過 BFF 的 10 分鐘簽章連結，撤回或被新版取代的檔案立即停止提供內容。

## 截止與撤回

收件中的作業允許首次遲交並標示遲交。截止時間（含該毫秒）前可重繳或撤回，沒有期限時可持續修改；老師停止收件或課程封存後禁止操作。時間沒有時區時依台北時間解讀。

`281` 只新增 `class_assignment_submission_withdrawals`，以作業、學生及原繳交時間作複合主鍵，記錄撤回時間。既有文字繳交列和檔案不刪除、不改寫；平台 API 的學生回執、老師清單、回饋寫入與冪等回放都排除已撤回版本；BFF 另外過濾並統一計算可見繳交數量。附件開關只控制附件功能，不得停用撤回過濾。App 的作業查閱固定經過 BFF，缺少 BFF 時回報服務不可用。重新繳交產生新的伺服器時間，因此不會被舊撤回紀錄隱藏。撤回請求帶原繳交時間，避免舊畫面直接撤回已更新的內容。

Web 與 App 的文字重繳也經同一個 BFF，避免保留舊附件。改交純文字代表新版本不含附件。上傳失敗保留選檔，可以重試；不確定的寫入結果沿用原冪等鍵確認。上游文字 API 與附件索引分屬兩次寫入。沿用 `280` 的冪等表，先保存已授權操作（原附件快照、待送附件、文字與時間），再保存上游確認結果及預期附件 ID；這些紀錄只新增，不覆寫。附件對齊失敗回 503 後，原鍵可在截止後與程序重啟後完成修復；已保存上游確認時不再送文字。不同內容沿用原鍵回衝突，新鍵仍受截止規則限制。對齊尚未完成時，回執讀取回 503，不回傳缺少附件的成功回執。

## 權威 API 組裝

`0001-authoritative-withdrawal-reads.patch` 接在教材分頁 patch 後，納入既有 `281` 撤回表 migration、平台 API 過濾及資料庫回歸測試。`composed/source.json` 已重新產生候選 tree 與 patch checksum。需先發布含此過濾的 API，再開放撤回；舊 App 直連平台 API 也會套用同一撤回表。API 的原始 submissionCount 保留既有總數語意，BFF 的列表及送出／撤回回應統一由 `visibleSubmissionCount()` 扣除目前有效版本的撤回數，避免重複扣除。

本次未新增 migration 編號、資料表或欄位，沒有修改 `280`；操作恢復沿用其既有冪等表。`281` SQL 及 rollback 也維持原內容，只把相同 SQL 納入 API migration manifest。執行帳號不同時，API 亦需對撤回表有 SELECT 權限。

## 上線 migration

本分支只提交程式與 SQL，不直接部署或連正式資料庫。由維運使用既有安全連線環境執行，勿把連線字串或憑證寫入文件、命令紀錄或版本庫。

1. 確認既有 `ASSIGNMENT_FILE_DATABASE_URL` 指向 **nuni-api PostgreSQL**，其中已有 `class_workspaces`、`class_workspace_assignments`、`class_workspace_assignment_submissions` 與 `platform_accounts`；Supabase 僅存 blob。
2. 使用已設定連線的 `psql` 執行：

   ```sh
   psql -X --set ON_ERROR_STOP=1 --file deploy/nuni-api/assignment-files/280_assignment_submission_files.sql
   psql -X --set ON_ERROR_STOP=1 --file deploy/nuni-api/assignment-files/281_assignment_submission_withdrawals.sql
   ```

   `280` 已套用可重跑或略過；`281` 使用 `CREATE TABLE IF NOT EXISTS`，交易包覆，可重複執行。兩份 migration 都只新增資料表／索引，不更新或刪除既有資料。使用執行帳號建立表後，若執行帳號與 BFF 帳號不同，需依既有權限管理授予 BFF 對新表的 SELECT、INSERT 權限。
3. 沿用既有私有 bucket、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`ASSIGNMENT_FILE_SIGNING_SECRET`（或至少 32 字的既有 `BFF_SESSION_SECRET`）。不新增儲存服務。
4. 保持既有 `ASSIGNMENT_FILE_SUBMIT_ENABLED=true`，重建並部署 Web。此開關也會影響建置時的相機 Permissions-Policy。
5. 以 `EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED=true` 重建 App。驗收學生多檔／重繳／撤回、另一位學生被拒絕、老師清單與下載、截止邊界、失敗重試。

未設定正式資料庫或 Storage 時回 503，不會改用記憶體假裝成功。本機與測試才使用記憶體索引／具 TTL 的 blob；`ASSIGNMENT_FILE_STORE_DIR` 僅供非正式磁碟儲存。

## 回滾

優先只回退 Web／App，**保留權威 API 過濾、新增表及撤回紀錄**。若連 API 一起回退，必須先封鎖所有相關繳交／查閱及回饋入口，避免舊客戶端重新讀到撤回內容。未完成的操作需保留冪等紀錄並以原鍵修復；勿清空冪等表。

確定可移除新功能且已匯出撤回紀錄後才執行：

```sh
psql -X --set ON_ERROR_STOP=1 --file deploy/nuni-api/assignment-files/281_assignment_submission_withdrawals.rollback.sql
```

只移除本次新增表，不改文字繳交與檔案。`280_assignment_submission_files.rollback.sql` 會移除整個既有附件索引，**本次回退不要執行**，以免遺失先前正式站的附件索引。Storage blob 不由回滾 SQL 刪除。
