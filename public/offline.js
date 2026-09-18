// Behaviour for offline.html. Lives in a file because the site's Content
// Security Policy is script-src 'self': the inline onclick and <script> this
// replaces were blocked, which left the page with no way out except the
// browser's own reload.
(function () {
  // Honour the in-app theme choice (same key as src/components/ui.tsx and
  // /theme.js); otherwise follow the system. data-theme lets the stylesheet
  // fall back to prefers-color-scheme only when this script did not run.
  try {
    var pref = localStorage.getItem('vybe.theme');
    var dark = pref === 'dark' || (pref !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {}

  var reload = function () { location.reload(); };
  var button = document.getElementById('retry');
  if (button) button.addEventListener('click', reload);

  // Come back on our own the moment the connection returns.
  addEventListener('online', reload);
})();
