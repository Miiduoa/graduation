#!/usr/bin/env python3
"""
Queue a Flux.1 Dev txt2img workflow on a running ComfyUI (default http://127.0.0.1:8188),
poll /history, download the first PNG to --out.

See also scripts/generate-flux-ui-asset-pack.py for multi-size dashboard / empty-state Flux art cached under apps/mobile/assets/generated-ui/.

Requires local models (same layout as Comfy-Org Flux.1 Dev blueprint):
  models/diffusion_models/flux1-dev.safetensors
  models/text_encoders/clip_l.safetensors, t5xxl_fp16.safetensors
  models/vae/ae.safetensors
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def build_prompt(
    positive: str,
    *,
    seed: int,
    steps: int,
    width: int,
    height: int,
    filename_prefix: str,
) -> dict:
    """API-format ComfyUI graph (Flux.1 Dev, matches bundled blueprint wiring)."""
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


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8188)
    p.add_argument("--out", required=True, help="Destination PNG path")
    p.add_argument("--steps", type=int, default=24)
    p.add_argument("--width", type=int, default=1024)
    p.add_argument("--height", type=int, default=1024)
    p.add_argument("--seed", type=int, default=-1, help="Use -1 for random")
    p.add_argument("--prefix", default="campus_app_icon")
    p.add_argument(
        "--positive",
        default="",
        help="Override full positive prompt (otherwise use built-in campus branding prompt)",
    )
    args = p.parse_args()
    base = f"http://{args.host}:{args.port}"

    seed = args.seed if args.seed >= 0 else random.randint(0, 2**48)

    positive = args.positive or (
        "Mobile app icon, flat minimal vector illustration style, iOS aesthetic, "
        "large centered symbol with safe margins inside rounded square (content inside ~80% center "
        "so iOS corner mask does not clip edges), no readable letters. "
        "Theme: intelligent campus assistant for Chinese university students. "
        "Motif: abstract open book merged with small sparkle or neural node, subtle graduation-cap "
        "silhouette hint. "
        "Color palette: deep violet accent #5B21B6, warm gold #D4A843, dark indigo-navy "
        "background #1a1a2e matching app splash screen, high contrast, clean shapes, soft gradient "
        "highlight only on the emblem. "
        "Professional, trustworthy, modern; masterpiece, sharp edges, crisp graphic design."
    )

    workflow = build_prompt(
        positive,
        seed=seed,
        steps=args.steps,
        width=args.width,
        height=args.height,
        filename_prefix=args.prefix,
    )

    try:
        q = post_json(f"{base}/prompt", {"prompt": workflow})
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")
        print("ComfyUI /prompt HTTP error:", e.code, err[:4000], file=sys.stderr)
        return 1

    prompt_id = q.get("prompt_id")
    if not prompt_id:
        print("Unexpected queue response:", q, file=sys.stderr)
        return 1

    print("Queued prompt_id:", prompt_id, "seed:", seed)

    # Poll history until our prompt shows completed outputs
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
            return 1
        time.sleep(1.0)

    if not image_info:
        print("Timeout waiting for /history output", file=sys.stderr)
        return 1

    filename = image_info["filename"]
    subfolder = image_info.get("subfolder", "")
    folder_type = image_info.get("type", "output")
    qs = urllib.parse.urlencode(
        {"filename": filename, "subfolder": subfolder, "type": folder_type}
    )
    png = fetch_bytes(f"{base}/view?{qs}")
    out_path = args.out
    with open(out_path, "wb") as f:
        f.write(png)
    print("Saved:", out_path, len(png), "bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
