# 口試 Demo 主持手冊

> 對象：畢業口試委員
> 平台：Web（apps/web，Next.js 14 + Turbopack）
> 主軸：**8 種角色 + 跨角色動作 → 真實資料變化**
> 時間：建議主軸 8–10 分鐘，再留 5 分鐘給委員自由操作

---

## 1. 開場前準備（口試前 5 分鐘）

1. 確認 dev server 已啟動（`pnpm --filter web dev`）。
2. 開瀏覽器到 `http://localhost:3000`（或部署網址）。
3. **登入畫面選「學生 demo」**，進入後到 `/settings` → 左欄「示範工具」。
4. 按一下 **「♻️ 一鍵重置 demo 資料」**，再按 **「🌱 一鍵 seed 示範佇列」**。
   - 這會幫王小明同時送出：請假、宿舍報修、訂餐、求助、繳交作業
   - 之後切到老師 / TA / admin / 系主任，他們的訊息收件匣立刻就有東西可以演示
5. 按下右上角 `DemoRolePill`，先切回 **學生**，把鏡頭停在 `/today-v2`。

---

## 2. 主流程（依角色順序，邊講邊操作）

### 場景 1：學生 — 早晨 Today 頁（90 秒）

**畫面：`/today-v2`**

開場白：「這是 8 種角色共用的學生主頁。AI 已幫王小明整理今天 3 堂課、2 份作業。」

操作：
- 點「🧭 導航」→ 切到 `/map`（**展示頁面跳轉**）。瀏覽器返回。
- 點「📥 加入行事曆」→ 按鈕變綠「✅ 已加入行事曆」（**展示本地狀態變化**）。
- 點「中午選擇 · 3 個建議」的「主餐廳 ★」→ 卡片顯示「✓ 主餐廳 ★」（**展示選取狀態**）。
- 拉到下方「請假草稿」→ 點「提交給授課老師 →」（**這是跨角色關鍵動作**）。
  - Toast 出現「請假已送出，資料庫系統 老師已收到通知」。

**講解重點**：「這份請假申請已寫入 demoStore，等下切到老師身份，**訊息收件匣會看到它，而且可以直接核准**。」

---

### 場景 2：學生 — AI 助理（60 秒）

**畫面：`/ai-assistant`**

操作：
- 問：「我這週要交什麼作業？」
  - AI 列出 4–5 件 pending 作業，**讀的是真實 STUDENT_ASSIGNMENTS + dynamicAssignments**。
- 問：「我今天上什麼課？」
  - AI 列出週一所有課程（讀 DEMO_STUDENTS[0].enrolledCourses 過濾 DEMO_COURSES）。
- 問：「我的成績？」
  - AI 列出本學期 c1 的作業 95 / 期中 96 / 期末 97（讀 DEMO_STUDENTS[0].scores）。

**講解重點**：「AI 回應不是 hardcode，是真的讀本人學籍資料生成的。」

---

### 場景 3：教師 — 處理請假與作業（90 秒）

操作：
- 右上 DemoRolePill 切到 **教師**。
- 進 `/messages`。
- 看到剛剛 seed 進來的「【請假申請】王小明：2026-05-21 ~ 2026-05-21」訊息。
- 點開訊息 → 「📅 請假審核」面板出現「✅ 核准請假 / ❌ 退回」。
- 按 **✅ 核准請假** → Toast「已核准請假，學生會收到通知」。

接著：
- 在訊息列表選「【作業繳交】王小明 已繳交：期末專題提案」。
- 看到「📝 作業批改入口」→ 點「前往成績簿批改 →」。
- 跳到 `/teacher/course/c1/gradebook` → **看到王小明（stu-001）這列有未批改記號**。

**講解重點**：
- 「學生剛剛的請假已收到，且**老師不必離開訊息頁就能審核**。」
- 「繳交作業也直接 deep-link 到成績簿；同學的 uid 是 stu-001，與班級資料表是同一個 join key。」

---

### 場景 4：TA — 快速回覆求助（45 秒）

操作：
- 切到 **TA**（林助教）。
- `/messages` → 點「【求助】鏈結串列遞迴實作卡關…」。
- 「🙋 求助快速回覆」面板出現 textarea。
- 輸入：「下週二 14:00 在工程館 308 答疑，請帶程式碼來討論」。
- 送出 → Toast「已回覆，學生會收到通知」。

**講解重點**：「TA 在訊息頁就能回覆，**store.helpRequests 狀態變成 replied，學生那邊收到回覆訊息**。」

---

### 場景 5：Admin — 處理報修與訂單（60 秒）

操作：
- 切到 **管理員**。
- `/messages` → 看到兩則 action 訊息：「【宿舍報修】靜園男舍 305」與「【新訂單】校園小棧 2 項」。
- 點報修 → 「🔧 報修派工」面板 → 按「🔧 派工中」 → Toast。
- 再點 → 按「✅ 完工」（**或留給學生 demo 時切回去看通知**）。
- 點訂單 → 「🍱 訂單推進」面板 → 按「🛎️ 已備好」 → Toast。

**講解重點**：「admin 就像 vendor 後台，**狀態變更會即時通知學生**，這是訊息系統承擔的多角色協調。」

---

### 場景 6：系主任 — 公告審核（45 秒）

