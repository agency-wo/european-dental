/* Page bodies. Copy lives in content/<lang>/pages/*.json and UI strings in i18n/<lang>.json; nothing
   visitor-facing is typed here except markup. Sections and their order follow the old site exactly:
   the rebrand is palette, type, logo, photography treatment and motion, not structure. */
import { layout, pageHeader, link, w3fForm, valueOrTodo, ICON, SWOOSH } from "./chrome.mjs";

/* One picture of one variant of an image, with alt text from the page language's media.json. */
function pic(ctx, slug, variant, o = {}) {
  const img = ctx.img.proj(`${slug}--${variant}`);
  const alt = o.decorative ? "" : ctx.alt(slug);
  return ctx.R.pictureHtml(img, { sizes: o.sizes, alt, eager: o.eager, cls: o.cls });
}

/* The hero: a desktop 16:7 crop and a phone 4:5 crop of the same photograph. The media strings of the
   preload and of the <source> elements must be identical, or the browser downloads both. */
const MQ_M = "(max-width: 700px)";
function heroPicture(ctx, slug, o = {}) {
  const d = ctx.img.proj(`${slug}--hero`), m = ctx.img.proj(`${slug}--hero-m`);
  const { esc, R } = ctx;
  const alt = esc(ctx.alt(slug));
  let html = "<picture>";
  if (m) html += `<source media="${MQ_M}" type="image/avif" srcset="${R.srcset(m, "avif")}" sizes="100vw"><source media="${MQ_M}" type="image/webp" srcset="${R.srcset(m, "webp")}" sizes="100vw"><source media="${MQ_M}" type="image/jpeg" srcset="${R.srcset(m, "jpg")}" sizes="100vw">`;
  if (d) html += `<source type="image/avif" srcset="${R.srcset(d, "avif")}" sizes="100vw"><source type="image/webp" srcset="${R.srcset(d, "webp")}" sizes="100vw">`;
  html += d
    ? `<img src="${d.base}-${d.widths[d.widths.length - 1]}.jpg" srcset="${R.srcset(d, "jpg")}" sizes="100vw" width="${d.w}" height="${d.h}" alt="${alt}"${o.eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`
    : '<span class="ph" aria-hidden="true"></span>';
  html += "</picture>";
  const preload = o.eager && d
    ? (m ? `<link rel="preload" as="image" type="image/avif" media="${MQ_M}" imagesrcset="${R.srcset(m, "avif")}" imagesizes="100vw" fetchpriority="high">\n` : "")
      + `<link rel="preload" as="image" type="image/avif" media="(min-width: 701px)" imagesrcset="${R.srcset(d, "avif")}" imagesizes="100vw" fetchpriority="high">\n`
    : "";
  return { html, preload };
}

/* The four old hero slides, in the old order. Slide 2 was a 736 px portrait, too small for a banner, and
   is replaced by the clinician at the X-ray. */
const SLIDES = ["dental-chair-blue-room-render", "clinician-pointing-panoramic-xray-laptop", "braces-patient-syringe-close-up", "nurse-blood-pressure-older-man"];
const CARD_IMG = { dental: "dental-chair-blue-room-render", aesthetic: "face-surgical-markings-gloved-hands", hair: "hair-graft-preparation" };
const SERVICE_IMG = { dental: "dentist-loupes-led-lamp-patient", aesthetic: "face-surgical-markings-gloved-hands", hair: "hair-graft-preparation" };
const TREATMENT_ROUTE = { dental: "dental", aesthetic: "aesthetic", hair: "hair" };
/* The old gallery: one large photograph and five small ones, same photographs, same order. */
const GALLERY = ["dental-chair-blue-room-render", "nurse-blood-pressure-older-man", "smile-before-after-full-arch", "dentist-adjusting-lamp-seated-patient", "braces-patient-instrument-close-up-tall", "clinician-examining-woman-lower-face"];

/* The largest JPEG of a projected image: what a gallery link opens without JavaScript. */
const topJpg = (img) => `${img.base}-${img.widths[img.widths.length - 1]}.jpg`;

/* What gallery.js needs to show one photograph at full size, carried on its thumbnail link: the AVIF and
   WebP srcsets (the lightbox negotiates like any picture), the JPEG, the alt text and the size. */
