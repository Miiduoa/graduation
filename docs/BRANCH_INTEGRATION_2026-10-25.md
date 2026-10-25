# 2026-10-25 分支整合紀錄

## 範圍與決策

以 `main` 的 `3f5c998734c96b698c47fc54e136bb6986274649` 為基準，核對當時全部 26 個遠端分支：主線 1 個、功能與修正分支 8 個、Dependabot 分支 17 個。

處理期間另新增 #203 登入修正分支，亦納入查核，共處理 27 個分支。本次內容涵蓋 18 個非主線分支；其餘 8 個保留為獨立升級遷移。#201 及其包含的四個功能分支、#202、#203 在本輪處理期間已先進入主線；本次保留最新主線 `c5de91e232918cf734096ffdb3d59cffbfeafa47` 的提交歷史。原始分支的提交以 merge parents 保留，不重寫原始歷史，也不以版本較新作為相容性證明。

## 功能與修正分支

| PR | 分支 | 處理 |
| --- | --- | --- |
| #165 | `fix/school-service-details-20261024` | 由 #201、#202 完整納入；保留各校課務來源與公開服務邊界。 |
| #169 | `redesign/admin-workflows-20261024` | 由 #201、#202 完整納入；保留校方、教師、服務承辦權責及交易內授權檢查。 |
| #170 | `improve/school-accuracy-20261024` | 由 #201、#202 完整納入；跨校公開資訊、活動報名與行程提醒。 |
| #171 | `chore/docs-wording-scan-ignore` | 納入文件與既有掃描紀錄修正；12 筆提交 SHA 映射已核對相同檔案 blob，未增加忽略項目。 |
| #172 | `feat/daily-workflow-reliability-20261024` | 由 #201、#202 完整納入；失物刊登恢復、教材查找與學分試算。 |
| #191 | `fix/functions-server-readiness` | 納入登入、secret 讀取與輸入限制，另修正 preflight 執行順序及客戶端公車登入狀態。 |
| #201 | `improve/campus-experience-20261025` | 完整包含於 #202，不重複套用補丁。 |
| #202 | `improve/campus-daily-flow-20261025` | 納入最新 `d8a47453`，保留手機課表、大字體、圖片重新編碼及取消任務資源釋放。 |
| #203 | `fix/account-return-context-20261025` | 保留登入 query 白名單、安全內容錨點、OLED 頁尾及原生驗證紀錄，與 #202 登入交接一併整合。 |

已用 Git ancestry 核對 #165、#169、#170、#172 最新 head 都是 #201 的祖先，#201 最新 head 又是 #202 的祖先。

## 依賴分支

| PR | 分支 | 處理 |
| --- | --- | --- |
| #173 | `dependabot/npm_and_yarn/backend/functions/functions-patch-minor-f08d2cd172` | 納入 jose、Functions 測試工具、globals 小版本，修正根 pnpm lock 與獨立 npm lock 不同步。 |
| #178 | `dependabot/github_actions/actions/setup-java-6` | 納入，維持 Java 21 設定。 |
| #179 | `dependabot/github_actions/expo/expo-github-action-9` | 納入，保留原發布條件與權限。 |
| #180 | `dependabot/github_actions/dorny/test-reporter-3` | 納入，維持既有 Maestro 報告流程。 |
| #181 | `dependabot/github_actions/gitleaks/gitleaks-action-3` | 納入，未放寬掃描或安全閘門。 |
| #182 | `dependabot/github_actions/actions/github-script-9` | 納入，保留既有預覽流程條件。 |
| #185 | `dependabot/pip/backend/ai-server/langchain-text-splitters-gte-1.1.3` | 納入；隔離環境驗證實際文字分段器與既有 indexer。 |
| #187 | `dependabot/pip/backend/ai-server/apscheduler-gte-3.11.3` | 納入；隔離環境驗證臺灣時區工作執行與取消。 |
| #193 | `dependabot/npm_and_yarn/backend/functions/babel/core-7.29.7` | 納入，更新 Functions 獨立 npm lock 中的 Babel。 |
| #174 | `dependabot/npm_and_yarn/backend/functions/jest-30.5.2` | 保留獨立遷移；需核對 Jest 30 與跨 workspace 測試工具、同步雙鎖檔。 |
| #175 | `dependabot/npm_and_yarn/backend/functions/zod-4.6.7` | 保留獨立遷移；需核對工具參數的 schema 轉換、required/properties 與驗證錯誤。 |
| #176 | `dependabot/npm_and_yarn/backend/functions/eslint-10.13.0` | 保留獨立遷移；應與 #177 及 workspace lint 工具鏈一起處理。 |
| #177 | `dependabot/npm_and_yarn/backend/functions/eslint/js-10.0.1` | 保留獨立遷移；不可單獨將 recommended config 升到不同於執行器的主要版本。 |
| #184 | `dependabot/pip/backend/ai-server/numpy-gte-2.5.4` | 保留獨立遷移；需核對 NumPy 2 與本機 ONNX、Chroma、MLX wheel 圖。 |
| #186 | `dependabot/pip/backend/ai-server/mlx-lm-gte-0.32.2` | 保留獨立遷移；需在 Apple Silicon 驗證載模、LoRA 與訓練腳本。 |
| #188 | `dependabot/pip/backend/ai-server/chromadb-gte-1.5.9` | 保留獨立遷移；需驗證既有向量庫與 PersistentClient，且不能將此版本視為已修復所有 advisory。 |
| #192 | `dependabot/npm_and_yarn/backend/functions/multi-a01711886d` | 保留獨立遷移；Admin 14 與現有 Functions 6.6 的 peer 範圍不相容，須協同升級 SDK。 |

