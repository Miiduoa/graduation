# 作業檔案繳交（候選，預設關閉）

這份 overlay 只新增檔案物件表與 API，**不會**改既有文字繳交表。預設關閉：`ASSIGNMENT_FILE_SUBMIT_ENABLED` 必須是字面 `true` 才會露出路由。

## 不要自動做的事

- 不要合進 `main`
- 不要部署 `api.nuni.tw`
- 不要對正式資料庫跑 migration（web-release 會部署 main 最新版）
- 不要開啟任何付費儲存／CDN／影像轉換

要上線時，必須由使用者本人說「上」。

## 儲存（免費額度）

優先使用**既有 Supabase Storage 免費層**，bucket 名稱 `assignment-submissions`：

- 儲存空間：1 GB
- 傳輸：約 2 GB／月
- 單一檔案上限：免費方案 50 MB；本功能再自行限制照片 10 MB、其他檔 20 MB
- 超過免費額度：**不會在程式裡自動加購**。未升級時上傳會失敗（503），不會默默轉成付費
- 不要開：Smart CDN、Image Transformation、Pro 自動升級、spend cap 放寬

本機／CI 預設走記憶體；若設 `ASSIGNMENT_FILE_STORE_DIR` 則寫本機磁碟。沒有 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` 就不會呼叫雲端 Storage。檔案物件表（migration）未套用前，BFF 只在行程記憶體保留檔案索引與回執；開關預設關閉，正式環境不要開。

備選（未接線，需用戶同意才考慮）：

- Cloudflare R2 免費額度：10 GB 儲存、每月 100 萬 Class A／1,000 萬 Class B。目前沒有現成金鑰，沒有開啟
- Fly volume：nuni-api 既有機器可掛磁碟，但新增 volume 可能產生機器費用，**不要開**

## Migration

- 檔案：`279_assignment_submission_files.sql`（只 CREATE）
- 回滾：`279_assignment_submission_files.rollback.sql`（只 DROP 新表）
- 既有 `class_workspace_assignment_submissions` 文字繳交列不會被改或刪

## 開關

| 變數 | 預設 | 用途 |
| --- | --- | --- |
| `ASSIGNMENT_FILE_SUBMIT_ENABLED` | 未設＝關 | BFF／API 露出檔案路由 |
| `EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED` | `false` | App 顯示拍照／相簿／檔案 |
| `ASSIGNMENT_FILE_STORE_DIR` | 空 | 本機磁碟 |
| `ASSIGNMENT_FILE_SIGNING_SECRET` | 可沿用 `BFF_SESSION_SECRET` | 短效下載簽章，至少 32 字 |

不要設定 `ONLINE_ORDERING_ENABLED`。
