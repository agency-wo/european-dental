/* Page shell: head, header, footer, contact links and form parts.
   Nothing visitor-facing is typed here: every
   word comes from i18n/<lang>.json through t() or from the page's copy file. */
import { graphScript, orgNode, websiteNode, webPageNode } from "../lib/jsonld.mjs";

const svg = (body, cls = "icon") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
export const ICON = {
  phone: svg(`<path d="M6.6 3.5h2.6l1.3 4-1.9 1.4a11 11 0 0 0 6.5 6.5l1.4-1.9 4 1.3v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" ${stroke}/>`),
  chat: svg(`<path d="M4.4 19.6l1.2-3.7A8 8 0 1 1 8.3 18.7z" ${stroke}/><path d="M9.3 8.4c.3 2.5 2.3 4.7 4.9 5.4l1.1-1.3-1.6-.9-.8.6c-1-.4-1.8-1.2-2.2-2.2l.6-.8-.9-1.6z" fill="currentColor"/>`),
  mail: svg(`<rect x="3.5" y="5.5" width="17" height="13" rx="2" ${stroke}/><path d="M4 7l8 6 8-6" ${stroke}/>`),
  facebook: svg(`<path d="M14 8.5V7c0-.8.5-1.3 1.3-1.3H17V2.8h-2.4C11.9 2.8 10.6 4.4 10.6 7v1.5H8v3.1h2.6v9.6H14v-9.6h2.6l.4-3.1z" fill="currentColor"/>`),
  instagram: svg(`<rect x="3.5" y="3.5" width="17" height="17" rx="5" ${stroke}/><circle cx="12" cy="12" r="4" ${stroke}/><circle cx="17.2" cy="6.8" r="1" fill="currentColor"/>`),
  pin: svg(`<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" ${stroke}/><circle cx="12" cy="10" r="2.3" ${stroke}/>`),
  clock: svg(`<circle cx="12" cy="12" r="8.5" ${stroke}/><path d="M12 7.5V12l3 2" ${stroke}/>`),
  prev: svg(`<path d="M15 5l-7 7 7 7" ${stroke}/>`),
  next: svg(`<path d="M9 5l7 7-7 7" ${stroke}/>`),
  pause: svg(`<path d="M9 6v12M15 6v12" ${stroke}/>`),
  play: svg(`<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>`),
  close: svg(`<path d="M6 6l12 12M18 6 6 18" ${stroke}/>`),
  arrow: svg(`<path d="M5 12h13M13 6l6 6-6 6" ${stroke}/>`),
};

/* The gold swoosh under a statement or a page heading: a single stroke that echoes the arc in the logo.
   pathLength="1" lets the motion layer draw it with stroke-dashoffset and no measuring. */
export const SWOOSH = '<svg class="swoosh" viewBox="0 0 240 26" aria-hidden="true" focusable="false"><path d="M3 21C62 28 164 22 237 3" pathLength="1"/></svg>';


/* ---------- contact links ---------- */
/* A placeholder value still renders a link, so the preview shows where it will be, but the link carries
   data-todo-msg and main.js refuses the click with that message. The visible label is the TODO token
   itself, so nobody mistakes it for a real number. */
export function contact(ctx, kind, arg) {
  const { site, R, t } = ctx;
  if (kind === "phone") {
    const ph = site.phones[arg || 0];
    return { href: `tel:${ph.e164}`, label: ph.display, todo: R.isTodo(ph.e164) ? t("todo.phone") : "" };
  }
  if (kind === "whatsapp") return { href: R.waLink(site.whatsapp, t("wa.general")), label: "WhatsApp", todo: R.isTodo(site.whatsapp) ? t("todo.whatsapp") : "" };
  if (kind === "map") return { href: R.isTodo(site.mapUrl) ? "#" : site.mapUrl, label: "", todo: R.isTodo(site.mapUrl) ? t("todo.map") : "" };
  if (kind === "facebook" || kind === "instagram") {
    const v = site.social && site.social[kind];
    return { href: R.isTodo(v) ? "#" : v, label: kind === "facebook" ? "Facebook" : "Instagram", todo: R.isTodo(v) ? t("todo.social") : "" };
  }
  return { href: `mailto:${site.email}`, label: site.email, todo: R.isTodo(site.email) ? t("todo.email") : "" };
}
export function link(ctx, kind, o = {}) {
  const { esc } = ctx, c = contact(ctx, kind, o.arg);
  const ext = ["whatsapp", "map", "facebook", "instagram"].includes(kind) && !c.todo ? ' target="_blank" rel="noopener"' : "";
  const cls = [o.cls, c.todo ? "is-todo" : ""].filter(Boolean).join(" ");
  return `<a${cls ? ` class="${cls}"` : ""} href="${esc(c.href)}"${ext}${c.todo ? ` data-todo-msg="${esc(c.todo)}"` : ""}${o.aria ? ` aria-label="${esc(o.aria)}"` : ""}>${o.inner || esc(o.label || c.label)}</a>`;
}
/* a placeholder value shown as a visible TODO, never passed off as real */
export function valueOrTodo(ctx, v) {
  return ctx.R.isTodo(v) ? `<span class="todo">${ctx.esc(v)}</span>` : ctx.esc(v);
}

