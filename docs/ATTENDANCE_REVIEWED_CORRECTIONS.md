# 出席更正：核對目前紀錄與衝突處理

## 問題與操作

兩位教師可能同時開啟同一位學生的更正表單。資料庫交易能保護計數與稽核一起寫入，但原本仍容許後送出的舊畫面覆蓋較新核定。

新版選擇學生後，從伺服器讀取目前狀態、紀錄來源及版本，顯示「目前已保存 → 本次將核定」。未核對完成前不允許送出；失敗不推定為尚無紀錄。

每筆新版表單請求攜帶 expectedRevision。Firebase Functions 與 Web 同源處理器在既有交易裡，確認校籍、授課身分、修課資格及帳號狀態後，比對目前版本。不同則回傳 aborted，沒有出席、計數或稽核的部分寫入。介面保留原因和擬定狀態，重新核對，必須再次明確確認；不自動覆寫。

## 版本與重送契約

- null 表示核對時沒有個人收據。已存在但沒有 revision 欄位的舊收據視為第 0 版；兩者不可混為一談。
- 每次人工更正會遞增 revision，並將 previousRevision 與 revision 保存於稽核。QR 首次建立仍可使用既有第 0 版語意。
- 相同操作編號和相同內容的重送，先核對權限及既有稽核，再回傳已完成結果；不因第一次成功已增加版本而重複寫入或誤報衝突。
- 新版重送識別包含 expectedRevision。沿用相同操作編號卻改變已核對版本時拒絕，不把另一筆修改當成重送。
- 既有稽核及舊版請求的識別保持相容；不執行歷史資料遷移。異常版本型別、負數或溢位拒絕寫入。

## 相容與發布限制

expectedRevision 在後端暫時為選填，以維持既有客戶端相容；新版 Web 表單一律提供。舊客戶端未提供時仍可更正且會增加版本，因此新版表單能偵測其變更，但不能宣稱舊客戶端本身也有防覆寫確認流程。後續要全面強制，須先完成所有客戶端升級及相容盤點。

採用獨立 Firebase Functions 的環境，必須先部署並驗證新版後端，再發布新版 Web 表單。舊後端會忽略未知欄位，僅發布新畫面不能提供交易層保護。Web 同源處理器與前端一起建置，仍須驗收部署是否使用正確端點。

這個變更不修改 Firestore Rules、不回寫學校教務紀錄、不處理管理者繞過服務直接改寫的資料，也不宣稱目前已部署正式版。

## 測試

```sh
pnpm --filter web exec vitest run src/lib/attendanceCorrectionReview.test.ts src/components/AttendanceCorrectionConflict.test.tsx src/components/AttendanceCorrectionPanel.test.tsx src/components/AttendanceRegisterCorrection.test.tsx src/lib/server/attendanceRevision.test.ts
pnpm --filter functions exec jest attendanceSessions.test.js --runInBand
pnpm --filter web typecheck
pnpm test:rules
```

新增服務核對、真實 React 元件互動及 JS／TS 後端契約案例，保留原有測試斷言。既有 localhost Firestore emulator 套件增加四個案例：不同教師同時更正、相同請求同時重送、讀取空紀錄後學生完成掃碼、較新請假核定不能被舊畫面覆蓋。此套件使用 demo-campus-attendance，不對正式資料執行測試。

本地已用受控 SDK／資料庫替身重現原始覆寫問題；修正後兩套後端各通過 28 項檢查及 16 種狀態轉換。這不是實體瀏覽器或 Firestore emulator 驗收，完整結果以本提交 CI 的實際輸出為準。

發布前須在 HTTPS 測試環境以兩個有效教師帳號同時開啟同一學生，確認第二筆舊畫面送出不覆寫、理由保留、新狀態可比較，以及再次確認後才保存。另驗證斷線重送仍只有一筆稽核，和教師資格撤銷後無法使用已開啟的表單。
