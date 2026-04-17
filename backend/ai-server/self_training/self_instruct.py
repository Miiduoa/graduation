"""Self-Instruct pipeline – the model generates its own training data.

The model examines campus knowledge, invents realistic questions a student
might ask, then answers them.  A separate evaluation pass scores each QA pair;
only high-quality pairs are kept for the next LoRA fine-tuning round.
"""

from __future__ import annotations

import json
import logging
import random
import time
from pathlib import Path

from config import SELF_TRAIN_DIR, SELF_TRAIN_BATCH_SIZE
from rag.retriever import retrieve, format_context

logger = logging.getLogger(__name__)

GENERATED_PATH = SELF_TRAIN_DIR / "self_instruct_raw.jsonl"
FILTERED_PATH = SELF_TRAIN_DIR / "self_instruct_filtered.jsonl"

SEED_TOPICS = [
    "公告與通知", "校園活動報名", "餐廳推薦與菜單", "課表查詢",
    "成績與 GPA", "學分試算與畢業", "選課建議", "圖書館服務",
    "校園地點導航", "宿舍服務", "公車時刻", "作業繳交",
    "失物招領", "健康中心預約", "APP 功能教學", "時間管理",
    "學習方法建議", "壓力管理", "社團與群組", "校園支付",
]


def _call_llm(messages: list[dict], max_tokens: int = 512) -> str:
    """Call the LLM via the unified client (blocking)."""
    import llm_client
    try:
        return llm_client.chat_sync(messages, max_tokens=max_tokens, temperature=0.8)
    except Exception as e:
        logger.warning("LLM call failed: %s", e)
        return ""


def generate_questions(n: int = SELF_TRAIN_BATCH_SIZE) -> list[str]:
    """Ask the model to invent realistic student questions."""
    questions: list[str] = []
    per_batch = 20

    for _ in range(0, n, per_batch):
        topic = random.choice(SEED_TOPICS)
        rag_chunks = retrieve(topic, top_k=3)
        context_str = format_context(rag_chunks)

        prompt = (
            f"你是一個大學生問題生成器。請根據以下校園資訊，生成 {per_batch} 個真實大學生可能會問校園助理的問題。\n"
            f"主題範圍：{topic}\n\n"
            f"參考資訊：\n{context_str}\n\n"
            f"要求：\n"
            f"- 每行一個問題\n"
            f"- 問題要自然、口語化\n"
            f"- 涵蓋不同難度（簡單查詢、分析建議、情感支持）\n"
            f"- 用繁體中文\n"
            f"- 只輸出問題，不要編號或前綴"
        )

        answer = _call_llm([{"role": "user", "content": prompt}], max_tokens=1024)
        for line in answer.strip().split("\n"):
            cleaned = line.strip().lstrip("0123456789.、-）) ")
            if 4 < len(cleaned) < 100 and ("？" in cleaned or "?" in cleaned or "嗎" in cleaned or len(cleaned) > 8):
                questions.append(cleaned)

        time.sleep(1)

    logger.info("Generated %d raw questions", len(questions))
    return questions[:n]


def generate_answers(questions: list[str]) -> list[dict]:
    """Have the model answer each generated question with RAG context."""
    pairs: list[dict] = []

    for q in questions:
        rag_chunks = retrieve(q, top_k=3)
        context_str = format_context(rag_chunks)

        system_msg = (
            "你是校園智慧助理。根據提供的參考資料回答問題。\n"
            "回答要友善、具體、使用繁體中文，結尾加上「建議選項：」。\n\n"
            f"參考資料：\n{context_str}"
        )

        answer = _call_llm([
            {"role": "system", "content": system_msg},
            {"role": "user", "content": q},
        ], max_tokens=512)

        if answer and len(answer) > 20:
            pairs.append({
                "instruction": q,
                "input": f"[RAG Context] {context_str[:200]}..." if context_str else "",
                "output": answer,
            })

        time.sleep(0.5)

    logger.info("Generated %d QA pairs", len(pairs))
    return pairs


def score_qa_pair(pair: dict) -> float:
    """Ask the model to self-evaluate a QA pair on a 1-10 scale."""
    prompt = (
        "請評估以下校園助理的回答品質（1-10 分）。\n\n"
        f"學生問題：{pair['instruction']}\n"
        f"助理回答：{pair['output']}\n\n"
        "評分標準：\n"
        "- 回答是否正確且相關（3分）\n"
        "- 是否使用繁體中文且語氣友善（2分）\n"
        "- 是否具體有用（3分）\n"
        "- 是否包含建議選項（2分）\n\n"
        "請只回覆一個數字（1-10），不要解釋。"
    )

    answer = _call_llm([{"role": "user", "content": prompt}], max_tokens=8)

    try:
        score = float(answer.strip().split()[0])
        return min(max(score, 1), 10)
    except (ValueError, IndexError):
        return 5.0


def filter_high_quality(pairs: list[dict], threshold: float = 7.0) -> list[dict]:
    """Score and filter QA pairs, keeping only high-quality ones."""
    scored: list[tuple[float, dict]] = []

    for pair in pairs:
        score = score_qa_pair(pair)
        scored.append((score, pair))
        time.sleep(0.3)

    scored.sort(key=lambda x: x[0], reverse=True)
    kept = [pair for score, pair in scored if score >= threshold]

    logger.info(
        "Filtered %d/%d pairs (threshold=%.1f). Score range: %.1f - %.1f",
        len(kept), len(pairs),
        threshold,
        scored[-1][0] if scored else 0,
        scored[0][0] if scored else 0,
    )
    return kept


def run_self_instruct_cycle(n_questions: int = SELF_TRAIN_BATCH_SIZE) -> Path:
    """Execute one full Self-Instruct cycle: generate -> answer -> score -> filter -> save."""
    logger.info("=== Starting Self-Instruct Cycle (n=%d) ===", n_questions)

    questions = generate_questions(n_questions)
    pairs = generate_answers(questions)

    GENERATED_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(GENERATED_PATH, "a", encoding="utf-8") as f:
        for p in pairs:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    filtered = filter_high_quality(pairs)

    with open(FILTERED_PATH, "a", encoding="utf-8") as f:
        for p in filtered:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    logger.info("Cycle complete. %d high-quality pairs added to %s", len(filtered), FILTERED_PATH)
    return FILTERED_PATH


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_self_instruct_cycle(n_questions=20)
