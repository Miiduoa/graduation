# 2026-10-25 依賴分支整合紀錄

基準：`main` 的 `3f5c998734c96b698c47fc54e136bb6986274649`。

17 支 Dependabot 分支均有獨有改動；本次採納其中 9 支，保留原提交作為 merge parents。其餘 8 支保留獨立遷移，沒有刪除分支、停用更新掃描或擴大安全例外。這份紀錄描述程式碼整合與檢查範圍，正式發布狀態以發布紀錄為準。

## 已納入整合候選

| PR | 原始提交 | 內容 |
| --- | --- | --- |
| [#173](https://github.com/Miiduoa/graduation/pull/173) | `89baa56089648a6996557b41a317541e9d400d05` | jose 6.2.13、firebase-functions-test 3.5.0、globals 17.13.0；補齊根 pnpm 鎖檔 |
| [#178](https://github.com/Miiduoa/graduation/pull/178) | `5bdf7b536f9ff64ad0a23da5b0cef9da760c998a` | setup-java 6，保留 Java 21 |
| [#179](https://github.com/Miiduoa/graduation/pull/179) | `e333e73d983049df5507ddf22b5358e8a124627e` | expo-github-action 9，保留原本發布條件與參數 |
| [#180](https://github.com/Miiduoa/graduation/pull/180) | `44abbb44484968cf0cad57d52037f3d950c83636` | test-reporter 3，保留 Maestro 報告設定 |
| [#181](https://github.com/Miiduoa/graduation/pull/181) | `7f49785ad2c4ea8684310dbe8c9a3d4ada34bb3d` | gitleaks-action 3，保留掃描規則與例外範圍 |
| [#182](https://github.com/Miiduoa/graduation/pull/182) | `2aaebb37eb407d3b5754e8c61f01fd6f424695bd` | github-script 9，保留既有預覽資訊格式 |
| [#185](https://github.com/Miiduoa/graduation/pull/185) | `0d97aaee89f2ae314368102070cff36984234e28` | 本機 langchain-text-splitters 下界升至 1.1.3 |
| [#187](https://github.com/Miiduoa/graduation/pull/187) | `1b4a942bf2ceb7c400e052c78ead6dd4ffbab73d` | 本機 APScheduler 下界升至 3.11.3 |
| [#193](https://github.com/Miiduoa/graduation/pull/193) | `51a00b63a2174c5b08f732c80f53a23dde67a49c` | Functions 獨立 npm 鎖檔的 Babel 7.29.7 更新 |

根 pnpm override 原已指定 Babel 7.29.7，但 `backend/functions/package-lock.json` 原先仍鎖定 7.29.0；兩個安裝路徑需要分別維護，因此保留 #193 的更新。

## 保留獨立遷移

| PR | 尚待處理的相容性 | 放行前需補齊 |
| --- | --- | --- |
| [#174](https://github.com/Miiduoa/graduation/pull/174) Jest 30 | 測試執行器由 29 升至 30，原分支未同步 pnpm 鎖檔 | 更新兩個鎖檔，驗證 Functions 完整測試、模組載入、mock 與覆蓋率設定 |
| [#175](https://github.com/Miiduoa/graduation/pull/175) Zod 4 | 現有工具 schema 直接從 `zod` 建立，再交給 `zod-to-json-schema` 轉為 OpenAPI 參數 | 驗證工具參數的 properties、required、限制條件及驗證失敗行為，完成轉換 API 遷移後同步鎖檔 |
| [#176](https://github.com/Miiduoa/graduation/pull/176) ESLint 10 | 單獨升 lint engine，其他工作區及 recommended config 尚未協調 | 與 #177 一起核對共享設定、外掛與全部 lint 結果 |
| [#177](https://github.com/Miiduoa/graduation/pull/177) @eslint/js 10 | 單獨升 recommended config，原分支仍搭配 ESLint 9 | 與 #176 協同更新兩個鎖檔，保留原有規則，不以忽略檢查消除錯誤 |
| [#184](https://github.com/Miiduoa/graduation/pull/184) NumPy 2 | 本機依賴下界跨越主要版本，既有 CI 不安裝完整 ML 套件 | 核對 Chroma、ONNX、MLX 的 wheel 與陣列行為，於實際支援平台測試 |
| [#186](https://github.com/Miiduoa/graduation/pull/186) MLX-LM 0.32 | 0.21 至 0.32 的模型與訓練 API 變更尚未驗證 | 於 Apple Silicon 核對模型載入、LoRA 及現有訓練腳本 |
| [#188](https://github.com/Miiduoa/graduation/pull/188) Chroma 1.5 | 0.5 至 1.5 的 PersistentClient 與既有向量資料相容性待驗證 | 先以暫存向量庫測試；保留既有資料與嵌入式存取邊界。1.5.9 仍有安全文件列出的未修補項目，不將版本提升視為缺口清零 |
| [#192](https://github.com/Miiduoa/graduation/pull/192) Firebase Admin 14 | 現有 firebase-functions 6.6.0 與 firebase-functions-test 3.5.0 的 Admin peer range 僅支援至 13 | 協同選定 Admin、Functions、測試 SDK 的相容版本，驗證登入、交易、觸發器與獨立封裝 |

本機 `requirements.txt` 使用最低版本約束；保留 #184、#186、#188 不會限制解析器選到較新版本，亦不代表本機執行期已鎖在舊版。實際已安裝的 NumPy、Chroma 與 MLX 版本不在本輪確認範圍。

原 #173–177、#192 的 Functions CI 都在安裝階段回報 `ERR_PNPM_OUTDATED_LOCKFILE`，尚未開始執行測試。不能將這些紅燈解讀為已完成大版本相容性測試。

## 兩套 JavaScript 鎖檔的更新流程

`pnpm-lock.yaml` 用於工作區安裝、測試與 Web／App 建置；`backend/functions/package-lock.json` 用於獨立 Functions 封裝。保留現有 Dependabot 掃描，接到任一路徑的更新時，先在目前主線整合候選上確認 manifest，再同步另一套鎖檔。

使用儲存庫指定的 Node 與 pnpm 版本，在根目錄執行：

```sh
npm install --package-lock-only --ignore-scripts --prefix backend/functions
pnpm install --lockfile-only --ignore-scripts
pnpm install --frozen-lockfile
pnpm --filter functions lint
pnpm --filter functions test --runInBand
node scripts/verify-functions-package.cjs
```

檢查兩個鎖檔的差異是否符合預期，並執行 CI 的既有安全閘門。`verify-functions-package.cjs` 會在隔離的封裝目錄執行 `npm ci --omit=dev`，確認實際部署套件沒有依賴工作區外的檔案。不要藉由取消 frozen lock、移除獨立封裝檢查或放寬 audit 來接受不一致的更新。

## 本次依賴整合的驗證範圍

- Node 22.23.4、pnpm 10.28.2 重新產生根鎖檔後，`pnpm install --lockfile-only --frozen-lockfile --ignore-scripts --offline` 通過；沒有變更 Functions 的 Firebase Admin、Functions、Jest 或 Zod 主要版本。
- 原 Actions 候選的主要 CI 通過；#178 的規則測試、#180 的 Maestro iPhone 15 流程、#181 的安全閘門有實際成功結果。Expo 與 github-script 所在預覽發布 job 原先被略過，這次沒有為測試 action 而發布 App。
- Python 使用獨立 Python 3.12 環境，以現有 `requirements-cloud.txt` 的 47 個版本約束解析實際使用到的共同依賴，安裝 `APScheduler==3.11.3` 與 `langchain-text-splitters==1.1.3`，`pip check` 通過。cloud lock 本身未修改。
- 使用實際 `rag/indexer.py` 與新版 splitter 處理 300 筆合成中文文件，產生 900 個文字片段；確認片段長度、每批至多 256 筆、穩定編號、來源中繼資料、embedding 筆數與空內容。Chroma 寫入邊界使用記憶體接收器，沒有載入或變動既有向量庫。
- APScheduler 實際執行 Asia/Taipei 日期工作與取消排程。應用目前的背景成長排程採 `asyncio`，本次沒有更換排程器。
- 上述 Python 檢查涵蓋兩個套件更新的接點，不代表 Chroma、MLX、模型推論或完整本機 ML 依賴圖已通過測試。正式整合候選仍須通過整體 CI。

上游來源：

- [APScheduler 3.11.3 release](https://github.com/agronholm/apscheduler/releases/tag/3.11.3)：修正夏令時間切換下的短間隔工作與匯入工作連結。
- [langchain-text-splitters 1.1.3 release](https://github.com/langchain-ai/langchain/releases/tag/langchain-text-splitters%3D%3D1.1.3)：包含延遲載入選用依賴、切段行為修正與依賴維護。
- [本機與雲端 Python 安全邊界](security/python-ai-server.md)：cloud lock、Chroma 嵌入式使用與未修補項目的既有範圍。
