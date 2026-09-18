#!/usr/bin/env node
/* European Dental behaviour test, in the installed Edge through playwright-core, against serve.mjs (which
   applies site/_headers, so the real CSP is in force). Pages come from _build/manifest.json.

   Session 1 steps (the motion steps join in Session 2):
     a  every page answers 200, with no console error, no CSP violation and no failed request
     b  no horizontal overflow at 320, 390 and 1440, and the two web fonts are loaded
     c  a placeholder contact link is refused with a visible toast, and navigation does not happen
     d  the mobile drawer: opens, focuses its first link, keeps Tab inside, shows a language link,
        closes on Escape and returns focus to the toggle, and releases the scroll lock
     e  a form with a placeholder Web3Forms key refuses to send and says so in a role=alert banner
     f  an unknown path answers 404 with the German page and links to /it/ and /en/
     g  without JavaScript every section is visible, the first slide shows and the menu links are reachable
     h  the language switcher on every page leads to a page in that language
   Session 2, motion (the slider steps run on Playwright's fake clock; real async work is polled from Node):
     i  nothing on screen at load is hidden or still moving, on every page at 390 and 1440
     j  reduced motion: the slider starts stopped, no drift, no parallax, the swoosh is drawn
     k  autoplay moves on after about 6 s
     l  Pause holds for 20 s; Play resumes
     m  keyboard focus stops autoplay; hovering pauses and leaving resumes
     n  a hidden tab and an offscreen slider pause
     o  a swipe changes photograph and stops autoplay
     p  the tab order is pause, previous, next, dots
     q  only the first hero photograph loads before the load event
     r  CLS under 0.01 across load, scrolling, slide changes, the lightbox and the drawer
     s  gallery: thumbnail crossfade, lightbox at the same photograph in AVIF, arrows, swipe, Escape
     t  the header's scrolled state never changes its height
     u  printing shows every block; ?static shows the reduced-motion page

   usage: node _tools/smoke.mjs [--only=a,b]     run from PowerShell (Git Bash rewrites /paths) */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "./serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inv = JSON.parse(readFileSync(path.join(ROOT, "_build", "manifest.json"), "utf8")).pages;
const urlOf = (rel) => "/" + rel.replace(/index\.html$/, "");
const PAGES = inv.filter((p) => p.route !== "notFound").map((p) => ({ ...p, url: urlOf(p.rel) }));
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const run = (s) => !ONLY.length || ONLY.includes(s);

const server = await start(0);
const base = server.origin;
const browser = await chromium.launch({ channel: "msedge" });
const results = [];
const check = (step, cond, msg) => { results.push({ step, ok: !!cond, msg }); if (!cond) console.log(`FAIL  ${step}  ${msg}`); };

async function newPage(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.w || 1440, height: o.h || 900 }, deviceScaleFactor: o.dpr || 1, isMobile: (o.w || 1440) <= 600, hasTouch: (o.w || 1440) <= 600, javaScriptEnabled: o.js !== false, reducedMotion: o.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error") page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push(String(e)));
  page.on("requestfailed", (r) => page.errors.push(`request failed ${r.url()}`));
  return { ctx, page };
}

