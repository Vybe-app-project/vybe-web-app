# Handoff pointer (web)

The cross-repo handoff (hosting, every repo's state, verification commands,
rules, open work, traps) lives in `vybe-backend/docs/HANDOFF.md`
(https://github.com/Vybe-app-project/vybe-backend/blob/main/docs/HANDOFF.md).

Web-specific essentials:
- Use Node 24.19.0 LTS (`.node-version`) and npm 11.17.0. Scan with
  `node scripts/scan-injected-code.mjs` before `npm ci` or any build.
- `docs/phase0-baseline.md` records the historical Node 20 baseline, not
  the current runtime requirement.
- Node 24 qualification: `npm run verify` passes (80 tests pass; the one
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
