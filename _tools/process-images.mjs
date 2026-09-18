// European Dental: image pipeline.
//
// Reads data/images.json (the committed catalogue) and renders every variant an image lists into
// site/assets/img/<slug>--<variant>-<width>.<avif|webp|jpg>, then data/image-manifest.json, which the
// build reads through _tools/lib/picture.mjs.
//
// Rules:
//   - widths are intersected with what the crop actually has; the crop's native width is always the top
//     rung and nothing is ever upscaled
//   - heights are read back from the files on disk, and the three formats must agree, because an
//     off-by-one height is layout shift wherever a page reserves space from width and height
//   - idempotent: a rendition is re-encoded when it is missing, when its source changed, or when the
//     recipe changed (this file's own mtime is part of the check, the image-recipe-staleness rule)
//   - renditions of a slug at widths or variants no longer asked for are deleted
// Different here: sources are mostly lossless PNGs and a few JPEGs, not twice-compressed WhatsApp files,
// so one quality ladder serves every rung. Palette-mode PNGs are expanded to sRGB and their top rung gets
// a sub-pixel pre-blur (sigma 0.4) against banding. Metadata is stripped (sharp's default), which drops
// camera and location data from clinical photographs.
//
// A crop is the largest rectangle of the variant's aspect ratio that fits the source, centred on the
// image's focal point and clamped to the frame. A hero crop must be at least 1280 px wide.
// Every source is checked against data/denylist.json (sha256 and difference hash) and refused if it
// matches: an excluded image cannot come back under another name.
//
// usage: node _tools/process-images.mjs [--force]
import sharp from "sharp";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dHash, hamming } from "./lib/dhash.mjs";

sharp.cache(false);
const SELF = fileURLToPath(import.meta.url);
const RECIPE_TIME = statSync(SELF).mtimeMs;
const ROOT = join(dirname(SELF), "..");
const OUT = join(ROOT, "site", "assets", "img");
const FORCE = process.argv.includes("--force");
mkdirSync(OUT, { recursive: true });

export const VARIANTS = {
  hero:     { ratio: 16 / 7, widths: [640, 960, 1280, 1600, 1920], minTop: 1280 },
  "hero-m": { ratio: 5 / 4,  widths: [480, 720, 960, 1080] },
  wide:     { ratio: 16 / 7, widths: [480, 720, 960, 1280] },
  bg:       { ratio: 16 / 9, widths: [640, 960, 1280, 1600] },
  banner:   { ratio: 16 / 9, widths: [480, 720, 960, 1280] },
  card:     { ratio: 4 / 3,  widths: [360, 480, 720, 960] },
  thumb:    { ratio: 1,      widths: [160, 240, 320, 480] },
  full:     { ratio: null,   widths: [480, 720, 960, 1280, 1600] },
};
const Q = { avif: 50, webp: 80, jpg: 82 };
const BG = "#FFFFFF";

const catalogue = JSON.parse(readFileSync(join(ROOT, "data", "images.json"), "utf8"));
const deny = JSON.parse(readFileSync(join(ROOT, "data", "denylist.json"), "utf8")).images;

function crop(w, h, ratio, [fx, fy]) {
  if (!ratio) return { left: 0, top: 0, width: w, height: h };
  let cw = w, ch = Math.round(w / ratio);
  if (ch > h) { ch = h; cw = Math.round(h * ratio); }
  const left = Math.min(Math.max(Math.round(fx * w - cw / 2), 0), w - cw);
  const top = Math.min(Math.max(Math.round(fy * h - ch / 2), 0), h - ch);
  return { left, top, width: cw, height: ch };
}

const problems = [];
const manifest = [];
const keep = new Set();
let written = 0, skipped = 0;

for (const img of catalogue.images) {
  if (!img.variants.length) continue;
  const srcPath = join(ROOT, img.src);
  if (!existsSync(srcPath)) { problems.push(`${img.slug}: ${img.src} does not exist`); continue; }
  const buf = readFileSync(srcPath);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const dh = await dHash(buf);
  const hit = deny.find((d) => d.sha256 === sha || hamming(d.dhash, dh) <= 6);
  if (hit) { problems.push(`${img.slug}: ${img.src} matches denylist entry ${hit.id} (${hit.reason}); it may not be used`); continue; }
  const srcTime = statSync(srcPath).mtimeMs;
  const meta = await sharp(buf).metadata();
  for (const vname of img.variants) {
    const v = VARIANTS[vname];
    if (!v) { problems.push(`${img.slug}: unknown variant ${vname}`); continue; }
    const box = crop(meta.width, meta.height, v.ratio, img.focal);
    if (v.minTop && box.width < v.minTop) { problems.push(`${img.slug}: its ${vname} crop is ${box.width} px wide, under the ${v.minTop} px a ${vname} needs`); continue; }
    const widths = [...new Set([...v.widths.filter((w) => w < box.width), Math.min(box.width, Math.max(...v.widths))])].sort((a, b) => a - b);
    const key = `${img.slug}--${vname}`;
    const heights = {};
    for (const w of widths) {
      const top = w === widths[widths.length - 1];
      for (const ext of ["avif", "webp", "jpg"]) {
        const file = `${key}-${w}.${ext}`;
        keep.add(file);
        const out = join(OUT, file);
        const fresh = existsSync(out) && !FORCE && statSync(out).mtimeMs > Math.max(srcTime, RECIPE_TIME);
        if (!fresh) {
          let p = sharp(buf).extract(box).flatten({ background: BG }).toColourspace("srgb");
          p = p.resize({ width: w, kernel: "lanczos3" });
          if (top && img.palette && w > box.width / 2) p = p.blur(0.4);
          if (ext === "avif") p = p.avif({ quality: Q.avif, effort: 6, chromaSubsampling: "4:4:4" });
          else if (ext === "webp") p = p.webp({ quality: Q.webp, effort: 6, smartSubsample: true });
          else p = p.jpeg({ quality: Q.jpg, mozjpeg: true, progressive: true });
          await p.toFile(out);
          written++;
        } else skipped++;
        const m = await sharp(out).metadata();
        (heights[w] ||= new Set()).add(m.height);
      }
    }
    for (const [w, hs] of Object.entries(heights)) {
      if (hs.size !== 1) problems.push(`${key}: the three formats at ${w} px disagree on height (${[...hs].join(", ")})`);
    }
    const topW = widths[widths.length - 1];
    manifest.push({ slug: key, image: img.slug, variant: vname, widths, w: topW, h: [...heights[topW]][0], formats: ["avif", "webp", "jpg"], focal: img.focal });
  }
}

/* renditions nobody asks for any more */
let removed = 0;
for (const f of readdirSync(OUT)) {
  if (/\.(avif|webp|jpg)$/.test(f) && !keep.has(f)) { unlinkSync(join(OUT, f)); removed++; }
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL  ${p}`);
  process.exit(1);
}
manifest.sort((a, b) => (a.slug < b.slug ? -1 : 1));
const body = `${JSON.stringify({ note: "Generated by _tools/process-images.mjs. Do not edit.", images: manifest }, null, 1)}\n`;
const mf = join(ROOT, "data", "image-manifest.json");
if (!existsSync(mf) || readFileSync(mf, "utf8") !== body) writeFileSync(mf, body);
const bytes = [...keep].reduce((s, f) => s + statSync(join(OUT, f)).size, 0);
console.log(`images: ${manifest.length} variants, ${keep.size} files (${(bytes / 1048576).toFixed(1)} MB), ${written} written, ${skipped} fresh, ${removed} stale removed`);
