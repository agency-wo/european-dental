"""WCAG 2.x contrast gate for the European Dental colour tokens.

The tokens are read from the top-level :root block of assets/css/styles.css on every run, so a changed hex
value is measured rather than remembered. Hex tokens only; an rgba() token is measured through
COMPOSITES: text over a photograph is guaranteed only by the scrim in front of it, so the scrim is
composited over white (the lightest a photograph can be), compared with the hex token that records the
result, and that token is then gated like any other.

The palette came with a suggested gold button with white text. It measures 2.57:1 and is not used;
the pairs below are the ones the site actually paints.

usage: python _tools/contrast.py        exit 1 if any pair is below its minimum
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "assets" / "css" / "styles.css"

# (foreground, background, minimum, where). 4.5 is WCAG 1.4.3 for text; 3.0 is 1.4.11 for UI boundaries
# and for graphics that carry meaning.
PAIRS = [
    ("c-ink", "c-white", 4.5, "body text"),
    ("c-ink", "c-ice", 4.5, "body text on ice sections"),
    ("c-ink", "c-ivory", 4.5, "body text on ivory sections"),
    ("c-navy", "c-white", 4.5, "headings, navigation, labels"),
    ("c-navy", "c-ice", 4.5, "headings on ice sections"),
    ("c-navy", "c-ivory", 4.5, "headings on ivory sections"),
    ("c-blue", "c-white", 4.5, "links and outline buttons"),
    ("c-blue", "c-ice", 4.5, "links on ice sections"),
    ("c-slate-text", "c-white", 4.5, "secondary text, leads, placeholders"),
    ("c-slate-text", "c-ice", 4.5, "secondary text on ice sections and cards"),
    ("c-slate-text", "c-ivory", 4.5, "secondary text on ivory sections"),
    ("c-white", "c-blue", 4.5, "primary button"),
    ("c-white", "c-navy", 4.5, "primary button on hover, text in the footer and on navy bands"),
    ("c-navy", "c-gold", 4.5, "the gold button: navy text, never white"),
    ("c-navy", "c-champagne", 4.5, "the gold button on hover"),
    ("c-champagne", "c-navy", 4.5, "footer headings"),
    ("c-on-navy-soft", "c-navy", 4.5, "secondary text in the footer"),
    ("c-gold", "c-navy", 3.0, "gold icons and social links on navy (graphics)"),
    ("c-field", "c-white", 3.0, "form field borders (UI boundary)"),
    ("c-blue", "c-white", 3.0, "the selected gallery thumbnail outline and focus rings (UI boundary)"),
    ("c-error", "c-white", 4.5, "field errors"),
    ("c-error", "c-error-bg", 4.5, "the form's error banner"),
    ("c-ok-fg", "c-ok-bg", 4.5, "the form's success panel"),
    ("c-todo-fg", "c-todo-bg", 4.5, "visible TODO placeholders and the draft note"),
    ("c-white", "scrim-worst", 4.5, "every word over a photograph: statement, H1 line, lead, contact details"),
    ("c-on-navy-soft", "scrim-worst", 4.5, "labels in the contact hero over the photograph"),
    ("c-white", "control-bg-worst", 4.5, "slider controls over the photograph"),
    ("c-on-navy-soft", "lightbox-bg-worst", 4.5, "the lightbox counter and caption"),
    # focus rings: WCAG 1.4.11 asks 3:1 of an indicator against what it sits on
    ("c-blue", "c-white", 3.0, "focus ring on light surfaces"),
    ("c-blue", "c-ice", 3.0, "focus ring on ice sections"),
    ("c-white", "control-bg-worst", 3.0, "focus ring on the slider controls"),
    ("c-white", "lightbox-bg-worst", 3.0, "focus ring inside the lightbox"),
    ("c-white", "c-navy", 3.0, "focus ring in the footer"),
    ("c-white", "scrim-worst", 3.0, "focus ring on the statement band and the contact hero"),
    ("c-navy", "c-white", 3.0, "focus ring on a gallery thumbnail"),
]
# (rgba token, the hex token it sits over, the hex token recording the result, where)
COMPOSITES = [
    ("scrim", "c-white", "scrim-worst", "the navy scrim over the lightest a photograph can be"),
    ("control-bg", "c-white", "control-bg-worst", "the slider control pill over the lightest a photograph can be"),
    ("lightbox-bg", "c-white", "lightbox-bg-worst", "the lightbox backdrop over the lightest page behind it"),
]
# What the palette must NOT be used for; each pair is asserted to FAIL, so a note in the stylesheet that
# says "gold is decoration only" stays true only while the numbers say so.
MUST_FAIL = [
    ("c-white", "c-gold", 4.5, "white text on the gold button, as the palette brief suggested"),
    ("c-gold", "c-white", 4.5, "gold text on white"),
    ("c-slate", "c-ice", 4.5, "the brief's slate on ice, which is why --c-slate-text exists"),
    ("c-line", "c-white", 3.0, "the decorative line as a field border"),
    ("c-blue", "control-bg-worst", 3.0, "the blue focus ring on the slider controls, which is why rings turn white on dark surfaces"),
]

HEX_RE = re.compile(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})")
RGBA_RE = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)")


def root_blocks(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    blocks, depth, selector_start, selector, body_start = [], 0, 0, "", 0
    for i, ch in enumerate(css):
        if ch == "{":
            if depth == 0:
                selector, body_start = css[selector_start:i].strip(), i + 1
            depth += 1
        elif ch == "}":
            depth = max(0, depth - 1)
            if depth == 0:
                if selector == ":root":
                    blocks.append(css[body_start:i])
                selector_start = i + 1
        elif ch == ";" and depth == 0:
            selector_start = i + 1
    return blocks


def tokens_of(blocks):
    hexes, other = {}, {}
    for body in blocks:
        for m in re.finditer(r"--([A-Za-z0-9_-]+)\s*:\s*([^;]+)", body):
            name, value = m.group(1), m.group(2).strip()
            hx = HEX_RE.fullmatch(value)
            if hx:
                h = hx.group(1)
                h = "".join(c * 2 for c in h) if len(h) == 3 else h
                hexes[name] = "#" + h.upper()
                other.pop(name, None)
            else:
                other[name] = value
                hexes.pop(name, None)
    return hexes, other


def channel(c8):
    c = c8 / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hexc):
    h = hexc.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def ratio(fg, bg):
    a, b = luminance(fg), luminance(bg)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def composite(rgba_text, bg_hex):
    m = RGBA_RE.fullmatch(rgba_text.strip())
    if not m:
        return None
    r, g, b = (int(m.group(i)) for i in (1, 2, 3))
    a = float(m.group(4)) if m.group(4) is not None else 1.0
    h = bg_hex.lstrip("#")
    br, bg_, bb = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return "#%02X%02X%02X" % tuple(int(a * c + (1 - a) * d + 0.5) for c, d in ((r, br), (g, bg_), (b, bb)))


def main():
    blocks = root_blocks(CSS.read_text(encoding="utf-8"))
    if not blocks:
        print("contrast: no top-level :root block in assets/css/styles.css")
        return 1
    tokens, other = tokens_of(blocks)
    print(f"contrast: {len(tokens)} hex tokens, {len(other)} other, from assets/css/styles.css")
    bad = 0
    for over, bg, recorded, where in COMPOSITES:
        got = composite(other.get(over, ""), tokens.get(bg, "#000000")) if over in other else None
        if got is None or recorded not in tokens:
            bad += 1
            print(f"FAIL     composite  --{over} over --{bg}: token missing or not rgba()  ({where})")
        elif got != tokens[recorded]:
            bad += 1
            print(f"FAIL     composite  --{over} over --{bg} is {got}, but --{recorded} records {tokens[recorded]}  ({where})")
        else:
            print(f"PASS     composite  --{over} over --{bg} is {got} = --{recorded}  ({where})")
    for fg, bg, need, where in PAIRS:
        if fg not in tokens or bg not in tokens:
            bad += 1
            print(f"FAIL     n/a  --{fg} on --{bg}: token not found  ({where})")
            continue
        r = ratio(tokens[fg], tokens[bg])
        ok = r >= need
        bad += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {r:6.2f}:1  min {need}  --{fg} on --{bg}  ({where})")
    for fg, bg, need, where in MUST_FAIL:
        r = ratio(tokens[fg], tokens[bg]) if fg in tokens and bg in tokens else 99
        ok = r < need
        bad += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {r:6.2f}:1  must stay under {need}, so never used: {where}")
    print("\nCONTRAST PASS" if not bad else f"\nCONTRAST FAIL: {bad} check(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