function galleryData(ctx, slug, f) {
  if (!f) return "";
  const { esc, R } = ctx;
  return ` data-full="${esc(topJpg(f))}" data-avif="${esc(R.srcset(f, "avif"))}" data-srcset="${esc(R.srcset(f, "webp"))}" data-caption="${esc(ctx.alt(slug))}" data-w="${f.w}" data-h="${f.h}"`;
}

/* The dialog gallery.js opens. It follows its gallery as the next sibling, and is hidden by CSS until
   opened; without JavaScript it is never shown and the links open the JPEGs instead. */
export function lightbox(ctx, key = "g1") {
  const { esc, t } = ctx;
  /* the caption names the photograph; aria-describedby reads it when the dialog opens, and the live
     figcaption announces caption and position on every step */
  return `<div class="lightbox" data-lightbox role="dialog" aria-modal="true" aria-hidden="true" tabindex="-1" aria-label="${esc(t("gallery.dialog"))}" aria-describedby="lb-cap-${key}">
      <button class="lb-btn lb-close" type="button" aria-label="${esc(t("gallery.close"))}">${ICON.close}</button>
      <button class="lb-btn lb-prev" type="button" aria-label="${esc(t("gallery.prev"))}">${ICON.prev}</button>
      <figure class="lightbox__fig"><picture><source class="lb-avif" type="image/avif" sizes="90vw"><source class="lb-webp" type="image/webp" sizes="90vw"><img class="lightbox__img" alt="" width="1600" height="900" decoding="async"></picture><figcaption class="lightbox__cap" id="lb-cap-${key}" aria-live="polite"><span class="lightbox__text"></span> <span class="lightbox__count" data-counter="${esc(t("gallery.counter", { i: "{i}", n: "{n}" }))}"></span></figcaption></figure>
      <button class="lb-btn lb-next" type="button" aria-label="${esc(t("gallery.next"))}">${ICON.next}</button>
    </div>`;
}

/* A card title links to its treatment page once that route exists (Session 3), never to a 404. */
function titleLink(ctx, key, text, tag = "h3", cls = "card__title") {
  const { esc } = ctx;
  const id = TREATMENT_ROUTE[key];
  return ctx.hasRoute(id)
    ? `<${tag} class="${cls}"><a href="${ctx.route(id)}">${esc(text)}</a></${tag}>`
    : `<${tag} class="${cls}">${esc(text)}</${tag}>`;
}

function slider(ctx) {
  const { esc, t } = ctx;
  const n = SLIDES.length;
  let preload = "";
  const slides = SLIDES.map((slug, i) => {
    const h = heroPicture(ctx, slug, { eager: i === 0 });
    if (i === 0) preload = h.preload;
    return `      <figure class="slide${i === 0 ? " is-active" : ""}" role="group" aria-roledescription="slide" aria-label="${esc(t("slider.slide", { i: i + 1, n }))}"${i === 0 ? "" : " hidden"}>${h.html}</figure>`;
  }).join("\n");
  const dots = SLIDES.map((_, i) => `<li><button class="slider__dot" type="button" data-go="${i}" aria-label="${esc(t("slider.goto", { i: i + 1 }))}"${i === 0 ? ' aria-current="true"' : ""}></button></li>`).join("");
  /* aria-roledescription belongs on the labelled section: on a generic div browsers drop it */
  const html = `<section class="hero" aria-label="${esc(t("slider.label"))}" aria-roledescription="${esc(t("slider.roledesc"))}">
  <div class="slider" data-slider data-msg-pause="${esc(t("slider.pause"))}" data-msg-play="${esc(t("slider.play"))}">
    <div class="slider__controls" hidden>
      <button class="slider__btn slider__toggle" type="button" data-toggle aria-label="${esc(t("slider.pause"))}">${ICON.pause}${ICON.play}</button>
      <button class="slider__btn" type="button" data-prev aria-label="${esc(t("slider.prev"))}">${ICON.prev}</button>
      <button class="slider__btn" type="button" data-next aria-label="${esc(t("slider.next"))}">${ICON.next}</button>
      <ul class="slider__dots">${dots}</ul>
    </div>
    <div class="slider__track" aria-live="off">
${slides}
    </div>
    <span class="slider__progress" aria-hidden="true" hidden></span>
  </div>
</section>`;
  return { html, preload };
}

