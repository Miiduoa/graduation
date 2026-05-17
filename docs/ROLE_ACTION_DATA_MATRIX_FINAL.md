# 角色 × 動作 × 資料 × 跨角色關聯 完整矩陣（口試最終版）

> **這份文件解答口試委員最常問的兩個問題：**
> 1. 「每個角色都做什麼？」
> 2. 「角色之間怎麼互通？」
>
> 系統共有 **9 個 demo 身分**，每個身分都有獨立的私有資料、AI 任務與
> 跨角色關聯。所有互動圍繞 **AI 主軸** — AI 不是其中一個功能，而是
> 整個 App 的編排者。

---

## 1. 角色定義（9 個 Demo 身分）

| Persona uid | 顯示名稱 | 角色 | 部門 | Demo 切換點 |
|---|---|---|---|---|
| `demo_student_kuchih` | 顧晉瑋 | student | 資訊管理學系 | 學生 A — 故事主角 |
| `demo_student_peer_lin` | 林宏志 | student | 資訊工程學系 | 學生 B — 同學／組員 |
| `demo_teacher_chang` | 張怡君 | teacher | 資訊管理學系 | 教師 |
| `demo_ta_lin` | 林助教 | ta | 資訊管理學系 | 助教 |
| `demo_admin_huang` | 黃主任 | department_head | 資訊管理學系 | 系主任 |
| `demo_admin_sys` | 系統管理員 | admin | 資訊處 | 校級管理員 |
| `demo_cafeteria` | 阿英 | vendor | 校園商家 | 中餐部店長 |
| `demo_parent_ku` | 顧媽媽 | parent | 家長 | 學生顧晉瑋的家長 |
| `demo_club_wei` | 威廷 | club_officer | 資管學會 | 社團幹部 |

每個 persona 都在 `apps/mobile/src/data/demoPersona.ts` 統一定義。
切換 demo 身分時：訊息、收件箱、AI 任務、儀表板內容 **全部** 即時換成
對應身分的視角。**沒有任何畫面會洩漏別人的資料**。

---

## 2. 動作 → 資料 流向總表

下表每一列代表一個動作。「動作」會產生「資料」，「資料」會被另外幾個
角色看到。AI 在這條線上插話 / 做事 / 編排。

### 🎓 學生（student）

| 動作 | 產生的資料 | 誰會看到 | AI 角色 |
|---|---|---|---|
| 提交請假單 | `leave_request_pending` event | 教師收件箱、系主任異常燈號 | AI 預先評估「低風險可一鍵核可」 |
| 繳交作業 | `homework_submitted` event | 教師、TA 成績冊 | AI 預批分數＋自動標 rubric |
| 加入課程 / 退選 | `course_membership_changed` | 教師花名冊、系主任修課人數 | AI 提示「這門課跟你上學期 GPA 偏弱項相關」 |
| 報修 / 點餐 / 借書 | 三個服務各自的 record | 商家、宿舍維修、圖書館員 | AI 主動推薦合適服務（過敏原、人潮預測） |
| 跟 TA / 同學私訊 | `conversation:m-uid-uid` | **僅參與者雙方**（嚴格隔離） | AI 提示「需要看圖才能回答」 |
| Story / 動態 | `social_post` | 設定的可見範圍對象 | AI 摘要校園脈動 |

### 👨‍🏫 教師（teacher）

| 動作 | 產生的資料 | 誰會看到 | AI 角色 |
|---|---|---|---|
| 批改 + 覆核 AI 預批 | `grade_published` event | 學生收件、家長週報 | AI 預批 24 份省 95 分鐘 |
| 派作業 / 出題 | `assignment_created` | 學生收件箱、TA 待批清單 | AI 出題（題庫＋難度） |
| 核可請假 | `leave_decision` | 學生通知、家長標記、系主任 | AI 自動驗證出席率、補課方案 |
| 出席異常聯繫 | `outreach_message` | 該學生私訊 | AI 草擬「溫和關懷」訊息 |
| Office Hour 開放 | `office_hour_event` | 學生地圖點位 + 學伴提示 | AI 提示哪些學生最常缺席今天 |

### 🧑‍💻 助教 TA（ta）

| 動作 | 產生的資料 | 誰會看到 | AI 角色 |
|---|---|---|---|
| 批改 AI 分派的份數 | `ta_grade` event | 教師覆核 | AI 把信心 >= 90% 直接放行 |
| Office Hour 回答問題 | `discussion_reply` | 該學生 + 課程討論區 | AI 分群同類問題建議集中說明 |
| 1:1 學生私訊 | `conversation:m-uid-uid` | **僅 TA 與該學生**（嚴格隔離） | AI 標「需要看圖才能回答」 |

