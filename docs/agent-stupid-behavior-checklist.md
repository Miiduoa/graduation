# Agent「白痴行為」回歸清單（範本）

請用**你可重現的一句話**填寫；每累積幾筆就對照一次 `agentRuns` 與單元測試，再決定改規則或改 prompt。

## 欄位說明

| 欄位 | 說明 |
|------|------|
| 路由 | `askCampusAssistant`（雲端預設）／`AIChatScreen` 本機規則／`ai-server` Python |
| 預期 intent | 你認為應該的 `classifyIntent().name`（雲端） |
| 實際 intent | 從 `agentRuns.intent` 或 Debug envelope |
| Write plan | [`intentWritePlan.js`](../backend/functions/agent/intentWritePlan.js) 是否命中、`toolName` |
| toolCalls 摘要 | `steps`／`toolCalls` 內 `tool`／`name`、`input`／`args` 是否異常、`success` |
| 卡片問題 | 太長、太官腔、缺主 CTA、該有 App 動作卻沒有 |
| 修法標籤 | `rule`（關鍵字／guard）／`few-shot`／`產品缺口` |

## 待你替換成真實案例（範例行）

| # | 使用者原句 | 路由 | 預期 intent | 實際 intent | Write plan | toolCalls 摘要 | 卡片問題 | 修法標籤 |
|---|-------------|------|--------------|-------------|------------|----------------|----------|----------|
| 1 | 幫我推薦今天午餐 | askCampusAssistant | `menus` | （填） | （填） | （填） | 只推飲料炸物、沒主食 | （填） |
| 2 | 我頭有點痛 | askCampusAssistant | `general` 或衛教 | （填） | null | （填） | 一大段 disclaimer、無 App 動作 | 產品缺口／few-shot |
| 3 | 幫我提醒明天早上八點繳作業 | askCampusAssistant | （若無提醒 tool 則標缺口） | （填） | null | （填） | 推外部鬧鐘 app | 產品缺口／rule |
| 4 | 冷氣怪怪的 A 棟 302 | askCampusAssistant | `submit_repair_request` | （填） | `createDormRepairRequest` | （填） | （填） | rule |
| 5 | 房間好熱 冷氣好像壞了 | askCampusAssistant | `submit_repair_request` | （填） | （填） | （填） | （填） | rule |
| 6 | 幫我查一下剛剛報修的進度 | askCampusAssistant | `check_repair_status` | （填） | null | `listMyDormRepairs` 等 | （填） | rule |
| 7 | 幫我訂午餐雞排飯 | askCampusAssistant | `food_order` | （填） | `createOrder` | （填） | （填） | rule／資料 |
| 8 | 午餐想吃清淡有推薦嗎 | askCampusAssistant | `menus` | （填） | null | （填） | （填） | few-shot |
| 9 | （補一句你實際氣到的話） | | | | | | | |
| 10 | （補一句你實際氣到的話） | | | | | | | |

## 到哪裡查資料

- App：**登入後除錯畫面**會列出最近多筆 `users/{uid}/agentRuns`（見 `PostLoginDebugScreen`），並顯示粗統計。
- 雲端：`Firestore` → `users` → `{uid}` → `agentRuns`。
- 靜態分析指引：[`docs/agentruns-sampling.md`](./agentruns-sampling.md)。
