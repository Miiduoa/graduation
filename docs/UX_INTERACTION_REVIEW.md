# Web 互動維護

更新日期：2026-10-12。對應 PR #31，範圍為個人課表、校園選擇器與共用確認視窗。

## 課表

儲存未成功確認時，保留編輯內容與匯入草稿。送出期間鎖定相關欄位，避免重複寫入；匯入至少需要勾選一門課。讀取失敗時提供重試入口。

工作區依帳號與校園區分。切換時清除上一個工作區的私有內容，舊請求回傳後不更新新工作區。修改文字或選擇新的匯入來源後，忽略先前的截圖辨識結果。

分享連結建立與剪貼簿寫入分開處理。複製失敗時顯示可選取的連結；只有剪貼簿寫入成功才顯示「已複製」。本機儲存與雲端同步須分別提示，好友可見狀態以雲端資料為準。

## 確認視窗

使用原生 `dialog.showModal()`，並管理焦點返回與巢狀視窗的捲動鎖。確認視窗初始聚焦取消按鈕；等待 `onConfirm` 回傳的 Promise 或外部 `loading` 時，不接受重複送出或關閉操作。呼叫端須回傳操作的 Promise，或維持正確的 `loading` 狀態。

內容區獨立捲動，標題與操作列保留在視窗內。窄螢幕使用堆疊按鈕，關閉按鈕為 44px，並處理動態視窗高度、安全區及減少動態效果偏好。發布前須確認目標瀏覽器支援原生 modal dialog。

## 校園選擇器

搜尋支援台／臺、全形英數、大小寫與多關鍵字。搜尋只篩選目錄，不改變目前校園；保留的原選擇須另行標示，不計入符合數量。清除搜尋後返回輸入框，選定校園或焦點離開時收起選單；中文組字中的 Esc 不關閉選單。

## 回歸測試

測試檔位於 `apps/web/src/components/`：

- `timetable/PersonalTimetable.test.tsx`：草稿保留、讀取重試、帳號切換、分享回饋。
- `ui/Modal.test.tsx`：焦點、捲動鎖、關閉操作、非同步送出。
- `SchoolSelector.test.tsx`、`SchoolSelector.search.test.ts`：搜尋比對、原選擇保留、選單操作。

完整 Web 測試：

```sh
pnpm --filter web exec vitest run --coverage
```

## 驗證紀錄

`c0870a6` 的 [CI 紀錄](https://github.com/Miiduoa/graduation/actions/runs/38190824927)：Web 821 項通過、1 項既有案例略過；本次新增 45 項全部通過。Web server lifecycle 16 項通過。Lint、型別檢查、Functions Tests、Mobile Tests、Security Gates 及 Web 建置與 standalone runtime 驗證通過。

Firestore 規則／交易整合測試仍未通過。已定位的問題在點餐交易測試環境：只啟動 Firestore／Storage emulator 的 Node 程序未設定 `FUNCTIONS_EMULATOR` 或 `JEST_WORKER_ID`，點餐總開關因此預設關閉。正式接單設定與資料庫規則未在本 PR 調整。

上述結果僅對應 `c0870a6`。後續提交以各自的 CI 結果為準。PR 尚未合併或部署；Safari／iOS 真機、螢幕閱讀器與實際業務流程仍待驗收。
