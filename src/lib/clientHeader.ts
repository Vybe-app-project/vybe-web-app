/**
 * Which build of Vybe this is, for the `X-Vybe-Client` header the API reads
 * on every request (services/clientPolicy.js, middlewares/clientVersion.js):
 *
 *   X-Vybe-Client: <platform>/<version>[+<build>]      e.g. web/1.0.0+5228f21c0ffe
 *
 * The grammar (HEADER_PATTERN on the API) is
 *   platform  [A-Za-z][A-Za-z0-9-]{0,15}
 *   version   [0-9A-Za-z][0-9A-Za-z.-]{0,63}
 *   build     [0-9A-Za-z][0-9A-Za-z.-]{0,31}
 * with no colons, slashes or plus signs inside a token. A malformed header
 * counts as `missing`, which loses the adoption count today and becomes a
 * 426 once CLIENT_POLICY_REQUIRE_HEADER is on, so every token is sanitised
 * here and the output is never malformed (tests/client-header.test.mjs pins
 * the API's pattern against random junk).
 *
 * The version is package.json's (a semver, so the API can gate web with
 * CLIENT_MIN_VERSION_WEB); the build is the deployed commit sha when the
 * release passed it in (VITE_WEB_BUILD, Dockerfile.release), else the build
 * time (VITE_WEB_BUILT_AT, vite.config.ts), else nothing. Mirrors the mobile
 * app's src/config/appVersion.ts. Import-free on purpose.
 */

export const CLIENT_HEADER_NAME = 'X-Vybe-Client';
export const VERSION_ALPHABET = /^[0-9A-Za-z][0-9A-Za-z.-]{0,63}$/;
export const BUILD_ALPHABET = /^[0-9A-Za-z][0-9A-Za-z.-]{0,31}$/;
export const PLATFORM_ALPHABET = /^[A-Za-z][A-Za-z0-9-]{0,15}$/;

const VERSION_MAX = 64;
const BUILD_MAX = 32;
const PLATFORM_MAX = 16;
/** A commit sha is shortened to this many characters; git's own short form is 7 to 12. */
const SHA_LENGTH = 12;

export type ClientHeaderEnv = {
  VITE_WEB_VERSION?: unknown;
  VITE_WEB_BUILD?: unknown;
  VITE_WEB_BUILT_AT?: unknown;
};

/**
 * Keep only the dot/dash alphabet, drop a leading character the grammar
 * refuses, cap the length. Null when nothing survives.
 */
export function sanitizeToken(value: unknown, max: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const kept = String(value).trim().replace(/[^0-9A-Za-z.-]/g, '').replace(/^[.-]+/, '');
  const cut = kept.slice(0, Math.max(1, max));
  return cut ? cut : null;
}

const sanitizePlatform = (value: unknown): string => {
  if (typeof value !== 'string') return 'web';
  const kept = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^[^a-z]+/, '');
  const cut = kept.slice(0, PLATFORM_MAX);
  return cut ? cut : 'web';
};

/**
 * A build token in the shape the header allows: a hex sha is shortened, an
 * ISO timestamp loses its colons and milliseconds (2026-09-19T12:34:56Z ->
 * 20260919T123456Z), anything else is sanitised. Null when empty.
 */
export function normalizeBuild(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{7,64}$/.test(raw)) return raw.slice(0, SHA_LENGTH).toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
    }
  }
  return sanitizeToken(raw, BUILD_MAX);
}

/** `web/1.0.0+5228f21c0ffe`, `web/1.0.0`, or `web/dev` when no version is known. Never malformed. */
export function buildClientHeader({ platform, version, build }: { platform?: unknown; version?: unknown; build?: unknown }): string {
  const platformToken = sanitizePlatform(platform);
  const versionToken = sanitizeToken(version, VERSION_MAX) ?? 'dev';
  const buildToken = normalizeBuild(build);
  const safeBuild = buildToken && BUILD_ALPHABET.test(buildToken) ? buildToken : null;
  return safeBuild ? `${platformToken}/${versionToken}+${safeBuild}` : `${platformToken}/${versionToken}`;
}

/** The build token for this web bundle: the release sha, else the build time, else null. */
export function webBuildToken(env: ClientHeaderEnv | null | undefined): string | null {
  if (!env) return null;
  return normalizeBuild(env.VITE_WEB_BUILD) ?? normalizeBuild(env.VITE_WEB_BUILT_AT);
}

/** The header value for this web bundle. */
export function webClientHeader(env: ClientHeaderEnv | null | undefined): string {
  return buildClientHeader({ platform: 'web', version: env?.VITE_WEB_VERSION, build: webBuildToken(env) });
}