操作：
- 切到 **教師**（如果剛從 admin 過來）。
- 進 `/announcements` → 右上「+ 新增公告」 → 寫一則簡短公告 → 送出待審核。
- 切到 **系主任**。
- `/messages` → 找到「【待審核公告】xxx」訊息。
- 「📣 公告審核」面板 → 按 **✅ 核准發布** → Toast「已核准，全校學生會收到通知」。

切回學生：
- `/messages` → 看到「【新公告】xxx」通知。
- 點開能看到原文。

**講解重點**：「公告經過教師→系主任→學生三角，**整個審核流就在訊息系統裡完成**。」

---

### 場景 7：學生回看 — 看到 5 個流程的回覆（30 秒）

切回 **學生** → `/messages`：

預期會看到：
- 「【請假結果】✅ 已核准」
- 「【報修狀態】已派工」/「已修復」
- 「【訂單狀態】🛎️ 已備好可取餐」
- 「【回覆】鏈結串列遞迴…」（TA 回的）
- 「【新公告】xxx」

**收尾**：「整個 demo 從學生送出 → 三個不同角色處理 → 學生收到結果，全部在同一個瀏覽器分頁裡發生，靠的是 demoStore（localStorage）+ recipientRoles 路由。8 種角色看到的訊息與動作面板會依身份自動切換。」

---

## 3. 預期口試委員會問的問題

### Q1：「資料真的有寫進去嗎？怎麼證明？」
**答**：開 DevTools → Application → Local Storage → `demoStore_v1`。
顯示 JSON 包含 `dynamicMessages`、`leaveRequests`、`dormRepairs`、`orders` 等陣列，每筆都帶 timestamp / senderRole / recipientRoles 路由標記。

### Q2：「為什麼用 localStorage 而不是真資料庫？」
**答**：本專案 demo 模式刻意走 localStorage，是為了讓「離線、無後端依賴的口試現場」也能呈現完整跨角色資料流。**正式環境的對應實作在 `apps/web/src/lib/firebase.ts`（Firestore）與 `apps/web/src/lib/supabaseClient.ts`（Supabase）裡都已備好，未來只要把 demoStore 的 helpers 換成相同簽名的 firestore writes 就能直接上線。**

### Q3：「8 種角色權限是怎麼判斷的？」
**答**：`apps/web/src/lib/demoRole.ts:226-364` 有完整的 `CAPS` 表，每個角色有 19 個 boolean 權限（canApproveAnnouncements, canManageSystem, canPublishGrades …），UI 元件用 `getCapabilities(role)` 查表決定要不要顯示按鈕。

### Q4：「為什麼學生 uid 既是 demo-student-1 又是 stu-001？」
**答**：本次最終 hardening 已**統一為 stu-001**（`DEMO_USERS[0].uid` 與 `DEMO_STUDENTS[0].uid` 是同一個 join key）。修改前是雙軌制會導致老師 gradebook join 不到學生的請假紀錄，現在已修正。

### Q5：「mobile 端呢？」
**答**：mobile 端（Expo / React Native）目前已完成 9 個關鍵互動的接線（TodayAiFirstScreen、Health、Studybuddy 等），demoStore 的跨平台共享是後續迭代規劃，本次口試展示以 web 為主。

### Q6：「AI 助手是真的 AI 嗎？」
**答**：兩段式設計。先嘗試呼叫 `/api/ai-chat`（接 Anthropic / Groq / 自架 LLM），若 env 未配置或 timeout 就走 **fallback rule-based**，後者**會讀 demoStore + DEMO_STUDENTS 即時資料生成回答**（不是純 hardcode）。可以開 Network panel 看 `/api/ai-chat` 的請求。

---

## 4. 現場意外處理

| 狀況 | 緊急處理 |
|---|---|
| 跨角色面板按下沒反應 | 重整頁面（Cmd+R）— localStorage 不會丟。如還是有問題：回 `/settings → 示範工具 → 一鍵重置`，再重 seed。 |
| 切角色後訊息列表沒更新 | 點任一訊息再點 `✕` 關掉，或重整。`useDemoStore` 訂閱 storage event，正常不會發生。 |
| AI 助手回答超慢 | fetch `/api/ai-chat` 15 秒 timeout 後會走 fallback；fallback 是同步函數，**< 50ms 一定有回應**。若超過代表瀏覽器 hung，請重整。 |
| 全校公告沒出現 | 公告核准後需重整 `/announcements` 頁；訊息頁則會即時 push 給學生。 |
| 不小心按到「清空全部本機資料」 | 它會把人踢回 `/login`，重新選身份即可，**所有 demo 資料都是無狀態可重建**。 |

---

## 5. 系統技術摘要（給最後 30 秒總結用）

> 「整個系統使用 Next.js 14 + React 19 + TypeScript 5。8 種角色由 `demoRole` 切換，所有跨角色動作走統一的 `demoStore`（localStorage 持久化 + window event 即時通知），共 **32 條動作鏈**全部端到端打通。生產環境的對應實作（Firestore / Supabase）已備好替換介面。Production build 0 錯誤、44 頁全部產生。」

完。

---

> 編輯：2026-05-18
> 對照清單：`角色資料畫面對照矩陣_v3.xlsx`、`口試交付包_README_v3.md`
