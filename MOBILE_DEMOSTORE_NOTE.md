# Mobile demoStore 整合 — 口試後再做的備忘

## 現況

- **Web (apps/web)**：用 `demoStore.ts` + `localStorage` 實現 8 角色跨頁資料同步。同瀏覽器分頁即時生效（`storage` event + custom `demoStoreChange` event）。
- **Mobile (apps/mobile)**：用 react-native，動作目前用 `Alert` 與 component-local state 顯示回饋，**沒有與 web 共享狀態**。

## 為什麼口試前不做整合

1. **平台隔離**：iOS / Android 的 AsyncStorage ↔ 瀏覽器 localStorage 是不同 storage，無法直接共享。
2. **跨平台同步必須走後端**：需要：
   - Supabase / Firestore 表 schema for `dynamicMessages`, `leaveRequests`, etc.（已有 `apps/web/src/lib/supabaseClient.ts` 雛形但未啟用）
   - Realtime subscription（Supabase Realtime / Firestore snapshot listener）
   - Mobile 端 expo-secure-store 存登入 token 並做訂閱
3. **時間成本**：估計 6–10 小時，與口試剩餘時間衝突。風險：未測試完整就上場。
4. **demo 主場**：教授會以 web 為主。Mobile 作為「技術延伸性」展示，現有 Alert 已足夠呈現操作流暢度。

## 口試現場若委員問到 mobile 共享狀態

**標準回答**：
> 「Mobile 與 Web 共用同一份 demoStore 的設計已在 `apps/web/src/lib/demoStore.ts` 完成
> （所有 helper 都是純 function 形式，方便抽到共用 package）。跨平台同步的實作路徑有兩條：
>
> 1. **Supabase Realtime**：把 `dynamicMessages`、`leaveRequests` 等 store fields
>    轉為 Postgres tables（schema 已在 supabase/ 規劃），mobile 用 `@supabase/supabase-js`
>    的 `channel().on('postgres_changes')` 訂閱即時更新。
>
> 2. **Firestore Listener**：用 `onSnapshot` 訂閱對應 collection。
>
> 兩條路都不需要改變現有 UI 層的呼叫方式，因為 `demoStore.ts` 已抽象為
> `useDemoStore()` hook。本次口試版本聚焦在 web 端確保跨角色資料流真實打通，
> Mobile 整合在規劃路線圖（Roadmap）裡。」

## 若還是想做：最小可行路徑（口試後）

1. 把 `apps/web/src/lib/demoStore.ts` 內所有 store helpers 抽到 `packages/shared/src/demoStore/`。
2. Web 端 useDemoStore() 改用 `@campus/shared/demoStore/web`（包 localStorage）。
3. Mobile 端寫 `packages/shared/src/demoStore/mobile`（包 AsyncStorage + 跨進程同步用 `MMKV` 或 `react-native-async-storage`）。
4. **若需要 web ↔ mobile 即時同步**：加 Supabase Realtime layer，兩端訂閱同一份 schema。
5. UI 層完全不變。

預估：抽 package 2h、Supabase schema 1h、Realtime 訂閱 2h、測試 1h ＝ 6h。
