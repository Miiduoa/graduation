# Demo 前體檢診斷清單

> 對象：畢業口試委員  
> 時間壓力：這幾天 / 一週內  
> 範圍：apps/web（24 個頁面、~6,500 行）  
> 工作原則：先看清單、確認要修哪幾項，再動手

---

## A. demo 當場一定會被發現（必修）

| # | 位置 | 問題 | 影響 | 建議 |
|---|---|---|---|---|
| A1 | `app/groups/page.tsx:158-200` | 課程／社團列表每一列有 `cursor: pointer`，但既沒 `onClick` 也沒 `<Link>` 包起來 | 「首頁 → 課程 → 課程詳情」這條主線**整個斷掉**，口試委員第一個會點 | 把 `<div className="insetGroupRow">` 改成 `<Link href={\`/course/${g.id}${q}\`}>` |
| A2 | `app/settings/page.tsx:474` | 「登出」按鈕 `onClick={() => {}}` 真的是空函式 | demo 結束想登出回到登入畫面 → 不會動 | 改成呼叫 `signOut(getAuth())` 後 `router.replace('/login')` |
| A3 | `app/groups` ↔ `app/timetable` ↔ `app/grades` 三邊 ID 完全不一致 | groups 用 `'1','2'…`、timetable 用 `'c1','c2'…`、grades 用 `g.id`（另一套） | 「從課表點進這門課」「成績對應到哪門課」**通通對不起來**，是 demo 故事的死穴 | 統一成同一套 id（建議用 `c1~c8`），讓三邊資料能互通 |
| A4 | 沒有「以教師身份檢視」的自然入口 | 教師端 `/teacher/course/[courseId]` 有 role 檢查（owner / instructor / moderator），但學生端沒人會引導你進去；要看教師功能只能手動改網址 | 口試委員要看「教師怎麼點名 / 出題」時，你得當場改 URL，很尷尬 | 在 `app/course/[courseId]/page.tsx` 加一顆「以教師身份檢視」按鈕（已經有一條 `Link href` 在 134 行，但要確保 demo 帳號真的有教師 role） |
| A5 | `app/announcements/page.tsx:299` 公告列表只能展開/收合 | 沒有公告詳情頁，點公告 → 原地展開、結束 | 委員問「然後呢？」答不出來 | 兩條路：(1) 做極簡 `/announcements/[id]` 詳情頁；或 (2) 把展開後加上「相關行動」（如連到課程、加入行事曆） |

---

## B. 角色流程斷點（demo 故事線會卡住）

### B.1 學生流程
```
登入 ✓
  → 首頁 Today ✓（資料 OK）
    → 點「進入課程」進 groups ✓
      → 點某個課程 ✗  ← A1 斷點
        → course/[courseId] 詳情 ⚠️ Firestore 沒資料時整頁空殼
    → 課表 ✓
      → 點課表上某堂課 → 進 course 詳情？ 目前**沒做這個跳轉**
    → 成績 ✓ 但課程 id 跟課表對不上（A3）
    → 設定 → 登出 ✗  ← A2 斷點
```

### B.2 教師流程
```
登入 → ???（沒入口，A4）
  → /teacher/course/[courseId]
    → 點名 ✓（有開關 + QR 動畫）
    → 成績冊 ✓
    → 教材管理 ✓
    → 測驗 ✓
    → 題庫 ✓（page.tsx 存在）
    → 評分標準 ✓（page.tsx 存在）
```
教師端各子頁本身都還算完整，問題只在「進不來」和「課程沒對應的學生／資料」。

---

## C. 資料關聯問題

