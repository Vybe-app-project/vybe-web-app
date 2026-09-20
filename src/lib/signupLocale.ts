/**
 * The BCP-47 tag sent once with a sign-up so the API can resolve
 * `settings.units` for the new account (US, LR and MM resolve to imperial;
 * every other region resolves to metric). Applied at account creation only, so
 * it can never overwrite a returning member's choice.
 *
 * Sent as-is and never guessed: the API drops anything over 35 characters,
 * canonicalises the rest through `Intl.getCanonicalLocales` and stores nothing
 * when the tag is malformed or carries no region. An absent value is
 * meaningfully different from a hardcoded default -- with no tag the client's
 * own device fallback still decides the units -- so this returns undefined
 * rather than inventing one.
 */
export function signupLocale(): string | undefined {
  const tag = typeof navigator === 'undefined' ? '' : (navigator.language ?? '').trim();
  if (!tag || tag.length > 35) return undefined;
  return tag;
}
