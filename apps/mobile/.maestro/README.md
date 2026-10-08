# iOS 端到端測試

Maestro 從 iOS Simulator 操作實際安裝的 App。它與 Jest、TypeScript 檢查是不同的驗證層級；單元測試通過，不代表原生 App 已能啟動。

## CI 如何執行

工作流程：[`maestro-e2e.yml`](../../../.github/workflows/maestro-e2e.yml)

1. 在 macOS runner 啟動可用的 iPhone Simulator。
2. 使用版本庫既有的 `ios/` 原生專案執行 `pod install` 與 Debug simulator build；不以 `expo prebuild --clean` 覆蓋既有原生設定。
3. 安裝編譯出的 `.app`，從 `Info.plist` 取得 **實際 bundle identifier**，避免腳本和安裝版本不一致。
4. 啟動 Metro，確認 `/status` 正常，再請求 iOS JavaScript bundle，避免冷編譯與第一個 UI 斷言競速。
5. 以指定的 simulator UDID 執行 Maestro，保留 JUnit 結果、除錯記錄與截圖。任何流程失敗，都應讓 E2E job 失敗。

### 自動執行的 smoke flows

- `01_onboarding.yaml`：App 冷啟動與主要 Tab 是否出現。
- `11_navigation_ai_first.yaml`：主頁、頭像抽屜及 AI-First 導航殼層。

預設 PR／每週排程只跑這兩支。其餘 `flows/` 保留為手動 `full` 回歸測試，**不能**因 smoke 通過，就宣稱登入、公告或所有校務流程都通過實機驗收。

GitHub Actions 的 `workflow_dispatch` 提供 `smoke`、`full`、`onboarding`、`authentication`、`announcements`。實際執行結果以該次 workflow run 與 artifact 為準。

## 本機重現

需要 macOS、Xcode、iOS Simulator、Node 22、pnpm 10、CocoaPods 與 Maestro。從專案根目錄執行：

```bash
pnpm install --frozen-lockfile
cd apps/mobile
pod install --project-directory=ios
# 以 Xcode 開啟 ios/mobile.xcworkspace，建置並安裝 Debug App
pnpm exec expo start --localhost --port 8081
```

在另一個終端機，確認模擬器有已安裝的 App，並以實際 Bundle ID 執行：

```bash
xcrun simctl list devices booted
maestro --device "<SIMULATOR_UDID>" test .maestro/flows/01_onboarding.yaml --env APP_ID="<INSTALLED_BUNDLE_ID>"
maestro --device "<SIMULATOR_UDID>" test .maestro/flows/11_navigation_ai_first.yaml --env APP_ID="<INSTALLED_BUNDLE_ID>"
```

腳本中的 `APP_ID` 必須與模擬器上安裝的版本一致；不能只看 `app.config.ts` 的預設值。請勿對需要 Metro 的 Debug App 隨意使用 `clearState`，否則可能清掉原本已建立的 JS 連線狀態。

## 測試邊界

- Smoke **不會**用真實學校帳號登入，也不驗證學校 SSO、成績正確性或正式後端授權。
- 編譯／Metro 失敗和 UI 元素缺失必須分開看，不以空白截圖或測試 skipped 代替成功。
- 某些流程包含 `optional: true`，代表那個步驟沒有嚴格斷言；不能把這些可選檢查計入已驗收功能。
- 若要對外宣稱實機完整可用，必須另附對應的成功 workflow、截圖與有效的測試環境紀錄。

失敗時先查看 GitHub Actions 的 `maestro-results-ios` artifact、Metro log 和該支 flow 的 JUnit XML。iOS 原生編譯錯誤應先排除，再調整 UI 等待條件；不要只為了讓測試變綠而跳過斷言。
