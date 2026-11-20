# 帳號專屬展示資料

`seed-account-demo.mjs` 替已存在、已驗證 Google 登入的**指定平台帳號**加入可操作的私人課班與個人匯入資料。帳號 ID、信箱與顯示名稱在執行時提供，不寫入儲存庫。

## 建立的內容

| 內容       | 數量與用途                                     |
| ---------- | ---------------------------------------------- |
| 私人課班   | 2 門學生課班、1 門本人管理的專題課班           |
| 教材       | 6 份，資料庫、AI 代理授權與專題展示            |
| 作業／測驗 | 6 份近期作業、3 份簡答測驗                     |
| 個人資料   | 5 筆每週課表、3 筆近期行程、3 筆合成歷史成績   |
| 展示設定   | 12 項展示功能開啟，30 天有效；進度從未操作開始 |
| 授課者     | 本帳號專用的合成 fixture，**沒有任何登入憑證** |

課程、個人資料來源與學生證識別碼均清楚標示展示用途。學年／學期與日期依執行當下的台北時間產生；個人資料通過正式的 `validatePersonalImportSyncRecords` 驗證。學生證、訂餐與行政展示由 `nuni_account_demos` 控制，不代表正式校籍、門禁、付款或全校行政權限。

## 預覽與審查

先在目標資料庫確認真實 `platform_accounts.id`、`primary_email` 和有效 Google credential 的 `email_at_registration`、`email_verified`，並確認目前 `personal_import_ledgers`。這份工具會在寫入交易中再核對一次。

```bash
node scripts/demo/seed-account-demo.mjs \
  --account-id "$DEMO_TARGET_ACCOUNT_ID" \
  --email "$DEMO_TARGET_EMAIL" \
  --display-name "$DEMO_DISPLAY_NAME" \
  --school-id pu \
  --school-name 靜宜大學 \
  --sql-file /tmp/nuni-account-demo.sql \
  --fixtures-file /tmp/nuni-account-demo.json
```

未加 `--apply` 時不連資料庫。輸出的 SQL／JSON 含目標帳號資料，應留在私人工作目錄，不提交 Git。工具以 `0600`、不覆蓋既有檔案的方式寫出審查檔。

若已有個人匯入資料，以 `--existing-ledger /tmp/current-ledger.json` 傳入 `{ "schoolId": "pu", "revision": 1, "records": [...] }`。省略時，計畫要求目標 ledger 不存在；若實際已存在就整筆拒絕，不會把原資料當成空白覆蓋。

若需固定重現時間，可用 `--now 2026-11-12T03:00:00.000Z`。正式執行通常直接用當下時間。

## 套用

先套用同目錄的 `account-demo-schema.sql`，再審查產生的完整 SQL。SQL 包含 serializable 交易、已驗證帳號核對、識別碼碰撞檢查、既有 ledger 的版本與內容核對，以及保存後讀回檢查。

亦可使用已安裝 Web `pg` 相依套件的環境，透過 `ACCOUNT_DEMO_DATABASE_URL` 注入已授權資料庫連線，執行相同指令並把 `--sql-file` 改成 `--apply`。密碼不得放在命令列。`--apply` 會在交易內讀取最新 ledger，與預覽使用相同的驗證及參數化 SQL。

工具不修改既有課班、不建立 Google／Firebase 登入憑證、不新增校方資格或全平台角色、不開啟正式線上點餐旗標。

## 重跑與資料保留

課班、授課者與個人資料識別碼依帳號、校園與 seed 版本固定產生。重跑只補缺少的資料；既有課名、作業狀態、個人修改、展示進度、功能開關及到期日全部保留。相同個人資料以 ID 和正式匯入自然鍵去重。

若使用者已將展示課班掛靠正式學校、加入其他成員、或識別碼與其他資料衝突，工具會拒絕整筆操作。若 ledger 在審查後改變，舊 SQL 也會拒絕；重新讀取最新資料產生計畫即可。直接在 SQL 客戶端執行時，若出錯需先 `ROLLBACK` 結束交易，才重新執行。

展示有效期不會因重跑自動延長。到期或停用後要再開放，應以明確的管理操作更新既有展示設定。

## 驗證

```bash
node --test scripts/demo/seed-account-demo.test.mjs
```

測試使用儲存庫已固定版本的 Firebase CLI 相依套件 PGlite，建立拋棄式記憶體 PostgreSQL；不讀正式連線設定。涵蓋台北日期、穩定識別碼、既有資料保留、錯誤帳號拒絕、跨帳號與教材碰撞的完整回滾、SQL 字串 escaping、過期計畫拒絕及兩個帳號的資料隔離。此測試不等於已驗證託管 PostgreSQL 的併發鎖行為或正式 UI。

資料寫入後仍需在目標帳號從正式 API 讀回，再確認 Web／App 的課班及個人資料同步畫面實際呈現。裝置尚未同步時，本機課表不會只因雲端 ledger 已存在就自動更新。
