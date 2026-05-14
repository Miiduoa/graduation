校園漫步遊戲用圖（預設免費 / 選配本機 AI）
============================================
預設產製方式為 **純 Pillow 向量風占位圖**：不需 API、不需付費額度、離線亦可。

▼ 最常見（macOS Homebrew Python：無 `pip` 指令或會出現 externally-managed-environment）

（專題根目錄）建一次專用 venv：

  cd 專題根目錄
  python3 -m venv .venv-game-assets
  .venv-game-assets/bin/python -m pip install pillow
  .venv-game-assets/bin/python scripts/generate-campus-game-flux.py

之後每次都可用最後一行重產圖。（`.venv-game-assets` 已列入 `.gitignore`，勿提交）

▼ 若系統 Python 允許直接使用 pip：

  python3 -m pip install pillow
  python3 scripts/generate-campus-game-flux.py

▼ 亦可使用你已裝過 Pillow 的 Comfy／其他 venv：

  ~/Desktop/AI圖像本地引擎/.venv/bin/python scripts/generate-campus-game-flux.py

選配——本機「AI 質感」出圖時，先自行啟動 ComfyUI，再：

  .venv-game-assets/bin/python scripts/generate-campus-game-flux.py --comfy

若工作流程使用 Flux／其他商用模型，費用與授權請自行評估。

加上 --force-placeholders 可強制不使用 Comfy（即使已傳 --comfy）。

manifest：scripts/campus-game-assets-manifest.json
