# Nuni API deployment source

Campus One uses the existing `api.nuni.tw` database and API. The running API's source repository, `Miiduoa/nuni-prod`, is archived; `Miiduoa/nuni-v2` is a separate rewrite and is not the source currently running in production.

This directory preserves the exact base and reviewed changes used by Campus One, without changing the archived repository or replacing the rewrite. `source.json` binds the base commit, patch checksums, final Git tree, and runtime implementation commit. The second patch updates the derived runtime grant inventory. The third adds a scoped installer for the 30 built-in social event contracts, with enforce-mode regression coverage. The fourth preserves existing account-to-person mappings and serializes first-time persona creation, so legacy accounts can publish and read their public posts without creating a second identity.

目前正式為 be815455（tree b0a10ac），已含 278／279 與教材分頁。本次發布只使用 [composed 281 runbook](composed/RUNBOOK.md)，不含安全依賴更新，security candidate 另案發布；不得宣稱是「main 全部 API 修正」。

預設 `source.json` 保留歷史 v20 的 0001–0004，目標 tree 為 `6776b19a7cea998728469c3091c0ea7c264f6aa3`。只有明確選擇下方點餐候選才套用第五、第六份補丁；預設建置不因候選封裝而改變，不能用來升級目前正式 API。

Build from the repository root:

```sh
python3 deploy/nuni-api/build.py
```

The script uses an isolated temporary checkout, validates every patch and the final source tree, then builds the API image. It does not deploy, run migrations, provision an account, change credentials, or copy development data. Production credentials remain in the existing hosting secret store.

## 點餐流程候選

Web／App 的訂單場域清單需要第六份補丁；最後一家門市暫停後的本人舊訂單與取餐需要第五份補丁。四份補丁的 v20 不能當成完整點餐流程的驗收來源。

`food-ordering/source.json` 固定六份補丁，candidate/runtime commit 為 `5e419aeb0482a535819e9345599e03f950de95a1`，tree 為 `cb6c18ea7f0ccc73b64d3df99e0e772563561c68`。它重用 `patches/` 的檔案並驗證 checksum。明確建置方式：

```sh
python3 deploy/nuni-api/build.py --food-ordering-candidate
```

產物 tag 為 `nuni-api:food-ordering-candidate`。此選項與 `--course-access-candidate`、`--public-cafeterias-candidate`、`--imports-candidate`、`--imports-compatible-rollback` 互斥，也不套入其他候選或執行其 migration。既有 `--imports-candidate` 仍提供餐廳目錄、課程審核與個人匯入的組合；點餐候選尚未與該組合一起驗收，不能將此 image 當成完整整合版。建置成功不代表部署、資料庫 ACL 或真實帳號／裝置驗收完成。

來源與邊界回歸不需要資料庫：

```sh
node --test scripts/nuni-merchant-source.test.mjs scripts/nuni-merchant-api-boundary.test.mjs scripts/nuni-merchant-native-transport.test.mjs
python3 deploy/nuni-api/food-ordering/build_test.py
node scripts/verify-nuni-merchant-api.mjs --food-ordering-candidate --source /absolute/path/to/reconstructed-source --verify-source-only
```

HTTP／PostgreSQL 驗收必須明確選擇此候選，使用重建來源的 `tsx` loader 與自行建立的 loopback 測試資料庫：

```sh
node --import /absolute/path/to/reconstructed-source/apps/api/node_modules/tsx/dist/loader.mjs scripts/verify-nuni-merchant-api.mjs --food-ordering-candidate --source /absolute/path/to/reconstructed-source --database-url postgresql://127.0.0.1:55432/campus_nuni_merchant_acceptance
```

驗收程式會在匯入 API、建立 session 或接觸資料庫之前，檢查六份補丁、checksum、完整 Git tree 與未追蹤的 runtime 檔案。四份或五份補丁的 checkout 會被拒絕；環境中的 `DATABASE_URL` 不會代替明確傳入的測試資料庫。

在 HTTP 驗收命令加上 `--native-client`，會實際匯入 App 的 `apps/mobile/src/services/nuniClient.ts`，讓同一套學生下單、店家收款／備餐／交付、取消退款及交班流程透過 `nuniPlatformRequest` 執行。只在驗收程序內把該 transport 固定的正式 platform API origin 轉到剛啟動的 loopback API，逐筆核對 method、path/query、帳號與 HTTP status；回應全部來自真實 API／PostgreSQL，沒有模擬回應。含憑證的請求不可送到其他 origin，正式 App endpoint 不變。

報告的 `nativeTransport.httpRequests` 與 `requests` 記錄 App transport 實際請求。這只驗證 App transport 加上共用 client，**不是 native UI、相機掃碼、模擬器或實體裝置驗收**。`--native-client` 不可與瀏覽器 fixture 的 `--serve` 或 `--verify-source-only` 混用。

## Public cafeteria catalog

```sh
python3 deploy/nuni-api/build.py --public-cafeterias-candidate
```

This opt-in image adds anonymous, read-only cafeteria lookup for an explicitly selected school. It only selects open schools and locations marked both public and open; published menus remain scoped to those locations and the same school. Existing account, merchant, and order routes retain their authorization and behavior. The pinned migrations do not define a review-status column, so the catalog reports `unverified` without requiring a schema change.

`public-cafeterias/packaging-source.json` binds the four adapter files. `packaging-inventory.json` additionally binds the patched application and regenerated runtime inventory. Generate the inventory using a frozen dependency install in the isolated source checkout before creating `runtime-inventory.patch`; a substitute dependency tree can change its analysis. The inventory remains `BLOCK` analysis evidence, not a grant or database-readiness receipt. The builder checks both sets of hashes and labels the image with the resulting Git tree. It cannot combine this overlay with the separate course-access or food-ordering candidate.

Before rollout, verify the existing runtime database's SELECT privileges and catalog columns in a read-only transaction. No migrations or grants are needed. Preserve the existing machine configuration and immutable image for rollback, then verify anonymous catalog responses and protected order routes on every updated machine. Do not run the old Fly release migration command for this image-only change.

The API adds administrator-only password sessions, a public school directory, and explicitly public cross-campus boards/posts with account-wide blocks, reports, and operator moderation. Migrations 275 and 276 are additive. Existing routes and school authorization remain intact.

Credential provisioning uses `platform-password-admin-cli.js`, bounded JSON on stdin, and an explicit `--apply`. It defaults to a read-only plan and never prints the password or hash. Do not place credentials in this repository, command arguments, logs, or environment files.

After migrations, the original image alone cannot restart because schema verification requires an exact migration manifest. The compatible rollback image retains the previous API code plus the two new SQL manifest files. Roll back the application image without restoring an older database over new user writes. See the release verification report for exact production and rollback image digests.

For a real school, install the social event contracts explicitly with the deployed API image, `CAMPUS_EVENT_SCHEMA_TENANT_IDS=<tenantId>` and `CAMPUS_EVENT_SCHEMA_SET=social`, using `node apps/api/dist/install-builtin-event-schemas-cli.js`. This uses the existing register/activate governance service and audit; keep `CAMPUS_EVENT_SCHEMA_ENFORCEMENT=enforce`. Verify active producer versions and hashes after installation. API startup and school activation do not silently grant governance authority or install these contracts.
