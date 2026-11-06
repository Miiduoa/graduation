# 限動發布與上傳控制驗收

2026 年 11 月 6 日，接續首次私訊開聊與限動觀看重試的整合版本 `29d24692`。

## 操作結果

- 網頁與手機的照片、影片上傳進度來自 Firebase UploadTask 實際傳輸位元組。
- 取消上傳會中止任務並留在編輯器，保留文字、媒體與回覆設定。已完成媒體傳輸、等待下載網址時取消，重試可沿用已完成的上傳。
- 發布與確認期間可停止等待，保留原 ID、完整內容及到期時間。稍後先確認原版本，晚到回應受到當次操作與帳號／學校範圍限制。
- 原版確認成功後，修改稿持續留在編輯器。使用者明確按下「發布修改後的草稿」時，才建立新 ID。
- 手機成功發布後保持鎖定直到離開，忙碌時的編輯區受事件與無障礙操作限制，外層取消控制持續可用。

## 真實瀏覽器操作

Chromium 載入現有 StoryComposePage、CommunityAccess、Next Image、CSS 與 community publishing／media service。登入、校籍、路由跳轉、Firestore 與 Storage 接受控測試替身。測試替身保留 UploadTask 的 observer、Promise、cancel 與固定路徑行為。

| 情境 | 觀察結果 |
| --- | --- |
| 320、390、1366px 的完整發布流程 | 影像成功解碼，無橫向溢出、無頁面 JavaScript 錯誤，按鈕與回覆設定點擊區至少 44px |
| 上傳途中取消，強制送出舊 progress／complete | 草稿保留，未寫入限動 |
| 傳輸完成後等待網址期間取消 | 重試沿用相同 path，取得網址時沒有再次上傳 |
| Firestore 已提交，回條與首次確認讀取失敗 | 修改內容後確認原版，額外寫入數為 0，原版仍只有一則 |
| 原版確認後明確發布修改稿 | 建立第二個 ID，保留各自的文字與媒體路徑 |
| 停止等待 write／confirmation 後晚到成功或失敗 | 四種情境均保留新草稿，無舊頁面跳轉 |
| 切換帳號或學校 | 取消舊上傳，新編輯器沒有舊文字或媒體 |
| 鍵盤操作 | 取消後回到文字欄位，失敗後回到原版確認鍵，確認後回到修改稿 |
| 深色模式取消鍵 | 前景與背景對比約 15.79 |
| 2 秒 H.264 MP4 | 真實影片解碼寬度 180px，顯示影片進度，可取消後重試，發布文件為 video |

截圖使用合成文字與測試照片。

- [手機上傳進度](story-upload-progress-phone.png)
- [深色模式上傳進度](story-upload-progress-dark-phone.png)
- [原版確認後保留修改稿](story-published-draft-phone.png)

## 程式回歸

網頁的兩個既有測試檔合計 53 項通過。手機 Composer 20 項與發布／媒體 service 32 項通過，包含已完成上傳且本地原檔無法讀取、預先取消、快速失敗、返回過場、無障礙事件及地點變更。

本機手機測試使用低記憶體轉譯設定。專案標準 Expo Jest、兩端完整型別檢查、Web ESLint 與 production build 已納入本分支的 GitHub 工作流程。三個手機實作模組使用實際 Expo Metro transformer 與 Hermes 完成 iOS／Android 共六次模組轉譯及編譯。

```sh
pnpm --filter web exec vitest run src/app/community/story/new/page.test.tsx src/lib/community/storyPublishing.test.ts
pnpm --filter mobile exec jest src/__tests__/StoryComposeScreen.test.tsx src/__tests__/services/storyPublication.test.ts --runInBand --ci
```

## 後續驗收

真實 GCS 權限與中斷上傳清理、iOS／Android 實機相簿、原生影片、鍵盤及螢幕閱讀器仍需專用環境完成。草稿目前隨編輯器存活，重新整理、離開再返回及 App 重啟後的恢復列為後續開發。
