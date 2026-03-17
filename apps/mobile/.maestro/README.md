# Maestro E2E 測試

本專案使用 [Maestro](https://maestro.mobile.dev/) 進行端到端測試。

## 安裝 Maestro

```bash
# macOS / Linux
curl -Ls "https://get.maestro.mobile.dev" | bash

# 或使用 Homebrew
brew tap mobile-dev-inc/tap
brew install maestro
```

## 執行測試

### 執行所有測試

```bash
cd apps/mobile
maestro test .maestro/flows/
```

### 執行單一測試

```bash
maestro test .maestro/flows/01_onboarding.yaml
```

### 執行特定標籤的測試

```bash
# 執行 smoke 測試
maestro test --tags smoke .maestro/flows/

# 執行 auth 相關測試
maestro test --tags auth .maestro/flows/
```

### 在特定裝置上執行

```bash
# iOS 模擬器
maestro test --device ios .maestro/flows/

# Android 模擬器
maestro test --device android .maestro/flows/

# 指定特定裝置
maestro test --device "iPhone 15 Pro" .maestro/flows/
```

## 測試流程

| 檔案 | 說明 | 標籤 |
|------|------|------|
| `01_onboarding.yaml` | 首次使用引導流程 | smoke, onboarding |
| `02_authentication.yaml` | 登入註冊流程 | smoke, auth |
| `03_announcements.yaml` | 公告列表與詳情 | smoke, announcements |
| `04_events.yaml` | 活動列表與報名 | smoke, events |
| `05_map.yaml` | 地圖與 POI | smoke, map |
| `06_cafeteria.yaml` | 餐廳菜單 | smoke, cafeteria |
| `07_me_features.yaml` | 我的頁面功能 | smoke, me |
| `08_settings.yaml` | 設定功能 | smoke, settings |
| `09_messages.yaml` | 訊息與群組 | smoke, messages, groups |
| `10_full_user_journey.yaml` | 完整使用者流程 | regression, journey |

## 測試環境變數

在 `.maestro/config.yaml` 中設定：

```yaml
env:
  TEST_EMAIL: test@example.com
  TEST_PASSWORD: testpassword123
  SCHOOL_CODE: NCHU
```

## 截圖輸出

測試截圖會儲存在 `.maestro/screenshots/` 目錄中。

## CI/CD 整合

### GitHub Actions

```yaml
- name: Run Maestro Tests
  uses: mobile-dev-inc/action-maestro@v1
  with:
    app-file: app.apk
    flow: .maestro/flows/
```

### 產生測試報告

```bash
maestro test --format junit --output test-results.xml .maestro/flows/
```

## 除錯技巧

### 使用 Maestro Studio

```bash
maestro studio
```

這會開啟互動式介面，可以：
- 即時預覽畫面元素
- 測試單一指令
- 產生測試腳本

### 增加日誌輸出

```bash
maestro test --debug .maestro/flows/01_onboarding.yaml
```

### 錄製測試

```bash
maestro record .maestro/flows/new_test.yaml
```

## 常見問題

### 元素找不到

1. 確認元素有正確的 `accessibilityLabel` 或 `testID`
2. 使用 `maestro studio` 檢查元素結構
3. 增加 `timeout` 等待時間

### 測試不穩定

1. 使用 `extendedWaitUntil` 取代固定等待
2. 增加重試次數 (`retry.maxAttempts`)
3. 確保測試資料的一致性

### 截圖失敗

確認 `.maestro/screenshots/` 目錄存在且有寫入權限。
