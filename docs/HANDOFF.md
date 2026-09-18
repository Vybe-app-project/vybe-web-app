# Handoff pointer (web)

The cross-repo handoff (hosting, every repo's state, verification commands,
rules, open work, traps) lives in `vybe-backend/docs/HANDOFF.md`
(https://github.com/Vybe-app-project/vybe-backend/blob/main/docs/HANDOFF.md).

Web-specific essentials:
- `npm run verify` before any release; source contracts in
  `tests/source-contract.test.mjs`.
- Release with `VYBE_OVH_HOST=hermes VYBE_WEB_HEALTH_URL=<origin>/healthz.json scripts/release-ovh.sh`;
  roll back with `scripts/rollback-ovh.sh <sha>`.
- After a release run the live suite `~/scratch/2026-09-17-vybe-full-build/uitest/run-all.sh`
  (11 groups incl. axe in both themes).
