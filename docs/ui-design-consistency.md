# nuni Web UI 一致性檢查

本輪從最新 main 的現行首頁進行修正，不套回舊版 Welcome 設計。

## 本輪修復
- 全站共用字體使用 `--font-ui`，保留繁體中文的系統字型退回鏈。
- 品牌 pill、今日提醒、公告分類、AI 引導及上課情境卡片邊框使用 `--brand`，不再硬編碼舊紫色；時段專屬漸層保留其語意配色。
- 公告頁的三組互動按鈕從 `transition: all` 改成指定背景、顏色、邊框、陰影，統一 `--motion-fast` 與 `--ease-out`。
- TodayWelcome 保留新版首頁，統一按鈕 radius 與不必要的裝飾箭頭；移除未逐一證實的「免登入」宣稱，不更動課表、四項校園服務或登入的導覽路徑。
- 移植並調整舊 #571 的 UI gate 與首頁 DOM 回歸測試。未套回舊版 Welcome 佈局，也不使用 root `overflow-x: clip` 掩蓋真實橫向溢出。

## 自動檢查
```sh
node --test scripts/ui-design-gate.test.mjs
node scripts/ui-design-gate.mjs
node scripts/ui-design-gate.mjs --base HEAD^1
```
CI 在 Lint & Type Check job 執行 UI gate，檢查字體、焦點、減少動態、首頁連結焦點及新 CSS 的 `transition: all`。這只能阻擋部分可程式化回歸，並非完整視覺驗收。

## 人工驗收清單（未宣稱已通過）
- 以 320、360、375、414、768、1024、1280、1920 px 瀏覽首頁、公告、課表、社群、AI 助理，檢查長文字與橫向捲動。
- 明暗模式核對品牌邊框、對比、焦點；啟用減少動態並使用鍵盤導覽。
- 使用 iOS Safari 與 Android Chrome 驗證觸控、縮放和溢出，避免僅靠桌機截圖驗收。
- 必須以本 PR 的精確 head 驗證 CI、Web Build、CodeQL 與 GitHub App 審查；不能沿用舊 #571 綠燈。
