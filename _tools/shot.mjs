#!/usr/bin/env node
/* European Dental screenshot harness.

   usage:
     node _tools/shot.mjs <path-or-url> <out.png> [width] [height] [--full] [--menu] [--at=<selector>] [--engine=webkit]
     node _tools/shot.mjs --all [--tiles] [--engine=webkit]

   A site path such as /properties/ is served by _tools/serve.mjs on a free port (the site's CSP
   applies); a full http(s) URL is used as it is. Uses the installed Microsoft Edge, no download.

   Before capture: lazy images are forced eager, .reveal classes are removed, the page is scrolled
   through once, fonts and every image are decoded, and animations are frozen.
   After capture: one JSON line with the horizontal-overflow offenders.

   --full   whole page, at deviceScaleFactor 1 (taller rasters wrap past 16384px)
   --menu   opens the mobile menu first
   --at=<selector>   scrolls so that element's top sits just under the sticky header before a viewport
            capture: how the footer logo was photographed painting over the header on a phone
   --engine=webkit   Playwright's WebKit, the engine iOS Safari uses, instead of the installed Edge.
            Installed for _tools with `node _tools/node_modules/playwright-core/cli.js install webkit`.
            It cannot show what only a device has: safe-area insets, the collapsing toolbar, zoom on focus.
   --all    home, services, contact, privacy and imprint in every language at 1440x900 and 390x844,
            full page, into _tools/shots/<name>-<width>.png
   --tiles  with --all, also viewport-sized captures down each page, scrolled the way a visitor
            scrolls (sticky header and call bar included), into _tools/shots/tiles/<name>-<width>-NN.png.
            Phone tiles are at deviceScaleFactor 2 so the text stays legible. */
import { chromium, webkit } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "./serve.mjs";

/* the project folder; serve.mjs ROOT is site/, which is only what is served */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "_tools", "shots");
/* Named shots, one set per language the build published. The names carry the language, so a pair can be
   opened side by side. */
const ALL = (() => {
  const inv = JSON.parse(readFileSync(path.join(ROOT, "_build", "manifest.json"), "utf8")).pages || [];
  const want = [["home", "home"], ["services", "services"], ["contact", "contact"], ["privacy", "privacy"], ["imprint", "imprint"], ["404", "notFound"]];
  const urlOf = (rel) => "/" + rel.replace(/index\.html$/, "");
  const langs = [...new Set(inv.map((p) => p.lang))];
  const out = [];
  for (const lang of langs) {
    for (const [name, route] of want) {
      const p = inv.find((x) => x.lang === lang && x.route === route);
      if (p) out.push([langs.length > 1 ? `${lang}-${name}` : name, urlOf(p.rel)]);
    }
  }
  return out;
})();
const SIZES = [[1440, 900], [390, 844]];
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

const ENGINE = (process.argv.find((a) => a.startsWith("--engine=")) || "--engine=edge").slice(9);
const AT = (process.argv.find((a) => a.startsWith("--at=")) || "").slice(5);
/* a landscape phone is short rather than narrow, and a device gives it touch and a mobile viewport too.
   WebKit on Windows is given touch but not isMobile, which its Playwright build does not emulate there. */
function contextOptions(width, height, dpr) {
  const phone = width <= 600 || height <= 500;
  return { viewport: { width, height }, deviceScaleFactor: dpr, isMobile: phone && ENGINE !== "webkit", hasTouch: phone };
}

async function settle(page) {
  /* CSSOM rather than addStyleTag: the site's CSP (style-src 'self') refuses an injected <style>.
     scrollbar-gutter: headless Edge hides scrollbars, yet the site's html { scrollbar-gutter: stable }
     still reserves 15px, which captures as a blank strip down the right of every full-bleed section.
     No visitor sees that strip (a classic scrollbar fills it, an overlay scrollbar reserves nothing),
     so the capture lays out the way an overlay-scrollbar browser does. */
  await page.evaluate(() => {
    const s = document.documentElement.style;
    s.setProperty("scroll-behavior", "auto", "important");
    s.setProperty("scrollbar-gutter", "auto", "important");
  });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    document.querySelectorAll("img[loading='lazy']").forEach((img) => { img.loading = "eager"; });
    document.querySelectorAll(".reveal").forEach((el) => el.classList.remove("reveal"));
  });
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 800) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle");
  /* every image decoded before capture: large below-fold AVIFs race the screenshot */
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach((el) => el.classList.remove("reveal")));
  await page.waitForTimeout(400);
}

