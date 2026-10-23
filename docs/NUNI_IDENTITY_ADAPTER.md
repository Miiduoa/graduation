# Nuni 身分對照驗證

這個 server-only adapter 已接到唯讀 CLI，可向 Nuni 確認目前 session 的身分並比對明確對照紀錄。它沒有簽發 Firebase token、建立或合併帳號、寫入資料庫、遷移資料或串接付款。CLI 由操作人員提供的 Firebase UID 只是預期對照值，不代表已驗證該 Firebase 帳號的登入權限。

## 執行

使用 Node.js 22，從專案根目錄執行：

```sh
node scripts/verify-nuni-integration.mjs
```

環境設定名稱見 `backend/functions/integrations/nuni-identity.env.example`；CLI 不自動載入 `.env`。session 由安全的執行環境注入，不放入命令列或公開前端設定。成功輸出 `status: verified`，失敗輸出 `status: blocked` 並以非零狀態結束；輸出不包含 session、person ID、Firebase UID 或 mapping 檔案內容。

預設只向 `https://api.nuni.tw/v1/auth/session/identity` 發出 GET。操作人員可顯式設定另一個 HTTPS origin，mapping 必須記錄相同 authority；不接受路徑、query、帳密或非標準 port，不跟隨 redirect。5 秒期限包含回覆內容讀取，JSON 最大 8 KiB；網路錯誤與未登入分開回報，不把失敗當成沒有帳號。每次執行都重新向 Nuni 驗證，不快取成功身分，也不解碼 JWT 自行信任 claims。

預設 origin 的依據：已核對的 Nuni repo `docs/mobile-store-release-gates.md:33` 明定正式 API 為 `https://api.nuni.tw`；`deploy/fly/README.md:188–193` 也把此名稱指定給 API。2026-10-08 10:22（Asia/Taipei）另以不帶任何憑證、驗證 TLS 且不跟隨轉址的 GET 檢查 `/health/ready`，得到 HTTP 200、TLS verify result 0，effective URL 保持 `https://api.nuni.tw/health/ready`，回報 `service: campus-api`、`database: reachable`。這證明預設名稱與目前可達的有效 TLS API 一致；沒有驗證特定帳號、部署 SHA、資料庫身分或 Nuni／Firebase 對照。健康回覆的可用登入路徑是 `platform`，不能據此宣稱校方帳號與身分交換已可用。

## 對照紀錄

`NUNI_IDENTITY_BINDINGS_FILE` 是操作人員管理的 JSON 檔案，上限 1 MiB。初始內容應為空；沒有官方核實對照時不可補入猜測值：

```json
{ "version": 1, "bindings": [] }
```

每筆紀錄必須含 `firebaseProjectId`、`firebaseUid`、`schoolId`、`nuniOrigin`、`tenantId`、`personId`、`status`（`active` 或 `revoked`）、`evidenceRef`、`verifiedAt`。`evidenceRef` 應指向授權人員可查核的雙方帳號驗證或正式名冊對照紀錄，`verifiedAt` 為實際核實時間。格式驗證不會證明這份人工提供的 evidence 真實，因此這個檔案及其管理權限仍是信任邊界。

同一 Firebase project／UID／school 及同一 Nuni origin／tenant／person 均只允許一筆紀錄，包含撤銷紀錄，避免把衝突默默當成新帳號。要更換對照須由權威流程處理，不在 CLI 自動解除舊綁定。不同 project、school、tenant、person、origin、未來核實時間、撤銷及缺少對照都會被拒絕；不使用姓名或 email 匹配。

## 已核對的既有契約

來源為 `nuni-prod` commit `9de47b4b3492325e430562c37bcad552867162db`，不是目前正式部署版本的證明。

