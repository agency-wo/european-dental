#!/usr/bin/env node
/* Largest Contentful Paint under a slow phone, in the installed Edge: slow 4G (150 ms RTT, 1.6 Mbps down,
   750 kbps up) and 4x CPU throttling at 390 x 844, DPR 3, against serve.mjs with the real headers. Reports
   which element was the final LCP candidate and when, over three cold runs. A measurement, not a gate:
   the numbers depend on this machine, so it is for before-and-after comparisons.
   usage: node _tools/lcp.mjs [/path/ ...]      run from PowerShell */
import { chromium } from "playwright-core";
import { start } from "./serve.mjs";

const PATHS = process.argv.slice(2).length ? process.argv.slice(2) : ["/", "/en/"];
const server = await start(0);
const browser = await chromium.launch({ channel: "msedge" });
for (const p of PATHS) {
  const times = [];
  let what = "";
  for (let run = 0; run < 3; run++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      window.__lcp = null;
      new PerformanceObserver((l) => { const e = l.getEntries().pop(); window.__lcp = { t: e.startTime, el: e.element ? (e.element.currentSrc || e.element.className || e.element.tagName) : e.url, size: e.size }; }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await page.goto(server.origin + p, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const lcp = await page.evaluate(() => window.__lcp);
    times.push(Math.round(lcp.t));
    what = `${String(lcp.el).replace(/^.*\/img\//, "")} (${lcp.size} px2)`;
    await ctx.close();
  }
  console.log(`${p}  LCP ${times.join(" / ")} ms  median ${times.sort((a, b) => a - b)[1]} ms  element ${what}`);
}
await browser.close();
await server.close();
