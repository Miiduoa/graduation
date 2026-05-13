#!/usr/bin/env python3
# Flux.1 Dev 授權請見 https://huggingface.co/black-forest-labs/FLUX.1-dev（非商業授權條款適用於多數使用情境）。
"""
Queue Flux.1 Dev txt2img icons from scripts/button-icons-manifest.json on ComfyUI.

Requires: running ComfyUI (default http://127.0.0.1:8188) with Flux.1 Dev blueprint models
(models/diffusion_models/flux1-dev.safetensors, clip_l, t5xxl_fp16, ae.safetensors).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def comfy_reachable(base: str, timeout: float = 3.0) -> bool:
    try:
        urllib.request.urlopen(base + "/", timeout=timeout)
        return True
    except OSError:
        return False


def build_workflow(
    positive: str,
    *,
    seed: int,
    steps: int,
    width: int,
    height: int,
    filename_prefix: str,
) -> dict:
    return {
        "38": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "flux1-dev.safetensors",
                "weight_dtype": "default",
            },
        },
        "40": {
            "class_type": "DualCLIPLoader",
            "inputs": {
                "clip_name1": "clip_l.safetensors",
                "clip_name2": "t5xxl_fp16.safetensors",
                "type": "flux",
                "device": "default",
            },
        },
        "39": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "ae.safetensors"},
        },
        "27": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {
                "width": width,
                "height": height,
                "batch_size": 1,
            },
        },
        "45": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["40", 0],
                "text": positive,
            },
        },
        "42": {
            "class_type": "ConditioningZeroOut",
            "inputs": {"conditioning": ["45", 0]},
        },
        "31": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["38", 0],
                "seed": seed,
                "steps": steps,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "positive": ["45", 0],
                "negative": ["42", 0],
                "latent_image": ["27", 0],
                "denoise": 1.0,
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["31", 0],
                "vae": ["39", 0],
            },
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["8", 0],
                "filename_prefix": filename_prefix,
            },
        },
    }


def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=1200) as resp:
        return json.loads(resp.read().decode())


def fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as resp:
        return json.loads(resp.read().decode())


def fetch_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=1200) as resp:
        return resp.read()


def run_one(
    base: str,
    *,
    positive: str,
    seed: int,
    steps: int,
    width: int,
    height: int,
    out_path: Path,
    prefix: str,
) -> bool:
    workflow = build_workflow(
        positive,
        seed=seed,
        steps=steps,
        width=width,
        height=height,
        filename_prefix=prefix,
    )
    try:
        q = post_json(f"{base}/prompt", {"prompt": workflow})
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")
        print("ComfyUI /prompt HTTP error:", e.code, err[:2000], file=sys.stderr)
        return False
    prompt_id = q.get("prompt_id")
    if not prompt_id:
        print("Unexpected queue response:", q, file=sys.stderr)
        return False

    deadline = time.time() + 3600
    image_info = None
    while time.time() < deadline:
        try:
            hist = fetch_json(f"{base}/history/{prompt_id}")
        except urllib.error.HTTPError:
            time.sleep(0.75)
            continue
        entry = hist.get(prompt_id) or hist.get(str(prompt_id))
        if not entry:
            time.sleep(0.75)
            continue
        outputs = entry.get("outputs") or {}
        for _nid, pack in outputs.items():
            images = pack.get("images") if isinstance(pack, dict) else None
            if not images:
                continue
            image_info = images[0]
            break
        if image_info:
            break
        status = entry.get("status", {})
        if status.get("completed") is False and status.get("status_str") == "error":
            print("Generation failed:", json.dumps(entry, indent=2)[:4000], file=sys.stderr)
            return False
        time.sleep(1.0)

    if not image_info:
        print("Timeout waiting for /history output", file=sys.stderr)
        return False

    filename = image_info["filename"]
    subfolder = image_info.get("subfolder", "")
    folder_type = image_info.get("type", "output")
    qs = urllib.parse.urlencode(
        {"filename": filename, "subfolder": subfolder, "type": folder_type}
    )
    png = fetch_bytes(f"{base}/view?{qs}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(png)
    print("Saved:", out_path, len(png), "bytes")
    return True


def main() -> int:
    p = argparse.ArgumentParser(description="Generate button icons via ComfyUI + Flux.1 Dev")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8188)
    p.add_argument(
        "--manifest",
        type=Path,
        default=ROOT / "button-icons-manifest.json",
        help="JSON with icons[] {id, prompt} and style_suffix",
    )
    p.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT.parent / "apps/mobile/assets/generated-icons",
        help="Directory for ic_<id>.png exports",
    )
    p.add_argument("--steps", type=int, default=24)
    p.add_argument("--width", type=int, default=1024)
    p.add_argument("--height", type=int, default=1024)
    p.add_argument("--seed-base", type=int, default=20260513, help="Per-icon seed = base + index")
    p.add_argument(
        "--only",
        nargs="*",
        help="Optional list of icon ids (e.g. ic_tab_today) to generate; default all",
    )
    args = p.parse_args()
    base = f"http://{args.host}:{args.port}"

    if not comfy_reachable(base):
        print(
            f"ComfyUI 似乎未在 {base} 運行。請先啟動本地 ComfyUI，並確認埠號為 {args.port}。\n"
            "參考工作目錄：`/Users/miiduoa/Desktop/AI圖像本地引擎`（依你的安裝為準）。",
            file=sys.stderr,
        )
        return 2

    data = json.loads(args.manifest.read_text(encoding="utf-8"))
    style = data.get("style_suffix", "").strip()
    icons = data.get("icons", [])
    if not isinstance(icons, list) or not icons:
        print("manifest.icons must be a non-empty list", file=sys.stderr)
        return 1

    only = set(args.only) if args.only else None
    ok = 0
    for i, item in enumerate(icons):
        if not isinstance(item, dict):
            continue
        icon_id = item.get("id")
        prompt_part = item.get("prompt", "")
        if not icon_id:
            continue
        if only is not None and icon_id not in only:
            continue
        positive = f"{prompt_part} {style}".strip()
        seed = args.seed_base + i
        out_path = args.out_dir / f"{icon_id}.png"
        prefix = f"btn_icon_{icon_id}"
        print(f"[{i + 1}/{len(icons)}] {icon_id} seed={seed}")
        if run_one(
            base,
            positive=positive,
            seed=seed,
            steps=args.steps,
            width=args.width,
            height=args.height,
            out_path=out_path,
            prefix=prefix,
        ):
            ok += 1
        else:
            return 1

    print("Done. Success count:", ok)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
