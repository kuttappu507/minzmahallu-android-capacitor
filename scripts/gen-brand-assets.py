#!/usr/bin/env python3
"""Generate the MMS brand assets from the uploaded logo.

Uploaded mark: deep-green house/dome+crescent+family on transparent, 1254x1254.
Design language: white or theme-green mark on the app's theme green.

The app icon background is a SQUIRCLE (superellipse, n = 4.5) — not a square:
the rounded shape ships as real transparency in the corners, so Windows shows
the icon rounded in the taskbar, shortcuts, title bar and installer UI.

Outputs (into the repo):
  public/logo.png       512  white mark, transparent bg   (login / splash)
  public/logo-green.png 512  theme-green gradient mark, transparent bg (topbar)
  public/icon.png       512  squircle theme-green tile + white mark (general)
  public/icon-512.png   512  same (legacy name kept fresh)
  resources/icon.png   1024  squircle, full-bleed (electron-builder: win/nsis)
  public/icon.ico       multi-size ICO 16..256 (windows)
  public/favicon.png    512  squircle tile, mark slightly larger for 16px
Intermediates are kept in scripts/brand-out/ for inspection (gitignored).
"""
from PIL import Image
import numpy as np
import os
from os import path

# Repo root = parent of this script's directory, so the generator works from
# any checkout, not just this sandbox.
REPO = path.abspath(path.join(path.dirname(__file__), ".."))
SRC = path.join(REPO, "resources/brand/logo-source.png")
OUT_SRC = path.join(REPO, "scripts/brand-out")
os.makedirs(OUT_SRC, exist_ok=True)

# App theme green (login hero / topbar brand tile gradient stops)
GREEN_A = (13, 148, 136)   # #0d9488  --em
GREEN_B = (10, 95, 90)     # #0a5f5a  login hero deep stop
# Squircle: superellipse exponent. n=4.5 ~ iOS-style continuous corners,
# corner radius ~22% of the icon edge. Higher = closer to a square.
SQUIRCLE_N = 4.5
# Diagonal gradient direction (135deg) in unit vector
GX, GY = (1 / 2 ** 0.5, 1 / 2 ** 0.5)

img = Image.open(SRC).convert("RGBA")
w, h = img.size

# --- 1) recolor the mark to pure white, keeping the alpha mask (AA edges) ---
white = Image.new("RGBA", (w, h), (0, 0, 0, 0))
spa = img.load()
wp = white.load()
for y in range(h):
    for x in range(w):
        r, g, b, a = spa[x, y]
        if a >= 60:
            # drop the source green tint fully; alpha becomes the shape.
            # alpha < 60 is generation dust around the mark -> discarded
            wp[x, y] = (255, 255, 255, min(255, a + 20))
white.save(f"{OUT_SRC}/mark-white-full.png")

# --- 2) crop to the mark bounding box ---
bbox = white.getbbox()
mark = white.crop(bbox)
mark.save(f"{OUT_SRC}/mark-white-cropped.png")
mw, mh = mark.size
print(f"mark: {mw}x{mh} (aspect {mw/mh:.3f})")


# --- 3) squircle mask (supersampled 4x for clean anti-aliased corners) ---
def squircle_mask(size: int, n: float = SQUIRCLE_N, ss: int = 4) -> Image.Image:
    """L-mode alpha mask: 255 inside |u|^n + |v|^n <= 1, 0 outside."""
    big = size * ss
    xs = (np.arange(big) + 0.5) / big * 2 - 1        # u in (-1, 1)
    u = np.abs(xs)[None, :] ** n
    v = np.abs(xs)[:, None] ** n
    inside = (u + v) <= 1.0
    return Image.fromarray((inside * 255).astype(np.uint8), "L").resize(
        (size, size), Image.LANCZOS
    )


def gradient_rgba(size: int) -> Image.Image:
    """Opaque 135deg two-stop gradient GREEN_A -> GREEN_B."""
    xs = (np.arange(size) + 0.5) * GX
    ys = (np.arange(size) + 0.5) * GY
    t = np.clip((xs[None, :] + ys[:, None]) / (size * (GX + GY)) * 2, 0, 1)
    arr = np.empty((size, size, 4), dtype=np.uint8)
    for c in range(3):
        arr[..., c] = (GREEN_A[c] + (GREEN_B[c] - GREEN_A[c]) * t).astype(np.uint8)
    arr[..., 3] = 255
    return Image.fromarray(arr, "RGBA")


def fit_mark(canvas_px: int, scale: float) -> Image.Image:
    """White mark centered on a transparent square canvas."""
    out = Image.new("RGBA", (canvas_px, canvas_px), (0, 0, 0, 0))
    target_h = int(canvas_px * scale)
    target_w = int(target_h * mw / mh)
    m = mark.resize((target_w, target_h), Image.LANCZOS)
    out.paste(m, ((canvas_px - target_w) // 2, (canvas_px - target_h) // 2), m)
    return out


def green_tile(size: int, mark_scale: float, squircle: bool = True) -> Image.Image:
    """Theme-green 135deg gradient tile (optionally squircle-shaped) with the
    white mark centered."""
    out = gradient_rgba(size)
    if squircle:
        out.putalpha(squircle_mask(size))
    target_h = int(size * mark_scale)
    target_w = int(target_h * mw / mh)
    m = mark.resize((target_w, target_h), Image.LANCZOS)
    out.paste(m, ((size - target_w) // 2, (size - target_h) // 2), m)
    return out


def green_mark(canvas_px: int, scale: float) -> Image.Image:
    """The mark itself filled with the theme-green gradient, transparent bg.
    Used where the icon sits directly on the app chrome (no tile behind)."""
    out = Image.new("RGBA", (canvas_px, canvas_px), (0, 0, 0, 0))
    grad = gradient_rgba(canvas_px)
    target_h = int(canvas_px * scale)
    target_w = int(target_h * mw / mh)
    m = mark.resize((target_w, target_h), Image.LANCZOS)
    pos = ((canvas_px - target_w) // 2, (canvas_px - target_h) // 2)
    # paste the gradient THROUGH the mark's alpha, then restore the mark's
    # own soft AA edges on top
    out.paste(grad.crop((pos[0], pos[1], pos[0] + target_w, pos[1] + target_h)), pos, m)
    return out


# --- 4) in-app logos (transparent bg) ---
logo = fit_mark(512, 0.84)
logo.save(f"{REPO}/public/logo.png")
print("public/logo.png", logo.size)

logo_g = green_mark(512, 0.96)
logo_g.save(f"{REPO}/public/logo-green.png")
print("public/logo-green.png", logo_g.size)

# --- 5) app icon tiles (squircle theme-green + white mark) ---
for p, size in [
    (f"{REPO}/resources/icon.png", 1024),
    (f"{REPO}/public/icon.png", 512),
    (f"{REPO}/public/icon-512.png", 512),
]:
    tile = green_tile(size, 0.68, squircle=True)
    tile.save(p)
    tile.save(f"{OUT_SRC}/tile-{size}.png")
    print(p, tile.size)

# --- 6) multi-size Windows ICO (squircle at every size) ---
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
base = green_tile(256, 0.68, squircle=True)
base.save(f"{REPO}/public/icon.ico", sizes=ico_sizes)
print("public/icon.ico", ico_sizes)

# --- 7) favicon PNG (squircle tile, mark slightly larger for 16px legibility) ---
fav = green_tile(512, 0.74, squircle=True)
fav.save(f"{REPO}/public/favicon.png")
print("public/favicon.png", fav.size)
print("done")
