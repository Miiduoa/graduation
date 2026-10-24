# Python AI Server 安全邊界（cloud lock／本機 RAG）

**範圍：** `backend/ai-server`
**基準：** `origin/main` `e37866a`（#167）後續 Python follow-up；**不**宣稱已涵蓋完整 ML／torch／mlx 依賴圖。
**部署證明：** 本文件**不**主張目前 Render／其他主機上的實際 installed 版本；藍圖存在（`Dockerfile`／`render.yaml`），服務盤點需工作區另外確認。

## Cloud／Docker 路徑

- 直接約束：`requirements-cloud.in`（含 `python-dotenv>=1.2.2`、`fastapi>=0.162.0` 安全線）。
- 可重現鎖：`requirements-cloud.txt`（編譯 pin＋PyPI hashes；約 23 套件）。
- Docker：`pip install --require-hashes -r requirements-cloud.txt`；`uvicorn --host 0.0.0.0` 保留，並設 `AI_SERVER_HOST=0.0.0.0`。
- 公開綁定契約：必須 `REQUIRE_FIREBASE_AUTH=true`（見 `render.yaml`）。無「關閉驗證仍可公開綁定」的 opt-out。
- CI：`python-ai-server-security` 對 **cloud lock** 跑 `pip-audit`（任一 advisory／稽核錯誤即失敗）＋ focused tests。
  - 應用測試環境：僅 `pip install --require-hashes -r requirements-cloud.txt`。
  - `pip-audit==2.10.1` 裝在 `${RUNNER_TEMP}/audittoolvenv`（獨立 tool venv），讀 lock 檔、**不**寫入應用 venv。
  **此閘門≠完整 ML graph 稽核。**

## 本機 `requirements.txt`／RAG

- 共用直接下界與 cloud `.in` 對齊；已移除未使用的直接依賴 `sentence-transformers`（全庫無 import；RAG 走 Chroma 內建 embedding／ONNX）。
- `langchain-text-splitters>=1.1.2`、`python-dotenv>=1.2.2`。
- 保留 `chromadb`／`mlx-lm` 與既有 PersistentClient／本機功能；**未**做向量庫替換或資料遷移／刪除。

### ChromaDB 未修補 advisory（明確缺口）

截至稽核當下，PyPI **chromadb 1.5.9** 仍命中未修 Critical／High（含預認證 code injection 等；`last_affected=1.5.9`，無 fixed 事件）。
**不可**將本機 manifest 或本 CI 綠燈解讀為「Chroma／完整 ML 已清零」。

### 支援／不支援邊界

| 模式 | 狀態 |
|------|------|
| `chromadb.PersistentClient`（嵌入式，本機路徑 `data/chroma_db`） | **實際使用**；僅本機 process 內 API |
| Chroma **HTTP server**（例如租戶／collections REST：`/api/v2/...`） | **不支援、不掛載**；FastAPI app **無** Chroma router／mount |
| 對不可信網路暴露 Chroma HTTP | **禁止**；正式 Docker cloud 路徑不安裝 chromadb |

控制回歸：對執行中的 Campus AI FastAPI 發送 Chroma 風格 `/api/v2/.../collections` 應為 **404**（未掛載），而非 Chroma 伺服器行為。

## 本機綁定

- `python server.py` 預設 `127.0.0.1`。
- 擁有的 entry 解析優先序：`explicit` > 最後一個 CLI `--host`（Click／Uvicorn 語意）> `UVICORN_HOST` > `AI_SERVER_HOST` > loopback。
  （`UVICORN_HOST`＝Uvicorn Click `auto_envvar_prefix=UVICORN`；涵蓋 cloud／external `uvicorn` CLI。）
- **區分缺席與明確空白：** 省略 `--host`（`None`）→ loopback 預設；明確 `--host=`／`--host ""`／僅空白（含最後一個 duplicate 為空白）→ **不支援**，啟動前拒絕（Uvicorn 會把 `host=""` 綁成 `0.0.0.0`／`::`，禁止靜默回落到 `127.0.0.1`）。
- **環境變數空字串：** 真正的 `UVICORN_HOST=`（空）比照 Click **忽略**（等同未設）；僅空白字元的 env 值視為不支援 blank，fail-closed。
- 任何非 loopback 綁定（含 `0.0.0.0`）在 `REQUIRE_FIREBASE_AUTH` 未啟用時 **啟動失敗**（lifespan／`python server.py`）。無 insecure opt-out。
- 本機 Ollama／未驗證模式僅適用 loopback；雲端容器公開埠沿用既有 Firebase 驗證契約。
- **不**宣稱可發現任意程式化 `uvicorn.run(host=...)`（owned entry／CLI／上述 env 以外）的綁定位址。

## 限制

1. 完整 `requirements.txt` 含 chromadb／mlx-lm 等重型 wheel，**未**在 CI 全量 resolve／pip-audit。
2. 無本文件可引用的 production 映像 `pip freeze`（層 C）。
3. Chroma 上游未修補前，本機 RAG 風險以「嵌入式＋不暴露 HTTP」緩解，**不是**套件級修復。