| # | 問題 | demo 影響 |
|---|---|---|
| C1 | mock data 散在各頁、沒共用 source of truth | 「學生 A 在課程 B 拿到 80 分，老師 C 在點名時看到他」這條跨頁故事**講不通** |
| C2 | `isFirebaseConfigured()` fallback 機制：Firebase 沒設定就用 mock，但 mock 各頁不一致 | demo 時若沒連 Firebase，畫面會出現多張「示範資料」警告卡 |
| C3 | `schoolId` 在某些頁面（groups、grades）沒被當篩選條件用 | 多校場景講不通；單校 demo 影響小 |
| C4 | 教師端 role 從 `membership.role` 來，但 demo 帳號不一定真的在 Firestore 的 group members 裡 | 點開教師端會看到「無法存取教師工作台」紅卡 — A4 連帶問題 |

**建議**：開一個 `apps/web/src/lib/demoData.ts`，集中放 4-6 門課、3-5 個學生、1-2 個教師的關聯資料，所有頁面從這裡讀。這是讓 demo「有故事」的根本。

---

## D. 呈現狀態 gap（loading / empty / error）

| 頁面 | loading | empty | error | 建議 |
|---|---|---|---|---|
| `groups` | ❌ 直接顯示 mock | ❌ | ❌ | 至少加 skeleton |
| `clubs` | ❌ | ❌ | ❌ | 同上 |
| `course/[courseId]` | ⚠️ 有 loading state 但畫面是空殼 | 整頁空狀態待加 | ❌ | 給空殼配個 EmptyState「課程資料準備中」 |
| `timetable` | ✓ | ✓（日視圖） | ❌ | OK |
| `grades` | ✓ | ⚠️ 永遠有 DEFAULT_GRADES | — | demo 無傷大雅，但「沒選課」狀態不會出現 |
| 其他頁 | 多數 OK | — | ❌ 大多沒包 try/catch UI | demo 模式可以接受 |

---

## E. 加分項（這幾天有空再做的「亮點」）

1. **統一 mock data**（C1 的解法）— 預估 2 小時，影響最大，能讓你 demo 時講「同一個學生」「同一門課」貫穿整個系統
2. **首頁 Today 加「demo 導覽列」**— 一個小按鈕「依序帶你走過：學生 → 教師 → 校園」三條路徑，預估 1 小時，口試委員會很有感
3. **教師端「以教師身份檢視」按鈕**（A4 的解法）— 預估 30 分鐘
4. **登入頁加 demo 帳號快速按鈕**：學生 demo / 教師 demo / 訪客 三顆，預估 30 分鐘，避免現場敲學號
5. **未開放的按鈕統一改成 `disabled` + tooltip「demo 版尚未啟用」**— 預估 30 分鐘，比點了沒反應好太多

---

## F. 我建議的修法優先順序（給你勾選）

### 第一輪（半天內、必修）
- [ ] A1 — groups 列表變可點
- [ ] A2 — 登出按鈕真的會登出
- [ ] A3 — 統一三邊 course id（最關鍵的故事性修復）
- [ ] A5 — 公告點下去有「下一步」

### 第二輪（一天內、強烈建議）
- [ ] A4 — 教師端入口
- [ ] C1 + E1 — 建一份 `demoData.ts`，把 4 門課 / 3 個學生 / 1 個教師的關聯資料寫死
- [ ] E5 — 所有死按鈕統一改 disabled

### 第三輪（時間夠才做）
- [ ] D — 補 loading / empty 狀態（groups、clubs、course）
- [ ] E2 — Today 加 demo 導覽列
- [ ] E4 — 登入頁 demo 快速按鈕

---

## G. demo 當天檢查表

- [ ] Firebase 連線狀態確認（或全程跑 mock 模式，看哪個更穩）
- [ ] 測試帳號：1 個學生（如 `m11302001@pu.edu.tw`）+ 1 個教師（要有 instructor role）
- [ ] 走過完整流程一次：登入 → 首頁 → 課程 → 課表 → 成績 → 公告 → 教師端 → 登出
- [ ] 瀏覽器：Chrome 1440 寬度為主、1024 也測一下（投影機常見）
- [ ] 開「示範模式」前先清 cache，避免上次 demo 的殘留狀態
