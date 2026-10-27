"""Apple Silicon smoke for local MLX-LM and Campus One LoRA CLI integration.

No Hugging Face downloads, tokens, model weights, or training jobs are used.
A tiny tensor runs in MLX. LoRA/fuse command arguments are constructed from
throwaway data and checked against the installed MLX-LM parser.
"""

from __future__ import annotations

import importlib.metadata
import json
import platform
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> None:
    assert platform.system() == "Darwin", platform.platform()
    assert platform.machine() == "arm64", platform.machine()

    import mlx.core as mx
    import numpy as np
    import yaml
    from mlx_lm.lora import build_parser
    from training import finetune

    print(
        f"macOS {platform.mac_ver()[0]}, "
        f"mlx-lm {importlib.metadata.version('mlx-lm')}, "
        f"NumPy {np.__version__}"
    )
    assert tuple(map(int, np.__version__.split(".")[:2])) >= (2, 5), np.__version__
    a = mx.array([1.0, 2.0, 3.0], dtype=mx.float32)
    mx.eval(a)
    dot = mx.sum(a * a)
    mx.eval(dot)
    assert abs(float(dot.item()) - 14.0) < 1e-4, dot

    with tempfile.TemporaryDirectory(prefix="campus-mlx-compat-") as tmp:
        root = Path(tmp)
        input_path = root / "fixture.jsonl"
        with input_path.open("w", encoding="utf-8") as fh:
            for i in range(20):
                record = {
                    "instruction": f"Where is campus room {i}?",
                    "output": f"Room {i} is near the library.",
                }
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")

        with (
            mock.patch.object(finetune, "TRAINING_DIR", root),
            mock.patch.object(finetune, "LORA_OUTPUT_DIR", root),
            mock.patch.object(finetune, "_THIS_DIR", root),
            mock.patch.object(
                finetune.subprocess,
                "run",
                return_value=SimpleNamespace(returncode=0),
            ) as launch,
        ):
            out_path = finetune.run_finetune(
                model="fake-local-model",
                data_path=input_path,
                output_dir=root / "adapter",
                iters=2,
                batch_size=1,
                lora_rank=4,
                save_every=2,
                steps_per_eval=1,
            )
            assert out_path == root / "adapter"
            argv = launch.call_args.args[0]
            assert argv[:4] == [sys.executable, "-m", "mlx_lm", "lora"], argv
            args = build_parser().parse_args(argv[4:])
            assert args.train and args.fine_tune_type == "lora", args
            assert args.iters == 2 and args.save_every == 2, args
            assert args.steps_per_eval == 1 and args.batch_size == 1, args
            assert args.max_seq_length == 2048 and args.num_layers == 8, args
            config = yaml.safe_load(
                (root / "_mlx_lora_runtime.yaml").read_text(encoding="utf-8")
            )
            assert config["lora_parameters"]["rank"] == 4, config
            for split in ("train", "valid", "test"):
                assert (root / "mlx_format" / f"{split}.jsonl").exists(), split

        with mock.patch.object(finetune.subprocess, "run") as fuse:
            finetune.create_merged_model(
                base_model="fake-local-model", adapter_path=root / "adapter"
            )
            fuse_argv = fuse.call_args.args[0]
            assert fuse_argv[:4] == [sys.executable, "-m", "mlx_lm", "fuse"]
            assert "--adapter-path" in fuse_argv and "--save-path" in fuse_argv

    print("Apple Silicon MLX tensor, LoRA CLI/config and fuse: passed")


if __name__ == "__main__":
    main()