/* ---------- home ---------- */
export function home(ctx) {
  const { esc, t } = ctx;
  const c = ctx.copy.home;
  const hero = slider(ctx);
  const cards = ["dental", "aesthetic", "hair"].map((k) => `      <li class="card" data-reveal>
        <div class="card__media">${pic(ctx, CARD_IMG[k], "card", { sizes: "(min-width: 1100px) 360px, (min-width: 700px) 30vw, 92vw" })}</div>
        <div class="card__body">
          ${titleLink(ctx, k, c.services.cards[k].title)}
          <p>${esc(c.services.cards[k].text)}</p>
        </div>
      </li>`).join("\n");
  const n = GALLERY.length;
  const full = (slug) => ctx.img.proj(`${slug}--full`);
  const thumbs = GALLERY.map((slug, i) => {
    const f = full(slug);
    return `        <li><a class="gallery__thumb${i === 0 ? " is-selected" : ""}" href="${f ? topJpg(f) : "#"}" data-index="${i}"${galleryData(ctx, slug, f)} aria-label="${esc(`${ctx.alt(slug)}. ${t("gallery.select", { i: i + 1, n })}`)}"${i === 0 ? ' aria-current="true"' : ""}>${pic(ctx, slug, "thumb", { sizes: "(min-width: 1100px) 150px, 16vw", decorative: true })}</a></li>`;
  }).join("\n");
  const first = full(GALLERY[0]);
  const main = `
${hero.html}
<section class="intro" aria-labelledby="page-h1">
  <div class="intro__bg">${pic(ctx, "dentist-adjusting-lamp-seated-patient", "bg", { sizes: "(max-width: 700px) 45vw, 100vw", decorative: true, eager: true })}</div>
  <div class="container intro__inner entrance">
    <h1 id="page-h1" class="intro__h1">${esc(c.h1)}</h1>
    <p class="statement">${esc(c.statement)}</p>
    ${SWOOSH}
    <p class="intro__sub">${esc(c.subline)}</p>
    <div class="actions">
      ${link(ctx, "whatsapp", { cls: "btn btn--gold", inner: `${ICON.chat}<span>${esc(c.ctaBook)}</span>` })}
      ${link(ctx, "phone", { arg: 0, cls: "btn btn--ghost", inner: `${ICON.phone}<span>${esc(c.ctaCall)}</span>` })}
    </div>
  </div>
</section>
<section class="section welcome" aria-labelledby="welcome-h">
  <div class="container">
    <h2 id="welcome-h" class="section-title" data-reveal>${esc(c.welcome.h2)}</h2>
    <div class="welcome__cols">
      <div class="welcome__col" data-reveal>
        <h3>${esc(c.welcome.mission.h3)}</h3>
${c.welcome.mission.p.map((p) => `        <p>${esc(p)}</p>`).join("\n")}
      </div>
      <div class="welcome__col" data-reveal>
        <h3>${esc(c.welcome.offer.h3)}</h3>
${c.welcome.offer.p.map((p) => `        <p>${esc(p)}</p>`).join("\n")}
      </div>
    </div>
    <figure class="welcome__photo" data-reveal>${pic(ctx, "clinic-corridor-numbered-rooms", "wide", { sizes: "(min-width: 1280px) 1200px, 94vw" })}</figure>
  </div>
</section>
<section class="section section--ice services" aria-labelledby="services-h">
  <div class="container">
    <header class="section-head" data-reveal>
      <h2 id="services-h" class="section-title">${esc(c.services.h2)}</h2>
      <p class="lead">${esc(c.services.lead)}</p>
    </header>
    <ul class="cards">
${cards}
    </ul>
  </div>
</section>
<section class="section gallery-section" aria-labelledby="gallery-h">
  <div class="container">
    <header class="section-head" data-reveal>
      <h2 id="gallery-h" class="section-title">${esc(c.gallery.h2)}</h2>
      <p class="lead">${esc(c.gallery.lead)}</p>
    </header>
    <div class="gallery" data-gallery data-reveal data-msg-open="${esc(t("gallery.open", { i: "{i}", n: "{n}" }))}">
      <figure class="gallery__main">
        <a class="gallery__stage" href="${first ? topJpg(first) : "#"}" aria-label="${esc(`${ctx.alt(GALLERY[0])}. ${t("gallery.open", { i: 1, n })}`)}">${pic(ctx, GALLERY[0], "full", { sizes: "(min-width: 1100px) 1000px, 94vw" })}</a>
      </figure>
      <ul class="gallery__thumbs">
${thumbs}
      </ul>
    </div>
    ${lightbox(ctx)}
  </div>
</section>
<section class="section section--ice quote" id="quote" aria-labelledby="quote-h">
  <div class="container container--narrow">
    <header class="section-head" data-reveal>
      <h2 id="quote-h" class="section-title">${esc(c.quote.h2)}</h2>
      <p class="lead">${esc(c.quote.lead)}</p>
    </header>
    ${w3fForm(ctx, { id: "quote-form", path: ctx.route("home"), subject: c.quote.subject, label: c.quote.h2 })}
  </div>
</section>`;
  return layout(ctx, { route: "home", title: c.title, description: c.description, main, preload: hero.preload, styles: ["/assets/css/home.css"], scripts: ["/assets/js/slider.js", "/assets/js/gallery.js", "/assets/js/forms.js"] });
}

