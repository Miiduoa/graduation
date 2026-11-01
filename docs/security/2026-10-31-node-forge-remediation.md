# 2026-10-31 依賴安全修復驗證

基準：`933fbde7`；分支：`fix/node-forge-advisories`。本機使用 Node 22.23.4、pnpm 10.28.2。

## 修復方式

- `node-forge` override：1.4.0 → 1.4.2，涵蓋 Expo CLI 與 `@expo/code-signing-certificates`。1.4.1 修復本次五項 high 與 RSA DigestAlgorithm 驗證問題；1.4.2 另保留 PEM Buffer 輸入相容性。
- Metro 與其 13 個同版套件：0.83.3 → 0.83.8。override 僅匹配原本的 0.83.3，保持整組一致；間接依賴 `ob1` 0.83.3 → 0.83.8、`hermes-parser`／`hermes-estree` 0.32.0 → 0.35.0。Metro 使用的 `accepts` 1.3.8 → 2.0.0、`mime-types` 2.1.35 → 3.0.2；重新解析的 terser 子依賴 `acorn` 8.15.0 → 8.19.0（沿用鎖檔已有版本）。
- Metro 0.83.8 已由上游移除 `image-size` 與 `queue`，改用內建、有邊界檢查的圖片解析器。因此鎖檔完全移除 `image-size` 1.2.1，無須強制跨 major 替換。舊 Metro 的 `getAssetData` 仍可能傳入路徑，不能只因 Buffer 介面相容就直接替換成 image-size 2.x。
- 移除 acceptance 檔內全部六筆、原於 2026-10-31 到期的例外；沒有新增或延長例外。
- 安全 gate 腳本保持原樣。新增的相容性測試接入既有 CI 安全驗證步驟，涵蓋 Metro Buffer／檔案路徑／縮放資產，以及 Expo 憑證、PEM、CSR、RSA SHA-256 簽章往返；測試金鑰僅在記憶體臨時產生。

上游依據：[Forge 1.4.2 變更紀錄](https://github.com/digitalbazaar/forge/blob/v1.4.2/CHANGELOG.md)、[Metro 0.83.8 發行紀錄](https://github.com/react/metro/releases/tag/v0.83.8)、[Metro 圖片解析修復](https://github.com/react/metro/pull/1860)。

## 本機 audit

原始 JSON：[workspace-all](../verification/dependency-security-20261031/audit-all.json)、[workspace-prod](../verification/dependency-security-20261031/audit-prod.json)、[functions-prod](../verification/dependency-security-20261031/audit-functions.json)。

| 範圍／指令                                                               | critical | high | moderate | low | audit exit | gate |
| ------------------------------------------------------------------------ | -------: | ---: | -------: | --: | ---------: | ---- |
| workspace-all：`pnpm audit --json`                                       |        0 |    0 |       10 |   1 |          1 | 通過 |
| workspace-prod：`pnpm audit --prod --json`                               |        0 |    0 |        6 |   1 |          1 | 通過 |
| functions-prod：`npm audit --omit=dev --json --prefix backend/functions` |        0 |    0 |        6 |   0 |          1 | 通過 |

表中為 audit metadata 計數，與 gate 合併重複公告後的筆數不同。audit exit 1 來自仍存在的 moderate／low，並非零弱點；gate 接收實際 exit code 驗證報告，沒有忽略稽核錯誤。

以下八項公告均未再出現在升級後的全量與正式依賴 audit：

- node-forge：GHSA-7wch-p9px-956x、GHSA-jc66-7q78-782g、GHSA-8hrf-8g6f-7xwp、GHSA-hqq3-7jhf-c5jx、GHSA-5x38-2vff-x55p、GHSA-86w9-cpqp-85rv。
- image-size：GHSA-5p2g-fcmc-qvqq、GHSA-w3rx-r6r6-pgpr。

全量剩餘公告為 uuid、@opentelemetry/core、@hono/node-server、minimatch、glob 的 moderate，以及 deepmerge 的 low；保留可見，未擴大本次修復範圍。

## 建置與測試

| 驗證                                        | 結果                                                       |
| ------------------------------------------- | ---------------------------------------------------------- |
| `pnpm install --frozen-lockfile`（Node 22） | 通過                                                       |
| `pnpm typecheck`（mobile、web、shared）     | 通過                                                       |
| `pnpm --filter web build`                   | 通過；Next 正式建置與靜態頁面產生完成                      |
| iOS／Android `expo export`                  | 兩平台均通過；各 2,298 模組，成功產生 Hermes bundle 與資產 |
| Mobile 全套測試                             | 376 個檔案通過、1 個略過；4,313 項通過、1 項略過           |
| Web 全套測試                                | 394 個檔案通過、5 個略過；5,215 項通過、29 項略過          |
| 安全 gate、依賴相容性與 CI 工作流程測試     | 33／33 通過（含 2 項新增相容性測試）                       |
| Mobile lint                                 | 0 error、559 個既有 warning                                |
| Web lint                                    | 0 error、234 個既有 warning                                |
| 新增測試 lint 與 JSON／測試格式檢查         | 通過                                                       |

Web 初次全套執行為 5,214 項通過、1 項失敗：登入限流測試預期沒有 `FIREBASE_SERVICE_ACCOUNT_JSON`，但本機繼承了該環境變數。以 `env -u FIREBASE_SERVICE_ACCOUNT_JSON pnpm --filter web test` 移除該變數後，全套通過；未讀取其內容，也未修改登入程式或既有測試。

Web 建置僅指定假的公開 Firebase 設定（`demo-campus-security`），沒有設定 `ONLINE_ORDERING_ENABLED` 或 `NEXT_PUBLIC_FUNCTIONS_BASE_URL`。Mobile 匯出使用 `APP_ENV=development EXPO_PUBLIC_APP_ENV=development EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null`，停用環境檔載入。未讀取 `.env` 或既有金鑰；未啟動遠端服務、原生簽署建置或部署。

重現安全驗證：

```sh
node --test scripts/dependency-security-gate.test.cjs scripts/dependency-security-compatibility.test.mjs scripts/firebase-ci-workflow.test.cjs
node scripts/dependency-security-gate.cjs --report docs/verification/dependency-security-20261031/audit-all.json --format pnpm-legacy --scope workspace-all --audit-exit-code 1
node scripts/dependency-security-gate.cjs --report docs/verification/dependency-security-20261031/audit-prod.json --format pnpm-legacy --scope workspace-prod --audit-exit-code 1
node scripts/dependency-security-gate.cjs --report docs/verification/dependency-security-20261031/audit-functions.json --format npm --scope functions-prod --audit-exit-code 1
```
