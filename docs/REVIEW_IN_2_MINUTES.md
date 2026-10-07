# Campus One — 2-minute reviewer path

這份文件給第一次打開 repo 的教授、面試官或 code reviewer。目標不是列完所有功能，而是用最短路徑確認：**這是不是一個真的跨 Mobile / Web / Backend 的系統，以及工程邊界有沒有被寫清楚。**

## 1. 先看產品，而不是功能清單

Campus One 想解的問題是：校園資訊分散在課表、LMS、公告、訊息、地圖與服務入口，使用者真正需要的不是更多入口，而是知道「現在下一步要做什麼」。

Mobile 的主要心理模型固定為：

```text
Today → 角色入口 → 校園 → 收件匣 → 我的
```

第二個 tab 依角色切換，學生、教師、職員、主管與管理者不共用同一組操作權限。

實際畫面先看：

- [Mobile demo](../apps/mobile/DEMO.md)
- `apps/mobile/ai_first_tabs.png`
- `apps/mobile/ai_overlay_optional.png`

## 2. 再確認它不是只有前端

```text
apps/mobile        Expo / React Native
apps/web           Next.js
backend/functions  Firebase Functions
backend/firestore  Firestore rules / data boundary
backend/storage    Storage rules
packages/shared    shared contracts / types / rules
docs               architecture / review evidence
```

跨端不是把兩份 UI 放在同一個 repo，而是把能共用的 contract、角色邏輯與資料邊界集中管理。

## 3. 三個最值得看的工程問題

### A. Role + data boundary

角色不是只控制「按鈕有沒有顯示」。

目前邊界分成：

1. tab / route guard
2. UI permission
3. DataSource / repository
4. backend authorization
5. Firestore / Storage rules

完整矩陣看 [APP_ROLE_DATA_FLOW_ARCHITECTURE](APP_ROLE_DATA_FLOW_ARCHITECTURE.md)。

### B. Navigation + action safety

Deep link、訊息 action、AI suggestion 都可能把使用者帶到不存在或不該進入的頁面，因此 repo 保留 route registry、safe navigation 與 confirmation boundary。

高敏感 AI action 不應直接寫入；設計上先進 action queue，再由使用者確認。

完整設計看 [AI_ASSISTANT_ARCHITECTURE](AI_ASSISTANT_ARCHITECTURE.md)。

### C. Degraded / offline path

外部 LMS、交通、校務或 AI 服務不保證永遠可用。核心流程因此不能把「服務暫時失敗」等同「整個產品失效」。

Repo 內的做法包含 mock / Firebase / hybrid DataSource、cache、部分離線流程與可切換 provider；README 只把目前存在的能力寫成已實作，不把願景當成果。

## 4. CI 到底在驗什麼

`.github/workflows/ci.yml` 目前不是單一 build job，而是把不同 failure boundary 分開：

| Gate | 目的 |
|---|---|
| Security gates | dependency audit、secret scan |
| Lint + type check | Mobile / Web / Functions / Shared 的靜態一致性 |
| Mobile tests | 行動端行為 |
| Web tests | Web 邏輯 |
| Functions tests | backend function 行為 |
| Firestore rules tests | data authorization 最後防線 |
| Mobile build checks | Expo config / EAS profile 結構 |
| Web build | production build 是否成立 |

另外保留 Maestro E2E workflow，讓 UI flow 與一般 unit test 分開。

## 5. 哪些是「真的」，哪些不是

### Repo 中已有實作或驗證面

- Expo / React Native Mobile
- Next.js Web
- Firebase Functions
- Firestore / Storage rules
- shared TypeScript contracts
- role-aware navigation / access logic
- tests / CI / E2E workflow
- demo screenshots
- optional AI / local LLM path
- cache / degraded-mode related流程

### 不應被誤解的地方

- 這不是正式校務系統。
- 部分資料與角色流程使用 demo data。
- 外部 LMS、校務、交通、支付與 AI provider 需要對應環境或憑證。
- 文件中仍有「現有 / 部分現有 / 願景待補強」三種狀態；不能把願景欄位當完成度。
- AI 是產品層的一部分，不是整個系統的資料權威。

## 6. 如果只有 2 分鐘

依序打開：

1. [README](../README.md) — 先看產品問題與 30 秒入口
2. [Architecture overview](ARCHITECTURE_OVERVIEW.md) — 看 Mobile / Web / Backend / data boundary
3. [Architecture Decision Records](adr/README.md) — 看 monorepo、權限與 AI 邊界為什麼這樣選
4. [Mobile demo](../apps/mobile/DEMO.md) — 確認實際 UI，不用概念稿代替成品
5. [Testing evidence](TESTING_EVIDENCE.md) — 看實際測試數字、security gate 與尚未清掉的驗證債務

如果還要往下追，再看 [Role + data flow](APP_ROLE_DATA_FLOW_ARCHITECTURE.md)、[AI boundary](AI_ASSISTANT_ARCHITECTURE.md) 與 [CI workflow](../.github/workflows/ci.yml)。

這條路徑足以判斷 Campus One 的產品方向、跨端範圍、架構理由、權限模型、驗證面與限制，不需要先讀完整 repo。
