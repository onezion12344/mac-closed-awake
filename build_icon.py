#!/usr/bin/env python3
"""Build icon.png (1024x1024 Big Sur rounded-square) and icon.icns from mascot-icon.png."""

import os
import math
import subprocess
from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(REPO, "landing", "assets", "mascot-icon.png")
PNG_OUT = os.path.join(REPO, "icon.png")
ICNS_OUT = os.path.join(REPO, "icon.icns")

SIZE = 1024
# Crop mascot to central ~92%, slightly downward biased
CROP_RATIO = 0.92
VERTICAL_BIAS = 0.02  # shift crop down by 2%

# Mascot placed at ~90% of canvas
MASCOT_SCALE = 0.90

# Corner radius ~22.5% of side
CORNER_RADIUS_RATIO = 0.225

# Gold inset ring
RING_COLOR = (240, 192, 74)  # #f0c04a
RING_ALPHA = int(255 * 0.43)
RING_WIDTH = 4
RING_INSET = 6  # inset from the rounded-rect edge


def rounded_rect_mask(size, radius):
    """Create a rounded-rectangle alpha mask."""
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (size[0] - 1, size[1] - 1)], radius=radius, fill=255)
    return mask


def build_icon_png():
    """Build 1024x1024 icon.png with Big Sur-style rounded square."""
    mascot = Image.open(SRC).convert("RGBA")
    w, h = mascot.size

    # Crop central ~92%, downward biased
    crop_w = int(w * CROP_RATIO)
    crop_h = int(h * CROP_RATIO)
    cx = w // 2
    cy = int(h * (0.5 + VERTICAL_BIAS))
    left = cx - crop_w // 2
    top = cy - crop_h // 2
    right = left + crop_w
    bottom = top + crop_h
    # Clamp
    if left < 0:
        left, right = 0, crop_w
    if top < 0:
        top, bottom = 0, crop_h
    if right > w:
        right, left = w, w - crop_w
    if bottom > h:
        bottom, top = h, h - crop_h
    mascot = mascot.crop((left, top, right, bottom))

    # Create canvas
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # Scale mascot to ~90% of canvas
    target = int(SIZE * MASCOT_SCALE)
    mascot = mascot.resize((target, target), Image.LANCZOS)

    # Center on canvas
    offset_x = (SIZE - target) // 2
    offset_y = (SIZE - target) // 2
    canvas.paste(mascot, (offset_x, offset_y), mascot)

    # Apply rounded-rect mask
    radius = int(SIZE * CORNER_RADIUS_RATIO)
    mask = rounded_rect_mask((SIZE, SIZE), radius)
    canvas.putalpha(mask)

    # Add subtle gold inset ring
    ring_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ring_draw = ImageDraw.Draw(ring_layer)
    ri = RING_INSET
    inner_radius = max(radius - ri, 1)
    ring_draw.rounded_rectangle(
        [(ri, ri), (SIZE - 1 - ri, SIZE - 1 - ri)],
        radius=inner_radius,
        outline=(*RING_COLOR, RING_ALPHA),
        width=RING_WIDTH,
    )
    canvas = Image.alpha_composite(canvas, ring_layer)

    canvas.save(PNG_OUT, "PNG")
    print(f"[OK] icon.png written: {PNG_OUT}")


def build_icns():
    """Build icon.icns via .iconset folder + iconutil."""
    iconset_dir = os.path.join(REPO, "icon.iconset")
    os.makedirs(iconset_dir, exist_ok=True)

    base = Image.open(PNG_OUT).convert("RGBA")

    # iconset spec: (filename, actual pixel size)
    specs = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]

    for fname, px in specs:
        img = base.resize((px, px), Image.LANCZOS)
        img.save(os.path.join(iconset_dir, fname), "PNG")

    print(f"[OK] iconset written: {iconset_dir}")

    # Use iconutil to create .icns
    if os.path.exists(ICNS_OUT):
        os.remove(ICNS_OUT)
    subprocess.run(
        ["iconutil", "-c", "icns", iconset_dir, "-o", ICNS_OUT],
        check=True,
    )
    print(f"[OK] icon.icns written: {ICNS_OUT}")


if __name__ == "__main__":
    build_icon_png()
    build_icns()
    print("Done.")
