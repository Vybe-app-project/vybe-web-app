# Live per-set workout smoke (explicit operator run only)

`scripts/smoke-workout-sets-live.mjs` is a **mutating live smoke**, not part of
`npm test`. It has not been run as part of its implementation. Run it serially
with native/shared-account tests; the parent owns live execution.

## Invocation

From the isolated web checkout, with the test account's `VYBE_EMAIL` and
`VYBE_PASSWORD` already supplied through the operator's secure environment:

```sh
cd /Users/Charlie/work/vybe/wt/aaa-a656-workout-sets-web
export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
export ORIGIN='https://vybeapp.fit'
export VYBE_PLAYWRIGHT="$HOME/.agents/skills/playwright-skill/node_modules/playwright/index.mjs"
export VYBE_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
test -n "$VYBE_EMAIL" && test -n "$VYBE_PASSWORD" &&
  node scripts/smoke-workout-sets-live.mjs
```

No credential literals, command-line credential arguments, secret files or
external login providers are used. `VYBE_CHROMIUM_EXECUTABLE` is optional if
the supplied Playwright installation already has Chromium. The browser is
visible by default; explicitly set `VYBE_HEADLESS=1` for unattended execution.
No dependency install or dev server is needed.

`ORIGIN` must be a bare HTTPS origin (no credentials, path, query or fragment).
HTTP is accepted only for loopback development. The script blocks cross-origin
HTTP requests and does not fall back to another origin, account or provider.

## Assertions

1. Real Email/Password/Sign in UI; check `/api/auth/login` success and arrival
   at `/workouts/logs`.
2. Use the Log session UI to create a UUID-named test record with one exercise:
   5 reps × 10 kg completed, 5 reps × 20 lb completed.
3. Authenticated browser GET of that exact ID: explicit units, set version,
   completion, revision and volume `50 + 100 × 0.45359237` kg. Check the
   session card displays its rounded volume and `2/2 sets completed`.
4. UI edit: change the kg set to 7 reps and uncomplete the lb set. Confirm
   stable IDs, revision increment and completed-only volume of 70 kg in the
   server GET and session card.
5. Authenticated legacy metadata-only PATCH **without** set version/revision:
   require 409, then GET and verify the projected record (including sets,
   notes, revision and updated timestamp) is unchanged.
6. UI Log again with a second unique name. Require fresh exercise/set IDs,
   copied values/units, both sets incomplete, server volume 0, and the card's
   `0/2 sets completed` without a positive-volume badge.

The bearer credential stays inside browser evaluation. No token, credential,
response body, page console output, signed media URL, screenshot, HAR or trace
is printed/saved. Output consists of fixed PASS/FAIL stages and cleanup counts.
Arbitrary Playwright/server exception messages are suppressed because they
can include filled values or response data. Missing controls, unexpected
responses, failed assertions or cleanup failures produce a nonzero exit.
Playwright debug logging is disabled during execution, and the credential
environment variables are blanked in the browser child process.

## Cleanup and operational limits

- Only the two UUID-named UI creates can populate the in-memory ownership
  ledger, using their returned Mongo IDs. It never enumerates old logs to
  choose deletion candidates.
- `finally` attempts cleanup for **every recorded ID**, even after a failed
  assertion. GET verifies that ID and its run-specific name, DELETE must
  succeed, and GET must then return 404. An identity mismatch prevents deletion.
  Cleanup failure is reported and the process fails; other owned IDs are still
  attempted.
- The context/browser close without calling logout, avoiding account-wide
  token revocation and interference with shared native tests.
- Browser profile files stay under the current checkout's
  `.live-workout-sets/<run UUID>/` and are removed on normal/failure completion.
  Do not run from a shared directory with untrusted symlinks.
- An ambiguous POST (connection lost before its successful response/ID is
  received) cannot be safely cleaned using an exact returned ID. The run fails;
  no blind retry or name-search deletion occurs. The operator must inspect
  that test account's `vybe-live-sets-…` entries before retrying. A forced kill
  also bypasses JavaScript `finally`; operator recovery is required.
- This checks one real browser/session against the deployed contracts, not
  native UI, offline recovery, durable drafts, timers or all of W5.

## Offline validation (safe; does not invoke the live smoke)

```sh
node --check scripts/smoke-workout-sets-live.mjs
node --check tests/workout-sets-live-smoke.test.mjs
node --test tests/workout-sets-live-smoke.test.mjs
node scripts/scan-injected-code.mjs
git diff --check
```

These dependency-free unit tests validate configuration, ownership recording,
exact-ID deletion, mismatch protection, all-record cleanup after failures and
non-success responses. They import helpers only: no browser, credentials,
server or network is used. They do **not** constitute live smoke evidence.

Implementation validation on Node 24.19.0: both syntax checks passed,
**8 offline tests passed with 0 skipped**, supply-chain scan and diff check
passed. The live executable was not invoked.
