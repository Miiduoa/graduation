# 課業準備時間復原

使用者已確認並保存的準備時段結束後，作業可能仍未完成。原首頁因 `trackedTask` 只檢查有無追蹤紀錄，持續隱藏找空檔入口，無法接續課業與行事曆任務。

本批提供明確的重新規劃操作：先驗證舊安排的簽章來源、目前課程資格、作業狀態與期限，再讀取完整課表及行事曆，產生新的 30 分鐘確認卡。使用者再次確認後才寫入，並沿用原有讀回核對及不確定結果復原流程。保留舊行程及追蹤，不更改權限、不自動執行。

## 版本及範圍

- 開發基底：PR #631 `0c60b2333f9e8e01e0cf18460b698d7e568b9a97`。
- 盤點時 main：`0fdee84e7cd2eca2fa49efd9477b24dd516e1c7c`。
- 本功能依賴 #631 的課務來源、個人行程確認、Today 追蹤與執行回執；不依賴 Firebase 圖書／訂餐修補。
- #672 `f3d1f28f4f973becabba0275dafb95da972733f2` 修改相同 Today 元件的 compact 呈現，未提供這項復原功能；整合時須保留 compact props 與兩處追蹤元件的復原入口。
- 新分支獨立於 #670／#678／#680／#681，不推送或重寫它們的分支。既有 workflow concurrency 依 PR/ref 區分，不取消其檢查。

## 安全邊界

- 只有來源仍開放、未繳交、期限在未來，而且原行程完整相符且已結束，才可重新規劃。
- 查不到、改過、尚未結束或無法讀取的原行程不提供復原。缺少紀錄不能證明先前寫入失敗。
- 舊 proof 只選擇並驗證歷史來源；新確認綁定目前帳號、session、學校與 conversation。重新查核目前新增個人行程權限。
- 同一原安排使用穩定的後續 mutation ID；不同分頁或重試不能透過新 ID 堆出多筆後續行程。持久層既有 revision CAS／mutation 冪等機制保持不變。
- 確認前再次檢查作業、原行程及新時段。來源變更、權限撤回、讀取失敗或 revision 衝突一律停止。
- 確認後回應遺失仍保留原確認及 execution journal，先查核同一筆；取消未送出預覽不會刪除既有行程。
- 此頁面中的 unknown 操作只查核原確認。另一個登入 session 可能重新取得同一 child ID 的預覽，仍須再次明確確認；沒有跨 session 的全域 dispatch 鎖。競態回歸以合成 transport 模擬既有服務的 mutation request-hash 衝突與 revision CAS，確認最多保留一筆後續行程；這不是新增資料庫交易測試，也不代表完全禁止第二次 dispatch。
- 現有行事曆紀錄沒有課業 ID；對同標題且尚未結束的其他行程採保守拒絕，不能宣稱已辨識所有改名或手動安排的同一課業。重名可能需要先人工核對。
- 使用合成來源與本機 fixture；未操作正式課程、帳號或行事曆。

## 既有審查證據

2026-11-17 重新核對的既有 Draft heads：#670 `74f75bd916bddb29fcaba4743ab33e67caa97e30`、#678 `42d9a3848f49c4364a259e78aadbb5e70b236cfc`、#680 `729406d1a9641d783b39dea8c79a6abac84abad4`、#681 `d4db45d1d51d42397c12397ef059f11846e5fdb9`。它們的 CI 與 CodeQL 均成功。

#681 的 [Maestro run 44054022961](https://github.com/Miiduoa/graduation/actions/runs/44054022961) 已完成成功；check-run 的 `head_sha` 也等於上述 `d4db45d…`。#631 `0c60b233…` 的 [Maestro run 44052894571](https://github.com/Miiduoa/graduation/actions/runs/44052894571) 同樣已成功，沒有沿用舊 in-progress 或舊版結果。本輪沒有取消、重跑或弱化這些檢查。

前一批 #670／#678／#680／#681 與 #631 的獨立審查、Functions／Firestore emulator 及合併驗證紀錄仍保存在本機 integration 分支。該份完整整合報告尚未推送，不能當作可分享的 GitHub 證據。本批的實際測試結果與獨立審查將記錄於此文件及 Draft PR。

App `5504170` 的必要核准、正式帳號及實機驗收仍屬獨立門檻；本批不合併、不部署，也不修改 gate。
