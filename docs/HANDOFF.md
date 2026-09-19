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
- Web version and the API floor. Every request carries
  `X-Vybe-Client: web/<version>+<sha>`. The version is `MAJOR.YYYYMMDD.HHMM`
  from the UTC build clock (`vite.config.ts`; the release passes it in as the
  `VITE_WEB_VERSION` build arg), so each deploy is a semver above every
  earlier one; `package.json`'s `version` supplies only the MAJOR and is not
  bumped per release. To retire builds older than a deploy, set
  `CLIENT_MIN_VERSION_WEB` on the API to that deploy's version (Settings >
  Help and legal > Version shows it, as does `GET /admin/analytics`
  `clientAdoption`); `CLIENT_LATEST_VERSION_WEB` works the same way.
  `scripts/deploy-web-remote.sh` reads the live floor from
  `GET /api/capabilities` (`client.platforms.web.minVersion`) and refuses to
  publish a build below it, because every tab would land on the Reload Vybe
  screen with nothing newer to load. The API contract still describes web as
  sending a commit sha (`vybe-backend/docs/api-contract.md`, "Client
  policy"); the API lane owns that wording.
