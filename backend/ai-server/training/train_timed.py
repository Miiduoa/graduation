"""依 wall-clock 時長執行 LoRA（適合 macOS 無 `timeout` 指令的環境）。

流程：

1. （預設）執行 ``training.prepare_data``：JSONL 已去重並稀疏相似 Alpaca 問句。
2. 呼叫 ``training.finetune``，以極大的 ``--iters`` 為上限。
3. 經過 ``--hours`` 後對子行程送 ``SIGINT``；mlx_lm 仍會依 ``--save-every`` 定期寫入 adapter。

額外參數請放在 ``--`` 之後（會原樣轉給 ``training.finetune``），請勿再重複指定 ``--iters``
（由本程式強制帶入上限）。

範例::

    python -m training.train_timed --hours 24 -- \\
        --rank 32 --lr 1e-5 --fuse

    ./run.sh --train-hours 24 -- --rank 32
"""

from __future__ import annotations

import argparse
import logging
import signal
import subprocess
import sys
import threading
from pathlib import Path

from config import BASE_DIR

logger = logging.getLogger(__name__)


def _split_at_ddash(argv: list[str]) -> tuple[list[str], list[str]]:
    if "--" in argv:
        i = argv.index("--")
        return argv[:i], argv[i + 1 :]
    return argv, []


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    own_argv, passthrough = _split_at_ddash(argv)

    parser = argparse.ArgumentParser(description="Timed MLX LoRA training")
    parser.add_argument("--hours", type=float, default=24.0, help="訓練時長（小時），時間到送 SIGINT")
    parser.add_argument(
        "--no-prepare",
        action="store_true",
        help="跳過 prepare_data（請自行確認 campus_instruct.jsonl）",
    )
    parser.add_argument("--iters-cap", type=int, default=999_999_999, help="傳給 finetune 的 --iters 上限")
    parser.add_argument(
        "--save-every",
        type=int,
        default=50,
        help="每 N step 存檔（中斷時最多損失約此區間的進度）",
    )
    parser.add_argument(
        "--steps-per-eval",
        type=int,
        default=800,
        help="降低驗證頻率可省下時間（傳給 finetune → mlx_lm）",
    )

    args = parser.parse_args(own_argv)

    root = Path(BASE_DIR)
    if not args.no_prepare:
        logger.info("刷新訓練資料（dedupe + thin_similar Alpaca）…")
        subprocess.run([sys.executable, "-m", "training.prepare_data"], check=True, cwd=root)

    cmd = [
        sys.executable,
        "-m",
        "training.finetune",
        "--iters",
        str(args.iters_cap),
        "--save-every",
        str(args.save_every),
        "--steps-per-eval",
        str(args.steps_per_eval),
        *passthrough,
    ]

    logger.info("即將執行約 %.3f 小時後自動 SIGINT：", args.hours)
    logger.info("  %s", " ".join(cmd))
    logger.info("即時除錯（不需 AI）：另開終端在 ai-server 目錄執行 ./training/watch_training.sh")

    proc = subprocess.Popen(cmd, cwd=root)

    def stop_training() -> None:
        logger.info("已達 %.3f 小時：送出 SIGINT（請稍候寫入 checkpoint）。", args.hours)
        if proc.poll() is None:
            try:
                proc.send_signal(signal.SIGINT)
            except ProcessLookupError:
                pass

    timer = threading.Timer(args.hours * 3600.0, stop_training)
    timer.start()
    try:
        return proc.wait()
    finally:
        timer.cancel()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    raise SystemExit(main())
