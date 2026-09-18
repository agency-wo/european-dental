#!/usr/bin/env node
/* One-off: download every image the old site used, at its original size, and sort it.

   The old site served images through a resizing CDN whose URLs UPSCALE past the original, so the bare
   asset URL is the true maximum. Inputs come from the ignored _research/old-site/: exploration.json (the
   image list, with each image's full address) and exclusions.json (what may not be used, and what is
   held). Neither is committed.

   Writes:
     _source/zyro/<name>                 every download, as served (ignored)
     _research/old-site/inventory.json   size, colour mode, sha256, dHash, status per image (ignored)
     originals/old-site/<safe name>      the carried-over masters (committed)
     data/denylist.json                  sha256 + dHash of every excluded image, neutral reasons only (committed)

   usage: node _tools/fetch-originals.mjs [--offline]   (--offline re-sorts what _source/zyro already holds) */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { dHash } from "./lib/dhash.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (rel) => path.join(ROOT, rel);
const OFFLINE = process.argv.includes("--offline");

const site = JSON.parse(readFileSync(abs("_research/old-site/exploration.json"), "utf8"));
const first = site.images.find((i) => i.best_url).best_url;
const BASE = first.slice(0, first.lastIndexOf("/") + 1);
const rules = JSON.parse(readFileSync(abs("_research/old-site/exclusions.json"), "utf8"));
const excluded = new Map(rules.excluded.map((e) => [e.name, e.reason]));
const held = new Map(rules.held.map((e) => [e.name, e.reason]));
const names = [...new Set(site.images.map((i) => decodeURIComponent(i.best_url.split("/").pop())))];

for (const d of ["_source/zyro", "originals/old-site", "data"]) mkdirSync(abs(d), { recursive: true });

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "webp";
  return "unknown";
}

/* d4..-x.png -> d4-x.png, IMG.JPG -> img.jpg, and the extension the bytes actually are */
function safeName(name, fmt) {
  const stem = name.replace(/\.[^.]+$/, "").replace(/\.{2,}-/g, "-").replace(/\.+/g, "-").toLowerCase();
  return `${stem}.${fmt === "unknown" ? "bin" : fmt}`;
}

async function get(name) {
  const dest = abs(`_source/zyro/${name}`);
  if (OFFLINE || existsSync(dest)) return readFileSync(dest);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(BASE + encodeURIComponent(name).replace(/%2F/g, "/"), { headers: { "User-Agent": "european-dental-migration/1.0 (one-off image fetch)" } });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(dest, buf);
      return buf;
    }
    if (attempt === 2) throw new Error(`${name}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const inventory = [];
const deny = [];
let failed = 0;
for (const name of names) {
  try {
    const buf = await get(name);
    const fmt = sniff(buf);
    const meta = await sharp(buf).metadata();
    const status = excluded.has(name) ? "excluded" : held.has(name) ? "held" : "carried";
    const entry = {
      name, status, safeName: safeName(name, fmt), format: fmt, width: meta.width, height: meta.height,
      space: meta.space, channels: meta.channels, hasAlpha: !!meta.hasAlpha,
      palette: meta.isPalette === true || meta.paletteBitDepth != null,
      bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), dhash: await dHash(buf),
      usedWhere: site.images.find((i) => i.best_url.endsWith(encodeURIComponent(name)) || i.best_url.endsWith(name))?.used_where || "",
    };
    inventory.push(entry);
    if (status === "carried") copyFileSync(abs(`_source/zyro/${name}`), abs(`originals/old-site/${entry.safeName}`));
    if (status === "excluded") deny.push({ reason: excluded.get(name), sha256: entry.sha256, dhash: entry.dhash });
    console.log(`${status.padEnd(8)} ${fmt.padEnd(4)} ${String(entry.width).padStart(4)}x${String(entry.height).padEnd(4)} ${entry.palette ? "palette" : "       "} ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}

/* The CDN copies of an excluded image that are already on this machine (loose copies, some of them
   different crops) are denylisted too: a re-crop moves a
   difference hash further than any threshold should allow, so every known copy is named by its own
   hashes rather than trusted to fall near the original. */
const looseDir = abs("_source/local-loose");
if (existsSync(looseDir)) {
  const { readdirSync } = await import("node:fs");
  for (const f of readdirSync(looseDir)) {
    const hit = [...excluded.keys()].find((n) => f.startsWith(n.replace(/\.[^.]+$/, "")));
    if (!hit) continue;
    const buf = readFileSync(path.join(looseDir, f));
    const entry = { reason: excluded.get(hit), sha256: crypto.createHash("sha256").update(buf).digest("hex"), dhash: await dHash(buf) };
    if (!deny.some((d) => d.sha256 === entry.sha256)) deny.push(entry);
  }
}

writeFileSync(abs("_research/old-site/inventory.json"), `${JSON.stringify({ fetched: names.length, images: inventory }, null, 1)}\n`);
const denylist = {
  note: "Images that must never be used or committed: sha256 and a 64-bit difference hash each, so a renamed or re-encoded copy is still caught by _tools/check-images.mjs. Reasons are neutral on purpose; what each one is stays off this public repo.",
  images: deny.map((d, i) => ({ id: `x${i + 1}`, ...d })),
};
writeFileSync(abs("data/denylist.json"), `${JSON.stringify(denylist, null, 2)}\n`);
const count = (s) => inventory.filter((i) => i.status === s).length;
console.log(`\n${names.length} names: ${count("carried")} carried, ${count("held")} held, ${count("excluded")} excluded, ${failed} failed`);
process.exit(failed ? 1 : 0);
