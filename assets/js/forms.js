/* European Dental forms. Every form[data-w3f] posts to Web3Forms by two paths with one result.

   NO JS: a plain POST. Native validation runs because novalidate is set from HERE, never in the
   markup, where it would switch validation off for visitors without JavaScript. Web3Forms
   redirects back to ?sent=1#sent-<form id> and the :target rule reveals the success panel.

   JS: intercept, post the same FormData, reveal the same panel in place. An invalid field gets a
   written message tied to it with aria-describedby, not only a red border.

   AND THE PART THAT MATTERS MOST: while the access key is still a placeholder, submitting is refused
   with a visible message. A placeholder key makes Web3Forms fail while the page still looks like it
   worked, which is how an enquiry gets silently lost. */
(function () {
  "use strict";
  var forms = document.querySelectorAll("form[data-w3f]");
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  [].forEach.call(forms, function (form) {
    var done = document.getElementById(form.getAttribute("data-sent"));
    var msgTodo = form.getAttribute("data-msg-todo") || "form.notConnected";
    var msgError = form.getAttribute("data-msg-error") || "form.error";
    var msgSending = form.getAttribute("data-msg-sending") || "form.sending";
    var msgInvalid = form.getAttribute("data-msg-invalid") || "form.invalid";

    if (done && /[?&]sent=1(&|$)/.test(window.location.search) && window.location.hash === "#" + done.id) {
      done.classList.add("is-shown");
    }

    /* The banner sits at the top of the form, which is often above the screen when Send is pressed,
       so it is brought into view; it takes focus only when no field is about to. */
    function banner(msg, takeFocus) {
      var el = form.querySelector(".form-error-banner");
      if (!el) {
        el = document.createElement("p");
        el.className = "form-error-banner";
        el.setAttribute("role", "alert");
        el.setAttribute("tabindex", "-1");
        form.insertBefore(el, form.firstChild);
      }
      el.textContent = msg;
      if (takeFocus) {
        try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
        if (el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
      }
    }
    function clearBanner() {
      var err = form.querySelector(".form-error-banner");
      if (err) err.remove();
    }
    /* the build writes placeholders as values that start with the literal marker below */
    var MARK = "TODO";
    function keyIsPlaceholder() {
      var k = form.querySelector("[name=access_key]");
      return !k || !k.value || k.value.indexOf(MARK) !== -1;
    }

    if (!window.fetch || !window.FormData || !form.checkValidity) return;
    form.setAttribute("novalidate", "novalidate");

    var btn = form.querySelector("[type=submit]");
    var label = btn ? btn.textContent : "";
    var sending = false;

    function describedBy(f, id, add) {
      var ids = (f.getAttribute("aria-describedby") || "").split(" ").filter(function (x) { return x && x !== id; });
      if (add) ids.push(id);
      if (ids.length) f.setAttribute("aria-describedby", ids.join(" ")); else f.removeAttribute("aria-describedby");
    }
    function fieldMessage(f) {
      var id = (f.id || (form.id + "-" + f.name)) + "-error";
      var wrap = (f.closest && f.closest(".field")) || f.parentNode;
      var existing = document.getElementById(id);
      var group = f.type === "radio" ? form.querySelectorAll('[name="' + f.name + '"]') : [f];
      if (!f.checkValidity()) {
        if (!existing) {
          existing = document.createElement("p");
          existing.className = "field-error";
          existing.id = id;
          wrap.appendChild(existing);
        }
        existing.textContent = f.validationMessage || msgInvalid;
        [].forEach.call(group, function (g) { g.setAttribute("aria-invalid", "true"); describedBy(g, id, true); });
      } else {
        if (existing) existing.remove();
        [].forEach.call(group, function (g) { g.setAttribute("aria-invalid", "false"); describedBy(g, id, false); });
      }
    }
    function mark() {
      [].forEach.call(form.querySelectorAll("[required]"), fieldMessage);
    }
    function settle(ok) {
      sending = false;
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (ok) {
        clearBanner();
        if (done) { done.classList.add("is-shown"); done.focus(); }
        form.reset();
      } else {
        banner(msgError, true);
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;

      /* The guard: loud, on screen, before anything else. */
      if (keyIsPlaceholder() || (form.getAttribute("action") || "").indexOf(MARK) !== -1) {
        banner(msgTodo, true);
        return;
      }
      /* Honeypot: look sent, say nothing. */
      var bot = form.querySelector("[name=botcheck]");
      if (bot && bot.checked) { if (done) done.classList.add("is-shown"); form.reset(); return; }

      form.classList.add("was-validated");
      mark();
      if (!form.checkValidity()) {
        banner(msgInvalid, false);
        var bad = form.querySelector(":invalid");
        if (bad) bad.focus();
        return;
      }
      clearBanner();

      sending = true;
      if (btn) { btn.disabled = true; btn.textContent = msgSending; }
      window.fetch(form.getAttribute("action"), { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (json) { settle(!!(json && json.success)); })
        .catch(function () { settle(false); });
    });

    /* On a phone the fixed call bar covers the bottom of the screen, and a tap into a field near it
       (or the keyboard opening) can leave the field underneath. Bring it clear of the bar. */
    var narrow = window.matchMedia && window.matchMedia("(max-width: 860px)");
    form.addEventListener("focusin", function (e) {
      var f = e.target;
      if (!narrow || !narrow.matches || !f.getBoundingClientRect || !/^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName)) return;
      var bar = document.querySelector(".call-bar");
      /* getClientRects, not offsetParent: a fixed element has no offsetParent even when shown */
      var top = bar && bar.getClientRects().length ? bar.getBoundingClientRect().top : window.innerHeight;
      if (f.getBoundingClientRect().bottom > top - 8) {
        try { f.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" }); } catch (err) { f.scrollIntoView(false); }
      }
    });

    form.addEventListener("input", function (e) {
      if (form.classList.contains("was-validated") && e.target.hasAttribute && e.target.hasAttribute("required")) fieldMessage(e.target);
    });
    form.addEventListener("change", function (e) {
      if (form.classList.contains("was-validated") && e.target.hasAttribute && e.target.hasAttribute("required")) fieldMessage(e.target);
    });
  });
})();
