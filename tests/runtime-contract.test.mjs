import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const version = read('.node-version').trim();

test('manifest, lockfile and package manager match the qualified runtime', () => {
  const manifest = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(version, '24.19.0');
  assert.equal(manifest.engines.node, `>=${version} <25`);
  assert.deepEqual(lock.packages[''].engines, manifest.engines);
  assert.equal(manifest.packageManager, 'npm@11.17.0');
});

test('release builds pin Node and scan source before installing', () => {
  const dockerfile = read('Dockerfile.release');
  assert.ok(dockerfile.includes(`FROM node:${version}-alpine@sha256:`));
  assert.match(dockerfile, /@sha256:[a-f0-9]{64}\b/);
  const scan = dockerfile.indexOf('RUN node scripts/scan-injected-code.mjs');
  const install = dockerfile.indexOf('RUN npm ci');
  assert.ok(scan > dockerfile.indexOf('COPY . .'));
  assert.ok(install > scan);
  assert.ok(dockerfile.indexOf('RUN npm run verify') > install);
});

for (const file of ['ci.yml', 'supply-chain.yml']) {
  test(`${file} uses the runtime pin and retains scanning`, () => {
    const workflow = read(`.github/workflows/${file}`);
    const setups = workflow.match(/uses: actions\/setup-node@/g) || [];
    const pins = workflow.match(/node-version-file: \.node-version/g) || [];
    assert.ok(setups.length > 0);
    assert.equal(pins.length, setups.length);
    assert.doesNotMatch(workflow, /\bnode-version:/);
    const scan = workflow.indexOf('run: node scripts/scan-injected-code.mjs');
    assert.ok(scan >= 0);
    const install = workflow.indexOf('run: npm ci');
    if (install >= 0) assert.ok(install > scan);
  });
}

test('CI runs the complete verification gate, not just the supply-chain scan', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.ok(workflow.includes('run: npm run verify'));
  assert.doesNotMatch(workflow, /continue-on-error: true/);
});
