"""European Dental site gate. Read-only; stdlib only.

Pages come from _build/manifest.json (written by the build), never from path shapes, because every
language has its own words in its URLs. Each check is numbered and prints PASS or FAIL with the reason.

  1  every page parses, has one <title> of 20-65 characters and one description of 70-170
  2  titles are unique within a language
  3  exactly one <h1>, and headings never skip a level downwards
  4  language declarations: <html lang>, og:locale and every JSON-LD inLanguage are the page's language
  5  hreflang: a page offers every language that publishes it plus x-default, each resolving to a page
  6  the language switcher points at the same page in the other languages
  7  every internal link, script, stylesheet, image and srcset entry resolves to a file in site/
  8  ids are unique and every IDREF (for, aria-*, same-page #href) resolves
  9  every <img> has width, height and an alt attribute; decorative ones are alt=""
 10  CSP: no inline style attributes, no on* handlers, no inline script except JSON-LD,
     no iframe; the hash in _headers matches the flag actually on the page
 11  no third-party request: scripts, styles, fonts and images are same-origin
 12  structured data parses; the business node is an Organization; no Review or AggregateRating anywhere;
     no telephone, email or address in it while those are TODO
 13  a preview is noindex three ways (meta robots, robots.txt, X-Robots-Tag) and the sitemap lists pages
 14  site/ holds nothing the build or the image pipeline did not claim; Cloudflare limits (25 MiB a file,
     fewer than 20,000 files)
 15  wrangler guard: .wrangler/ ignored and never tracked, wrangler.jsonc names european-dental and ./site with no main,
     and no wrangler dependency in _tools/package.json
 16  no sentence from one language's copy appears on another language's page
 17  every page loads main.js and motion.css; pages with a form load forms.js; home loads slider.js and
     gallery.js; no page loads render.js
 18  motion lint: keyframes animate only transform, opacity and stroke-dashoffset; no transition of `all`
     or a layout property; @view-transition and animation-timeline only inside no-preference

usage: python _tools/verify.py        exit 1 on any failure
"""
import base64
import hashlib
import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
failures = []
passes = []


def fail(n, msg):
    failures.append((n, msg))


def ok(n, msg):
    passes.append((n, msg))


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags = []          # (tag, attrs dict, line)
        self.stack = []
        self.text_parts = []
        self.in_title = False
        self.title = []
        self.scripts = []       # (attrs, body)
        self._script = None
        self.headings = []      # (level, text)
        self._h = None

    def handle_starttag(self, tag, attrs):
        a = {k: (v if v is not None else "") for k, v in attrs}
        self.tags.append((tag, a, self.getpos()[0]))
        if tag == "title":
            self.in_title = True
        if tag == "script":
            self._script = [a, []]
        if re.fullmatch(r"h[1-6]", tag):
            self._h = [int(tag[1]), []]

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag == "script" and self._script:
            self.scripts.append((self._script[0], "".join(self._script[1])))
            self._script = None
        if self._h and tag == f"h{self._h[0]}":
            self.headings.append((self._h[0], "".join(self._h[1]).strip()))
            self._h = None

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self._script is not None:
            self._script[1].append(data)
            return
        if self._h:
            self._h[1].append(data)
        self.text_parts.append(data)

    def attr_all(self, tag, name):
        return [a.get(name) for t, a, _ in self.tags if t == tag and name in a]

    def text(self):
        return re.sub(r"\s+", " ", " ".join(self.text_parts))


def load_json(rel):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


manifest = load_json("_build/manifest.json")
site = load_json("data/site.json")
images = load_json("data/image-manifest.json")
langs = {l["code"]: l for l in site["languages"]}
todo = lambda v: isinstance(v, str) and v.startswith("TODO")

pages = {}
for p in manifest["pages"]:
    html = (SITE / p["rel"]).read_text(encoding="utf-8")
    pg = Page()
    pg.feed(html)
    pg.html = html
    pg.meta = p
    url = "/" + re.sub(r"index\.html$", "", p["rel"])
    pages[url] = pg
by_route = {}
for url, pg in pages.items():
    by_route.setdefault(pg.meta["route"], {})[pg.meta["lang"]] = url

