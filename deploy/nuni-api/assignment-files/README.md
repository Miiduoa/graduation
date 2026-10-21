# 作業檔案繳交（候選，預設關閉）

這份 overlay 只新增檔案物件表與 API，**不會**改既有文字繳交表。預設關閉：`ASSIGNMENT_FILE_SUBMIT_ENABLED` 必須是字面 `true` 才會露出路由。

## 不要自動做的事

- 不要合進 `main`
- 不要部署 `api.nuni.tw`
- 不要對正式資料庫跑 migration（web-release 會部署 main 最新版）
- 不要開啟任何付費儲存／CDN／影像轉換
- **不要在此 PR 或 CI 建立 Storage bucket**

要上線時，必須由使用者本人說「上」。

## 儲存（免費額度）

優先使用**既有 Supabase Storage 免費層**，bucket 名稱 `assignment-submissions`：

- 儲存空間：1 GB
- 傳輸：約 2 GB／月
- 單一檔案上限：免費方案 50 MB；本功能再自行限制照片 10 MB、其他檔 20 MB
- 超過免費額度：**不會在程式裡自動加購**。未升級時上傳會失敗（503），不會默默轉成付費
- 不要開：Smart CDN、Image Transformation、Pro 自動升級、spend cap 放寬

正式環境（`NODE_ENV=production`）**只能**把 blob 寫進這個 bucket。沒有 `SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 時上傳回 503，不會改走記憶體或假裝成功。

本機／CI 預設走帶 TTL 的記憶體 blob；若設 `ASSIGNMENT_FILE_STORE_DIR` 則寫本機磁碟。檔案索引與冪等鍵：有 `ASSIGNMENT_FILE_DATABASE_URL`（正式也可沿用 `DATABASE_URL`）時 BFF 讀寫下列新表；沒有連線字串時，記憶體只留本機／CI，正式環境沒設資料庫會回 503。

備選（未接線，需用戶同意才考慮）：

- Cloudflare R2 免費額度：10 GB 儲存、每月 100 萬 Class A／1,000 萬 Class B。目前沒有現成金鑰，沒有開啟
- Fly volume：nuni-api 既有機器可掛磁碟，但新增 volume 可能產生機器費用，**不要開**

## 建立 bucket `assignment-submissions`（文件，不要在此執行）

上線前由維護者在**既有** Supabase 專案手動建立，且保持非公開。此 PR、CI、BFF 啟動程式都不會建立 bucket。

1. 開啟既有專案的 Supabase Dashboard → Storage
2. 選 New bucket
3. Name 填 `assignment-submissions`（必須這個名字，BFF 寫死）
4. Public bucket **關閉**（非公開；下載只走 BFF 短效簽章 GET）
5. 不要開啟 Smart CDN、Image Transformation 或其他付費加值
6. 檔案大小可維持免費方案預設；本功能伺服器端再限制照片 10 MB、其他檔 20 MB
7. 不要用 SQL `insert storage.buckets`、Management API、或任何自動化在此 PR 建立
8. 建好後才把 `SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 配給 BFF；沒配時正式上傳必須失敗

## Migration

- 檔案：`280_assignment_submission_files.sql`（`CREATE TABLE IF NOT EXISTS`，可重複執行；不覆寫 `279_personal_import_sync`）
- 回滾：`280_assignment_submission_files.rollback.sql`（只 DROP 新表）
- 既有 `class_workspace_assignment_submissions` 文字繳交列不會被改或刪
- 正式庫尚未套用，也不要在此 PR 套用

## 開關

| 變數 | 預設 | 用途 |
| --- | --- | --- |
| `ASSIGNMENT_FILE_SUBMIT_ENABLED` | 未設＝關 | BFF／API 露出檔案路由、Platform 課班權杖、檔案 PUT／query、`/classroom*` camera |
| `EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED` | `false` | App 顯示拍照／相簿／檔案；關閉時恢復「只支援文字繳交」文案 |
| `ASSIGNMENT_FILE_DATABASE_URL` | 空 | BFF 讀寫檔案索引與冪等鍵表；正式未設時不可用記憶體頂替 |
| `ASSIGNMENT_FILE_STORE_DIR` | 空 | 本機磁碟（非正式） |
| `ASSIGNMENT_FILE_SIGNING_SECRET` | 可沿用 `BFF_SESSION_SECRET` | 短效下載簽章，至少 32 字 |

不要設定 `ONLINE_ORDERING_ENABLED`。
