# Web session recovery

Startup verifies the saved consumer or administrator session before rendering
protected routes. A network error, timeout, rate limit, server error, or malformed
response keeps the credential and presents a retry screen. It does not sign the
person out or render private content as though verification succeeded.

An authenticated request rejected with `401` removes its matching credential.
A late rejection belonging to an older credential cannot invalidate a newer
sign-in. `403` is not interpreted globally as session expiry because it can
represent a denied operation rather than invalid identity.

Concurrent startup checks share an in-flight request. Retrying clears the prior
error and checks the server again. Support remains publicly reachable, and the
person can explicitly sign out instead of retrying.

Startup verification lets route guards handle an expired credential, so an
expired consumer session cannot eject someone from public support or the
separately authenticated admin console. Other protected requests retain the
normal session-expired navigation behavior.

Consumer credentials retain their existing local-storage lifetime. Administrator
credentials remain tab-scoped in session storage. This change does not introduce
offline authentication, session extension, or a new session-revocation policy.

The PWA still precaches its public application shell. API responses and dynamic
media now use network-only requests with browser-cache bypass rather than
origin-wide runtime caches. Offline startup therefore presents recovery, not an
unverified cached account. This intentionally does not promise private offline
reading; that requires a separate account-scoped storage design.

When the updated service worker activates, it deletes the legacy `vybe-api` and
`vybe-media` caches without touching unrelated or static-shell caches. Existing
installations must accept the normal update/reload prompt to activate this
policy. Until then, the previous worker still has its previous behavior.

Run `node --test tests/session-recovery.test.mjs` for store/interceptor behavior,
then `npm run verify` for the repository release gates.

After building, run `tests/session-privacy.browser.test.mjs` with
`VYBE_PLAYWRIGHT` pointing to an existing Playwright `index.mjs`. If that
installation uses a separately provisioned Chromium, set
`VYBE_CHROMIUM_EXECUTABLE` to its executable. These checks run against an isolated
local fixture server, never production accounts.
