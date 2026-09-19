import { ErrorState, Skeleton, buttonClass } from '../ui';
import { FileText, Shield } from '../icons';
import { SettingsCard } from '../SettingsPieces';
import {
  LEGAL_COPY,
  LEGAL_DOCUMENT_KINDS,
  acceptanceLine,
  formatEffectiveDate,
  legalPagePath,
  type LegalDocumentKind,
  type LegalState,
} from '../../lib/legalConsent';
import { useLegalState } from '../../lib/legalConsentApi';

/**
 * Settings > Terms and privacy policy: the version of each document in force,
 * its effective date, when this account agreed to it, and a link to the text.
 * Read-only on purpose. The API lets a person withdraw only the three
 * optional consents (health-data, analytics, marketing-push), which the web
 * never grants and nothing reads, and refuses to withdraw the terms or the
 * privacy policy (400 "Only consents can be withdrawn"); the honest way out
 * of those is "Delete account" further down the page.
 */

const ICON: Record<LegalDocumentKind, typeof FileText> = { terms: FileText, privacy: Shield };

export const LEGAL_CARD_TITLE = 'Terms and privacy policy';
export const LEGAL_CARD_DESCRIPTION = 'The versions in force now and when you agreed to them.';
export const LEGAL_CARD_OFFLINE = 'Your agreements cannot be checked while Vybe is offline.';

export function LegalCard({
  state,
  loading = false,
  error = null,
  offline = false,
  onRetry,
}: {
  state: LegalState | null | undefined;
  loading?: boolean;
  error?: unknown;
  /** The session is running from the offline snapshot; there is no server to ask. */
  offline?: boolean;
  onRetry?: () => void;
}) {
  return (
    <SettingsCard id="legal" title={LEGAL_CARD_TITLE} description={LEGAL_CARD_DESCRIPTION}>
      {offline ? (
        <p className="rounded-sm bg-surface-2 px-3 py-3 text-sm text-text-2">{LEGAL_CARD_OFFLINE}</p>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading your agreements">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : error || !state ? (
        <ErrorState title="Could not load your agreements" error={error} retry={onRetry} />
      ) : (
        <ul className="divide-y divide-line" aria-label="Legal documents">
          {LEGAL_DOCUMENT_KINDS.map((kind) => {
            const document = state.current[kind];
            const Icon = ICON[kind];
            const effective = formatEffectiveDate(document.effectiveAt);
            return (
              <li key={kind} className="flex min-h-14 items-start gap-3 py-3" data-testid={`legal-${kind}`}>
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-text-2">
                  <Icon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text-1">{document.title}</span>
                  <span className="block text-xs text-text-2">
                    Version {document.version}
                    {effective ? `, effective ${effective}.` : '.'}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-2">{acceptanceLine(state.accepted[kind], document)}</span>
                </span>
                <a
                  href={legalPagePath(document)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass({ variant: 'secondary', size: 'sm', className: 'shrink-0' })}
                >
                  Read
                  <span className="sr-only">
                    {' '}
                    the {document.title}
                    {LEGAL_COPY.opensInNewTab}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}

/** The Settings mount: same cache entry as the gate, so the card is free once the gate has asked. */
export function LegalSection() {
  const { query, enabled } = useLegalState();
  return (
    <LegalCard
      state={query.data}
      loading={query.isLoading}
      error={query.error}
      offline={!enabled}
      onRetry={() => void query.refetch()}
    />
  );
}
