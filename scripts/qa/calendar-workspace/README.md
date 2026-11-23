# 行事曆操作流程驗收

這個 fixture 打包真實 `PersonalCalendar`、`MonthCalendar`、`usePersonalImports`、
`personalImports` 與產品 CSS。新增、編輯、驗證、儲存、Web Locks、草稿與焦點行為均沿用產品程式。

只有登入身分、選校、LMS 待辦資料與 Next 連結／網址 hook 被明確替換；外框為隔離驗收頁，
不代表完整 Next router、首頁、OAuth、雲端同步、校方 API 或正式帳號流程。
所有事件皆標示為合成資料，寫入僅發生於本機瀏覽器的隔離 localStorage。
一次性儲存錯誤由 Storage 邊界注入，不替換產品的儲存實作或錯誤處理。

## 執行與證據

在既有 GitHub Actions runner 安裝依賴後執行：

```sh
node scripts/qa/calendar-workspace/build.mjs
python scripts/qa/calendar-workspace/check.py
```

`artifacts/calendar-workspace` 包含真實 bundle、來源 SHA256、每個情境的檢查結果、
畫面截圖、主控台／頁面錯誤和寫入紀錄。`source-sha256.json` 記錄打包提交，
PR workflow 會 checkout 對應來源，結果應與該提交一起判讀。
PR 事件固定檢查 `pull_request.head.sha`；手動執行則檢查所選 ref 的 `github.sha`。

涵蓋桌面淺色、390px 深色手機、320px／200% 字級／減少動態，檢查選日與列表、
新增／保存、取消與焦點、儲存失敗草稿、跨月鍵盤、切校及切帳號隔離。
這些 Chromium 介面情境不等同 Safari、VoiceOver 或 iPhone／Android 原生真機驗收。
