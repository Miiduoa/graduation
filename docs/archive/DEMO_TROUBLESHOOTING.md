# 口試現場應變手冊

> 當 demo 在口試現場「卡住」時的處理清單。
> 配套：[DEMO_HOSTING_SCRIPT.md](./DEMO_HOSTING_SCRIPT.md)

---

## 場景 1：按鈕點下去沒反應

| 可能原因 | 處理 |
|---|---|
| Toast 出不來（不在 `<ToastProvider>` scope） | 重整頁面（Cmd+R） |
| 動態訊息沒寫入 | DevTools → Application → Local Storage → 看 `demoStore_v1` 是否有新增 |
| 角色不對 | 看右上 `DemoRolePill` 是否是預期角色 |

## 場景 2：切到老師端後訊息收件匣是空的

最常見：`/settings → 示範工具` 沒按 **「🌱 一鍵 seed 示範佇列」**。

**急救**：
1. 切到任何角色 → `/settings`
2. 左欄「🎬 示範工具」→ 按「🌱 一鍵 seed 示範佇列」
3. Toast「🌱 已產生 5 件示範事項」
4. 切到目標角色 → `/messages` → 自動停在 🔔 系統通知 tab

## 場景 3：切角色但訊息沒更新

`useDemoStore` 通常會即時 push，但偶爾 react 沒重渲染：
1. 點任一訊息再點 `✕` 關掉
2. 或重整頁面（不會丟資料）
3. 或切到別的 tab（💬 → 🔔 → 🔔）強制重 mount

## 場景 4：跨角色面板沒出現

對應檢查表：

| 訊息類型 | 必要 deep-link 欄位 | 哪個角色看到面板 |
|---|---|---|
| 請假申請 | `relatedLeaveId` | teacher / department_head |
| 宿舍報修 | `relatedDormRepairId` | admin |
| 訂單 | `relatedOrderId` | admin |
| 求助 | `relatedHelpId` | ta / teacher |
| 待審公告 | `relatedPendingAnnId` | department_head |
| 社員申請 | `relatedClubMembershipId` | club_officer |
| 作業繳交 | `relatedAssignmentId` | teacher / ta |

若不對：DevTools → Application → Local Storage → `demoStore_v1` → 搜尋訊息 id → 看 `relatedXxxId` 有沒有正確帶上。

## 場景 5：AI 助手回應太慢或卡住

預設 15 秒 timeout：超時走 fallback rules（**< 50ms 一定回應**）。
若 fallback 也沒動：
1. 看 Network panel — `/api/ai-chat` 是不是 500/404
2. 若是，重整頁面，再試一次
3. 終極：`/settings → 示範工具 → ♻️ 一鍵重置 demo 資料`，重 seed

## 場景 6：訪客 / 校友看不到該看的

預期行為：
- **訪客**：訊息頁顯示「請先登入」；課程列表只能瀏覽不能加入
- **校友**：訊息頁顯示「畢業生」提示，圖書館借閱已停用

若是錯誤地看到不該看的（隱私越權），請對委員說明這是預期外，並按 `DemoRolePill` 切回正確角色，然後示範權限隔離。

## 場景 7：DemoRolePill 不在頁面右上角

可能在 mobile dock 而不是 topbar。確認瀏覽器寬度 ≥ 1024px。否則切回桌面寬度模式。

## 場景 8：跨角色資料突然消失（很罕見）

通常是不小心按了「🧨 清空全部本機資料」。重 seed 一次即可：
1. `/settings → 示範工具`
2. 按「🌱 一鍵 seed 示範佇列」
3. 全部佇列 30 秒內重新建立

## 場景 9：頁面跳轉後迷路

- 右上 `DemoRolePill` 右側點頭像 / 校徽回首頁
- 或地址列直接打 `/today-v2`、`/messages`、`/ai-assistant`
- 訊息頁的「📚 前往課程」「📥 前往公告審核佇列」是 deep-link，會自動帶到對應角色的對應頁

---

## 萬一全爆掉的終極方案

1. 開新分頁
2. 直接 `http://localhost:3000/login`
3. 選任一角色登入
4. `/settings → 示範工具 → 🧨 清空全部本機資料`
5. 回 `/login` 重選身份
6. `/settings → 示範工具 → 🌱 一鍵 seed 示範佇列`
7. **30 秒內整套 demo 環境重建完畢**

---

> 編輯：2026-05-19