/* ---------- services ---------- */
export function services(ctx) {
  const { esc, t, site } = ctx;
  const c = ctx.copy.services;
  const items = ["dental", "aesthetic", "hair"].map((k, i) => `    <li class="service${i % 2 ? " service--flip" : ""}" data-reveal>
      <div class="service__body">
        ${titleLink(ctx, k, c.cards[k].title, "h2", "service__title")}
        <p>${esc(c.cards[k].text)}</p>
      </div>
      <div class="service__media">${pic(ctx, SERVICE_IMG[k], "banner", { sizes: "(min-width: 1100px) 620px, 94vw", eager: i === 0 })}</div>
    </li>`).join("\n");
  const main = `
${pageHeader(ctx, { h1: c.h1, lead: c.lead })}
<section class="section section--flush">
  <div class="container">
    <ul class="service-list">
${items}
    </ul>
  </div>
</section>
<section class="section section--ice" aria-labelledby="contact-h">
  <div class="container contact-split">
    <div class="contact-split__info" data-reveal>
      <h2 id="contact-h" class="section-title">${esc(c.contact.h2)}</h2>
      ${SWOOSH}
      <dl class="contact-list">
        <div><dt>${esc(t("footer.phone"))}</dt><dd>${link(ctx, "phone", { arg: 0 })}</dd></div>
        <div><dt>${esc(t("footer.email"))}</dt><dd>${link(ctx, "email")}</dd></div>
      </dl>
    </div>
    ${w3fForm(ctx, { id: "services-form", path: ctx.route("services"), subject: c.contact.subject, label: c.contact.h2 })}
  </div>
</section>`;
  return layout(ctx, { route: "services", title: c.title, description: c.description, main, scripts: ["/assets/js/forms.js"] });
}

/* ---------- treatment pages ----------
   The old site's sections in the old order. Copy lives in content/<lang>/pages/<key>.json; the layout and
   the image slots live here. A slot holding TODO-IMAGE renders a placeholder tile until the photograph
   arrives: replace it with the image's slug from data/images.json. */
