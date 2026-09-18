/* European Dental gallery: stage, thumbnails, lightbox. No library; instant under reduced motion; without
   it every thumbnail and the stage are plain links to the JPEG. Markup: _tools/templates/pages.mjs.
   The dialog is moved to <body> so the page behind it can be made inert. */
(function () {
  "use strict";
  var calm = (window.ED && window.ED.calm) || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
  var ED = window.ED || {};

  /* the width the photograph is shown at (capped by width and height), so the right rendition loads */
  function lightboxSize(t) {
    var w = Number(t.getAttribute("data-w")) || 1600, h = Number(t.getAttribute("data-h")) || 900;
    var phone = window.innerWidth <= 640;
    var byWidth = phone ? window.innerWidth * 0.94 : Math.min(1200, window.innerWidth * 0.86);
    var byHeight = window.innerHeight * (phone ? 0.72 : 0.8) * w / h;
    return Math.max(160, Math.round(Math.min(byWidth, byHeight))) + "px";
  }
  function whenDecoded(img, fn) {
    var done = false, go = function () { if (!done) { done = true; fn(); } };
    if (img.decode) img.decode().then(go, go); else if (img.complete) go(); else img.addEventListener("load", go);
  }

  [].forEach.call(document.querySelectorAll("[data-gallery]"), function (gal) {
    var stage = gal.querySelector(".gallery__stage");
    var thumbs = [].slice.call(gal.querySelectorAll(".gallery__thumb"));
    if (!stage || !thumbs.length) return;
    var n = thumbs.length;
    var openTpl = gal.getAttribute("data-msg-open") || "{i} / {n}";
    var current = 0;
    thumbs.forEach(function (t, k) { if (t.classList.contains("is-selected")) current = k; });

    function pictureFor(t, sizes) {
      var pic = document.createElement("picture");
      var a = document.createElement("source");
      a.type = "image/avif"; a.srcset = t.getAttribute("data-avif") || ""; a.sizes = sizes;
      var w = document.createElement("source");
      w.type = "image/webp"; w.srcset = t.getAttribute("data-srcset") || ""; w.sizes = sizes;
      var img = document.createElement("img");
      img.src = t.getAttribute("data-full");
      img.alt = t.getAttribute("data-caption") || "";
      img.width = Number(t.getAttribute("data-w")) || 1600;
      img.height = Number(t.getAttribute("data-h")) || 900;
      img.decoding = "async";
      pic.appendChild(a); pic.appendChild(w); pic.appendChild(img);
      return pic;
    }
    function stageLabel(i) {
      var cap = thumbs[i].getAttribute("data-caption");
      return (cap ? cap + ". " : "") + openTpl.replace("{i}", i + 1).replace("{n}", n);
    }

    /* ---------- the stage ---------- */
    function select(i, focusThumb) {
      i = (i + n) % n;
      if (i === current) { if (focusThumb) thumbs[i].focus(); return; }
      var t = thumbs[i];
      var old = stage.querySelector("img");
      var layer = pictureFor(t, (old && old.sizes) || "100vw");
      if (!calm) layer.style.opacity = "0";
      stage.appendChild(layer);
      var drop = function () {
        /* only the layers underneath this one go: a newer layer added meanwhile stays */
        while (layer.previousElementSibling && layer.previousElementSibling.tagName === "PICTURE") layer.previousElementSibling.remove();
      };
      whenDecoded(layer.querySelector("img"), function () {
        if (calm || !layer.animate) { layer.style.opacity = ""; drop(); return; }
        var anim = layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: EASE, fill: "forwards" });
        anim.onfinish = function () { layer.style.opacity = ""; anim.cancel(); drop(); };
      });
      thumbs.forEach(function (x, k) {
        x.classList.toggle("is-selected", k === i);
        if (k === i) x.setAttribute("aria-current", "true"); else x.removeAttribute("aria-current");
      });
      stage.setAttribute("href", t.getAttribute("href"));
      stage.setAttribute("aria-label", stageLabel(i));
      current = i;
      if (focusThumb) t.focus();
    }
    thumbs.forEach(function (t, k) {
      t.addEventListener("click", function (e) { e.preventDefault(); select(k, false); });
    });
    /* arrows move from the thumbnail that has focus, which Tab may have moved away from the selected one */
    gal.querySelector(".gallery__thumbs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      var k = thumbs.indexOf(document.activeElement);
      if (k < 0) k = current;
      select(k + (e.key === "ArrowRight" ? 1 : -1), true);
    });

    /* ---------- the lightbox ---------- */
    var lb = gal.nextElementSibling;
    if (!lb || !lb.hasAttribute("data-lightbox")) return;
    document.body.appendChild(lb);
    var img = lb.querySelector(".lightbox__img");
    var srcAvif = lb.querySelector(".lb-avif"), srcWebp = lb.querySelector(".lb-webp");
    var count = lb.querySelector(".lightbox__count");
    var text = lb.querySelector(".lightbox__text");
    var closeBtn = lb.querySelector(".lb-close");
    var tpl = (count && count.getAttribute("data-counter")) || "{i} / {n}";
    var shown = 0, lastFocus = null, token = 0;

    function setFor(t) {
      var m = /\.(avif|webp)(?:$|[?#])/.exec(img.currentSrc || "");
      return (m && t.getAttribute(m[1] === "avif" ? "data-avif" : "data-srcset")) || "";
    }
    function preloadNeighbours() {
      [shown + 1, shown - 1].forEach(function (k) {
        var t = thumbs[(k + n) % n];
        if (!t || t === thumbs[shown]) return;
        var pre = new Image(), set = setFor(t);
        if (set) { pre.sizes = lightboxSize(t); pre.srcset = set; } else { pre.src = t.getAttribute("data-full"); }
      });
    }
    /* photograph i, hidden until decoded so a stale one never shows under the new counter */
    function fill(i, then) {
      shown = (i + n) % n;
      var t = thumbs[shown], mine = ++token;
      var size = lightboxSize(t);
      img.style.opacity = "0";
      srcAvif.sizes = size; srcWebp.sizes = size;
      srcAvif.srcset = t.getAttribute("data-avif") || "";
      srcWebp.srcset = t.getAttribute("data-srcset") || "";
      img.removeAttribute("srcset");
      img.width = Number(t.getAttribute("data-w")) || 1600;
      img.height = Number(t.getAttribute("data-h")) || 900;
      img.src = t.getAttribute("data-full");
      img.alt = t.getAttribute("data-caption") || "";
      if (count) count.textContent = tpl.replace("{i}", shown + 1).replace("{n}", n);
      if (text) text.textContent = t.getAttribute("data-caption") || "";
      whenDecoded(img, function () {
        if (mine !== token) return;   /* a newer photograph was asked for meanwhile */
        img.style.opacity = "";
        preloadNeighbours();
        if (then) then();
      });
    }
    function step(i) {
      fill(i, function () {
        if (!calm && img.animate) img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: EASE });
      });
    }
    function isOpen() { return lb.classList.contains("is-open"); }
    function open(i) {
      var ae = document.activeElement;
      /* Safari does not focus a clicked link, so fall back to the stage that opened the dialog */
      lastFocus = ae && ae !== document.body ? ae : stage;
      var from = stage.getBoundingClientRect();
      lb.classList.add("is-open");
      lb.setAttribute("aria-hidden", "false");
      if (ED.lockScroll) ED.lockScroll();
      if (ED.inertBehind) ED.inertBehind(true, lb);
      closeBtn.focus();
      fill(i, function () {
        /* grow out of the stage, measured now that the photograph has its real box */
        if (calm || !img.animate || !isOpen()) return;
        var to = img.getBoundingClientRect();
        if (!to.width || !from.width) return;
        var s = from.width / to.width;
        var dx = from.left + from.width / 2 - (to.left + to.width / 2);
        var dy = from.top + from.height / 2 - (to.top + to.height / 2);
        img.animate([{ transform: "translate(" + dx + "px, " + dy + "px) scale(" + s + ")", opacity: 0.6 }, { transform: "none", opacity: 1 }], { duration: 380, easing: EASE });
      });
    }
    function close() {
      if (!isOpen()) return;
      token++;
      lb.classList.remove("is-open");
      lb.setAttribute("aria-hidden", "true");
      if (ED.inertBehind) ED.inertBehind(false, lb);
      if (ED.unlockScroll) ED.unlockScroll();
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    stage.addEventListener("click", function (e) { e.preventDefault(); open(current); });
    closeBtn.addEventListener("click", close);
    lb.querySelector(".lb-next").addEventListener("click", function () { step(shown + 1); });
    lb.querySelector(".lb-prev").addEventListener("click", function () { step(shown - 1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
    /* bound to this dialog, not the document, so several galleries on one page never answer together */
    lb.addEventListener("keydown", function (e) {
      if (!isOpen()) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(shown + 1);
      else if (e.key === "ArrowLeft") step(shown - 1);
      else if (e.key === "Tab") {
        var f = [].filter.call(lb.querySelectorAll("button"), function (b) { return b.getClientRects().length; });
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === lb)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    var touchX = null;
    lb.addEventListener("touchstart", function (e) { touchX = e.changedTouches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", function (e) {
      if (touchX === null) return;
      var dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 40) step(dx < 0 ? shown + 1 : shown - 1);
      touchX = null;
    }, { passive: true });
  });
})();
