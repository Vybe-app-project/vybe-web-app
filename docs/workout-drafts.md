# Durable workout draft and rest timer (bounded W3/W5)

Branch `aaa-a656-workout-drafts-web`, based on `aaa-a656-web-session` at
`ffb9370`. Built-in IndexedDB/Web Crypto only; no dependency or runtime changes.
The paired backend adds create-only `clientRequestId` deduplication.

## Local authoring and explicit recovery

- One local workout draft per verified account/browser origin, in IndexedDB
  `vybe-workout-drafts` version 1 (`drafts` keyed by owner ID; `meta` scope).
- Save form strings, stable exercise/set IDs, original edit/seed context,
  request ID, rest timer and any pending immutable request. No raw credential
  is stored in IndexedDB. The existing authentication token store is unchanged.
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

This does not implement multi-tab draft merging. Use one authoring tab at a
time. A different draft ID cannot overwrite the occupied local draft slot.

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
mkdir -p .draft-validation
export TMPDIR="$PWD/.draft-validation"
export VYBE_PLAYWRIGHT="$HOME/.agents/skills/playwright-skill/node_modules/playwright/index.mjs"
export VYBE_TEST_BACKEND=/Users/Charlie/work/vybe/wt/aaa-a656-workout-drafts-backend
npm run scan
npm run build
node --test tests/session-recovery.test.mjs tests/workout-draft-time.test.mjs
node --test tests/workout-drafts.browser.test.mjs tests/workout-sets.browser.test.mjs \
  tests/workout-drafts.local-e2e.test.mjs
node --test --test-concurrency=1 tests/*.test.mjs
npm run verify:build
node scripts/audit-api-contracts.cjs ../aaa-a656-workout-drafts-backend
git diff --check
```

Chromium exercises actual IndexedDB: save/recover/clear, stale/unknown drafts,
quota/unavailable storage, failed cleanup, rest deadline/pause/reset/stop,
logout, deletion and cross-tab account switching. Existing set editor tests
retain light/dark, aggregate, template, repeat and revision conflict coverage.

The opt-in local end-to-end test uses the exact isolated backend and hard-pins
`mongodb://127.0.0.1:27018/vybe_aaa_a656_drafts_browser?replicaSet=rs0`.
It seeds a local-only account, commits a real POST, drops its acknowledgement,
closes Chromium, restarts it with the same worktree-local profile, explicitly
resumes/retries and verifies one database log plus cleared IndexedDB. That
test database and profile are removed afterward. It never inherits a
production connection string or uses production credentials.

Without the browser/backend environment variables, optional suites explicitly
skip; those skips are not proof. The live smoke script is **not run** here.
Native/device, actual production, notifications and full W3/W5 completion
remain parent-owned/out of scope.

## Recorded verification

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
