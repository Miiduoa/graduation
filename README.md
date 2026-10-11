# Campus One｜校園資訊與行動助手

[![CI](https://github.com/Miiduoa/graduation/actions/workflows/ci.yml/badge.svg)](https://github.com/Miiduoa/graduation/actions/workflows/ci.yml)

整合課程、訊息、校園地圖與學習資訊的跨端產品原型。Mobile 與 Web 共用部分型別及商業規則，後端以 Firebase Functions、Firestore 和 Storage 處理資料與授權。

目前持續開發中，部分功能使用示範資料；外部校務、LMS 與交通服務需要另行設定。

[兩分鐘導覽](docs/REVIEW_IN_2_MINUTES.md) · [架構說明](docs/ARCHITECTURE_OVERVIEW.md) · [測試紀錄](docs/TESTING_EVIDENCE.md) · [作品介紹](https://miiduoa.github.io/case-studies/campus-one/)

## Mobile 畫面

<p>
  <img src="docs/mobile-screenshots/m_student_03_campus.png" alt="Campus One 校園服務入口的既有原型畫面" width="220">
</p>

既有原型畫面：學生端校園服務入口。

更多操作流程見 [Mobile demo](apps/mobile/DEMO.md)。

## 功能與程式入口

- **Mobile**：今天、課務、生活、我。課表、作業、訊息、校園地圖與公車。使用 Expo 54、React Native 0.81、React Navigation，程式位於 [`apps/mobile/`](apps/mobile/)。
- **Web**：學生與管理／教學介面，使用 Next.js 16、React 19、TypeScript，程式位於 [`apps/web/`](apps/web/)。
- **Backend**：Firebase Functions、Firestore／Storage 規則與測試，位於 [`backend/`](backend/)。
- **Shared**：跨端共用的型別與規則位於 [`packages/`](packages/)，由 pnpm workspace 管理。

## 本機執行

需求：Node.js 22、pnpm 10。Node.js 22 是 CI／Expo 工具鏈基準；根目錄的 engines 也保留 Node 20.19.4+、低於 21 的相容範圍。

```bash
git clone https://github.com/Miiduoa/graduation.git
cd graduation
pnpm install
```

Web：

```bash
pnpm dev:web
```

Mobile：

```bash
pnpm dev:mobile
```

iOS simulator：

```bash
pnpm ios:sim
```

外部服務的可用範圍取決於環境與憑證設定；部分資料及角色流程以 demo data 展示。

## 幾個設計重點

### 跨端與角色權限

共用型別與規則集中在 workspace package；平台 UI、導航與裝置能力留在各端。權限檢查涵蓋路由、UI、資料存取、後端授權及 Firestore／Storage 規則。

相關文件：[角色與資料流](docs/APP_ROLE_DATA_FLOW_ARCHITECTURE.md) · [跨角色資料流](docs/CROSS_ROLE_DATA_FLOW.md) · [API](docs/API.md) · [設計決策紀錄](docs/adr/README.md)

### 安全導頁與服務失效處理

Deep link、通知與訊息 action 經過 route registry 及 safe navigation。部分流程提供 mock、cache 或 hybrid data path，讓外部服務失敗時仍能辨識資料狀態、保留基本導航。

### 成績通知的收件人檢查

教師評分頁目前是本機示範，不會寫入 TronClass 成績。發布本機成績事件前，會檢查教師帳號及教學角色、明確的學生 UID、作業 ID 與分數；不以姓名或學號推測收件人。

- [評分頁](apps/mobile/src/screens/TeacherGradingScreen.tsx)
- [傳送前檢查](apps/mobile/src/services/prepareGradingDelivery.ts)
- [收件人隔離測試](apps/mobile/src/__tests__/prepareGradingDelivery.test.ts)

### 課表與安排

個人課表用靜宜第 1–13 節。截圖或學校選課紀錄要確認後才寫入。好友課表要先加好友才看得到。共同空堂可以約吃飯或讀書。「幫我安排」是依課表算出下一堂、空堂與讀書時段，不是另外一套對話服務。

## 驗證

根目錄提供：

```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test:rules
```

Mobile 使用 Jest，Web 使用 Vitest，原生 UI 流程另有 Maestro E2E workflow。`test:rules` 會啟動 Firebase emulators，需要對應的 Java 環境。

[測試紀錄](docs/TESTING_EVIDENCE.md) 按 CI run 與 commit 記錄結果；[依賴風險清單](docs/DEPENDENCY_RISK_REGISTER.md) 保留尚待處理的風險。主要 CI 成功不代表原生 Maestro E2E 已通過、所有裝置都可安裝，或所有安全警示都已清除。

一般 CI 只驗證 Expo Doctor、公開 app config 與 `eas.json` build profile，不需要 `EXPO_TOKEN`，也不提交 EAS Cloud build。iOS／Android 雲端建置由手動的 `EAS Build`／`Release` workflow 執行，屆時才需要 Expo 帳號憑證。

[查看 GitHub Actions](https://github.com/Miiduoa/graduation/actions)

## 目前限制

- 這是校園產品原型，尚非正式校務系統；demo data 不代表校方權威資料。
- 外部 LMS、地圖、即時交通需要相應環境及憑證。沒開通的服務會在畫面上直接說明。
- Repo 同時保留研究、驗證及口試文件；待修問題見 [REMAINING_BUGS_AUDIT](docs/REMAINING_BUGS_AUDIT.md)。
- 點名的伺服器確認要求及現有限制，另見 [Attendance verification boundary](docs/ATTENDANCE_VERIFICATION.md)。

## 作者

顧晉瑋 · Providence University, Information Management  
[GitHub / Miiduoa](https://github.com/Miiduoa)
