#!/usr/bin/env node
/* Screen recordings of the motion, for review while there is no live preview. Installed Edge through
   playwright-core, with Playwright's own ffmpeg; the site is served by serve.mjs with its real headers.
   Writes _build/video/desktop-de.webm and _build/video/phone-it.webm (ignored, never committed).

   usage: node _tools/record.mjs      run from PowerShell */
import { chromium } from "playwright-core";
import { mkdirSync, renameSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "./serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "_build", "video");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const server = await start(0);
const browser = await chromium.launch({ channel: "msedge" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function glide(page, to, ms) {
  await page.evaluate(async ({ to, ms }) => {
    const from = window.scrollY, t0 = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        window.scrollTo(0, from + (to - from) * e);
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
  }, { to, ms });
}
async function record(name, viewport, script) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, recordVideo: { dir: OUT, size: viewport } });
  const page = await ctx.newPage();
  await script(page);
  const video = page.video();
  await ctx.close();
  const file = await video.path();
  renameSync(file, path.join(OUT, `${name}.webm`));
  console.log(`wrote _build/video/${name}.webm`);
}
const top = async (page, sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + window.scrollY - 90, sel);

await record("desktop-de", { width: 1440, height: 900 }, async (page) => {
  await page.goto(server.origin + "/", { waitUntil: "load" });
  await page.mouse.move(1400, 880);
  await wait(7600);                                           // the first slide change, and the progress line
  await glide(page, await top(page, ".welcome"), 1600); await wait(1200);
  await glide(page, await top(page, ".services"), 1600); await wait(1400);
  await page.mouse.move(720, 620); await wait(900);           // a card lifts under the pointer
  await glide(page, await top(page, ".gallery-section"), 1400); await wait(1000);
  await page.locator(".gallery__thumb").nth(2).click(); await wait(1100);
  await page.locator(".gallery__thumb").nth(4).click(); await wait(1100);
  await page.locator(".gallery__stage").click(); await wait(1200);
  await page.keyboard.press("ArrowRight"); await wait(1000);
  await page.keyboard.press("Escape"); await wait(800);
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(500);
  await page.locator('.nav-menu a[href="/leistungen/"]').click(); await wait(2200);   // a page transition
  await glide(page, 1400, 2200); await wait(1200);
});

await record("phone-it", { width: 390, height: 844 }, async (page) => {
  await page.goto(server.origin + "/it/", { waitUntil: "load" });
  await wait(2500);
  const bb = await page.locator(".nav-toggle").boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await wait(1500);
  await page.keyboard.press("Escape"); await wait(700);
  await glide(page, 900, 1800); await wait(1200);
  await glide(page, 2200, 2200); await wait(1400);
  await glide(page, 3600, 2200); await wait(1600);
});

await browser.close();
await server.close();
