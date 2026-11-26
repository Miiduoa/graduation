# 2026-11-25 全分支整合與驗證紀錄

本輪將舊整合候選更新到目前 main 與產品分支，保留新舊功能的帳號、校園、返回與寫入邊界。這是候選的整合紀錄，不代表 main 已合併或正式環境已部署。

本頁保留第一次送審前的整合決策及本機結果；首次發布後的遠端失敗、修復及更新證據，接續記錄於 [CI 修復紀錄](./2026-11-25-ci-followup.md)。最終狀態以 PR 當前 head 的 checks 為準。

## 來源與版本

[來源清單](./2026-11-25-all-branches-sources.json)保留初次快照及兩次送審前更新的時間、完整 SHA 與增量。初次於台灣時間 2026-11-25 **21:52:32** 查核 **40 個 origin refs**，包含 main 及既有整合分支；其中 **38 個來源 head 納入候選歷史**，不應將此數量解讀成 38 個新功能 PR。#616 合併後來源分支已刪除，原始來源 SHA 仍保留在候選歷史。

- 初始主線基準：[cc06b4da2abe1b954a0411b68ca6ea6a0788c70e](https://github.com/Miiduoa/graduation/commit/cc06b4da2abe1b954a0411b68ca6ea6a0788c70e)；最終納入主線：[149cfbe2f806ee15da1985854b34dfe72a7e07d9](https://github.com/Miiduoa/graduation/commit/149cfbe2f806ee15da1985854b34dfe72a7e07d9)。
- 查核時 [PR #768](https://github.com/Miiduoa/graduation/pull/768) 的遠端 head 仍為 [fd9fd408f08177b59fb9c9c2954f61fdaab1a329](https://github.com/Miiduoa/graduation/commit/fd9fd408f08177b59fb9c9c2954f61fdaab1a329)，與目前 main 有衝突。
- 最後增量合入後的本機產品候選為 `b05f079493866cdb6f8d26ed652d47f5e7b40262`；其後僅補來源與驗證紀錄。送審版本與雲端驗證以最後提交的 PR head 為準。
- [#797](https://github.com/Miiduoa/graduation/pull/797) `54b8c21230637c2bb63766fd817c981a21eb217c` 與 [#798](https://github.com/Miiduoa/graduation/pull/798) `c583dca2e145421044b234f1a3af7ac5900ab20a` 涉及獨立合併治理／安全提案，留待另外審核；不藉此產品整合變更既有核可規則。

**送審前主線更新已核對：**新 main `149cfbe2` 是 [#616](https://github.com/Miiduoa/graduation/pull/616) 的 squash，其 tree 與已納入的來源 `220cb2e2d74f0847a7d0241878413097dd183d6b` 完全相同，皆為 `0d096708d3d5fc0b1bed8da59e04ead1d8ea0033`。來源 SHA 已是候選祖先；以保留目前內容的正常雙親合併補上 main 歷史，合併前後整棵候選 tree 均為 `2540dfedecfb30fcdc703535beea7512d5d1058c`。因此沒有將 squash 的舊內容覆蓋候選後續整合。

第二次快照只有兩個來源前進，其餘 38 refs 未變。兩筆均已正常合入，無新增合併衝突：

| 來源 | 初次快照 | 本輪納入的完整 head | 增量 |
| --- | --- | --- | --- |
| [#774 活動與個人行程](https://github.com/Miiduoa/graduation/pull/774) | `7c63e8ec7f0ca1faa1c837030c2893e60f494d45` | `625cb3edf629a74b32c9c311bc524c38e59b5e83` | [2 commits](https://github.com/Miiduoa/graduation/compare/7c63e8ec7f0ca1faa1c837030c2893e60f494d45...625cb3edf629a74b32c9c311bc524c38e59b5e83) |
| [#750 門市工作區](https://github.com/Miiduoa/graduation/pull/750) | `df7f91f156b3d9343de33ed9cd91398b9f14c75d` | `dfd58f210dfc5a5a691363f29f0ae8f64400b36a` | [3 commits](https://github.com/Miiduoa/graduation/compare/df7f91f156b3d9343de33ed9cd91398b9f14c75d...dfd58f210dfc5a5a691363f29f0ae8f64400b36a) |

最後一次來源更新亦完整納入：#774 `10f2498c550e06984c089de0b22b70d004290b0c` 修正帳本復原繫結及首次儲存配額相容性；#795 `87977e4ecbe8a75174ee93a772d873d1c848a599` 將樓層編輯綁定至已確認 POI 身分；#789 `ba554dac81bc25a280537237646f4bac3eb3b115` 強化瀏覽器確認次數與無障礙返回檢查；#750 `8faf6262306656422e007d0d694d4094a619ae6d` 僅補入相同新 main 的合併歷史。每一完整 SHA 均已驗證是候選祖先。

## 主要整合決策

### 首頁、Explore 與助理連續性

以 [#789](https://github.com/Miiduoa/graduation/pull/789) 的新版工作區、Explore 與助理呈現為基礎，納入 [#777](https://github.com/Miiduoa/graduation/pull/777) 常用服務列、大字適配、[#778](https://github.com/Miiduoa/graduation/pull/778) 首次使用入口及 [#779](https://github.com/Miiduoa/graduation/pull/779) 動態。保留單一首頁工作區、既有助理回覆與返回位置；不因較舊分支重建另一套首頁。新增服務與手動匯入入口仍可在課務資料讀取時使用。

保留 [#784](https://github.com/Miiduoa/graduation/pull/784) 收藏活動入口、校園／帳號隔離與深連結。活動清單、活動詳情、首頁及「我的」使用同一套收藏狀態；公開瀏覽不被改成必須先完成校方登入。

### 搜尋、課表與個人行事曆

採用 main 較新的搜尋返回實作與 Next `onNavigate` 修補，保留 history、IME 組字、焦點／捲動還原、帳號切換及過期回呼保護；保留舊整合新增的作業附件與社群 QA fixtures。來源依據為 [main](https://github.com/Miiduoa/graduation/commit/cc06b4da2abe1b954a0411b68ca6ea6a0788c70e) 與 [#783](https://github.com/Miiduoa/graduation/pull/783)。

[#775](https://github.com/Miiduoa/graduation/pull/775) 的撞期功能接在新版工作區後，維持目前學期優先、單一前景計時器及作業 handoff 的重新核對。`pu`／`tw-pu` 只做同校範圍正規化；開啟原行程仍核對 owner、school 與 `eventScope`，不只依相同 event ID。課表重新讀取期間不使用舊行程產生撞期提示。

[#774](https://github.com/Miiduoa/graduation/pull/774) 活動草稿使用獨立頁面，避免覆蓋已開啟的個人草稿；保留新版行事曆樣式、明確儲存結果及失敗重試。暫時重驗證可保留草稿與結果，已知登出／帳號或校園切換則撤銷舊操作。最新增量同時修正兩種 Native 帳本編碼的 rollback、退役標記讀取失敗及 retry publication hash；Web／shared 的 batch-history 驗證成對納入，維持網站與 Expo 的讀寫相容性。

### 校園身分、CAS 與 TronClass

合併 [#791](https://github.com/Miiduoa/graduation/pull/791)、[#792](https://github.com/Miiduoa/graduation/pull/792) 與 [#616](https://github.com/Miiduoa/graduation/pull/616)。校方登入能力獨立於 Google/provider 查詢；只有校園選擇、名錄與 capability 已確認時才顯示對應入口。保留 PU 暫停政策、教師路徑、平台 session 恢復與原始 return target。官方 LMS 入口本身不構成 nuni 身分或資料權限。

Native CAS 保留 HTTPS 官方目標檢查、session revision 與 `/api/profile` 帳號精確比對；舊帳號／校園回應不能恢復有效 session。TronClass 工作區保留 binding revision、owner／session 失效、離開或背景取消、送出前重新準備與確認，以及回覆不明時核對原操作而不自動重送。下載能力與實際授權仍需分別核對。

Google-link 僅保留候選程式與 schema fixture；**未啟用正式 migration、adapter 註冊或功能 flags，也未執行既有帳號遷移**。詳見[帳號入口整合紀錄](../nuni/auth-entry-integration-2026-11-25.md)與 [Google-link 候選說明](../../deploy/nuni-api/account-linking/README.md)。

### 門市與可靠性

[#750](https://github.com/Miiduoa/graduation/pull/750) 保留門市、工作區與訂單篩選返回，以及同帳號／門市的草稿隔離。最新三個提交讓 session 更新或相同 context 手動重新載入後，恢復已完成的首次菜單回執；新的讀取仍須核對目前狀態，回執不能代替權限或誘發重送。

納入 [#796](https://github.com/Miiduoa/graduation/pull/796) 可靠性整合與 [#795](https://github.com/Miiduoa/graduation/pull/795) 後續地圖修正，保留定位恢復、步行來源快照一致性、共用請求生命週期、列表重新整理及語音靜音／背景處理。

## 本機驗證：分輪次列報

使用專案指定 **Node 22.23.5／pnpm 10.28.2**，以 `--frozen-lockfile` 安裝；最新增量後再次完成 frozen offline 安裝，未改 lockfile。Native Jest 使用 `--runInBand` 與 4 GB heap，Mobile typecheck 使用 6 GB heap。

下列結果來自不同執行輪次，重疊測試不相加。尤其完整 Web 首輪有失敗，修復後只重跑受影響範圍，**不能描述為單次完整 Web 執行全部通過**。

| 範圍 | 實際結果與界線 |
| --- | --- |
| 完整 Web、Mobile typecheck | 兩者均 exit 0，無型別診斷。 |
| 完整 Web 首次執行 | **965 suites passed／3 failed／19 skipped；39,844 tests passed／12 failed／182 skipped**。 |
| Web 首輪失敗後補測 | `career/page`、`CampusServiceMenu`、`PageRecovery` 三個 suite 修復後 **101 tests passed**；保留原始完整測試結果，不將此補測改寫成完整重跑。 |
| 最新 #774／#750 Web 回歸 | **12 suites／761 tests passed**：匯入與復原 349、門市 412。對應第二次來源快照的增量。 |
| 最後 #795／#774 Web 補測 | **2 suites／818 tests passed**：地圖空間 795、個人匯入 23。舊地圖測試曾要求 POI 身分已改變後仍保留原草稿，與新身分隔離契約衝突；改為確認舊 editor 撤銷、草稿不帶入新地點，導航撤銷及重新選取斷言全數保留。 |
| Native 整合主輪 | **45 個不同 suites／1,291 tests 最終通過**，涵蓋入口、首頁、活動／行事曆、助理接續、課表 handoff、Dorm、SSO/provider cache 與 TronClass。活動旅程首次有 16 個案例因 mock 缺少 `useOptionalNuniSession` 中止，補齊後整套重跑通過；未放寬斷言。 |
| 最後 #774 Native 補測 | **4 suites／346 tests passed，0 failed／skipped**：`personalImports` 250、`personalImportSync` 14、`PersonalCalendarScreen` 66、`CampusEventCalendarJourney` 16。此輪取代先前 342 項補測，亦不與 1,291 相加。 |

### 最終合成瀏覽器驗證

來源與驗收腳本更新後重新建置並完整重跑；下列是最後重跑結果，對應 `b05f0794` 產品來源。其後僅更新地圖測試期待與來源／驗證文件，未更改受測產品程式：

- **8／8 scenarios、55 checks 通過**；376 份 source hashes 比對為 **0 drift**，產生 40 張截圖。
- 訪客 Explore → map → 返回卡片的三步旅程在六種一般情境全數完成，包含 320px、大字與兩種減少動態設定。
- overflow、console、page 與 network 異常均為 0。
- 兩個 coursework 情境各取得 **1 write／1 record／1 import／1 proof、0 journal**，沒有重複新增。
- 使用測試瀏覽器與明示合成帳號／資料及服務邊界。這些結果不代表真實 Google OAuth、校方 CAS／TronClass、正式報名、作業繳交或實機投遞已驗收；本輪沒有對真實校方帳號執行這些操作。

產物以下列 SHA-256 辨識；完整 log／截圖與可下載的 CI 產物連結待隨最終候選證據附上，不以開發機 scratch 路徑充當 reviewer 可取得的證據。

| 產物 | SHA-256 |
| --- | --- |
| Browser `results.json` | `deb39c36a6ee334b215084b0eb9476df8e534966200c949c174f03c94436c07c` |
| Browser `source-sha256.json` | `05fe0ce5cf6ec76a09f0f11c0ea2dd4262306d58553ee614b93dbee9a0a0d3d0` |
| 最新 12-suite Web 結果 JSON | `d4ea1e2e767f7dcf41a431eaed966eb3725c5be9aca62b687e6060898a115065` |
| 最後 Native 配額／復原回歸 JSON | `5afce15e3ca7cabd8cd1ed02632e311d144285a7ce2c911729e2d8dcab564c82` |

## 送審與發布界線

本機結果不能取代最終 PR head 的 GitHub CI、資料庫／政策檢查及指定 App 核可。主線更新前查核時，舊 #768 head 的 55 個 check runs 為 51 success／4 skipped，但它仍與當時 main 衝突，且沒有 App 5504170 的 `審查通過`；這些舊 head 結果不能轉移到新候選。

[main ruleset 26004626](https://github.com/Miiduoa/graduation/rules/26004626) 維持 active、無 bypass、要求更新至主線並解決討論。必要檢查包括 `審查通過`（App **5504170**, nuni-merge-gate）、`CI Summary`、`Analyze (javascript-typescript)`、`CodeQL`、`policy-and-postgres`、`EAS Update (Preview)`。Skipped 部署工作不算部署證據；一般 CI 或普通 review 不能替代指定 App 的核可。

本輪未變更治理 gate，也未執行正式部署／資料庫 migration 或啟用遠端功能開關。最終候選提交後，需重新核對其完整 SHA 的 CI、指定 App 結果與來源清單，再依既有規則處理合併及發布。
