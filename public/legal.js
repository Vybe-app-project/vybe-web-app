// Progressive enhancement for the static legal pages (privacy policy, terms,
// account deletion). Loaded synchronously in <head> right after /theme.js.
//
// 1. Drop the `no-js` class before first paint. legal.css follows the OS
//    colour scheme only under `.no-js`; once scripts run, /theme.js owns the
//    `.dark` class so an explicit Light/Dark choice made in the app wins.
// 2. Keep the footer copyright year current. The markup carries a static year
//    so the page reads correctly without scripts and in print.
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setYear);
  } else {
    setYear();
  }
})();
