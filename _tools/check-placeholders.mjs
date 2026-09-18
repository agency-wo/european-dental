#!/usr/bin/env node
// European Dental: placeholder and leak gate. Node, no dependencies.
// The rule: every unconfirmed value
// carries the literal token TODO and is never a well-formed fake. This site adds the OLD BRAND: it is a
// rebrand, so any trace of the previous name, domain or site builder in shipped text is a failure.
//
// usage:
//   node _tools/check-placeholders.mjs             same as --preview
//   node _tools/check-placeholders.mjs --preview   fail on dashes, emoji, old-brand and name leaks, fake
//                                                  values; list TODO counts per file (not a failure)
//   node _tools/check-placeholders.mjs --launch    also fail on every TODO, a preview host in canonical,
//                                                  og:url, JSON-LD, sitemap or robots, and a preview env
//                                                  or noindex in data/site.json; writes the owner's
//                                                  checklist to _owner/LAUNCH-CHECKLIST.md (not committed)
// exit 0 clean, 1 on any failure, 2 if the gate's own pattern controls fail (the gate is broken).
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCH = process.argv.includes("--launch");
const MODE = LAUNCH ? "--launch" : "--preview";

const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".pdf", ".mp4", ".webm"]);
// Everything that ships (site/), every source it is built from, and the repository's own text files.
// _tools/ holds this gate's old-brand patterns, so it is scanned only for other names and control characters.
const SCAN_DIRS = ["site", "data", "i18n", "content", "assets/css", "assets/js"];
const SCAN_FILES = ["wrangler.jsonc", "README.md", ".gitattributes", ".gitignore", ".github/workflows/gates.yml"];
const SKIP_PREFIX = ["site/assets/fonts/LICENSES/"];

const ALWAYS = [
  { re: /\u2014/g, why: "em dash U+2014", bad: "a\u2014b" },
  { re: /\u2013/g, why: "en dash U+2013", bad: "1\u20132" },
  { re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{FE0F}]/gu, why: "emoji (the old copy used them as bullets and stars)", bad: "\u{1F539} diagnosi" },
  // the old brand, in any spacing or case; "alba" alone is a word in Albanian and Italian names, so it is
  // matched only when followed by "care"
  { re: /alba\s*-?\s*care/gi, why: "old brand: Alba Care", bad: "Welcome to Alba Care" },
  { re: /agenzia\s+alba\b/gi, why: "old brand: Agenzia Alba", bad: "Agenzia Alba" },
  { re: /zyrosite|hostinger|builder-backend/gi, why: "old site builder", bad: "assets.zyrosite.com" },
  { re: /example\.com/gi, why: "example domain", bad: "https://example.com/" },
  { re: /YOUR_/g, why: "template variable", bad: "YOUR_KEY" },
  { re: /lorem ipsum/gi, why: "placeholder copy", bad: "Lorem ipsum dolor" },
  { re: /(?<![\w+])\+000/g, why: "fake phone number", bad: "call +000 000 000" },
  // A shell heredoc turns a typed \\b into a backspace byte; three times in one session it silently broke
  // a regex. No text file here has any reason to hold a control character other than tab and newline.
  { re: /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, why: "control character (a heredoc ate a backslash?)", bad: "static\u0008/" },
];
// Real text this site must be able to carry.
const GOOD = ["Albania", "Albanien", "in Albania", "albanese", "Albanian", "Durrës", "Durazzo", "European Dental",
  "a dash - like this", "unicode-range: U+0000;", "Alba", "Balance care"];

/* Other clients', people's and accounts' names are never written into this public repository, not even
   here. They live in the ignored _notes/leak-names.json as [{ source, flags, why, bad }], each with its own
   control, and are checked over everything above plus _tools/. Without the file (CI, a fresh clone) this
   one rule is skipped with a note; on a working copy a missing file is a failure. */
