import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * X-Vybe-Client for the web bundle. The API's grammar (services/clientPolicy.js
 * HEADER_PATTERN, copied below) treats a malformed header as missing, which
 * becomes a 426 once CLIENT_POLICY_REQUIRE_HEADER is on; the builder must
 * therefore produce a matching value from any input.
 */
const {
  BUILD_ALPHABET,
  CLIENT_HEADER_NAME,
  VERSION_ALPHABET,
  buildClientHeader,
  normalizeBuild,
  sanitizeToken,
  webBuildToken,
  webClientHeader,
} = await import('../src/lib/clientHeader.ts');

// services/clientPolicy.js:44 on the API, verbatim.
const BACKEND_PATTERN = /^([A-Za-z][A-Za-z0-9-]{0,15})\/([0-9A-Za-z][0-9A-Za-z.-]{0,63})(?:\+([0-9A-Za-z][0-9A-Za-z.-]{0,31}))?$/;
const SHA40 = '5228f21c0ffee1234567890abcdef1234567890a';

test('the happy path is platform/version+build', () => {
  assert.equal(CLIENT_HEADER_NAME, 'X-Vybe-Client');
  assert.equal(buildClientHeader({ platform: 'web', version: '1.0.0', build: '5228f21' }), 'web/1.0.0+5228f21');
  assert.equal(buildClientHeader({ platform: 'web', version: '1.0.0', build: null }), 'web/1.0.0');
  assert.equal(buildClientHeader({ platform: 'web', version: '1.0.0' }), 'web/1.0.0');
  assert.equal(buildClientHeader({ platform: 'web' }), 'web/dev');
  assert.equal(buildClientHeader({}), 'web/dev');
  assert.equal(buildClientHeader({ platform: 'WEB', version: '2.1.0-beta.1', build: '12' }), 'web/2.1.0-beta.1+12', 'platform lower-cased, prerelease kept');
});

test('builds are normalised: a full sha is shortened, a timestamp loses its colons, junk is stripped or dropped', () => {
  assert.equal(buildClientHeader({ platform: 'web', version: '1.0.0', build: SHA40 }), `web/1.0.0+${SHA40.slice(0, 12)}`);
  assert.equal(normalizeBuild(SHA40).length, 12);
  assert.equal(normalizeBuild('2026-09-19T12:34:56.789Z'), '20260919T123456Z');
  assert.match(buildClientHeader({ platform: 'web', version: '1.0.0', build: '2026-09-19T12:34:56.789Z' }), /^web\/1\.0\.0\+20260919T123456Z$/);
  assert.equal(buildClientHeader({ platform: 'web', version: '1.0.0', build: 'build with space' }), 'web/1.0.0+buildwithspace');
  assert.equal(buildClientHeader({ platform: 'web', version: '1.0.0', build: '+++' }), 'web/1.0.0');
  assert.equal(buildClientHeader({ platform: 'web', version: '1.0.0', build: '' }), 'web/1.0.0');
  assert.equal(buildClientHeader({ platform: 'web', version: '1.0.0', build: '.-.leading' }), 'web/1.0.0+leading');
});

test('versions and platforms are bounded and never empty', () => {
  const long = '9'.repeat(80);
  const header = buildClientHeader({ platform: 'web', version: long });
  assert.equal(header, `web/${'9'.repeat(64)}`);
  assert.equal(buildClientHeader({ platform: '', version: '1.0.0' }), 'web/1.0.0');
  assert.equal(buildClientHeader({ platform: '123', version: '1.0.0' }), 'web/1.0.0', 'a platform must start with a letter');
  assert.equal(buildClientHeader({ platform: 'Web-Kiosk_1', version: '1.0.0' }), 'web-kiosk1/1.0.0');
  assert.equal(buildClientHeader({ platform: 'w'.repeat(40), version: '1.0.0' }), `${'w'.repeat(16)}/1.0.0`);
  assert.equal(buildClientHeader({ platform: 'web', version: ' 1.0.0 ' }), 'web/1.0.0');
  assert.equal(buildClientHeader({ platform: 'web', version: '1.0.0/evil+x' }), 'web/1.0.0evilx');
  assert.equal(sanitizeToken('...', 10), null);
  assert.equal(sanitizeToken(42, 10), '42');
});

test('the web env reads version, then sha, then build time', () => {
  assert.equal(webClientHeader({}), 'web/dev');
  assert.equal(webClientHeader(undefined), 'web/dev');
  assert.equal(webClientHeader({ VITE_WEB_VERSION: '1.0.0' }), 'web/1.0.0');
  assert.equal(webClientHeader({ VITE_WEB_VERSION: '1.0.0', VITE_WEB_BUILD: SHA40 }), `web/1.0.0+${SHA40.slice(0, 12)}`);
  assert.equal(webClientHeader({ VITE_WEB_VERSION: '1.0.0', VITE_WEB_BUILD: SHA40, VITE_WEB_BUILT_AT: '2026-09-19T12:34:56Z' }), `web/1.0.0+${SHA40.slice(0, 12)}`, 'the sha wins over the clock');
  assert.equal(webClientHeader({ VITE_WEB_VERSION: '1.0.0', VITE_WEB_BUILT_AT: '2026-09-19T12:34:56Z' }), 'web/1.0.0+20260919T123456Z');
  assert.equal(webBuildToken({ VITE_WEB_BUILT_AT: 'not a date' }), 'notadate');
  assert.equal(webBuildToken({}), null);
  assert.equal(webBuildToken(null), null);
});

test('every output matches the API grammar, including 200 random junk inputs', () => {
  // Letters, digits, the separators the grammar refuses, whitespace, punctuation and non-ASCII.
  const alphabet = ['a', 'b', 'c', 'X', 'Y', 'Z', '0', '1', '9', ' ', '.', '-', '+', '/', ':', '_', '\\', String.fromCharCode(9), String.fromCharCode(10), '#', '%', String.fromCharCode(233), String.fromCodePoint(0x1f600)];
  let seed = 20260919;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const junk = () => {
    const length = Math.floor(rand() * 90);
    let out = '';
    for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(rand() * alphabet.length)];
    return out;
  };
  const inputs = [SHA40, '', ' ', '+++', '///', '::', '1.0.0+1+2', '../..', String.fromCharCode(0), `${String.fromCharCode(252)}1.0`, '.'.repeat(70)];
  for (let i = 0; i < 200; i += 1) inputs.push(junk());
  for (const value of inputs) {
    for (const header of [
      buildClientHeader({ platform: value, version: value, build: value }),
      buildClientHeader({ platform: 'web', version: value }),
      buildClientHeader({ platform: 'web', version: '1.0.0', build: value }),
      webClientHeader({ VITE_WEB_VERSION: value, VITE_WEB_BUILD: value }),
      webClientHeader({ VITE_WEB_VERSION: value, VITE_WEB_BUILT_AT: value }),
    ]) {
      const match = BACKEND_PATTERN.exec(header);
      assert.ok(match, `${JSON.stringify(header)} from ${JSON.stringify(value)} does not match the API grammar`);
      assert.match(match[2], VERSION_ALPHABET);
      if (match[3]) assert.match(match[3], BUILD_ALPHABET);
    }
  }
});
