# 2026-11-23 全分支整合決策

## 20:26 固定來源：以最新主線決策為準

本輪固定來源見 `2026-11-23-all-branches-sources.json`：現存共 18 個分支，扣除 main 後 17 個具有未合入提交；其中 14 個是功能、修正或依賴分支，3 個是整合分支（包含本 PR）。前一輪 16:44 的 18 個來源快照另保留於 `previousSnapshots`，不與目前現存分支數混算。

前一候選為 `ae40bc6f6c9dd72d5b61ac59f02a2d27c505ea08`。其後 #740 已正式 squash 合入 main `15bdca30796646d93263ddf8442eca248aa196b4`，來源分支亦已刪除。20:09 初次盤點之後，20:26 再補入準備期間新增的地圖 `281ac372f1e02e693dd8ebac3d8bb64ebbb1dd68` 與 TronClass `b557781206280e94255fa37b03942ef596eba34b`，並固定此來源切點。其餘已捕捉分支由前一候選保留。

### 主線的社群簡介決策

#740 最後核可的版本明確撤回先前的嚴格顯示讀取、複雜草稿還原與額外分頁自動重新讀取。此主線決策取代下方 16:44 歷史紀錄中「首次讀取 requireCommitted 必須保留」的判斷。

本輪採用主線簡化的編輯介面與一般顯示契約：初次載入及一般顯示可以呈現尚在同步的資料，但不能據此解除未確認寫入或宣稱儲存成功。自動寫後確認及「核對儲存結果」的手動確認均須直接要求 committed snapshot。自己的社群簡介在所有分頁保持同一實例，保留未確認寫入狀態；外部使用者的卡片仍依主線顯示行為處理。主線的三欄媒體排列保留。

不恢復已撤回的 FirstCardRead bridge、複雜 recoverable draft UI 或逐欄位 revision。必要的 owner／school、晚到操作、撤權優先及未確認寫入保護，直接由現有初次讀取、明確重試與儲存操作邊界處理。測試以目前存在的行為為準；已明確撤回的介面與重新讀取功能不列為本輪仍保留的功能。

### 地圖的鍵盤遮蔽與可見性

納入來源新增的 visualViewport 尺寸與位移判斷、鍵盤遮蔽時暫停／恢復、暫停 marker 的鍵盤焦點隔離，以及恢復時不搶走導覽連結焦點。原本的最後一筆 observer entry、正交集面積、小正 threshold 與防禦性幾何讀取保留。來源中的舊測試仍要求鍵盤遮蔽後繼續繪製，與新功能相反；以實際失敗對照確認後，改為驗證遮蔽期間持續暫停、解除後復用同一 scene，避免以刪除斷言掩蓋衝突。

### TronClass 的後續防護

納入三個來源提交：獨立連線預設需明確啟用，綁定前及提交交易內確認到期清理已啟用；登入額度以呼叫者與其帳號計算，暫時性來源失敗只退回自己的 attempt ticket。附件寫入在讀取 request body 前核對開關與綁定，沿用既有檔案大小上限並限制同時上傳數。行動工作區遵循總開關；尚未開放的討論、問卷與互評寫入顯示唯讀說明。刪帳只對符合既有 TronClass owner 格式的 UID 執行該子系統清理，並在 relay 記錄遮蔽數字路徑。

這些是來源程式與範例設定的整合，不會替正式環境啟用功能；正式繳交與 tenant／storage 驗收要求仍保留。

### 本輪驗證

- Creator：先在 main 基準實際重現 4 個失敗，再以同四例確認修正。三組完整 suites 為 24／17／53，合計 **94 passed，0 failed／skipped**；main 的既有案例保留。先前 1,773 個案例中的大量 recovery／timeout／bridge／自動重新讀取案例隨 main 明確撤回的功能移除，不將舊測試總數當成本輪仍執行的證據。
- Map：最新固定來源整合後兩組完整 suites **803 passed，0 failed／skipped**（732 component／71 scene）。24 個 rebuild cases 保留精確重建次數，並驗證 keyboard pause → resume；manual restart 保留第二次 allocation，只補上真正移入可視範圍的 scroll fixture。最後兩個增量檔 lint 為 0 errors／4 warnings。
- TronClass Mobile：15 suites／**291 passed**，0 failed／skipped。Functions 刪帳與 relay 相關 3 suites／**77 passed**，0 failed／skipped；修改檔案 lint 通過；launcher **1 passed**。
- TronClass Web：73 files 的完整相關範圍中，68 files 通過、4 個 emulator files／38 tests 因沒有本機 emulator 略過；剩餘 UI suite 在並行執行時出現等待逾時。將該完整 UI suite 單獨執行後 **65／65 passed**，原 5 秒與 DOM 等待門檻不變。合計 69 個可執行檔案的 2,472 個不同案例均取得通過結果，但不將它描述成同一次執行完全無失敗；遠端新 head 全套仍須重新驗收。新增 retention reservation／空退款 row 的真實 Firestore 驗證須由 emulator job 提供。
- TronClass 的來源另有測試遺漏：`owner-account` 新契約仍保留舊 `account` 斷言，upload route 的 module mock 漏掉新增使用的檔案大小常數，以及 controlled-journal emulator 新增 vi 呼叫卻未 import。已在實際測試與型別失敗後修正斷言、partial mock 與 import，保留原安全條件。新刪帳 regex 觸發既有 no-control-regex lint；改用 lifecycle 已採用的 regex 加控制字元檢查，保持同樣 UID 邊界，不調降 lint 規則。