### 🏛 系主任（department_head）

| 動作 | 產生的資料 | 誰會看到 | AI 角色 |
|---|---|---|---|
| 介入學生風險 | `intervention_plan` | 該學生授課教師、家長（授權後） | AI 跨課程整合風險訊號 |
| 課程審核 | `course_approved` | 教師、開課系統 | AI 比對歷年類似課程的選課率 |
| 評議商家 | `merchant_review` | 商家、行政、學生公開摘要 | AI 摘要素食評論 +18% |
| 系所週報歸檔 | `dept_weekly_report` | 校長辦公室 | AI 自動草擬週報 |

### 🛡 系統管理員（admin）

| 動作 | 產生的資料 | 誰會看到 | AI 角色 |
|---|---|---|---|
| 批次認證學生 | `student_verified` | 學生帳號可用 | AI 比對教務處名單，10/12 可一鍵通過 |
| 公告管理 | `announcement_published` | 全校 / 指定群組 | AI 自動分類 + 標籤 |
| 系統健康監測 | `system_health_log` | 主任、校長 | AI 找異常下降原因 |

### 🍱 商家（vendor）

| 動作 | 產生的資料 | 誰會看到 | AI 角色 |
|---|---|---|---|
| 上架菜單 / 新菜 | `menu_published` | 學生（過濾過敏原後）、地圖 POI | AI 推薦定價 + 推估客流 |
| 接收訂單 → 備餐 → 完成 | `order_status` 多階段 | 學生即時通知 | AI 預測尖峰 + 自動推內場 |
| 月底結算 | `monthly_revenue` | 系主任、行政 | AI 摘要正負面評論 |

### 👨‍👩‍👦 家長（parent）

| 動作 | 產生的資料 | 誰會看到 | AI 角色 |
|---|---|---|---|
| 與教師私訊 | `conversation:m-uid-uid` | **僅家長與教師**（嚴格隔離） | AI 摘要孩子本週重點 |
| 查看孩子授權的學習報告 | `parent_view_log` | 孩子可看到「家長看過了」 | AI 生成週報摘要（避免成績細節，注重趨勢） |
| 接收教師關懷通知 | `parent_notification` | 僅家長 | AI 過濾「真的需要家長知道」的事件 |

### 🎯 社團幹部（club_officer）

| 動作 | 產生的資料 | 誰會看到 | AI 角色 |
|---|---|---|---|
| 發布活動 | `club_event` | 社員 + 公開校園活動 | AI 分群推播（未回應、可能、確認） |
| 管理成員 | `club_member_changed` | 社團名冊 | AI 提示「冷淡成員」 |
| 預訂場地 | `venue_booking` | 場館管理、其他社團衝堂提醒 | AI 推薦替代時段 |

---

## 3. 跨角色「事實流」— 四條主鏈

這四條鏈是 AI 主軸的具體表現：**一個事實在多個角色之間流動，AI 在每一段做事**。

### 鏈 1：請假事件鏈

```
[學生顧晉瑋]
  ├── 在 App 內按「請假」
  ├── 系統建 leave_request_pending event
  └── AI：自動驗證出席率 96%、無相關小考、產生補課建議
       │
       ▼
[教師張怡君] 收件箱出現「請假待審」
  ├── AI 顯示「低風險，可一鍵核可」
  ├── 教師按「核可」
  └── 系統發 leave_decision event
       │
       ├──▶ [學生] 收到核可 + 補課資源
       ├──▶ [家長顧媽媽] 標記「孩子請假已核可」
       └──▶ [系主任黃主任] 儀表板出席率即時更新
```

### 鏈 2：AI 預批 → TA → 教師覆核 → 學生收件

```
[教師] 派作業 HW3（32 份）
  └── AI 預批 24 份，信心 ≥ 90% 共 8 份
       │
       ├──▶ [TA 林助教] 負責批 16 份，AI 預批 12，剩 4 需人工
       │       └── TA 完成 → 推給教師覆核
       │
       └──▶ [教師張怡君] 覆核 → 發布成績
              │
              ├──▶ [學生顧晉瑋] 收到 82 分 + AI 個人化檢討
              ├──▶ [學生林宏志] 收到 75 分 + AI 個人化檢討
              └──▶ [家長] 週報出現「孩子 HW3 表現」（不顯示分數細節）
```

### 鏈 3：商家備料 ↔ 學生餐點推薦

