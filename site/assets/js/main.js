/* European Dental: site behaviour. No framework, no build step: the depth-counted scroll lock, the
   placeholder-link guard, the mobile drawer that keeps keyboard focus inside while it is open, and the
   motion layer. */
(function () {
  "use strict";
  window.ED = window.ED || {};

  /* ---------- scroll lock, shared with the lightbox ----------
     Counted, so closing one overlay while another is open cannot unlock the page. Pins the body rather
     than overflow:hidden, which iOS ignores. */
  var lockDepth = 0, lockY = 0;
  function lockScroll() {
    if (lockDepth++ > 0) return;
    lockY = Math.round(window.scrollY || window.pageYOffset || 0);
    var s = document.body.style;
    s.position = "fixed"; s.top = -lockY + "px"; s.left = "0"; s.right = "0";
  }
  function unlockScroll() {
    if (lockDepth === 0 || --lockDepth > 0) return;
    var s = document.body.style, html = document.documentElement, prev = html.style.scrollBehavior;
    s.position = ""; s.top = ""; s.left = ""; s.right = "";
    html.style.scrollBehavior = "auto";
    window.scrollTo(0, lockY);
    html.style.scrollBehavior = prev;
  }
  window.ED.lockScroll = lockScroll;
  window.ED.unlockScroll = unlockScroll;

  /* ---------- toast ---------- */
  var toastEl = document.querySelector(".toast"), toastTimer = 0;
  function toast(msg) {
    if (!toastEl || !msg) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 6500);
  }
  window.ED.toast = toast;

  /* A modal dialog moved to the end of <body> makes everything else inert while it is open, so neither Tab
     nor a screen reader's own navigation can reach the page it covers (gallery.js lightbox). */
  window.ED.inertBehind = function (on, keep) {
    [].forEach.call(document.body.children, function (el) {
      if (el === keep || el.tagName === "SCRIPT") return;
      if (on) el.setAttribute("inert", ""); else el.removeAttribute("inert");
    });
  };

  /* ---------- the placeholder guard ----------
     A placeholder phone number, WhatsApp link, email address, map or profile must never look like it
     worked. The build marks such links with data-todo-msg; the click is refused and the reason shown. */
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("[data-todo-msg]") : null;
    if (!a) return;
    e.preventDefault();
    toast(a.getAttribute("data-todo-msg"));
  });

  /* ---------- mobile navigation ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var menu = document.getElementById("nav-menu");
  function setInert(on) {
    var els = document.querySelectorAll("main, .site-footer, .skip-link");
    for (var i = 0; i < els.length; i++) {
      if (on) els[i].setAttribute("inert", ""); else els[i].removeAttribute("inert");
    }
  }
  function isOpen() { return document.body.classList.contains("nav-open"); }
  function closeNav(returnFocus) {
    if (!isOpen()) return;
    document.body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    setInert(false);
    unlockScroll();
    if (returnFocus) toggle.focus();
  }
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      if (isOpen()) { closeNav(false); return; }
      document.body.classList.add("nav-open");
      toggle.setAttribute("aria-expanded", "true");
      setInert(true);
      lockScroll();
      /* focus() on a link that is still visibility:hidden does nothing; the stylesheet switches
         visibility with no delay on open, and reading layout here applies that before focusing */
      void menu.offsetWidth;
      var first = menu.querySelector("a");
      if (first) first.focus();
    });
    menu.addEventListener("click", function (e) { if (e.target.closest("a")) closeNav(false); });
    document.addEventListener("keydown", function (e) {
      if (!isOpen()) return;
      if (e.key === "Escape") { closeNav(true); return; }
      if (e.key !== "Tab") return;
      var f = [].slice.call(document.querySelectorAll(".site-header .brand, #nav-menu a, .nav-toggle"));
      var i = f.indexOf(document.activeElement);
      if (i === -1) { e.preventDefault(); f[0].focus(); }
      else if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    window.addEventListener("resize", function () { if (window.innerWidth > 860) closeNav(false); });
  }

  /* ---------- motion ----------
     The finished page is the CSS default; everything below only adds how things arrive. Skipped under
     reduced motion, without IntersectionObserver, and with ?static in the URL (a QA hook: it shows the
     page exactly as a visitor who asked for less motion sees it). */
  var docEl = document.documentElement;
  var calm = (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) || /[?&]static\b/.test(window.location.search);
  var canObserve = "IntersectionObserver" in window;
  window.ED.calm = calm;
  /* ?static also switches off the CSS motion (motion.css), so it shows exactly the reduced-motion page */
  if (/[?&]static\b/.test(window.location.search)) docEl.classList.add("is-static");

  /* Header state from a sentinel at the top of the page: no scroll listener at all. The shadow and the
     slightly smaller logo are transforms and box-shadow, so the header's height never changes. */
  var siteHeader = document.querySelector(".site-header");
  if (siteHeader && canObserve) {
    var sentinel = document.createElement("div");
    sentinel.className = "scroll-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    document.body.insertBefore(sentinel, document.body.firstChild);
    new IntersectionObserver(function (entries) {
      siteHeader.classList.toggle("is-scrolled", !entries[0].isIntersecting);
    }).observe(sentinel);
  }

  var swooshes = [].slice.call(document.querySelectorAll(".swoosh"));
  function drawIfSeen() {
    var vh = window.innerHeight;
    swooshes = swooshes.filter(function (s) {
      var holder = s.closest("[data-reveal]");
      if (holder && holder.classList.contains("reveal") && !holder.classList.contains("is-visible")) return true;
      if (s.getBoundingClientRect().top < vh) { s.classList.add("is-drawn"); return false; }
      return true;
    });
  }

  if (calm || !canObserve) {
    docEl.classList.add("is-entered");
    swooshes.forEach(function (s) { s.classList.add("is-drawn"); });
  } else {
    /* Entrance: the first heading block rises once the fonts are in, capped at 800 ms so a slow font
       never holds the page back. Then every swoosh already on screen draws itself. */
    var entered = false;
    var enter = function () {
      if (entered) return;
      entered = true;
      window.requestAnimationFrame(function () { docEl.classList.add("is-entered"); drawIfSeen(); });
    };
    var cap = setTimeout(enter, 800);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { clearTimeout(cap); enter(); });

    /* Reveal: only elements marked data-reveal, and only those below the fold, are hidden and then
       brought in; something already on screen is never hidden, so the largest paint is never delayed.
       Elements arriving together are staggered by their place within their own parent (at most three
       steps of 80 ms), so unrelated siblings never take a slot. A sweep after scrolling stops catches
       anything a fast or programmatic jump skipped past. */
    var vh0 = window.innerHeight;
    /* every read first, then every write: one layout for the whole page, not one per element */
    var pending = [].filter.call(document.querySelectorAll("[data-reveal]"), function (el) { return el.getBoundingClientRect().top >= vh0; });
    pending.forEach(function (el) { el.classList.add("reveal"); });
    var settle = function (el) {
      /* once in place the element sheds the reveal classes, so its own hover transitions apply again */
      var done = function () { el.classList.remove("reveal", "is-visible"); el.style.removeProperty("--d"); };
      el.addEventListener("transitionend", function te(e) { if (e.target === el && e.propertyName === "transform") { el.removeEventListener("transitionend", te); done(); } });
      setTimeout(done, 1600);
    };
    var show = function (list, stagger) {
      var seen = new Map();
      list.forEach(function (el) {
        var par = el.parentNode, k = seen.get(par) || 0;
        seen.set(par, k + 1);
        if (stagger) el.style.setProperty("--d", Math.min(k, 3) * 80 + "ms");
        el.classList.add("is-visible");
        settle(el);
      });
      pending = pending.filter(function (el) { return list.indexOf(el) < 0; });
      drawIfSeen();
    };
    if (pending.length) {
      var io = new IntersectionObserver(function (entries) {
        var hit = entries.filter(function (e) { return e.isIntersecting; }).map(function (e) { io.unobserve(e.target); return e.target; });
        if (hit.length) show(hit, true);
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0 });
      pending.forEach(function (el) { io.observe(el); });
      var idle = 0;
      window.addEventListener("scroll", function () {
        clearTimeout(idle);
        if (!pending.length) return;
        idle = setTimeout(function () {
          var vh = window.innerHeight;
          var late = pending.filter(function (el) { return el.getBoundingClientRect().top < vh; });
          late.forEach(function (el) { io.unobserve(el); });
          if (late.length) show(late, false);
        }, 250);
      }, { passive: true });
    }
    var drawQueued = false;
    window.addEventListener("scroll", function () {
      if (!swooshes.length || drawQueued) return;
      drawQueued = true;
      window.requestAnimationFrame(function () { drawQueued = false; drawIfSeen(); });
    }, { passive: true });
  }
})();