整合後完整 Mobile／Web typecheck 均已通過。變更檔 lint：Mobile 14 檔為 0 errors／13 warnings，Web 18 檔為 0 errors／4 warnings；Functions 修改檔為 0 errors。未更動 lint 或型別政策。18 個現存 refs（17 個非 main 分支與 main）全部驗證為候選祖先。最終 GitHub 候選 SHA 與遠端完整檢查結果由 PR #753 記錄。以下歷史驗證僅對應其註明的舊候選，不能把舊 head 的綠勾當成本輪已通過。

## 16:44 以前的來源範圍（歷史紀錄）

來源快照見同目錄 `2026-11-23-all-branches-sources.json`。此次從 main `b75017aa56c4211931662cf6b61933b47aeb0211` 開始，先納入盤點的 17 個來源分支，於 16:44（台灣時間）最後盤點再納入新分支 #754，共 18 個來源；整合期間另同步最新 main `8aaefb93ada76113792b7f21559fcba2b0170db5`。來源提交均保留為祖先。

#719 在整合期間由 GitHub 合併為 main 的 `8aaefb93`，其來源分支隨後刪除。該 squash commit 與來源 `916bf756` 的 tree 完全相同，本候選合入兩者後內容亦不變；快照保留原來源 SHA，讓已刪除分支的歷史仍可追溯。來源版本固定於本輪快照，最終結果須以同一候選的檢查為準。

#515 的歷史已包含於 #738；洗衣取消與手機看板訂閱分支亦已有祖先關係，無須重複套用。其餘來源的後續提交均整合到同一候選。快照更新納入行事曆完整按鈕換行、校園 WebGL 可見性與教材朗讀排序的最新修正。

## 衝突決策

- main #743 的明確審查決策優先：Firestore 與 Storage 規則維持目前主線行為，不重新引入舊整合分支已撤回的額外存取限制。保留主線相容測試矩陣，另納入既有本人訂單的相容測試。
- main #734 的取餐意圖判讀與 #737 的查課批次驗證優先。保留既有讀寫語意、重複班別正規化、學分驗證及來源擷取時間，不以舊分支退回較寬鬆行為。
- TronClass 與角色 Agent 共用助理入口：TronClass 仍限定學生工作情境，先分流才判讀校園地圖；地圖及下一堂課另依角色工具範圍判斷。TronClass 私有對話仍排除模型歷史，撤權、切換角色與 session 失效時保留取消及 epoch 防護。
- TronClass 快取僅接受已驗證課程集合。重複 ID、空白課名、格式不完整或舊 HTTP 401 快取均重新驗證；來源失敗不回傳未驗證的舊作業／教材。owner、session、projection version、TTL 與來源課程 ID 邊界保留。
- 助理連結保留 main 的 AssistantReplyLink／Anchor，合併洗衣取消確認卡的 scope、AbortController、單次提交與回執核對。

## 本輪修正

