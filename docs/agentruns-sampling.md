# agentRuns 小型日誌分析

用來決定下一輪改 **規則（guard）** 還是 **prompt／few-shot**。

## 1. 從 App 粗看

登入後開啟 Post-login 除錯畫面中的 **Firestore agentRuns** 區塊：會載入最近多筆 run，並顯示本機計算的 **tool 失敗／錯誤訊息筆數**（掃描 `steps`／`toolCalls` 的 `output`）。

## 2. 從 Firebase Console 抽樣

1. Firestore → `users` → 選你的測試帳號 `uid` → `agentRuns`。
2. 依 `updatedAt` 新到舊開啟 20～50 筆。
3. 記錄欄位：`intent`、`status`、`finalAnswer`（或主文）、`toolCalls` 每一格的 `tool`／`name`、`input`／`args`、`output` 是否含 `success: false` 或 `error`。

## 3. 分類修法

| 觀察 | 優先修法 |
|------|----------|
| 同一 tool 大量 `success: false` | 查該 tool 實作與 Firestore 資料；再調參數解析（`resolve*`） |
| `description`／`args` 出現超長無關文字 | 上游訊息 sanitize、或 tool-call 後處理截斷；必要時 few-shot |
| intent 對但常落到 `general` | 擴充 [`classifyIntent.js`](../backend/functions/agent/classifyIntent.js)／[`assistantFormat.js`](../backend/functions/lib/assistantFormat.js) 關鍵規則並加測試 |
| `menus` vs `food_order` 邊界錯 | 調 [`mapRichCategoryToAssistantIntent`](../backend/functions/agent/classifyIntent.js) `food` 分支 + `classifyIntent.test.js` |

## 4. 進階（需 Service Account）

若要在本機跑批次統計，可用 `firebase-admin` 寫小腳本掃 `agentRuns`（勿把金鑰提交進 repo）。範例查詢概念：

- `collectionGroup('agentRuns')`（若已建立索引）或固定測試帳 `users/{uid}/agentRuns`。
- 聚合：依 `tool` 名稱計數 `output.success === false` 或 `output.error` 存在。
