# README 元件展示

用目前 checkout 的手機正式元件產生靜態展示，供 [專案截圖](../../docs/SCREENSHOTS.md) 重拍。這是文件用的受控資料入口，不是另一份 App，也不是端到端測試。

## 建置與開啟

先依根目錄指引安裝 workspace 依賴，再執行：

```bash
node scripts/docs-preview/build.mjs
```

產物在 `artifacts/docs-preview/`，不納入版本控制。一般本機環境可只對該產物目錄啟動 HTTP 預覽：

```bash
python3 -m http.server 8871 --bind 127.0.0.1 --directory artifacts/docs-preview
```

開啟 `http://127.0.0.1:8871/`；用完以 Ctrl-C 停止。遠端工作環境應使用該環境提供的預覽轉接，不假設其他主機的 localhost 指向同一台機器。

| 頁面                                                        | 內容                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `index.html`                                                | 展示目錄與來源版本                                        |
| `gallery.html`、`gallery-dark.html`                         | 課業計畫、已儲存計畫、準備行程確認並列                    |
| `phone-plan.html`、`phone-saved.html`、`phone-confirm.html` | 個別 390 × 844 展示框                                     |
| `plan.html`、`saved.html`、`confirm.html`                   | 直接開啟元件；可加 `?theme=dark`                          |
| `saved-plans-preview.html`                                  | 保留原有 `scripts/qa/saved-campus-plans/fixture.tsx` 情境 |

## 資料與原生替身

`fixture.tsx` 直接引用正式畫面元件，提供虛構作業、課程、日期與計畫。確認畫面使用正式的 `prepareCourseworkStudyDraft` 建立預覽；不修改正式元件的文字或 CSS，也不合成成功回執。

展示刻意限制外部操作：

- 平台 API callback 不連線；未實作的讀取回傳不可用，導頁只記錄事件。
- Firebase 初始化與資料 API 停用。
- AsyncStorage 以記憶體 Map 代替，不存取真實裝置資料。
- 安全區為零，Ionicons 與原有 QA 一樣省略；不使用原生登入、提醒或作業導覽。
- 合成資料的 `Date.now` 固定於 2026-11-08 10:00（台灣時間）。

`manifest.json` 保存來源 commit、應用程式未提交修改狀態、實際輸入檔案 SHA-256、依賴版本與替身清單。它記錄建置來源，不宣稱登入、API、原生裝置或真正寫入已通過驗證。

截圖使用者應另行檢查版面、擷取圖片並記錄日期。若要展示任務成功，應改用可核對的完整測試環境，而不是在這份 fixture 補一張假的成功卡。