try {
  if (run("a") || run("b")) {
    for (const [w, h] of [[1440, 900], [390, 844], [320, 640]]) {
      const { ctx, page } = await newPage({ w, h });
      for (const p of PAGES) {
        const res = await page.goto(base + p.url, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        if (w === 1440) check("a", res.status() === 200, `${p.url} answered ${res.status()}`);
        check("a", !page.errors.length, `${p.url} at ${w}: ${page.errors.join(" | ")}`);
        page.errors.length = 0;
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")) }));
        check("b", m.sw <= m.cw, `${p.url} overflows at ${w}: ${m.sw} > ${m.cw}`);
        if (w === 1440) check("b", m.fonts.includes("Marcellus") && m.fonts.includes("Mulish"), `${p.url}: fonts loaded ${m.fonts.join(", ")}`);
      }
      await ctx.close();
    }
  }

  if (run("c")) {
    const { ctx, page } = await newPage({ w: 390, h: 844 });
    await page.goto(base + "/", { waitUntil: "load" });
    const before = page.url();
    await page.locator(".intro .actions a").first().click();
    const toast = await page.locator(".toast").textContent();
    check("c", page.url() === before && (await page.locator(".toast").isVisible()) && /WhatsApp/.test(toast), `the placeholder WhatsApp button must stay put and toast (got ${JSON.stringify(toast)})`);
    await ctx.close();
  }

  if (run("d")) {
    const { ctx, page } = await newPage({ w: 390, h: 844 });
    await page.goto(base + "/it/", { waitUntil: "load" });
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(100);
    const y0 = await page.evaluate(() => window.scrollY);
    /* tap where the button is, as a finger does: locator.click() scrolls a sticky element "into view" first */
    const bb = await page.locator(".nav-toggle").boundingBox();
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.waitForTimeout(350);
    const st = await page.evaluate(() => ({ open: document.body.classList.contains("nav-open"), focus: document.activeElement && document.activeElement.textContent.trim(),
      expanded: document.querySelector(".nav-toggle").getAttribute("aria-expanded"), inert: document.querySelector("main").hasAttribute("inert"),
      toggleTop: Math.round(document.querySelector(".nav-toggle").getBoundingClientRect().top) }));
    check("d", st.open && st.expanded === "true" && st.inert && st.focus === "Home", `drawer opens with focus on its first link and main inert (${JSON.stringify(st)})`);
    check("d", st.toggleTop >= 0 && st.toggleTop < 64, `the close button stays on screen while the page behind is locked (top ${st.toggleTop})`);
    const langLink = page.locator(".lang-switch--drawer a").first();
    check("d", await langLink.isVisible(), "a language link is visible in the open drawer");
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => !!document.activeElement.closest(".site-header"));
    check("d", inside, "Tab stays inside the header while the drawer is open");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => ({ open: document.body.classList.contains("nav-open"), focus: document.activeElement.classList.contains("nav-toggle"), pos: document.body.style.position, y: window.scrollY }));
    check("d", !after.open && after.focus && after.pos === "" && Math.abs(after.y - y0) < 2, `Escape closes, returns focus and releases the scroll lock (${JSON.stringify(after)}, was at ${y0})`);
    await ctx.close();
    /* under reduced motion the drawer appears at once, so focus can still move into it */
    const r = await newPage({ w: 390, h: 844, reduced: true });
    await r.page.goto(base + "/it/", { waitUntil: "load" });
    await r.page.locator(".nav-toggle").focus();
    await r.page.keyboard.press("Enter");
    await r.page.waitForTimeout(200);
    const rf = await r.page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
    check("d", rf === "Home", `with reduced motion the drawer still takes focus on its first link (${rf})`);
    await r.ctx.close();
  }

  if (run("e")) {
    const { ctx, page } = await newPage({ w: 1440, h: 900 });
    let posted = false;
    await page.route("https://api.web3forms.com/**", (r) => { posted = true; r.fulfill({ status: 200, body: '{"success":true}' }); });
    await page.goto(base + "/en/contact/", { waitUntil: "load" });
    await page.locator("#contact-form-name").fill("Test");
    await page.locator("#contact-form-phone").fill("123");
    await page.locator("#contact-form-email").fill("a@b.c");
    await page.locator("#contact-form-message").fill("Hello");
    await page.locator("#contact-form-consent").check();
    await page.locator("#contact-form button[type=submit]").click();
    const banner = await page.locator("#contact-form .form-error-banner").textContent().catch(() => "");
    check("e", !posted && /not connected/i.test(banner || ""), `a placeholder key refuses to send with a banner (posted ${posted}, banner ${JSON.stringify(banner)})`);
    check("e", (await page.locator("#contact-form .form-error-banner").getAttribute("role")) === "alert", "the refusal is role=alert");
    await ctx.close();
  }

  if (run("f")) {
    const { ctx, page } = await newPage({});
    const res = await page.goto(base + "/nicht-vorhanden/", { waitUntil: "load" });
    const hrefs = await page.locator(".other-langs a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    check("f", res.status() === 404 && (await page.locator("html").getAttribute("lang")) === "de" && hrefs.includes("/it/") && hrefs.includes("/en/"), `unknown path: ${res.status()}, links ${hrefs}`);
    await ctx.close();
  }

  if (run("g")) {
    const { ctx, page } = await newPage({ w: 390, h: 844, js: false });
    await page.goto(base + "/", { waitUntil: "load" });
    const s = await page.evaluate(() => ({
      sections: [...document.querySelectorAll("main > section")].every((el) => el.getBoundingClientRect().height > 40 && getComputedStyle(el).visibility !== "hidden"),
      slide: getComputedStyle(document.querySelector(".slide.is-active")).display !== "none",
      nav: [...document.querySelectorAll("#nav-menu a")].filter((a) => a.getBoundingClientRect().width > 0 && getComputedStyle(a).visibility !== "hidden").length,
      controls: getComputedStyle(document.querySelector(".slider__controls")).display === "none" && getComputedStyle(document.querySelector(".slider__progress")).display === "none",
      thumbs: [...document.querySelectorAll(".gallery__thumb")].every((a) => /\.jpg$/.test(a.getAttribute("href"))),
    }));
    check("g", s.sections && s.slide && s.nav >= 3 && s.controls && s.thumbs, `no-JS home: every section visible, first slide shown, menu reachable, slider controls hidden, gallery links open JPEGs (${JSON.stringify(s)})`);
    await ctx.close();
  }

  /* ================= Session 2: motion ================= */
  const HOME = "/en/";
  /* poll a page expression from Node with real time, so a faked page clock cannot stall the wait */
  async function until(page, fn, arg, ms = 5000) {
    const end = Date.now() + ms;
    let v;
    while (Date.now() < end) {
      v = await page.evaluate(fn, arg);
      if (v) return v;
      await new Promise((r) => setTimeout(r, 60));
    }
    return v;
  }
  const sliderState = (page) => page.evaluate(() => { const s = document.querySelector("[data-slider]"); return { state: s.getAttribute("data-state"), index: s.getAttribute("data-index"), label: s.querySelector("[data-toggle]").getAttribute("aria-label"), play: s.getAttribute("data-msg-play") }; });
  async function sliderPage(o = {}) {
    const x = await newPage(o);
    await x.ctx.clock.install();
    await x.page.goto(base + HOME, { waitUntil: "load" });
    await until(x.page, () => !!document.querySelector("[data-slider]").getAttribute("data-state"));
    return x;
  }

  if (run("i")) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const { ctx, page } = await newPage({ w, h });
      for (const p of [...PAGES, { url: "/nicht-vorhanden/" }]) {
        /* the final state alone cannot see a fade that has already finished, so first ask, at
           DOMContentLoaded (main.js is deferred and has run), whether anything on screen was ever
           marked to be revealed: that would be a fade on the largest paint */
        await page.goto(base + p.url, { waitUntil: "domcontentloaded" });
        const early = await page.evaluate(() => [...document.querySelectorAll(".reveal")].filter((el) => el.getBoundingClientRect().top < window.innerHeight).map((el) => el.className));
        check("i", !early.length, `${p.url} at ${w}: marked for reveal while already on screen: ${early.join("; ")}`);
        await page.waitForLoadState("load");
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1300);
        const bad = await page.evaluate(() => {
          const out = [];
          const vh = window.innerHeight;
          for (const el of document.querySelectorAll("main *, .site-header *")) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || r.bottom <= 0 || r.top >= vh) continue;
            const own = el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!own && el.tagName !== "IMG") continue;
            if (getComputedStyle(el).visibility === "hidden") continue;
            let o = 1;
            for (let a = el; a && a !== document.documentElement; a = a.parentElement) o *= Number(getComputedStyle(a).opacity);
            if (o < 0.99) out.push(`${el.tagName.toLowerCase()}.${el.className || ""} opacity ${o.toFixed(2)}`);
          }
          document.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => { const r = el.getBoundingClientRect(); if (r.top < vh && r.bottom > 0) out.push(`unrevealed ${el.className}`); });
          document.querySelectorAll(".entrance > *").forEach((el) => { const t = getComputedStyle(el).transform; if (t !== "none" && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(t)) out.push(`entrance still moved ${t}`); });
          return out.slice(0, 4);
        });
        check("i", !bad.length, `${p.url} at ${w}: hidden above the fold: ${bad.join("; ")}`);
      }
      await ctx.close();
    }
  }

  if (run("j")) {
    const { ctx, page } = await sliderPage({ reduced: true });
    await page.clock.runFor(20000);
    const s = await sliderState(page);
    const m = await page.evaluate(() => ({
      anims: document.querySelector(".slide.is-active img").getAnimations().length,
      parallax: getComputedStyle(document.querySelector(".intro__bg img")).animationName,
      dash: getComputedStyle(document.querySelector(".intro .swoosh path")).strokeDashoffset,
    }));
    check("j", s.state === "stopped" && s.index === "0" && s.label === s.play, `reduced motion: the slider starts stopped at 0 with Play offered (${JSON.stringify(s)})`);
    check("j", m.anims === 0 && m.parallax === "none" && /^0(px)?$/.test(m.dash), `reduced motion: no drift, no parallax, swoosh drawn (${JSON.stringify(m)})`);
    await ctx.close();
  }

  if (run("k") || run("l")) {
    const { ctx, page } = await sliderPage({});
    await page.mouse.move(5, 895);
    let s = await sliderState(page);
    check("k", s.state === "playing" && s.index === "0", `autoplay starts on photograph 0 (${JSON.stringify(s)})`);
    await page.clock.runFor(6100);
    const moved = await until(page, () => document.querySelector("[data-slider]").getAttribute("data-index") === "1");
    check("k", moved, "autoplay moves to photograph 1 after about 6 s");
    const toggle = await page.locator("[data-toggle]").boundingBox();
    await page.mouse.click(toggle.x + toggle.width / 2, toggle.y + toggle.height / 2);
    await page.mouse.move(5, 895);
    await page.clock.runFor(20000);
    s = await sliderState(page);
    check("l", s.state === "stopped" && s.index === "1" && s.label === s.play, `Pause holds the photograph for 20 s (${JSON.stringify(s)})`);
    const frozen = await page.evaluate(() => [...document.querySelector(".slide.is-active img").getAnimations()].every((a) => a.playState === "paused"));
    check("l", frozen, "Pause also freezes the drift of the photograph (WCAG 2.2.2: all movement stops)");
    await page.mouse.click(toggle.x + toggle.width / 2, toggle.y + toggle.height / 2);
    await page.mouse.move(5, 895);
    await page.clock.runFor(6100);
    const resumed = await until(page, () => document.querySelector("[data-slider]").getAttribute("data-index") === "2");
    check("l", resumed, "Play resumes: photograph 2 after another 6 s");
    await ctx.close();
  }

  if (run("m")) {
    let { ctx, page } = await sliderPage({});
    await page.locator(".lang-switch--header a").last().focus();
    await page.keyboard.press("Tab");
    let s = await sliderState(page);
    check("m", s.state === "stopped" && s.label === s.play, `keyboard focus inside the slider stops autoplay (${JSON.stringify(s)})`);
    await ctx.close();
    ({ ctx, page } = await sliderPage({}));
    const box = await page.locator(".slider__track").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const paused = await until(page, () => document.querySelector("[data-slider]").getAttribute("data-state") === "paused");
    const bar = await page.evaluate(() => { const p = document.querySelector(".slider__progress"); return p.getAnimations().map((a) => a.playState).join(",") || "none"; });
    check("m", bar === "paused" || bar === "none", `the progress line stands still while the slider is paused by hover (${bar})`);
    await page.mouse.move(5, 895);
    const back = await until(page, () => document.querySelector("[data-slider]").getAttribute("data-state") === "playing");
    check("m", paused && back, `hover pauses and leaving resumes (paused ${paused}, resumed ${back})`);
    await ctx.close();
  }

  if (run("n")) {
    const { ctx, page } = await sliderPage({});
    await page.mouse.move(5, 895);
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    const hidden = await until(page, () => document.querySelector("[data-slider]").getAttribute("data-state") === "hidden");
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: false, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const off = await until(page, () => document.querySelector("[data-slider]").getAttribute("data-state") === "offscreen");
    const before = (await sliderState(page)).index;
    await page.clock.runFor(20000);
    const after = (await sliderState(page)).index;
    check("n", hidden && off && before === after, `a hidden tab and an offscreen slider both pause (hidden ${hidden}, offscreen ${off}, index ${before} then ${after})`);
    await ctx.close();
  }

  if (run("o")) {
    const { ctx, page } = await sliderPage({ w: 390, h: 844 });
    const box = await page.locator(".slider__track").boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 40, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 40, y, { steps: 6 });
    await page.mouse.up();
    const s = await sliderState(page);
    check("o", s.index === "1" && s.state === "stopped", `a swipe to the left shows the next photograph and stops autoplay (${JSON.stringify(s)})`);
    await ctx.close();
  }

  if (run("p")) {
    const { ctx, page } = await newPage({});
    await page.goto(base + HOME, { waitUntil: "load" });
    await page.locator(".lang-switch--header a").last().focus();
    const order = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => { const a = document.activeElement; return a.hasAttribute("data-toggle") ? "toggle" : a.hasAttribute("data-prev") ? "prev" : a.hasAttribute("data-next") ? "next" : a.hasAttribute("data-go") ? `dot${a.getAttribute("data-go")}` : a.tagName; }));
    }
    check("p", order.join(",") === "toggle,prev,next,dot0", `tab order into the slider is pause, previous, next, dots (${order.join(",")})`);
    await ctx.close();
  }

  if (run("q")) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const { ctx, page } = await newPage({ w, h });
      await page.goto(base + HOME, { waitUntil: "load" });
      await page.waitForTimeout(300);
      const slugs = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        const before = performance.getEntriesByType("resource").filter((e) => /--hero(-m)?-\d+\./.test(e.name) && e.startTime < nav.loadEventStart);
        return [...new Set(before.map((e) => e.name.replace(/^.*\/img\//, "").replace(/--hero.*$/, "")))];
      });
      check("q", slugs.length === 1, `at ${w} only the first hero photograph loads before the load event (${slugs.join(", ")})`);
      await ctx.close();
    }
  }

  if (run("r")) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      for (const url of [HOME, "/en/services/", "/en/contact/"]) {
        const { ctx, page } = await newPage({ w, h });
        await page.addInitScript(() => {
          window.__cls = 0;
          new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
        });
        await page.goto(base + url, { waitUntil: "load" });
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); } window.scrollTo(0, 0); });
        await page.waitForTimeout(400);
        if (url === HOME) {
          for (let i = 0; i < 2; i++) { await page.locator("[data-next]").click(); await page.waitForTimeout(1000); }
          await page.locator(".gallery__stage").click();
          await page.waitForTimeout(500);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
        }
        if (w < 600) {
          const bb = await page.locator(".nav-toggle").boundingBox();
          await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
          await page.waitForTimeout(400);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
        }
        const cls = await page.evaluate(() => window.__cls);
        check("r", cls < 0.01, `${url} at ${w}: CLS ${cls.toFixed(4)} across load, scroll and interaction`);
        await ctx.close();
      }
    }
  }

  if (run("s")) {
    const { ctx, page } = await newPage({});
    await page.goto(base + HOME, { waitUntil: "load" });
    await page.locator(".gallery").scrollIntoViewIfNeeded();
    const slug = await page.locator(".gallery__thumb").nth(2).getAttribute("data-full");
    await page.locator(".gallery__thumb").nth(2).click();
    await page.waitForTimeout(800);
    const st = await page.evaluate(() => ({ layers: document.querySelectorAll(".gallery__stage picture").length, src: document.querySelector(".gallery__stage picture:last-of-type img").currentSrc, cur: document.querySelector(".gallery__thumb[aria-current]").getAttribute("data-index") }));
    const want = slug.replace(/^.*\/img\//, "").replace(/--full.*$/, "");
    check("s", st.layers === 1 && st.src.includes(want) && st.cur === "2", `a thumbnail crossfades into the stage and leaves one layer (${JSON.stringify(st)})`);
    /* arrows move from the thumbnail that has focus, and focus is visible and unlike selection */
    await page.locator(".gallery__thumb").nth(4).focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);   /* the thumbnail's outline colour transitions over 280 ms */
    const kb = await page.evaluate(() => { const a = document.activeElement; return { idx: a.getAttribute("data-index"), cur: document.querySelector(".gallery__thumb[aria-current]").getAttribute("data-index"), ring: getComputedStyle(a).outlineColor, width: getComputedStyle(a).outlineWidth }; });
    check("s", kb.idx === "5" && kb.cur === "5" && !/rgba\(0, 0, 0, 0\)|transparent/.test(kb.ring) && kb.width === "3px", `ArrowRight moves from the focused thumbnail, with a visible 3px ring (${JSON.stringify(kb)})`);
    await page.locator(".gallery__thumb").nth(2).click();
    await page.waitForTimeout(700);
    await page.locator(".gallery__stage").click();
    await page.waitForTimeout(600);
    const lb = await page.evaluate(() => ({ open: document.querySelector(".lightbox").classList.contains("is-open"), count: document.querySelector(".lightbox__count").textContent, cap: document.querySelector(".lightbox__text").textContent.length > 10, src: document.querySelector(".lightbox__img").currentSrc, focus: document.activeElement.classList.contains("lb-close"), lock: document.body.style.position, inBody: document.querySelector(".lightbox").parentElement === document.body, inert: document.querySelector("main").hasAttribute("inert") && document.querySelector(".site-header").hasAttribute("inert"), shown: getComputedStyle(document.querySelector(".lightbox__img")).opacity }));
    check("s", lb.open && /^3 of 6$/.test(lb.count) && lb.cap && /\.avif$/.test(lb.src) && lb.focus && lb.lock === "fixed" && lb.shown === "1", `the lightbox opens at the same photograph with its caption, in AVIF, focus on Close, page locked (${JSON.stringify(lb)})`);
    check("s", lb.inBody && lb.inert, `the page behind the open lightbox is inert, so no screen reader can wander into it (${JSON.stringify({ inBody: lb.inBody, inert: lb.inert })})`);
    await page.keyboard.press("ArrowRight");
    const c2 = await page.locator(".lightbox__count").textContent();
    await page.evaluate(() => {
      const lbx = document.querySelector(".lightbox");
      const t = (x) => new Touch({ identifier: 1, target: lbx, clientX: x, clientY: 300 });
      lbx.dispatchEvent(new TouchEvent("touchstart", { changedTouches: [t(700)], bubbles: true }));
      lbx.dispatchEvent(new TouchEvent("touchend", { changedTouches: [t(560)], bubbles: true }));
    });
    const c3 = await page.locator(".lightbox__count").textContent();
    /* a click on the photograph must not strand the keyboard, and the arrows must not move between photographs of different shapes */
    await page.waitForTimeout(400);
    const nx5 = (await page.locator(".lb-next").boundingBox()).x;
    const ib = await page.locator(".lightbox__img").boundingBox();
    await page.mouse.click(ib.x + ib.width / 2, ib.y + ib.height / 2);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(500);
    const c4 = await page.locator(".lightbox__count").textContent();
    const nx6 = (await page.locator(".lb-next").boundingBox()).x;
    check("s", c4 === "6 of 6" && Math.abs(nx5 - nx6) < 1, `after a click on the photograph the arrow keys still work, and the next arrow stays put (${c4}, x ${nx5} then ${nx6})`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const end = await page.evaluate(() => { const s = document.querySelector(".gallery__stage"); return { open: document.querySelector(".lightbox").classList.contains("is-open"), focus: document.activeElement === s, lock: document.body.style.position, inert: document.querySelectorAll("[inert]").length, fv: s.matches(":focus-visible"), ring: getComputedStyle(s, "::after").boxShadow }; });
    check("s", c2 === "4 of 6" && c3 === "5 of 6", `arrow and swipe move through the photographs (${c2}, ${c3})`);
    check("s", !end.open && end.focus && end.lock === "" && end.inert === 0, `Escape closes, returns focus to the stage, releases the lock and the inert page (${JSON.stringify(end)})`);
    check("s", end.fv && /inset/.test(end.ring), `the focused stage shows its ring inside the frame, where nothing clips it (${end.ring})`);
    await ctx.close();
  }

  if (run("u")) {
    /* print: every block prints, whether or not it was scrolled into view */
    let { ctx, page } = await newPage({});
    await page.goto(base + HOME, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    const pr = await page.evaluate(() => ({ hidden: [...document.querySelectorAll("[data-reveal]")].filter((el) => getComputedStyle(el).opacity !== "1").length, total: document.querySelectorAll("[data-reveal]").length }));
    check("u", pr.hidden === 0, `printing shows all ${pr.total} revealable blocks (${pr.hidden} would print blank)`);
    await ctx.close();
    /* ?static shows the reduced-motion page whatever the visitor's own setting */
    ({ ctx, page } = await newPage({}));
    await page.goto(base + HOME + "?static", { waitUntil: "load" });
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => ({
      cls: document.documentElement.classList.contains("is-static"),
      drawn: [...document.querySelectorAll(".swoosh")].every((s) => s.classList.contains("is-drawn")),
      parallax: getComputedStyle(document.querySelector(".intro__bg img")).animationName,
      drift: document.querySelector(".slide.is-active img").getAnimations().length,
      state: document.querySelector("[data-slider]").getAttribute("data-state"),
    }));
    check("u", st.cls && st.drawn && st.parallax === "none" && st.drift === 0 && st.state === "stopped", `?static matches reduced motion: no parallax, no drift, slider stopped, swoosh drawn (${JSON.stringify(st)})`);
    await ctx.close();
  }

  if (run("t")) {
    const { ctx, page } = await newPage({});
    await page.goto(base + "/en/services/", { waitUntil: "load" });
    const h0 = await page.evaluate(() => document.querySelector(".site-header").getBoundingClientRect().height);
    await page.evaluate(() => window.scrollTo(0, 200));
    const on = await until(page, () => document.querySelector(".site-header").classList.contains("is-scrolled"));
    const h1 = await page.evaluate(() => document.querySelector(".site-header").getBoundingClientRect().height);
    check("t", on && h0 === h1, `the header shows its scrolled state and keeps its height (${h0} then ${h1})`);
    await ctx.close();
  }

  if (run("h")) {
    const { ctx, page } = await newPage({});
    for (const p of PAGES) {
      await page.goto(base + p.url, { waitUntil: "domcontentloaded" });
      const links = await page.locator(".lang-switch--header a").evaluateAll((as) => as.map((a) => [a.getAttribute("lang"), a.getAttribute("href")]));
      for (const [lang, href] of links) {
        const target = PAGES.find((x) => x.url === href);
        check("h", target && target.lang === lang && target.route === p.route, `${p.url}: the ${lang} switch goes to ${href}`);
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
const steps = [...new Set(results.map((r) => r.step))];
console.log(`\nsmoke: ${results.length} assertions over steps ${steps.join(", ")}; ${failed.length ? `FAIL ${failed.length}` : "PASS"}`);
process.exit(failed.length ? 1 : 0);
