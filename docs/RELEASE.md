# 發佈流程指南

本文檔詳細說明了校園整合應用程式的企業級應用商店發佈流程，包括 iOS App Store 和 Google Play Store。

## 目錄

1. [發佈前檢查清單](#發佈前檢查清單)
2. [版本管理](#版本管理)
3. [本地構建](#本地構建)
4. [CI/CD 自動構建](#cicd-自動構建)
5. [App Store 提交](#app-store-提交)
6. [Google Play 提交](#google-play-提交)
7. [TestFlight 測試](#testflight-測試)
8. [內部測試軌道](#內部測試軌道)
9. [監控和分析](#監控和分析)
10. [回滾程序](#回滾程序)
11. [修復程序](#修復程序)

---

## 發佈前檢查清單

在開始任何發佈流程之前，請確保完成以下檢查項目：

### 代碼和測試檢查
- [ ] 所有代碼已合併到 `main` 分支
- [ ] 所有變更已進行代碼審查且已批准
- [ ] 單位測試通過：`pnpm --filter mobile test`
- [ ] 集成測試通過：`pnpm --filter mobile test:e2e`
- [ ] linting 無錯誤：`pnpm lint`
- [ ] TypeScript 檢查通過：`pnpm typecheck`

### 功能驗證
- [ ] 所有新功能已在開發環境中測試
- [ ] UI 在不同屏幕尺寸上驗證
- [ ] iOS 設備上的功能測試（iPhone, iPad）
- [ ] Android 設備上的功能測試（不同 API 級別）
- [ ] 網絡連接狀態下的功能測試（在線、離線、慢速網絡）

### 安全和隱私檢查
- [ ] API 密鑰和敏感信息已妥善管理（通過環境變量）
- [ ] 隱私政策已更新（如適用）
- [ ] 用戶數據收集已遵循隱私法規
- [ ] 依賴項沒有已知的安全漏洞

### 文檔檢查
- [ ] 發佈說明已準備好
- [ ] 已更新的變更日誌（CHANGELOG.md）
- [ ] 已更新的功能文檔

### 配置檢查
- [ ] 環境配置正確設置
- [ ] Firebase 配置已驗證
- [ ] API 端點指向正確的環境

---

## 版本管理

### 版本號格式

使用語義化版本控制（Semantic Versioning）：`MAJOR.MINOR.PATCH`

- **MAJOR**：重大功能或破壞性變更
- **MINOR**：新功能或增強功能
- **PATCH**：錯誤修復或小改進

### 自動版本凸起

#### 修補版本凸起（Patch Bump）
```bash
pnpm version:patch
```
示例：`1.0.0` → `1.0.1`

#### 次要版本凸起（Minor Bump）
```bash
pnpm version:minor
```
示例：`1.0.0` → `1.1.0`

#### 主要版本凸起（Major Bump）
```bash
pnpm version:major
```
示例：`1.0.0` → `2.0.0`

### 版本号更新的文件

版本凸起腳本會自動更新以下文件：
- `apps/mobile/app.json` - Expo 配置
- `apps/mobile/package.json` - Mobile 應用 package.json
- `package.json` - 根目錄 package.json

### 版本號的最佳實踐

1. 在發佈前總是凸起版本號
2. 創建 git 標籤：`git tag v1.0.0`
3. 將標籤推送到遠程倉庫：`git push origin v1.0.0`
4. 在 GitHub Releases 中記錄發佈說明

---

## 本地構建

### 先決條件

- Node.js 20.x
- pnpm 10.x
- Expo CLI
- EAS CLI
- 適用於 iOS 構建的 Xcode（macOS 上）
- 適用於 Android 構建的 Android SDK

### 設置

1. 安裝依賴項：
```bash
pnpm install
```

2. 配置 EAS：
```bash
cd apps/mobile
npx eas-cli configure
```

3. 登錄到 Expo：
```bash
npx expo login
```

### 本地 Preview 構建

Preview 構建用於本地測試和開發：

#### iOS Preview 構建
```bash
pnpm --filter mobile exec eas build --platform ios --profile preview --local
```

#### Android Preview 構建
```bash
pnpm --filter mobile exec eas build --platform android --profile preview --local
```

### 本地 Production 構建

生產構建用於應用商店提交：

#### iOS Production 構建
```bash
pnpm --filter mobile exec eas build --platform ios --profile production --local
```

#### Android Production 構建
```bash
pnpm --filter mobile exec eas build --platform android --profile production --local
```

### 構建時間預期

- iOS Preview 構建：約 20-30 分鐘
- iOS Production 構建：約 30-45 分鐘
- Android Preview 構建：約 15-25 分鐘
- Android Production 構建：約 25-35 分鐘

---

## CI/CD 自動構建

### Release 工作流

Release 工作流可通過 GitHub Actions 手動觸發，用於自動化構建和提交過程。

#### 訪問 Release 工作流

1. 前往 GitHub 倉庫
2. 單擊 **Actions** 標籤
3. 選擇 **Release** 工作流
4. 單擊 **Run workflow**

#### 配置選項

在運行工作流前，設置以下選項：

| 選項 | 值 | 說明 |
|------|------|--------|
| **platform** | `all`, `ios`, `android` | 指定目標平台 |
| **profile** | `production`, `preview` | 指定構建配置文件 |
| **submit** | `true`, `false` | 構建後是否提交到應用商店 |
| **release_notes** | 自由文本 | 可選的發佈說明 |

#### 工作流步驟

1. **Pre-flight Checks** - 執行所有測試、linting 和類型檢查
2. **Build iOS** - 構建 iOS 應用（如果選擇）
3. **Build Android** - 構建 Android 應用（如果選擇）
4. **Submit to App Stores** - 提交到應用商店（如果選擇且 profile 為 production）
5. **Create GitHub Release** - 在 GitHub 上創建發佈記錄

#### 示例工作流執行

**場景 1：為 iOS 構建 Preview 版本（不提交）**
```
Platform: ios
Profile: preview
Submit: false
Release notes: (空)
```

**場景 2：為兩個平台構建 Production 版本並提交**
```
Platform: all
Profile: production
Submit: true
Release notes: 功能添加：用戶認證、增強的性能
```

### Preview Deploy 工作流

每當創建或更新拉取請求時，此工作流自動運行：

- 要求 PR 有 `preview` 標籤
- 發佈 EAS 更新到 `pr-<number>` 分支
- 在 PR 中添加評論以提供預覽分支信息

#### 使用 Preview 更新

1. 在 PR 中添加 `preview` 標籤
2. 等待工作流完成
3. 在 Expo Go 應用中掃描 QR 碼進行測試

---

## App Store 提交

### 先決條件

1. **Apple 開發者賬戶**
   - 有效的 Apple ID
   - App Store Connect 訪問權限
   - 有效的開發者證書

2. **應用配置**
   - Bundle ID：`com.campus.app`（或您的實際 bundle ID）
   - App Store 應用 ID（在 App Store Connect 中找到）

3. **Secrets 配置**
   在 GitHub Secrets 中設置：
   - `EXPO_APPLE_ID` - Apple ID 電子郵件
   - `EXPO_ASC_APP_ID` - App Store Connect 應用 ID
   - `EXPO_APPLE_TEAM_ID` - Apple Team ID

### 提交流程

#### 選項 1：通過 GitHub Actions（推薦）

1. 轉到 **Release** 工作流
2. 設置以下選項：
   - Platform: `ios`
   - Profile: `production`
   - Submit: `true`
3. 運行工作流
4. 監控工作流執行

#### 選項 2：本地命令

```bash
# 構建
pnpm --filter mobile exec eas build --platform ios --profile production

# 提交
pnpm --filter mobile exec eas submit --platform ios --latest --non-interactive
```

### App Store Connect 審核

提交後：

1. 登錄 [App Store Connect](https://appstoreconnect.apple.com)
2. 轉到 **My Apps**
3. 選擇您的應用
4. 轉到 **TestFlight** > **iOS Builds**
5. 選擇構建版本
6. 配置應用信息（如需要）
7. 提交審核

### App Store 審核時間

- 通常：1-2 天
- 繁忙期間：可能需要 2-5 天
- 拒絕需要修復：取決於問題嚴重程度

---

## Google Play 提交

### 先決條件

1. **Google Play 開發者賬戶**
   - 有效的 Google 賬戶
   - Google Play 管理中心訪問權限
   - 簽署密鑰設置完成

2. **應用配置**
   - Package name：`com.campus.app`（或您的實際包名）
   - Google Play 應用 ID

3. **Secrets 配置**
   在 GitHub Secrets 中設置：
   - `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` - Google Play API 服務賬戶 JSON

### 提交流程

#### 選項 1：通過 GitHub Actions（推薦）

1. 轉到 **Release** 工作流
2. 設置以下選項：
   - Platform: `android`
   - Profile: `production`
   - Submit: `true`
3. 運行工作流
4. 監控工作流執行

#### 選項 2：本地命令

```bash
# 構建
pnpm --filter mobile exec eas build --platform android --profile production

# 提交
pnpm --filter mobile exec eas submit --platform android --latest --non-interactive
```

### Google Play 控制台審核

提交後：

1. 登錄 [Google Play 管理中心](https://play.google.com/console)
2. 選擇應用
3. 轉到 **Release** > **Production**
4. 檢查構建版本
5. 配置發佈說明和屏幕截圖（如需要）
6. 審查內容評級問卷（如適用）
7. 提交審核

### Google Play 審核時間

- 通常：幾個小時
- 最長：1-2 天
- 拒絕需要修復：取決於問題嚴重程度

---

## TestFlight 測試

### 設置 TestFlight

1. 在 App Store Connect 中登錄
2. 轉到應用 > **TestFlight**
3. 在 **iOS Builds** 下選擇構建
4. 配置測試員組：
   - **內部測試員**：最多 100 個用戶（團隊成員）
   - **外部測試員**：最多 10,000 個用戶

### 邀請測試員

#### 內部測試員
1. 轉到 **App Store Connect** > **Users and Access**
2. 添加團隊成員
3. 分配適當的角色
4. 用戶將自動添加到內部 TestFlight 組

#### 外部測試員
1. 轉到應用 > **TestFlight** > **External Testing**
2. 創建新的測試員組
3. 添加電子郵件地址
4. 設置反饋電子郵件
5. 邀請測試員

### 測試員反饋

- 測試員可以通過 TestFlight 應用報告崩潰和提交反饋
- 反饋將發送至您指定的電子郵件
- 監控反饋並在下個版本中解決問題

---

## 內部測試軌道

### Google Play 內部測試軌道

#### 設置

1. 登錄 Google Play 管理中心
2. 轉到 **Release** > **Internal testing**
3. 創建發佈

#### 邀請測試員

1. 轉到 **Internal testing** 軌道
2. 在 **Testers** 下添加 Google 群組
3. 最多支持 100 個測試員

#### 測試期間

- 與內部測試員共享構建版本 APK 的下載鏈接
- 測試員可以通過 Play Store 應用安裝
- 測試期間沒有時間限制

---

## 監控和分析

### App Store Analytics

1. 登錄 App Store Connect
2. 轉到應用 > **Analytics**
3. 查看：
   - 下載量和重新下載量
   - 安裝轉化率
   - 單位銷售額
   - 保留率

### Google Play Console Analytics

1. 登錄 Google Play 管理中心
2. 轉到 **Statistics**
3. 查看：
   - 安裝和卸載
   - 活躍安裝
   - 評分和評論
   - 崩潰率

### 監控指標

| 指標 | 目標 | 說明 |
|------|------|--------|
| 崩潰率 | < 0.1% | 異常終止的會話百分比 |
| ANR 率 | < 0.05% | 應用無響應事件 |
| 保留率（D1） | > 40% | 安裝後 1 天內仍在使用的用戶 |
| 保留率（D7） | > 20% | 安裝後 7 天內仍在使用的用戶 |
| 評分 | > 4.0/5.0 | 平均用戶評分 |

---

## 回滾程序

### 何時進行回滾

- 發現影響大多數用戶的嚴重崩潰
- 數據丟失或損壞問題
- 安全漏洞
- 影響關鍵功能的 bug

### 回滾步驟

#### App Store 回滾

1. 登錄 App Store Connect
2. 轉到應用 > **Version Release**
3. 選擇有問題的版本
4. 點擊 **Remove from Sale**（如適用）
5. 向用戶發送通知（應用內或電子郵件）
6. 快速修復問題並發佈新版本

#### Google Play 回滾

1. 登錄 Google Play 管理中心
2. 轉到應用 > **Release** > **Production**
3. 選擇有問題的版本
4. 點擊 **Unroll release**
5. 確認操作
6. 向用戶發送通知
7. 快速修復問題並發佈新版本

### 回滾通信

1. **立即通知用戶**
   - 應用內橫幅或彈出窗口
   - 電子郵件通知
   - 社交媒體更新

2. **解釋問題**
   - 簡要說明發生的情況
   - 不要指責用戶

3. **提供解決方案**
   - 更新可用時通知用戶
   - 提供修復的預期時間表
   - 提供支持聯繫信息

---

## 修復程序

### 熱修復 vs 常規更新

| 方面 | 熱修復 | 常規更新 |
|------|--------|---------|
| 用途 | 關鍵 bug | 功能、增強功能 |
| 發佈模式 | 緊急 | 計劃 |
| 版本凸起 | 修補版 | 次要版或主要版 |
| 測試時間 | 最小 | 完整 |
| 發佈時間 | 數小時 | 計劃 |

### 熱修復流程

#### 1. 識別和評估

```bash
# 檢查最近的崩潰報告
# 驗證問題的範圍
# 評估用戶影響
```

#### 2. 快速修復

```bash
# 簽出 main 分支的最新版本
git checkout main
git pull origin main

# 創建修復分支
git checkout -b hotfix/critical-bug-fix

# 進行必要的修復
# 最小化變更，僅解決問題
```

#### 3. 最小測試

```bash
# 運行相關測試
pnpm --filter mobile test --testPathPattern=critical-feature

# 在實際設備上手動測試修復
```

#### 4. 版本凸起

```bash
# 凸起修補版本
pnpm version:patch

# 提交和標籤
git add .
git commit -m "fix: resolve critical bug"
git tag v$(node -p "require('./apps/mobile/app.json').expo.version")
git push origin hotfix/critical-bug-fix
git push origin v$(node -p "require('./apps/mobile/app.json').expo.version")
```

#### 5. 快速構建和提交

```bash
# 通過 GitHub Actions Release 工作流
# 或運行本地命令：
pnpm --filter mobile exec eas build --platform all --profile production
pnpm --filter mobile exec eas submit --platform ios --latest --non-interactive
pnpm --filter mobile exec eas submit --platform android --latest --non-interactive
```

#### 6. 審查和發佈

```bash
# 在 App Store Connect 和 Google Play 控制台中加快審查
# 添加關於緊急修復的說明
# 優先級安排：將其設置為解決關鍵問題
```

#### 7. 驗證和通信

```bash
# 一旦發佈，立即監控崩潰率
# 向用戶推送通知有關修復
# 發送發佈說明
```

---

## 最佳實踐

### 發佈前

- [ ] 始終在 staging 環境中測試
- [ ] 進行代碼審查
- [ ] 檢查依賴項更新
- [ ] 驗證所有環境變量

### 發佈期間

- [ ] 監控工作流執行
- [ ] 檢查構建日誌中的警告
- [ ] 驗證應用 ID 和版本號
- [ ] 確保所有資產都已上傳

### 發佈後

- [ ] 監控崩潰率和錯誤
- [ ] 查看用戶反饋和評論
- [ ] 跟踪下載和保留指標
- [ ] 計劃下一版本的改進

### 溝通

- 在發佈後通知利益相關者
- 準備發佈說明
- 記錄已知問題或限制
- 提供用戶支持聯繫信息

---

## 故障排除

### 構建失敗

**問題**：EAS 構建失敗
**解決方案**：
1. 檢查構建日誌中的特定錯誤
2. 驗證所有環境變量設置正確
3. 確保依賴項正確安裝
4. 嘗試清理和重新安裝：`pnpm install --frozen-lockfile`

### 提交失敗

**問題**：提交到 App Store 或 Google Play 失敗
**解決方案**：
1. 驗證 API 密鑰和證書
2. 檢查應用 ID 和包名
3. 確保應用版本號遞增
4. 驗證所有必需的字段已填充

### 審查被拒

**問題**：應用被應用商店拒絕
**解決方案**：
1. 閱讀拒絕原因詳情
2. 解決所有指出的問題
3. 凸起修補版本
4. 重新提交並添加解決說明

---

## 聯繫和支持

如有問題，請聯繫開發團隊或查閱以下資源：

- **Expo 文檔**：https://docs.expo.dev
- **EAS 文檔**：https://docs.expo.dev/eas
- **Apple Developer**：https://developer.apple.com
- **Google Play**：https://developer.android.com

---

最後更新：2026 年 3 月