const T = "TODO-IMAGE";
const TREATMENTS = {
  /* The old site's own photographs, slot for slot. TODO-IMAGE remains where the old image may not be
     used: the dental testimonial photos carry the old logo, and the others are excluded third-party images. */
  dental: [
    ["intro", "intro"],
    ["photos", "", { imgs: ["dentist-treating-patient-cheek-retractor-bw", "dentist-loupes-led-lamp-patient"] }],
    ["detail", "restorative"],
    ["photos", "", { imgs: ["implant-bridge-3d-render", "single-implant-crown-cross-section-illustration", "full-arch-six-implants-render", "lower-overdenture-two-implants-render"] }],
    ["detail", "orthodontics", { ice: true, side: ["braces-models-coloured-ligatures", "clear-aligner-held-smile-closeup"] }],
    ["detail", "cosmetic", { side: ["smile-half-white-teeth-closeup", "smile-half-yellowish-teeth-closeup"] }],
    ["detail", "general", { ice: true }],
    ["photos", "", { ice: true, imgs: ["molar-inlay-filling-3d-render", "tooth-extraction-forceps-3d-render", "root-canal-file-molar-cross-section", "tilted-molar-against-neighbour-3d"] }],
    ["closing", "closing", { below: ["clinician-pointing-panoramic-xray-laptop", "smile-design-guide-lines-overlay", "nurse-blood-pressure-older-man"] }],
    ["testimonials", "testimonials", { sep: true, imgs: [T, T, T, T] }],
    ["form", "form", { sep: true }],
  ],
  aesthetic: [
    ["intro", "intro", { lead: true }],
    ["photos", "", { imgs: ["nose-profiles-split-mono-colour", T] }],
    ["detail", "rhinoplasty"],
    ["photos", "", { imgs: ["woman-profile-yellow-backdrop", "gloved-hand-marker-on-nose", "woman-nose-lips-profile-closeup"] }],
    ["detail", "septoplasty", { ice: true, below: ["nose-bridge-profile-diptych-arrows", "nasal-speculum-exam-surgical-cap", "nose-bridge-upturned-diptych-arrows"] }],
    ["detail", "otoplasty", { below: ["otoplasty-rear-view-before-after-brown-hair", "otoplasty-ear-closeup-before-after-stubble", "otoplasty-ear-profile-before-after-black-background"] }],
    ["why", "why", { ice: true }],
    ["testimonials", "testimonials", { imgs: ["nose-profiles-split-mono-colour", "rhinoplasty-profile-before-after-dark-backdrop", T, "otoplasty-ear-closeup-before-after-stubble"] }],
    ["form", "form", { sep: true }],
  ],
  hair: [
    ["intro", "intro", { lead: true }],
    ["photos", "", { imgs: ["hair-transplant-hairline-marking-gloved-hands", "hair-transplant-front-view-before-after-bearded-man"] }],
    ["detail", "fue"],
    ["detail", "dhi"],
    ["photos", "", { imgs: ["hair-transplant-young-man-hands-on-head-before-after", "hair-transplant-scalp-grafts-and-regrowth-top-view", "hair-transplant-temple-hairline-side-before-after"] }],
    ["detail", "aftercare", { ice: true, below: ["scalp-exam-handheld-scope-monitor", "hair-transplant-marking-scalp-blue-marker"], narrow: true }],
    ["detail", "who"],
    ["why", "why", { ice: true }],
    ["testimonials", "testimonials", { imgs: ["hair-transplant-scalp-grafts-and-regrowth-top-view", T, "hair-transplant-temple-hairline-side-before-after", T] }],
    ["videos", "videos", { sep: true, files: [
      { src: "testimonial-hair-1", w: 720, h: 1280 },
      { src: "testimonial-hair-2", w: 720, h: 1280 },
    ] }],
  ],
};
const STAR = '<svg viewBox="0 0 20 20" width="16" height="16" focusable="false"><path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z"/></svg>';
/* shape of a slot by how many share its row: a pair is wide, four are square, the rest 4:3 */
const SHAPE = { 2: "wide", 3: "photo", 4: "square" };

function slot(ctx, slug, shape, sizes) {
  const { esc, t, R } = ctx;
  if (R.isTodo(slug)) return `<div class="ph-photo ph-photo--${shape}" data-placeholder="${esc(slug)}" aria-hidden="true"><span>${esc(t("todo.image"))}</span></div>`;
  return `<figure class="treat-photo treat-photo--${shape}">${pic(ctx, slug, "full", { sizes })}</figure>`;
}
/* Phone sizes ask for about two thirds of the slot's width, so a 3x screen fetches a 2x rendition: no visible
   difference on a photograph, and the image-heavy treatment pages stay inside the page-weight budget. */
function photoRow(ctx, imgs, shape, extra = "") {
  const n = imgs.length;
  const sizes = n === 4 ? "(min-width: 1100px) 280px, (min-width: 761px) 23vw, 31vw"
    : n === 3 ? "(min-width: 1100px) 380px, (min-width: 561px) 31vw, 63vw"
    : "(min-width: 1100px) 600px, (min-width: 561px) 46vw, 63vw";
  return `<div class="treat-photos treat-photos--${n}${extra}" data-reveal>${imgs.map((s) => slot(ctx, s, shape || SHAPE[n], sizes)).join("")}</div>`;
}
function paras(ctx, list, firstCls) {
  return (list || []).map((p, i) => `<p${i === 0 && firstCls ? ` class="${firstCls}"` : ""}>${ctx.esc(p)}</p>`).join("\n        ");
}
function bullets(ctx, list, mod = "") {
  return list && list.length ? `<ul class="treat-list${mod}">${list.map((i) => `<li>${ctx.esc(i)}</li>`).join("")}</ul>` : "";
}

