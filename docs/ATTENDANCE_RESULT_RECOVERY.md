# 點名回覆遺失與更正結果確認

## 本次修正

`courseAttendance` 的四種寫入共用 `attendanceRequest`。25 秒的等待上限涵蓋取登入憑證、HTTP 回應及 JSON 本文；本地逾時標記為 `attendance/result-unknown`，不冒充伺服器的 QR 過期錯誤。逾時只中止用戶端等待，不代表後端交易已取消；本層不自動重送，也不切換到另一個後端。

每次請求在送出前及讀完回覆後核對帳號。登入憑證在逾時後才取得，不得再送出寫入。一般 500/502/503/504、無效 JSON、缺少必要欄位或更正結果與原狀態不同，均不宣告成功。明確的「尚未啟用」回覆才視為未設定；一般 503 不再誤報為尚未啟用。

教師更正在結果不明時保存不可變的原始命令，包含學生、狀態、原因、requestId、expectedRevision 與本地 actorUid。表單、收合及名冊快捷更正暫停，焦點移至「確認原更正結果」。確認會重送完全相同的命令，由既有後端交易與稽核識別結果；可能取得已完成收據，也可能完成尚未提交的原命令，因此不是唯讀查詢。actorUid 僅綁定本地重試，從 HTTP payload 移除；伺服器身分仍由 bearer token 決定。

版本衝突會保留輸入、重新核對並等待再次明確確認，不自動送出。成功後重新整理失敗，只提示重新整理失敗，不建立另一筆更正。課程、場次或已重新渲染的登入帳號改變時，整個編輯器重新掛載，舊回呼不更新新畫面。

## 邊界

- 不修改 Firestore 規則、後端權限、交易、套件依賴或正式資料。
- 重送安全依賴先前更正後端的 requestId、requestHash 與 expectedRevision 契約；獨立 Functions 環境仍應先發布相容後端。
- 待確認命令只保留在目前頁面記憶體，不寫入 localStorage/sessionStorage，也不保存登入憑證。重新整理或離開頁面後，必須先查核紀錄；本次未實作跨分頁／跨裝置恢復。
- 網頁重新渲染的帳號 key 不是即時權限監聽的替代品；實際寫入與回覆有另外的帳號檢查，伺服器仍負責資格驗證。
- 不宣稱完成 Safari／實機、正式帳號或真實斷網驗收。

## 回歸測試

```sh
pnpm --filter web exec vitest run \
  src/lib/attendanceRequest.test.ts \
  src/lib/courseAttendance.test.ts \
  src/components/AttendanceCorrectionPanel.test.tsx \
  src/components/AttendanceCorrectionPanel.recovery.test.tsx
```

保留原服務與面板測試，既有 fetch 斷言增加 AbortSignal，既有重試操作改點結果確認按鈕並追加完整命令相等斷言。新案例涵蓋 token／headers／body 三階段卡住、晚到回覆、異常回傳、帳號變更、重複點擊、版本衝突、刷新失敗及課程／場次／帳號切換。單元測試使用受控替身，不能代替 HTTPS 雙教師及真實斷線驗收。
