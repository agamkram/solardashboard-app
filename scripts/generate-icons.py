#!/usr/bin/env python3
"""Generate Solar Light home-screen icons."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BG_TOP = (12, 15, 20)
BG_BOTTOM = (36, 28, 22)
SUN = (245, 166, 35)
SUN_CORE = (255, 220, 120)


def sky_color(y: int, size: int) -> tuple[int, int, int]:
    t = y / max(1, size - 1)
    return tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))


def build_icon(size: int) -> Image.Image:
    canvas = Image.new("RGB", (size, size))
    pixels = canvas.load()
    for y in range(size):
        color = sky_color(y, size)
        for x in range(size):
            pixels[x, y] = color

    draw = ImageDraw.Draw(canvas)
    horizon_y = int(size * 0.72)
    draw.rectangle((0, horizon_y, size, size), fill=(20, 24, 30))
    draw.line((0, horizon_y, size, horizon_y), fill=(55, 62, 74), width=max(2, size // 128))

    sun_center = (int(size * 0.56), int(size * 0.34))
    sun_radius = int(size * 0.16)

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    for ring, alpha in ((sun_radius + 34, 28), (sun_radius + 20, 45), (sun_radius + 8, 70)):
        glow_draw.ellipse(
            (
                sun_center[0] - ring,
                sun_center[1] - ring,
                sun_center[0] + ring,
                sun_center[1] + ring,
            ),
            fill=(*SUN, alpha),
        )
    canvas = Image.alpha_composite(canvas.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(radius=size // 48)))
    draw = ImageDraw.Draw(canvas)

    for i in range(10):
        angle = -math.pi / 2 + (i - 4.5) * 0.22
        inner = sun_radius + 10
        outer = sun_radius + 28
        x1 = sun_center[0] + inner * math.cos(angle)
        y1 = sun_center[1] + inner * math.sin(angle)
        x2 = sun_center[0] + outer * math.cos(angle)
        y2 = sun_center[1] + outer * math.sin(angle)
        draw.line((x1, y1, x2, y2), fill=(*SUN, 180), width=max(3, size // 80))

    draw.ellipse(
        (
            sun_center[0] - sun_radius,
            sun_center[1] - sun_radius,
            sun_center[0] + sun_radius,
            sun_center[1] + sun_radius,
        ),
        fill=SUN,
    )
    draw.ellipse(
        (
            sun_center[0] - sun_radius // 2,
            sun_center[1] - sun_radius // 2,
            sun_center[0] + sun_radius // 3,
            sun_center[1] + sun_radius // 3,
        ),
        fill=SUN_CORE,
    )

    return canvas.convert("RGB")


def save_icons() -> None:
    icon_512 = build_icon(512)
    icon_512.save(ROOT / "icon-512.png", "PNG")
    icon_512.resize((180, 180), Image.Resampling.LANCZOS).save(ROOT / "apple-touch-icon.png", "PNG")
    print(f"Wrote icons in {ROOT}")


if __name__ == "__main__":
    save_icons()