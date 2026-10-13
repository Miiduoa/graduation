# 商家開店流程與發布檢查（2026-10-13）

本輪從 `900f8068d86f5a1ec70680a1b3d70cdde91439fd` 主線繼續。PR #30 已合併；本文件不沿用 10 月 11 日的 CI 或部署狀態作為本輪證據。

## 這次補上的流程

Web `/merchant` 與 App 平台店家頁原本只能申請、查看進度與讀取已授權門市，核准後沒有下一步。兩端現在都可進入自己的門市，確認服務與付款方式、建立首次菜單、確認啟用，再暫停或恢復接單。共用欄位與回執驗證沿用固定來源 API，沒有建立第二套店家權限或捏造端點。

- 服務方式為自取、內用、外送。付款能力以伺服器結果決定，未開放線上付款時不能選用。
- 設定以目前版本送出；另一端已修改時先重新讀取，保留本次草稿並讓使用者決定使用哪一份。
- 首次菜單是現有 API 的一次性操作，最多 100 項。售價依現有契約以整數新臺幣元傳遞；`priceMinor: 120` 表示 120 元，不乘以 100。庫存、品項長度與過敏原限制在 Web/App/API 轉接共用。
- 建立菜單、啟用門市有明確確認。網路中斷或回應不符時，不顯示成功、不自動再送；先讀取實際狀態。售完品項不會被 API 的可售數量計入，因此數量為零不能證明首次菜單從未建立。
- 每個操作綁定帳號、場域與門市。Web 延用同源與頁面 session 檢查；App 延用固定 HTTPS API、登出取消與世代驗證，避免接受前一個帳號的延遲回應。
- 已停權門市不能自行恢復；已啟用後再次呼叫啟用，必須尊重伺服器目前狀態，不能把「已暫停接單」改寫為「營業中」。

這個工作區管理 Nuni 平台門市。既有 Firebase 餐廳目錄、校園店面貼文與商家工具保留，兩邊的識別碼與權限不能直接互換。本輪沒有宣稱 Nuni 菜單已同步到所有學生餐飲頁。

## 真實 API 與資料庫驗證

`scripts/verify-nuni-merchant-api.mjs` 重建並核對 `deploy/nuni-api/source.json` 的 patch hash、完整固定 tree `6776b19a7cea998728469c3091c0ea7c264f6aa3`（API 原始版本 `cb57e78aa5f09155ec045ea4b5c130827cdf4fad`）。API 原始碼保持不變。

隔離 PostgreSQL 17.11、正式帳號驗證程式、測試 RS256 簽署身分、`demoAuthEnabled=false`、`seedDemo=false` 下完成 26 次 loopback HTTP 請求：

1. 兩個獨立平台帳號；申請未核准前沒有操作門市。
2. 透過真正審核 service 核准，仍為私密且未啟用；其他帳號與場域不能讀取或操作。
3. 設定回執通過共用 parser；舊版本儲存被拒絕。
4. 兩個並行首次菜單要求分別回 201、409；資料庫只有一項、價格 120、庫存 10。
5. 啟用、暫停、恢復皆通過新共用 client 與真實 API 回執檢查；重播啟用不會把已暫停門市重新開放。
6. 管理者停權、撤銷店長指派及登出撤銷 session 後，繼續操作被拒絕。

審核員與查核結果是臨時 schema 的測試資料，使用真實審核邏輯；不代表真人校方登入、實際食品登錄查核或正式商家已啟用。所有測試資料只在隨機新 schema，結束時移除；腳本拒絕正式主機、未指定連接埠、其他資料庫及 URL query/hash，也不使用環境中的 `DATABASE_URL`。

執行方式（PostgreSQL 使用自己的容器與 loopback 連接埠；完整 schema 清理需足夠鎖數，例如 `max_locks_per_transaction=1024`）：

```sh
node --test scripts/nuni-merchant-api-boundary.test.mjs
<固定 Nuni 來源的 tsx> scripts/verify-nuni-merchant-api.mjs \
  --source <固定來源 checkout> \
  --database-url postgresql://postgres@127.0.0.1:<自有連接埠>/campus_nuni_merchant_acceptance \
  --output <驗證紀錄.json>
```

## 程式驗證

- Node.js 22 下 Web 全套：1,251 通過、1 個既有 library placeholder 略過；正式版建置通過。
- Mobile 全套：2,272 通過、1 個既有 debug placeholder 略過。
- Web／Mobile／shared 型別檢查通過；workspace ESLint 零錯誤，仍有 706 個警告，沒有宣稱已清除所有技術債。
- Firebase 發布檢查、工作流程與 API 隔離邊界測試：66 通過。
- Web／Mobile／共用契約、轉接與驗收腳本經交叉審查；Web 第二輪已修正返回門市、背景回應及登入暫時失敗造成的草稿／未確認寫入狀態遺失。

## 發布檢查修正

目前 CI 手動發布步驟只部署 Firestore 規則、索引及 Storage 規則，卻仍使用要求 Cloud Functions、Cloud Build、Cloud Run 等服務的全套前置檢查。新增 `--mode rules-only` 對齊真正發布範圍；沒有傳入 mode 時，原本 `full` 檢查保持不變。

規則模式仍必須核對專案身分、相關服務屬於該專案且已啟用、Firebase Auth 與指定網域、Firestore native 模式與指定區域、Storage bucket 所屬專案。未知 mode 在讀取憑證或網路請求前即拒絕。沒有自動啟用服務、修改秘密、開啟付費或執行部署。此檢查不保證服務方案資格、登入 provider、完整索引狀態或實際發布結果。

2026-10-13 12:20 UTC 的正式專案唯讀檢查仍為 `ready: false`，共有四個未通過項目：Firebase Storage API 未啟用；Auth 設定回應 404；因此授權網域亦無法確認；指定 Storage bucket 回應 404。專案、Firestore native 資料庫及其區域等其他檢查已通過。此次修正去掉不屬於規則發布的 Cloud Functions／帳務檢查，沒有繞過上述實際阻塞。

同日檢查到 Web 正式健康端點為 revision `5aaa0f9c15fed30b3f5912bf712cce2f0c69367b`（release 39），與這次開發基底不同。API 為固定來源候選的 release 20；平台 Google 登入就緒，但校務登入 provider 可用數為零。GitHub 主線 CI 成功的 Firebase 部署步驟實際為略過，不是規則已發布的證據。

## 仍待完成

- 平台門市的日常菜單修改、訂單收款與接單、備餐、取餐、退款、交班，以及學生端同一資料來源的消費流程，仍需繼續接通與驗收。本輪是開店設定流程，不能稱為完整商家營運系統。
- 真商家、教師、學生、校方管理員登入與跨端驗收；校籍與校務授權不可由一般平台帳號推導。
- 正式服務仍需補齊實際 Auth／Storage 等條件及部署授權。既有公開網站健康不代表最新主線或這輪變更已發布。
- iOS／Android 簽章安裝包、實機 OAuth／推播／離線回復及商店交付。元件測試、JavaScript 打包和模擬器啟動不代替真機驗收。

13 個領域的整體範圍仍見 [產品驗收盤點](PRODUCT_ACCEPTANCE_2026-10-11.md)；其日期性部署記錄須以本輪最新檢查及候選提交的 CI 為準。
