/**
 * Accessible-description plumbing shared by the form fields. Import-free so
 * tests can load it directly (see tests/auth-onboarding.test.mjs).
 */

/**
 * The ids a field is described by: the shell's own error or hint first, then
 * whatever the caller adds (a live status line, a rules list). A caller's
 * `aria-describedby` is appended, never substituted, so an error keeps being
 * announced on a field that also wires extra text -- the username field on
 * sign-up lost its error text this way when its status id overrode the shell.
 */
export function describedByIds(id: string, error: unknown, hint: unknown, extra?: string | null): string | undefined {
  const own = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const added = typeof extra === 'string' ? extra.trim() : '';
  return [own, added].filter(Boolean).join(' ') || undefined;
}
