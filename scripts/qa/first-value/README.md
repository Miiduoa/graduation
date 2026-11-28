# 首次價值與回訪入口瀏覽器驗收

此 fixture 直接使用 `StudentToday`、`TodayWelcome`、`TodayClassRows`、`TodayUnreadNotifications` 與產品 CSS。只將 Next routing、登入／校園 provider、課程與通知資料來源換成明確的合成邊界，不使用正式帳號，不呼叫正式 API。

```bash
node scripts/qa/first-value/build.mjs
python scripts/qa/first-value/check.py
```

Python 使用 Playwright 1.57.0；可用 `CHROMIUM_EXECUTABLE_PATH` 指定既有 Chromium。CI 安裝鎖定依賴、Chromium 與 Noto CJK 字型，並保存實際執行版本的來源 SHA-256、JSON 結果與畫面。

覆蓋 320px 淺色、390px 深色、1280px 淺色、200% 文字與兩種減少動態偏好。驗證已登入新手、已存在作業、週末已有課表、讀取與錯誤恢復、未指定校園、訪客、切校與切帳號、真實連結目的地、鍵盤焦點、44px 互動高度與無水平溢位。

初次尚未完整讀取資料與已有完整結果的背景更新分開驗證。背景更新直接觸發合成資料模型，不點擊驗收控制按鈕；因此可檢查原本聚焦的行事曆／公車節點仍是同一個 DOM，焦點沒有被更新搶走。

CI 另執行首頁、通知、PWA 加入主畫面與設定整合的 9 個 Vitest 檔案，將結果寫入 `unit-tests.json`。瀏覽器 fixture 專注首頁，不把 Vitest 的 PWA 覆蓋宣稱為實體瀏覽器安裝成功。

助理輸入是刻意標示的合成 `assistant` prop，只驗證 `StudentToday` 在相同帳號／校園更新時不卸載子元件。它不代表正式助理 API、完整對話、跨帳號草稿隔離、真實資料匯入、正式留存率或登入端到端驗證。跨帳號正式助理邊界仍由 `HomePage` 負責。

輸出位於 `artifacts/first-value/`，不應將合成驗收截圖當成正式使用者資料或正式服務完成證據。
