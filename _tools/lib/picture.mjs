/* Image projections from assets/img/manifest.json, with an on-disk assert for every rendition.
   The rule: never advertise a file the pipeline did
   not emit. A srcset entry that 404s still renders a picture in most browsers, so the only place
   the mistake can be caught is here. */
import { existsSync } from "node:fs";
import path from "node:path";

export function createImages(root, manifest) {
  const bySlug = new Map(((manifest && manifest.images) || []).map((i) => [i.slug, i]));
  const problems = [];
  const checked = new Set();

  function proj(slug) {
    const e = bySlug.get(slug);
    if (!e) {
      if (!checked.has(slug)) problems.push(`image ${slug} is not in assets/img/manifest.json`);
      checked.add(slug);
      return null;
    }
    const widths = [...e.widths].sort((a, b) => a - b);
    if (!checked.has(slug)) {
      checked.add(slug);
      for (const w of widths) {
        for (const ext of e.formats || ["avif", "webp", "jpg"]) {
          const rel = `assets/img/${slug}-${w}.${ext}`;
          if (!existsSync(path.join(root, rel))) problems.push(`missing rendition ${rel}`);
        }
      }
    }
    return { base: `/assets/img/${slug}`, widths, w: e.w, h: e.h };
  }

  return { proj, problems, has: (slug) => bySlug.has(slug), entry: (slug) => bySlug.get(slug) };
}
