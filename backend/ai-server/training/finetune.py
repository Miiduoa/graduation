"""LoRA fine-tuning script using MLX-LM on Apple Silicon.

Usage:
    python training/finetune.py                        # defaults
    python training/finetune.py --epochs 5 --rank 32   # custom
"""

from __future__ import annotations

import argparse
import json
import logging
import subprocess
import sys
from pathlib import Path

from config import TRAINING_DIR, LORA_OUTPUT_DIR, MODEL_NAME

logger = logging.getLogger(__name__)

DEFAULT_HF_MODEL = "Qwen/Qwen3-32B"


def _convert_jsonl_to_mlx_format(input_path: Path, output_dir: Path) -> tuple[Path, Path, Path]:
    """Convert Alpaca-format JSONL into MLX-LM chat format (train/valid/test splits)."""
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(input_path, encoding="utf-8") as f:
        data = [json.loads(line) for line in f if line.strip()]

    mlx_data: list[dict] = []
    for item in data:
        user_msg = item["instruction"]
        if item.get("input"):
            user_msg += f"\n\n{item['input']}"

        mlx_data.append({
            "messages": [
                {"role": "user", "content": user_msg},
                {"role": "assistant", "content": item["output"]},
            ]
        })

    total = len(mlx_data)
    split_train = int(total * 0.85)
    split_valid = int(total * 0.95)

    splits = {
        "train": mlx_data[:split_train],
        "valid": mlx_data[split_train:split_valid],
        "test": mlx_data[split_valid:],
    }

    paths: dict[str, Path] = {}
    for name, records in splits.items():
        p = output_dir / f"{name}.jsonl"
        with open(p, "w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        paths[name] = p
        logger.info("  %s: %d samples -> %s", name, len(records), p)

    return paths["train"], paths["valid"], paths["test"]


def run_finetune(
    *,
    model: str = DEFAULT_HF_MODEL,
    data_path: str | Path | None = None,
    output_dir: str | Path | None = None,
    epochs: int = 3,
    batch_size: int = 1,
    lora_rank: int = 16,
    learning_rate: float = 2e-5,
    max_seq_length: int = 2048,
) -> Path:
    """Launch MLX-LM LoRA fine-tuning."""
    data_path = Path(data_path) if data_path else TRAINING_DIR / "campus_instruct.jsonl"
    output_path = Path(output_dir) if output_dir else LORA_OUTPUT_DIR / "campus_lora"
    output_path.mkdir(parents=True, exist_ok=True)

    mlx_data_dir = TRAINING_DIR / "mlx_format"
    logger.info("Converting training data to MLX format...")
    _convert_jsonl_to_mlx_format(data_path, mlx_data_dir)

    cmd = [
        sys.executable, "-m", "mlx_lm.lora",
        "--model", model,
        "--data", str(mlx_data_dir),
        "--adapter-path", str(output_path),
        "--train",
        "--iters", str(epochs * 1000),
        "--batch-size", str(batch_size),
        "--lora-rank", str(lora_rank),
        "--learning-rate", str(learning_rate),
        "--max-seq-length", str(max_seq_length),
        "--num-layers", "8",
    ]

    logger.info("Starting MLX-LM LoRA training:\n  %s", " ".join(cmd))
    logger.info("Model: %s | Epochs: %d | Rank: %d | LR: %s", model, epochs, lora_rank, learning_rate)

    result = subprocess.run(cmd, capture_output=False, text=True)

    if result.returncode != 0:
        logger.error("Training failed with exit code %d", result.returncode)
        raise RuntimeError(f"MLX-LM training failed (exit code {result.returncode})")

    logger.info("Training complete. Adapters saved to: %s", output_path)
    return output_path


def create_merged_model(
    base_model: str = DEFAULT_HF_MODEL,
    adapter_path: str | Path | None = None,
) -> None:
    """Fuse LoRA adapters into base model and export for Ollama."""
    adapter_path = Path(adapter_path) if adapter_path else LORA_OUTPUT_DIR / "campus_lora"
    fused_dir = LORA_OUTPUT_DIR / "campus_fused"

    cmd = [
        sys.executable, "-m", "mlx_lm.fuse",
        "--model", base_model,
        "--adapter-path", str(adapter_path),
        "--save-path", str(fused_dir),
    ]

    logger.info("Fusing LoRA adapters: %s", " ".join(cmd))
    subprocess.run(cmd, check=True)
    logger.info("Fused model saved to: %s", fused_dir)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Fine-tune campus LLM with LoRA")
    parser.add_argument("--model", default=DEFAULT_HF_MODEL)
    parser.add_argument("--data", default=None)
    parser.add_argument("--output", default=None)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--rank", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--fuse", action="store_true", help="Fuse adapters after training")
    args = parser.parse_args()

    adapter_path = run_finetune(
        model=args.model,
        data_path=args.data,
        output_dir=args.output,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lora_rank=args.rank,
        learning_rate=args.lr,
    )

    if args.fuse:
        create_merged_model(args.model, adapter_path)