1. #746 更新 npm 依賴後漏改 workspace pnpm lock；補齊 jose、ESLint 與對應傳遞依賴，維持 frozen-lockfile。
2. #748 已要求 NumPy 2.5.5，但 Chroma／MLX 工作流程仍固定 2.5.4；測試安裝與版本斷言同步為 2.5.5，保留 1.26.4 遷移／回滾對照。
3. #616 的瀏覽器安裝 fixture 會繼承 Bash job control，造成真實 flock 鎖的子行程邊界不穩定；只在 fixture 關閉 job control，加入 inherited-monitor 回歸。原安裝腳本的 180 秒恢復期限、重試上限及永久錯誤停止條件保留；遠端作業系統差異及後續成功證據見下節。
4. #749 在 render 呼叫 Date.now 造成 React purity lint 失敗；成功接收查詢回應時原子寫入 checkedAt，渲染使用固定差值。重新查詢刷新判定，來源 fetchedAt 與匯入草稿證據維持原值。
5. #740 後續來源 `722bc40d` 在切分頁時重掛載自己的社群簡介，會清掉未確認寫入與草稿；亦刪除撤權優先處理，並讓首次讀取 fallback 吞掉撤權或來源 scope 錯誤。新增回歸實際重現重複儲存、撤權後舊內容回填及並發讀取競爭。整合保留 owner panel、以 tab revision 重新讀取；其他使用者卡片仍維持來源的重掛載意圖。首次讀取僅支援明確暫時網路錯誤，所有已捕獲該讀取的 fallback 共用可失效 record，等待前及完成後均驗證；撤權或來源錯誤會讓舊結果失效，只有新的有效讀取可恢復顯示。
6. 修課方案真實 Chrome 驗收在 `1429f997` 連續兩次於 10 秒啟動期限結束，尚未進入任何功能斷言。將獨立 Chrome 啟動等待設為 30 秒，驗證有效 CDP port，並在 spawn error／提前 exit 時立即報告原因；原 UI 等待與 35 項功能斷言不變。持久測試涵蓋 11 秒才就緒、缺少執行檔、提前 exit 42、活程序一直沒有 port 的 30 秒上限，已加入同一 CI workflow。本機完整 Chrome 因環境 socket 限制未完成，真實瀏覽器驗收以最終候選遠端 CI 為準。
7. #722 最新來源 `2103a2e7` 的同名地標標籤改善納入整合；空白分類與「未分類」視為同群，3D marker 與選擇清單可識別同名不同地點。其 observer 後續改動則實際重現零交集面積仍啟動 WebGL，以及同一 host 的 `[visible, hidden]` 批次仍維持 active。整合保留最後一筆 host entry、正交集面積、小正 threshold 與 getter 防護；完整保留新的標籤功能。依 [W3C Intersection Observer](https://www.w3.org/TR/intersection-observer/) §3.2.5–3.2.8，entry 依序進入 queue，而邊界相接時 isIntersecting 仍可為 true，因此以實際可見面積及最新狀態控制啟停。

## 已完成的專項驗證

- TronClass LMS dispatch：172 項通過。
- 角色路由、TronClass、工作情境、校園地圖與 retry：6 檔，125 項通過。
- PublicCourseSearch：102 項通過；相關 ESLint、TypeScript 通過。
- 社群簡介 panel、profile 與 service：3 套、1,772 項通過，0 skipped；完整 mobile TypeScript 及相關 ESLint 通過。另獨立驗證並發撤權發生於 fallback 開始前／等待中兩種時序，舊結果均被拒絕，正常首次讀取 fallback 仍可使用。
- Chrome 啟動：4 種真實子程序情境通過；這些是啟動契約驗證，不代替真實瀏覽器的功能驗收。
- 校園地圖：CampusSpatialExplorer 714 項、campusSpatialScene 70 項，合計 784 項通過；來源上的零面積啟動與離屏未暫停先重現失敗，再驗證修正及可見後恢復。
- 瀏覽器安裝 fixture：一般模式及 inherited-monitor 模式各 14 項通過；移除修正的負對照失敗。
- Python cloud hashed lock 安裝與 pip check 通過；boundary suite 104 項通過、4 項略過。
- Functions npm ci、隔離部署封裝（142 exports）、lint 與既有 production dependency policy gate 通過；本地全套測試遇 Google 公鑰網路等待，須以最終遠端完整 CI 驗證。

本文件記錄整合時已取得的證據；完整整合的驗證結果以 PR 最終精確 head 的 Actions、CodeQL、瀏覽器與原生相容性檢查為準。舊來源綠勾不代表本候選已通過。

## 安裝恢復檢查的遠端作業系統差異

