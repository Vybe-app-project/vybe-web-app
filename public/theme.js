// Apply the stored theme before first paint so there is no flash.
// Mirrors the store in src/components/ui.tsx (key `vybe.theme`).
// Served as a file rather than inline because the site CSP is script-src 'self'.
(function () {
  try {
    var pref = localStorage.getItem('vybe.theme');
    var dark = pref === 'dark' || (pref !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
