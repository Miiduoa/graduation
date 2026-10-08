# 課程教室 QR 點名

這條流程使用 `groups/{groupId}` 的課程教室，不是 TronClass 點名，也不是 `smartAttendanceEngine` 的舊示範流程。

## 執行入口

Functions 的 `package.json` 改由 `entry.js` 載入。它保留 `index.js` 的其他匯出，只以 `lib/liveAttendance.js` 取代 `startLiveSession`、`endLiveSession`、`joinLiveSession` 並補上 `verifyAttendanceClaim`。`index.js` 沒有被大量改寫；四個點名端點的實際部署來源是 `entry.js`，不是舊函式區塊。入口測試會確認這項設定。

## 教師與學生

既有 `AttendanceMultiMethodScreen` route 中，教師／教授顯示 `TeacherAttendancePanel`，學生顯示完整 QR 輸入與伺服器收據。route 的 `groupId`（或既有 `courseId`）必須是 Firestore 課程教室 ID；不得從外部 LMS 課號猜測。

教師開啟五分鐘點名後才會顯示伺服器回傳的 token。token 只留在記憶體，不會從群組 snapshot 或 AsyncStorage 還原。畫面顯示點名編號、QR、完整文字及已登記人數。App 不在前景、QR 過期、狀態查核失敗或使用者換帳號時停止顯示。這不是防截圖功能。

學生必須在相同課程填入點名編號和完整 token。目前仍以貼上文字完成，不宣稱有 App 相機掃描或自動 deep-link。伺服器收據必須符合目前帳號、課程與 session 才顯示成功。教師結束點名也必須取得對應的伺服器確認。

QR 遺失／建立回應遺失時，可以從最近 20 次課堂 session 中選取自己開啟的點名，或輸入已知編號查核，再結束重開。不會盲目重試建立；伺服器目前未提供 start-request 冪等 key。這個限制不可包裝成已完成的離線復原功能。

## 後端規則

- 開始與結束點名須具有效群組 owner/instructor 資格。結束限定原建立者；資格在交易內重查。
- 新增出席限定有效 member。身分來自 `request.auth.uid`，登記時間來自伺服器。
- QR token 為 24 隨機 bytes 的 base64url，文件只保存 SHA-256 摘要。舊含明文 token 的 session 不接受新簽到，需先結束重開；相容舊 live 文件缺少 groupId 的情況，但只允許原建立者且須核對鏡像文件後結束。
- live-session 與 attendance-session 的開始／結束同筆交易寫入。學生紀錄、出席計數也同筆交易寫入。
- 重試讀回第一次收據，不改時間、不重算人數、不覆寫教師人工判定。已登記學生持原 token 可在 session 結束後重讀自己的原收據；這不是新簽到。
- 進入課堂不等於出席。無 QR 的 `joinLiveSession` 不建立 attendance record。
- 推播在開始點名提交後發送；不包含 token，失敗不會將已建立的點名誤報成建立失敗。

## QR 編碼

`attendanceQr.ts` 限定 32 個 ASCII base64url 字元，使用 QR Model 2 version 3-M、byte mode、mask 0。畫面保留四格 quiet zone。沒有沿用舊示範用的 `PureQRCode` 產生器，也沒有新增執行時套件。

`python3 scripts/check-attendance-qr.py apps/mobile/src/services/attendanceQr.ts` 會產生 64 組固定測試向量，逐格比對 python-qrcode，再由 OpenCV 解碼同一份矩陣。需要本機開發依賴 qrcode、numpy、opencv-python；不是 App 執行依賴，也不是手機相機測試。

## 驗證

`Attendance focused checks` workflow 使用 Node.js 22.16.0，無雲端憑證、無資料庫連線，執行後端、收據、教師狀態及跨端流程測試。交易測試使用 `test-support/transactionStore.js`，不是 Firestore emulator。

一般 CI 仍須通過 Mobile Jest、Functions Jest、型別及 lint。Functions Jest 中四項跨 runtime 測試可能略過；專用 focused workflow 會實際執行它們，不以 skipped 當通過。

## 上線前的限制

仍需在測試 Firebase 專案及真機走教師開啟、學生輸入、關閉、換帳號、權限撤銷與斷線情境。其他舊教師／Web QR 入口尚未全部整合，不可直接宣稱整個校園點名系統完成。QR 持有人能轉傳 token；本版不能證明實體到場。GPS、自拍活體辨識、TronClass 寫入與離線補傳均不在本次範圍。

參考：Firebase 官方 callable 與 transaction 文件。相關 SDK 確認方式不等於已通過線上驗收。
