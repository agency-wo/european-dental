#!/usr/bin/env node
/* Page weight as a first visit downloads it, in the installed Edge, at 390 x 844 at DPR 3 and at 1440 x 900
   at DPR 1, after a scroll to the bottom so lazy images count.

   Budgets: 500 KB per page; every JS file 18 KB and every CSS file 64 KB, taken as the larger of what the
   pages loaded and what is on disk in site/ (so a file nothing loads cannot hide); 72 KB of CSS on any one
   page; zero third-party requests.

   usage: node _tools/weigh.mjs      run from PowerShell */
import { chromium } from "playwright-core";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "./serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET = { page: 500 * 1024, js: 18 * 1024, css: 64 * 1024, cssPage: 72 * 1024 };
/* tighter caps for the motion files, so choreography can never grow into the weight of a library */
const PER_FILE = { "/assets/css/motion.css": 12 * 1024, "/assets/js/slider.js": 8 * 1024, "/assets/js/gallery.js": 10 * 1024, "/assets/js/main.js": 12 * 1024 };
const inv = JSON.parse(readFileSync(path.join(ROOT, "_build", "manifest.json"), "utf8")).pages;
const PAGES = inv.map((p) => "/" + p.rel.replace(/index\.html$/, ""));

const server = await start(0);
const origin = server.origin;
const browser = await chromium.launch({ channel: "msedge" });
const problems = [];
const rows = [];
const fileMax = new Map();

for (const [w, h, dpr] of [[390, 844, 3], [1440, 900, 1]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 600, hasTouch: w < 600 });
  for (const url of PAGES) {
    const page = await ctx.newPage();
    const got = [];
    page.on("response", async (r) => {
      try {
        const body = await r.body();
        got.push({ url: r.url(), type: r.request().resourceType(), bytes: body.length });
      } catch { /* a redirect has no body */ }
    });
    await page.goto(origin + url, { waitUntil: "load" });
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    });
    await page.waitForLoadState("networkidle");
    await page.close();
    const total = got.reduce((s, x) => s + x.bytes, 0);
    const css = got.filter((x) => x.type === "stylesheet").reduce((s, x) => s + x.bytes, 0);
    const third = got.filter((x) => !x.url.startsWith(origin));
    for (const x of got) {
      const p = new URL(x.url).pathname;
      if (/\.(js|css)$/.test(p)) fileMax.set(p, Math.max(fileMax.get(p) || 0, x.bytes));
    }
    rows.push({ url, w, total, css, n: got.length });
    if (total > BUDGET.page) problems.push(`${url} at ${w}: ${Math.round(total / 1024)} KB, over ${BUDGET.page / 1024} KB`);
    if (css > BUDGET.cssPage) problems.push(`${url} at ${w}: ${Math.round(css / 1024)} KB of CSS, over ${BUDGET.cssPage / 1024} KB`);
    for (const t of third) problems.push(`${url} at ${w}: third-party request ${t.url}`);
  }
  await ctx.close();
}
await browser.close();
await server.close();

for (const dir of ["assets/js", "assets/css"]) {
  for (const f of readdirSync(path.join(ROOT, "site", dir))) {
    const p = `/${dir}/${f}`;
    fileMax.set(p, Math.max(fileMax.get(p) || 0, statSync(path.join(ROOT, "site", dir, f)).size));
  }
}
for (const [p, bytes] of fileMax) {
  const cap = PER_FILE[p] || (p.endsWith(".js") ? BUDGET.js : BUDGET.css);
  if (bytes > cap) problems.push(`${p}: ${(bytes / 1024).toFixed(1)} KB, over ${cap / 1024} KB`);
}

const heaviest = [...rows].sort((a, b) => b.total - a.total).slice(0, 4);
for (const r of heaviest) console.log(`      ${String(Math.round(r.total / 1024)).padStart(4)} KB  ${String(r.n).padStart(3)} requests  ${r.w}px  ${r.url}`);
for (const [p, bytes] of [...fileMax].sort()) console.log(`      ${(bytes / 1024).toFixed(1).padStart(6)} KB  ${p}`);
for (const p of problems) console.log(`FAIL  ${p}`);
console.log(`\nweigh: ${rows.length} page loads; heaviest ${Math.round(heaviest[0].total / 1024)} KB; ${problems.length ? `FAIL ${problems.length}` : "PASS"}`);
process.exit(problems.length ? 1 : 0);
