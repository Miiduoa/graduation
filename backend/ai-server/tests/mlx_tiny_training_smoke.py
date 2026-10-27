"""Exercise Campus One's real MLX training and fuse commands on a tiny model.

All model/tokenizer weights and training rows are generated in a temporary
folder. Hugging Face operates offline. This is an integration regression test,
not a model-quality benchmark or acceptance of existing user checkpoints.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import platform
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def file_hashes(directory: Path) -> dict[str, str]:
    paths = list(directory.rglob("*"))
    assert not any(path.is_symlink() for path in paths), "unexpected model symlink"
    return {
        path.relative_to(directory).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in paths
        if path.is_file()
    }


def main() -> None:
    assert platform.system() == "Darwin", platform.platform()
    assert platform.machine() == "arm64", platform.machine()

    with tempfile.TemporaryDirectory(prefix="campus-mlx-tiny-") as tmp:
        root = Path(tmp)
        # Set these before importing Hugging Face, and inherit them in real CLI children.
        os.environ.update({
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_DATASETS_OFFLINE": "1",
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "HF_HOME": str(root / "hf-cache"),
            "TOKENIZERS_PARALLELISM": "false",
        })

        import mlx.core as mx
        import numpy as np
        from mlx.utils import tree_flatten
        from mlx_lm import load
        from mlx_lm.models.llama import Model, ModelArgs
        from tokenizers import Tokenizer
        from tokenizers.models import WordLevel
        from tokenizers.pre_tokenizers import Whitespace
        from transformers import PreTrainedTokenizerFast
        from training import finetune

        versions = {
            name: importlib.metadata.version(name)
            for name in ("mlx", "mlx-lm", "numpy", "transformers", "tokenizers")
        }
        print(json.dumps({"versions": versions, "device": str(mx.default_device())}))
        assert versions["mlx-lm"] == "0.32.2", versions
        assert versions["numpy"] == "2.5.4", versions
        mx.random.seed(17)
        np.random.seed(17)

        base_dir = root / "base"
        base_dir.mkdir()
        words = [
            "<pad>", "<unk>", "<bos>", "<eos>", "user", "assistant",
            "where", "is", "campus", "room", "near", "library",
            *[str(i) for i in range(20)],
        ]
        tokenizer_backend = Tokenizer(WordLevel(
            vocab={word: index for index, word in enumerate(words)},
            unk_token="<unk>",
        ))
        tokenizer_backend.pre_tokenizer = Whitespace()
        tokenizer = PreTrainedTokenizerFast(
            tokenizer_object=tokenizer_backend,
            unk_token="<unk>", pad_token="<pad>",
            bos_token="<bos>", eos_token="<eos>",
            model_max_length=64,
            chat_template=(
                "{% for message in messages %}"
                "{{ message['role'] + ' ' + message['content'] + ' ' }}"
                "{% endfor %}{{ eos_token }}"
            ),
        )
        tokenizer.save_pretrained(str(base_dir))
        # Eight very small layers exercise the wrapper's unchanged --num-layers 8.
        args = ModelArgs(
            model_type="llama", hidden_size=16, num_hidden_layers=8,
            intermediate_size=32, num_attention_heads=2, num_key_value_heads=2,
            rms_norm_eps=1e-5, vocab_size=len(words), max_position_embeddings=64,
            tie_word_embeddings=True,
        )
        model = Model(args)
        weights = dict(tree_flatten(model.parameters()))
        mx.eval(list(weights.values()))
        parameter_count = sum(weight.size for weight in weights.values())
        assert 0 < parameter_count < 100_000, parameter_count
        mx.save_safetensors(str(base_dir / "model.safetensors"), weights)
        (base_dir / "config.json").write_text(json.dumps(asdict(args)), encoding="utf-8")
        original_hashes = file_hashes(base_dir)

        probe = mx.array([[4, 6, 7, 8, 9, 12]], dtype=mx.int32)
        baseline, _ = load(str(base_dir))
        baseline.eval()
        baseline_logits = np.array(baseline(probe))
        assert baseline_logits.shape == (1, 6, len(words))
        assert np.isfinite(baseline_logits).all()

        training_dir = root / "training"
        training_dir.mkdir()
        data_path = training_dir / "fixture.jsonl"
        rows = [
            {"instruction": f"where is campus room {i}",
             "output": f"campus room {i} is near library"}
            for i in range(20)
        ]
        data_path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
        # Redirect only data/output paths. Neither subprocess nor MLX is mocked.
        finetune.TRAINING_DIR = training_dir
        finetune.LORA_OUTPUT_DIR = root / "outputs"
        finetune._THIS_DIR = training_dir
        adapter_dir = root / "outputs" / "adapter"
        result = finetune.run_finetune(
            model=str(base_dir), data_path=data_path, output_dir=adapter_dir,
            iters=2, batch_size=1, lora_rank=2, learning_rate=1e-3,
            max_seq_length=32, save_every=1, steps_per_eval=1,
        )
        assert result == adapter_dir
        for split, count in (("train", 17), ("valid", 2), ("test", 1)):
            lines = (training_dir / "mlx_format" / f"{split}.jsonl").read_text().splitlines()
            assert len(lines) == count, (split, len(lines))
        assert (adapter_dir / "0000002_adapters.safetensors").is_file()
        adapter_config = json.loads((adapter_dir / "adapter_config.json").read_text())
        assert adapter_config["iters"] == 2, adapter_config
        assert adapter_config["lora_parameters"]["rank"] == 2, adapter_config
        adapters = mx.load(str(adapter_dir / "adapters.safetensors"))
        assert adapters, "no adapter tensors saved"
        assert all(np.isfinite(np.array(value)).all() for value in adapters.values())
        b_weights = [np.array(value) for key, value in adapters.items() if key.endswith("lora_b")]
        assert b_weights and any(np.any(value != 0) for value in b_weights), "no optimizer update"

        adapted, _ = load(str(base_dir), adapter_path=str(adapter_dir))
        adapted.eval()
        adapted_logits = np.array(adapted(probe))
        assert np.isfinite(adapted_logits).all()
        delta = float(np.max(np.abs(adapted_logits - baseline_logits)))
        assert delta > 1e-6, "training did not change model outputs"

        # The project wrapper launches the actual fuse CLI and writes a fresh model.
        finetune.create_merged_model(base_model=str(base_dir), adapter_path=adapter_dir)
        fused_dir = finetune.LORA_OUTPUT_DIR / "campus_fused"
        assert (fused_dir / "config.json").is_file()
        assert list(fused_dir.glob("model*.safetensors")), "fused model was not saved"
        fused, fused_tokenizer = load(str(fused_dir))
        fused.eval()
        fused_logits = np.array(fused(probe))
        assert np.isfinite(fused_logits).all()
        np.testing.assert_allclose(fused_logits, adapted_logits, rtol=1e-4, atol=1e-5)
        assert not any("lora_a" in key or "lora_b" in key for key, _ in tree_flatten(fused.parameters()))
        assert fused_tokenizer.encode("campus room 1") == tokenizer.encode("campus room 1")
        assert file_hashes(base_dir) == original_hashes, "base checkpoint changed"
        print(json.dumps({
            "result": "passed", "parameters": parameter_count, "training_steps": 2,
            "adapter_tensors": len(adapters), "training_output_delta": delta,
            "fuse_max_error": float(np.max(np.abs(fused_logits - adapted_logits))),
            "base_checkpoint_unchanged": True, "pretrained_downloads": False,
        }))


if __name__ == "__main__":
    main()
