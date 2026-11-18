# 借閱資料完整性與行動確認

## 問題與範圍

`getLibraryLoans` 原本先讀取本人、目前學校的前 50 筆歷史紀錄，再排除已歸還或不符合逾期條件的項目。當前 50 筆已歸還、第 51 筆仍未還時，回傳 `ok: true, count: 0`，讓借閱卡片與續借／還書流程誤認為查無資料。較早到期的借閱也可能落在未讀取的區段。

本次從 main `afca3204dc105fbcee03e6afef53e1203d761f4d` 檢查當時 18 個 open PR、19 個遠端分支。借閱 reader 與 semantic reader 在所有分支相同；core 的借閱選擇區段也相同，未與 #631、#627、#616、#586、#669、#597、#515 的現有修補重複。完成前更新至 main `e71bccf0ab8ea10fccb7b092271d2810a9e06bf8`，新增的 #662 只涉及 Web 公開查課，與本次檔案沒有交集。

## 行為

- 一次讀取最多 501 筆來源紀錄；只有不超過 500 筆時才過濾、投影並回傳完整成功結果。單一快照避免多頁讀取期間新增／刪除造成的跨頁不一致。
- 第 501 筆作為超額判斷；超額回傳 `ok: false`、`library_loans_limit_exceeded` 及空的 `loans`，不提供部分 count 或可供選書的部分清單。
- 續借／還書選書流程只接受成功、完整的 reader 結果。超額、格式異常或一般來源中斷會顯示「無法完整讀取」，不產生行動確認；真正完整的空結果仍保留查無借閱的回覆。
- 權限失效仍交由既有授權中止流程處理。帳號／學校範圍、日期相容性、明確紀錄編號路徑與使用者確認後才寫入的規則維持原契約。

讀取範圍仍是 nuni 保存的本人借閱副本，不等於學校官方圖書館帳戶。歷史來源超過 500 筆時目前會回報不可完整讀取；不宣稱支援無上限歷史。

## 驗證

本機使用 Node 22.23.5；Functions 依 `backend/functions/package-lock.json` 執行 `npm ci --ignore-scripts`，shared 使用 TypeScript 5.9.3 與 js-sha256 0.11.1。測試資料均為合成 fixture，沒有讀寫正式資料或呼叫付費模型。

| 檢查 | 結果 |
| --- | --- |
| 修改 production 前執行新增 reader 回歸 | 6 failed、19 passed，確認第 51 筆漏讀及超額被誤認成功 |
| 借閱 reader、core/library、core/sources、semantic focused Jest | 4 suites、123 tests passed |
| 完整 Functions `npm test -- --runInBand`，含 shared build 與 parse5 smoke | 143 suites、2,344 tests passed |
| Functions `npm run lint` | passed：0 errors、4 個既有 index.js unused-vars warnings |
| `pnpm --filter @campus/shared typecheck` | passed |
| `git diff --check` | passed |

新增 16 個 reader／整合測試，涵蓋第 51 筆有效／逾期借閱、500／501 邊界、來源中斷、真正空清單、兩種行動確認與 semantic card；既有帳號／學校隔離及登入／權限中斷案例一併通過。Fixture 實際執行 query limit；整合 fixture 也依文件 ID 排序。確認階段沒有執行借閱寫入。

首次完整 Functions 執行有 2 suites、25 tests 因 sandbox 禁止 localhost listener 而失敗；允許本機 HTTP fixture 後完整重跑通過。初始 shared typecheck 缺少本機 js-sha256 測試依賴，補齊隔離依賴後通過；沒有修改專案套件或鎖檔。

未執行 Web／Mobile 全套、UI 瀏覽器／Maestro／實機、正式 Firestore／官方圖書館驗收。此次沒有 UI 變更，不以後端 fixture 代替取消、連點或瀏覽器前進返回的 UI 驗收。遠端 CI 必須以 draft PR 的精確 head SHA 另行核對；本文件的本機結果不代表 CI、指定 nuni-merge-gate App 5504170 核准、合併或部署。
