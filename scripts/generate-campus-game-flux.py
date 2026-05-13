#!/usr/bin/env python3
# Flux.1-dev 權重受 Black Forest Labs 授權條款拘束，商業發布請先確認許可。
"""Batch game assets (character frames + campus scene) via ComfyUI or PIL fallback.

Reads: scripts/campus-game-assets-manifest.json
Writes: apps/mobile/assets/generated-game/*.png (default)

  python3 scripts/generate-campus-game-flux.py [--out-dir PATH] [--steps N]

Reuses queue/history PNG download from scripts/generate-flux-ui-asset-pack.py."""

from __future__ import annotations

import argparse
import importlib.util
import json
import random
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent


def _load_ui_pack_module():
    name = "flux_ui_pack"
    spec = importlib.util.spec_from_file_location(
        name,
        _HERE / "generate-flux-ui-asset-pack.py",
    )
    mod = importlib.util.module_from_spec(spec)
    if spec.loader is None:
        raise RuntimeError("Failed to load generate-flux-ui-asset-pack.py")
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def pil_game_avatar(w: int, h: int, *, seed: int, variant: int) -> "Image.Image":
    from PIL import Image, ImageDraw  # noqa: PLC0415

    rng = random.Random(seed + variant * 997)
    base = Image.new("RGB", (w, h), (252, 250, 255))
    dr = ImageDraw.Draw(base)
    cx, cy = w // 2, h // 2 + rng.randint(-4, 4)
    # simple face blob + body
    r = min(w, h) // 7
    dr.ellipse((cx - r - 35, cy - r * 3, cx + r + 35, cy + r), fill=(91, 33, 182), outline=(60, 20, 120), width=2)
    eye = rng.randint(5, 7)
    dr.ellipse((cx - r // 2 - 6 - eye, cy - r - eye, cx - r // 2 - 6 + eye, cy - r + eye), fill=(40, 20, 60))
    dr.ellipse((cx + r // 2 + 6 - eye, cy - r - eye, cx + r // 2 + 6 + eye, cy - r + eye), fill=(40, 20, 60))
    grin_w = rng.randint(r, r + 16)
    dr.arc((cx - grin_w, cy - 4, cx + grin_w, cy + r), start=200, end=340, fill=(212, 168, 67), width=5)
    for _ in range(10):
        x0, y0 = rng.randint(4, w - 12), rng.randint(4, h - 12)
        dr.ellipse((x0, y0, x0 + 4, y0 + 4), fill=(230, 220, 250))
    return base


def pil_game_scene(w: int, h: int, *, seed: int) -> "Image.Image":
    from PIL import Image, ImageDraw  # noqa: PLC0415

    rng = random.Random(seed)
    img = Image.new("RGB", (w, h), (245, 242, 255))
    dr = ImageDraw.Draw(img)
    horizon = int(h * 0.62)
    dr.rectangle((0, horizon, w, h), fill=(226, 240, 230))
    for i in range(6):
        x = int(w * (0.08 + i * 0.16))
        bw = rng.randint(40, 95)
        bh = rng.randint(50, 120)
        dr.rounded_rectangle(
            (x, horizon - bh, x + bw, horizon + 10),
            radius=8,
            fill=(rng.randint(200, 228), rng.randint(210, 235), rng.randint(220, 240)),
            outline=(180, 190, 210),
            width=1,
        )
    dr.arc((int(w * 0.72), rng.randint(-40, 30), int(w * 1.05), rng.randint(h // 5, h // 2)), 0, 180, fill=(252, 240, 200), width=40)
    return img


def main() -> int:
    gfp = _load_ui_pack_module()
    p = argparse.ArgumentParser(description="Generate campus game Flux / PIL assets.")
    p.add_argument(
        "--manifest",
        type=Path,
        default=_HERE / "campus-game-assets-manifest.json",
    )
    p.add_argument(
        "--out-dir",
        type=Path,
        default=_REPO_ROOT / "apps" / "mobile" / "assets" / "generated-game",
    )
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8188)
    p.add_argument("--steps", type=int, default=10)
    p.add_argument("--seed-base", type=int, default=20260315)
    p.add_argument("--force-placeholders", action="store_true")
    args = p.parse_args()

    data = json.loads(args.manifest.read_text(encoding="utf-8"))
    items = data.get("items") or []
    if not items:
        print("manifest has no items", file=sys.stderr)
        return 1

    base = f"http://{args.host}:{args.port}"
    comfy_ok = gfp.comfy_ping(base) and not args.force_placeholders
    print("ComfyUI:", base, "online" if comfy_ok else "offline -> PIL placeholders", flush=True)

    seed_base = args.seed_base if args.seed_base >= 0 else random.randint(0, 2**31)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    for raw in items:
        fid = str(raw["id"])
        fn = str(raw["filename"])
        w = int(raw["width"])
        h = int(raw["height"])
        off = int(raw.get("seed_offset", 0))
        prompt = str(raw["prompt"])
        seed = seed_base + off * 4441 + hash(fid) % 10000

        dest = args.out_dir / fn
        if comfy_ok:
            try:
                gfp.comfy_generate_png(
                    base,
                    positive=prompt.strip() + gfp.NO_TEXT + " " + gfp.COMMON_BRAND,
                    seed=max(0, seed),
                    steps=args.steps,
                    width=w,
                    height=h,
                    filename_prefix=f"game_{fid}",
                    dest=dest,
                )
                continue
            except Exception as e:
                print("Flux failed for", fid, e, "- PIL fallback", file=sys.stderr, flush=True)

        if not gfp.HAS_PIL:
            print("Install Pillow or start ComfyUI.", file=sys.stderr)
            return 1
        if "scene" in fid:
            pil_game_scene(w, h, seed=seed).save(dest, format="PNG", optimize=True)
        else:
            pil_game_avatar(w, h, seed=seed, variant=off).save(dest, format="PNG", optimize=True)
        gfp.optional_webp(dest)
        print("PIL ->", dest, flush=True)

    print("Done.", args.out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