# ---------- 1, 2 ----------
seen_titles = {}
for url, pg in pages.items():
    title = "".join(pg.title).strip()
    descs = [a.get("content", "") for t, a, _ in pg.tags if t == "meta" and a.get("name") == "description"]
    if len([t for t, _, _ in pg.tags if t == "title"]) != 1:
        fail(1, f"{url}: needs exactly one <title>")
    if not 20 <= len(title) <= 65:
        fail(1, f"{url}: title is {len(title)} characters (20 to 65): {title!r}")
    if len(descs) != 1 or not 70 <= len(descs[0]) <= 170:
        fail(1, f"{url}: needs one description of 70 to 170 characters, has {[len(d) for d in descs]}")
    key = (pg.meta["lang"], title)
    if key in seen_titles:
        fail(2, f"{url}: title repeats {seen_titles[key]}")
    seen_titles[key] = url
ok(1, f"{len(pages)} pages with a title and a description in range")

# ---------- 3 ----------
for url, pg in pages.items():
    h1 = [h for h in pg.headings if h[0] == 1]
    if len(h1) != 1:
        fail(3, f"{url}: {len(h1)} h1 elements")
    last = 0
    for level, text in pg.headings:
        if last and level > last + 1:
            fail(3, f"{url}: h{level} {text[:40]!r} follows h{last}")
        last = level

# ---------- 4, 5, 6 ----------
for url, pg in pages.items():
    lang = pg.meta["lang"]
    html_lang = [a.get("lang") for t, a, _ in pg.tags if t == "html"]
    if html_lang != [lang]:
        fail(4, f"{url}: <html lang> is {html_lang}, not {lang}")
    loc = [a.get("content") for t, a, _ in pg.tags if t == "meta" and a.get("property") == "og:locale"]
    if loc != [langs[lang]["locale"]]:
        fail(4, f"{url}: og:locale is {loc}")
    for attrs, body in pg.scripts:
        if attrs.get("type") == "application/ld+json":
            for m in re.finditer(r'"inLanguage":"([a-z]{2})"', body):
                if m.group(1) != lang:
                    fail(4, f"{url}: JSON-LD inLanguage {m.group(1)}")
    alts = {a.get("hreflang"): a.get("href") for t, a, _ in pg.tags if t == "link" and a.get("rel") == "alternate"}
    route = pg.meta["route"]
    published = by_route.get(route, {})
    if route != "notFound":
        want = set(published) | {"x-default"}
        if set(alts) != want:
            fail(5, f"{url}: hreflang {sorted(alts)} but the page is published in {sorted(published)}")
        for code, href in alts.items():
            path = href.replace(site["origin"], "")
            if path not in pages:
                fail(5, f"{url}: hreflang {code} points at {path}, which is not a built page")
        switch = [a.get("href") for t, a, _ in pg.tags if t == "a" and "hreflang" in a and a.get("lang")]
        for code, path in published.items():
            if code != lang and path not in switch:
                fail(6, f"{url}: the language switcher does not offer {path}")
    elif alts:
        fail(5, f"{url}: the 404 must not claim alternates")
ok(4, "language declarations checked")

# ---------- 7 ----------
def exists_on_site(ref):
    ref = ref.split("#")[0].split("?")[0]
    if not ref.startswith("/") or ref.startswith("//"):
        return True
    p = SITE / ref.lstrip("/")
    return p.is_file() or (p / "index.html").is_file()


for url, pg in pages.items():
    refs = []
    for t, a, line in pg.tags:
        for attr in ("href", "src"):
            if attr in a and a[attr] and not a[attr].startswith(("mailto:", "tel:", "#", "http")):
                refs.append((attr, a[attr], line))
        for attr in ("srcset", "imagesrcset"):
            if a.get(attr):
                refs += [(attr, part.strip().split(" ")[0], line) for part in a[attr].split(",")]
    for attr, ref, line in refs:
        if not exists_on_site(ref):
            fail(7, f"{url}:{line} {attr} {ref} does not resolve")