/* ---------- pieces ---------- */
export function pageHeader(ctx, o) {
  const { esc } = ctx;
  return `<header class="page-header">
  <div class="container entrance">
    <h1>${esc(o.h1)}</h1>
    ${SWOOSH}
    ${o.lead ? `<p class="lead">${esc(o.lead)}</p>` : ""}
  </div>
</header>`;
}

/* ---------- forms ---------- */
export function field(ctx, formId, f) {
  const { esc, t } = ctx;
  const id = `${formId}-${f.name}`;
  const req = f.required ? " required" : "";
  const mark = f.required ? ` <span class="req">${esc(t("form.required"))}</span>` : "";
  if (f.type === "consent") {
    return `<div class="field field--check"><input id="${id}" type="checkbox" name="${f.name}" value="yes"${req}><label for="${id}">${esc(f.label)}${mark}</label></div>`;
  }
  const label = `<label for="${id}">${esc(f.label)}${mark}</label>`;
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : "";
  if (f.type === "textarea") {
    return `<div class="field field--wide">${label}<textarea id="${id}" name="${f.name}" rows="${f.rows || 5}"${req}${ph}></textarea></div>`;
  }
  const extra = [f.autocomplete ? ` autocomplete="${f.autocomplete}"` : "", f.inputmode ? ` inputmode="${f.inputmode}"` : ""].join("");
  return `<div class="field${f.wide ? " field--wide" : ""}">${label}<input id="${id}" name="${f.name}" type="${f.type || "text"}"${req}${extra}${ph}></div>`;
}

/* The same four fields the old site asked for, plus consent, because a message may carry health data. */
export function standardFields(ctx) {
  const { t } = ctx;
  return [
    { name: "name", label: t("form.name"), required: true, autocomplete: "name", placeholder: t("form.placeholderName") },
    { name: "phone", label: t("form.phone"), type: "tel", required: true, autocomplete: "tel", inputmode: "tel", placeholder: t("form.placeholderPhone") },
    { name: "email", label: t("form.email"), type: "email", required: true, autocomplete: "email", placeholder: t("form.placeholderEmail"), wide: true },
    { name: "message", label: t("form.message"), type: "textarea", required: true, rows: 5, placeholder: t("form.placeholderMessage") },
    { name: "consent", label: t("form.consent"), type: "consent", required: true },
  ];
}

