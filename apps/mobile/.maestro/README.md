# Maestro 驗收環境

全套仍逐一執行 `flows/*.yaml` 的 13 個流程，並由既有
`scripts/merge-gate/maestro-reports.py` 檢查每個流程的 JUnit 結果。
`tab-Today` 只在有效的 Firebase 學校帳號、對應 profile 與選校狀態都就緒後存在。
完成訪客 onboarding 或登入 nuni 平台帳號，不會取得這個學校工作區。

## 登入前提

CI 使用 repo 已有 `scripts/test-env/seed.cjs` 建立的
`demo-campus-one` 測試學生 `test-student-a`，電子郵件
`s0000001@test.campus-one.local`，以及 `schools/pu/members/test-student-a`
的有效學生身分。密碼是既有 seed 宣告的公開模擬器 fixture；不接受正式帳密。

`scripts/maestro/start-emulators.sh` 啟動真 Firebase Auth 與 Firestore 模擬器，
使用正式 Firestore rules，先驗證錯密碼被拒絕、正確密碼取得 emulator ID token、
學生 profile 與 membership 可讀、未登入不可讀私有 profile，才開始 native 測試。
公告與活動另由 `scripts/maestro/seed-content.mjs` 植入有固定標題的本機測試資料。

獨立 `index.maestro.ts` 只在 CI 的 Xcode `ENTRY_FILE` 明確選用。
`package.json` 的正常入口仍是 `index.ts`，不會載入測試登入畫面。
測試入口要求 `APP_ENV=development`、Maestro flag、專案恰為 `demo-campus-one`、
Auth `127.0.0.1:19291` 與 Firestore `127.0.0.1:18291`；production、preview、
非本機位址、mock auth 或 universal dev accounts 都會在載入 App 前失敗。
登入使用 Firebase SDK 的 `signInWithEmailAndPassword`，不寫 mock session、不偽造 token，
也不改 `SchoolSessionBoundary`、role guard 或 production school SSO。

每個流程獨立清除 App 狀態。01、05 與口試示範驗證訪客路徑；其餘流程先執行
`helpers/sign-in-student.yaml` 完成實際模擬器登入。02 同時驗證錯密碼、個人資料，
以及從 App 正式登出後無法再以舊 deep link 回到私有群組。

## 本機執行

需要 repo 指定的 Node/pnpm、Java 21、Xcode、iOS Simulator 與 Maestro。
在 repo 根目錄安裝依賴後：

```bash
export APP_ENV=development EXPO_PUBLIC_MAESTRO=1
export EXPO_PUBLIC_ALLOW_LOCAL_MOCK_AUTH=false
export EXPO_PUBLIC_ENABLE_UNIVERSAL_DEV_ACCOUNTS=false
source scripts/test-env/env.sh
bash scripts/maestro/start-emulators.sh
node --experimental-strip-types --test scripts/maestro/emulator-config.test.mjs
```

建置時依 `.github/workflows/maestro-e2e.yml` 使用 Release simulator bundle，並指定
`ENTRY_FILE="$PWD/index.maestro.ts"`（工作目錄 `apps/mobile`）。安裝後逐一執行：

```bash
cd apps/mobile
maestro --device "$SIMULATOR_UDID" test .maestro/flows/02_authentication.yaml \
  --env APP_ID="$APP_ID" --format junit --output .maestro/results/02_authentication-results.xml
```

正常 App build 沒有測試入口，也不會因 `campus://maestro/sign-in` 開啟模擬器登入。
Authenticated flow 以 Maestro `launchApp` 參數顯示 `maestro-open-emulator-login`，
缺少該入口時會明確失敗，不會以訪客替代登入。測完可將
`.test-env/maestro-emulators/emulators.pid` 中的程序送出 TERM；CI 會自動清理。

## 舊流程與目前功能的對應

| 流程 | 現在實際驗證 |
| --- | --- |
| 01 / 05 | 訪客登入入口、選校、公開地圖及未取得私有 tab |
| 02 | 錯誤密碼、真 Firebase 登入與學生 profile、正式登出後的私有路由邊界 |
| 03 / 04 | 已登入的公告搜尋與內容、活動篩選與內容；資料來自本機 Firestore |
| 06 | 校園餐廳、目前提供的「全部／有菜單／100 元內」篩選與搜尋清除 |
| 07 / 08 | QR 名片、成就紀錄、主題、裝置無障礙資訊、語言與資料匯出入口 |
| 09 / 10 / 11 / 12 | 已登入群組、目前註冊的 deep links、五個 tab、抽屜及社群看板 |
| demo_oral_v4 | 目前支援的公開口試工作區：學生交作業／簽到／請假、老師發布成績與核准、店家備餐，回到學生核對共享狀態 |

舊 `campus://home/events`、`home/announcements`、`campus/cafeteria`、
`campus/map`、`inbox/groups`、`home/community` 已不在目前 linking 設定，流程改用
`schoolLinking.ts` 實際註冊的 URI。舊 `e2e-announcements-screen`、AI floating ball、
`主題模式`、`文字大小`滑桿及 `__DEV__` 角色切換也已不在目前畫面。
舊腳本對菜單詳情／付款、AI 浮球等使用 optional 操作，並未保證功能已執行；
此輪不宣稱有付款或 AI 多步執行的 native 覆蓋。
公開口試工作區的示範互動也不代表教師／管理員取得正式權限。

Linux 可驗證真 emulator 與規則、TypeScript、單元測試與流程 YAML；完整 iOS
13 個流程仍以 GitHub macOS runner 的本次 JUnit 與畫面證據為驗收依據。
