# 校園店家員工 ↔ 店家綁定設計（2026-05-15）

> 「校園店家的員工登入後，是否要對應到該餐廳並且管理」— 這是個值得仔細設計的多租戶問題。

## 1. 三種角色模型

每個 vendor 員工帳號可被分配一個或多個店家身分：

| 角色 | 標籤 | 權限 |
|------|------|------|
| **owner** | 老闆 | 改菜單 ✅ / 管員工 ✅ / 看完整報表 ✅ / 處理訂單 ✅ |
| **manager** | 店長 | 改菜單 ✅ / 看報表 ✅ / 處理訂單 ✅ / 管員工 ❌ |
| **staff** | 工讀生 | 只能處理訂單 ✅ / 其他 ❌ |

定義在 `apps/mobile/src/data/demoMerchants.ts` 的 `MERCHANT_ROLES`。

## 2. 多店派駐

一個 vendor 帳號可在多家店兼差：
- `auth.profile.merchantAssignments: MerchantAssignment[]`
- 每個 assignment：`{ merchantId, role, status: 'active' | 'inactive' }`
- 員工進 APP 後預設使用 active assignments 的第一家
- ≥ 2 家 → UI 頂端顯示 **MerchantSwitcher**（橫排 chip 切換）

## 3. demo 設計

| Demo 帳號 | 派駐 |
|----------|------|
| `demo_cafeteria` | 中餐部（店長 manager）、咖啡屋（工讀生 staff）|
| 未來 `demo_coffee_owner` | 咖啡屋（老闆 owner）|

`DEMO_FALLBACK_ASSIGNMENTS` 在 `useMerchantContext` 內。

## 4. 三家 demo 店家

```typescript
DEMO_MERCHANTS = [
  { id: 'merchant_cafe_a',   name: '靜宜中餐部',    emoji: '🍱', location: '主顧樓 B1', staff: 8 },
  { id: 'merchant_coffee_b', name: '校園咖啡屋',    emoji: '☕', location: '圖書館 1F',  staff: 4 },
  { id: 'merchant_store_c',  name: '24h 便利商店',  emoji: '🛒', location: '宿舍區',     staff: 12 },
];
```

每家店有自己的訂單列表 + 熱門品項：
- `DEMO_MERCHANT_ORDERS[]` 過濾 by merchantId
- `DEMO_MERCHANT_POPULAR[]` 過濾 by merchantId

## 5. 資料流

```
LoginLanding 選「阿英（demo 餐廳）」
   ↓
auth.profile.merchantAssignments 填入 DEMO_FALLBACK_ASSIGNMENTS['demo_cafeteria']
   ↓
RoleAwareTodayScreen → resolveDashboardRole = 'vendor' → VendorDashboardScreen
   ↓
useMerchantContext()
   - 讀 active assignments
   - 從 AsyncStorage 讀上次選的 merchantId（per-uid scoped）
   - 預設第一個 active
   ↓
畫面渲染
   - Hero：顯示「阿英 · 店長 / 靜宜中餐部」
   - MetricRow：該 merchant 的 pending / processing / ready
   - 訂單佇列：filter by merchantId
   - 熱門品項：filter by merchantId（只有 manager+ 看得到）
   - ToolChips：依 role 顯示
     · canEditMenu → 顯示「管理菜單」
     · canManageStaff → 顯示「員工管理」
     · canViewReports → 顯示「月度報表」
```

## 6. 為什麼這樣設計

| 議題 | 設計選擇 | 理由 |
|------|---------|------|
| 多店切換 | per-uid AsyncStorage 記憶上次選擇 | 避免每次重開 APP 都要重選 |
| 員工 vs 老闆 | 同一個 dashboard 但 ToolChip 依 role 顯示 | 一個 UI 樣板，不用維護兩套 |
| 多重派駐 | 切換器 vs 多店合併 dashboard | 切換器較單純；員工通常只關注當下店家 |
| 老闆看員工 | canManageStaff 才能進員工管理頁 | 安全：避免工讀生看到同事薪資 |

## 7. 擴充方向（未來）

- **校園店家管理後台**：admin 可看到所有店家、批准 / 停權店家、看跨店分析
- **POS 整合**：把訂單佇列同步到實體 POS 機
- **學生 loyalty 點數**：員工掃學生條碼累積點數
- **進貨 / 庫存**：再加一層 inventory 資料模型
- **多人同時操作**：用 Firestore real-time listener，員工 A 標記訂單 ready，員工 B 螢幕立刻更新

## 8. 對應檔案

```
apps/mobile/src/data/demoMerchants.ts        (新) 3 家 demo 店 + 訂單 + 熱門
apps/mobile/src/hooks/useMerchantContext.ts  (新) 員工 ↔ 店家解析 hook
apps/mobile/src/screens/VendorDashboardScreen.tsx  (改) 依 merchant + role 渲染
docs/MERCHANT_BINDING_DESIGN_2026_05_15.md   (本文)
```

## 9. 測試

- TS 0 錯誤
- 全套 907/908（pre-existing date-test 與本輪無關）
- 手動驗證：demo_cafeteria 登入 → 看到中餐部頂端有 switcher → 點咖啡屋切換 → 訂單列表變動