本機 `requirements.txt` 使用最低版本約束；保留 #184、#186、#188 不會限制解析器選到較新版本，亦不代表本機執行期已鎖在舊版。實際已安裝的 NumPy、Chroma 與 MLX 版本不在本輪確認範圍。

各依賴原始 head、來源及雙鎖檔維護方式見 [依賴分支紀錄](DEPENDENCY_BRANCHES_2026-10-25.md)。未停用 Dependabot 的 major 或安全掃描。

## 整合時補上的修正

- 新登入頁保留白名單 query 與安全內容錨點（含匯入 `kind`）；移除巢狀 redirect 與 credential 參數。外部網址、控制字元、編碼路徑分隔字元、登入循環及過長輸入仍拒絕，Campus One 任務經既有 `/login` 交接。
- OLED 登入頁頁尾改用主題色，實際瀏覽器檢查文字對比至少 4.5。
- 助理請求先檢查登入與輸入上限，再讀取帳號；帳號刪除與停用保護維持有效。
- 公車 callable 回覆未登入時，Web／App 顯示登入需求並停止自動重試；Web 提供登入及公開站牌入口，App 保留公開站牌與官方查詢。
- 管理授權程式與 #169 原始 blob 核對，學校、教師與承辦的範圍限制未被合併覆蓋。
- 瀏覽器登入測試的合成 session 補齊格式正確的帳號 ID、非管理員旗標與 context；維持實際點擊返回及參數清除檢查。

## 本機最終驗證

執行環境為 Node 22.23.4、pnpm 10.28.2。以下對應整合後程式，沒有把各分支原有 CI 或重疊的針對性測試再加總。

| 檢查 | 結果 |
| --- | --- |
| Frozen lockfile 安裝 | 通過 |
| 獨立 Functions 部署包 | 隔離 npm ci 成功，121 個 exports 及來源邊界驗證通過 |
| 完整 Web 測試 | 3,230 通過、11 既有略過、0 失敗 |
| 完整 App 測試 | 3,300 通過、1 既有略過、0 失敗 |
| 完整 Functions 測試 | 1,172 通過、0 略過、0 失敗 |
| 型別檢查 | App、shared 通過；Web 正式建置內型別檢查通過 |
| 全套 lint | 0 errors；保留 App 554、Web 99、Functions 6、shared 3 項既有 warnings |
| Web 正式模式建置 | 通過，standalone 可啟動 |
| 瀏覽器視覺／操作 | 29 項通過；涵蓋 320/390/768/1440 px、200% 字級、OLED、搜尋與登入返回 |
| 課表瀏覽器 | 9 項通過；涵蓋切校隔離、拖曳、鍵盤操作、取消與草稿保存 |
| Python 小版本 | 隔離環境的相依檢查、實際 indexer 及排程 smoke 通過；範圍見依賴紀錄 |

Web 首次與建置平行執行時，一項商家帳號切換測試逾時；單檔 14 項通過後，在原設定、無平行建置的情況下完整重跑 3,230 項通過。沒有提高逾時門檻或增加略過項目。

瀏覽器使用本機正式模式產物、Chromium 143 和受控訪客／工作階段資料，不讀取正式帳號。此紀錄不代表真實 Google／學校 OAuth、實體 iOS／Android、完整本機 ML 環境或正式發布驗收。GitHub CI、規則測試及程式掃描，以整合 PR 最終 head 的 Checks 為準；部署仍走專案原有獨立發布流程。
