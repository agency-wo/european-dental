#!/usr/bin/env node
/* Image gate. The seven images excluded from the rebrand must never come back, whatever they are
   renamed to or however they are re-encoded.

   Checks every committed master under originals/ (sha256 and difference hash) and the top rendition of
   every image variant in site/assets/img/ (difference hash, Hamming distance 6 or less) against
   data/denylist.json. Also checks that every rendition on disk belongs to data/image-manifest.json and
   every manifest entry is on disk.

   It proves itself first: a synthetic control image in _tools/tests/, and a resized, re-encoded copy of
   it made on the fly, must both match the control entry, or the gate exits 2 (broken) before judging
   anything else.

   usage: node _tools/check-images.mjs      exit 0 clean, 1 on a finding, 2 if the gate is broken */
import sharp from "sharp";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dHash, hamming } from "./lib/dhash.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (rel) => path.join(ROOT, rel);
const deny = JSON.parse(readFileSync(abs("data/denylist.json"), "utf8")).images;
const manifest = JSON.parse(readFileSync(abs("data/image-manifest.json"), "utf8")).images;
const NEAR = 6;
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/* ---------- control ---------- */
const CONTROL = abs("_tools/tests/denylist-control.png");
if (!existsSync(CONTROL)) {
  /* a deterministic gradient with a diagonal band: structure a difference hash can see */
  const w = 640, h = 480, px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, band = Math.abs(x - y * 1.3) < 60 ? 90 : 0;
    px[i] = (x * 255 / w) | 0; px[i + 1] = Math.min(255, ((y * 255 / h) | 0) + band); px[i + 2] = 128;
  }
  await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toFile(CONTROL);
  console.log("note  wrote the control image _tools/tests/denylist-control.png; commit it");
}
const cbuf = readFileSync(CONTROL);
const control = { id: "control", reason: "gate control", sha256: sha(cbuf), dhash: await dHash(cbuf) };
const reencoded = await sharp(cbuf).resize({ width: 311 }).jpeg({ quality: 55 }).toBuffer();
const matches = (entries, s, d) => entries.find((e) => e.sha256 === s || hamming(e.dhash, d) <= NEAR);
if (!matches([control], sha(cbuf), control.dhash) || !matches([control], sha(reencoded), await dHash(reencoded))) {
  console.log("GATE BROKEN  the control image or its re-encoded copy is not matched; the denylist check proves nothing");
  process.exit(2);
}
if (!deny.length) { console.log("GATE BROKEN  data/denylist.json is empty"); process.exit(2); }

/* ---------- masters and renditions ---------- */
const problems = [];
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const masters = walk(abs("originals")).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
for (const f of masters) {
  const buf = readFileSync(f);
  const hit = matches(deny, sha(buf), await dHash(buf));
  if (hit) problems.push(`${path.relative(ROOT, f)} matches denylist entry ${hit.id} (${hit.reason})`);
}
let renditions = 0;
for (const m of manifest) {
  const top = `site/assets/img/${m.slug}-${m.w}.jpg`;
  if (!existsSync(abs(top))) { problems.push(`${top} is in the manifest but not on disk`); continue; }
  renditions++;
  const buf = readFileSync(abs(top));
  const hit = matches(deny, sha(buf), await dHash(buf));
  if (hit) problems.push(`${top} matches denylist entry ${hit.id} (${hit.reason})`);
}
/* every file in site/assets/img is claimed by the manifest */
const claimed = new Set(manifest.flatMap((m) => m.widths.flatMap((w) => m.formats.map((x) => `${m.slug}-${w}.${x}`))));
for (const f of existsSync(abs("site/assets/img")) ? readdirSync(abs("site/assets/img")) : []) {
  if (!claimed.has(f)) problems.push(`site/assets/img/${f} is not in data/image-manifest.json (a stray file is still a published file)`);
}

/* Everything git would publish (tracked, plus untracked files that are not ignored): an image or video
   outside the folders that hold them is a loose file that must not be committed, and every image
   anywhere is held to the denylist. Without git (a plain copy of the tree) this part is skipped. */
let published = null;
try { published = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean); }
catch { console.log("note  git is not available here, so the published-file check is skipped"); }
const MEDIA = /\.(png|jpe?g|webp|avif|gif|mp4|webm)$/i;
const HOMES = ["originals/", "assets/", "site/", "_tools/tests/"];
let loose = 0;
for (const rel of published || []) {
  if (!MEDIA.test(rel)) continue;
  if (!HOMES.some((h) => rel.startsWith(h))) { loose++; problems.push(`${rel} would be published but lives outside originals/, assets/ and site/ (a loose file: move it or ignore it)`); }
  if (/\.(png|jpe?g|webp)$/i.test(rel) && !rel.startsWith("originals/") && !rel.startsWith("site/assets/img/") && existsSync(abs(rel))) {
    const buf = readFileSync(abs(rel));
    const hit = matches(deny, sha(buf), await dHash(buf));
    if (hit) problems.push(`${rel} matches denylist entry ${hit.id} (${hit.reason})`);
  }
}

for (const p of problems) console.log(`FAIL  ${p}`);
console.log(`check-images: control caught (original and re-encoded); ${masters.length} masters and ${renditions} top renditions checked against ${deny.length} denylisted images; ${claimed.size} renditions claimed; ${published ? published.length : 0} published files checked, ${loose} loose`);
process.exit(problems.length ? 1 : 0);