const LEAK_FILE = join(ROOT, "_notes", "leak-names.json");
const LEAK_MISSING = !existsSync(LEAK_FILE);
const LEAK = LEAK_MISSING ? [] : JSON.parse(readFileSync(LEAK_FILE, "utf8")).map((x) =>
  ({ re: new RegExp(x.source, x.flags.includes("g") ? x.flags : x.flags + "g"), why: `name leak: ${x.why}`, bad: x.bad, good: x.good || [] }));

const INFO = [{ key: "TODO", re: /TODO/g }];
const LAUNCH_ALL = [{ re: /TODO[A-Z0-9-]*/g, why: "unresolved TODO", bad: "TODO-PHONE" }];
const PREVIEW_HOST = { re: /workers\.dev|pages\.dev/gi, why: "preview host at launch", bad: "https://european-dental.x.workers.dev/" };
/* Lines of shipped code that carry the word TODO because they test for one. Each is exempted by its exact
   text and must match exactly once, or the gate says so rather than quietly widening. */
const LAUNCH_EXEMPT = [
  { rel: "assets/js/render.js", text: 'function isTodo(v) { return typeof v === "string" && /^TODO/.test(v); }', why: "the renderer's own test for a placeholder value" },
  { rel: "assets/js/forms.js", text: 'var MARK = "TODO";', why: "the form guard's own test for a placeholder access key" },
  { rel: "site/assets/js/forms.js", text: 'var MARK = "TODO";', why: "the shipped copy of the form guard" },
];

// ---------- controls ----------
{
  const broken = [];
  for (const p of [...ALWAYS, ...LEAK, ...LAUNCH_ALL, PREVIEW_HOST]) {
    p.re.lastIndex = 0;
    if (!p.re.test(p.bad)) broken.push(`pattern for "${p.why}" does not match its control ${JSON.stringify(p.bad)}`);
    p.re.lastIndex = 0;
  }
  /* each private pattern also carries its own known-good text, kept in the private file */
  for (const p of LEAK) {
    for (const g of p.good) {
      p.re.lastIndex = 0;
      if (p.re.test(g)) broken.push(`pattern for "${p.why}" matches its own known-good text`);
      p.re.lastIndex = 0;
    }
  }
  for (const g of GOOD) {
    for (const p of [...ALWAYS, ...LEAK]) {
      p.re.lastIndex = 0;
      if (p.re.test(g)) broken.push(`pattern for "${p.why}" matches the known-good text ${JSON.stringify(g)}`);
      p.re.lastIndex = 0;
    }
  }
  if (broken.length) {
    for (const b of broken) console.log(`GATE BROKEN  ${b}`);
    process.exit(2);
  }
}

// ---------- files ----------
const relOf = (abs) => relative(ROOT, abs).split("\\").join("/");
function walk(dirAbs, out) {
  if (!existsSync(dirAbs)) return out;
  for (const name of readdirSync(dirAbs)) {
    const full = join(dirAbs, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.add(relOf(full));
  }
  return out;
}
const candidates = new Set();
for (const d of SCAN_DIRS) walk(join(ROOT, d), candidates);
for (const f of SCAN_FILES) if (existsSync(join(ROOT, f))) candidates.add(f);
const files = [];
for (const rel of [...candidates].sort()) {
  if (SKIP_PREFIX.some((p) => rel.startsWith(p)) || BINARY_EXT.has(extname(rel).toLowerCase())) continue;
  const buf = readFileSync(join(ROOT, rel));
  if (buf.subarray(0, 8192).includes(0)) continue;
  files.push({ rel, text: buf.toString("utf8") });
}

// ---------- scanning ----------
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}
function lineOf(starts, index) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= index) lo = mid; else hi = mid - 1; }
  return lo;
}
const printable = (s) => s.replace(/\u2014/g, "<U+2014>").replace(/\u2013/g, "<U+2013>").replace(/\s+/g, " ").trim();
const failures = [];
if (LEAK_MISSING) {
  if (process.env.CI) console.log("note  _notes/leak-names.json is absent here, so the name-leak rule is skipped; it runs on the working copy");
  else failures.push({ where: "_notes/leak-names.json", why: "the list of names that must never appear is missing (only CI runs without it)", match: "", snippet: "" });
}
function report(file, index, match, why) {
  const i = lineOf(file.starts, index);
  const lineEnd = file.text.indexOf("\n", file.starts[i]);
  const line = file.text.slice(file.starts[i], lineEnd === -1 ? file.text.length : lineEnd);
  const col = index - file.starts[i];
  const from = Math.max(0, col - 60);
  const snippet = (from > 0 ? "..." : "") + line.slice(from, col + match.length + 60) + (col + match.length + 60 < line.length ? "..." : "");
  failures.push({ where: `${file.rel}:${i + 1}`, why, match: printable(match), snippet: printable(snippet) });
}
function scan(file, patterns, offset = 0, text = file.text) {
  for (const p of patterns) {
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) report(file, offset + m.index, m[0], p.why);
  }
}

