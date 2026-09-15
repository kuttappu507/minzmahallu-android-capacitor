#!/usr/bin/env python3
"""
NSIS installer art for MMS — crisp at EVERY Windows display scale.

Why: MUI2 (NSIS 3.0.4.1, what electron-builder uses) renders the header and
wizard/sidebar bitmaps by loading them AT THE CONTROL'S PIXEL SIZE
(nsDialogs NSD_SetStretchedImage / SetBrandingImage /RESIZETOFIT both call
LoadImage with explicit cx/cy). On a display scaled above 100% the MUI
controls grow with the DPI (dialog units track the font), so the 96-DPI
art (164x314 / 150x57) gets resampled by GDI — blocky, pixelated edges.

Fix (two halves, see build/installer.nsh for the runtime half):
  1. This script renders the SAME design at every common scale:
       build/installerSidebar.bmp          164x314   (100%, the MUI default)
       build/installerHeader.bmp           150x 57   (100%, the MUI default)
       build/hidpi/installerSidebar-125.bmp 205x393  ... etc for 125/150/175/200%
       build/hidpi/installerHeader-125.bmp  188x 71
  2. installer.nsh's customHeader hook (runs in .onGUIInit, after MUI has
     extracted its 100% art and BEFORE any page displays it) measures the
     real screen DPI and swaps in the matching file, so LoadImage maps
     pixels 1:1 — no resampling, no pixelation, at any scale.

Design: full-bleed brand-green gradient (splash family #12a396 -> #0d9488
-> #0a5f5a, 165deg) with the white squircle mark from public/logo.png.
Everything is drawn 4x supersampled and LANCZOS-downsampled (same
technique as scripts/gen-brand-assets.py).

Run from repo root:  python3 scripts/gen-nsis-assets.py
Outputs are committed (electron-builder picks the 100% pair up by build/
file-name convention; the hidpi/ variants are extracted by installer.nsh).
"""
from PIL import Image
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "build")
HIDPI_DIR = os.path.join(OUT_DIR, "hidpi")
MARK_SRC = os.path.join(ROOT, "public", "logo.png")  # white mark, transparent bg

SS = 4  # supersampling factor

# MUI2 control sizes at 96 DPI (100% scaling).
SIDEBAR_BASE = (164, 314)   # welcome/finish left rail
HEADER_BASE = (150, 57)     # top strip on inner pages
MARK_SIDEBAR = 108          # white mark edge length in the 1x sidebar
MARK_HEADER = 36            # white mark edge length in the 1x header

# Windows display-scale presets and the DPI they imply.
SCALES = {
    "125": (1.25, 120),
    "150": (1.5, 144),
    "175": (1.75, 168),
    "200": (2.0, 192),
}

# Splash-screen gradient stops (165deg), kept in sync with globals.css.
TOP = (18, 163, 150)      # #12a396
MID = (13, 148, 136)      # #0d9488
BOT = (10, 95, 90)        # #0a5f5a


def iround(x: float) -> int:
    return int(x + 0.5)


def gradient(w: int, h: int, diagonal: bool = True) -> Image.Image:
    """Brand gradient, drawn supersampled and downscaled (anti-aliased)."""
    W, H = w * SS, h * SS
    im = Image.new("RGB", (W, H))
    px = im.load()
    for y in range(H):
        for x in range(W):
            t = (y / H) if not diagonal else (0.55 * (y / H) + 0.45 * (x / W))
            if t < 0.52:
                k = t / 0.52
                c = tuple(TOP[i] + (MID[i] - TOP[i]) * k for i in range(3))
            else:
                k = (t - 0.52) / 0.48
                c = tuple(MID[i] + (BOT[i] - MID[i]) * k for i in range(3))
            px[x, y] = tuple(int(round(v)) for v in c)
    return im.resize((w, h), Image.LANCZOS)


def white_mark(target: int) -> Image.Image:
    """White squircle mark from public/logo.png fitted to `target` px square,
    preserving alpha; drawn supersampled for clean edges."""
    src = Image.open(MARK_SRC).convert("RGBA")
    W = target * SS
    im = src.resize((W, W), Image.LANCZOS)
    return im.resize((target, target), Image.LANCZOS)


def make_sidebar(w: int, h: int, mark: int) -> Image.Image:
    """Left rail: gradient + centered white mark."""
    base = gradient(w, h, diagonal=True).convert("RGBA")
    m = white_mark(mark)
    mx = (w - m.width) // 2
    my = (h - m.height) // 2 - iround(h / 314 * 6)  # -6px at 1x, scaled
    base.alpha_composite(m, (mx, my))
    return base.convert("RGB")  # MUI2 bitmaps: no alpha channel


def make_header(w: int, h: int, mark: int) -> Image.Image:
    """Top strip: gradient + white mark right-aligned (MUI layout)."""
    base = gradient(w, h, diagonal=False).convert("RGBA")
    m = white_mark(mark)
    base.alpha_composite(m, (w - m.width - iround(w / 164 * 10) if False else w - m.width - iround(w / 150 * 10), (h - m.height) // 2))
    return base.convert("RGB")


def save_bmp(im: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, "BMP")
    print(f"[nsis-assets] {path}  {im.size[0]}x{im.size[1]}  {os.path.getsize(path) / 1024:.1f} KB")


if __name__ == "__main__":
    # 100% pair — the files electron-builder wires into MUI by convention.
    save_bmp(make_sidebar(*SIDEBAR_BASE, MARK_SIDEBAR),
             os.path.join(OUT_DIR, "installerSidebar.bmp"))
    save_bmp(make_header(*HEADER_BASE, MARK_HEADER),
             os.path.join(OUT_DIR, "installerHeader.bmp"))

    # High-DPI variants — extracted at runtime by build/installer.nsh.
    for tag, (s, _dpi) in SCALES.items():
        sw, sh = iround(SIDEBAR_BASE[0] * s), iround(SIDEBAR_BASE[1] * s)
        save_bmp(make_sidebar(sw, sh, iround(MARK_SIDEBAR * s)),
                 os.path.join(HIDPI_DIR, f"installerSidebar-{tag}.bmp"))
        hw, hh = iround(HEADER_BASE[0] * s), iround(HEADER_BASE[1] * s)
        save_bmp(make_header(hw, hh, iround(MARK_HEADER * s)),
                 os.path.join(HIDPI_DIR, f"installerHeader-{tag}.bmp"))

    # Sanity: aspect ratios must match MUI expectations at every scale.
    for tag, (s, _dpi) in SCALES.items():
        for kind, base in (("Sidebar", SIDEBAR_BASE), ("Header", HEADER_BASE)):
            p = os.path.join(HIDPI_DIR, f"installer{kind}-{tag}.bmp")
            im = Image.open(p)
            assert im.size == (iround(base[0] * s), iround(base[1] * s)), (p, im.size)
    print("[nsis-assets] all sizes verified")
