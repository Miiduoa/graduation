# 已由 main 取代的開發分支：歷史合併記錄

更新日期：2026-10-14。這是一項 **Git 歷史整併**，不是把過時的程式碼或設定覆寫回 main。

以下舊分支的實質目標已有主線實作或更新整合 PR。對這些分支採用與 `git merge -s ours` 相同的**以主線檔案為準**的合併策略：將分支提交列為 Git merge parent，保留完整開發歷史，但不重新引入舊程式碼。這並不表示所有舊測試都曾通過當前發布驗收，也不代表所有學校已取得校務 API 或實機驗證。

| 舊分支 | 納入原因 |
| --- | --- |
| `ci/align-node22-eas` | Node 22 / EAS 已由現行 CI 與 .nvmrc 實現 |
| `ci/align-node22-eas-final` | 同一條已取代的 Node 22 分支提交 |
| `feature/timetable-ics-export` | 主線 PR #22 的行事曆匯出 |
| `feature/school-directory-search-20261014` | 現行 SchoolSelector 的搜尋及正規化 |
| `fix/release-ai-config-boundary-20261008` | 主線正式 AI 後端保護與 PR #65 測試 |
| `fix/maestro-ios-native-smoke-20261008` | 現行 iOS 原生建置、模擬器、Metro 預熱 |
| `feature/personal-import-mobile-management-20261014` | PR #47 個人匯入搜尋、刪除、CSV 匯出 |
| `fix/public-school-browsing-directory-20261014` | PR #61 正式學校公開目錄及 SSO 隔離 |
| `fix/empty-timetable-cloud-revival-20261014` | PR #45 空課表不被舊雲端資料復活 |
| `fix/storefront-review-copy-regression-20261014` | 現行主線改為共用審核提示常數及測試 |
| `ops/web-release-verification` | PR #34 後續 Web 發布驗證流程 |
| `fix/campus-assistant-school-scope-20261014` | PR #72 校園助理切校隔離 |
| `feat/library-primo-deep-links-20261014` | PR #71 跨校 Primo 館藏搜尋 |
| `feature/official-campus-library-destinations-20261014` | PR #71 清華、中興等官方入口 |
| `fix/campus-transport-school-isolation-20261014` | PR #62 舊台中交通入口校園隔離 |
| `fix/mobile-school-code-switch-20261014` | 現行 App 學校代碼切換與測試 |

## 不在這批歷史整併的分支

課班教師核准、商家金流及退款、QR 點名後端、課表離線衝突處理、官方公車資料源等若仍有獨立功能，需另起整合 PR、經過權限／資料庫／安全測試後才可合入。**不能把仍未實作的功能用只有父提交的方式假裝完成。**

## 檢查方法

- 確認 `main` 的實際原始碼及功能測試才是產品權威來源。
- GitHub 比較若顯示舊分支 `ahead_by=0`，代表其提交已成為主線祖先；這是歷史狀態，不等於重新啟用舊實作。
- 最新程式仍以本次 PR 合併後的 main CI 及實際裝置測試為準。
