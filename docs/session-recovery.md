# Web session recovery

## Current-main integration

The combined branch preserves remember-me, identity-only offline shell,
signed-avatar refresh and per-device/all-device logout alongside draft recovery.
Startup verifies consumer or administrator sessions before opening private pages.
A network error, timeout, rate limit, server error, or malformed response keeps
the credential. A matching minimal snapshot may paint the navigation/identity
shell with a reconnect message; private page content, realtime subscriptions,
private badges/rails and workout authoring remain gated. Without a trustworthy
snapshot, the explicit recovery screen remains available; failure is not logout.

An authenticated request rejected with `401` removes its matching credential.
A late rejection belonging to an older credential cannot invalidate a newer
sign-in, including a credential replaced while a request is in flight. Generic
403 permission/gateway responses are not session rejection. Backend source
`f9d0c53888ef625f2894d64777ef1e78b5152e1b`, `controllers/authController.js`,
defines two precise auth-policy 403 messages: `This account is currently
unavailable` (suspension) and `Email verification is required`. Those do revoke
the matching session. Bad public login/reset/OTP proofs do not revoke an
unrelated saved session.

Concurrent checks share a request only within the same token/credential epoch.
A replacement credential starts its own check immediately, and old bootstrap,
refresh, login and response callbacks cannot replace the newer principal or
clear its loading/check state. Avatar refresh still runs on foreground/interval
and broken signed images, updates the minimal snapshot, and is throttled.
Profile setters cannot install a different owner. Registration/OTP login accepts
the authenticated API session through the same validated sign-in path.
As on current main, a transient refresh failure preserves an already-verified
in-memory session, rather than unmounting its editor and losing unsaved input.
This cannot promote a cold snapshot: a reloaded page still has no verified
credential until an actual identity response succeeds. An authoritative
rejection still revokes the live session.

Startup verification lets route guards handle an expired credential, so an
expired consumer session cannot eject someone from public support or the
separately authenticated admin console. Other protected requests retain the
session-expired destination/reason (`expired=1`, safe `next=`) behavior. Support,
password-reset and public-post previews stay reachable when verification fails.

Remembered consumer credentials live in localStorage. With **Keep me signed in**
off, credentials and identity snapshots both live in sessionStorage. The shared,
noncyclic `consumerSession.ts` reader is used by API/auth and draft account
binding, so a tab-only session survives an ordinary same-tab reload without
accidentally becoming persistent. Closing/restarting a tab/browser is **not**
a promise of tab-only authentication or draft recovery. Administrator
credentials remain tab-scoped.

Snapshots contain only ID, username, name and avatar plus a one-way credential
fingerprint, stored beside the actual credential. They cannot be reused for a
different token or persistence mode. Legacy unbound snapshots are not trusted:
one successful online verification refreshes them; otherwise recovery remains
explicit. A snapshot never sets `verifiedToken` or permits a workout request.
This is not offline authentication or a credential/TTL extension.

Credential replacement/clear synchronously revokes the workout generation,
invalidates verification, disposes the socket and replaces the TanStack Query
client/provider subtree. Old requests and mutation rollback closures retain the
old, cleared client, not the new account's private cache. Cross-tab changes
reverify before private content can paint. Ordinary refresh for the same
credential does not discard its healthy cache.

Sign out calls `/auth/logout` for the presenting device; **Sign out of all
devices** calls `/auth/logout-all`. Both clear local/tab snapshots and draft
authority before navigation. A fresh signed-out tab does not purge another
tab's session-only draft merely by opening a public page; real logout/token
changes still revoke and purge through the token store.
Signed-out bootstrap also finishes interrupted logout cleanup, but only when
the IndexedDB scope's generation is revoked. It does not clear a live tab-only
scope simply because this new tab has no credential.

The PWA still precaches its public application shell. API responses and dynamic
media now use network-only requests with browser-cache bypass rather than
origin-wide runtime caches. The limited offline shell reads only its bound
identity snapshot, never cached API/private media. This intentionally does not
promise private offline reading.

When the updated service worker activates, it deletes the legacy `vybe-api` and
`vybe-media` caches without touching unrelated or static-shell caches. Existing
installations must accept the normal update/reload prompt to activate this
policy. Until then, the previous worker still has its previous behavior.
Current main's offline-page/script/install-screenshot precache exclusions and
`modulePreload: false` are retained; neither requires broad runtime caches.

Run `node --test tests/session-recovery.test.mjs` for store/interceptor behavior,
then `npm run verify` for the repository release gates.

After building, run `tests/session-privacy.browser.test.mjs` with
`VYBE_PLAYWRIGHT` pointing to an existing Playwright `index.mjs`. If that
installation uses a separately provisioned Chromium, set
`VYBE_CHROMIUM_EXECUTABLE` to its executable. These checks run against an isolated
local fixture server, never production accounts.

Current-main compatibility evidence: all 34 pure/mock-browser files pass
**361/361 with zero skips**, including remembered/tab-only Chromium reload and
offline recovery, account replacement without old private-query paint, and the
real worker's private-cache migration. Store regressions exercise avatar refresh,
late 401/success/login callbacks, an old check finishing during a newer dedup
slot, precise 403 classification, and per-device/all-device logout.
`npm run verify` passes with the one real-backend E2E explicitly gated; the
parent must rerun that check after this merge. Logs live under ignored
`logs/fleet-web-current-main-compat/`.
