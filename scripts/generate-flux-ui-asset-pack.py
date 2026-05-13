#!/usr/bin/env python3
# Flux.1-dev 權重受 Black Forest Labs 授權條款拘束，商業發布請先確認許可。
"""
Batch-generate Flux.1-dev UI illustration assets via ComfyUI (default http://127.0.0.1:8188),
with deterministic PIL fallbacks when the server is offline / unreachable.

CLI:
  %(prog)s [--out-dir PATH] [--host HOST --port PORT] [--steps N] [--force-placeholders]
  %(prog)s --prompt "your prompt" --out file.png [--width W --height H --seed N ...]

Depends on Flux nodes matching scripts/generate-campus-app-icon-comfyui.py:
  flux1-dev.safetensors, clip_l, t5xxl_fp16, ae.safetensors
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageDraw

    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# ─── ComfyUI API graph (same wiring as scripts/generate-campus-app-icon-comfyui.py)


def build_prompt(
    positive: str,
    *,
    seed: int,
    steps: int,
    width: int,
    height: int,
    filename_prefix: str,
) -> dict[str, dict[str, Any]]:
    """API-format ComfyUI graph (Flux.1 Dev)."""
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
        "39": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "27": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "45": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["40", 0], "text": positive},
        },
        "42": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["45", 0]}},
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
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["31", 0], "vae": ["39", 0]}},
        "9": {
            "class_type": "SaveImage",
            "inputs": {"images": ["8", 0], "filename_prefix": filename_prefix},
        },
    }


def post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=3600) as resp:
        return json.loads(resp.read().decode())


def fetch_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=120) as resp:
        return json.loads(resp.read().decode())


def fetch_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=3600) as resp:
        return resp.read()


def comfy_ping(base: str) -> bool:
    try:
        with urllib.request.urlopen(f"{base}/system_stats", timeout=5) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


def comfy_generate_png(
    base: str,
    *,
    positive: str,
    seed: int,
    steps: int,
    width: int,
    height: int,
    filename_prefix: str,
    dest: Path,
) -> None:
    workflow = build_prompt(
        positive,
        seed=seed,
        steps=steps,
        width=width,
        height=height,
        filename_prefix=filename_prefix,
    )
    try:
        q = post_json(f"{base}/prompt", {"prompt": workflow})
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")
        print("ComfyUI /prompt HTTP error:", e.code, err[:4000], file=sys.stderr)
        raise
    pid = q.get("prompt_id")
    if not pid:
        raise RuntimeError(f"Unexpected queue response: {q}")

    print("  queued:", filename_prefix, "prompt_id=", pid, "seed=", seed, flush=True)
    deadline = time.time() + 7200
    image_info = None
    while time.time() < deadline:
        try:
            hist = fetch_json(f"{base}/history/{pid}")
        except urllib.error.HTTPError:
            time.sleep(1.2)
            continue
        entry = hist.get(pid) or hist.get(str(pid))
        if not entry:
            time.sleep(1.0)
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
            raise RuntimeError("Generation failed: " + json.dumps(entry, indent=2)[:3000])

        time.sleep(1.1)

    if not image_info:
        raise TimeoutError("Timeout waiting for ComfyUI /history")

    filename = image_info["filename"]
    subfolder = image_info.get("subfolder", "")
    folder_type = image_info.get("type", "output")
    qs = urllib.parse.urlencode(
        {"filename": filename, "subfolder": subfolder, "type": folder_type}
    )
    png = fetch_bytes(f"{base}/view?{qs}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(png)
    print("  saved ComfyPNG ->", dest, len(png), "bytes", flush=True)
    optional_webp(dest)


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def draw_gradient_horizontal(img: Image.Image, left: tuple[int, int, int], right: tuple[int, int, int]) -> None:
    px = img.load()
    w, h = img.size
    for x in range(w):
        t = x / max(1, w - 1)
        r = int(lerp(left[0], right[0], t))
        g = int(lerp(left[1], right[1], t))
        b = int(lerp(left[2], right[2], t))
        for y in range(h):
            px[x, y] = (r, g, b)


def draw_radial_glow(
    img: Image.Image,
    cx: float,
    cy: float,
    radius: float,
    color: tuple[int, int, int, int],
) -> None:
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            d = math.hypot(x - cx, y - cy) / max(1.0, radius)
            if d > 1.0:
                continue
            alpha = int(color[3] * (1.0 - d) ** 2)
            if alpha < 2:
                continue
            r0, g0, b0 = px[x, y]
            r1, g1, b1 = color[:3]
            t = alpha / 255.0
            px[x, y] = (
                int(lerp(r0, r1, t)),
                int(lerp(g0, g1, t)),
                int(lerp(b0, b1, t)),
            )


def pil_hero(width: int, height: int, *, seed: int, dark: bool) -> Image.Image:
    rng = random.Random(seed)
    img = Image.new("RGB", (width, height))
    if dark:
        left, right = hex_rgb("#1A0A3E"), hex_rgb("#0F0820")
    else:
        left, right = hex_rgb("#EDE9FF"), hex_rgb("#FFF5FB")
    draw_gradient_horizontal(img, left, right)
    draw = ImageDraw.Draw(img, "RGBA")
    for _ in range(12):
        x = rng.randint(0, width)
        y = rng.randint(0, height)
        r = rng.randint(40, 180)
        c = (91, 33, 182, rng.randint(8, 35))
        draw.ellipse((x - r, y - r, x + r, y + r), fill=c)
    gold = (212, 168, 67, 40)
    draw_radial_glow(img, width * 0.82, height * 0.18, min(width, height) * 0.45, gold)
    vi = (91, 33, 182, 55)
    draw_radial_glow(img, width * 0.12, height * 0.72, min(width, height) * 0.5, vi)
    return img


def pil_empty_card(width: int, height: int, *, seed: int, mood: str) -> Image.Image:
    rng = random.Random(seed)
    base = Image.new("RGB", (width, height), hex_rgb("#FCF8FB"))
    draw_gradient_horizontal(base, hex_rgb("#F3ECFA"), hex_rgb("#FFFCFD"))
    img = base.convert("RGBA")
    draw = ImageDraw.Draw(img)
    cx, cy = width * 0.5, height * 0.42
    if mood == "relaxed":
        draw.ellipse(
            (cx - 70, cy - 50, cx + 70, cy + 90),
            fill=(91, 33, 182, 22),
            outline=(91, 33, 182, 40),
            width=2,
        )
        draw.rounded_rectangle(
            (cx - 45, cy + 10, cx + 55, cy + 38),
            radius=6,
            fill=(212, 168, 67, 35),
        )
    elif mood == "spark":
        for i in range(8):
            ang = math.pi * 2 * i / 8
            x2 = cx + math.cos(ang) * 55
            y2 = cy + math.sin(ang) * 55
            draw.line((cx, cy, x2, y2), fill=(212, 168, 67, 120), width=3)
            draw.ellipse((x2 - 4, y2 - 4, x2 + 4, y2 + 4), fill=(212, 168, 67, 200))
        draw.ellipse((cx - 12, cy - 12, cx + 12, cy + 12), fill=(91, 33, 182, 180))
    else:  # campus / route
        draw.arc((cx - 80, cy - 30, cx + 40, cy + 80), start=200, end=340, fill=(91, 33, 182, 90), width=6)
        draw.polygon([(cx + 50, cy - 55), (cx + 62, cy - 30), (cx + 38, cy - 30)], fill=(212, 168, 67, 200))
        for _ in range(14):
            x0 = rng.randint(20, width - 20)
            y0 = rng.randint(height - 60, height - 15)
            draw.ellipse((x0, y0, x0 + 4, y0 + 4), fill=(180, 160, 220, rng.randint(80, 200)))
    return img.convert("RGB")


def pil_pattern_tile(size: int, *, seed: int) -> Image.Image:
    rng = random.Random(seed)
    img = Image.new("RGB", (size, size), hex_rgb("#F3ECFA"))
    draw = ImageDraw.Draw(img)
    step = max(28, size // 14)
    soft = [(242, 235, 252), (230, 220, 245), (220, 208, 240), (210, 198, 234)]
    for y in range(0, size, step):
        for x in range(0, size, step):
            jx = rng.randint(-3, 3)
            jy = rng.randint(-3, 3)
            r = rng.randint(2, 7)
            draw.ellipse((x + jx - r, y + jy - r, x + jx + r, y + jy + r), fill=rng.choice(soft))
        draw.line([(0, y), (size, y)], fill=(237, 230, 250), width=1)
    draw.line([(0, 0), (size - 1, size - 1)], fill=(237, 230, 250), width=1)
    return img


def optional_webp(png_path: Path) -> None:
    if not HAS_PIL:
        return
    try:
        im = Image.open(png_path)
        webp = png_path.with_suffix(".webp")
        im.save(webp, format="WEBP", quality=88, method=6)
        print("  webp:", webp, flush=True)
    except Exception as e:
        print("  (skip webp)", e, file=sys.stderr, flush=True)


def write_pil_fallback(dest: Path, kind: str, wh: tuple[int, int], seed: int) -> None:
    if not HAS_PIL:
        raise RuntimeError("Pillow missing; pip install Pillow to write placeholders.")
    w, h = wh
    dest.parent.mkdir(parents=True, exist_ok=True)
    if kind == "hero_dashboard":
        pil_hero(w, h, seed=seed, dark=False).save(dest, format="PNG", optimize=True)
    elif kind == "hero_dashboard_tall":
        pil_hero(w, h, seed=seed + 11, dark=False).save(dest, format="PNG", optimize=True)
    elif kind == "hero_personal":
        pil_hero(w, h, seed=seed + 23, dark=False).save(dest, format="PNG", optimize=True)
    elif kind == "empty_relaxed":
        pil_empty_card(w, h, seed=seed, mood="relaxed").save(dest, format="PNG", optimize=True)
    elif kind == "empty_spark":
        pil_empty_card(w, h, seed=seed, mood="spark").save(dest, format="PNG", optimize=True)
    elif kind == "empty_route":
        pil_empty_card(w, h, seed=seed, mood="campus").save(dest, format="PNG", optimize=True)
    elif kind == "pattern":
        pil_pattern_tile(min(w, h), seed=seed).resize((w, h), Image.Resampling.LANCZOS).save(
            dest, format="PNG", optimize=True
        )
    print("  saved PIL placeholder ->", dest, flush=True)
    optional_webp(dest)


NO_TEXT = (
    ", no readable text no letters no logos watermark signature, cohesive mobile app illustration"
)

COMMON_BRAND = (
    "Taiwan catholic women's university pastoral calm mood "
    "(Providence-inspired palette only: violet #5B21B6, gold accent #D4A843, cream blush #FCF8FB, lilac pastel), "
    "airy whitespace, watercolor digital matte, UX hero art not photo"
)


@dataclass(frozen=True)
class PackItem:
    id: str
    filename: str
    width: int
    height: int
    prompt: str
    pil_fallback_kind: str

    def dims(self) -> tuple[int, int]:
        return (self.width, self.height)


DEFAULT_PACK: list[PackItem] = [
    PackItem(
        "hero_dashboard",
        "flux-hero-dashboard.png",
        1216,
        512,
        (
            f"Ultra wide panoramic soft header background {COMMON_BRAND}. Abstract flowing mist, "
            f"spherical pastel bokeh, subtle golden highlight flecks near bottom edge, dreamy calm study vibes "
            f"{NO_TEXT}"
        ),
        "hero_dashboard",
    ),
    PackItem(
        "hero_dashboard_tall",
        "flux-hero-dashboard-tall.png",
        832,
        704,
        (
            f"Taller pastel hero vignette for side drawer chrome {COMMON_BRAND}. Gentle vertical aurora arcs, "
            f"whisper-soft clouds, restrained gold ribbons, harmonious empty center "
            f"{NO_TEXT}"
        ),
        "hero_dashboard_tall",
    ),
    PackItem(
        "hero_personal",
        "flux-hero-personal.png",
        1024,
        588,
        (
            f"Portrait-friendly hero collage {COMMON_BRAND}. Layered translucent lilac ribbons, botanical hint as "
            f"soft silhouettes NOT detailed plants, luminous calm morning light gradient {NO_TEXT}"
        ),
        "hero_personal",
    ),
    PackItem(
        "empty_relaxed",
        "flux-empty-relaxed.png",
        592,
        416,
        f"Tiny friendly empty-state illustration resting student abstract shapeless mascot blob reading book "
        f"{COMMON_BRAND} vignette framing lots of pastel padding {NO_TEXT}",
        "empty_relaxed",
    ),
    PackItem(
        "empty_spark",
        "flux-empty-spark.png",
        592,
        416,
        f"Tiny empty inbox illustration pastel desk lamp emitting soft spark constellation abstract "
        f"{COMMON_BRAND} vignette minimalist {NO_TEXT}",
        "empty_spark",
    ),
    PackItem(
        "empty_route",
        "flux-empty-route.png",
        592,
        416,
        f"Tiny empty journey illustration dashed soft path looping abstract map pin star hint "
        f"{COMMON_BRAND} minimalist {NO_TEXT}",
        "empty_route",
    ),
    PackItem(
        "pattern",
        "flux-pattern-soft.png",
        384,
        384,
        f"Ultra subtle tile wallpaper micro pattern paper grain organic dots pastel lavender blush "
        f"{COMMON_BRAND} extremely low contrast {NO_TEXT}",
        "pattern",
    ),
]


def render_pack(
    out_dir: Path,
    *,
    base: str,
    steps: int,
    seed_base: int,
    force_placeholders: bool,
    use_comfy: bool,
) -> int:
    if not HAS_PIL and force_placeholders:
        print("Pillow missing; placeholders cannot render.", file=sys.stderr)
        return 1

    comfy_ok = False
    if use_comfy and not force_placeholders:
        comfy_ok = comfy_ping(base)
        print("ComfyUI", base, "online" if comfy_ok else "offline (PIL fallback)", flush=True)

    seed_src = seed_base if seed_base >= 0 else random.randint(0, 2**31)

    instructions = []
    instructions.append("")
    instructions.append(
        "若需真實 Flux 輸出：啟動本機 ComfyUI（Flux.1-dev 工作流程與 checkpoints 對齊"
        + " scripts/workflows/flux-ui-asset-pack-api.json）、再執行："
    )
    instructions.append(
        f"  AI圖像本地引擎/.venv/bin/python scripts/generate-flux-ui-asset-pack.py --out-dir {out_dir}"
    )
    instructions.append("")

    for i, item in enumerate(DEFAULT_PACK):
        dest = out_dir / item.filename
        seed_i = seed_src + i * 9173
        use_flux_here = comfy_ok and not force_placeholders
        prompt = item.prompt

        if item.id == "pattern" and comfy_ok:
            # Flux rarely tiles perfectly; PIL pattern is deterministic for tiling
            write_pil_fallback(dest, item.pil_fallback_kind, item.dims(), seed_i)
            continue

        if use_flux_here:
            prefix = f"flux_ui_pack_{item.id}"
            try:
                comfy_generate_png(
                    base,
                    positive=prompt,
                    seed=seed_i,
                    steps=steps,
                    width=item.width,
                    height=item.height,
                    filename_prefix=prefix,
                    dest=dest,
                )
                continue
            except Exception as e:
                print("Comfy generation failed:", e, "— falling back to PIL for", dest, file=sys.stderr)
        write_pil_fallback(dest, item.pil_fallback_kind, item.dims(), seed_i)

    if not comfy_ok:
        print("\n".join(instructions), file=sys.stderr)
    print("Done. Outputs in:", out_dir)
    return 0


def dump_api_workflow_example(out_json: Path) -> None:
    """Emit the API graph skeleton (example dimensions / prompt placeholders)."""
    example = build_prompt(
        "<EDIT POSITIVE PROMPT>",
        seed=1000,
        steps=24,
        width=1024,
        height=576,
        filename_prefix="flux_ui_manual",
    )
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(example, indent=2), encoding="utf-8")
    print("Wrote API workflow skeleton:", out_json)


def single_shot(base: str, args: argparse.Namespace) -> int:
    positive = (
        args.positive.strip()
        + ("" if "[Providence-inspired" in args.positive else f" {COMMON_BRAND}")
        + NO_TEXT
    )
    seed = args.seed if args.seed >= 0 else random.randint(0, 2**48)
    if not comfy_ping(base):
        print("ComfyUI not reachable — cannot run single-shot; start server on", base, file=sys.stderr)
        return 1
    outp = Path(args.out)
    comfy_generate_png(
        base,
        positive=positive,
        seed=seed,
        steps=args.steps,
        width=args.width,
        height=args.height,
        filename_prefix=args.prefix,
        dest=outp,
    )
    print("Saved single shot:", outp)
    return 0


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    default_mobile_assets = repo_root / "apps" / "mobile" / "assets" / "generated-ui"

    p = argparse.ArgumentParser(description="Generate Flux / ComfyUI UI asset pack.")
    p.add_argument(
        "--out-dir",
        type=Path,
        default=default_mobile_assets,
        help="PNG output folder (defaults to apps/mobile/assets/generated-ui)",
    )
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8188)
    p.add_argument("--steps", type=int, default=10, help="KSampler steps (lower = faster preview)")
    p.add_argument(
        "--seed",
        dest="seed_base",
        type=int,
        default=-1,
        help="Base seed for pack items (-1 random); each item increments deterministically.",
    )
    p.add_argument(
        "--force-placeholders",
        action="store_true",
        help="Skip ComfyUI; write PIL placeholders only.",
    )
    p.add_argument(
        "--no-comfy",
        action="store_true",
        dest="disable_comfy",
        help="Disable Comfy even if reachable (PIL placeholders).",
    )
    p.add_argument("--emit-workflow-json", action="store_true", help="Write API JSON skeleton alongside pack.")
    #
    single = p.add_argument_group("single image (Flux only)")
    single.add_argument("--prompt", default="", help="Positive prompt — enables single-shot instead of pack.")
    single.add_argument("--out", type=str, default="", help="PNG path when using --prompt")
    single.add_argument("--width", type=int, default=1024)
    single.add_argument("--height", type=int, default=1024)
    single.add_argument("--prefix", default="flux_ui_single")

    args = p.parse_args()
    base = f"http://{args.host}:{args.port}"
    args.out_dir = args.out_dir.resolve()

    if args.prompt.strip() and args.out.strip():
        return single_shot(base, args)

    if args.emit_workflow_json:
        dump_api_workflow_example(Path(__file__).resolve().parent / "workflows" / "flux-ui-asset-pack-api.json")

    return render_pack(
        args.out_dir,
        base=base,
        steps=max(4, args.steps),
        seed_base=args.seed_base,
        force_placeholders=args.force_placeholders,
        use_comfy=not args.disable_comfy,
    )


if __name__ == "__main__":
    raise SystemExit(main())
