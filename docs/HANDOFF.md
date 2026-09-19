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

Data lifecycle (Wave C1: Settings > Download your data, Delete account):
- `DELETE /users/me`, `POST /users/me/exports` and the download route send
  an `X-Reauth` header (from `POST /auth/reauth`). The API's CORS
  `allowedHeaders` (vybe-backend `app.js`, pinned by `tests/hardening.test.js`)
  does not list `X-Reauth` yet. Production is unaffected because the apex
  proxies `/api` same-origin, but any cross-origin host (a dev build with
  `VITE_API_BASE` at the API origin, or a future web host calling
  api.vybeapp.fit) fails the preflight on those three calls and the dialog
  shows the offline copy. Land the API change before serving the web from
  another origin.
- `/auth/reauth`, `/users/me/deletion` and `/users/me/deletion/cancel` go over
  `fetch` in `src/lib/lifecycleApi.ts` until the contracts scanner sees the
  named routers; switch them to `api` once the snapshot pins them.