export function treatment(ctx, key) {
  const { esc } = ctx;
  const c = ctx.copy[key];
  const spec = TREATMENTS[key];
  let prevIce = false;
  let hasForm = false;
  const parts = spec.map(([kind, name, o = {}], i) => {
    const ice = !!o.ice;
    const cls = `section${ice ? " section--ice" : ""}${i > 0 && ice === prevIce && !o.sep ? " section--join" : ""}`;
    prevIce = ice;
    const s = c[name];
    const hid = `${key}-${name || "photos"}-${i}`;
    if (kind === "photos") {
      return `<div class="${cls}"><div class="container">${photoRow(ctx, o.imgs)}</div></div>`;
    }
    if (kind === "intro") {
      return `<section class="${cls}" aria-labelledby="${hid}">
  <div class="container treat__cols">
    <h2 id="${hid}" class="treat__title" data-reveal>${esc(s.h2)}</h2>
    <div class="treat__body" data-reveal>
        ${paras(ctx, s.p, o.lead ? "treat__lead" : "")}
    </div>
  </div>
</section>`;
    }
    if (kind === "detail") {
      const head = s.h2 ? `<h2 id="${hid}" class="treat__title">${esc(s.h2)}</h2>` : "";
      /* the old pages repeat the section title as a small label over the text; a copy of the heading, so
         screen readers skip it */
      const sub = s.h3
        ? `<h3${s.h2 ? "" : ` id="${hid}"`} class="treat__sub">${esc(s.h3)}</h3>`
        : `<p class="treat__sub" aria-hidden="true">${esc(s.h2)}</p>`;
      const side = o.side ? photoRow(ctx, o.side, "photo") : "";
      const below = o.below ? `\n  <div class="container treat__below">${photoRow(ctx, o.below, "", o.narrow ? " treat-photos--narrow" : "")}</div>` : "";
      return `<section class="${cls}" aria-labelledby="${hid}">
  <div class="container treat__cols">
    <div class="treat__head" data-reveal>${head}${side}</div>
    <div class="treat__body" data-reveal>
        ${sub}
        ${paras(ctx, s.p)}
        ${bullets(ctx, s.items)}
        ${paras(ctx, s.after)}
    </div>
  </div>${below}
</section>`;
    }
    if (kind === "closing" || kind === "why") {
      const cta = s.cta ? `<p class="actions"><a class="btn btn--primary" href="${ctx.route("contact")}">${esc(s.cta)}</a></p>` : "";
      const below = o.below ? `\n  <div class="container treat__below">${photoRow(ctx, o.below)}</div>` : "";
      const lead = kind === "closing" ? paras(ctx, s.p) : "";
      const rest = kind === "closing"
        ? `${bullets(ctx, s.items, " treat-list--inline")}\n      ${paras(ctx, s.after)}`
        : `${bullets(ctx, s.items, " treat-list--plain")}\n      <h3 class="section-title treat__second">${esc(s.h3)}</h3>\n      ${paras(ctx, s.p)}\n      ${cta}\n      ${paras(ctx, s.after)}`;
      return `<section class="${cls}" aria-labelledby="${hid}">
  <div class="container container--narrow treat-center" data-reveal>
      <h2 id="${hid}" class="section-title">${esc(s.h2)}</h2>
      ${SWOOSH}
      ${lead}
      ${rest}
  </div>${below}
</section>`;
    }
    if (kind === "form") {
      hasForm = true;
      return `<section class="${cls} quote" aria-labelledby="${hid}">
  <div class="container container--narrow">
    <header class="section-head" data-reveal>
      <h2 id="${hid}" class="section-title">${esc(s.h2)}</h2>
    </header>
    ${w3fForm(ctx, { id: `${key}-form`, path: ctx.route(key), subject: s.subject, label: s.h2 })}
  </div>
</section>`;
    }
    /* Shown at the user's request. The owner still has to confirm each patient's consent: the marker makes
       check-placeholders --launch fail until it is removed. */
    if (kind === "testimonials") {
      const stars = `<span class="stars" aria-hidden="true">${STAR.repeat(5)}</span><span class="visually-hidden">${esc(ctx.t("testimonials.rating"))}</span>`;
      const cards = s.quotes.map((q, k) => `    <li data-reveal><figure class="quote-card">
      ${slot(ctx, o.imgs[k], "tall", "160px")}
      <div class="quote-card__body">
        <blockquote>${q.title ? `<p class="quote-card__title">${esc(q.title)}</p>` : ""}<p>${esc(q.text)}</p></blockquote>
        <p class="quote-card__stars">${stars}</p>
      </div>
      <figcaption class="quote-card__name">${esc(q.name)}</figcaption>
    </figure></li>`).join("\n");
      return `<section class="${cls}" aria-labelledby="${hid}" data-consent="TODO-CONSENT">
  <div class="container">
    <h2 id="${hid}" class="section-title treat-center" data-reveal>${esc(s.h2)}</h2>
    <ul class="quote-grid">
${cards}
    </ul>
  </div>
</section>`;
    }
    if (kind === "videos") {
      const vids = o.files.map((f, k) => `      <video controls preload="none" playsinline width="${f.w}" height="${f.h}" poster="${ctx.asset(`/assets/video/${f.src}.jpg`)}" aria-label="${esc(s.labels[k])}"><source src="${ctx.asset(`/assets/video/${f.src}.mp4`)}" type="video/mp4"></video>`).join("\n");
      return `<section class="${cls}" aria-labelledby="${hid}" data-consent="TODO-CONSENT">
  <div class="container treat-center" data-reveal>
    <h2 id="${hid}" class="section-title">${esc(s.h2)}</h2>
    ${SWOOSH}
    <p class="lead">${esc(s.lead)}</p>
    <div class="video-grid">
${vids}
    </div>
  </div>
</section>`;
    }
    throw new Error(`treatment ${key}: unknown section kind ${kind}`);
  });
  const main = `
${pageHeader(ctx, { h1: c.h1 })}
${parts.join("\n")}`;
  return layout(ctx, { route: key, title: c.title, description: c.description, main, scripts: hasForm ? ["/assets/js/forms.js"] : [] });
}

