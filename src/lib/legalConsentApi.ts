import { useQuery } from '@tanstack/react-query';
import { CLIENT_HEADER_VALUE, api } from './api';
import { useAuth } from './auth';
import {
  GATE_SURFACE,
  acceptBody,
  legalQueryKey,
  normalizeLegalCurrent,
  normalizeLegalState,
  pendingKinds,
  type AcceptanceSurface,
  type LegalAcceptanceRecord,
  type LegalDocument,
  type LegalDocumentKind,
  type LegalState,
} from './legalConsent';

/**
 * The two legal calls, on the shared `api` axios instance so the bearer
 * token, X-Vybe-Client, X-Platform: web and the 401 sign-out all come free.
 * Not lifecycleApi.ts: that fetch path exists for routes that must survive
 * REAUTH_REQUIRED and pending-deletion sessions, and these are neither.
 */

export async function getLegalState(): Promise<LegalState | null> {
  const { data } = await api.get('/legal/acceptances');
  const body: Record<string, unknown> = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  if (normalizeLegalCurrent(body.current)) return normalizeLegalState(body);
  // The deployed API carries `current` on this answer; an older build would
  // not, and the public route has the same object (mobile's fallback too).
  const current = (await api.get('/legal/current')).data;
  return normalizeLegalState({ ...body, current });
}

export type AcceptResult = {
  pending: LegalDocumentKind[];
  /** The rows just written, keyed by document, to refresh the cached `accepted` without a refetch. */
  accepted: Partial<Record<LegalDocumentKind, LegalAcceptanceRecord>>;
};

export async function acceptLegal(documents: LegalDocument[], surface: AcceptanceSurface = GATE_SURFACE): Promise<AcceptResult> {
  const { data } = await api.post('/legal/accept', acceptBody(documents, surface, CLIENT_HEADER_VALUE));
  const body: Record<string, unknown> = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const accepted: AcceptResult['accepted'] = {};
  for (const row of Array.isArray(body.acceptances) ? body.acceptances : []) {
    const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const document = record.document;
    if ((document === 'terms' || document === 'privacy') && typeof record.version === 'string') {
      accepted[document] = {
        version: record.version,
        acceptedAt: typeof record.acceptedAt === 'string' ? record.acceptedAt : null,
        surface: typeof record.surface === 'string' ? record.surface : null,
      };
    }
  }
  return { pending: pendingKinds(body.pending), accepted };
}

/**
 * One account's legal state, fetched once per account per page load and
 * shared by the gate and Settings. Enabled only for a signed-in account the
 * API can hear: `sessionStale` means the shell painted from the offline
 * snapshot, and asking then would fail or, worse, gate a person the server
 * cannot see. Signing into a different account changes the key and re-runs
 * the check; `logout()` sets `user` null and disables it.
 */
export function useLegalState() {
  const userId = useAuth((s) => s.user?._id ?? null);
  const sessionStale = useAuth((s) => s.sessionStale);
  const enabled = !!userId && !sessionStale;
  const query = useQuery({
    queryKey: legalQueryKey(userId),
    queryFn: getLegalState,
    enabled,
    // A version bump while a tab is open is noticed on reload or re-login;
    // an "Agree" in that window answers 409 and the stale path refetches.
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return { query, userId, enabled };
}
