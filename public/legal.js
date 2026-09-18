// Progressive enhancement for the static legal pages (privacy policy, terms,
// account deletion). Loaded synchronously in <head> right after /theme.js.
//
// 1. Drop the `no-js` class before first paint. legal.css follows the OS
//    colour scheme only under `.no-js`; once scripts run, /theme.js owns the
//    `.dark` class so an explicit Light/Dark choice made in the app wins.
// 2. Keep the footer copyright year current. The markup carries a static year
//    so the page reads correctly without scripts and in print.
// 3. Mark the top bar while its brand row is parked above the viewport, so
//    legal.css can hide the row (see watchTopbar).
//
// Served as a file rather than inline because the site CSP is script-src 'self'.
(function () {
  try {
    document.documentElement.classList.remove('no-js');
  } catch (e) {}

  function setYear() {
    var year = String(new Date().getFullYear());
    var nodes = document.querySelectorAll('[data-year]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = year;
  }

  // legal.css gives the bar a negative sticky `top` on phones so a long
  // document keeps only the page tabs on screen. Inside an installed PWA the
  // bar also carries the status-bar inset, where the parked brand row's tail
  // would otherwise stay visible under the clock; `.is-stuck` hides it.
  function watchTopbar() {
    var bar = document.querySelector('.legal-topbar');
    if (!bar) return;
    var pending = false;

    function update() {
      pending = false;
      // The computed `top` is the parked position: negative on phones, 0 on
      // wider screens where the bar is a single row and nothing is parked.
      var parkedAt = parseFloat(getComputedStyle(bar).top);
      var stuck = parkedAt < 0 && bar.getBoundingClientRect().top <= parkedAt + 0.5;
      bar.classList.toggle('is-stuck', stuck);
    }

    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(update);
    }

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();
  }

  function ready() {
    setYear();
    watchTopbar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
