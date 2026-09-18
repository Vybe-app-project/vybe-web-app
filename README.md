# Vybe consumer web app

The installable browser client for Vybe. It includes the social feed, profiles,
friends, stories, messaging, gyms and communities, workouts, nutrition,
hydration and health tracking, progress photos, livestreams, achievements,
challenges, settings, support, and the authenticated administration console.

The default API origin is same-origin `/api`. Production therefore serves the
web client and proxies `/api`, `/uploads`, and `/socket.io` to the Vybe backend
from the same Caddy site. `VITE_API_BASE` may override this for local testing;
never place credentials or provider keys in a `VITE_` variable because Vite
embeds those values in the public JavaScript bundle.

## Local verification

Use Node 24.19.0 LTS from `.node-version` (npm 11.17.0):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
node scripts/scan-injected-code.mjs
npm ci
npm run verify
```

`verify` audits production dependencies, runs source-contract tests,
type-checks the complete app, builds the production bundle, and inspects the
result for missing assets, source maps, and embedded credential patterns.
The committed `contracts/backend-routes.json` lets an isolated OVH build repeat
the route audit without cloning another repository. When backend routes change,
review them and run `npm run contracts:snapshot`; local verification rejects a
stale snapshot before it can be released.

## OVH build

The release container is pinned by digest to Node 24.19.0 Alpine. It scans
source before installing dependencies and builds a static artifact
without requiring a GitHub Actions runner:

```sh
docker build \
  --pull \
  --target artifact \
  --output type=local,dest="$PWD/release-output" \
  -f Dockerfile.release .
```

The publishable site is written beneath `release-output/site`. Deploy an exact
Git commit archive on OVH, keep releases immutable, and switch the live Caddy
root atomically only after `npm run verify` succeeds. GitHub is source control;
it is not part of the runtime or build path.

For the complete direct-to-OVH transaction, start from a clean committed tree:

```sh
export VYBE_OVH_HOST=your-ssh-config-alias
export VYBE_WEB_HEALTH_URL=https://your-web-origin.example/healthz.json
./scripts/release-ovh.sh
```

The health URL must be a static file served by the web release (`healthz.json`
ships in `public/`), not the API's `/health`, which the web origin does not
proxy.

The local script creates a deterministic `git archive`, records its SHA-256,
and uploads it over SSH. The SSH user is an ordinary account; the remote steps
run through `sudo -n` because the incoming directory lives under `/opt` and the
release root under `/srv`. OVH rebuilds the archive with the pinned container,
publishes it under `/srv/vybe-consumer/releases/<commit>`, and atomically
updates `/srv/vybe-consumer/current`. A failed public health check restores the
previous symlink. The script refuses dirty trees and refuses to replace an
existing release with different source bytes.

To roll back:

```sh
ssh "$VYBE_OVH_HOST" ls /srv/vybe-consumer/releases   # candidates
./scripts/rollback-ovh.sh <full 40-character commit sha>
```

It only changes the `current` symlink; release files remain read-only and
production data is untouched.
