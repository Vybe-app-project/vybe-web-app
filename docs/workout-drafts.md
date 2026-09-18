# Durable workout draft and rest timer (bounded W3/W5)

The current integration is `aaa-a656-fleet-recovery-e2e`, merging main
`77c14ec22626834c3f159ff40cee8712d2cba313` into parent harness tip
`6c4b04b6fc0d848ec73b4baa51a812dc0c2d91b3` (including `d4ff555` and guarded
draft release `da7b4d6`). The preceding `aaa-a656-fleet-workout-recovery-web`
package combined reconciled web
`7e5b308b755d4d794f1069b8b0003875a95ec972` with the preserved draft/timer
`b8b5e3af0b9bf2bb84ac87a9e1928bc07aa2e96f`. Main's place pictures, meal-token
handoff and full-template updates, plus the earlier reliability/per-set fixes,
remain intact. Built-in IndexedDB/Web Crypto only; no new dependencies.

The paired backend's create-only `clientRequestId` deduplication and full
backend qualification remain **independent release prerequisites**. This
frontend package does not change the REST contract or qualify server storage.

## Local authoring and explicit recovery

- One local workout draft per verified account/browser origin, in IndexedDB
  `vybe-workout-drafts` database version 2 (`drafts` keyed by owner ID; `meta`
  contains account scope and per-owner revision stamps). Draft payloads retain
  their version-1 format.
- Save form strings, stable exercise/set IDs, original edit/seed context,
  request ID, rest timer and any pending immutable request. No raw credential
  is stored in IndexedDB. Both actual consumer token persistence modes are
  read through the shared noncyclic session reader.
- “Local only · unsynced” distinguishes local commits from server saves.
  “Saved on this device” appears only after the IndexedDB transaction completes.
  Input entered while a storage operation is pending is not yet durable.
- Navigating away/reloading never publishes. Returning offers **Resume workout
  draft / Discard local draft**. Save for later explicitly closes the editor
  after local persistence. Discard is confirmed and removes only local state,
  never a possibly saved server workout.
- Drafts older than seven days show a review warning. Unknown/invalid draft
  formats are not silently migrated into fabricated sets; explicit discard is
  available. Legacy aggregate rows remain aggregate rows.
- An existing draft takes priority over opening another new/edit/template
  session. Resume/discard first, then open the desired authoring workflow.
- Storage unavailable/quota/transaction failures are visible, retain in-memory
  input and block network publication until the request can be stored safely.
  There is no silent localStorage or volatile-only “success” fallback.

## Save/retry protocol

Generate one client request ID when a new draft starts. Before any network
save, commit the exact payload and target ID to IndexedDB. While a request is
unresolved, authoring is locked and **Retry save** reuses the immutable payload.
The timer can still operate independently; its state is not workout metrics.

- Create: send `clientRequestId`; 201/200 with a valid owner-scoped workout
  acknowledgement is a verified save. A lost response/reload reuses the same
  key/body and cannot create a second log.
- Definite 400 validation rejection permits correction. A 409 conflict keeps
  the draft and refreshes history; it never overwrites the server or silently
  changes the key. A 410 deleted-request response also requires deliberate
  local discard, not resurrection.
- Edit: keep `setRecordsVersion`/`expectedRevision` semantics. A lost edit
  acknowledgement may subsequently return 409; inspect refreshed history and
  discard/reopen deliberately. No automatic merge of concurrent edits.
- After acknowledgement, delete the local draft. If local cleanup fails,
  **Retry local cleanup** removes it without another POST in that editor.
  After a process crash, replaying the persisted create is still idempotent.

There is no automatic queue flush on reconnect, startup or a timer event.
An operator must choose Resume and Save/Retry.

## Account isolation and purging

Draft storage is bound to verified owner ID, a one-way session fingerprint and
a local revocation generation. Logout/credential replacement synchronously
revokes the generation before asynchronous IndexedDB purge, so navigation
interrupting that purge cannot make the old draft eligible again.

Remembered and tab-only credentials both support same-tab reload recovery
after real verification. A tab-only credential/snapshot stays in sessionStorage;
browser/tab restart authentication is not promised. Offline identity snapshots
never supply `verifiedToken`, bind an editor, or authorize a workout POST/PATCH.
Without verification, the draft remains on disk and the shell offers reconnect,
not fabricated login or silent publication. Real account changes synchronously
remove the old identity and its query client; stale editors cannot paint as the
new owner. A fresh signed-out tab alone is not an account-change/purge operation.

