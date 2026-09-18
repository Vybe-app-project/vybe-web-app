import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The policy modules are import-free TypeScript so they can run here without
 * a bundler: transpile in memory and import the result as a data: URL. The
 * import-free check is explicit so a future import fails with a readable
 * message instead of an unresolved bare specifier.
 */
async function loadModule(relative) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m, `${relative} must stay import-free so tests can load it directly`);
  const { outputText } = ts.transpileModule(source, {
    fileName: path.basename(relative),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`);
}

const policy = await loadModule('src/lib/passwordPolicy.ts');
const reset = await loadModule('src/lib/passwordReset.ts');

// validator.js isStrongPassword `symbolRegex` set, which the API applies to
// every password it accepts. `£` is in; `é`, `€` and friends are not.
const VALIDATOR_SYMBOLS = '-#!$@£%^&*()_+|~=`{}[]:";\'<>?,./\\ ';

test('the password policy matches the API strongPassword validator', () => {
  const { passwordRules, isPasswordValid } = policy;
  const ruleState = (pw) => Object.fromEntries(passwordRules(pw).map((r) => [r.id, r.ok]));

  assert.equal(isPasswordValid('Correct-horse-9X'), true);
  assert.deepEqual(ruleState('Correct-horse-9X'), { len: true, lower: true, upper: true, number: true, symbol: true });

  assert.deepEqual(ruleState('Short-1A'), { len: false, lower: true, upper: true, number: true, symbol: true });
  assert.deepEqual(ruleState('correct-horse-9x'), { len: true, lower: true, upper: false, number: true, symbol: true });
  assert.deepEqual(ruleState('CORRECT-HORSE-9X'), { len: true, lower: false, upper: true, number: true, symbol: true });
  assert.deepEqual(ruleState('Correct-horse-XX'), { len: true, lower: true, upper: true, number: false, symbol: true });
  assert.deepEqual(ruleState('CorrectHorse9XX1'), { len: true, lower: true, upper: true, number: true, symbol: false });

  // Length bounds are inclusive at 12 and 128, as in isLength/minLength.
  assert.equal(isPasswordValid('Ab1!' + 'x'.repeat(8)), true);
  assert.equal(isPasswordValid('Ab1!' + 'x'.repeat(7)), false);
  assert.equal(isPasswordValid('Ab1!' + 'x'.repeat(124)), true);
  assert.equal(isPasswordValid('Ab1!' + 'x'.repeat(125)), false);
});

test('only validator.js symbols satisfy the symbol rule', () => {
  const { passwordRules } = policy;
  const symbolOk = (pw) => passwordRules(pw).find((r) => r.id === 'symbol').ok;

  for (const symbol of VALIDATOR_SYMBOLS) {
    assert.equal(symbolOk(`Abcdefghijk1${symbol}`), true, `${JSON.stringify(symbol)} must count as a symbol`);
  }
  // These pass the models' /[^A-Za-z0-9]/ check but the API rejects them
  // first, so the UI must not tick the box.
  for (const notSymbol of ['é', '€', '§', '—', '¬', '中', '😀']) {
    assert.equal(symbolOk(`Abcdefghijk1${notSymbol}`), false, `${notSymbol} must not count as a symbol`);
  }
});

test('reset tokens must be exactly 64 hex characters', () => {
  const { isResetToken, readResetToken } = reset;
  const hex = 'a'.repeat(64);

  assert.equal(isResetToken(hex), true);
  assert.equal(isResetToken(hex.toUpperCase()), true);
  assert.equal(isResetToken('0123456789abcdef'.repeat(4)), true);
  assert.equal(isResetToken(hex.slice(1)), false);
  assert.equal(isResetToken(`${hex}a`), false);
  assert.equal(isResetToken(`0x${'a'.repeat(62)}`), false);
  assert.equal(isResetToken('g'.repeat(64)), false);
  assert.equal(isResetToken(''), false);
  assert.equal(isResetToken(null), false);
  assert.equal(isResetToken(undefined), false);

  assert.equal(readResetToken(new URLSearchParams(`?token=${hex}`)), hex);
  assert.equal(readResetToken(new URLSearchParams(`?token=%20${hex}%20`)), hex, 'surrounding whitespace is trimmed');
  assert.equal(readResetToken(new URLSearchParams('?other=1')), '');
  assert.equal(readResetToken(new URLSearchParams('')), '');
});

test('reset failures are sorted into the states the pages render', () => {
  const { classifyResetFailure, resetFailureMessage } = reset;
  const fallback = 'Could not do it.';
  const http = (status, message) => ({ response: { status, data: message === undefined ? {} : { message } } });

  assert.deepEqual(classifyResetFailure({ code: 'ERR_NETWORK' }, { fallback }), { kind: 'network' });
  assert.deepEqual(classifyResetFailure({ code: 'ECONNABORTED' }, { fallback }), { kind: 'network' });
  assert.deepEqual(classifyResetFailure(http(500, 'x'), { online: false, fallback }), { kind: 'network' });

  assert.deepEqual(
    classifyResetFailure(http(429, 'Too many reset attempts, please try again later.'), { fallback }),
    { kind: 'rate-limited', message: 'Too many reset attempts, please try again later.' },
  );
  assert.equal(classifyResetFailure(http(429), { fallback }).kind, 'rate-limited');
  assert.ok(classifyResetFailure(http(429), { fallback }).message.length > 0, 'rate limit without a body still has copy');

  // The API's two 400s: a dead link becomes a state, a validation miss stays a message.
  assert.deepEqual(classifyResetFailure(http(400, 'Invalid or expired reset token'), { fallback }), { kind: 'invalid-token' });
  assert.deepEqual(
    classifyResetFailure(http(400, 'Invalid token or password'), { fallback }),
    { kind: 'rejected', message: 'Invalid token or password' },
  );
  assert.deepEqual(
    classifyResetFailure(http(400, 'Valid email is required'), { fallback }),
    { kind: 'rejected', message: 'Valid email is required' },
  );

  assert.deepEqual(classifyResetFailure(http(500, 'Could not reset password'), { fallback }), { kind: 'rejected', message: 'Could not reset password' });
  assert.deepEqual(classifyResetFailure(http(502), { fallback }), { kind: 'rejected', message: fallback });
  assert.deepEqual(classifyResetFailure(undefined, { fallback }), { kind: 'rejected', message: fallback });
  assert.deepEqual(classifyResetFailure(new Error('boom'), { fallback }), { kind: 'rejected', message: fallback });

  for (const failure of [
    { kind: 'network' },
    { kind: 'invalid-token' },
    { kind: 'rate-limited', message: 'slow down' },
    { kind: 'rejected', message: 'nope' },
  ]) {
    const text = resetFailureMessage(failure);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0, `${failure.kind} needs user-facing copy`);
  }
  assert.equal(resetFailureMessage({ kind: 'rate-limited', message: 'slow down' }), 'slow down');
  assert.equal(resetFailureMessage({ kind: 'rejected', message: 'nope' }), 'nope');
});
