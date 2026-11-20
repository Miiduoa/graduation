# 空堂查詢瀏覽器驗收

在專案根目錄執行，需已安裝專案依賴及 Python Playwright 的 Chromium：

```sh
node scripts/qa/class-gap-followups/build.mjs
python scripts/qa/class-gap-followups/check.py
```

也可用 `QA_CHROMIUM_EXECUTABLE` 指定已安裝的 Chromium。輸出截圖與 `browser-check.json` 位於 `artifacts/class-gap-followups/`。

這個固定時間與合成課表的頁面使用正式 `ClassGapReplyCard`、空堂語句解析、追問條件更新、課表空堂計算及回答組合。驗收涵蓋 390px 淺色和 320px 深色：一個半小時、改三點半以後、改查後天保留條件、不限長度、查看全天、歷史回覆與來源按鈕，以及鍵盤操作、44px 點擊範圍、水平溢位、頁面錯誤與意外網路連線。

只替換未使用的原生圖示和安全區域介面，未模擬查詢結果。測試沒有登入、個人課表讀取、原生裝置、真實校務服務或模型呼叫，不能代替這些整合驗證。
