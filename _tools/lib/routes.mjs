/* Public paths, one per page per language.

   Every path the site emits comes from here, so adding a language is a column in data/routes.json rather
   than an edit in thirty templates, and a path can never disagree with itself between the nav, a crumb, a
   canonical, a sitemap entry and an hreflang alternate.

   A template calls ctx.route(id, params) for its own language and ctx.routeIn(lang, id, params) for
   another one; ctx.rel(id, params) gives the manifest-relative file the build writes. Asset paths are NOT
   routes: /assets/... is one tree shared by every language and must never take a prefix.

   Paths in routes.json are relative to the language's prefix (data/site.json languages[]), so "/" plus the
   prefix "/en" is "/en/". A route with no entry for a language is not built in that language: the 404 is
   the one case, because Cloudflare Pages serves only the root 404 whatever the depth of the request. */

const PARAM = /\{(\w+)\}/g;

export function createRoutes(data, languages) {
  const problems = [];
  const routes = (data && data.routes) || {};
  const slugMaps = (data && data.slugs) || {};
  const codes = languages.map((l) => l.code);
  const prefixOf = new Map(languages.map((l) => [l.code, l.prefix || ""]));
  const seen = new Map();   // "lang path" -> id, to catch two ids claiming one URL

  for (const [id, byLang] of Object.entries(routes)) {
    if (!Object.keys(byLang).length) problems.push(`routes.json: ${id} has no language`);
    for (const [lang, tpl] of Object.entries(byLang)) {
      const at = `routes.json ${id}.${lang}`;
      /* A language may be mapped here before data/site.json builds it: that is how the next language is
         prepared without a half-built tree reaching the site. Its paths are still checked for shape, and
         every language that IS built must have one (below). */
      if (!/^[a-z]{2}$/.test(lang)) { problems.push(`${at}: ${lang} is not a two-letter language code`); continue; }
      if (typeof tpl !== "string" || !tpl.startsWith("/")) { problems.push(`${at}: must be a path starting with /`); continue; }
      if (!/\.html$/.test(tpl) && !tpl.endsWith("/")) problems.push(`${at}: a page path ends with / (or is a .html file)`);
      if (/[A-Z]/.test(tpl)) problems.push(`${at}: paths are lower case`);
      if (/\/\//.test(tpl)) problems.push(`${at}: double slash`);
      const params = [...tpl.matchAll(PARAM)].map((m) => m[1]);
      const other = Object.entries(byLang).find(([l2]) => l2 !== lang);
      if (other) {
        const want = [...String(other[1]).matchAll(PARAM)].map((m) => m[1]).sort().join(",");
        if (params.slice().sort().join(",") !== want) problems.push(`${at}: takes ${params.join(",") || "no parameters"}, but ${id}.${other[0]} takes ${want || "none"}`);
      }
      if (!params.length) {
        const key = `${lang} ${tpl}`;
        if (seen.has(key)) problems.push(`${at}: ${tpl} is already claimed by ${seen.get(key)}`);
        seen.set(key, id);
      }
    }
  }
  /* Every language that is built needs every route that its siblings have, or a page would exist in one
     language and 404 in another while the switcher still offers it. notFound is the stated exception. */
  const EXEMPT = new Set(["notFound"]);
  for (const [id, byLang] of Object.entries(routes)) {
    if (EXEMPT.has(id)) continue;
    for (const code of codes) {
      if (!byLang[code]) problems.push(`routes.json: ${id} has no path for ${code}`);
    }
  }
  /* Cloudflare Pages serves one 404, the root one, for an unknown path at any depth. So it belongs to
     exactly the language served from the root: listing it for a second language would offer a switcher
     and an hreflang pointing at a file that was never built. */
  const root = languages.find((l) => (l.prefix || "") === "");
  if (routes.notFound && root) {
    const at = Object.keys(routes.notFound);
    if (at.length !== 1 || at[0] !== root.code) {
      problems.push(`routes.json: notFound must name only ${root.code}, the language served from the root, but names ${at.join(", ") || "nothing"}`);
    }
  }
  for (const [kind, bySlug] of Object.entries(slugMaps)) {
    for (const [canonical, byLang] of Object.entries(bySlug)) {
      for (const code of codes) {
        const v = byLang[code];
        if (!v) { problems.push(`routes.json: slugs.${kind}.${canonical} has no slug for ${code}`); continue; }
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) problems.push(`routes.json: slugs.${kind}.${canonical}.${code} is not a slug`);
      }
    }
  }

  /* The slug a record is published under in one language. Zone slugs and listing references are shared, so
     only the kinds named in routes.json slugs are mapped and everything else passes through. */
  function slugFor(kind, canonical, lang) {
    const m = slugMaps[kind] && slugMaps[kind][canonical];
    return (m && m[lang]) || canonical;
  }

  /* which slug map a route's {slug} is drawn from; a route absent here has a slug shared by every
     language, which is true of zones (already Albanian) and listings (references) */
  const SLUG_KIND = { guide: "guide" };

  function routeIn(lang, id, params) {
    const byLang = routes[id];
    if (!byLang) throw new Error(`route ${id} does not exist`);
    const tpl = byLang[lang];
    if (!tpl) return null;                       // not built in this language
    const prefix = prefixOf.get(lang) || "";
    const filled = tpl.replace(PARAM, (m, k) => {
      const v = params && params[k];
      if (v == null) throw new Error(`route ${id} needs ${k}`);
      return String(k === "slug" && SLUG_KIND[id] ? slugFor(SLUG_KIND[id], v, lang) : v);
    });
    return `${prefix}${filled}`;
  }

  /* the file the build writes for a route, relative to the project root */
  function relIn(lang, id, params) {
    const p = routeIn(lang, id, params);
    if (p == null) return null;
    if (/\.html$/.test(p)) return p.replace(/^\//, "");
    return `${p.replace(/^\//, "")}index.html`;
  }

  /* every language a route exists in, for the switcher and the hreflang alternates */
  function alternates(id, params) {
    return languages
      .map((l) => ({ lang: l, path: routeIn(l.code, id, params) }))
      .filter((x) => x.path != null);
  }

  return { problems, routeIn, relIn, alternates, slugFor, ids: Object.keys(routes) };
}
