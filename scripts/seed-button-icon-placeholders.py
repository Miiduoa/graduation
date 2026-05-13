#!/usr/bin/env python3
"""Write simple gradient placeholder PNGs (96×96) for apps/mobile assets — stdlib only."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "apps/mobile/assets/generated-icons"


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack("!I", len(data)) + tag + data + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png_rgb(path: Path, w: int, h: int, rgb) -> None:
    """rgb(x,y) -> (r,g,b) ints 0-255."""
    rows = []
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            r, g, b = rgb(x, y)
            row.extend((r, g, b))
        rows.append(bytes(row))
    raw = b"".join(rows)
    comp = zlib.compress(raw, 9)

    png = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack("!IIBBBBB", w, h, 8, 2, 0, 0, 0)
    png += _chunk(b"IHDR", ihdr)
    png += _chunk(b"IDAT", comp)
    png += _chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def purple_gold_gradient(angle_deg: float):
    """ angle_deg tweaks hue so placeholders differ slightly per file. """

    def rgb(x: int, y: int) -> tuple[int, int, int]:
        t = (x / 95 + y / 95) * 0.5
        a = math.radians(angle_deg)
        u = (math.cos(a) * (x - 48) + math.sin(a) * (y - 48)) / 68 + 0.5
        u = max(0.0, min(1.0, u))
        # Cream to lavender / gold accents
        r = int(255 - u * 40 + 25 * math.sin(t * 6.28))
        g = int(235 - u * 35)
        b = int(255 - u * 25)
        return (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))

    return rgb


ICON_FILES = [
    "ic_tab_today",
    "ic_tab_study",
    "ic_tab_campus",
    "ic_tab_messages",
    "ic_profile",
    "ic_close",
    "ic_chevron_forward",
    "ic_session_expired_clock",
    "ic_warning_triangle",
    "ic_search",
    "ic_clear_circle",
    "ic_ai_sparkles",
    "ic_navigate_pin",
    "ic_ar_glasses",
    "ic_people_community",
    "ic_restaurant",
    "ic_library",
    "ic_dorm",
    "ic_bus",
    "ic_print",
    "ic_health_heart",
    "ic_lost_found",
    "ic_accessibility",
    "ic_payment_card",
    "ic_ar_nav_badge",
    "ic_globe_social",
    "ic_qr_code",
    "ic_trophy",
    "ic_school",
    "ic_notifications",
    "ic_options",
    "ic_settings",
    "ic_ai_chip",
    "ic_grid_widgets",
    "ic_admin_shield",
    "ic_verify",
    "ic_analytics_chart",
    "ic_facilities_wrench",
    "ic_store_merchant",
    "ic_privacy_export",
    "ic_trash_delete",
    "ic_help",
    "ic_feedback_chat",
    "ic_bug_report",
]


def main() -> int:
    for i, name in enumerate(ICON_FILES):
        angle = i * 17.3
        write_png_rgb(OUT_DIR / f"{name}.png", 96, 96, purple_gold_gradient(angle))
    print("Wrote", len(ICON_FILES), "PNGs to", OUT_DIR)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