- `apps/api/src/app.ts:1791` 的 `GET /v1/auth/session/identity` 回 `{tenantId, personId}`。同檔 `1181–1190` 先驗證 session，再執行目前有效性檢查。
- `apps/api/src/auth.ts:257` 支援 `Bearer` 及 server-held `Session`；`accounts/campus-account-session-guard.ts:18–46` 檢查 credential、subject 有效性與 JTI 撤銷。不能只在交換時驗一次 Nuni，之後就無期限相信另一個後端的 token。
- Campus One `backend/functions/index.js:1936–1970` 的 PU 登入以自己的 Firebase UID 與 custom token 為主，SSO 另有身份映射；這次沒有修改任一簽發路徑。其權限仍依本人 UID 與 `schools/{schoolId}/members/{uid}`，不得把 Nuni roles 直接複製成管理權限。
- Nolu `Miiduoa/web` commit `a8e6804ef971de9eb68074a4499924c823fab733` 的 `supabase/functions/pu-plan-api-v8/index.ts:291–312` 會驗 HMAC session 及目前 password credential version；`bootstrap` 回 `profile.id`。它沒有 Nuni tenant 或 Firebase school 的權威映射。`nolu-browser-gateway-v1/index.ts:18–26` 的 origin 名單未含 `nuni.tw`，本次沒有改動或移植此身分系統。
- `nuni-v2` commit `caa4cd313678c9b450f1932682f003fe281f748d` 的 `apps/api/src/lib/session-store.ts:16` 使用記憶體 preview sessions，不作正式身份來源。

## 接入正式登入前仍缺少

1. 預設 Nuni origin 已有上述來源及公開 TLS／健康檢查證據；仍需核對其實際部署 SHA、登入模式、對應資料庫，以及 Campus One Firebase project。若改用另一個 origin，須重新核對其官方歸屬與環境，不能沿用本次證據。
2. 經核實的 Nuni tenant／person ↔ Firebase project／UID／school 對照與建立、撤銷、稽核流程。Nolu 若要接入，另需本人 Nolu ID 的證據及校別歸屬；不得推定同 email 為同一人。
3. 實際可用流程的 Firebase 身分驗證、校內會員檢查，以及 Nuni Web BFF session 的安全交接。此 CLI 沒有驗證 Firebase session，不能拿其成功輸出當成登入或服務授權。
4. 若要簽发跨服務 token，必須先完成登出、JTI 撤銷、角色與會員撤銷、帳號切換、過期等同步語意與實際驗收；不能因兩個帳號曾經對上而持續授權。

## 帳務邊界

本次沒有通用 ledger adapter。Nuni 已有本人 `/v1/food/orders` 與訂單 `paymentSession`（`apps/api/src/app.ts:5136–5141`、`packages/contracts/src/food.ts:591–605`），但這不是 Campus One 的錢包餘額／充值 API。Nuni TWD `amountMinor` 實際是整數「元」（`payments/payment-money.ts:22–31`），不能自行乘除 100。

可另做保留來源與外部 ID 的唯讀訂單付款投影；不得由 `authorized` 推成已付款，或由 `refund_pending` 推成已退款，更不能直接加減 Firebase 餘額。正式寫入仍需唯一帳務權威、訂單與商戶 ID 對照、期初餘額／歷史對帳、冪等與退款契約，以及付款供應商與 webhook 的正式配置。Nuni 配置名稱包括 `PAYMENT_ONLINE_ENABLED`、`PAYMENT_ENABLED_METHODS`、`PAYMENT_PUBLIC_API_BASE_URL`、`PAYMENT_PUBLIC_WEB_BASE_URL`、`PAYMENT_HANDOFF_SECRET` 與 ECPay／TapPay 商戶設定；本文件未重新查詢正式 secret 是否存在。

## 本機驗證

```sh
pnpm --filter functions exec jest --runInBand --runTestsByPath integrations/nuniIdentity.test.js
node --test scripts/verify-nuni-integration.test.mjs
```

測試只替換 HTTP 與合成對照資料，保留實際 adapter、解析、映射與 CLI 邏輯。未使用真實使用者憑證呼叫正式 Nuni；測試通過不代表身分、帳本、網域或部署已整合。
