# QR 點名舊合約的整合決策（PR #25 / #26）

更新：2026-10-14。

## 現行唯一的伺服器交易流程

`backend/functions/attendanceSessions.js` 的 `startLiveSession`、`joinLiveSession`、`endLiveSession`，是此專案目前的正式程式碼方向：

1. 授課者開啟課堂點名時，伺服器確認課班有效身分，建立 `liveSessions`、`attendanceSessions`、教師私有 token 文件；公開文件不存放 QR 明文。
2. 學生使用 `joinLiveSession` 傳入課班 ID、場次 ID 及目前 QR token。伺服器在交易內驗證身分、簽到狀態、token、有效時間及出席文件，成功後才建立 `attendanceRecords` 和更新計數。
3. 網路回覆遺失時，僅能在當前仍具有效身分且 token 相符的前提下恢復第一次已確認的收據，不重複增加人數，不更改教師修正紀錄。
4. 原舊版 PR #25 的「加入教室不等於完成簽到」原則仍成立；現行 `joinLiveSession` API 已由伺服器交易寫入真實出席紀錄才回傳 `success: true`，不需要另開一個不一致的 `verifyAttendanceClaim` handler。

## 舊分支處理

PR #25 引入 `courseAttendanceSource.ts` 等額外點名 adapter；PR #26 引入獨立 `verifyAttendanceClaim` 後端。這兩條分支源自舊介面契約，如直接合併將產生兩條不同的寫入與收據路徑、舊版本讀取失敗會變成零出席等風險。

本次採 **主線內容為準的歷史整併**：將 PR #25、#26 的 HEAD 納入 Git 父提交，保留分支歷史，不重引入舊 API，也不宣稱舊實作已部署。校驗依據是目前 `backend/functions/attendanceSessions.test.js` 與主線 CI。

## 尚未完成

**PR #27 的教師端開啟／關閉 QR、學生畫面、操作與實機驗收仍須獨立整合。** 現行 JS 交易安全不代表整條操作流程已對使用者完整可用；教師認證與實機操作不得跳過。上述歷史合併不處理 #27、TronClass、教務系統的外部資料權限。
