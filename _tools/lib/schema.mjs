/* Data validation, first problem in plain words. */

const isTodo = (v) => typeof v === "string" && /^TODO/.test(v);

export function validateSite(site) {
  const p = [];
  for (const k of ["name", "origin", "env", "phones", "whatsapp", "email", "web3formsKey", "address", "hours", "legal", "languages", "copyrightYear"]) {
    if (site[k] == null) p.push(`site.json: ${k} is missing`);
  }
  if (!["preview", "launch"].includes(site.env)) p.push("site.json: env must be preview or launch");
  if (site.env === "preview" && site.noindex !== true) p.push("site.json: a preview must be noindex");
  if (site.env === "launch" && isTodo(site.origin)) p.push("site.json: a launch needs a real origin");
  if (!Number.isInteger(site.copyrightYear)) p.push("site.json: copyrightYear must be a year");
  if (site.lang != null || site.locale != null) p.push("site.json: lang and locale are per language; use languages[]");
  if (!Array.isArray(site.phones) || !site.phones.length) p.push("site.json: phones must be a non-empty list");
  for (const [i, ph] of (site.phones || []).entries()) {
    if (!ph || !ph.display || !ph.e164) p.push(`site.json: phones[${i}] needs display and e164`);
    else if (!isTodo(ph.e164) && !/^\+\d{8,15}$/.test(ph.e164)) p.push(`site.json: phones[${i}].e164 must look like +393331234567`);
  }
  if (Array.isArray(site.languages)) {
    const codes = new Set();
    const roots = site.languages.filter((l) => (l.prefix || "") === "");
    if (!site.languages.length) p.push("site.json: languages is empty");
    if (roots.length !== 1) p.push(`site.json: ${roots.length} languages have an empty prefix; exactly one is served from the root`);
    for (const l of site.languages) {
      const at = `site.json languages ${l.code || "(no code)"}`;
      if (!/^[a-z]{2}$/.test(l.code || "")) p.push(`${at}: code must be two lower-case letters`);
      if (codes.has(l.code)) p.push(`${at}: duplicate code`);
      codes.add(l.code);
      if (!/^[a-z]{2}_[A-Z]{2}$/.test(l.locale || "")) p.push(`${at}: locale must look like de_DE`);
      if ((l.prefix || "") !== "" && !/^\/[a-z]{2}$/.test(l.prefix)) p.push(`${at}: prefix must be empty or like /en`);
      if (!l.name) p.push(`${at}: name is the language's own name, shown in the switcher`);
      if (typeof l.complete !== "boolean") p.push(`${at}: complete must be true or false`);
    }
    if (!codes.has("en")) p.push("site.json: English must be built; it is the parity reference (_tools/lib/i18n.mjs)");
  } else {
    p.push("site.json: languages must be a list");
  }
  return p;
}

/* A catalogue entry names a committed master, a focal point and the variants it is rendered in. */
export function validateImages(cat, variantNames) {
  const p = [], seen = new Set();
  for (const i of cat.images || []) {
    const at = `images.json ${i.slug || "(no slug)"}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(i.slug || "")) p.push(`${at}: slug must be kebab-case`);
    if (seen.has(i.slug)) p.push(`${at}: duplicate slug`);
    seen.add(i.slug);
    if (!/^originals\//.test(i.src || "")) p.push(`${at}: src must be a committed master under originals/`);
    if (!["old-site", "stock"].includes(i.origin)) p.push(`${at}: origin must be old-site or stock`);
    if (!Array.isArray(i.focal) || i.focal.length !== 2 || i.focal.some((v) => typeof v !== "number" || v < 0 || v > 1)) p.push(`${at}: focal must be [x, y] between 0 and 1`);
    for (const v of i.variants || []) if (!variantNames.includes(v)) p.push(`${at}: unknown variant ${v}`);
  }
  return p;
}
