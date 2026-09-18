// The site's Content-Security-Policy is script-src 'self', so this page's
// behaviour lives here rather than inline (an inline handler was blocked and
// the "Try again" button did nothing).
(function () {
  var retry = document.getElementById('retry');
  if (retry) retry.addEventListener('click', function () { location.reload(); });
  addEventListener('online', function () { location.reload(); });
})();
