/**
 * Login activity in Settings › Privacy & safety.
 *
 * This API keeps no session list. Sessions are stateless JWTs; the only
 * per-session record on the user is `revokedSessions` (a revocation list,
 * `select: false`), and nothing stores a device name, an address or a
 * last-seen. There is no `GET /auth/sessions`, no `DELETE /auth/sessions/:id`
 * and no refresh token anywhere in the tree — the two sign-out routes are
 * `POST /auth/logout` (this session's `sid`) and `POST /auth/logout-all`
 * (bumps `tokenVersion`, so every session dies, this one included).
 *
 * So the card shows the one session it can actually describe — this device,
 * from the user agent and this tab's own token — says plainly that the
 * others cannot be listed, and offers the wide sign-out that does exist. It
 * does not draw a "Sign out other devices" button, because there is no route
 * that leaves this device signed in.
 *
 * Import-free on purpose: tests/account-settings-security.test.mjs
 * transpiles this file and imports the result directly.
 */

export const LOGIN_ACTIVITY_TITLE = 'Login activity';
export const LOGIN_ACTIVITY_DESCRIPTION = 'The session this browser is using, and the one control that ends them all.';
export const CURRENT_DEVICE = 'This device';

/**
 * Why there is no list. Said once, in the card, rather than implied by an
 * empty table: the API cannot enumerate sessions, so neither can this page.
 */
export const NO_DEVICE_LIST =
  'Vybe cannot list your other sessions — they are not recorded anywhere. Signing out everywhere is the way to end one you no longer trust.';

export const SIGN_OUT_EVERYWHERE = 'Sign out everywhere';

/** The browser, by the one token in the user agent that identifies it. */
export function browserName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  if (/\bEdgA?\//.test(ua)) return 'Edge';
  if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera';
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return 'Firefox';
  if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet';
  // Chrome's UA claims Safari, so Chrome has to be ruled out before Safari.
  if (/\bCriOS\/|\bChrome\//.test(ua)) return 'Chrome';
  if (/\bSafari\//.test(ua)) return 'Safari';
  return 'This browser';
}

/** The platform, or null when the agent does not say. */
export function platformName(userAgent: string | null | undefined): string | null {
  const ua = userAgent ?? '';
  if (/\biPhone\b/.test(ua)) return 'iPhone';
  if (/\biPad\b/.test(ua)) return 'iPad';
  if (/\bAndroid\b/.test(ua)) return 'Android';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'macOS';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/\bLinux\b/.test(ua)) return 'Linux';
  return null;
}

/** "Chrome on macOS", or just the browser when the platform is unknown. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const platform = platformName(userAgent);
  const browser = browserName(userAgent);
  return platform ? `${browser} on ${platform}` : browser;
}

export type SessionPersistence = 'local' | 'session' | null;

/**
 * What this session's lifetime is, in one line.
 *
 * A remembered session is a 30-day token, so the honest thing to print is
 * the day it runs out, read from the token's own `exp`. A tab-scoped one
 * (the "Keep me signed in" box unticked) ends when the tab does, whatever
 * the token says. An expiry that cannot be read is omitted rather than
 * guessed.
 */
export function sessionLifetimeLine(
  expiryMs: number | null | undefined,
  persistence: SessionPersistence,
  format: (at: Date) => string,
  now: number = Date.now(),
): string | null {
  if (persistence === 'session') return 'Ends when you close this tab.';
  if (typeof expiryMs !== 'number' || !Number.isFinite(expiryMs)) return null;
  if (expiryMs <= now) return 'This session has expired. Sign in again to continue.';
  return `Signed in until ${format(new Date(expiryMs))}.`;
}