export function w3fForm(ctx, o) {
  const { site, esc, t } = ctx;
  const sentId = `sent-${o.id}`;
  return `<div class="form-wrap" data-reveal>
  <p class="form-success" id="${sentId}" tabindex="-1" role="status">${esc(t("form.sent"))}</p>
  <form class="form" id="${o.id}" data-w3f data-sent="${sentId}" data-msg-todo="${esc(t("form.notConnected"))}" data-msg-error="${esc(t("form.error"))}" data-msg-sending="${esc(t("form.sending"))}" data-msg-invalid="${esc(t("form.invalid"))}" action="https://api.web3forms.com/submit" method="POST" aria-label="${esc(o.label)}">
    <input type="hidden" name="access_key" value="${esc(site.web3formsKey)}">
    <input type="hidden" name="subject" value="${esc(o.subject)}">
    <input type="hidden" name="from_name" value="${esc(t("form.fromName"))}">
    <input type="hidden" name="redirect" value="${esc(`${site.origin}${o.path}?sent=1#${sentId}`)}">
    <div class="hp" aria-hidden="true"><label>${esc(t("form.honeypot"))} <input type="checkbox" name="botcheck" tabindex="-1" autocomplete="off"></label></div>
    <div class="form__grid">
      ${(o.fields || standardFields(ctx)).map((f) => field(ctx, o.id, f)).join("\n      ")}
    </div>
    <div class="form__actions">
      <button class="btn btn--primary" type="submit">${esc(t("form.send"))}</button>
      <a class="form-note" href="${ctx.route("privacy")}">${esc(t("form.privacy"))}</a>
    </div>
  </form>
</div>`;
}

/* ---------- the shell ---------- */
/* Every language, the current one marked, the others linking to THIS page in that language. Returns an
   empty list on the 404, which has no alternates; the wrapper stays so every page's chrome has the same
   shape. */
function langSwitch(ctx, p, where) {
  const { esc, t } = ctx;
  const alts = ctx.alternates(p.route, p.routeParams);
  if (alts.length < 2) return `<ul class="lang-switch lang-switch--${where}" aria-label="${esc(t("nav.language"))}"></ul>`;
  return `<ul class="lang-switch lang-switch--${where}" aria-label="${esc(t("nav.language"))}">`
    + alts.map((a) => (a.lang.code === ctx.lang.code
      ? `<li><span class="lang-switch__current" lang="${esc(a.lang.code)}" title="${esc(a.lang.name)}"><span class="visually-hidden">${esc(a.lang.name)}</span><span aria-hidden="true">${esc(a.lang.code)}</span></span></li>`
      : `<li><a href="${esc(a.path)}" lang="${esc(a.lang.code)}" hreflang="${esc(a.lang.code)}" title="${esc(a.lang.name)}"><span class="visually-hidden">${esc(a.lang.name)}</span><span aria-hidden="true">${esc(a.lang.code)}</span></a></li>`)).join("")
    + "</ul>";
}

const NAV = [["home", "nav.home"], ["services", "nav.services"], ["contact", "nav.contact"]];
/* routes whose pages keep a nav item marked as current */
const SECTIONS = { services: ["dental", "aesthetic", "hair"] };

function logo(ctx, variant, sizes) {
  const b = ctx.brand.lockup;
  const base = variant === "rev" ? "/assets/brand/logo-h-rev" : "/assets/brand/logo-h";
  const set = Object.keys(b.heights).map((w) => `${ctx.asset(`${base}-${w}.png`)} ${w}w`).join(", ");
  return `<img class="brand__img" src="${ctx.asset(`${base}-320.png`)}" srcset="${set}" sizes="${sizes}" width="320" height="${b.heights["320"]}" alt="">`;
}

function header(ctx, p) {
  const { esc, t } = ctx;
  const current = (id) => (p.route === id || (SECTIONS[id] || []).includes(p.route) ? ' aria-current="page"' : "");
  return `<header class="site-header">
  <div class="container site-header__row">
    <a class="brand" href="${ctx.route("home")}" aria-label="${esc(t("nav.logo"))}">${logo(ctx, "main", "(max-width: 700px) 220px, 280px")}</a>
    <nav class="site-nav" aria-label="${esc(t("nav.main"))}">
      <ul class="nav-menu" id="nav-menu">
${NAV.map(([id, key]) => `        <li><a href="${ctx.route(id)}"${current(id)}>${esc(t(key))}</a></li>`).join("\n")}
        <li class="nav-menu__lang">${langSwitch(ctx, p, "drawer")}</li>
      </ul>
    </nav>
    <div class="nav-side">
      ${langSwitch(ctx, p, "header")}
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-menu"><span class="visually-hidden">${esc(t("nav.menu"))}</span><span class="bar"></span><span class="bar"></span><span class="bar"></span></button>
    </div>
  </div>
</header>`;
}

function footer(ctx, p) {
  const { site, esc, t } = ctx;
  const phones = site.phones.map((_, i) => `<li>${link(ctx, "phone", { arg: i, cls: "footer-link", inner: `${ICON.phone}<span>${esc(site.phones[i].display)}</span>` })}</li>`).join("\n          ");
  return `<footer class="site-footer">
  <div class="container footer-grid">
    <div class="footer-brand">
      <a class="brand brand--footer" href="${ctx.route("home")}" aria-label="${esc(t("nav.logo"))}">${logo(ctx, "rev", "280px")}</a>
      <p class="footer-tagline">${esc(t("footer.tagline"))}</p>
      <ul class="social" aria-label="${esc(t("footer.follow"))}">
        <li>${link(ctx, "facebook", { cls: "social__link", aria: "Facebook", inner: ICON.facebook })}</li>
        <li>${link(ctx, "instagram", { cls: "social__link", aria: "Instagram", inner: ICON.instagram })}</li>
      </ul>
    </div>
    <div class="footer-col">
      <p class="footer-h">${esc(t("footer.contact"))}</p>
      <ul>
          ${phones}
          <li>${link(ctx, "whatsapp", { cls: "footer-link", inner: `${ICON.chat}<span>WhatsApp</span>` })}</li>
          <li>${link(ctx, "email", { cls: "footer-link", inner: `${ICON.mail}<span>${esc(site.email)}</span>` })}</li>
      </ul>
    </div>
    <div class="footer-col">
      <p class="footer-h">${esc(t("footer.explore"))}</p>
      <ul>
${NAV.map(([id, key]) => `        <li><a class="footer-link" href="${ctx.route(id)}">${esc(t(key))}</a></li>`).join("\n")}
      </ul>
    </div>
    <div class="footer-col">
      <p class="footer-h">${esc(t("footer.legal"))}</p>
      <ul>
        <li><a class="footer-link" href="${ctx.route("privacy")}">${esc(t("footer.privacy"))}</a></li>
        <li><a class="footer-link" href="${ctx.route("imprint")}">${esc(t("footer.imprint"))}</a></li>
      </ul>
    </div>
  </div>
  <div class="container footer-base">
    <p>© ${site.copyrightYear} ${esc(site.name)}. ${esc(t("footer.rights"))}</p>
    ${langSwitch(ctx, p, "footer")}
  </div>
</footer>
<div class="toast" role="status" aria-live="polite" hidden></div>`;
}

/* Cloudflare Web Analytics, off until the owner supplies a token (site.json analytics.cfBeacon). */
export function beacon(ctx) {
  const token = ctx.site.analytics && ctx.site.analytics.cfBeacon;
  if (!token || ctx.R.isTodo(token)) return "";
  return `<script src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${ctx.esc(token)}"}' defer></script>\n`;
}

