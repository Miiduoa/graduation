# Google 平台服務權限（Web 工作階段）

此變更在「設定 → 平台權限」新增兩個伺服器端強制執行的 Google 平台服務開關：

- 公開社群：控制 Web BFF 的 /api/social 讀取、發文及其他操作。
- 雲端 AI：控制 Web BFF 的 /api/nuni/assistant 新查詢與寫入確認。V2 既有未結案操作的 cancel / reconcile 仍可使用，供撤銷或核對。

兩個開關在同一個平台 session 的 HttpOnly、SameSite、Secure (production) AES-GCM cookie 保存；server secret 驗證與 upstream session 再確認後才可更新。POST 要求同源、session context、精確兩個布林欄位；更新後再讀取核對，未確認不自動重送。不同登入、瀏覽器或手機端不共用此資料。這不是平台帳戶長期偏好，重新登入後會回到現有預設；亦不包含原生手機 BFF。

**不擴張校務身分：** Google 帳號不變成 Firebase UID、學校會員、老師、店家或管理員。既有 /dms 私訊仍為學校登入，平台私訊尚未開發。關閉社群不會刪除既有公開內容，關閉 AI 不會取消已送出而未結案的工作；模型資料分享與具體寫入需另行確認。

驗證需以此分支的精確 head 為準：Web TypeScript、ESLint、Vitest、CI 與 CodeQL。沒有完成真人、實機、原生 App 或正式部署驗收前不可視為全平台上線。
