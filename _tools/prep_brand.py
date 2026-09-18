"""Brand assets from the client's logo, a 1448x1086 raster JPEG on white (originals/brand/).

The logo is stacked: a mark (navy tooth, gold swoosh, an arc of eight gold stars) above the wordmark
"European Dental". A stacked lockup is too tall for a header (the wordmark would be 11 px high), so a
horizontal lockup is composed from the two parts of the same file: nothing is redrawn or retyped.

Method:
  white key  an alpha ramp on the min channel (HI 238, LO 205), plus an
             un-premultiply against white so edge pixels carry their real colour and no white halo shows
             on the navy footer
  exports    quantised PNGs (because gold gradients compress badly as
             truecolour; favicon sizes; a multi-size ICO saved from the 48 px master)

Writes assets/brand/ (copied into site/ by the build):
  logo-h-{320,640,960}.png          header lockup, navy and gold
  logo-h-rev-{320,640,960}.png      footer lockup: navy parts turned white, gold kept
  logo-stacked-600.png              the full logo, for JSON-LD and the share card
  og-card-1200.png                  1200x630 share card, one for every language
  favicon.ico (16, 32, 48), favicon-32.png, icon-192.png, icon-512.png, apple-touch-icon.png (180)
  brand.json                        measured sizes, for the build and the gates
usage: python _tools/prep_brand.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "originals" / "brand" / "european-dental-logo.jpeg"
OUT = ROOT / "assets" / "brand"
OUT.mkdir(parents=True, exist_ok=True)

HI, LO = 238.0, 205.0
NAVY_TILE = (8, 54, 95)      # --c-navy #08365F
ICE = (244, 248, 251)        # --c-ice #F4F8FB
GOLD = (201, 154, 56)        # --c-gold #C99A38


def keyed(rgb: np.ndarray) -> np.ndarray:
    """RGBA float array: alpha from the min-channel ramp, colour un-premultiplied against white."""
    m = rgb.min(axis=2)
    a = np.clip((HI - m) / (HI - LO), 0.0, 1.0)
    safe = np.where(a > 0.004, a, 1.0)[..., None]
    fg = np.clip((rgb - 255.0 * (1.0 - a[..., None])) / safe, 0, 255)
    fg[a <= 0.004] = 0
    return np.dstack([fg, a * 255.0])


def is_blue(rgba: np.ndarray) -> np.ndarray:
    return rgba[..., 2] > rgba[..., 0] + 20


def band_rows(ink: np.ndarray):
    rows = ink.sum(axis=1) > 0
    bands, start = [], None
    for y, v in enumerate(rows):
        if v and start is None:
            start = y
        if not v and start is not None:
            bands.append((start, y - 1))
            start = None
    if start is not None:
        bands.append((start, len(rows) - 1))
    return bands


def bbox(mask: np.ndarray, pad: int = 3):
    ys, xs = np.where(mask)
    return max(0, xs.min() - pad), max(0, ys.min() - pad), xs.max() + 1 + pad, ys.max() + 1 + pad


def to_img(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8), "RGBA")


def save_quant(img: Image.Image, path: Path):
    q = img.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    q.save(path, optimize=True)


rgb = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float64)
H, W, _ = rgb.shape
rgba = keyed(rgb)
ink = rgba[..., 3] > 128

bands = band_rows(ink)
# the mark is every band above the widest empty gap; the wordmark is the last band
gaps = [(bands[i + 1][0] - bands[i][1], i) for i in range(len(bands) - 1)]
split = max(gaps)[1]
mark_rows = (bands[0][0], bands[split][1])
word_rows = (bands[split + 1][0], bands[-1][1])
mark_mask = np.zeros_like(ink)
mark_mask[mark_rows[0]:mark_rows[1] + 1] = ink[mark_rows[0]:mark_rows[1] + 1]
word_mask = np.zeros_like(ink)
word_mask[word_rows[0]:word_rows[1] + 1] = ink[word_rows[0]:word_rows[1] + 1]
mx0, my0, mx1, my1 = bbox(mark_mask)
wx0, wy0, wx1, wy1 = bbox(word_mask)
mark = rgba[my0:my1, mx0:mx1]
word = rgba[wy0:wy1, wx0:wx1]

# Where the capitals sit: the first letter (E) has no descender, so its lowest ink row is the baseline.
first_col = np.where(word_mask[:, wx0:wx0 + 1200].any(axis=0))[0][0] + wx0
e_cols = slice(first_col, first_col + 60)
e_rows = np.where(word_mask[:, e_cols].any(axis=1))[0]
cap_top, baseline = e_rows.min(), e_rows.max()

# ---------- horizontal lockup ----------
# The mark is 1.55 times the wordmark's full height, the gap 0.28 of the scaled mark's width, and the
# middle of the capitals sits on the middle of the mark.
word_h = wy1 - wy0
mark_h_target = 1.55 * word_h
s = mark_h_target / mark.shape[0]
mark_img = to_img(mark).resize((round(mark.shape[1] * s), round(mark.shape[0] * s)), Image.LANCZOS)
word_img = to_img(word)
gap = round(0.28 * mark_img.width)
cap_mid_in_word = ((cap_top + baseline) / 2) - wy0
canvas_h = max(mark_img.height, word_img.height)
mark_y = (canvas_h - mark_img.height) // 2
word_y = round(mark_y + mark_img.height / 2 - cap_mid_in_word)
top = min(0, word_y)
bottom = max(canvas_h, word_y + word_img.height)
lock_h = bottom - top
lock_w = mark_img.width + gap + word_img.width
lock = Image.new("RGBA", (lock_w, lock_h), (0, 0, 0, 0))
lock.alpha_composite(mark_img, (0, mark_y - top))
lock.alpha_composite(word_img, (mark_img.width + gap, word_y - top))


def reversed_lockup(img: Image.Image) -> Image.Image:
    a = np.asarray(img).astype(np.float64)
    blue = is_blue(a) & (a[..., 3] > 0)
    a[blue, 0:3] = 255.0
    return to_img(a)


lock_rev = reversed_lockup(lock)
sizes = {}
for w in (320, 640, 960):
    h = round(lock_h * w / lock_w)
    save_quant(lock.resize((w, h), Image.LANCZOS), OUT / f"logo-h-{w}.png")
    save_quant(lock_rev.resize((w, h), Image.LANCZOS), OUT / f"logo-h-rev-{w}.png")
    sizes[w] = h

# ---------- stacked logo, 600 wide ----------
sx0, sy0 = min(mx0, wx0), my0
sx1, sy1 = max(mx1, wx1), wy1
stacked = to_img(rgba[sy0:sy1, sx0:sx1])
st_h = round(stacked.height * 600 / stacked.width)
stacked600 = stacked.resize((600, st_h), Image.LANCZOS)
save_quant(stacked600, OUT / "logo-stacked-600.png")

# ---------- favicon: tooth and swoosh only ----------
# The stars are small separate gold shapes and vanish below a pixel at 16 px, so every gold component
# smaller than a tenth of the largest one (the swoosh) is dropped. The tooth turns white on a navy tile.
m_alpha = mark[..., 3] > 60
gold = m_alpha & ~is_blue(mark)
labels, n = ndimage.label(gold)
areas = ndimage.sum(gold, labels, range(1, n + 1))
keep_gold = np.isin(labels, [i + 1 for i, ar in enumerate(areas) if ar >= areas.max() * 0.1])
star_count = int(sum(1 for ar in areas if ar < areas.max() * 0.1 and ar > 30))
icon = mark.copy()
drop = gold & ~keep_gold
# anti-aliased star edges are part of no component above the alpha cut, so clear their neighbourhood
drop = ndimage.binary_dilation(drop, iterations=3) & ~ndimage.binary_dilation(keep_gold, iterations=1) & ~ndimage.binary_dilation(is_blue(mark) & m_alpha, iterations=1)
icon[drop, 3] = 0
blue_px = is_blue(icon) & (icon[..., 3] > 0)
icon[blue_px, 0:3] = 255.0
ix0, iy0, ix1, iy1 = bbox(icon[..., 3] > 60, pad=0)
icon_img = to_img(icon[iy0:iy1, ix0:ix1])
side = max(icon_img.size)
sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
sq.alpha_composite(icon_img, ((side - icon_img.width) // 2, (side - icon_img.height) // 2))


def tile(size: int, rounded: bool, inset: float = 0.16) -> Image.Image:
    t = Image.new("RGBA", (size, size), NAVY_TILE + (255,))
    inner = round(size * (1 - 2 * inset))
    glyph = sq.resize((inner, inner), Image.LANCZOS)
    t.alpha_composite(glyph, ((size - inner) // 2, (size - inner) // 2))
    if rounded:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * 0.22), fill=255)
        t.putalpha(mask)
    return t


tile(32, True, inset=0.1).save(OUT / "favicon-32.png", optimize=True)
tile(192, True).save(OUT / "icon-192.png", optimize=True)
tile(512, True).save(OUT / "icon-512.png", optimize=True)
tile(180, False).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
tile(48, True, inset=0.1).save(OUT / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

# ---------- share card ----------
card = Image.new("RGBA", (1200, 630), ICE + (255,))
logo_w = 460
logo_h = round(stacked.height * logo_w / stacked.width)
card.alpha_composite(stacked.resize((logo_w, logo_h), Image.LANCZOS), ((1200 - logo_w) // 2, (630 - logo_h) // 2 - 18))
d = ImageDraw.Draw(card)
rule_y = (630 + logo_h) // 2 + 22
d.rectangle(((1200 - 120) // 2, rule_y, (1200 + 120) // 2, rule_y + 2), fill=GOLD + (255,))
card.convert("RGB").save(OUT / "og-card-1200.png", optimize=True)

meta = {
    "source": "originals/brand/european-dental-logo.jpeg",
    "markBox": [int(mx0), int(my0), int(mx1), int(my1)],
    "wordBox": [int(wx0), int(wy0), int(wx1), int(wy1)],
    "capTop": int(cap_top), "baseline": int(baseline),
    "lockup": {"w": lock_w, "h": lock_h, "ratio": round(lock_w / lock_h, 4), "heights": sizes},
    "stacked600": {"w": 600, "h": st_h},
    "starsDroppedFromIcon": star_count,
}
(OUT / "brand.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps(meta, indent=2))
for p in sorted(OUT.glob("*")):
    print(f"{p.relative_to(ROOT).as_posix():40} {p.stat().st_size:>8} B")
