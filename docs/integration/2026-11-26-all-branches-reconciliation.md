# 2026-11-26：所有目前分支的安全整合候選

## 範圍與精確版本

這輪接續既有 PR [#768](https://github.com/Miiduoa/graduation/pull/768)，將快照中的 **34 個遠端 head** 全部保留為本機候選祖先：main、#768 原 head，以及其他 32 個分支。完整清單與檔案差異在 [來源 manifest](./2026-11-26-all-branches-sources.json)。這是固定版本的整合證據，不能套用到來源分支之後的新提交。

| 項目 | 精確結果 |
| --- | --- |
| main | `b04c38dc8074c8eb26a46c11c322a6322fbef73c` |
| #768 整合前 head | `d694323053176adc2691f93455ee3bef89e436af` |
| 本機程式候選 commit | `ab6787be8027cc51870c8071ecf59cc4b909465a` |
| 本機程式候選 tree | `5a6805f33fa152ad94429a7d243d57285a2ed30b` |
| 來源覆蓋 | 34/34 exact heads 通過 `git merge-base --is-ancestor`；0 missing |
| 合併方式 | 32 次正常 merge；保留來源提交，不 rebase、不強制推送、不刪除分支 |
| 相對原 #768 的淨變更 | 90 個檔案；包含原分支的產品增量、測試與停用中的治理提案 |

本文件加入後的 commit/tree 會不同於上述程式候選；部署與 CI 必須另外記錄最終發布 head。這裡沒有把本機 merge 視為已合併 main。

## 這輪補齊的內容

- **課務與原生資料恢復（#774）**：納入帳號／校園範圍內的 rollback journal、首次寫入與儲存憑據恢復。原生儲存仍須寫入後讀回確認；取消、換帳號或失敗不能顯示為已完成。
- **導覽與可靠性（#794、#795、#801、#803、#804）**：保留新的步行路線快照與入口一致性、地圖定位恢復、TronClass 作業繳交可用性證據、PDF 資源預算。
- **TronClass 快取授權（#791）**：先解碼相容格式的未確認作業，再檢查每筆作業所屬課程；TTL 由解碼後的來源錯誤計算。兩個既有回歸分別驗證外部課程作業不會經快取顯示，以及相容警告不會錯誤縮短完整快取期限。
- **取消等待（#739）**：保留現有通用 `pendingAction` 介面及相同 AbortController；同時保留表單草稿、不允許晚到寫入、確認對話框顯示取消結果的斷言。
- **正式審查候選（#797、#798）**：納入未啟用的治理文件與 gate 程式，原生流程改用隔離的 emulator 身分與完整報告；沒有啟用 App 發布或變更 GitHub 保護規則。

其餘分支的功能大多已在原 #768；這輪仍逐一保留其最新 head。8 個分支可乾淨合併且 tree 不變；多個分支只帶有基於 main 的共用修正，必須與大型整合的較新行為核對，不能用「較晚提交」直接覆蓋。

## 衝突決策

| 範圍 | 採用的合併結果與理由 |
| --- | --- |
| 共用安全掃描 | 保留 #768 的 CocoaPods 公開 checksum、完整歷史 blob 與負向控制，再加入 #798 對單一公開 workflow blob 的原 commit／path／line／policy blob／兩個歷史 tree 驗證。沒有 path 級排除；新提交同位置的秘密仍須被攔截。 |
| API 封裝來源 | 保留與整合後 `imports/backup.ts`、`imports/types.ts` 與獨立封裝 `courseAccess.ts` 相符的來源 manifest。已核對 assistant-permissions 中 composed/lost-found 的 SHA-256；不同功能分支的舊 tree 值不能互換。 |
| 校園地圖測試 | 保留整合後的可見面積、JSON body 位元組驗證、地點身分變更撤銷編輯器、焦點恢復與模糊樓層範圍拒絕等回歸。共用修正分支原本基於 main 的不同假設不能取代這些行為。 |
| PersonalCalendarScreen | 唯一產品衝突是同位置新增的 `stackTitled` 與 `nuniGeneration`；兩個 props 與 child 型別都保留。一般同帳號草稿可保留，舊操作因世代／scope 改變失效；校園活動來源草稿仍有獨立的重新登入失效檢查。 |
| TronClass 登入 | 保留可獨立終止不配合 AbortSignal 的 transport/body deadline、來源隔離 cookie jar 與 profile 輪替 cookie 測試。incoming 的部分型別／測試只是重排；快取授權修正另完整納入。 |
| Web 匯入取消 | 兩種取消 API 使用同一訊號且行為等價，保留整合版通用 API，另納入上層確認對話框可見回饋的斷言，避免只在底層 editor 顯示錯誤。 |
| Emulator 回歸 | 洗衣與請假狀態的相同測試在兩邊排序不同；保留完整整合排序，不重複宣告或刪除校園／帳號隔離測試。 |
| 介面 QA | 保留 task flow、deadline reminder、loading、search continuity 等整合後模組與來源 hash 證據。 |
| Maestro workflow | 同時保留 #768 依 Podfile.lock 指定 CocoaPods 版本與 `pod install --deployment`，以及 #798 的 scope、隔離 emulator entry、完整 suite、結果彙總。三個舊 demo/導覽/地圖 flow 改採 #798 對應 Release 可用畫面的流程。 |
| Gate policy | 12 個已獨立覆核的 workflow pins 更新到合併後 blobs；`publicationEnabled=false` 保持不變。staged ruleset 是提案檔案，未被任何 workflow 自動套用。 |

## 原生寫入與取消的額外覆核

`PersonalCalendarScreen` 會用已確認 owner/school 建立 workspace key。已知換帳號、換校園、登出或 session 被拒絕會清掉舊 workspace；同帳號短暫重驗證與一般草稿接續使用原範圍。互動登入世代改變時，`currentScope` 物件身分及 `nuniGeneration` 一起使舊讀取／寫入 guard 失效。

`canCommitFirstWrite` 只補充首次寫入的錯誤分類。底層 `assertWritable` 仍會獨立執行 `canContinue()` 與鎖定檢查，並在 awaited I/O 前後重新檢查。不能以首次寫入的 fallback 繞過帳號或校園撤銷。

原生儲存先保留與 attempt 綁定的還原內容，再替換 primary；只有讀回與發布證據成立後才通知 listeners。發布失敗會恢復原憑據、checkpoint 與 primary，無法確認時保留恢復證據。Web IndexedDB 鎖只有在操作尚未開始時可退回 lease；已開始的操作不會因此重跑。這些是程式與合併覆核，仍需要完整 Mobile 回歸及作業系統實測。

## 已完成與尚待驗證

- [x] 所有固定來源 head 都是本機候選祖先；0 missing。
- [x] 所有 Git 衝突解決，工作樹乾淨，`git diff --check` 通過。
- [x] 合併後歷史驗證器測試：Node 22.23.5，30/30 通過；包含完整 blob、精確行、同位置新值與公開 workflow 身分的拒絕案例。
- [x] Gate 獨立覆核：Node 22.23.5 安全測試 57/57、Python 報告測試 1/1；此結果不能取代正式 App 端到端證據。
- [ ] 最終發布 head 的完整 Web／Mobile、typecheck、build、Functions、Firestore、CodeQL 與適用瀏覽器／Maestro 檢查。根代理完成後應補記精確結果，不能沿用較舊 head。
- [ ] 最新 main、分支漂移、未解討論與 designated App gate 重新查核。
- [ ] GitHub 正常合併 main，以及正式部署 commit 與可用性驗證。

## #798 的 P1 與啟用邊界

[#798 的 P1](https://github.com/Miiduoa/graduation/pull/798#discussion_r4692803692) 在覆核時仍是未解決且未過時的 thread `PRRT_kwDORvCyI8670T0G`。要求是在相同 PR head 已取得 App 綠燈後，**重跑 CI 變成執行中／失敗，或新出現未解討論，都必須使合併再次被阻擋**。

候選程式已有原生規則驗證、review event relay、`workflow_run` 各階段與定期 revalidation，也會重新檢查並撤銷自身 v2 check。正式規則尚缺三個彙總結果：`Maestro PR result`、`Mobile agent PR result`、`Spatial browser PR result`。此外，仍缺 genuine App success → 真 GitHub rerun 失敗／新未解 thread → 阻擋、撤銷與恢復的完整 live 端到端證據。

因此這次只保留停用候選。`publicationEnabled=false`、原有 App 5504170 要求與現行原生保護規則都保留；**合入候選不等於啟用、不等於 P1 已結案，也不等於取得「審查通過」**。不得為了整合成功而偽造核准、放寬規則或把 skipped 檢查當成成功。
