# 待辦完整清單與首頁精簡模式的恢復相容

本批整合 #672 的 task-first 入口與 #682 的已過時段重新安排功能，保留 #683 修正後的職涯能力表。它修正一個實際重現的 P2 整合回歸，不新增資料來源、寫入權限或自動執行。

## 精確依賴

- main：`fd7b2b87ae4368418b61839138d66435d44c2cb5`。
- #631：`0c60b2333f9e8e01e0cf18460b698d7e568b9a97`。
- #683：`803dd302c40ea2b5ae20aa8ab2663a20c3624eb2`。
- #672：`f3d1f28f4f973becabba0275dafb95da972733f2`。
- #682：`1082661bb2c46ad0412c8b5528514cf519b4bf03`。
- #683 與 #672 合併為 `4646888b09e2d92dddc187f42558e2d9905355bc`，沒有衝突；再與 #682 合併為 `37c4688d93513fc2f75d709a6ff2ea07ed57999c`，唯一衝突是 `TodayAgentPanel.tsx`。

## 實際缺口與修正

#672 把 taskList 移至可共用的區塊；若合併時只保留裸 `TrackedArrangement`，就沒有 #682 的 `onRecover` 與 blocked 狀態。非 compact 的完整清單因此找不到「重新找 30 分鐘」按鈕。重新執行原測試可得到 2 failed／46 passed，失敗項目是 explicit elapsed preview 與 latest elapsed parent。

衝突解析讓這個區塊也呼叫既有 `arrangement(row)`。它沿用來源是否可恢復、原 mutation identity、是否正在執行或有未知結果的條件；只提出新的預覽，仍須另行確認才會寫入。

目前唯一正式首頁使用點傳入 compact，會把已安排項目放入最近安排。因此這不是已觀測到的正式首頁精簡模式故障。新增兩項 compact 回歸用於確認：原歷史只出現一次、明確重新預覽傳遞原 mutation identity、未知結果先核對且不能重新寫入。

## 已有驗證

- 修補加 #672：Web 135 tests、共享 79 tests、Web/shared typecheck 通過。
- 再加 #682 並解析衝突：Web 199 tests、共享 79 tests、Web/shared typecheck 與相關 ESLint 通過。
- 未參與此修補的 reviewer 另跑 TodayAgent 與 Panel 共 106 tests，未發現 blocker；核對原取消、重複確認、未知結果與登入／帳號／校園切換行為仍在。
- 本批完整聚合、browser 與精確 head CI 的最後結果列在 PR 描述。上述原始 logs 與未發布的中間整合紀錄不當作公開證據附件。

保持 Draft。所有相依 PR 分支與 #682 已成功的 head 保持不變；不合併、不部署、不繞過 App 5504170 或其他 gate，不操作正式帳號或資料。
