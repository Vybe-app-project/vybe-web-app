# Concurrent web releases

The web release command captures the currently deployed commit before uploading.
The candidate must contain that commit in its ancestry. Under the remote release
lock, the publisher checks that `current` still points to the captured artifact
before building or switching it.

If another session deployed first, the command stops instead of reverting its
work. Integrate the newer release and retry. An intentional rollback still uses
the existing rollback script; a normal release is not an implicit rollback.

Direct callers of `deploy-web-remote.sh` must provide four arguments:
the source archive, its SHA-256, the candidate commit, and the expected current
commit (or `none` for the first release). `release-ovh.sh` supplies these.

The read-only `--check-current EXPECTED CURRENT_SYMLINK` command checks the same
guard without requiring root or touching releases. Behavioral and wiring tests
are in `tests/release-concurrency.test.mjs`.