The small `api.ts`/`auth.ts`/`App.tsx` hooks are necessary for lifecycle safety,
including outside the logger:

- `verifiedToken` pairs the in-memory user with the credential that actually
  verified it. A token changed in another tab cannot be paired with a stale
  owner object to send the old draft as the new user.
- Workout requests pin that verified session through the Axios interceptor.
  A mismatch fails before dispatch; ordinary requests keep their existing
  behavior.
- Logout/account deletion and cross-tab token/generation changes revoke
  draft access and purge storage. On startup/account switch, mismatched
  owner/session/generation data is cleared before any recovery read/write.
- IDs, content and request metadata stay local/private. No secrets appear in
  status messages. Browser storage is not application-level encrypted; device/
  browser profile access remains a privacy consideration.

## Duration compatibility

Private log exercise duration remains **minutes**, exactly as the existing
logger entered it and as backend `docs/workout-set-records.md` specifies
(0–1,440 minutes, pinned source `f9d0c53888ef625f2894d64777ef1e78b5152e1b`).
The social/catalog exercise prescription uses **seconds**, as current main's
editor and catalog contract specify. Seeding a new private log converts only
that prescription (`180 seconds → 3 minutes`). Existing logs/drafts are never
rescaled. History uses `formatSeconds(minutes * 60)` while preserving kg/lb.
The session-level duration remains minutes; the optional rest timer remains
seconds/deadlines. Browser regressions cover both the boundary conversion and
an unchanged historical 180-minute/lb entry. No backend wire change is made.

## Concurrent tabs and stale editors

Multiple tabs may read/resume the same draft. They do **not** silently merge
or overwrite one another: the first committed change wins, and every stale
writer or discard fails with an actionable conflict.

- A recovery read atomically captures the account scope, occupied slot/draft
  identity and its revision in an editor-specific in-memory handle.
- Each write/delete checks that handle against IndexedDB in the **same
  readwrite transaction** as the mutation. A fresh opaque revision is stored
  atomically with the change. No localStorage lock, timestamp ordering, lease
  timeout or cross-tab message delivery is required.
- Deletion keeps a revision tombstone and permanently closes that editor's
  handle. Stale writes cannot resurrect saved/discarded state, even after a
  same-ID delete/recreate cycle or an empty → occupied → empty cycle (ABA).
  Failed stale discards cannot remove the new state.
- A single editor's queued autosaves advance only their own cursor, **after
  transaction completion**, before the next queued operation. Other editors'
  handles never advance automatically. An aborted request/transaction leaves
  the cursor unchanged and never displays a storage success.
- Merely resuming a stored draft does not rewrite it. A conflict retains this
  tab's unsaved in-memory input and stops its persistence/publication. Copy
  any wanted values, choose **Reload latest draft**, confirm, and deliberately
  resume the latest local recovery state. There is no auto-merge or auto-send.
- Pending request identity/payload remains immutable while timer-only updates
  can commit through the same handle. A newer tab's write also prevents stale
  server-acknowledgement cleanup from deleting its state. Reconcile explicitly;
  this is separate from backend `expectedRevision`/idempotency handling.

Database version 2 upgrades existing stores without fabricating or deleting a
matching account's version-1 draft. Older builds request database version 1,
so they fail closed after the upgrade rather than bypassing revision checks.
Close/reload an old tab if it blocks the upgrade. All participating clients
must use the guarded implementation; browser storage editing outside the app
is not a supported concurrency mechanism.

## Rest timer

Optional, user-chosen duration (1–86,400 seconds), scoped to the session or an
exercise. Start/resume records an absolute deadline. Remaining time is derived
from the current timestamp, not decremented ticks, so navigation, process
restart and background throttling do not extend the timer. Pause stores the
remaining seconds; reset/stop are explicit.

Only start/pause/reset/stop/configuration changes write timer state. There are
no per-second IndexedDB writes, animations, sound, vibration or automatic
workout changes. Remaining time has `role="timer"` and `aria-live="off"`;
the separate status announces transitions, not every tick. Existing reduced-
motion UI primitives remain in use. No rest duration is a medical/training
recommendation.

**No background/native notification support is claimed.** With the page
suspended/closed, expiry is shown when the UI runs again. System-clock changes
affect an absolute wall-clock deadline.

## Validation commands

