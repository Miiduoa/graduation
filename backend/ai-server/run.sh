#!/bin/bash
# Campus AI Server – 一鍵啟動腳本
#
# 使用方式：
#   chmod +x run.sh
#   ./run.sh              # 啟動 AI 伺服器
#   ./run.sh --prepare    # 準備訓練資料
#   ./run.sh --train      # 執行 LoRA 微調
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

# 確保 Ollama 在執行中
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "啟動 Ollama 服務..."
    brew services start ollama
    sleep 3
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
        python -m training.finetune "$@"
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
        echo "用法: $0 [serve|--prepare|--index|--train|--eval|--grow|--self-instruct|--sync <url>]"
        exit 1
        ;;
esac