整合 head `b1bd642737e0c8c9ecf60ed68c36ac5aba03b5a7` 的 [Security Gates job 137542005566](https://github.com/Miiduoa/graduation/actions/runs/45129660060/job/137542005566) 在 `ubuntu-latest` 當時指向的 Ubuntu 26.04.1 上失敗：第一個真實 process／flock 案例逾時後，三次受限 `dpkg` 恢復仍無法取得測試鎖。因此前述本機 job-control 修正尚不足以證明 Ubuntu 26 相容，不能以本機通過結果覆蓋遠端失敗。

同一 head 的 [Admin browser job 137542005087](https://github.com/Miiduoa/graduation/actions/runs/45129659981/job/137542005087) 使用 Ubuntu 24.04.5，於 `2026-11-23T07:16:36Z` 實際執行相同 fixture 並回報 **14/14 passed**，之後亦成功執行真正瀏覽器安裝。逐項讀取工作流程確認，所有實際呼叫 `install-playwright.sh` 的工作均明確使用 `ubuntu-24.04`，只有 Security Gates 的獨立恢復測試因 `ubuntu-latest` 轉移而採用不同主版本。

本次只將 Security Gates runner 明確對齊 `ubuntu-24.04`；原安裝腳本與 fixture 完全保留，真實 process group／flock／sudo 逾時邊界及故意錯置邊界的失敗對照仍執行。所有安全檢查、PostgreSQL 服務、依賴稽核、步驟、相依閘門及失敗政策均未刪除或放寬。既有 workflow contract 測試新增跨工作流程的 runner 一致性檢查：修正前確實因 `ubuntu-latest` 與 `ubuntu-24.04` 不同而失敗。這項調整驗證的是既定 Ubuntu 24 支援範圍；Ubuntu 26 的底層程序差異尚未定位，也不宣稱相容。最終新 head 仍須在遠端重新執行完整檢查。

後續 head `1429f997eaced0818219d3ab488e662d9d865abf` 的 [Security Gates job 137545683441](https://github.com/Miiduoa/graduation/actions/runs/45130751175/job/137545683441) 已成功，實際回報安裝恢復 fixture **14/14 passed**。同 head 的完整核心 CI 亦已通過；這是中間版本的診斷證據，最後新增來源與修正仍須以 PR 最終 head 再次驗證。

## 16:44 最終來源盤點與後續整合

先前候選 `e563c9c189650a87994f83d5304d562f010770e1` 的 [完整核心 CI](https://github.com/Miiduoa/graduation/actions/runs/45134684974)、Python、Chroma、MLX、CodeQL，以及 14 個 browser／mobile-agent／Maestro workflows 均已成功。其 [iOS Release 與兩個 smoke](https://github.com/Miiduoa/graduation/actions/runs/45134685171) 在實際 iPhone 17 Pro／iOS 26.4 simulator 執行，兩份 JUnit 各 1 test、0 failures／errors／skipped；不包含 full native suite。這些是上一候選的證據，不能當成後續變更已通過遠端檢查。

最後盤點另發現 #754 `21547d426144311ba8babc5828f26bff484b8205`、#722 `15856e4d2132df62ac5e043b8d84efe0b1582d74` 與 #740 `d6c7fbed784520c624393eb49e94a8f046744ef9`。本輪將來源固定為此快照，再以新候選驗收：

- #754 的共用抽屜、通知閱讀時間、系統／App 減少動態偏好、載入狀態與中文課程搜尋納入整合。SiteShell 衝突保留共用 AppFrame，只更新載入提示；interface QA 的來源清單同時保留 task_flow.py 與 loading.py，不移除任何既有驗收。
- #722 保留沒有 TextDecoder 時仍逐塊檢查上限的改進，以及拒絕無法量測原始大小的 JSON-only body；原可見面積、同批最後 entry、WebGL 暫停恢復和 fixture ID 精確比對不變。
- #740 首次讀取新增 requireCommitted 必須保留；來源改回 media/list 重掛載所造成的 pending write／draft 遺失風險仍以穩定 owner panel 修正。持續保留焦點與分頁重新讀取、撤權優先與所有 captured-first fallback 共用失效記錄。

此輪專項已確認新共用 Mobile UI 6 suites／107 tests、Web 課程清單與地圖 3 files／796 tests 通過；完整合併後的 creator 3 suites／1,773 tests 全過，0 failed／skipped，完整 Mobile／Web typecheck 通過。相關 lint 為 0 errors；Web 有 10 warnings，未調降 lint 政策。真實 interface fixture 可建置，360 source hashes／27 explicit import boundaries。完整新候選的驗證結果仍以 PR 對應精確 head 的遠端檢查為準。

卡片增量先做實際失敗對照：d6 原元件會在 pending save → media → 再次 save 送出 2 次，且 refresh 的 permission-denied／scope mismatch 保留舊內容；e563 原元件則未拒絕 pending initial 與 pending clear snapshot。整合後九個關鍵情境通過，產品只新增兩處 requireCommitted:true，原狀態與授權防護保留；沒有以刪除安全案例取得通過結果。

## 合併與既有功能開關

main 規則 26004626 仍要求 App 5504170（nuni-merge-gate）對最終候選核發「審查通過」。沒有變更此規則，沒有用一般 PR Approve 或同名檢查替代。

整合保留 TronClass 正式繳交 contractVerified=false 與既有 tenant／storage 驗收要求；未知繳交結果只查證，不自動重送。洗衣取消仍需本人權限與確認。角色 taskProfile 只代表工作情境，不是身分或授權。此整合不改任何正式環境開關，也不代表已完成校方實際收件或正式部署驗收。