if (LAUNCH) {
  for (const x of LAUNCH_EXEMPT) {
    const f = files.find((y) => y.rel === x.rel);
    if (!f) { failures.push({ where: x.rel, why: "an exemption names a file that was not scanned", match: "", snippet: "" }); continue; }
    const n = f.text.split(x.text).length - 1;
    if (n !== 1) failures.push({ where: x.rel, why: `the exemption for ${x.why} matches ${n} times, and must match exactly once`, match: "", snippet: "" });
  }
}
/* The tools hold the old-brand patterns, so they are scanned only for other names and for control
   characters: a corrupted regex in a tool is the same failure as one in shipped code. */
const CONTROL = ALWAYS[ALWAYS.length - 1];
for (const rel of [...walk(join(ROOT, "_tools"), new Set())].filter((r) => /\.(mjs|js|py)$/.test(r) && !r.includes("node_modules/")).sort()) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  const f = { rel, text, starts: lineStarts(text) };
  scan(f, [CONTROL, ...LEAK]);
}

const counts = [];
for (const file of files) {
  file.starts = lineStarts(file.text);
  scan(file, [...ALWAYS, ...LEAK]);
  const c = {};
  for (const p of INFO) { p.re.lastIndex = 0; c[p.key] = [...file.text.matchAll(p.re)].length; }
  if (c.TODO) counts.push({ rel: file.rel, ...c });
  if (!LAUNCH) continue;
  let launchText = file.text;
  for (const x of LAUNCH_EXEMPT) {
    if (x.rel !== file.rel) continue;
    const at = launchText.indexOf(x.text);
    if (at >= 0) launchText = launchText.slice(0, at) + " ".repeat(x.text.length) + launchText.slice(at + x.text.length);
  }
  scan(file, LAUNCH_ALL, 0, launchText);
  if (/\.html?$/i.test(file.rel)) {
    for (const m of file.text.matchAll(/<(link|meta)\b[^>]*>/gi)) {
      const tag = m[0];
      const attr = (name) => { const a = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i")); return a ? a[1] : null; };
      const isCanonical = m[1].toLowerCase() === "link" && /(?:^|\s)(canonical|alternate)(?:\s|$)/i.test(attr("rel") || "");
      const isOg = m[1].toLowerCase() === "meta" && /^og:(url|image)$/i.test(attr("property") || "");
      if (isCanonical || isOg) scan(file, [{ ...PREVIEW_HOST, re: new RegExp(PREVIEW_HOST.re.source, "gi"), why: `${PREVIEW_HOST.why} (${isCanonical ? "canonical or alternate" : "og"})` }], m.index, tag);
    }
    for (const m of file.text.matchAll(/<script\b[^>]*type\s*=\s*"application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
      const bodyStart = m.index + m[0].indexOf(">") + 1;
      scan(file, [{ ...PREVIEW_HOST, re: new RegExp(PREVIEW_HOST.re.source, "gi"), why: `${PREVIEW_HOST.why} (JSON-LD)` }], bodyStart, m[1]);
    }
  }
  if (file.rel === "site/sitemap.xml" || file.rel === "site/robots.txt") {
    scan(file, [{ ...PREVIEW_HOST, re: new RegExp(PREVIEW_HOST.re.source, "gi"), why: `${PREVIEW_HOST.why} (${file.rel})` }]);
  }
  if (file.rel === "data/site.json") {
    let site = null;
    try { site = JSON.parse(file.text); } catch (e) { failures.push({ where: file.rel, why: `does not parse: ${e.message}`, match: "", snippet: "" }); }
    if (site && site.env === "preview") report(file, Math.max(0, file.text.search(/"env"\s*:/)), '"env": "preview"', "site env is still preview");
    if (site && site.noindex === true) report(file, Math.max(0, file.text.search(/"noindex"\s*:/)), '"noindex": true', "site noindex is still true");
  }
}

// ---------- report ----------
function groupOf(f) {
  const token = f.match && f.match.match(/^TODO[A-Z0-9-]*$/);
  if (token) return token[0];
  if (/preview host/.test(f.why)) return "the preview host";
  return f.why;
}
console.log(`check-placeholders ${MODE}: ${files.length} text files scanned`);
if (LAUNCH && failures.length) {
  const groups = new Map();
  for (const f of failures) {
    const key = groupOf(f);
    if (!groups.has(key)) groups.set(key, { key, count: 0, files: new Set(), first: f });
    const g = groups.get(key); g.count++; g.files.add(String(f.where).split(":")[0]);
  }
  const rows = [...groups.values()].map((g) => ({ ...g, where: /^TODO/.test(g.key) ? files.filter((f) => /^(data|content|i18n)\//.test(f.rel) && f.text.includes(g.key)).map((f) => f.rel) : [] }))
    .sort((a, b) => b.count - a.count);
  for (const r of rows) console.log(`FAIL  ${r.key}  ${r.count} occurrence(s) in ${r.files.size} file(s)${r.where.length ? `, set in ${r.where.slice(0, 3).join(", ")}` : ""}`);
  const md = ["# Launch checklist", "", "Written by `node _tools/check-placeholders.mjs --launch`, which fails while any line below stands.", "Kept in the ignored _owner/ folder: it is for the owner, not for the public repository.", ""];
  for (const r of rows) md.push(`## ${r.key}`, "", `- ${r.count} occurrence(s) in ${r.files.size} file(s), for example \`${r.first.where}\``, r.where.length ? `- set in ${r.where.map((w) => `\`${w}\``).join(", ")}` : "- comes from the build", "");
  mkdirSync(join(ROOT, "_owner"), { recursive: true });
  writeFileSync(join(ROOT, "_owner", "LAUNCH-CHECKLIST.md"), md.join("\n"), "utf8");
  console.log(`note  wrote _owner/LAUNCH-CHECKLIST.md: ${rows.length} group(s) over ${failures.length} occurrence(s)`);
} else {
  for (const f of failures) {
    console.log(`FAIL  ${f.where}  ${f.why}${f.match ? `  "${f.match}"` : ""}`);
    if (f.snippet) console.log(`      ${f.snippet}`);
  }
}
if (!LAUNCH && counts.length) {
  const total = counts.reduce((s, c) => s + c.TODO, 0);
  console.log(`\ninfo  TODO occurrences (listed, not failed, in --preview): ${total} in ${counts.length} files`);
}
if (failures.length) { console.log(`\ncheck-placeholders ${MODE}: FAIL, ${failures.length} finding(s)`); process.exit(1); }
console.log(`\ncheck-placeholders ${MODE}: PASS`);
process.exit(0);
