# nuni 網站設計品質檢查

目的：保留 nuni 現有視覺語言，避免新功能反覆引入制式模板、低品質動畫或手機操作問題。參考 Nutlope/hallmark 的設計紀律；不安裝第三方腳本，也不把外部工具當成已驗證的品質保證。

來源：https://github.com/Nutlope/hallmark
影片：https://www.instagram.com/reel/DfiXmHBlMbL/ （2026-11-09）

## 本輪具體改動

- 共用字體移至 --font-ui token；保留 nuni 的系統／繁中字體。
- html、body 使用 overflow-x: clip；各模組如需橫向捲動，必須自己處理，不可用剪裁掩蓋內容問題。
- 公告篩選、分類及卡片操作按鈕改為明確的過渡屬性，不再寫 transition: all。
- 公告分類選取邊框使用既有 --brand 變數，不再硬編碼紫色。
- 保留現有的 :focus-visible 與 prefers-reduced-motion；這兩項不是本輪新建的功能。
- 新增 scripts/ui-design-gate.mjs、Node 測試及 CI：阻擋後續新增 CSS 的 transition: all。
- 未登入的「今天」首頁移除標題上方重複的裝飾性標籤，以及連結後多餘的箭頭；保留原有的匯入課表、手動建課、校園服務及登入導覽。

## 自動測試（不需安裝第三方依賴）

- node --test scripts/ui-design-gate.test.mjs
- node scripts/ui-design-gate.mjs
- node scripts/ui-design-gate.mjs --base HEAD^1

檢查器目前只驗證共用樣式基礎和新增 Web CSS 的 transition: all。通過不代表已滿足 Hallmark 全部規則，也不能取代瀏覽器實機測試。

## 合併前的人工驗收（尚未完成）

1. 以 320、360、375、414、768、1024、1280、1920 px 檢查首頁、公告、課表、社群、AI 助理與個人頁，確認無頁面左右溢出且模組橫向捲動正常。
2. 使用 Tab、Shift+Tab、Enter、Space 驗證跳轉主要內容、導覽、篩選、表單、Dialog 的焦點可見，且不被 viewport clip 裁掉。
3. 系統減少動態與 nuni 低動態設定下，載入、切換及對話框不依靠動畫才會顯示內容。
4. 明暗主題、不同學校資料與長文字下，確認標題、空狀態、CTA 與重要提醒層級清晰。
5. 所有文案、圖像、數字與功能宣稱皆須有真實產品資料來源，不可自行編造使用人數、成績或承諾。
6. 錄製實際使用流程，與各功能直接競品在同情境下比較；不能因規則通過而宣稱超越競品。

本 PR 不代表已完成上述驗收，不涉及 React Native 原生介面，不應在實機確認前直接合併或部署。
