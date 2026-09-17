# Security

## Reporting

Report suspected vulnerabilities privately to the repository owner. Do not open
a public issue for an unpatched security problem.

## Supply-chain hardening

On 2026-09-17 an obfuscated remote-code-execution loader was found committed to
this repository. This section documents what happened and the controls that now
prevent a recurrence, because the technique is easy to miss and easy to repeat.

### What the attack looked like

The payload was appended to an ordinary build configuration file, separated
from the legitimate content by roughly 270 to 500 characters of tabs. The file
therefore:

- looked correct when opened, because the payload sat far off the right edge of
  the editor viewport;
- looked correct in review, because GitHub's diff view truncates long lines;
- reported a plausible size in a directory listing.

The same campaign also smuggled payloads inside files named like web fonts
(`fa-solid-500.woff2`). Those files contained no font data at all — they were
100% script, relying on nobody ever opening a binary asset in a text editor.

The loader resolved its command-and-control address from a dead-drop field in
an Ethereum transaction, downloaded XOR-encrypted code, `eval`'d it, and
re-spawned itself as a detached `node -e` child process. It executed whenever a
tool loaded the configuration file — that is, on `npm test`, `npm run build`,
`npm run verify`, or a Metro start. Simply cloning and building the repository
was enough to run it.

### Controls now in place

1. **`scripts/scan-injected-code.mjs`** — a dependency-free scanner that
   detects the concealment technique itself (a long whitespace run followed by
   code), executable content inside binary assets (by magic-byte validation),
   known indicators from this campaign, and fetch-then-execute behaviour in
   build configs. It deliberately scans `dist/`, `build/` and `vendor/`, since
   all three were used to hide payloads.

2. **`.githooks/pre-commit`** — runs the scanner against staged changes. Enable
   it once per clone:

   ```sh
   npm run setup:hooks
   ```

   This is committed to the repository rather than left in `.git/hooks/`, so it
   travels to every clone. A `.git/hooks/` script protects only the machine it
   was created on and never reaches CI or another contributor.

3. **`.github/workflows/supply-chain.yml`** — runs the scanner on every push
   and pull request, before any dependency installation, so the check cannot be
   subverted by the dependency tree it guards. The job also plants a synthetic
   payload and asserts the scanner rejects it, so the gate cannot be silently
   disabled by a future refactor.

4. **`npm run scan`** is wired into `pretest`, so the scan runs on the exact
   code path that previously detonated the loader.

### Running the check manually

```sh
npm run scan                    # whole repository
npm run scan -- --staged        # staged changes only
node scripts/scan-injected-code.mjs path/to/file
```

### Inspecting a suspicious file

Whitespace-hidden code is invisible in a normal read. Make it visible:

```sh
cat -A path/to/file | tail -5   # renders tabs as ^I
awk 'length > 300 {print FILENAME": "FNR}' path/to/file
wc -c path/to/file              # compare against what the file should weigh
```

### Known-clean baseline

Every dependency in this repository's lockfile resolves to
`registry.npmjs.org`. Any future non-registry `resolved` entry — a `file:`,
`git:` or arbitrary `http:` source — should be treated as suspicious until
justified, since trojanized packages are this campaign's usual delivery route.

### Residual risk

Git history still contains the original payload in commits predating
2026-09-17. Only the branch tips were cleaned. Checking out an older commit and
running a build will re-execute it. Purging history requires a rewrite and a
force-push, which is an owner decision because it invalidates every existing
clone.
