import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, unlinkSync, rmSync, rmdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const remoteScript = fileURLToPath(new URL('../scripts/deploy-web-remote.sh', import.meta.url));
const first = 'a'.repeat(40);
const second = 'b'.repeat(40);

test('release compare-and-swap accepts only the observed current artifact', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vybe-release-guard-'));
  const current = path.join(dir, 'current');
  const check = (expected) => spawnSync('bash', [remoteScript, '--check-current', expected, current], { encoding: 'utf8' });
  try {
    assert.equal(check('none').status, 0);
    assert.notEqual(check(first).status, 0);
    symlinkSync(`/srv/vybe-consumer/releases/${first}`, current);
    assert.equal(check(first).status, 0);
    assert.notEqual(check('none').status, 0);
    assert.match(check(second).stderr, /refusing to overwrite another deployment/);
    unlinkSync(current);
    symlinkSync(`releases/${second}`, current);
    assert.equal(check(second).status, 0);
    assert.notEqual(check(first).status, 0);
    assert.notEqual(check('not-a-sha').status, 0);
    unlinkSync(current);
    writeFileSync(current, 'unexpected regular file');
    assert.match(check('none').stderr, /not a symlink/);
  } finally {
    rmSync(current, { force: true });
    rmdirSync(dir);
  }
});

test('the publisher checks the release base under its lock and the caller requires ancestry', () => {
  const remote = readFileSync(remoteScript, 'utf8');
  const caller = readFileSync(new URL('../scripts/release-ovh.sh', import.meta.url), 'utf8');
  assert.ok(remote.indexOf('check_current_release "$expected_current" "$current"') > remote.indexOf('flock -x 9'));
  assert.ok(remote.indexOf('check_current_release "$expected_current" "$current"') < remote.indexOf('docker buildx build'));
  assert.match(caller, /git merge-base --is-ancestor "\$expected_current" "\$commit_sha"/);
  assert.match(caller, /\$quoted_commit \$quoted_expected_current/);
});
