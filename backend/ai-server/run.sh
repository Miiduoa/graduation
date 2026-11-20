#!/bin/bash
# Campus AI Server – 一鍵啟動腳本
#
# 使用方式：
#   chmod +x run.sh
#   ./run.sh              # 啟動 AI 伺服器
#   ./run.sh --prepare    # 準備訓練資料
#   ./run.sh --train      # 執行 LoRA 微調
#   ./run.sh --train-hours [小時]   # 依時長跑 LoRA（預設 24；會先 prepare + MLX 去重）
#   ./run.sh --eval       # 評估模型
#   ./run.sh --grow       # 手動觸發自我訓練循環

set -e
cd "$(dirname "$0")"

# NumPy 2.5 需要 Python 3.12 以上；先確認環境，不覆寫既有虛擬環境。
check_python() {
    "$1" - <<'PYTHON'
import sys
if sys.version_info < (3, 12):
    print(
        "本機 AI 依賴需要 Python 3.12 以上；目前是 " + sys.version.split()[0] +
        "。請先備份既有環境與資料，再用相容版本另建虛擬環境。",
        file=sys.stderr,
    )
    sys.exit(1)
PYTHON
}

if [ -e ".venv" ] || [ -L ".venv" ]; then
    if [ ! -x ".venv/bin/python" ] || [ ! -f ".venv/bin/activate" ]; then
        echo "既有 .venv 不完整，已停止；不會覆寫或刪除。請先檢查與備份環境。" >&2
        exit 1
    fi
    check_python ".venv/bin/python"
else
    PYTHON_BIN="${PYTHON_BIN:-python3}"
    if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
        echo "找不到 Python；請以 PYTHON_BIN 指定 Python 3.12 以上的執行檔。" >&2
        exit 1
    fi
    check_python "$PYTHON_BIN"
    echo "建立 Python 虛擬環境..."
    "$PYTHON_BIN" -m venv .venv
fi

source .venv/bin/activate

# 用虛擬環境自己的 pip，保留安裝錯誤；失敗時不得啟動服務或訓練。
if ! .venv/bin/python -m pip install -q -r requirements.txt; then
    echo "依賴安裝失敗，未啟動服務或訓練。請依上方錯誤修正；既有 .venv 已保留。" >&2
    exit 1
fi

# 確保 Ollama 在執行中（只有 ollama provider 需要）
LLM_PROVIDER_VALUE="${LLM_PROVIDER:-}"
if [ -f ".env" ] && [ -z "$LLM_PROVIDER_VALUE" ]; then
    LLM_PROVIDER_VALUE="$(grep -E '^LLM_PROVIDER=' .env | tail -1 | cut -d= -f2- | tr -d '\"')"
fi
LLM_PROVIDER_VALUE="${LLM_PROVIDER_VALUE:-ollama}"

if [ "$LLM_PROVIDER_VALUE" = "ollama" ] && ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "啟動 Ollama 服務..."
    if command -v brew >/dev/null 2>&1; then
        brew services start ollama
        sleep 3
    else
        echo "找不到 brew，請先自行啟動 Ollama 或改用 LLM_PROVIDER=groq。"
        exit 1
    fi
fi

case "${1:-serve}" in
    serve|--serve)
        echo "🚀 啟動 Campus AI Server (default bind 127.0.0.1; public bind requires REQUIRE_FIREBASE_AUTH=true)..."
        python server.py
        ;;
    --prepare)
        echo "📝 準備訓練資料..."
        python -m training.prepare_data
        ;;
    --index)
        echo "📚 索引 APP 知識到向量資料庫..."
        python -m rag.index_app_knowledge
        ;;
    --train)
        echo "🧠 執行 LoRA 微調..."
        shift
        python -m training.finetune "$@"
        ;;
    --train-hours)
        HOURS="${2:-24}"
        echo "⏱️ LoRA 微調約 ${HOURS} 小時（prepare → MLX 轉檔去重 → mlx_lm；時間到送 SIGINT）"
        if [ -n "${2:-}" ]; then
            shift 2
        else
            shift 1
        fi
        python -m training.train_timed --hours "$HOURS" -- "$@"
        ;;
    --eval)
        echo "📊 評估模型品質..."
        python -m training.eval
        ;;
    --grow)
        echo "🌱 執行自我訓練循環..."
        python -m self_training.growth_engine
        ;;
    --self-instruct)
        echo "💡 執行 Self-Instruct 資料生成..."
        python -m self_training.self_instruct
        ;;
    --sync)
        if [ -z "$2" ]; then
            echo "用法: $0 --sync <server-url>"
            echo "例如: $0 --sync https://campus-ai-server.onrender.com"
            exit 1
        fi
        echo "☁️  從雲端同步 feedback..."
        python -m self_training.cloud_sync --server-url "$2"
        ;;
    *)
        echo "用法: $0 [serve|--prepare|--index|--train|--train-hours [小時]|--eval|--grow|--self-instruct|--sync <url>]"
        exit 1
        ;;
esac
