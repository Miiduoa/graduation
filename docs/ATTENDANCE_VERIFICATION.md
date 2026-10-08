# 簽到驗證範圍

這次接的是 Firebase 即時課堂的 **QR 簽到**，不是 TronClass 點名，也不是自拍、定位或六位旋轉碼示範引擎。

## 資料怎麼走

`startLiveSession` 建立 `groups/{courseId}/liveSessions/{sessionId}`，並建立對應的 `attendanceSessions` 紀錄。學生端的 `courseSpaceSource.checkInAttendance` 將完整 QR token 送到 `verifyAttendanceClaim`，不再以 `joinLiveSession` 回傳的加入成功當作出席證明。

新的 callable 由 `backend/functions/entrypoint.js` 註冊，區域是 `asia-east1`。原本的 `index.js` 所有 exports 保留；package.json 的 main 指向新的集中入口，沒有重新初始化 Firebase App。

伺服器會在 Firestore transaction 中讀取課程、目前的成員資格、課堂、點名場次與此學生的既有紀錄。帳號以 Firebase 驗證後的 `request.auth.uid` 為準；若 client 另帶不同的 claim.uid，直接拒絕。課程 ID 必須是確切的 group document ID，不會拿姓名或 TronClass ID 猜對應。

首次簽到需要 active 成員資格、學生類型角色、有效場次、完整 QR 和伺服器時間範圍。驗證與寫入共用同一 transaction；成員退出或場次關閉造成衝突時，重試必須重讀條件。

## 簽到回條

成功回應只在 transaction commit 後回傳：

```json
{
  "valid": true,
  "attendanceRecorded": true,
  "status": "present",
  "uid": "student-1",
  "courseId": "course-1",
  "sessionId": "class-1",
  "checkedInAt": "2026-10-08T06:30:00.000Z",
  "alreadyRecorded": false
}
```

這是合成範例，不是真實學生紀錄。行動端會再核對課程、場次、帳號與明確的已寫入狀態，才回傳 success 與觸發 companion 提示；只有 `{success:true}` 或加入課堂成功均不算簽到完成。

相同帳號重送會取回原來的回條，不再次增加人數，也不修改第一次簽到時間。這包含「資料已寫入但回應遺失，等 QR 過期才重試」的情境。若教師已把紀錄改為請假等其他狀態，不會被學生重試覆寫。重送取得回條仍需有效課程成員身分。

## 如何驗證

根目錄執行：

```sh
node --test backend/functions/attendance/verifyClaim.test.js
pnpm --filter mobile test --runTestsByPath src/__tests__/services/confirmedAttendance.test.ts src/__tests__/services/courseSpaceAttendance.test.ts
pnpm -w firebase emulators:exec --only firestore --project demo-campus-attendance "node --test backend/functions/attendance/verifyClaim.emulator.cjs"
```

第一組是帶樂觀交易替身的 handler 測試，包含並行重送、成員撤銷、錯誤 QR、冒用 UID、資料庫提交失敗。第三組才使用真正的 Firestore emulator，直接執行相同的 handler，驗證並行請求只建立一筆紀錄及一次計數；測試限制為 loopback emulator，不能對正式資料庫執行。這不是手機相機、實機登入或校務端的端到端驗收。

`.github/workflows/attendance-check.yml` 負責獨立的 QR transaction 檢查，不會部署 Functions。一般 CI 的主分支部署政策另行保留。

## 還不能宣稱什麼

- 這份修正沒有部署到正式 Firebase，也沒有替使用者設定憑證。
- `AttendanceMultiMethodScreen` 的六位碼、本機設定、定位及自拍仍不是上述完整 QR token 工作流程；不能把同名 callable 的存在當成五種方法均已接通。
- QR 可以被轉傳，且現有 `liveSessions` 讀取規則讓 active 群組成員讀到整份課堂文件。此流程提供帳號、場次與資料一致性檢查，**不證明學生實際在教室內**；要提高防代簽能力，需要另設限權挑戰資料與相應的產品／隱私設計。
- 原本 `joinLiveSession` 仍供其他課堂入口使用；本次保證的重送語意僅適用於新的 `verifyAttendanceClaim` 路徑。
- 沒有離線佇列、自動補傳、TronClass 成績寫入或人臉活體驗證。網路錯誤不能被改寫成成功。
