"""European Dental web fonts: Marcellus for headings, Mulish for text, licences, metric-matched fallbacks.

usage:
  python _tools/fonts.py            download whatever is missing, then build
  python _tools/fonts.py --refresh  download every source again first

Which faces, and why:
  Marcellus   the heading face. Of four OFL serifs rendered beside the logo's wordmark (Marcellus, Gilda
              Display, Libre Caslon Display, Cormorant Garamond) it is the one with the same low-contrast,
              flared, humanist letters. One weight only.
  Mulish      the text face, variable, limited here to 400..700.

Licensing:
  Marcellus's OFL text reads 'with Reserved Font Names "Marcellus"'. A subset deletes glyphs, which makes
  a Modified Version, and a Modified Version may not carry a Reserved Font Name. So Marcellus is NOT
  subset: its TTF is only re-packed as WOFF2, every table and glyph kept, which the OFL FAQ treats as a
  format change of unchanged font data. The script fails if an OFL it reads names a reserved name for a
  face it is about to subset.
  Mulish's OFL names no Reserved Font Name, so it is subset to the characters the site's three languages
  use. En and em dashes are left out of the subset (house rule: none in shipped text).

Fallback faces: size-adjust is the ratio of average advance widths over GERMAN text, because German is
served at the root and runs longest (letter frequencies below, plus one space per 6.0 letters). ascent
and descent overrides are the web font's hhea values over unitsPerEm, divided by size-adjust.

Writes assets/fonts/*.woff2, assets/fonts/LICENSES/*.txt, assets/css/fonts.css.
"""
import argparse
import re
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "_tools" / "fonts-src"
OUT = ROOT / "assets" / "fonts"
LICENSES = OUT / "LICENSES"
CSS = ROOT / "assets" / "css" / "fonts.css"
SYSTEM_FONTS = Path("C:/Windows/Fonts")
GF = "https://raw.githubusercontent.com/google/fonts/main/ofl"
SOURCES = {
    "Marcellus-Regular.ttf": f"{GF}/marcellus/Marcellus-Regular.ttf",
    "Marcellus-OFL.txt": f"{GF}/marcellus/OFL.txt",
    "Mulish-VF.ttf": f"{GF}/mulish/Mulish%5Bwght%5D.ttf",
    "Mulish-OFL.txt": f"{GF}/mulish/OFL.txt",
}


def _codepoints(*spans):
    out = []
    for span in spans:
        lo, hi = span if isinstance(span, tuple) else (span, span)
        out.extend(range(lo, hi + 1))
    return sorted(set(out))


# Basic Latin, Latin-1 (German umlauts and sharp s, Italian accents, the e with diaeresis of Durres),
# OE ligatures, typographic quotes, ellipsis, bullet, euro, arrows used by icons in text.
UNICODES = _codepoints((0x20, 0x7E), (0xA0, 0xFF), (0x152, 0x153), (0x2018, 0x201E), 0x2022, 0x2026,
                       (0x2039, 0x203A), 0x20AC, 0x2122, 0x2212)
FORBIDDEN = (0x2013, 0x2014)
REQUIRED = tuple(ord(c) for c in "äöüÄÖÜßàèéìòùÈÉëç€")

# German letter frequencies in percent (letters as written, umlauts and sharp s separately)
LETTER_FREQ = {
    "e": 16.40, "n": 9.78, "s": 7.27, "r": 7.00, "i": 6.55, "a": 6.51, "t": 6.15, "d": 5.08, "h": 4.76,
    "u": 4.35, "l": 3.44, "c": 3.06, "g": 3.01, "m": 2.53, "o": 2.51, "b": 1.89, "w": 1.89, "f": 1.66,
    "k": 1.21, "z": 1.13, "v": 0.85, "p": 0.79, "ü": 0.65, "ä": 0.54, "ß": 0.31, "ö": 0.30, "j": 0.27,
    "y": 0.04, "x": 0.03, "q": 0.02,
}
AVG_WORD_LEN = 6.0
SAMPLE = dict(LETTER_FREQ, **{" ": sum(LETTER_FREQ.values()) / AVG_WORD_LEN})

# (output, source, how, CSS family, CSS weight or range, OFL file)
FACES = (
    ("marcellus-400.woff2", "Marcellus-Regular.ttf", "repack", "Marcellus", "400", "Marcellus-OFL.txt"),
    ("mulish-var.woff2", "Mulish-VF.ttf", "subset-vf", "Mulish", "400 700", "Mulish-OFL.txt"),
)
FALLBACKS = (
    ("Marcellus Fallback", "Marcellus-Regular.ttf", "georgia.ttf", ("Georgia",)),
    ("Mulish Fallback", "Mulish-VF.ttf", "arial.ttf", ("Arial",)),
)


