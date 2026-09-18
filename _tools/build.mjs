#!/usr/bin/env node
/* European Dental generator. Node, no dependencies.

   Renders every page of every language from data/*.json, i18n/<lang>.json and content/<lang>/pages/*.json
   into site/, the only folder Cloudflare serves, and copies the shipped assets (css, js, fonts, brand)
   beside them. site/assets/img/ belongs to _tools/process-images.mjs and is never touched here.

   usage:
     node _tools/build.mjs            write every file that changed, delete stale ones
     node _tools/build.mjs --check    render in memory; exit 1 if any file would change or a stale file exists
     node _tools/build.mjs --strict   also fail on warnings (title and description lengths, missing renditions)
     node _tools/build.mjs --dry-lang xx   render i18n/xx.json + content/xx/ into _build/xx-dry/ (i18n-dry.mjs)

   ONE PROCESS BUILDS EVERY LANGUAGE: the stale sweep deletes whatever this
   run did not write, so a run that knew about one language would delete the others.

   --check needs nothing that is not committed: no node_modules, no _build/. Cloudflare's deploy command
   runs it before every deploy, so a push whose site/ is out of date with its sources fails to deploy and
   the previous version stays live.

   Every date on a page comes from the data, so a rebuild of unchanged sources is byte-identical. The one
   clock reading is data/page-dates.json, the ledger of when each page last changed, for the sitemap. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import { createWriter } from "./lib/write.mjs";
import { checkLanguages, checkCopy, proveFixtureFails, proveCopyFixtureFails } from "./lib/i18n.mjs";
import { createRoutes } from "./lib/routes.mjs";
import { validateSite, validateImages } from "./lib/schema.mjs";
import { createImages } from "./lib/picture.mjs";
import * as pages from "./templates/pages.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const CHECK = process.argv.includes("--check");
const STRICT = process.argv.includes("--strict");
const DRY_LANG = (() => {
  const i = process.argv.indexOf("--dry-lang");
  return i > -1 ? String(process.argv[i + 1] || "").trim() : "";
})();
if (DRY_LANG && !/^[a-z]{2}$/.test(DRY_LANG)) { console.error("FAIL  --dry-lang takes a two letter code"); process.exit(1); }

const abs = (rel) => path.join(ROOT, rel);
const readJson = (rel) => JSON.parse(readFileSync(abs(rel), "utf8"));
const problems = [];
const warnings = [];
const soft = (msg) => (STRICT ? problems : warnings).push(msg);

/* ---------- load ---------- */
const site = readJson("data/site.json");
const routesData = readJson("data/routes.json");
const catalogue = readJson("data/images.json");
const manifest = existsSync(abs("data/image-manifest.json")) ? readJson("data/image-manifest.json") : null;
if (!manifest) soft("data/image-manifest.json does not exist yet: run node _tools/process-images.mjs");
const credits = readJson("data/credits.json");
const testimonials = existsSync(abs("data/testimonials.json")) ? readJson("data/testimonials.json") : { quotes: [] };
const brand = JSON.parse(readFileSync(abs("assets/brand/brand.json"), "utf8"));

/* ---------- languages and routes ---------- */
const LANGS = DRY_LANG
  ? [{ code: DRY_LANG, locale: `${DRY_LANG}_${DRY_LANG.toUpperCase()}`, prefix: "", name: DRY_LANG, complete: false }]
  : site.languages;
const DEFAULT_LANG = LANGS.find((l) => (l.prefix || "") === "") || LANGS[0];
const routesFor = (() => {
  if (!DRY_LANG) return routesData;
  const src = (site.languages.find((l) => (l.prefix || "") === "") || { code: "en" }).code;
  const one = (byLang) => (byLang[src] ? { [DRY_LANG]: byLang[src] } : null);
  return { routes: Object.fromEntries(Object.entries(routesData.routes).map(([id, b]) => [id, one(b)]).filter(([, b]) => b)), slugs: {} };
})();
const routes = createRoutes(routesFor, LANGS);
problems.push(...routes.problems);

/* The copy file for a language, and the English one when it has none. A fallback is recorded, never
   swallowed, and a language marked complete may have none (the check is below). */
