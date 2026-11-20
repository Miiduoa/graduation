"""DPO (Direct Preference Optimization) trainer.

Uses thumbs-up/down feedback from users to build preference pairs,
then runs DPO-style training so the model learns which responses
users actually prefer.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

from config import FEEDBACK_DIR, SELF_TRAIN_DIR

logger = logging.getLogger(__name__)

PREFERENCE_PATH = SELF_TRAIN_DIR / "preference_pairs.jsonl"


def save_feedback(
    *,
    message_id: str,
    user_message: str,
    assistant_response: str,
    rating: str,
    user_id: str | None = None,
) -> Path:
    """Persist a single user-feedback record to disk."""
    record = {
        "message_id": message_id,
        "user_message": user_message,
        "assistant_response": assistant_response,
        "rating": rating,
        "user_id": user_id,
        "timestamp": datetime.now().isoformat(),
    }

    feedback_file = FEEDBACK_DIR / "feedback_log.jsonl"
    feedback_file.parent.mkdir(parents=True, exist_ok=True)
    with open(feedback_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

    return feedback_file


def load_feedback() -> list[dict]:
    """Load all accumulated feedback."""
    feedback_file = FEEDBACK_DIR / "feedback_log.jsonl"
    if not feedback_file.exists():
        return []
    with open(feedback_file, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _generate_alternative(user_message: str, bad_response: str) -> str:
    """Ask the model to produce a better alternative to a disliked response."""
    import llm_client

    prompt = (
        "以下是一位學生的問題和一個不夠好的回答。請提供一個更好的回答。\n\n"
        f"學生問題：{user_message}\n\n"
        f"不佳的回答：{bad_response}\n\n"
        "請直接給出更好的回答（繁體中文，友善具體）："
    )

    try:
        return llm_client.chat_sync(
            [{"role": "user", "content": prompt}],
            max_tokens=512,
            temperature=0.7,
        )
    except Exception as e:
        logger.warning("Failed to generate alternative: %s", e)
        return ""


def build_preference_pairs() -> list[dict]:
    """Build DPO preference pairs from feedback log.

    - thumbs_up responses become ``chosen``
    - thumbs_down responses become ``rejected``; the model generates a better
      alternative which becomes the new ``chosen``
    """
    feedback = load_feedback()
    if not feedback:
        return []

    by_question: dict[str, dict[str, list[str]]] = {}
    for fb in feedback:
        q = fb["user_message"]
        r = fb["assistant_response"]
        rating = fb["rating"]
        by_question.setdefault(q, {"good": [], "bad": []})
        if rating == "thumbs_up":
            by_question[q]["good"].append(r)
        else:
            by_question[q]["bad"].append(r)

    pairs: list[dict] = []

    for question, responses in by_question.items():
        for bad_resp in responses["bad"]:
            if responses["good"]:
                chosen = responses["good"][0]
            else:
                chosen = _generate_alternative(question, bad_resp)
                if not chosen:
                    continue

            pairs.append({
                "prompt": question,
                "chosen": chosen,
                "rejected": bad_resp,
            })

    PREFERENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PREFERENCE_PATH, "w", encoding="utf-8") as f:
        for p in pairs:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    logger.info("Built %d preference pairs -> %s", len(pairs), PREFERENCE_PATH)
    return pairs


def convert_preferences_to_instruct(pairs: list[dict]) -> list[dict]:
    """Convert preference pairs into Alpaca-style instruction data.

    Uses the ``chosen`` response as the target output so the model
    learns from its best behaviour.
    """
    instruct_data: list[dict] = []
    for pair in pairs:
        instruct_data.append({
            "instruction": pair["prompt"],
            "input": "",
            "output": pair["chosen"],
        })
    return instruct_data


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    pairs = build_preference_pairs()
    print(f"Built {len(pairs)} preference pairs")