/* ---------- contact ---------- */
export function contactPage(ctx) {
  const { esc, t, site } = ctx;
  const c = ctx.copy.contact;
  const main = `
<section class="contact-hero" aria-labelledby="page-h1">
  <div class="contact-hero__bg">${pic(ctx, "clinic-corridor-numbered-rooms", "bg", { sizes: "100vw", decorative: true, eager: true })}</div>
  <div class="container contact-hero__inner">
    <div class="contact-hero__intro entrance">
      <h1 id="page-h1">${esc(c.h1)}</h1>
      ${SWOOSH}
      <p class="lead">${esc(c.lead)}</p>
      <dl class="contact-list contact-list--light">
        <div><dt>${esc(t("footer.phone"))}</dt><dd>${link(ctx, "phone", { arg: 0 })}</dd></div>
        <div><dt>${esc(t("footer.email"))}</dt><dd>${link(ctx, "email")}</dd></div>
      </dl>
    </div>
    <div class="contact-hero__form">
      ${w3fForm(ctx, { id: "contact-form", path: ctx.route("contact"), subject: c.subject, label: c.formLabel })}
    </div>
  </div>
</section>
<section class="section location" aria-labelledby="location-h">
  <div class="container">
    <h2 id="location-h" class="section-title" data-reveal>${esc(c.location.h2)}</h2>
    <p class="lead" data-reveal>${esc(c.location.lead)}</p>
    <dl class="info-card">
      <div data-reveal><dt>${ICON.pin}<span>${esc(c.location.address)}</span></dt><dd>${valueOrTodo(ctx, site.address)}</dd></div>
      <div data-reveal><dt>${ICON.clock}<span>${esc(c.location.hours)}</span></dt><dd>${valueOrTodo(ctx, site.hours)}</dd></div>
    </dl>
    <p class="actions" data-reveal>${link(ctx, "map", { cls: "btn btn--outline", inner: `${ICON.pin}<span>${esc(c.location.map)}</span>` })}</p>
  </div>
</section>`;
  return layout(ctx, { route: "contact", title: c.title, description: c.description, main, scripts: ["/assets/js/forms.js"] });
}

/* ---------- legal ---------- */
function draftNote(ctx, key) {
  return ctx.R.isTodo(ctx.site.legalReview[key]) ? `<p class="draft-note" data-todo="${ctx.esc(ctx.site.legalReview[key])}">${ctx.esc(ctx.t("legal.draft"))}</p>` : "";
}

