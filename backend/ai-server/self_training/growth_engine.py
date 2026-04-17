"""Growth Engine – orchestrates the full self-training loop.

This is the brain that makes the LLM grow on its own:

1. Collect user feedback (thumbs up/down)
2. Run Self-Instruct to generate new training data from campus knowledge
3. Build DPO preference pairs from user feedback
4. Merge all data sources into a new training set
5. Trigger LoRA fine-tuning
6. Evaluate the new model
7. Hot-swap the model weights if quality improved
8. Repeat
"""

from __future__ import annotations

import json
import logging
import shutil
import time
from datetime import datetime
from pathlib import Path

from config import (
    TRAINING_DIR,
    SELF_TRAIN_DIR,
    LORA_OUTPUT_DIR,
    SELF_TRAIN_MIN_FEEDBACK,
    SELF_TRAIN_BATCH_SIZE,
)

logger = logging.getLogger(__name__)

GROWTH_LOG = SELF_TRAIN_DIR / "growth_log.json"


def _load_growth_log() -> list[dict]:
    if GROWTH_LOG.exists():
        return json.loads(GROWTH_LOG.read_text(encoding="utf-8"))
    return []


def _save_growth_log(log: list[dict]) -> None:
    GROWTH_LOG.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")


def _count_feedback() -> int:
    from self_training.dpo_trainer import load_feedback
    return len(load_feedback())


def _merge_training_data() -> Path:
    """Merge original + self-instruct + preference data into one JSONL."""
    merged_path = TRAINING_DIR / "merged_instruct.jsonl"
    all_data: list[dict] = []

    original = TRAINING_DIR / "campus_instruct.jsonl"
    if original.exists():
        with open(original, encoding="utf-8") as f:
            all_data.extend(json.loads(line) for line in f if line.strip())

    self_instruct = SELF_TRAIN_DIR / "self_instruct_filtered.jsonl"
    if self_instruct.exists():
        with open(self_instruct, encoding="utf-8") as f:
            all_data.extend(json.loads(line) for line in f if line.strip())

    from self_training.dpo_trainer import build_preference_pairs, convert_preferences_to_instruct
    pref_pairs = build_preference_pairs()
    all_data.extend(convert_preferences_to_instruct(pref_pairs))

    seen = set()
    deduped: list[dict] = []
    for item in all_data:
        key = item.get("instruction", "")[:100]
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    with open(merged_path, "w", encoding="utf-8") as f:
        for item in deduped:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    logger.info("Merged training data: %d unique samples -> %s", len(deduped), merged_path)
    return merged_path


def run_growth_cycle(force: bool = False) -> dict:
    """Execute one full growth cycle.

    Returns a summary dict with stats about what happened.
    """
    cycle_start = time.time()
    summary: dict = {
        "timestamp": datetime.now().isoformat(),
        "actions": [],
    }

    feedback_count = _count_feedback()
    summary["feedback_count"] = feedback_count

    if not force and feedback_count < SELF_TRAIN_MIN_FEEDBACK:
        summary["skipped"] = True
        summary["reason"] = f"Only {feedback_count} feedback items (need {SELF_TRAIN_MIN_FEEDBACK})"
        logger.info("Growth cycle skipped: %s", summary["reason"])
        return summary

    logger.info("=== Growth Cycle Started (feedback=%d) ===", feedback_count)

    try:
        from self_training.self_instruct import run_self_instruct_cycle
        si_path = run_self_instruct_cycle(n_questions=min(SELF_TRAIN_BATCH_SIZE, 50))
        summary["actions"].append({"self_instruct": str(si_path)})
    except Exception as e:
        logger.error("Self-instruct failed: %s", e)
        summary["actions"].append({"self_instruct_error": str(e)})

    try:
        merged_path = _merge_training_data()
        with open(merged_path) as f:
            sample_count = sum(1 for _ in f)
        summary["total_training_samples"] = sample_count
        summary["actions"].append({"merge": str(merged_path), "samples": sample_count})
    except Exception as e:
        logger.error("Data merge failed: %s", e)
        summary["actions"].append({"merge_error": str(e)})
        return summary

    try:
        from training.eval import evaluate_model
        pre_eval = evaluate_model()
        summary["pre_train_score"] = pre_eval["avg_score"]
        summary["actions"].append({"pre_eval": pre_eval["avg_score"]})
    except Exception as e:
        logger.warning("Pre-eval failed: %s", e)
        summary["pre_train_score"] = None

    new_adapter_dir = LORA_OUTPUT_DIR / f"campus_lora_{datetime.now().strftime('%Y%m%d_%H%M')}"
    try:
        from training.finetune import run_finetune
        run_finetune(
            data_path=merged_path,
            output_dir=new_adapter_dir,
            epochs=2,
            lora_rank=16,
        )
        summary["actions"].append({"finetune": str(new_adapter_dir)})
    except Exception as e:
        logger.error("Fine-tuning failed: %s", e)
        summary["actions"].append({"finetune_error": str(e)})
        return summary

    try:
        post_eval = evaluate_model()
        summary["post_train_score"] = post_eval["avg_score"]
        summary["actions"].append({"post_eval": post_eval["avg_score"]})

        improved = (
            summary.get("pre_train_score") is None
            or post_eval["avg_score"] > summary["pre_train_score"]
        )

        if improved:
            best_link = LORA_OUTPUT_DIR / "campus_lora_best"
            if best_link.exists():
                shutil.rmtree(best_link)
            shutil.copytree(new_adapter_dir, best_link)
            summary["model_updated"] = True
            logger.info("Model improved! New best adapter: %s", best_link)
        else:
            summary["model_updated"] = False
            logger.info("Model did not improve. Keeping previous adapter.")

    except Exception as e:
        logger.error("Post-eval failed: %s", e)

    summary["elapsed_s"] = round(time.time() - cycle_start, 1)

    log = _load_growth_log()
    log.append(summary)
    _save_growth_log(log)

    logger.info("=== Growth Cycle Complete (%.1fs) ===", summary["elapsed_s"])
    return summary


def get_growth_stats() -> dict:
    """Return a summary of the model's growth history."""
    log = _load_growth_log()
    if not log:
        return {"total_cycles": 0, "message": "模型尚未開始自我訓練"}

    scores = [e["post_train_score"] for e in log if e.get("post_train_score") is not None]

    return {
        "total_cycles": len(log),
        "successful_updates": sum(1 for e in log if e.get("model_updated")),
        "latest_score": scores[-1] if scores else None,
        "score_history": scores,
        "total_feedback": log[-1].get("feedback_count", 0),
        "total_training_samples": log[-1].get("total_training_samples", 0),
        "last_cycle": log[-1].get("timestamp"),
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    result = run_growth_cycle(force=True)
    print(json.dumps(result, ensure_ascii=False, indent=2))