async function overflowReport(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const bad = [];
    if (doc.scrollWidth > doc.clientWidth + 1) {
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > doc.clientWidth + 1 && r.width > 0 && bad.length < 8) {
          bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} right=${Math.round(r.right)}`);
        }
      });
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, bad };
  });
}

async function open(browser, url, opts) {
  const ctx = await browser.newContext(opts);
  /* The site CSP carries upgrade-insecure-requests, which is right on https. Edge exempts 127.0.0.1 from it
     and WebKit does not, so over the local http server WebKit asked for every stylesheet, font and script
     on https, got none, and the first WebKit captures were unstyled pages. For WebKit only, that one
     directive is dropped from the CSP of the document; every other directive still applies. */
  if (ENGINE === "webkit") {
    await ctx.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const res = await route.fetch();
      const headers = res.headers();
      if (headers["content-security-policy"]) {
        headers["content-security-policy"] = headers["content-security-policy"].split(";").map((d) => d.trim())
          .filter((d) => d && d !== "upgrade-insecure-requests").join("; ");
      }
      return route.fulfill({ response: res, headers });
    });
  }
  const page = await ctx.newPage();
  const res = await page.goto(url, { waitUntil: "networkidle" });
  if (!res || res.status() >= 400) {
    await ctx.close();
    throw new Error(`${url} answered ${res ? res.status() : "nothing"}`);
  }
  await settle(page);
  return { ctx, page };
}

async function capture(browser, url, out, width, height, { full = false, menu = false } = {}) {
  const { ctx, page } = await open(browser, url, contextOptions(width, height, full ? 1 : 1.5));
  try {
    if (menu) {
      await page.click(".nav-toggle");
      await page.waitForTimeout(600);
    }
    if (AT) {
      const found = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const header = document.querySelector(".site-header");
        const under = header ? header.getBoundingClientRect().height / 2 : 0;
        window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - under));
        return true;
      }, AT);
      if (!found) throw new Error(`--at: nothing on the page matches ${AT}`);
      await page.waitForTimeout(300);
    }
    /* animations "disabled" also freezes transitions that would smear a stitched full-page capture */
    await page.screenshot({ path: out, fullPage: full && !AT, animations: "disabled" });
    return await overflowReport(page);
  } finally {
    await ctx.close();
  }
}

async function tiles(browser, url, base, width, height) {
  const phone = width <= 600 || height <= 500;
  const { ctx, page } = await open(browser, url, contextOptions(width, height, phone ? 2 : 1));
  const files = [];
  try {
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    const stepPx = height - (phone ? 170 : 110);
    for (let i = 0, y = 0; ; i++, y += stepPx) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(250);
      const f = `${base}-${String(i + 1).padStart(2, "0")}.png`;
      await page.screenshot({ path: f, animations: "disabled" });
      files.push(rel(f));
      if (y + height >= total) break;
    }
    return files;
  } finally {
    await ctx.close();
  }
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
if (!["edge", "webkit"].includes(ENGINE)) { console.error(`--engine must be edge or webkit, not ${ENGINE}`); process.exit(1); }
if (!flags.has("--all") && positional.length < 2) {
  console.error("usage: node _tools/shot.mjs <path-or-url> <out.png> [width] [height] [--full] [--menu]\n       node _tools/shot.mjs --all [--tiles]");
  process.exit(1);
}

let srv = null, browser = null, code = 0;
try {
  browser = ENGINE === "webkit" ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: "msedge", headless: true });
  if (flags.has("--all")) {
    srv = await start(0);
    mkdirSync(SHOTS, { recursive: true });
    if (flags.has("--tiles")) mkdirSync(path.join(SHOTS, "tiles"), { recursive: true });
    for (const [name, p] of ALL) {
      for (const [w, h] of SIZES) {
        const out = path.join(SHOTS, `${name}-${w}.png`);
        const report = await capture(browser, srv.origin + p, out, w, h, { full: true });
        const line = { shot: rel(out), path: p, width: w, height: h, ...report };
        if (flags.has("--tiles")) line.tiles = await tiles(browser, srv.origin + p, path.join(SHOTS, "tiles", `${name}-${w}`), w, h);
        console.log(JSON.stringify(line));
      }
    }
  } else {
    const [target, out, w = "1440", h = "900"] = positional;
    let url = target;
    if (!/^https?:/i.test(target)) {
      srv = await start(0);
      url = srv.origin + (target.startsWith("/") ? target : "/" + target);
    }
    const outAbs = path.resolve(out);
    mkdirSync(path.dirname(outAbs), { recursive: true });
    const report = await capture(browser, url, outAbs, Number(w), Number(h), { full: flags.has("--full"), menu: flags.has("--menu") });
    console.log(JSON.stringify(report));
  }
} catch (e) {
  console.error("shot failed: " + (e && e.message ? e.message : e));
  code = 1;
} finally {
  if (browser) await browser.close();
  if (srv) await srv.close();
}
process.exit(code);
