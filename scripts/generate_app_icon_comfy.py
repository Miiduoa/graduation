#!/usr/bin/env python3
"""
Queue a Flux.1 Dev (UNET) text-to-image workflow on local ComfyUI and copy the PNG
into the Expo mobile app asset paths.

Requires ComfyUI listening on COMFYUI_URL (default http://127.0.0.1:8188) with
flux1-dev.safetensors, clip_l.safetensors, t5xxl_fp16.safetensors, ae.safetensors.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

COMFYUI_URL = os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
WORKSPACE = Path(os.environ.get("GRAD_PROJECT_ROOT", "/Users/miiduoa/Desktop/畢業專題")).resolve()
COMFY_OUT = Path(
    os.environ.get("COMFYUI_OUTPUT", "/Users/miiduoa/Desktop/AI圖像本地引擎/output")
).resolve()

# Theme: 校園助手 — 靜宜紫金 (#5B21B6 / #D4A843) on dark #1a1a2e, AI-first campus app
POS_CLIP_L = (
    "mobile app icon, square format, centered composition, abstract modern symbol, "
    "minimal flat vector, soft gradient, violet and gold accents on deep navy background, "
    "subtle sparkle or neural node motif suggesting AI campus assistant, no letters"
)
POS_T5 = (
    "Professional iOS app icon artwork, 1024x1024 master, crisp edges, high legibility "
    "at small sizes, calm academic mood, Providence University inspired purple and gold "
    "palette (deep violet #5B21B6, warm gold #D4A843) on near-black blue #1a1a2e, "
    "simple geometric mark (campus map pin merged with soft starburst or brain-node "
    "lines), matte finish, subtle inner highlight, symmetric, generous safe margin from "
    "edges, premium student productivity app branding, NO text, NO words, NO watermarks"
)
NEG_CLIP_L = ""
NEG_T5 = (
    "typography, letters, watermark, signature, blurry, cluttered, noisy, jpeg artifacts, "
    "photorealistic, 3d render mascot, cheesy glossy icon, clipart, copyrighted logos, "
    "Apple logo, Android robot, QR code, barcode, intricate tiny details"
)


def flux1_dev_icon_workflow(
    *,
    seed: int,
    steps: int,
    width: int,
    height: int,
    filename_prefix: str,
) -> dict:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": "flux1-dev.safetensors", "weight_dtype": "default"},
        },
        "2": {
            "class_type": "DualCLIPLoader",
            "inputs": {
                "clip_name1": "clip_l.safetensors",
                "clip_name2": "t5xxl_fp16.safetensors",
                "type": "flux",
            },
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "4": {
            "class_type": "ModelSamplingFlux",
            "inputs": {
                "model": ["1", 0],
                "width": width,
                "height": height,
                "max_shift": 1.15,
                "base_shift": 0.5,
            },
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "6": {
            "class_type": "CLIPTextEncodeFlux",
            "inputs": {
                "clip": ["2", 0],
                "clip_l": POS_CLIP_L,
                "t5xxl": POS_T5,
                "guidance": 3.5,
            },
        },
        "7": {
            "class_type": "CLIPTextEncodeFlux",
            "inputs": {
                "clip": ["2", 0],
                "clip_l": NEG_CLIP_L,
                "t5xxl": NEG_T5,
                "guidance": 3.5,
            },
        },
        "8": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["6", 0], "guidance": 3.5}},
        "9": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["7", 0], "guidance": 3.5}},
        "10": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["4", 0],
                "seed": seed,
                "steps": steps,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "positive": ["8", 0],
                "negative": ["9", 0],
                "latent_image": ["5", 0],
                "denoise": 1.0,
            },
        },
        "11": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["10", 0], "vae": ["3", 0]},
        },
        "12": {
            "class_type": "SaveImage",
            "inputs": {"images": ["11", 0], "filename_prefix": filename_prefix},
        },
    }


def http_json(method: str, path: str, body: dict | None = None) -> dict:
    url = f"{COMFYUI_URL}{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(resp.read().decode("utf-8"))


def wait_for_prompt(prompt_id: str, timeout_s: float = 900.0) -> dict:
    start = time.time()
    while time.time() - start < timeout_s:
        try:
            h = http_json("GET", f"/history/{prompt_id}")
        except urllib.error.HTTPError:
            time.sleep(0.5)
            continue
        if prompt_id in h and h[prompt_id].get("status", {}).get("completed"):
            return h[prompt_id]
        time.sleep(0.5)
    raise TimeoutError(f"prompt {prompt_id} not completed in {timeout_s}s")


def find_saved_png(history_entry: dict) -> tuple[str, str]:
    """Return (filename, subfolder) for first SaveImage PNG in outputs."""
    out = history_entry.get("outputs", {})
    for node_out in out.values():
        imgs = node_out.get("images") or []
        for im in imgs:
            fn = im.get("filename")
            if fn and fn.lower().endswith(".png"):
                return fn, im.get("subfolder", "") or ""
    raise RuntimeError(f"No PNG in outputs: {json.dumps(out, indent=2)[:1200]}")


def main() -> int:
    seed = int(os.environ.get("ICON_SEED", str(int(time.time()) % (2**31))))
    steps = int(os.environ.get("ICON_STEPS", "24"))
    w = int(os.environ.get("ICON_WIDTH", "1024"))
    h = int(os.environ.get("ICON_HEIGHT", "1024"))
    prefix = os.environ.get("ICON_PREFIX", "campus_icon_flux")

    wf = flux1_dev_icon_workflow(
        seed=seed, steps=steps, width=w, height=h, filename_prefix=prefix
    )

    body = {"prompt": wf, "client_id": str(uuid.uuid4())}
    print(f"POST {COMFYUI_URL}/prompt seed={seed} steps={steps} size={w}x{h}", flush=True)
    try:
        r = http_json("POST", "/prompt", body)
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        print("ComfyUI error:", err[:2000], file=sys.stderr)
        return 2

    prompt_id = r.get("prompt_id")
    if not prompt_id:
        print("Unexpected response:", r, file=sys.stderr)
        return 2

    print("Queued prompt_id=", prompt_id, flush=True)
    done = wait_for_prompt(prompt_id)
    fn, sub = find_saved_png(done)
    src = COMFY_OUT / sub / fn if sub else COMFY_OUT / fn
    if not src.is_file():
        raise FileNotFoundError(f"Expected image at {src}")

    expo_icon = WORKSPACE / "apps/mobile/assets/icon.png"
    expo_adaptive = WORKSPACE / "apps/mobile/assets/adaptive-icon.png"
    expo_favicon = WORKSPACE / "apps/mobile/assets/favicon.png"
    ios_master = WORKSPACE / "apps/mobile/ios/mobile/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png"

    for dst in (expo_icon, expo_adaptive, expo_favicon, ios_master):
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        print(f"Copied -> {dst}", flush=True)

    print("\nPositive theme (CLIP-L / T5): see POS_CLIP_L and POS_T5 in script.", flush=True)
    print("Negative (T5):", NEG_T5[:120] + "…", flush=True)
    print(
        "\nNote: Flux.1 Dev weights are NC-only; fine for typical student/non‑commercial demos.",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
