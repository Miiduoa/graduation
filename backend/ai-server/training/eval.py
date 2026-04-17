"""Evaluation script – measures response quality and logs results."""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import httpx

from config import OLLAMA_BASE_URL, MODEL_NAME, TRAINING_DIR

logger = logging.getLogger(__name__)


EVAL_CASES = [
    {"question": "今天午餐吃什麼好？", "expect_keywords": ["餐廳", "菜單", "推薦", "建議"]},
    {"question": "我想退選課程怎麼辦？", "expect_keywords": ["課程", "退選", "學分"]},
    {"question": "圖書館在哪裡？", "expect_keywords": ["圖書館", "地圖", "位置", "導航"]},
    {"question": "我的 GPA 怎麼提升？", "expect_keywords": ["成績", "GPA", "建議"]},
    {"question": "學校最近有什麼活動？", "expect_keywords": ["活動", "報名", "近期"]},
    {"question": "APP 有什麼功能？", "expect_keywords": ["功能", "公告", "課程", "地圖", "餐廳"]},
    {"question": "我壓力很大怎麼辦？", "expect_keywords": ["壓力", "休息", "諮商", "建議"]},
    {"question": "怎麼繳交作業？", "expect_keywords": ["作業", "繳交", "課程", "上傳"]},
    {"question": "幫我規劃讀書計畫", "expect_keywords": ["計畫", "時間", "學習"]},
    {"question": "下學期選什麼課好？", "expect_keywords": ["選課", "課程", "學分", "建議"]},
]


def evaluate_model(
    model: str = MODEL_NAME,
    base_url: str = OLLAMA_BASE_URL,
) -> dict:
    """Run evaluation cases against the running Ollama model."""
    results: list[dict] = []
    total_score = 0

    for case in EVAL_CASES:
        start = time.time()
        try:
            resp = httpx.post(
                f"{base_url}/api/chat",
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是校園智慧助理，用繁體中文回答。"},
                        {"role": "user", "content": case["question"]},
                    ],
                    "stream": False,
                    "options": {"num_predict": 256},
                },
                timeout=120,
            )
            data = resp.json()
            answer = data.get("message", {}).get("content", "")
        except Exception as e:
            answer = f"[ERROR] {e}"

        elapsed = time.time() - start

        keyword_hits = sum(1 for kw in case["expect_keywords"] if kw in answer)
        keyword_score = keyword_hits / len(case["expect_keywords"])

        is_chinese = sum(1 for c in answer if "\u4e00" <= c <= "\u9fff") / max(len(answer), 1)
        length_ok = 20 < len(answer) < 2000

        score = keyword_score * 0.5 + (0.3 if is_chinese > 0.3 else 0) + (0.2 if length_ok else 0)
        total_score += score

        results.append({
            "question": case["question"],
            "answer_preview": answer[:200],
            "keyword_score": round(keyword_score, 2),
            "chinese_ratio": round(is_chinese, 2),
            "length_ok": length_ok,
            "score": round(score, 2),
            "elapsed_s": round(elapsed, 1),
        })

    avg_score = total_score / len(EVAL_CASES) if EVAL_CASES else 0

    report = {
        "model": model,
        "total_cases": len(EVAL_CASES),
        "avg_score": round(avg_score, 3),
        "results": results,
    }

    out_path = TRAINING_DIR / "eval_report.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Evaluation complete. Avg score: %.1f%%. Report: %s", avg_score * 100, out_path)
    return report


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    r = evaluate_model()
    print(f"\n=== Evaluation Result ===")
    print(f"Average Score: {r['avg_score']:.1%}")
    for item in r["results"]:
        print(f"  Q: {item['question']}")
        print(f"    Score: {item['score']:.0%} | Time: {item['elapsed_s']}s")
        print(f"    Answer: {item['answer_preview'][:80]}...")
        print()