def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": "european-dental-fonts/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def fetch(refresh):
    SRC.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        dst = SRC / name
        if dst.exists() and dst.stat().st_size > 0 and not refresh:
            continue
        data = download(url)
        if name.endswith(".ttf") and int.from_bytes(data[:4], "big") != 0x00010000:
            sys.exit(f"{name}: not a TrueType file ({len(data)} B from {url})")
        dst.write_bytes(data)
        print(f"downloaded {name}  {len(data)} B")


def reserved_names(ofl_text):
    # only the copyright line's "with Reserved Font Name(s) ...", never the licence's own definition of the term
    m = re.search(r"with Reserved Font Names?\s*[\"'“]?([^\"'”.\n]+)", ofl_text)
    return m.group(1).strip() if m else ""


def repack(src, dst):
    """TTF to WOFF2 with every table and glyph kept: a format change, not a Modified Version."""
    with TTFont(src) as f:
        f.flavor = "woff2"
        f.save(str(dst))


def subset_vf(src, dst):
    tmp = dst.with_name(dst.stem + "-limited.ttf")
    with TTFont(src) as vf:
        limited = instancer.instantiateVariableFont(vf, {"wght": (400, 700)}, inplace=False)
        limited.save(str(tmp))
    try:
        opt = subset.Options()
        opt.flavor = "woff2"
        opt.layout_features = ["kern", "liga", "calt", "tnum", "lnum", "case"]
        opt.hinting = False
        opt.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        opt.drop_tables = list(opt.drop_tables) + ["meta", "DSIG"]
        font = subset.load_font(str(tmp), opt)
        try:
            sub = subset.Subsetter(opt)
            sub.populate(unicodes=UNICODES)
            sub.subset(font)
            subset.save_font(font, str(dst), opt)
        finally:
            font.close()
    finally:
        tmp.unlink(missing_ok=True)


def avg_advance(font, sample):
    upem = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    total = sum(sample.values())
    return sum(w * hmtx[cmap[ord(ch)]][0] for ch, w in sample.items()) / total / upem


def fallback_metrics(web_path, local_path):
    with TTFont(web_path) as web, TTFont(local_path) as loc:
        size_adjust = avg_advance(web, SAMPLE) / avg_advance(loc, SAMPLE)
        upem = web["head"].unitsPerEm
        hhea = web["hhea"]
        return {"size_adjust": size_adjust, "ascent": hhea.ascent / upem / size_adjust,
                "descent": abs(hhea.descent) / upem / size_adjust}


def pct(v):
    return f"{v * 100:.2f}%"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    fetch(args.refresh)
    OUT.mkdir(parents=True, exist_ok=True)
    LICENSES.mkdir(parents=True, exist_ok=True)
    problems = []
    blocks = ["/* Generated by _tools/fonts.py. Edit that script, not this file. */"]
    for out, src, how, family, weight, ofl in FACES:
        ofl_text = (SRC / ofl).read_text(encoding="utf-8")
        rfn = reserved_names(ofl_text)
        if how.startswith("subset") and rfn:
            problems.append(f"{family}: its OFL reserves the name {rfn}, so it may not be subset")
            continue
        (LICENSES / f"{family.replace(' ', '')}-OFL.txt").write_text(ofl_text, encoding="utf-8", newline="\n")
        dst = OUT / out
        if how == "repack":
            repack(SRC / src, dst)
        else:
            subset_vf(SRC / src, dst)
        with TTFont(dst) as f:
            cmap = f.getBestCmap()
            missing = [chr(c) for c in REQUIRED if c not in cmap]
            if missing:
                problems.append(f"{out}: lacks {''.join(missing)}")
            if how != "repack":
                present = [f"U+{c:04X}" for c in FORBIDDEN if c in cmap]
                if present:
                    problems.append(f"{out}: the subset still carries {', '.join(present)}")
        print(f"{out:22s} {dst.stat().st_size:>7} B  {how}{'  (reserved name: ' + rfn + ')' if rfn else ''}")
        blocks.append("\n".join((
            "@font-face {", f'  font-family: "{family}";', f'  src: url("/assets/fonts/{out}") format("woff2");',
            f"  font-weight: {weight};", "  font-style: normal;", "  font-display: swap;", "}")))
    for family, web, local, names in FALLBACKS:
        m = fallback_metrics(SRC / web, SYSTEM_FONTS / local)
        blocks.append("\n".join((
            "@font-face {", f'  font-family: "{family}";', "  src: " + ", ".join(f'local("{n}")' for n in names) + ";",
            f"  size-adjust: {pct(m['size_adjust'])};", f"  ascent-override: {pct(m['ascent'])};",
            f"  descent-override: {pct(m['descent'])};", "  line-gap-override: 0%;", "}")))
        print(f"{family:20s} vs {local:11s} size-adjust {pct(m['size_adjust'])}  ascent {pct(m['ascent'])}  descent {pct(m['descent'])}")
    if problems:
        for p in problems:
            print(f"FAIL  {p}")
        sys.exit(1)
    CSS.parent.mkdir(parents=True, exist_ok=True)
    CSS.write_text("\n\n".join(blocks) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {CSS.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
