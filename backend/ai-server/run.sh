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

# 確保虛擬環境存在
if [ ! -d ".venv" ]; then
    echo "建立 Python 虛擬環境..."
    python3 -m venv .venv
fi

source .venv/bin/activate

# 安裝依賴
pip install -q -r requirements.txt 2>/dev/null

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
        echo "🚀 啟動 Campus AI Server (port 8100)..."
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
