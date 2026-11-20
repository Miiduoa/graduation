# 角色感知首頁系統（2026-05-15）

> 使用者點擊任一 demo 角色後，今日（Today）tab 進去看到完全不同的畫面。

## 1. 5 個角色 → 5 個 cockpit

| 角色 | uid prefix | Today 入口 | 看到什麼 |
|------|-----------|-----------|---------|
| 學生 | `demo_student_*` | `TodayCockpitScreen` | 今日待辦 / 番茄鐘 / 5 門課預估 / 來自老師 inbox / 錯題本 |
| 老師 | `demo_teacher_*` | `TeacherCockpitScreen` | 紅旗學生 / 各 HW 缺繳率 / AI 評語 / Bulk reminder |
| 助教 (TA) | `demo_ta_*` | `TADashboardScreen`（新） | 老師指派的批改 / 學生提問待回覆 / 需聯繫的缺席學生 |
| 系所主任 | `demo_admin_*` | `DepartmentDashboardScreen`（新） | 風險課程 / 全系課程一覽 / 老師工作負載 / 教學評鑑入口 |
| 餐廳 | `demo_cafeteria` | `VendorDashboardScreen`（新） | 訂單佇列 / 製作中 / 待取 / 今日營收 / 熱門品項 / Loyalty 推播 |

## 2. dispatcher 設計

`RoleAwareTodayScreen.tsx` 三層 fallback：
1. **uid prefix**：demo 帳號用 `demo_teacher_*` / `demo_admin_*` 等直接 match
2. **roleGroup**：admin/department_head → department；teacher → teacher
3. **role 細分**：vendor/cafeteria/service → vendor；ta/assistant → ta；professor/teacher → teacher
4. **fallback** → student

純函式 `resolveDashboardRole()` 可獨立測試 → 16 條 unit test 全綠。

## 3. HomeStack 改造

```diff
- name="TodayHome" component={SmartDashboardScreen}
+ name="TodayHome" component={RoleAwareTodayScreen}
+ name="SmartDashboard" component={SmartDashboardScreen}  // 保留，給學生需要時跳轉
```

## 4. 每個 dashboard 的「不同感」

### 學生 (TodayCockpit) — 藍色
- Hero「午安，要開始今天了嗎？」
- 番茄鐘排程 + 待辦優先序
- 來自老師 inbox（roleEventBus 整合）

### 老師 (TeacherCockpit) — 天藍
- Hero「今天教學一覽」+ 待批改 / 缺繳總人次 / 紅旗
- 課程切換 + tone 選擇器（嚴格 / 中性 / 鼓勵）
- AI 起草評語 + Bulk reminder

### TA (TADashboardScreen) — 紫色
- Hero「今日協助任務」+ 待批改 / 待回覆 / 需聯繫
- 批改任務列表（含每課缺繳份數）
- 學生提問待回覆討論串
- 缺席學生需聯繫

### 系所主任 (DepartmentDashboard) — 綠色
- Hero「本系今日概況」+ 風險課程 / 待批改 / 平均出席
- 風險課程紅旗（班級平均 < 70）
- 全系課程一覽（含老師、待批改、出席率、預估）
- 老師工作負載排序（高負載警示）
- 動作：教學評鑑報告 / 發布系所公告 / 學生 risk 列表

### 餐廳 (VendorDashboard) — 橙色
- Hero「今日營運」+ 新訂單 / 製作中 / 待取 / 營收
- 訂單佇列（pending → processing → ready → completed 推進）
- 本週熱門品項
- 動作：管理菜單 / Loyalty 推播 / 本月報表

## 5. 測試成果

- 新增 `resolveDashboardRole.test.ts` 16 條測試全綠
- 全套 882/883 通過（1 pre-existing date test 與本輪無關）
- TS 編譯 0 錯誤

## 6. 角色聯動（已串接）

老師駕駛艙觸發 `emitFeedbackDrafted` / `emitBulkReminder` →
RoleEventBus 廣播 → 學生 TodayCockpit「📥 來自老師」card 立刻看到。

## 7. demo 流程 v3（含角色切換）

| 秒 | 動作 | 重點 |
|----|------|------|
| 0:00 | 開 APP → LoginLanding 選「張怡君老師」 | 角色 1 |
| 0:30 | Today tab 自動顯示 TeacherCockpit（天藍色 Hero） | 老師感覺 |
| 1:00 | 點「📣 提醒 N 人」 → 全部發送 | emit event |
| 1:30 | Me tab → 登出 → 重選「顧晉瑋學生」 | 切角色 |
| 2:00 | Today tab 自動顯示 TodayCockpit（藍色 Hero） | 學生感覺 |
| 2:15 | 「📥 來自老師」card 看到剛才老師發的提醒 | 跨角色聯動 |
| 3:00 | 登出 → 選「黃主任」 | 角色 3 |
| 3:15 | Today 顯示 DepartmentDashboard（綠色 Hero）+ 系所紅旗 | 主任感覺 |
| 3:45 | 登出 → 選「阿英餐廳」 | 角色 4 |
| 4:00 | Today 顯示 VendorDashboard（橙色 Hero）+ 訂單佇列 | 餐廳感覺 |
| 4:30 | 點訂單「開始備餐」→「完成 → 待取」→「已交付」 | 訂單流程 |

5 角色 5 個完全不同的入口，連色彩主色都不同，毫無重疊。

## 8. 仍可深化

- 每個 cockpit 都接 roleEventBus 即時更新
- 教師 / 助教 / 主任 也加「📥 來自學生」inbox
- 餐廳串到實際 puDiningCatalog 資料
