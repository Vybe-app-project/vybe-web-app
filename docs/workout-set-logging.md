# Individual workout sets — bounded W5 web package

This package extends the private session log, not social workout templates or
the full W5 program. It requires the accompanying version-1 private-log backend.
No runtime/auth/theme/deploy/domain files or mobile code are changed.
Branch: `aaa-a656-workout-sets-web`, based on `aaa-a656-web-session` at `0689928`.

## Behavior

- A new exercise starts with one incomplete set and zero recorded external
  load. Add/remove sets, edit reps/load/explicit kg or lb, and mark completion.
- Session volume uses completed per-set values, converting lb with
  `0.45359237`, plus unchanged legacy aggregate volume. Uncompleted sets and
  zero external load contribute zero. No bodyweight is inferred.
- Existing aggregate logs stay aggregate records. No past individual sets
  are reconstructed. Existing distance/duration/notes are retained on edit.
  Aggregate input in lb is normalized by the server to kg for older readers;
  individual set records retain their chosen units.
- A new session seeded from a library/program keeps its existing aggregate
  prefill. “Record individual sets” explicitly starts blank rather than turning
  prescribed totals into completed history.
- Log again copies prior values into **incomplete** sets with fresh IDs. Prior
  saved values/completion are shown separately. Existing session editing keeps
  IDs and completion. Session cards disclose the actual recorded sets/units.
- All new fields and actions are labeled. The set editor uses existing theme,
  field and button primitives, grouped fieldsets, flexible grids and native
  checkboxes. Light/dark browser tests use phone-width viewports.
- Invalid set fields are not silently converted to zero. Validation prevents
  submission and leaves input intact. Failed writes show an inline error and
  retain fields, IDs and completion for retry.

## Compatibility and recovery

Set-aware writes send `setRecordsVersion: 1`; editing also sends the last-read
`expectedRevision`. The backend rejects old-client or stale edits with 409
instead of silently removing per-set history. Derived aggregate response
fields are not posted back as set evidence.

A conflict refreshes the history query **without replacing the open draft**.
Copy any desired edits before deliberately closing/reopening the refreshed
record. No automatic overwrite or conflict merging. A network error permits
retry using the existing Save/Log button. As before, POST is not idempotent:
if a response is lost after a successful save, inspect history before retrying
to avoid duplicate sessions. This is not an offline/durable mutation queue.

Existing `/workouts/logs`, `?log=1`, `?from=<workoutId>`, log-again and confirmed
delete workflows remain. Older aggregate rows still save without a set version.
Unsupported future set versions are not edited.

## Owned files

- `src/pages/WorkoutLogs.tsx`
- `src/pages/WorkoutSetEditor.tsx`
- `src/pages/workout-set-records.ts`
- `tests/workout-set-records.test.mjs`
- `tests/workout-sets.browser.test.mjs`
- `docs/workout-set-logging.md`

## Reproducible verification

Node 24.19.0; existing dependencies only. Worktree-local cache/profile files:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
mkdir -p .sets-validation
export TMPDIR="$PWD/.sets-validation"
npm run scan
node --test tests/workout-set-records.test.mjs
npm run build
export VYBE_PLAYWRIGHT="$HOME/.agents/skills/playwright-skill/node_modules/playwright/index.mjs"
node --test tests/workout-sets.browser.test.mjs
npm test
npm run verify:build
node scripts/audit-api-contracts.cjs ../aaa-a656-workout-sets-backend
git diff --check
```

The existing optional-browser convention is retained: without
`VYBE_PLAYWRIGHT`, browser suites explicitly skip. The full validation run
supplies an existing Playwright installation with its downloaded Chromium,
so these are real built-app browser tests, not source-string assertions.
An alternative existing browser can be provided via
`VYBE_CHROMIUM_EXECUTABLE` for the new suite.

Focused browser coverage includes light/dark edit/add/remove/complete; kg/lb;
failed save and identical retry payload; legacy aggregate edits; template
prefill and explicit blank sets; log-again with prior values and fresh IDs;
invalid input; conflict preservation and deliberate reopen with fresh revision;
and confirmed deletion. HTTP is intercepted with local fixtures; backend
Supertest/Mongo integration verifies actual authorization/storage/volume.

Verified on Node 24.19.0:

- Pure helper tests: **5 passed**.
- Focused real-browser suite: **6 passed**.
- Full `npm test` with installed Chromium: **122 passed, 0 failed, 0 skipped**
  across 3 browser suites and the existing Node tests.
- `npm run build` (includes `tsc --noEmit`): passed.
- `npm run verify:build`: passed, 107 files / 5 entry assets.
- API route audit: 284 statically resolved calls, 0 unmatched/shadowed routes
  and 0 unresolved bases against the isolated backend.
- Supply-chain scan and `git diff --check`: passed.

## Deferred / integrator proof

No production deployment or native/device proof is claimed. Parent owns those.
Confirm real end-to-end backend/web behavior after coordinated integration,
long content and small/large-text layouts, keyboard/screen-reader operation,
and old-client 409 messaging. The current history fetch limit (100) and
session-level analytics remain unchanged.

**Rest timer and persistence are deferred.** A reliable timer needs an
account-scoped durable active-session draft, elapsed-time recovery, navigation/
refresh semantics and interruption tests. This package has no resumable active
runner, timer, offline outbox, PRs, set types, supersets/RPE or device sync.