const COPY_FILES = ["home", "services", "dental", "aesthetic", "hair", "contact", "privacy", "imprint", "notfound", "media"];
const langPath = (lang, rel) => (lang === "en" ? rel
  : rel.replace(/^i18n\/en\.json$/, `i18n/${lang}.json`).replace(/^content\/en\//, `content/${lang}/`));
const fellBack = new Map();
function readLang(lang, rel) {
  const p = langPath(lang, rel);
  if (existsSync(abs(p))) return readJson(p);
  if (!fellBack.has(lang)) fellBack.set(lang, []);
  if (!fellBack.get(lang).includes(rel)) fellBack.get(lang).push(rel);
  return readJson(rel);
}
function loadCopy(lang) {
  const c = { ui: readLang(lang, "i18n/en.json") };
  for (const f of COPY_FILES) c[f] = readLang(lang, `content/en/pages/${f}.json`);
  return c;
}

/* ---------- validate the data, once ---------- */
problems.push(...validateSite(site));
const VARIANT_NAMES = ["hero", "hero-m", "wide", "bg", "banner", "card", "thumb", "full"];
problems.push(...validateImages(catalogue, VARIANT_NAMES));
for (const r of checkLanguages(ROOT, LANGS)) for (const p of r.problems) problems.push(`i18n ${r.lang}: ${p}`);
const fixture = proveFixtureFails(ROOT);
if (!fixture.ok) problems.push(`i18n parity check: ${fixture.detail}`);
for (const r of checkCopy(ROOT, LANGS)) for (const p of r.problems) problems.push(`${langPath(r.lang, `content/en/${r.rel}`)}: ${p}`);
const copyFixture = proveCopyFixtureFails(ROOT);
if (!copyFixture.ok) problems.push(`copy parity check: ${copyFixture.detail}`);
/* Testimonials render only when confirmed with a consent date; a confirmed quote without one is a data
   error, not a quote to publish. */
for (const q of testimonials.quotes || []) {
  if (q.confirmed === true && !/^\d{4}-\d{2}-\d{2}$/.test(q.consent || "")) problems.push(`testimonials.json ${q.id}: confirmed needs a consent date`);
}
if (problems.length) finish();

const R = require(abs("assets/js/render.js"));
const img = createImages(SITE, manifest);

/* ---------- assets ---------- */
/* Shipped files, copied from their sources into site/. render.js is build-time only and never shipped. */
const SHIP = [
  ...readdirSync(abs("assets/css")).filter((f) => f.endsWith(".css")).map((f) => `assets/css/${f}`),
  ...readdirSync(abs("assets/js")).filter((f) => f.endsWith(".js") && f !== "render.js").map((f) => `assets/js/${f}`),
  ...readdirSync(abs("assets/fonts")).filter((f) => f.endsWith(".woff2")).map((f) => `assets/fonts/${f}`),
  ...readdirSync(abs("assets/fonts/LICENSES")).map((f) => `assets/fonts/LICENSES/${f}`),
  ...readdirSync(abs("assets/brand")).filter((f) => /\.(png|ico)$/.test(f)).map((f) => `assets/brand/${f}`),
  ...(existsSync(abs("assets/video")) ? readdirSync(abs("assets/video")).filter((f) => /\.(mp4|jpg)$/.test(f)).map((f) => `assets/video/${f}`) : []),
];
const hashes = new Map();
function asset(p) {
  const rel = p.replace(/^\//, "");
  if (!hashes.has(rel)) {
    if (!existsSync(abs(rel))) { soft(`asset ${rel} does not exist`); hashes.set(rel, "missing"); }
    else hashes.set(rel, crypto.createHash("sha1").update(readFileSync(abs(rel))).digest("hex").slice(0, 8));
  }
  return `${p}?v=${hashes.get(rel)}`;
}

/* ---------- the writer ---------- */
const OUT = DRY_LANG ? abs(`_build/${DRY_LANG}-dry`) : SITE;
const W = createWriter(OUT, { check: CHECK });

/* ---------- render one language ---------- */
const COPY = new Map();
function renderLanguage(L, c) {
  const lang = L.code;
  R.setStrings(c.ui.ui);
  const renderedStock = new Set();
  const ctx = {
    site, R, t: R.t, esc: R.esc, img, asset, brand, credits, warn: soft,
    copy: c, copyOf: (code) => COPY.get(code), lang: L, langs: LANGS,
    route: (id, params) => routes.routeIn(lang, id, params),
    routeIn: (other, id, params) => routes.routeIn(other, id, params),
    alternates: (id, params) => routes.alternates(id, params),
    hasRoute: (id) => routes.ids.includes(id),
    renderedStock,
    alt: (slug) => {
      const a = (c.media.alt || {})[slug];
      if (!a) problems.push(`${langPath(lang, "content/en/pages/media.json")}: no alt text for ${slug}`);
      const entry = catalogue.images.find((i) => i.slug === slug);
      if (entry && entry.origin === "stock") renderedStock.add(slug);
      return a || "";
    },
  };
  /* stock images rendered anywhere in this language must be credited; imprint is rendered last so the
     set is complete when it lists them */
  const spec = [
    ["home", () => pages.home(ctx)],
    ["services", () => pages.services(ctx)],
    ["dental", () => pages.treatment(ctx, "dental")],
    ["aesthetic", () => pages.treatment(ctx, "aesthetic")],
    ["hair", () => pages.treatment(ctx, "hair")],
    ["contact", () => pages.contactPage(ctx)],
    ["privacy", () => pages.privacy(ctx)],
    ...(lang === DEFAULT_LANG.code ? [["notFound", () => pages.notFound(ctx)]] : []),
    ["imprint", () => pages.imprint(ctx)],
  ];
  const rendered = [];
  for (const [id, render] of spec) {
    const rel = routes.relIn(lang, id);
    if (rel == null) continue;
    rendered.push({ lang, id, rel, html: render() });
  }
  for (const slug of renderedStock) {
    if (!(credits.images || []).some((cr) => cr.slug === slug)) problems.push(`stock image ${slug} is rendered but has no entry in data/credits.json`);
  }
  const miss = R.missing();
  if (miss.length) problems.push(`strings missing from ${langPath(lang, "i18n/en.json")}: ${miss.join(", ")}`);
  return rendered;
}

for (const L of LANGS) COPY.set(L.code, loadCopy(L.code));
for (const L of LANGS) {
  const back = fellBack.get(L.code) || [];
  if (!back.length) continue;
  const msg = `${L.code}: ${back.length} copy file(s) not translated yet, still rendering English (${back.slice(0, 3).join(", ")}${back.length > 3 ? ", ..." : ""})`;
  if (L.complete) problems.push(`${msg}, and data/site.json marks ${L.code} complete`);
  else warnings.push(msg);
}
if (problems.length) finish();

const built = [];
for (const L of LANGS) built.push(...renderLanguage(L, COPY.get(L.code)));
const byRel = new Map();
for (const p of built) {
  if (byRel.has(p.rel)) problems.push(`${p.rel} is written by both ${byRel.get(p.rel)} and ${p.lang}`);
  byRel.set(p.rel, p.lang);
}
for (const p of img.problems) soft(p);
if (problems.length) finish();

for (const p of built) W.write(p.rel, p.html);
if (!DRY_LANG) {
  for (const rel of SHIP) W.write(rel, readFileSync(abs(rel)));
  W.write("favicon.ico", readFileSync(abs("assets/brand/favicon.ico")));
  W.write("apple-touch-icon.png", readFileSync(abs("assets/brand/apple-touch-icon.png")));
}

/* ---------- the date ledger, the sitemap, robots, headers ---------- */
const datesRel = "data/page-dates.json";
const prevDates = !DRY_LANG && existsSync(abs(datesRel)) ? readJson(datesRel).pages || {} : {};
const TODAY = new Date().toISOString().slice(0, 10);
const changedNow = new Set([...W.written, ...W.wouldChange]);
const dates = {};
for (const p of built) {
  dates[p.rel] = changedNow.has(p.rel) ? TODAY
    : prevDates[p.rel] || (existsSync(path.join(OUT, p.rel)) ? statSync(path.join(OUT, p.rel)).mtime.toISOString().slice(0, 10) : TODAY);
}
if (!CHECK && !DRY_LANG) {
  const body = `${JSON.stringify({ note: "Generated by _tools/build.mjs: the day each page's bytes last changed, used as its sitemap <lastmod>. Never edited by hand.", pages: Object.fromEntries(Object.keys(dates).sort().map((k) => [k, dates[k]])) }, null, 2)}\n`;
  if (!existsSync(abs(datesRel)) || readFileSync(abs(datesRel), "utf8") !== body) writeFileSync(abs(datesRel), body, "utf8");
}

if (!DRY_LANG) {
  const NEVER_IN_SITEMAP = new Set(["notFound"]);
  const indexable = built.filter((p) => !NEVER_IN_SITEMAP.has(p.id));
  const sitemapUrl = (p) => {
    const alts = routes.alternates(p.id);
    const links = alts.map((a) => `\n    <xhtml:link rel="alternate" hreflang="${a.lang.code}" href="${site.origin}${a.path}"/>`).join("");
    const dflt = alts.find((a) => a.lang.code === "en") || alts[0];
    const xd = dflt ? `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${site.origin}${dflt.path}"/>` : "";
    return `  <url><loc>${site.origin}${routes.routeIn(p.lang, p.id)}</loc><lastmod>${dates[p.rel]}</lastmod>${links}${xd}\n  </url>`;
  };
  W.write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${indexable.map(sitemapUrl).join("\n")}\n</urlset>\n`);
  W.write("robots.txt", site.env === "preview"
    ? "# Preview build. Every page also carries noindex; this keeps crawlers out entirely until launch.\nUser-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`);

  /* _headers. Every rule whose path matches is applied and a header set by two rules is joined, so one
     "/*" rule holds every security header and the asset rules set Cache-Control only (a header set by two
     matching rules arrives as one joined value). No inline script (the html.js flag is a file), no iframe,
     no third-party script, no inline style: script-src 'self', frame-src 'none' and style-src 'self'. */
  const cfBeacon = site.analytics && site.analytics.cfBeacon && !R.isTodo(site.analytics.cfBeacon);
  const csp = [
    "default-src 'self'",
    `script-src 'self'${cfBeacon ? " https://static.cloudflareinsights.com" : ""}`,
    "style-src 'self'", "img-src 'self' data:", "font-src 'self'", "media-src 'self'", "frame-src 'none'",
    `connect-src 'self' https://api.web3forms.com${cfBeacon ? " https://cloudflareinsights.com" : ""}`,
    "form-action 'self' https://api.web3forms.com",
    "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "upgrade-insecure-requests",
  ].join("; ");
  const security = [
    "  X-Content-Type-Options: nosniff", "  Referrer-Policy: strict-origin-when-cross-origin", "  X-Frame-Options: DENY",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()", "  Strict-Transport-Security: max-age=15552000",
    `  Content-Security-Policy: ${csp}`,
    ...(site.noindex ? ["  X-Robots-Tag: noindex, nofollow"] : []),
  ].join("\n");
  W.write("_headers", [
    "# Generated by _tools/build.mjs. One \"/*\" rule sets every security header; the asset rules set only",
    "# Cache-Control, so no header is ever set by two rules that match the same request.",
    "", "/*", security,
    "", "/assets/css/*", "  Cache-Control: public, max-age=31536000, immutable",
    "", "/assets/js/*", "  Cache-Control: public, max-age=31536000, immutable",
    "", "/assets/fonts/*", "  Cache-Control: public, max-age=31536000, immutable",
    "", "/assets/img/*", "  Cache-Control: public, max-age=2592000",
    "", "/assets/brand/*", "  Cache-Control: public, max-age=2592000",
    "", "/assets/video/*", "  Cache-Control: public, max-age=604800",
  ].join("\n") + "\n");
}

/* ---------- stale files, manifest ---------- */
const gone = DRY_LANG ? [] : W.stale(["assets/img/"]);
if (CHECK && gone.length) problems.push(`stale files in site/: ${gone.join(", ")}`);
if (CHECK && W.wouldChange.length) problems.push(`out of date, run node _tools/build.mjs: ${W.wouldChange.join(", ")}`);
if (!CHECK && !DRY_LANG && !problems.length) {
  const inventory = built.map((p) => ({ rel: p.rel, lang: p.lang, route: p.id })).sort((a, b) => (a.rel < b.rel ? -1 : 1));
  const fallbacks = Object.fromEntries([...fellBack.entries()].map(([lang, rels]) => [lang, [...rels].sort()]));
  const body = `${JSON.stringify({ languages: LANGS.map((l) => l.code), files: [...W.files].sort(), pages: inventory, fallbacks }, null, 2)}\n`;
  mkdirSync(abs("_build"), { recursive: true });
  if (!existsSync(abs("_build/manifest.json")) || readFileSync(abs("_build/manifest.json"), "utf8") !== body) writeFileSync(abs("_build/manifest.json"), body, "utf8");
}
finish();

function finish() {
  for (const w of [...new Set(warnings)]) console.log(`warn  ${w}`);
  const distinct = [...new Set(problems)];
  if (distinct.length) {
    for (const p of distinct) console.error(`FAIL  ${p}`);
    console.error(`\nbuild${CHECK ? " --check" : ""}: ${distinct.length} problem(s)`);
    process.exit(1);
  }
  const langs = LANGS.map((l) => l.code).join(", ");
  console.log(CHECK
    ? `build --check: up to date (${W.files.size} files, ${langs})`
    : `build: ${W.written.length} written, ${W.unchanged.length} unchanged, ${gone.length} stale removed (${W.files.size} files, ${langs})`);
  console.log(`i18n parity fixture: ${fixture.detail}`);
  console.log(`copy parity fixture: ${copyFixture.detail}`);
  process.exit(0);
}
