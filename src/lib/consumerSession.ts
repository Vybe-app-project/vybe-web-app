export const CONSUMER_TOKEN_KEY = 'vybe.token';
export type SessionPersistence = 'local' | 'session';
type Kind = 'user' | 'admin';
const epochs = { user: 0, admin: 0 };
const listeners = new Set<(kind: Kind, rejected: boolean, external: boolean) => void>();
let verifiedToken: string | null = null;

export function readConsumerSession(): { token: string; persistence: SessionPersistence } | null {
  for (const persistence of ['local', 'session'] as const) {
    try {
      const token = (persistence === 'local' ? localStorage : sessionStorage).getItem(CONSUMER_TOKEN_KEY);
      if (token) return { token, persistence };
    } catch { /* An unavailable store is not permission to persist somewhere else. */ }
  }
  return null;
}
export const readConsumerToken = () => readConsumerSession()?.token ?? null;
export const sessionEpoch = (kind: Kind = 'user') => epochs[kind];
export const readVerifiedConsumerToken = () => verifiedToken === readConsumerToken() ? verifiedToken : null;
export function verifyConsumerToken(token: string | null) {
  verifiedToken = token && token === readConsumerToken() ? token : null;
}
export function onSessionChange(listener: (kind: Kind, rejected: boolean, external: boolean) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifySessionChange(kind: Kind = 'user', rejected = false, external = false) {
  epochs[kind]++;
  if (kind === 'user') verifiedToken = null;
  for (const listener of listeners) listener(kind, rejected, external);
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === CONSUMER_TOKEN_KEY || event.key === 'vybe.workout-drafts.generation' || event.key === null) {
      notifySessionChange('user', false, true);
    }
  });
}