Run from this worktree on Node 24.19.0:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
mkdir -p node_modules/.cache/runtime node_modules/.cache/npm
export TMPDIR="$PWD/node_modules/.cache/runtime"
export npm_config_cache="$PWD/node_modules/.cache/npm"
export VYBE_PLAYWRIGHT="$HOME/.agents/skills/playwright-skill/node_modules/playwright/index.mjs"
unset VYBE_TEST_BACKEND
npm run scan
npm run build
npm run verify
node --test --test-concurrency=1 $(find tests -maxdepth 1 -name '*.test.mjs' \
  ! -name 'workout-drafts.local-e2e.test.mjs' | sort)
npm run verify:build
node scripts/audit-api-contracts.cjs ../int-vybe-backend
git diff --check
```

The `npm run verify` invocation explicitly gates/skips the one real-backend
E2E with `VYBE_TEST_BACKEND` unset. The following full non-Mongo run excludes
**only** that file; every pure/mock-API browser test must pass with zero skips.
Do not supply the backend variable while another QA lane owns the shared DB.

Chromium exercises actual IndexedDB: save/recover/clear, stale/unknown drafts,
quota/unavailable storage, failed cleanup, rest deadline/pause/reset/stop,
logout, deletion and cross-tab account switching. Added same-context two-page
tests cover stale writes/discards of the same draft, simultaneous contenders,
pending request/timer preservation, saved/discarded-state resurrection, ABA,
rapid queued inputs, transaction rollback, old-database upgrade, in-flight save
cleanup, and logout while another editor remains open. The ABA fixture imports
the actual storage module into Chromium; it uses real IndexedDB transactions,
not text matching or a mocked database. Existing set editor tests
retain light/dark, aggregate, template, repeat and revision conflict coverage.

The opt-in local end-to-end test uses the clean backend checkout selected by
`VYBE_TEST_BACKEND`; set `VYBE_TEST_BACKEND_COMMIT` to its qualified full commit.
It verifies the repository/package identity and checks the same clean commit
again after cleanup. Installed dependencies may be linked, but uncommitted
application source is not accepted.

Mongo is always literal loopback `127.0.0.1`, with a generated, unique
`vybe_workout_e2e_*` database per run. It never inherits an operator's
`MONGODB_URI` or `VYBE_TEST_DB`. `VYBE_E2E_MONGO_PORT` selects an unprivileged
task-owned port (default 27018), and `VYBE_E2E_REPLICA_SET` selects its plain
replica-set name (default `rs0`). Invalid values fail before connecting.
It seeds a local-only account, commits a real POST, drops its acknowledgement,
closes Chromium, restarts it with the same unique worktree-local profile, explicitly
resumes/retries and verifies one database log plus cleared IndexedDB. That
test database and profile are removed afterward. It never inherits a
production connection string or uses production credentials.
Its browser blocks requests outside the local fixture origin, and the
intercepted create does not follow redirects. Build the client with the default
relative `/api` base; this is not a way to smoke-test a production origin.

User/workout indexes finish initializing before the transaction test starts.
Cleanup attempts browser, HTTP server, database, profile and source-pinning
checks even if an earlier cleanup step fails, then reports any failures.
`tests/workout-e2e-fixture.test.mjs` pins the loopback/database isolation,
source identity and cleanup behavior without requiring Mongo.

**The earlier concurrency-only package did not run real-backend E2E.**
The final combined qualification below subsequently passed that gate.
Mocked-API lost-ack recovery alone is not a substitute for the recorded proof.

Without the browser/backend environment variables, optional suites explicitly
skip; those skips are not proof. The live smoke script is **not run** here.
Native/device, actual production, notifications and full W3/W5 completion
remain parent-owned/out of scope.

## Final combined verification — 2026-09-18

Application source `4679a9de8357793a7cc5d6143b641d4694a542e9`, including main
`77c14ec`, passed **362 tests, zero failures/skips/cancellations** against its
built artifact. The real API used clean backend
`f9d0c53888ef625f2894d64777ef1e78b5152e1b`. The lost acknowledgement, actual
Chromium process restart, identical replay, one persisted log and cleared
IndexedDB were all verified. No recovery write occurred before the explicit
Resume/Retry actions.

The full run used `node --test --test-concurrency=1 tests/*.test.mjs` with
`VYBE_TEST_BACKEND`, `VYBE_TEST_BACKEND_COMMIT`, and `VYBE_PLAYWRIGHT` set.
An owned loopback Mongo fixture was selected by `VYBE_E2E_MONGO_PORT=27189`
and `VYBE_E2E_REPLICA_SET=a656Recovery`; every database/profile was unique.
The environment did not inherit production credentials or connections.
Local-only browser enforcement, source-before/after checks and cleanup passed.
The fixture was removed after testing.

Artifact verification and the route audit against that exact backend also
passed. Raw evidence remains in `logs/recovery-e2e/`. A future repeat requires
a running isolated replica set and restored matching test dependencies; this
record does not imply the fixture is left running or the feature is deployed.

## Frontend compatibility verification before final combined run — 2026-09-18

The current merge passes all 34 pure/mock-browser files: **361 tests, zero
failures/skips/cancellations**, including six Chromium suites. `npm run verify`
also passes with 361 tests and exactly one explicitly gated real-backend E2E;
scan, zero-finding dependency audit, contracts, typecheck/build/artifact and
diff checks pass. Static routes were additionally checked against an exact
read-only export of pinned backend `f9d0c53888ef625f2894d64777ef1e78b5152e1b`.

Real Chromium covers remembered/tab-only login, draft binding, same-tab reload,
offline snapshot gating, successful recovery/save, and logout cleanup. A fresh
unsigned tab does not erase the original tab-only draft. Account changes
immediately hide old editor/cache state (rather than leaving the prior account's
input visible); same-account stale-tab conflicts still retain unsaved input.
Store tests cover late 401/success/refresh/login callbacks and scoped bootstrap
dedup. Existing CAS/ABA/immutable-retry/timer tests remain passing.

The parent-provided real-backend harness was unchanged and **not executed**
by the compatibility agent. Its earlier five passes preceded current main;
the subsequent final parent run above closed that gate. See
`logs/fleet-web-current-main-compat/` for this bounded frontend evidence.

## Historical concurrency-package verification (da7b4d6) — 2026-09-18

Node 24.19.0 / npm 11.17.0; existing manifest-matched dependency links only,
with worktree-local writable caches:

- Draft/IndexedDB/timer Chromium suite: **22 passed, zero failures/skips**.
- `npm run verify`: **165 passed, zero failures, one explicitly gated
  real-backend E2E skip**. Supply-chain scan, production audit (**zero
  findings**), API contracts, typecheck, build and artifact verification passed
  (107 files / five entry assets).
- Separately, all **19 non-Mongo test files** against the newly rebuilt app:
  **165 passed, zero failures/skips/cancellations**, including five actual
  Chromium suites. The only excluded file is the separately gated
  `workout-drafts.local-e2e.test.mjs`; no browser suite is silently skipped.
- Read-only route audit against backend
  `7368dbd0c972b2baf1b512a245c2ea1aca3d585f`: 284 resolved Axios calls against
  369 routes, zero dynamic/unmatched/shadowed/unresolved-base cases. This is
  source inspection, not API or Mongo execution.
- Merge/conflict/diff checks pass. Main's Gyms/share/template files, previous
  runtime/release/cache/set helpers, and the optional timer implementation
  remain byte-identical to their input commits.

Raw gate output is retained in ignored `logs/fleet-draft-tab-safety/`.
Temporary dependency links/caches are removed before handoff; no shared
dependency directory was installed over. No production account, push,
deployment, backend edit, Mongo use, native change or global release completion
is claimed. Backend/full E2E qualification, deployment coordination and native/
device/server constraints remain independent prerequisites.

## Historical preserved-draft verification (before this reconciliation)

Node 24.19.0, final serialized full run:

- **145 tests passed, 0 failed, 0 skipped**, including four browser suites.
- New IndexedDB/timer browser coverage: 11 tests; existing per-set browser
  coverage: 6 tests; real backend + Chromium process restart: 1 test.
- Focused session/clock regressions: 20 passed.
- `npm run build` (includes TypeScript): passed.
- Build verification: 107 files, 5 entry assets.
- Route audit against the isolated backend: 284 resolved calls; 0 unmatched,
  shadowed or unresolved routes/bases.
- Supply-chain scan and `git diff --check`: passed.

No product dependencies were installed or changed; matching installed tools
were linked into this worktree during validation. The link and test artifacts
are removed before handing off the commit.

Owned feature files are `src/lib/workoutDrafts.ts`,
`src/lib/WorkoutDraftLifecycle.tsx`, `src/pages/WorkoutRestTimer.tsx` and
`src/pages/WorkoutLogs.tsx`. The minimal lifecycle integration touches
`src/lib/api.ts`, `src/lib/auth.ts` and `src/App.tsx`; no login UI, themes,
navigation definitions, runtime/deploy settings or messages were changed.
