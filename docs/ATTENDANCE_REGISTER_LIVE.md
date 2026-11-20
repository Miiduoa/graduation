# 全班名冊自動更新

## 操作與範圍

教師在課堂點名工作台展開「全班出席」，預設仍是手動查核。主動開啟「自動更新全班名冊」後，單一場次的學生出席、教師補登及目前修課成員會更新，不必重新載入全頁。

沿用既有名冊篩選、搜尋、30 人分批顯示、明確確認更正與 CSV；一般資料更新不重建訂閱，不清掉搜尋條件。CSV 始終是按下匯出時的查核快照，不是持續更新的檔案。

## 安全與生命週期

- 首先監聽目前登入者的課程成員文件，只有伺服器確認的 active owner/instructor 才訂閱私有名冊資料。Firestore Rules 仍為實際讀取權限的權威，不變更任何規則或寫入交易。
- 等待場次、目前有效成員與出席紀錄三份伺服器快照；不接受快取或待提交本機寫入作為已確認狀態。這三份訂閱並不是同一時間點的原子讀取。
- 收合、離頁、背景、離線、帳號切換、授課角色失效與訂閱錯誤時停止相關監聽。未確認、離線及錯誤時不顯示舊名冊，也不提供其匯出或更正按鈕。
- 返回前景或恢復連線重新驗證資格及資料。online 事件本身不算同步成功；舊回呼不可重新填回資料。
- 原有更正表單及交易的確認與驗權限流程不變。名冊更新本身不寫入出席。

## 用量與不完整資料

每個開啟中的場次只有一個授課成員文件監聽及三個資料監聽，不逐人讀取，也不定時輪詢。預設關閉此選項，並在操作前提示資料庫額度；Firestore 監聽仍可能產生計費讀取，不能宣稱免費。

有效成員與出席紀錄各最多查詢 501 筆：使用前 500 筆，額外一筆判定是否截斷。成員包括符合 active 查詢的教師等角色，不假稱上限就是 500 位學生。若成員截斷，以「已讀取修課」呈現，提示改用手動查核；出席紀錄未讀完時未找到的紀錄標成待核實。只要任何一份截斷就禁止匯出，不推算缺席。

單筆收據身分、狀態、來源及時間沿用 `assembleAttendanceRegister` 嚴格驗證；缺少紀錄不是缺席。沒有跨校官方資料回寫、沒有 GPS 或防代簽的新承諾。

## 驗證

新增 `watchAttendanceRegister.test.ts` 及 `AttendanceRegisterLive.test.tsx`，涵蓋授權先後、更新不重建監聽、快取／pending writes、角色與帳號切換、收合／背景／斷線、兩類資料上限、搜尋篩選保留、手動回復及不完整資料禁止匯出。

```sh
pnpm --filter web exec vitest run src/lib/watchAttendanceRegister.test.ts src/components/AttendanceRegisterLive.test.tsx src/components/AttendanceRegisterPanel.test.tsx src/components/AttendanceRegisterCorrection.test.tsx
pnpm --filter web typecheck
pnpm --filter web lint
```

本次工作環境已實際執行轉譯後服務與原始名冊驗證器的 32 項 Node 檢查、41 種班級人數資料流檢查。Firebase 與瀏覽器介面為受控替身；不是 Firestore emulator、完整 React 或真實帳號驗收。另以最小 SDK 型別宣告進行服務 strict TypeScript 檢查，不能替代專案 CI 的正式 SDK 型別檢查。

發布前仍須在 HTTPS 測試環境，使用教師及學生兩個測試帳號確認：學生簽到後列狀態更新、教師補登與撤銷成員更新、斷線／背景停止、帳號切換不殘留名冊、實際 Firestore Rules 拒絕未授權讀取。未完成不能宣稱正式發布或全面超越其他平台。
