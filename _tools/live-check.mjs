// European Dental: live check of a deployed build on Cloudflare's real headers.
// For each page at 1440 and 390: 200, no console errors (CSP violations included),
// no failed same-origin requests, both web fonts loaded, JS running, no horizontal overflow, and every
// security header present exactly once (two matching _headers rules would arrive as one joined value).
// A preview must carry X-Robots-Tag noindex. An unknown path must answer 404 with the same headers, and
// nothing but the built site may answer: config, tooling and source paths are probed and must 404.
// Screenshots of each language's home page go to _tools/shots/ (ignored).
//   node _tools/live-check.mjs [https://base] [/path/ ...]      run from PowerShell (Git Bash rewrites /paths)
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TOOLS, "..");
const argv = process.argv.slice(2);
const site = JSON.parse(readFileSync(path.join(ROOT, "data", "site.json"), "utf8"));
const fromSite = /^https?:\/\//.test(site.origin) ? site.origin : "";
const BASE = ((/^https?:\/\//.test(argv[0] || "") ? argv.shift() : fromSite) || "").replace(/\/+$/, "");
if (!BASE) { console.log("live-check: no base URL. Pass one, or set data/site.json origin once the preview exists."); process.exit(2); }
const PAGES = argv.length ? argv : (() => {
  const inv = JSON.parse(readFileSync(path.join(ROOT, "_build", "manifest.json"), "utf8")).pages || [];
  return inv.filter((p) => ["home", "services", "contact"].includes(p.route)).map((p) => "/" + p.rel.replace(/index\.html$/, ""));
})();
const PREVIEW = /\.(workers|pages)\.dev$/.test(new URL(BASE).hostname);
const SHOTS = path.join(TOOLS, "shots");
const SECURITY = ["content-security-policy", "x-content-type-options", "referrer-policy", "x-frame-options", "permissions-policy", "strict-transport-security"];
/* files that exist in the repository but must never be served: only site/ is the asset directory */
const MUST_404 = ["/_headers", "/wrangler.jsonc", "/README.md", "/data/site.json", "/_tools/build.mjs", "/assets/js/render.js", "/.git/config", "/site/index.html"];

function headerProblems(entries) {
  const seen = new Map();
  for (const { name, value } of entries) {
    const k = name.toLowerCase();
    seen.set(k, [...(seen.get(k) || []), value]);
  }
  const out = [];
  for (const k of PREVIEW ? [...SECURITY, "x-robots-tag"] : SECURITY) {
    const values = seen.get(k) || [];
    if (!values.length) { out.push(`${k} missing`); continue; }
    if (values.length > 1) { out.push(`${k} sent ${values.length} times`); continue; }
    const commaIsNormal = k === "permissions-policy" || k === "x-robots-tag";
    const joined = k === "permissions-policy" ? (values[0].match(/camera=/g) || []).length > 1 : !commaIsNormal && values[0].includes(",");
    if (joined) out.push(`${k} is a joined value: ${values[0].slice(0, 90)}`);
  }
  if (PREVIEW && seen.has("x-robots-tag") && !/noindex/i.test(seen.get("x-robots-tag").join(" "))) out.push("x-robots-tag is not noindex");
  return out;
}

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
let problems = 0;

for (const [w, h, dpr] of [[1440, 900, 1], [390, 844, 3]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 500, hasTouch: w < 500 });
  const page = await ctx.newPage();
  for (const p of PAGES) {
    const errors = [], failed = [];
    const onConsole = (m) => { if (m.type() === "error") errors.push(m.text()); };
    const onFail = (r) => failed.push(`${r.url()} ${r.failure() ? r.failure().errorText : ""}`);
    const onResp = (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) failed.push(`${r.status()} ${r.url()}`); };
    page.on("console", onConsole); page.on("requestfailed", onFail); page.on("response", onResp);
    const resp = await page.goto(BASE + p, { waitUntil: "networkidle" });
    const heads = headerProblems(await resp.headersArray());
    await page.evaluate(() => document.fonts.ready);
    const info = await page.evaluate(() => ({
      marcellus: document.fonts.check('400 16px "Marcellus"'),
      mulish: document.fonts.check('400 16px "Mulish"'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      js: document.documentElement.classList.contains("js") && !!window.ED,
    }));
    const ok = resp.status() === 200 && !errors.length && !failed.length && !heads.length && info.overflow <= 1 && info.js && info.marcellus && info.mulish;
    if (!ok) problems++;
    console.log(`${ok ? "PASS" : "FAIL"} ${w} ${p}  status=${resp.status()} fonts=${info.marcellus}/${info.mulish} js=${info.js} overflow=${info.overflow}`);
    if (heads.length) console.log("   headers:", heads);
    if (errors.length) console.log("   console:", errors.slice(0, 4));
    if (failed.length) console.log("   failed:", failed.slice(0, 4));
    if (/^\/(?:[a-z]{2}\/)?$/.test(p)) await page.screenshot({ path: path.join(SHOTS, `live-${p === "/" ? "de" : p.replace(/\//g, "")}-home-${w}.png`) });
    page.off("console", onConsole); page.off("requestfailed", onFail); page.off("response", onResp);
  }
  await ctx.close();
}

{
  const ctx = await browser.newContext();
  const r = await ctx.request.get(`${BASE}/no-such-page-live-check/`, { failOnStatusCode: false, maxRedirects: 0 });
  const heads = headerProblems(r.headersArray());
  const ok = r.status() === 404 && !heads.length;
  if (!ok) problems++;
  console.log(`${ok ? "PASS" : "FAIL"} unknown path  status=${r.status()}`);
  if (heads.length) console.log("   headers:", heads);
  for (const p of MUST_404) {
    const x = await ctx.request.get(BASE + p, { failOnStatusCode: false, maxRedirects: 0 });
    const good = x.status() === 404;
    if (!good) problems++;
    console.log(`${good ? "PASS" : "FAIL"} not served  ${p}  status=${x.status()}`);
  }
  await ctx.close();
}

await browser.close();
console.log(problems ? `LIVE CHECK: ${problems} problem(s)` : "LIVE CHECK: all clean");
process.exit(problems ? 1 : 0);