/* Every translation of this page, for a crawler. x-default is English, the version for a visitor whose
   language is none of ours. */
function alternateLinks(ctx, p) {
  const alts = ctx.alternates(p.route, p.routeParams);
  if (alts.length < 2) return "";
  const dflt = alts.find((a) => a.lang.code === "en") || alts[0];
  return [...alts.map((a) => `<link rel="alternate" hreflang="${ctx.esc(a.lang.code)}" href="${ctx.esc(ctx.site.origin + a.path)}">`),
    `<link rel="alternate" hreflang="x-default" href="${ctx.esc(ctx.site.origin + dflt.path)}">`].join("\n") + "\n";
}

export function layout(ctx, p) {
  const { site, esc, asset, t } = ctx;
  if (!p.route) throw new Error(`layout: a page must name its route (${p.title || "untitled"})`);
  p.path = ctx.route(p.route, p.routeParams);
  if (p.title && (p.title.length > 65 || p.title.length < 20)) ctx.warn(`${ctx.lang.code} ${p.route}: the title is ${p.title.length} characters; keep it between 20 and 65`);
  if (p.description && (p.description.length > 170 || p.description.length < 70)) ctx.warn(`${ctx.lang.code} ${p.route}: the description is ${p.description.length} characters; keep it between 70 and 170`);
  const canonical = `${site.origin}${p.path}`;
  const robots = site.noindex ? "noindex, nofollow" : p.noindex ? "noindex, follow" : "index, follow";
  const nodes = [
    orgNode(site, site.origin, t("agency.description"), ctx.langs.map((l) => l.code)),
    websiteNode(site, site.origin, ctx.lang.code),
    webPageNode(site.origin, p.path, p.title, p.description, ctx.lang.code, p.route === "home"),
  ];
  const scripts = ["/assets/js/main.js", ...(p.scripts || [])];
  return `<!doctype html>
<html lang="${esc(ctx.lang.code)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script src="${asset("/assets/js/flag.js")}"></script>
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${esc(canonical)}">
${alternateLinks(ctx, p)}<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:locale" content="${esc(ctx.lang.locale)}">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(`${site.origin}/assets/brand/og-card-1200.png`)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#08365F">
<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/marcellus-400.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/mulish-var.woff2" crossorigin>
${p.preload || ""}<link rel="stylesheet" href="${asset("/assets/css/fonts.css")}">
<link rel="stylesheet" href="${asset("/assets/css/styles.css")}">
<link rel="stylesheet" href="${asset("/assets/css/motion.css")}">
${(p.styles || []).map((s) => `<link rel="stylesheet" href="${asset(s)}">\n`).join("")}<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="${asset("/assets/brand/favicon-32.png")}" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${graphScript(nodes)}
</head>
<body class="page-${esc(p.route)}">
<a class="skip-link" href="#main">${esc(t("nav.skip"))}</a>
${header(ctx, p)}
<main id="main">
${p.main}
</main>
${footer(ctx, p)}
${scripts.map((s) => `<script src="${asset(s)}" defer></script>`).join("\n")}
${beacon(ctx)}</body>
</html>
`;
}
