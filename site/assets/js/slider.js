/* European Dental hero slider. No library.

   The markup is complete without this file: the first photograph shows, the others are hidden and the
   controls stay hidden. This adds a crossfade with a slow drift, autoplay, and the controls, following the
   WAI-ARIA carousel pattern and WCAG 2.2.2:
   - the pause/play button comes first in the tab order;
   - autoplay pauses while a mouse hovers the slider, while it is off screen and while the tab is hidden,
     and resumes afterwards;
   - keyboard focus inside the slider, or any explicit change of photograph (previous, next, a dot, a
     swipe), STOPS autoplay until Play is pressed, and the live region then announces each photograph;
   - under reduced motion it starts stopped, with no drift.
   Only the first photograph loads before the page's load event: slide k+1 is un-hidden (and switched to
   eager loading) after load or when slide k becomes active, and autoplay moves on only once the next
   photograph has decoded. data-index and data-state are written for the smoke test. */
(function () {
  "use strict";
  var root = document.querySelector("[data-slider]");
  if (!root) return;
  var slides = [].slice.call(root.querySelectorAll(".slide"));
  var controls = root.querySelector(".slider__controls");
  var toggle = root.querySelector("[data-toggle]");
  var track = root.querySelector(".slider__track");
  if (slides.length < 2 || !controls || !toggle || !track) return;
  var dots = [].slice.call(root.querySelectorAll("[data-go]"));
  var progress = root.querySelector(".slider__progress");
  var calm = (window.ED && window.ED.calm) || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var INTERVAL = 6000, FADE = calm ? 0 : 900;
  var msgPause = root.getAttribute("data-msg-pause") || "Pause", msgPlay = root.getAttribute("data-msg-play") || "Play";

  var index = 0, timer = 0, dueAt = 0, remaining = INTERVAL;
  var stopped = calm, hovering = false, offscreen = false, tabHidden = document.hidden;
  /* nothing is scheduled before the load event: an early IntersectionObserver callback would otherwise
     start the clock on a slow connection and pull slides 2 and 3 in before the page has loaded */
  var ready = false;

  root.classList.add("is-ready");
  controls.hidden = false;
  if (progress) progress.hidden = false;
  root.style.setProperty("--slide-ms", INTERVAL + "ms");

  function state() {
    if (stopped) return "stopped";
    if (tabHidden) return "hidden";
    if (offscreen) return "offscreen";
    if (hovering) return "paused";
    return "playing";
  }
  function render() {
    root.setAttribute("data-state", state());
    root.setAttribute("data-index", String(index));
    toggle.setAttribute("aria-label", stopped ? msgPlay : msgPause);
    toggle.classList.toggle("is-paused", stopped);
    track.setAttribute("aria-live", stopped ? "polite" : "off");
  }
  function restartProgress() {
    if (!progress) return;
    progress.classList.remove("is-running");
    void progress.offsetWidth;
    if (!stopped) progress.classList.add("is-running");
  }

  /* un-hide a slide so its photograph loads; resolves once it is decoded (or has failed) */
  function prepare(i) {
    var s = slides[(i + slides.length) % slides.length];
    s.hidden = false;
    var img = s.querySelector("img");
    if (!img) return Promise.resolve();
    if (img.loading === "lazy") img.loading = "eager";
    return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
  }

  function show(i) {
    var next = (i + slides.length) % slides.length;
    if (next === index) return;
    var prev = slides[index], cur = slides[next];
    cur.hidden = false;
    prev.classList.remove("is-active");
    if (FADE) prev.classList.add("is-leaving");
    cur.classList.add("is-active");
    index = next;
    dots.forEach(function (d, k) { if (k === next) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
    if (FADE) setTimeout(function () { prev.classList.remove("is-leaving"); }, FADE + 60);
    prepare(next + 1);
    remaining = INTERVAL;
    restartProgress();
    render();
  }

  function clear() { clearTimeout(timer); timer = 0; }
  function schedule(ms) {
    clear();
    dueAt = Date.now() + ms;
    timer = setTimeout(function () {
      timer = 0;
      var from = index, n = (from + 1) % slides.length;
      prepare(n).then(function () {
        /* a visitor who changed photograph while this one was decoding has moved on: drop the stale step */
        if (index !== from) return;
        if (state() !== "playing") { remaining = 0; return; }
        show(n);
        schedule(INTERVAL);
      });
    }, ms);
  }
  /* call after any change of state: runs the clock only while playing, keeping what was left of it */
  function update() {
    if (ready && state() === "playing") {
      if (!timer) {
        var ms = remaining > 0 ? remaining : INTERVAL;
        if (ms === INTERVAL) restartProgress();
        schedule(ms);
      }
    }
    else if (timer) { remaining = Math.max(0, dueAt - Date.now()); clear(); }
    render();
  }
  function stop() {
    stopped = true;
    clear();
    remaining = INTERVAL;
    restartProgress();
    render();
  }

  toggle.addEventListener("click", function () {
    if (stopped) { stopped = false; remaining = INTERVAL; restartProgress(); update(); }
    else stop();
  });
  root.querySelector("[data-prev]").addEventListener("click", function () { stop(); show(index - 1); });
  root.querySelector("[data-next]").addEventListener("click", function () { stop(); show(index + 1); });
  dots.forEach(function (d) {
    d.addEventListener("click", function () { stop(); show(Number(d.getAttribute("data-go"))); });
  });

  /* keyboard focus stops autoplay (a mouse click on a control is handled by that control) */
  root.addEventListener("focusin", function (e) {
    var t = e.target;
    var keyboard = true;
    try { keyboard = t.matches(":focus-visible"); } catch (err) { /* old engines: treat all focus as keyboard focus */ }
    if (keyboard && !stopped) stop();
  });
  root.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") { hovering = true; update(); } });
  root.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") { hovering = false; update(); } });
  document.addEventListener("visibilitychange", function () { tabHidden = document.hidden; update(); });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) { offscreen = !entries[0].isIntersecting; update(); }, { threshold: 0 }).observe(root);
  }

  /* swipe: a horizontal pointer movement of 50 px or more; vertical movement stays page scrolling */
  var x0 = null, y0 = 0;
  track.addEventListener("pointerdown", function (e) { x0 = e.clientX; y0 = e.clientY; });
  track.addEventListener("pointerup", function (e) {
    if (x0 === null) return;
    var dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) { stop(); show(dx < 0 ? index + 1 : index - 1); }
  });
  track.addEventListener("pointercancel", function () { x0 = null; });
  track.addEventListener("dragstart", function (e) { e.preventDefault(); });

  render();
  function begin() { ready = true; prepare(1); restartProgress(); update(); }
  if (document.readyState === "complete") begin(); else window.addEventListener("load", begin);
})();
