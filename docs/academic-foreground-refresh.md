# 校務資料前景更新

## 已接通範圍

Web 的 `AcademicPage` 在目前帳號可讀取靜宜大學校務資料時，提供「此頁自動更新學校資料」開關。使用這個畫面的成績頁與學分規劃校務參考區，可沿用既有 `loadAcademicRecords` 驗證流程重新取得資料。

這不是新增學校的登入連接器，也不是跨校帳密登入、作業系統背景同步、推播或個人課表寫入。其他校園仍走既有的個人資料匯入；本次未修改原生 App 的排程。

## 行為

- 預設關閉，使用者仍可手動讀取。開啟後，每次完成讀取再等待 5 分鐘；不因為勾選開關而立即重送已進行中的請求。
- 同一個帳號、校園與資料類型的控制器只允許一個讀取請求。連點按鈕、視窗聚焦與網路恢復事件不會堆疊請求。
- 分頁隱藏或離線時，不發起自動讀取。返回可見分頁且網路恢復後，只在資料已達更新時間時重新取得資料。
- 暫時失敗的重試間隔為 5、10、20、30 分鐘，最高 30 分鐘；成功後回到 5 分鐘。
- 登入過期、權限不足或服務未設定時停止自動重試。使用者必須依提示重新連線或修復服務，再主動讀取。
- 更新進行中保留上次讀取的資料與來源時間，明確標示「正在更新」。失敗時顯示錯誤，不把舊資料當成新資料，也不推進成功時間。
- 離頁、登出或切換帳號／校園時清除排程與事件監聽；晚到的回應不能更新已離開的畫面。Firebase 已送出的 callable 不宣稱可以取消，僅停止後續排程及忽略舊回應。
- 自動更新偏好只留在目前頁面的元件狀態。帳號、校園或資料類型變動會重新建立頁面，必須重新開啟。

## 資料與權限

沒有新增校務帳密保存、網頁爬取或跨校端點。資料沿用既有伺服器的登入、校籍與工作階段檢查。回應必須與本次帳號及學校相符；自行匯入的課表、成績與活動不會因為這個更新器而新增、覆蓋或刪除。

## 驗證

新增測試：

- `apps/web/src/lib/academicRefreshController.test.ts`：12 個排程與清理測試，包含預設關閉、前景更新、離線、事件去重、重試退避、過期權限停止、解除監聽及延遲回應。
- `apps/web/src/lib/useAcademicRecords.test.ts`：8 個 React hook 測試，涵蓋帳號／校園切換、資料來源時間、更新中快照、失敗及帳號不符回應。
- `apps/web/src/components/academic/AcademicRefreshPage.test.tsx`：3 個畫面測試，驗證開關、帳號切換重設與不支援校園不提供直接更新。

建議執行：

```sh
pnpm --filter web exec vitest run src/lib/academicRefreshController.test.ts src/lib/useAcademicRecords.test.ts src/components/academic/AcademicRefreshPage.test.tsx src/components/academic/AcademicPage.test.tsx
pnpm --filter web typecheck
```

本機已以 Node.js 測試執行器執行排程核心的相同 12 個案例（僅替換測試執行器匯入），全數通過。React 整合測試、完整 Vitest、型別檢查、建置與正式校務連線仍須分開驗證；排程測試不代表已用真實校務帳號登入成功。
