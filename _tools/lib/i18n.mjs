/* Language parity. A translated strings file must have exactly the shape of the English one:
   the same keys, the same value types, and the same {placeholders} inside every string, so a
   half-translated file fails the build instead of shipping English holes or broken templates.
   The check is proven against a deliberately broken fixture in _tools/tests/i18n-broken-fixture/. */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

function placeholders(s) {
  return [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
}

export function sameShape(en, other, where = "") {
  const problems = [];
  const tEn = Array.isArray(en) ? "array" : typeof en;
  const tOt = Array.isArray(other) ? "array" : typeof other;
  if (tEn !== tOt) { problems.push(`${where || "(root)"}: expected ${tEn}, found ${tOt}`); return problems; }
  if (tEn === "object" && en !== null) {
    for (const k of Object.keys(en)) {
      if (!(k in other)) problems.push(`${where}${where ? "." : ""}${k}: missing`);
      else problems.push(...sameShape(en[k], other[k], `${where}${where ? "." : ""}${k}`));
    }
    for (const k of Object.keys(other)) if (!(k in en)) problems.push(`${where}${where ? "." : ""}${k}: not in English`);
  } else if (tEn === "array") {
    if (en.length !== other.length) problems.push(`${where}: ${en.length} items in English, ${other.length} here`);
    en.forEach((v, i) => { if (i < other.length) problems.push(...sameShape(v, other[i], `${where}[${i}]`)); });
  } else if (tEn === "string") {
    if (placeholders(en) !== placeholders(other)) problems.push(`${where}: placeholders {${placeholders(en)}} vs {${placeholders(other)}}`);
    if (!String(other).trim()) problems.push(`${where}: empty`);
  }
  return problems;
}

/* Every non-English strings file must match English exactly. English is the reference because it is the
   file that has every key, not because it is the language served first.

   A language still being translated may have no file yet: it renders English through the build's fallback,
   which counts and reports what is missing, so a second gate saying the same thing would only make the
   build unusable while the work is in progress. The moment data/site.json marks the language complete the
   file is required, and from then on it must match key for key, type for type and placeholder for
   placeholder. Takes the language records so it can tell those two states apart.
   Returns [{lang, problems}]. */
export function checkLanguages(root, langs) {
  const en = JSON.parse(readFileSync(path.join(root, "i18n", "en.json"), "utf8"));
  const out = [];
  for (const l of langs) {
    const lang = typeof l === "string" ? l : l.code;
    const complete = typeof l === "string" ? true : !!l.complete;
    if (lang === "en") continue;
    const file = path.join(root, "i18n", `${lang}.json`);
    if (!existsSync(file)) {
      if (complete) out.push({ lang, problems: [`i18n/${lang}.json does not exist, but site.json marks ${lang} complete`] });
      continue;
    }
    const other = JSON.parse(readFileSync(file, "utf8"));
    out.push({ lang, problems: sameShape({ ui: en.ui }, { ui: other.ui }) });
  }
  return out;
}

/* ---------- the copy layer ----------
   i18n/<lang>.json is 249 strings of chrome. The copy layer is the other 1,600, in 42 hand written files
   per language, and until now nothing held it to any shape at all: a dropped key rendered "undefined" into
   a page and a body array one item short lost a paragraph in silence. These two functions apply the same
   sameShape to content/<lang>/**, and the distinction that matters is between a file that is absent and a
   file that is wrong. Absent is the fallback, which readLang counts and the build reports; wrong is fatal. */

function copyRels(dir, base = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...copyRels(path.join(dir, e.name), rel));
    else if (e.name.endsWith(".json")) out.push(rel);
  }
  return out.sort();
}

/* Every copy file a language has actually written, held to its English counterpart. One that does not
   exist is skipped, because that is the fallback and saying so twice would make a half translated language
   unbuildable. Returns [{lang, rel, problems}], only for files that exist and disagree. */
export function checkCopy(root, langs) {
  const enDir = path.join(root, "content", "en");
  if (!existsSync(enDir)) return [];
  const rels = copyRels(enDir);
  const out = [];
  for (const l of langs) {
    const lang = typeof l === "string" ? l : l.code;
    if (lang === "en") continue;
    for (const rel of rels) {
      const file = path.join(root, "content", lang, rel);
      if (!existsSync(file)) continue;
      let other;
      try { other = JSON.parse(readFileSync(file, "utf8")); }
      catch (e) { out.push({ lang, rel, problems: [`is not readable JSON: ${e.message}`] }); continue; }
      const en = JSON.parse(readFileSync(path.join(enDir, rel), "utf8"));
      const problems = sameShape(en, other);
      if (problems.length) out.push({ lang, rel, problems });
    }
  }
  return out;
}

/* The copy fixture must FAIL, the same way the strings fixture must. Each file in it mirrors the path of a
   real English copy file and breaks it on purpose, so this proves the check can still see a dropped key, a
   shortened array, an emptied string, a changed placeholder and an extra key. */
export function proveCopyFixtureFails(root) {
  const dir = path.join(root, "_tools", "tests", "copy-broken-fixture");
  if (!existsSync(dir)) return { ok: false, detail: "copy fixture folder missing" };
  const rels = copyRels(dir);
  if (!rels.length) return { ok: false, detail: "copy fixture holds no files" };
  const results = [];
  for (const rel of rels) {
    const enFile = path.join(root, "content", "en", rel);
    if (!existsSync(enFile)) return { ok: false, detail: `copy fixture ${rel} mirrors no English file, so it proves nothing` };
    const en = JSON.parse(readFileSync(enFile, "utf8"));
    const other = JSON.parse(readFileSync(path.join(dir, rel), "utf8"));
    results.push({ rel, problems: sameShape(en, other) });
  }
  const blind = results.filter((r) => !r.problems.length);
  return blind.length
    ? { ok: false, detail: `copy parity passed a broken fixture: ${blind.map((b) => b.rel).join(", ")}` }
    : { ok: true, detail: results.map((r) => `${r.rel}: ${r.problems.length} problems caught`).join("; ") };
}

/* The fixture must FAIL. If it ever passes, the parity check has gone blind. */
export function proveFixtureFails(root) {
  const dir = path.join(root, "_tools", "tests", "i18n-broken-fixture");
  if (!existsSync(dir)) return { ok: false, detail: "fixture folder missing" };
  const en = JSON.parse(readFileSync(path.join(root, "i18n", "en.json"), "utf8"));
  const results = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    const other = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    return { file: f, problems: sameShape({ ui: en.ui }, { ui: other.ui }) };
  });
  const blind = results.filter((r) => r.problems.length === 0);
  return blind.length || !results.length
    ? { ok: false, detail: `parity check passed a broken fixture: ${blind.map((b) => b.file).join(", ") || "no fixtures"}` }
    : { ok: true, detail: results.map((r) => `${r.file}: ${r.problems.length} problems caught`).join("; ") };
}
