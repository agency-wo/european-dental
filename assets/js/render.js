/* European Dental renderer: strings, escaping, placeholders, pictures and WhatsApp links.
   Cut down from the shared renderer of an earlier build. The build loads it with createRequire; it is not
   shipped to the browser, because no page repaints anything from data. Every string that reaches HTML
   goes through esc(). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(null);
  else root.ED_RENDER = factory(root);
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  /* ---------- strings ---------- */
  var STR = {};
  var MISSING = [];
  function setStrings(s) { STR = s || {}; MISSING = []; }
  function missing() { return MISSING.slice(); }
  /* a missing key renders as the key and is recorded, so the build fails on it */
  function t(key, vars) {
    var s;
    if (Object.prototype.hasOwnProperty.call(STR, key)) s = String(STR[key]);
    else { s = key; if (MISSING.indexOf(key) < 0) MISSING.push(key); }
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; });
    return s;
  }

  /* ---------- text ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  /* typed dashes and curly quotes become ASCII (house rule: no em or en dashes), written as escapes */
  function textClean(s) {
    return String(s == null ? "" : s)
      .replace(/[\u2013\u2014\u2212]/g, "-").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  }
  function isTodo(v) { return typeof v === "string" && /^TODO/.test(v); }
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return String(iso || "");
    var months = t("date.months").split(",");
    return Number(m[3]) + ". " + (months[Number(m[2]) - 1] || m[2]) + " " + m[1];
  }

  /* ---------- pictures ---------- */
  function srcset(img, ext) {
    return img.widths.map(function (w) { return img.base + "-" + w + "." + ext + " " + w + "w"; }).join(", ");
  }
  /* o: sizes, alt, eager, cls, pos (object-position from the focal point) */
  function pictureHtml(img, o) {
    o = o || {};
    if (!img) return '<span class="ph" aria-hidden="true"></span>';
    var sizes = esc(o.sizes || "100vw"), top = img.widths[img.widths.length - 1];
    return "<picture>"
      + '<source type="image/avif" srcset="' + esc(srcset(img, "avif")) + '" sizes="' + sizes + '">'
      + '<source type="image/webp" srcset="' + esc(srcset(img, "webp")) + '" sizes="' + sizes + '">'
      + '<img src="' + esc(img.base + "-" + top + ".jpg") + '" srcset="' + esc(srcset(img, "jpg")) + '" sizes="' + sizes + '"'
      + ' width="' + Number(img.w) + '" height="' + Number(img.h) + '" alt="' + esc(o.alt || "") + '"'
      + (o.eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async"'
      + (o.cls ? ' class="' + esc(o.cls) + '"' : "") + "></picture>";
  }

  /* ---------- WhatsApp ---------- */
  function waLink(number, text) {
    var digits = String(number || "").replace(/[^\d]/g, "");
    return "https://wa.me/" + (digits || encodeURIComponent(String(number || ""))) + "?text=" + encodeURIComponent(text);
  }

  return {
    setStrings: setStrings, missing: missing, t: t,
    esc: esc, textClean: textClean, isTodo: isTodo, fmtDate: fmtDate,
    srcset: srcset, pictureHtml: pictureHtml, waLink: waLink
  };
});