export function privacy(ctx) {
  const { esc, site } = ctx;
  const c = ctx.copy.privacy;
  const fills = { entity: site.legal.entity, address: site.legal.address, email: site.email, retention: site.legal.retention };
  const fill = (p) => esc(p).replace(/\{(\w+)\}/g, (m, k) => (fills[k] != null ? valueOrTodo(ctx, fills[k]) : m));
  const main = `
${pageHeader(ctx, { h1: c.h1, lead: c.lead })}
<section class="section section--flush">
  <div class="container prose">
    ${draftNote(ctx, "privacy")}
${c.sections.map((s) => `    <h2>${esc(s.h)}</h2>\n${s.p.map((p) => `    <p>${fill(p)}</p>`).join("\n")}`).join("\n")}
  </div>
</section>`;
  return layout(ctx, { route: "privacy", title: c.title, description: c.description, main });
}

export function imprint(ctx) {
  const { esc, t, site } = ctx;
  const c = ctx.copy.imprint;
  const L = site.legal;
  const credits = (ctx.credits.images || []).filter((cr) => ctx.renderedStock.has(cr.slug));
  const main = `
${pageHeader(ctx, { h1: c.h1, lead: c.lead })}
<section class="section section--flush">
  <div class="container prose">
    ${draftNote(ctx, "imprint")}
    <dl class="facts">
      <div><dt>${esc(c.rows.provider)}</dt><dd>${valueOrTodo(ctx, L.entity)}<br>${valueOrTodo(ctx, L.address)}</dd></div>
      <div><dt>${esc(c.rows.representative)}</dt><dd>${valueOrTodo(ctx, L.representative)}</dd></div>
      <div><dt>${esc(c.rows.contact)}</dt><dd>${link(ctx, "email")}<br>${link(ctx, "phone", { arg: 0 })}</dd></div>
      <div><dt>${esc(c.rows.registration)}</dt><dd>${valueOrTodo(ctx, L.registration)}</dd></div>
      <div><dt>${esc(c.rows.vat)}</dt><dd>${valueOrTodo(ctx, L.vat)}</dd></div>
    </dl>
    <h2>${esc(c.activity.h)}</h2>
    <p>${esc(c.activity.p)}</p>
    <h2 id="credits">${esc(c.credits.h)}</h2>
    <ul class="credits">
${credits.map((cr) => `      <li><q>${esc(cr.title)}</q>, ${esc(t("legal.creditLine", { author: cr.author, licence: cr.licence }))}. <a href="${esc(cr.source_url)}" rel="noopener">${esc(t("legal.source"))}</a>, <a href="${esc(cr.licence_url)}" rel="noopener">${esc(cr.licence)}</a>.</li>`).join("\n")}
    </ul>
    <p>${esc(c.credits.fonts)}</p>
  </div>
</section>`;
  return layout(ctx, { route: "imprint", title: c.title, description: c.description, main });
}

/* ---------- 404 ----------
   Cloudflare serves the root 404 for an unknown path at any depth, so there is one, in German, the root
   language, with a line in each other language pointing at that language's home page. */
export function notFound(ctx) {
  const { esc, t } = ctx;
  const c = ctx.copy.notfound;
  const others = ctx.langs.filter((l) => l.code !== ctx.lang.code).map((l) => {
    const oc = ctx.copyOf(l.code).notfound;
    return `      <li lang="${esc(l.code)}"><a href="${esc(ctx.routeIn(l.code, "home"))}" hreflang="${esc(l.code)}">${esc(oc.other)}</a></li>`;
  }).join("\n");
  const main = `
${pageHeader(ctx, { h1: c.h1, lead: c.lead })}
<section class="section section--flush">
  <div class="container prose">
    <p>${esc(c.links)}</p>
    <ul>
      <li><a href="${ctx.route("home")}">${esc(t("nav.home"))}</a></li>
      <li><a href="${ctx.route("services")}">${esc(t("nav.services"))}</a></li>
      <li><a href="${ctx.route("contact")}">${esc(t("nav.contact"))}</a></li>
    </ul>
    <ul class="other-langs">
${others}
    </ul>
  </div>
</section>`;
  return layout(ctx, { route: "notFound", title: c.title, description: `${c.lead} ${c.links}`, main, noindex: true });
}
