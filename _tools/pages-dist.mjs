#!/usr/bin/env node
/* A copy of site/ for a preview served from a sub-path, such as a GitHub Pages project site
   (https://<owner>.github.io/<repo>/). Every root-relative address in the HTML and CSS gets the base
   path in front of it; site/ itself is never changed. Cloudflare serves site/ as it is.

   Then every internal reference in the copy is checked against the files written, and any that would
   404 fails the run, so a broken preview is never published.

   usage: node _tools/pages-dist.mjs /european-dental      writes _dist/pages/ */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^\/[a-z0-9-]+$/.test(BASE)) { console.log("usage: node _tools/pages-dist.mjs /base-path"); process.exit(2); }
const SRC = path.join(ROOT, "site");
const OUT = path.join(ROOT, "_dist", "pages");
const SKIP = new Set(["_headers", "_redirects"]);   // Cloudflare configuration, meaningless on a plain host

const ATTRS = "href|src|srcset|imagesrcset|poster|action|data-avif|data-full|data-srcset";
const ATTR = new RegExp(`(\\s(?:${ATTRS})=")/(?!/)`, "g");
const LIST = /(,\s*)\/(?=assets\/)/g;               // the later entries of a srcset list
const CSSURL = /url\((["']?)\/(?!\/)/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

rmSync(OUT, { recursive: true, force: true });
const written = [];
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  if (SKIP.has(rel)) continue;
  const dest = path.join(OUT, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html") {
    writeFileSync(dest, readFileSync(file, "utf8").replace(ATTR, `$1${BASE}/`).replace(LIST, `$1${BASE}/`));
  } else if (ext === ".css") {
    writeFileSync(dest, readFileSync(file, "utf8").replace(CSSURL, `url($1${BASE}/`));
  } else {
    writeFileSync(dest, readFileSync(file));
  }
  written.push(rel.split(path.sep).join("/"));
}

// ---------- every internal reference must resolve ----------
const broken = [];
let checked = 0;
function resolves(ref, from) {
  if (!ref.startsWith("/")) return;
  checked++;
  if (!ref.startsWith(BASE + "/")) { broken.push(`${from}: ${ref} lacks the base path`); return; }
  let p = decodeURI(ref.slice(BASE.length).split(/[?#]/)[0]);
  if (p.endsWith("/")) p += "index.html";
  if (!existsSync(path.join(OUT, p))) broken.push(`${from}: ${ref} has no file`);
}
for (const rel of written) {
  const ext = path.extname(rel);
  if (ext !== ".html" && ext !== ".css") continue;
  const text = readFileSync(path.join(OUT, rel), "utf8");
  if (ext === ".css") {
    for (const m of text.matchAll(/url\((["']?)([^"')]+)\1\)/g)) resolves(m[2], rel);
    continue;
  }
  for (const m of text.matchAll(new RegExp(`\\s(${ATTRS})="([^"]*)"`, "g"))) {
    const value = m[2];
    if (/srcset/.test(m[1]) || m[1] === "data-avif") {
      for (const part of value.split(",")) resolves(part.trim().split(/\s+/)[0], rel);
    } else resolves(value, rel);
  }
}
for (const b of broken.slice(0, 20)) console.log(`FAIL  ${b}`);
console.log(`pages-dist: ${written.length} files into _dist/pages with base ${BASE}; ${checked} internal references, ${broken.length} broken`);
process.exit(broken.length ? 1 : 0);
