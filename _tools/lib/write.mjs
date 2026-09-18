/* Write-if-changed, with a --check mode and stale-file detection.
   Two details:
   - a Buffer body is written and compared as bytes (fonts, brand images and icons are copied into site/)
   - stale files are found by walking the served folder itself, not by reading the previous manifest, so
     --check needs no _build/ and works in CI and in Cloudflare's build, where _build/ does not exist.
   An unchanged file is never touched, so file sync and timestamps stay quiet. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, rmdirSync, readdirSync } from "node:fs";
import path from "node:path";

export function createWriter(root, { check = false } = {}) {
  const files = new Set();
  const written = [], unchanged = [], wouldChange = [];

  function write(rel, body) {
    rel = rel.replace(/\\/g, "/").replace(/^\/+/, "");
    const abs = path.join(root, rel);
    files.add(rel);
    const bin = Buffer.isBuffer(body);
    const data = bin ? body : Buffer.from(String(body).replace(/\r\n/g, "\n"), "utf8");
    const prev = existsSync(abs) ? readFileSync(abs) : null;
    if (prev && prev.equals(data)) { unchanged.push(rel); return "unchanged"; }
    if (check) { wouldChange.push(rel); return "would-change"; }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, data);
    written.push(rel);
    return "written";
  }

  function walk(dir, base = "") {
    const out = [];
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
      else out.push(rel);
    }
    return out;
  }

  /* Every file under root that this build did not produce, except under the prefixes another tool owns
     (site/assets/img/ belongs to process-images.mjs). Deleted, or in --check reported. Directories the
     sweep empties go too, deepest first, and only while empty. */
  function stale(ownedElsewhere = []) {
    const gone = walk(root).filter((rel) => !files.has(rel) && !ownedElsewhere.some((p) => rel.startsWith(p)));
    if (!check) {
      for (const rel of gone) rmSync(path.join(root, rel));
      const dirs = [...new Set(gone.flatMap((rel) => {
        const out = []; let d = path.posix.dirname(rel);
        while (d && d !== ".") { out.push(d); d = path.posix.dirname(d); }
        return out;
      }))].sort((a, b) => b.length - a.length);
      for (const d of dirs) {
        const at = path.join(root, d);
        if (existsSync(at) && readdirSync(at).length === 0) rmdirSync(at);
      }
    }
    return gone;
  }

  return { write, stale, files, written, unchanged, wouldChange };
}
