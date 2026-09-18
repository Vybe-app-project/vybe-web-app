/**
 * Password policy for every form that sets a password: consumer sign-up and
 * reset, and the staff console's reset flow.
 *
 * Mirrors the API's express-validator gate, which runs before any model
 * validation:
 *
 *   isStrongPassword({ minLength: 12, minLowercase: 1, minUppercase: 1,
 *                      minNumbers: 1, minSymbols: 1 }).isLength({ max: 128 })
 *
 * The Mongoose models accept any non-alphanumeric character as a symbol, but
 * validator.js only counts characters from its own symbol set, so that set is
 * the one the UI has to enforce. Otherwise a password such as "Abcdefghijk1é"
 * ticks every box on the client and is then refused by the API with a message
 * about the token, which is a dead end on a reset page.
 *
 * This module is import-free on purpose: the node:test suite transpiles it in
 * memory and imports the result directly.
 */

export type PasswordRule = { id: string; label: string; ok: boolean };

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** validator.js `isStrongPassword` symbol set (its `symbolRegex`), nothing more. */
export const PASSWORD_SYMBOL_RE = /[-#!$@£%^&*()_+|~=`{}[\]:";'<>?,.\/\\ ]/;

export function passwordRules(pw: string): PasswordRule[] {
  return [
    {
      id: 'len',
      label: '12–128 characters',
      ok: pw.length >= PASSWORD_MIN_LENGTH && pw.length <= PASSWORD_MAX_LENGTH,
    },
    { id: 'lower', label: 'One lowercase letter', ok: /[a-z]/.test(pw) },
    { id: 'upper', label: 'One uppercase letter', ok: /[A-Z]/.test(pw) },
    { id: 'number', label: 'One number', ok: /[0-9]/.test(pw) },
    { id: 'symbol', label: 'One symbol (!@#$…)', ok: PASSWORD_SYMBOL_RE.test(pw) },
  ];
}

export const isPasswordValid = (pw: string): boolean => passwordRules(pw).every((r) => r.ok);
