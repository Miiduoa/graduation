# 2026-11-23 全分支整合決策

## 來源範圍

來源快照見同目錄 `2026-11-23-all-branches-sources.json`。此次以 main `b75017aa56c4211931662cf6b61933b47aeb0211` 為基底，納入快照內全部 17 個非 main 分支。整合保留來源提交為祖先，不以覆蓋 main 或刪除分支代替合併。

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
3. #616 的瀏覽器安裝 fixture 會繼承 Bash job control，造成真實 flock 鎖的子行程邊界不穩定；只在 fixture 關閉 job control，加入 inherited-monitor 回歸。原安裝腳本的 180 秒恢復期限、重試上限及永久錯誤停止條件保留。原遠端失敗尚需本候選 CI 證明已排除。
4. #749 在 render 呼叫 Date.now 造成 React purity lint 失敗；成功接收查詢回應時原子寫入 checkedAt，渲染使用固定差值。重新查詢刷新判定，來源 fetchedAt 與匯入草稿證據維持原值。

## 已完成的專項驗證

- TronClass LMS dispatch：172 項通過。
- 角色路由、TronClass、工作情境、校園地圖與 retry：6 檔，125 項通過。
- PublicCourseSearch：102 項通過；相關 ESLint、TypeScript 通過。
- 瀏覽器安裝 fixture：一般模式及 inherited-monitor 模式各 14 項通過；移除修正的負對照失敗。
- Python cloud hashed lock 安裝與 pip check 通過；boundary suite 104 項通過、4 項略過。
- Functions npm ci、隔離部署封裝（142 exports）、lint 與既有 production dependency policy gate 通過；本地全套測試遇 Google 公鑰網路等待，須以最終遠端完整 CI 驗證。

本文件記錄整合時已取得的證據；完整整合的驗證結果以 PR 最終精確 head 的 Actions、CodeQL、瀏覽器與原生相容性檢查為準。舊來源綠勾不代表本候選已通過。

## 安裝恢復檢查的遠端作業系統差異

整合 head `b1bd642737e0c8c9ecf60ed68c36ac5aba03b5a7` 的 [Security Gates job 137542005566](https://github.com/Miiduoa/graduation/actions/runs/45129660060/job/137542005566) 在 `ubuntu-latest` 當時指向的 Ubuntu 26.04.1 上失敗：第一個真實 process／flock 案例逾時後，三次受限 `dpkg` 恢復仍無法取得測試鎖。因此前述本機 job-control 修正尚不足以證明 Ubuntu 26 相容，不能以本機通過結果覆蓋遠端失敗。

同一 head 的 [Admin browser job 137542005087](https://github.com/Miiduoa/graduation/actions/runs/45129659981/job/137542005087) 使用 Ubuntu 24.04.5，於 `2026-11-23T07:16:36Z` 實際執行相同 fixture 並回報 **14/14 passed**，之後亦成功執行真正瀏覽器安裝。逐項讀取工作流程確認，所有實際呼叫 `install-playwright.sh` 的工作均明確使用 `ubuntu-24.04`，只有 Security Gates 的獨立恢復測試因 `ubuntu-latest` 轉移而採用不同主版本。

本次只將 Security Gates runner 明確對齊 `ubuntu-24.04`；原安裝腳本與 fixture 完全保留，真實 process group／flock／sudo 逾時邊界及故意錯置邊界的失敗對照仍執行。所有安全檢查、PostgreSQL 服務、依賴稽核、步驟、相依閘門及失敗政策均未刪除或放寬。既有 workflow contract 測試新增跨工作流程的 runner 一致性檢查：修正前確實因 `ubuntu-latest` 與 `ubuntu-24.04` 不同而失敗。這項調整驗證的是既定 Ubuntu 24 支援範圍；Ubuntu 26 的底層程序差異尚未定位，也不宣稱相容。最終新 head 仍須在遠端重新執行完整檢查。

## 合併與既有功能開關

main 規則 26004626 仍要求 App 5504170（nuni-merge-gate）對最終候選核發「審查通過」。沒有變更此規則，沒有用一般 PR Approve 或同名檢查替代。

整合保留 TronClass 正式繳交 contractVerified=false 與既有 tenant／storage 驗收要求；未知繳交結果只查證，不自動重送。洗衣取消仍需本人權限與確認。角色 taskProfile 只代表工作情境，不是身分或授權。此整合不改任何正式環境開關，也不代表已完成校方實際收件或正式部署驗收。