```
[商家阿英] 上架「咖哩雞腿飯」+ 標示過敏原（含花生）
  └── AI 推算今日尖峰 11:30–12:30、估 78 份
       │
       ├──▶ [學生顧晉瑋] AI 看到他的過敏原是「花生」→ 該菜不推薦
       │     另推「番茄牛肉麵」+ 預估排隊 < 5 分
       │     ├── 學生下單
       │     └── 訂單即時傳商家後台
       │
       ├──▶ [學生林宏志] 無過敏原 → 推「咖哩雞腿飯」+ 預訂
       │
       └──▶ [系主任] 月底評議報告：素食評論 +18，建議擴充
```

### 鏈 4：跨課程學業風險

```
[AI 跨課程模型] 偵測：3 位學生本月學業風險升黃燈
  └── 自動產生 intervention_plan
       │
       ├──▶ [系主任] 儀表板出現黃燈名單
       │     └── 派給授課教師
       │
       ├──▶ [教師張怡君] 收件箱出現該 2 位學生關懷任務
       │     └── AI 草擬「溫和提醒」訊息
       │
       ├──▶ [學生本人] 收到溫和提醒 + AI 整理的錯題本連結
       │
       └──▶ [家長] 7 天後若無改善 → 可選擇接收提醒
             （家長無法直接看到成績，僅看到 AI 摘要的「需要鼓勵」訊號）
```

---

## 4. 訊息系統隱私模型（嚴格身分隔離）

```
viewer_uid → getPersonaConversations(viewer_uid)
           → 只回傳 conversations.where(participants includes viewer_uid)
```

**測試矩陣**（任意切換 demo 帳號，預期看到的對話數）：

| 登入身分 | 應該看到的對話 | 不該看到的對話 |
|---|---|---|
| 學生顧晉瑋 | 跟教師張、TA 林、同學林、社團幹部威廷 4 條 | 教師↔TA、教師↔系主任、家長↔教師、其他人之間任何對話 |
| 教師張怡君 | 跟學生顧、學生林、TA 林、系主任黃、家長顧媽媽 5 條 | 學生之間私訊、商家↔系主任 |
| TA 林助教 | 跟學生顧、學生林、教師張 3 條 | 教師↔系主任、家長相關任何對話 |
| 系主任黃 | 跟教師張、商家阿英、管理員 3 條 | 任何學生 1:1 私訊 |
| 商家阿英 | 跟系主任、管理員 2 條 | 任何學生或教師之間對話 |
| 家長顧媽媽 | 僅跟教師張 1 條 | 任何學生 1:1、商家、教師之間 |

**程式碼層保證**：`getPersonaConversationDetail(viewerUid, convId)`
會檢查 `convo.participants.includes(viewerUid)`，否則回 `null`。

---

## 5. AI 主軸 — 為什麼這不是普通校園 App

傳統校園 App = 「資料展示器」：每個畫面只是把表格畫出來。

本 App = **「AI 編排器」**：

- **每個儀表板第一屏** 是 `AIMissionControl` — AI 已經想完、只剩你下決定
- **每個 mission 都標** 「AI 已替你節省 X 分鐘」 — 量化 AI 價值
- **每個 mission 都帶** 「跨角色提示」— 顯示「這件事如何牽動其他人」
- **AI 球** 浮在所有畫面之上 — 隨時對話、跨情境理解
- **訊息系統** AI 也在 → 排序回覆優先度、生成草稿、分群推播
- **資料源即 AI 源** — 學生過敏原 → 商家推薦過濾、學生 GPA → 系主任預警

---

## 6. 程式實作對照（給工程師看的）

| 概念 | 程式位置 |
|---|---|
| 9 個 persona 身分 | `apps/mobile/src/data/demoPersona.ts` (常數 `PERSONAS`) |
| 對話資料 + 隔離函式 | `apps/mobile/src/data/demoPersona.ts` (`getPersonaConversationSummaries`, `getPersonaConversationDetail`) |
| AI mission 卡 | `apps/mobile/src/data/demoPersona.ts` (`getPersonaMissions`) |
| 收件箱任務 | `apps/mobile/src/data/demoPersona.ts` (`getPersonaInbox`) |
| AI 任務指揮 UI | `apps/mobile/src/components/AIMissionControl.tsx` |
| 訊息頁注入 | `apps/mobile/src/screens/MessagesHomeScreen.tsx` |
| 收件匣注入 | `apps/mobile/src/screens/InboxScreen.tsx` |
| 私訊嚴格隔離 | `apps/mobile/src/screens/ChatScreen.tsx` (mock-mode block) |
| 私訊列表隔離 | `apps/mobile/src/screens/DmsScreen.tsx` (mock-mode block) |
| 6 個儀表板 | `Smart/Teacher/TA/Department/Admin/Vendor DashboardScreen.tsx` |
| 路由 fallback | `apps/mobile/App.tsx` (`onUnhandledAction`) |
