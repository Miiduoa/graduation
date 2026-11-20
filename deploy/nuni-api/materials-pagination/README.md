# 教材分頁 API

既有 `GET /v1/auth/platform/class-workspaces/:id/materials` 保留原本最近 100 筆與 `{ materials }` 回應。新增的 `GET .../:id/materials/page` 每頁最多 50 筆，回傳 `{ materials, nextCursor }`；末頁的 `nextCursor` 為 `null`。後續頁只接受單一 `cursor` query。

游標是有長度上限、版本與課程範圍的 canonical base64url 位置，不是存取授權。每頁都重新驗證有效平台帳號與課程成員資格。SQL 以 `(created_at, id)` 降冪取下一頁，游標直接保存 PostgreSQL 六位小數 UTC 時間文字，不經 JavaScript Date 截斷；原有 `(workspace_id, created_at DESC, id DESC)` 索引可沿用，沒有新增遷移。翻頁期間新發布的教材在重新更新首頁時出現。

`0001-stable-material-pages.patch` 在 `composed/prepare.py` 完成三個既有 overlay 後套用。manifest 的 `overlayTree`、`appSha256` 表示套用前組裝結果，`patchedAppSha256`、`candidateTree` 表示最後候選；patch SHA 也必須一致。一般重建不會改寫 manifest，漂移會停止。

## 歷史來源差異（2026-10-20）

2026-11-01 審查確認：教材分頁已在正式 be815455／tree b0a10ac，本次 281 發布不把分頁算成新增。下列為歷史紀錄，操作以 [281 runbook](../composed/RUNBOOK.md) 為準。

2026-10-20 核對的原正式組裝 tree 是 `fb8ff281facd3d9167db0750c51c9936d1511463`。主線 `0a7d752` 已把個人匯入的共用文案來源與檔案雜湊更新，卻保留舊的候選 tree；依主線來源實際重建三個 overlay 得到 `c9746b456b56aee6b6d1ff067a6627fa281890fc`。

這次保留該主線來源，明確重建 manifest。相較原正式 tree，除了分頁的四個檔案，另含 `personal-import-sync/imports/copy.ts` 與 `imports/sync.ts`：前者是共用文案，後者只調整 `personalImportSyncErrorMessage`；API service 使用的驗證函式沒有變動。發布者需審查這六個檔案，不可把候選說成只有分頁差異。

文案來源來自畢業專案的 `00d9dcb`（統一匯入預覽、存檔與同步文案）及 `97cc900`（縮短衝突錯誤句），`a08d73f` 更新了 API overlay 的文案模組釘選，但沒有同步更新組裝 tree。這次的 manifest 更新補齊該來源關係，未更動既有遷移或點餐旗標。

## 隔離驗收

在可重建的候選 checkout 安裝固定依賴後執行 API typecheck、完整既有 suite 與 build；點餐開放情境的既有測試使用明確的 `ONLINE_ORDERING_ENABLED=true`，不因此變更正式旗標。重建方式沿用 `../composed/README.md`。

下列 runner 只接受明確的 loopback PostgreSQL、port 與專用資料庫名稱，不讀 ambient `DATABASE_URL`。它建立並清除隨機 schema，跑全部 API 遷移及非 demo 的真 nonce、簽章、帳號、session 與 HTTP handler；登入帳號與 IdP 金鑰是本機合成資料。

```sh
node --import <source>/apps/api/node_modules/tsx/dist/loader.mjs \
  scripts/verify-nuni-materials-api.mjs \
  --source <source> \
  --database-url postgresql://<local-user>@127.0.0.1:<owned-port>/campus_nuni_materials_acceptance \
  --output <evidence.json>
```

驗收涵蓋 220 筆資料逐筆遍歷、同時間戳與微秒差異、穿插發布、重試、舊端點相容、錯誤／跨課程游標、訪客／非成員、共同授課者、封存課程、撤權與登出。角色異動用專用 schema 的 fixture SQL，不能代表共同授課自助管理已完成。候選本機通過也不能代替正式 API／Web 部署、App 建置與真機驗收。
