# 教師課堂 QR 投影

## 操作範圍

教師在原課堂點名頁按「顯示簽到碼」後，可按「放大投影 QR Code」。使用本頁原本向伺服器讀取的簽到憑證，不建立公開分享網址、不另開視窗，也不新增寫入 API。

投影只呈現課程名稱、QR、剩餘時間、已確認出席人數及簽到指引。不呈現姓名、學號、更正原因或簽到碼原文字串。瀏覽器背景原頁仍含教師本來有權查看的資料，這不是螢幕分享軟體的防擷取機制。請只分享投影視窗，勿把教師工作台其他分頁對外公開。

- 使用原生 dialog modal；開啟後聚焦關閉鈕、Esc 關閉、關閉後返回觸發鈕，背景頁不能被鍵盤直接操作。不支援時保留原頁 QR。
- QR 以 768px PNG 產生並保留四格邊界；投影大小依視窗高度限制。沒有新增套件或外部圖片服務。
- 關閉投影不結束點名。點名結束、課程資格撤銷或離開課程會隨既有 Session 卸載投影。
- 切到背景、pagehide、offline、到期時清除碼與投影。額外失效編號保護還在等待伺服器或圖片產生的請求，返回前景後不會顯示舊回覆。
- 期限與人數沿用既有場次及訂閱；投影不建立額外 Firestore 監聽，也不輪詢名冊。伺服器仍是判定簽到有效性的依據，前端時間不是安全授權。
- QR 內容仍是既有 JSON 格式。學生必須在 Campus One 課堂頁的掃描器讀取後確認；不是一般相機開啟網址的 deep link，也不代表動態輪換或防止遠端代簽已完成。

## 驗證

新增三份 Vitest 測試，涵蓋有效期限、圖片來源、倒數、原生對話框退路、鍵盤焦點、關閉清理、實際課堂頁權限、學生無教師入口與晚到的憑證／圖片。

```sh
pnpm --filter web exec vitest run src/lib/attendanceProjection.test.ts src/components/AttendanceQrPresentation.test.tsx src/components/CourseAttendance.projection.test.tsx
pnpm --filter web typecheck
```

本輪本地使用本專案既有成功建置的 React runtime、實際修改後元件與 Chromium 144，完成 11 組投影互動、7 組實際 CourseAttendance 元件整合與 10 組深淺色版面。整合中的登入、課程讀取／訂閱、QR 編碼與共用外殼使用受控替身，沒有正式 Firebase 資料與真實師生帳號。原始 CourseAttendance Git blob 247b6a6 已核對，原版背景切換／晚到讀取會再顯示 QR，修正版不會。

純邏輯模組已嚴格 TypeScript 編譯，26 項本地斷言通過。完整專案 CI 以這次提交的結果為準，不沿用其他 PR。

## 發布界線

未修改部署設定、資料庫規則、後端交易或正式出席紀錄。正式發布仍須驗收實際教室投影距離、iPhone Safari 與 Android Chrome 的掃碼辨識、鍵盤輔助工具，以及真實授課／修課資格撤銷流程。瀏覽器測試不等於已證明全面超越競品。
