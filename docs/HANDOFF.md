# Handoff pointer (web)

The cross-repo handoff (hosting, every repo's state, verification commands,
rules, open work, traps) lives in `vybe-backend/docs/HANDOFF.md`
(https://github.com/Vybe-app-project/vybe-backend/blob/main/docs/HANDOFF.md).

Web-specific essentials:
- Use Node 24.19.0 LTS (`.node-version`) and npm 11.17.0. Scan with
  `node scripts/scan-injected-code.mjs` before `npm ci` or any build.
- `docs/phase0-baseline.md` records the historical Node 20 baseline, not
  the current runtime requirement.
- Historical standalone Node 24 qualification: `npm run verify` passed (80 tests pass; the one
  optional Playwright legal-page suite remains skipped), including the
  production audit, typecheck, build and artifact checks. A clean pinned
  Alpine Docker build also passes the full gate. There is no separate lint
  script. Node 20 baseline: 75 pass / the same skip. No dependencies changed.
- `.github/workflows/ci.yml` now runs the full gate with a scan before
  `npm ci`; hosted execution still needs owner billing resolution and an
  approved push. No release, rollback or live-client compatibility test was
  performed. Full cross-repo evidence is in the canonical handoff's
  "Node 24 qualification package" section.
- `npm run verify` before any release; source contracts in
  `tests/source-contract.test.mjs`.
- Release with `VYBE_OVH_HOST=hermes VYBE_WEB_HEALTH_URL=<origin>/healthz.json scripts/release-ovh.sh`;
  roll back with `scripts/rollback-ovh.sh <sha>`.
- After a release run the live suite `~/scratch/2026-09-17-vybe-full-build/uitest/run-all.sh`
  (11 groups incl. axe in both themes).

## Reconciled web baseline — 2026-09-18

This is a **local, isolated integration**, not a deployment or completion of
the broader release. Branch `aaa-a656-fleet-web-reconcile`, worktree
`~/work/vybe/wt/aaa-a656-fleet-web-reconcile`, combines:

- Base `origin/main`: `52a086a1cbe570aac72ae0ebaf3c941735f5fe81`,
  including `03bcac21aa79188f505b98adc390efea0d668e52` place pictures.
- Merged `aaa-a656-web-session`: `ffb93708e32361931058676a60510feb29bfa99a`,
  including the previously deployed
  `050d089f85893971fd0eee11574a0e0bbc55cc83`.
- Common ancestor: `c39e1bbb8074835ee8b103b5891e0cf6e56ecbfb`.

The merge preserves main's `PlaceImage`/Gyms integration, meal-token handoff to
`/meals/shared/:token`, and full-template `PUT /workouts/update/:id`. It also
retains the session branch's Node 24 runtime, recoverable startup, private PWA
cache migration, release ancestry/compare-and-swap guards, per-set logger and
opt-in live smoke harness. The source-contract test merges both branches'
assertions. No product implementation was replaced with an older version.

New regressions in `tests/share-links.test.mjs` and
`tests/reconciled-baseline.browser.test.mjs` verify:

- Shared meal tokens versus legacy IDs, other handoff types and invalid input.
- Desktop and phone meal handoff through expired-session sign-in (401) and
  recoverable startup (503), retaining the destination and not fetching the
  meal before verification succeeds.
- Recipient denial (403), without falling back to a private meal ID.
- Full template-field edits followed by logging the updated prescription:
  aggregate prefill remains aggregate until explicitly starting blank,
  incomplete sets; only the user's subsequently entered set is submitted.
- Signed place-photo failure with deterministic fallback and a working Maps
  link, without losing main's fitness-place search filter.

The API route audit reads `~/work/vybe/wt/int-vybe-backend` **without editing it**,
pinned at `7368dbd0c972b2baf1b512a245c2ea1aca3d585f`: 284 statically resolved
web Axios calls against 369 mounted routes; zero unmatched/shadowed endpoints,
unresolved bases or dynamic calls. Its existing route snapshot still matches.
This checks route existence, not backend storage behavior.

Reproduce with Node 24.19.0/npm 11.17.0 and unchanged locked dependencies:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
mkdir -p node_modules/.cache/runtime node_modules/.cache/npm
export TMPDIR="$PWD/node_modules/.cache/runtime"
export npm_config_cache="$PWD/node_modules/.cache/npm"
export VYBE_PLAYWRIGHT="$HOME/.agents/skills/playwright-skill/node_modules/playwright/index.mjs"
npm run scan
npm run build
npm run verify
npm test
node scripts/audit-api-contracts.cjs ../int-vybe-backend
git diff --check
```

Build first because the browser suites consume `dist`; `npm run verify` tests,
rebuilds and verifies the artifact, then the final `npm test` checks the freshly
rebuilt app. Browser requests use local fixtures, never production accounts.
Without `VYBE_PLAYWRIGHT` the browser suites skip: that is not browser evidence.
The qualification reused per-package links only after comparing dependency
manifests and the complete locked dependency graph. All writable caches were
worktree-local; this is not a clean-install or new container-build claim.

Qualification results on this combined tree:

- Focused new regressions: **10 passed, zero failures/skips**.
- Browser-enabled `npm run verify`: **140 passed, zero failures/skips** in four
  browser suites plus the Node tests; supply-chain scan, production dependency
  audit (**zero findings**), API contracts, typecheck, build and artifact
  verification all passed (107 build files / five entry assets).
- A second browser-enabled full `npm test` against that newly rebuilt artifact:
  **140 passed, zero failures/skips/cancellations**.
- The read-only live-source route audit above passed and its backend SHA was
  unchanged on recheck. `git diff --check` and unresolved-merge checks passed.
- Main's four feature files and the preserved session/runtime/logger/release
  files were compared byte-for-byte with their respective input commits.

Raw local output is retained in ignored
`logs/fleet-web-reconcile/{verify,built-app-full,backend-contract}.log`.
The initial non-browser bootstrap verification also passed, with its three
optional browser skips; only the later zero-skip runs count as browser evidence.

The unqualified draft/timer branch `b8b5e3af0b9bf2bb84ac87a9e1928bc07aa2e96f`
is deliberately excluded. The live smoke harness is retained but was not run;
no credentials or live mutations were used. No push/deployment, native/device,
hosted CI or global baseline/rollout completion is claimed. The `claude-main` /
`int-*` production integrator and `v2-*` mobile-feature session retain their
lanes; a future release still needs their coordination and production evidence.