# ---------- 8 ----------
IDREF = ("for", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-details", "aria-errormessage", "form")
for url, pg in pages.items():
    ids = {}
    for t, a, line in pg.tags:
        if "id" in a:
            if a["id"] in ids:
                fail(8, f"{url}:{line} id {a['id']!r} repeats line {ids[a['id']]}")
            ids[a["id"]] = line
    for t, a, line in pg.tags:
        for attr in IDREF:
            if attr in a and not (t == "form" and attr == "form"):
                for ref in a[attr].split():
                    if ref not in ids:
                        fail(8, f"{url}:{line} {attr}={ref!r} names no element")
        href = a.get("href", "") if t == "a" else ""
        if href.startswith("#") and len(href) > 1 and href[1:] not in ids:
            fail(8, f"{url}:{line} href {href} names no element")

# ---------- 9 ----------
for url, pg in pages.items():
    for t, a, line in pg.tags:
        if t == "img":
            if "alt" not in a:
                fail(9, f"{url}:{line} <img> without alt")
            if not a.get("width") or not a.get("height"):
                fail(9, f"{url}:{line} <img> without width and height")

# ---------- 10, 11 ----------
headers = (SITE / "_headers").read_text(encoding="utf-8")
csp = re.search(r"Content-Security-Policy: (.+)", headers)
for url, pg in pages.items():
    for t, a, line in pg.tags:
        if "style" in a:
            fail(10, f"{url}:{line} inline style attribute on <{t}>")
        for k in a:
            if k.startswith("on"):
                fail(10, f"{url}:{line} inline handler {k} on <{t}>")
        if t == "iframe":
            fail(10, f"{url}:{line} iframe (frame-src is 'none')")
        if t == "style":
            fail(10, f"{url}:{line} inline <style>")
    for attrs, body in pg.scripts:
        if attrs.get("src"):
            if re.match(r"https?://", attrs["src"]):
                fail(11, f"{url}: third-party script {attrs['src']}")
            continue
        if attrs.get("type") == "application/ld+json":
            continue
        digest = base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode()
        if not csp or f"'sha256-{digest}'" not in csp.group(1):
            fail(10, f"{url}: an inline script whose hash is not in the CSP")
    for t, a, line in pg.tags:
        if t == "link" and a.get("rel") in ("stylesheet", "preload", "icon", "apple-touch-icon") and re.match(r"https?://", a.get("href", "")):
            fail(11, f"{url}:{line} third-party {a.get('rel')} {a.get('href')}")
        if t in ("img", "source") and re.match(r"https?://", a.get("src", "") or a.get("srcset", "")):
            fail(11, f"{url}:{line} third-party image")
if not csp or "frame-src 'none'" not in csp.group(1) or "style-src 'self'" not in csp.group(1):
    fail(10, "_headers: the CSP is missing or no longer refuses frames and inline styles")
if len(re.findall(r"^/\*$", headers, re.M)) != 1:
    fail(10, "_headers: security headers must sit in exactly one /* rule")

# ---------- 12 ----------
for url, pg in pages.items():
    for attrs, body in pg.scripts:
        if attrs.get("type") != "application/ld+json":
            continue
        try:
            graph = json.loads(body)["@graph"]
        except Exception as e:  # noqa: BLE001
            fail(12, f"{url}: JSON-LD does not parse: {e}")
            continue
        org = [n for n in graph if n.get("@id", "").endswith("#organization")]
        if len(org) != 1 or org[0].get("@type") != "Organization":
            fail(12, f"{url}: the business node must be one Organization")
        if re.search(r"Review|AggregateRating|Dentist|MedicalClinic|MedicalBusiness", body):
            fail(12, f"{url}: JSON-LD claims a review, a rating or a medical business")
        for field, value in (("telephone", site["phones"][0]["e164"]), ("email", site["email"]), ("address", site["address"])):
            if todo(value) and f'"{field}"' in body:
                fail(12, f"{url}: JSON-LD carries {field} while it is TODO")

# ---------- 13 ----------
robots = (SITE / "robots.txt").read_text(encoding="utf-8")
if site["env"] == "preview":
    if "Disallow: /" not in robots:
        fail(13, "robots.txt must disallow everything on a preview")
    if "X-Robots-Tag: noindex" not in headers:
        fail(13, "_headers must send X-Robots-Tag: noindex on a preview")
    for url, pg in pages.items():
        robots_meta = [a.get("content") for t, a, _ in pg.tags if t == "meta" and a.get("name") == "robots"]
        if robots_meta != ["noindex, nofollow"]:
            fail(13, f"{url}: a preview page must be noindex, nofollow (has {robots_meta})")
sitemap = (SITE / "sitemap.xml").read_text(encoding="utf-8")
want_urls = [u for u, pg in pages.items() if pg.meta["route"] != "notFound"]
for u in want_urls:
    if f"<loc>{site['origin']}{u}</loc>" not in sitemap:
        fail(13, f"sitemap.xml does not list {u}")

# ---------- 14 ----------
claimed = set(manifest["files"])
claimed |= {f"assets/img/{m['slug']}-{w}.{x}" for m in images["images"] for w in m["widths"] for x in m["formats"]}
on_disk = [p for p in SITE.rglob("*") if p.is_file()]
for p in on_disk:
    rel = p.relative_to(SITE).as_posix()
    if rel not in claimed:
        fail(14, f"site/{rel} is claimed by neither the build nor the image pipeline, and would be published")
    if p.stat().st_size > 25 * 1024 * 1024:
        fail(14, f"site/{rel} is over Cloudflare's 25 MiB per-file limit")
if len(on_disk) >= 20000:
    fail(14, f"site/ has {len(on_disk)} files; Cloudflare allows fewer than 20,000")

# ---------- 15 ----------
# wrangler deploys from a machine logged into the hosting account (check `wrangler whoami` first); its
# .wrangler/ folder is a local cache and must never be published
if ".wrangler/" not in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines():
    fail(15, ".gitignore must ignore .wrangler/, wrangler's local cache")
try:
    tracked = subprocess.run(["git", "ls-files", ".wrangler"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if tracked:
        fail(15, ".wrangler/ is tracked by git; it is wrangler's local cache and must never be committed")
except FileNotFoundError:
    pass
wj = (ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
wj_clean = json.loads(re.sub(r"^\s*//.*$", "", wj, flags=re.M))
if wj_clean.get("name") != "european-dental" or wj_clean.get("assets", {}).get("directory") != "./site" or "main" in wj_clean:
    fail(15, "wrangler.jsonc must name european-dental, serve ./site and have no main")
pkg = load_json("_tools/package.json")
if any("wrangler" in k for k in {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}):
    fail(15, "_tools/package.json must not depend on wrangler")

# ---------- 16 ----------
def strings(obj, out):
    if isinstance(obj, str):
        if len(obj) >= 28 and "{" not in obj and not obj.startswith("TODO"):
            out.add(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            strings(v, out)
    elif isinstance(obj, list):
        for v in obj:
            strings(v, out)
    return out


copy = {}
for code in langs:
    s = set()
    for f in sorted((ROOT / "content" / code / "pages").glob("*.json")):
        strings(json.loads(f.read_text(encoding="utf-8")), s)
    strings(json.loads((ROOT / "i18n" / f"{code}.json").read_text(encoding="utf-8")), s)
    copy[code] = s
for url, pg in pages.items():
    lang = pg.meta["lang"]
    text = pg.text()
    for other, s in copy.items():
        if other == lang:
            continue
        for sentence in s - copy[lang]:
            if sentence in text:
                if pg.meta["route"] == "notFound" and pg.html.count(f'lang="{other}"'):
                    continue  # the root 404 carries one line in each other language, marked with its lang
                fail(16, f"{url} ({lang}) shows {other} copy: {sentence[:60]!r}")

# ---------- 17 ----------
for url, pg in pages.items():
    srcs = [a.get("src", "") for t, a, _ in pg.tags if t == "script"]
    if not any("/assets/js/main.js" in s for s in srcs):
        fail(17, f"{url}: does not load main.js")
    # the html.js flag must run before the first paint: a plain script in the head, never deferred
    flag = [a for t, a, _ in pg.tags if t == "script" and "/assets/js/flag.js" in a.get("src", "")]
    if len(flag) != 1 or "defer" in flag[0] or "async" in flag[0] or pg.html.find("/assets/js/flag.js") > pg.html.find("</head>"):
        fail(17, f"{url}: must load flag.js once, in the head, without defer or async")
    has_form = any(t == "form" for t, _, _ in pg.tags)
    if has_form != any("/assets/js/forms.js" in s for s in srcs):
        fail(17, f"{url}: forms.js must be loaded exactly when the page has a form")
    if any("render.js" in s for s in srcs):
        fail(17, f"{url}: loads render.js, which is build-time only")

for url, pg in pages.items():
    hrefs = [a.get("href", "") for t, a, _ in pg.tags if t == "link" and a.get("rel") == "stylesheet"]
    if not any("/assets/css/motion.css" in h for h in hrefs):
        fail(17, f"{url}: does not load motion.css")
    if pg.meta["route"] == "home":
        srcs = [a.get("src", "") for t, a, _ in pg.tags if t == "script"]
        for need in ("/assets/js/slider.js", "/assets/js/gallery.js"):
            if not any(need in s for s in srcs):
                fail(17, f"{url}: the home page must load {need}")

# ---------- 18: motion lint ----------
# Only transform, opacity and stroke-dashoffset may be animated by keyframes; no transition may name `all`
# or a property that triggers layout; @view-transition and animation-timeline live only inside a
# prefers-reduced-motion: no-preference block; a reduce block exists somewhere.
ANIMATABLE = {"transform", "opacity", "stroke-dashoffset"}
LAYOUT = re.compile(r"\b(all|width|height|top|left|right|bottom|margin[\w-]*|padding[\w-]*|inset)\b")


def blocks_with_context(css):
    """(at-rule stack, body) for every innermost rule body, comments removed."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out, stack, start = [], [], 0
    for i, ch in enumerate(css):
        if ch == "{":
            stack.append((css[start:i].strip(), i + 1))
            start = i + 1
        elif ch == "}":
            if stack:
                sel, body_start = stack.pop()
                out.append(([s for s, _ in stack] + [sel], css[body_start:i]))
            start = i + 1
        elif ch == ";" and not stack:
            start = i + 1
    return out


reduce_seen = False
for sheet in sorted((ROOT / "assets" / "css").glob("*.css")):
    rel = sheet.relative_to(ROOT).as_posix()
    css = sheet.read_text(encoding="utf-8")
    if "prefers-reduced-motion: reduce" in css:
        reduce_seen = True
    for ctx_stack, body in blocks_with_context(css):
        joined = " ".join(ctx_stack)
        in_no_pref = "prefers-reduced-motion: no-preference" in joined
        head = ctx_stack[-1] if ctx_stack else ""
        # keyframe steps: the enclosing rule is @keyframes
        if len(ctx_stack) >= 2 and ctx_stack[-2].startswith("@keyframes"):
            for prop in re.findall(r"([a-z-]+)\s*:", body):
                if prop not in ANIMATABLE:
                    fail(18, f"{rel}: {ctx_stack[-2]} animates {prop}; only {', '.join(sorted(ANIMATABLE))} may animate")
        for m in re.finditer(r"(?<![\w-])transition(?:-property)?\s*:\s*([^;]+)", body):
            for part in m.group(1).split(","):
                name = part.strip().split(" ")[0]
                if LAYOUT.fullmatch(name):
                    fail(18, f"{rel}: '{head[:60]}' transitions {name}, which is layout or everything")
        if re.search(r"animation-timeline\s*:", body) and not in_no_pref:
            fail(18, f"{rel}: animation-timeline outside prefers-reduced-motion: no-preference ('{head[:60]}')")
    for m in re.finditer(r"@view-transition", css):
        before = css[:m.start()]
        # the @view-transition must sit inside an open no-preference block
        opened = before.rfind("prefers-reduced-motion: no-preference")
        if opened < 0 or before[opened:].count("{") <= before[opened:].count("}"):
            fail(18, f"{rel}: @view-transition outside prefers-reduced-motion: no-preference")
if not reduce_seen:
    fail(18, "no stylesheet has a prefers-reduced-motion: reduce block")

# ---------- report ----------
checks = 18
failed = sorted({n for n, _ in failures})
for n, msg in failures:
    print(f"FAIL  {n:2d}  {msg}")
print(f"\nverify: {len(pages)} pages, {checks} checks, {checks - len(failed)} passed" + (f", failed: {', '.join(map(str, failed))}" if failed else ""))
sys.exit(1 if failures else 0)
