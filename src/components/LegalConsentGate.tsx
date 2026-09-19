import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Callout, cx, fadeClass, useFocusTrap, useLockBody, useScrollEdges, useToast } from './ui';
import { FileText } from './icons';
import { errMsg, parseApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  LEGAL_COPY,
  formatEffectiveDate,
  isFirstAgreement,
  isLegalVersionStale,
  isMaterial,
  legalPagePath,
  legalQueryKey,
  legalTitle,
  pendingDocuments,
  readLabel,
  type LegalDocument,
  type LegalState,
} from '../lib/legalConsent';
import { acceptLegal, useLegalState } from '../lib/legalConsentApi';

/**
 * The re-consent gate (web form of mobile's LegalInterstitialHost).
 *
 * A material change to the terms or the privacy policy is a blocking dialog:
 * the title, up to three plain-language lines per document, a link to the
 * full text and one "Agree and continue". Nothing is pre-ticked and there is
 * no dismiss; the one button is the agreement. A non-material change is a
 * bottom notice with "Got it" that never blocks.
 *
 * The documents scroll inside the panel and the buttons are a pinned footer
 * (the way Modal pins its footer), so on a short phone screen "Agree and
 * continue" is never below the fold; the body fades at an edge that has more
 * content. The buttons carry no aria-label: their visible text is their
 * accessible name (WCAG 2.5.3), so "click Agree and continue" works for
 * speech input. The title distinguishes a first agreement (no acceptance row
 * of any version on this account) from a genuine version bump.
 *
 * Built like UpdateRequiredScreen rather than with Modal: Modal closes on
 * Escape for the topmost entry, the first-run WelcomeSheet is a Modal too
 * and two of them fight over one stack, and mobile draws its gate as an
 * overlay for the same reason. z-[200] keeps the 426 screen (z-[300]) on top
 * and this above the welcome sheet and every page modal (z-[100]).
 *
 * Mounted once at the root (App.tsx), so SupportGate and PostGate, which
 * render Layout outside RequireAuth, are covered as well.
 */

const OPENS_IN_NEW_TAB = <span className="sr-only">{LEGAL_COPY.opensInNewTab}</span>;

const READ_LINK = 'inline-flex min-h-11 items-center gap-1 rounded-sm font-semibold text-brand-text underline-offset-2 hover:underline';

function DocumentSummary({ document }: { document: LegalDocument }) {
  const effective = formatEffectiveDate(document.effectiveAt);
  const headingId = `legal-consent-${document.document}-title`;
  return (
    <section aria-labelledby={headingId} data-testid={`legal-consent-${document.document}`}>
      <h2 id={headingId} className="text-md font-semibold text-text-1">
        {document.title}
      </h2>
      {effective ? <p className="mt-0.5 text-xs text-text-3">{LEGAL_COPY.effective(effective)}</p> : null}
      {document.summary.length ? (
        <>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-3">{LEGAL_COPY.summaryHeading}</p>
          <ul className="mt-1.5 space-y-1.5 text-sm text-text-2">
            {document.summary.map((line) => (
              <li key={line} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <a href={legalPagePath(document)} target="_blank" rel="noopener noreferrer" className={READ_LINK}>
        {readLabel(document)}
        {OPENS_IN_NEW_TAB}
      </a>
    </section>
  );
}

export function LegalConsentDialog({
  documents,
  firstAgreement = false,
  busy = false,
  error = null,
  onAgree,
  onSignOut,
}: {
  documents: LegalDocument[];
  /** No acceptance row of any version for these documents: "Please review" rather than "have changed". */
  firstAgreement?: boolean;
  busy?: boolean;
  /** Inline above the buttons after a failed accept; the dialog stays. */
  error?: string | null;
  onAgree: () => void;
  onSignOut: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useLockBody(true);
  // Initial focus lands on the dialog itself so the title and the documents
  // are announced before the first link; Tab then walks the links to the
  // button and wraps. Escape does nothing: there is no close.
  useFocusTrap(true, ref, ref);
  const edges = useScrollEdges(bodyRef, 'y');
  const title = legalTitle(documents, firstAgreement);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-consent-title"
      aria-describedby="legal-consent-body"
      tabIndex={-1}
      data-testid="legal-consent-dialog"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-scrim p-4 outline-none"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-lg border border-line bg-surface-1 text-text-1 shadow-3">
        <div className="shrink-0 px-6 pt-6">
          <FileText size={32} className="text-brand-text" aria-hidden="true" />
          <h1 id="legal-consent-title" className="type-heading mt-3 text-xl">
            {title}
          </h1>
        </div>
        <div
          ref={bodyRef}
          id="legal-consent-body"
          data-testid="legal-consent-body"
          className={cx('min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 pb-2 pt-5', fadeClass(edges, 'y'))}
        >
          {documents.map((document) => (
            <DocumentSummary key={document.document} document={document} />
          ))}
        </div>
        <div className={cx('shrink-0 px-6 pb-6 pt-4', edges.overflow && 'border-t border-line')} data-testid="legal-consent-footer">
          {error ? (
            <p role="alert" className="mb-3 text-sm text-danger" data-testid="legal-consent-error">
              {error}
            </p>
          ) : null}
          <div className="space-y-2">
            <Button type="button" variant="primary" size="lg" block loading={busy} onClick={onAgree} data-testid="legal-consent-agree">
              {busy ? LEGAL_COPY.agreeing : LEGAL_COPY.agree}
            </Button>
            <span role="status" className="sr-only">
              {busy ? LEGAL_COPY.agreeing : ''}
            </span>
            <Button type="button" variant="ghost" block disabled={busy} onClick={onSignOut} data-testid="legal-consent-sign-out">
              {LEGAL_COPY.signOut}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Non-material change: a bottom notice that lets everything else through. */
export function LegalConsentNotice({
  documents,
  busy = false,
  onDismiss,
}: {
  documents: LegalDocument[];
  busy?: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] p-4 pb-nav lg:pb-4" data-testid="legal-consent-notice">
      <div className="pointer-events-auto mx-auto w-full max-w-lg shadow-2">
        <Callout
          tone="info"
          title={LEGAL_COPY.noticeTitle}
          action={
            <Button variant="secondary" size="sm" disabled={busy} onClick={onDismiss} data-testid="legal-consent-dismiss">
              {LEGAL_COPY.gotIt}
            </Button>
          }
        >
          <p>{LEGAL_COPY.noticeBody}</p>
          <ul className="mt-1 flex flex-wrap gap-x-4">
            {documents.map((document) => (
              <li key={document.document}>
                <a href={legalPagePath(document)} target="_blank" rel="noopener noreferrer" className={READ_LINK}>
                  {readLabel(document)}
                  {OPENS_IN_NEW_TAB}
                </a>
              </li>
            ))}
          </ul>
        </Callout>
      </div>
    </div>
  );
}

/**
 * Root mount. Asks GET /legal/acceptances once per signed-in account per page
 * load (useLegalState), draws the dialog or the notice while something is
 * pending, and nothing while loading, on an error (fail open, as mobile does:
 * a gate that cannot be cleared offline traps the person) or when nothing is
 * pending. A reload asks the server again, so an agreement that was not
 * recorded comes back once and a recorded one never does.
 */
export function LegalConsentGate() {
  const { query, userId, enabled } = useLegalState();
  const qc = useQueryClient();
  const toast = useToast();
  const logout = useAuth((s) => s.logout);
  const [error, setError] = useState<string | null>(null);

  const key = legalQueryKey(userId);

  // The sign-in edge. The query is keyed by account with staleTime Infinity,
  // so a session that ends and restarts in place for the same account (no
  // page load in between) would otherwise reuse the answer from before and
  // miss a version bump in the gap; mobile re-checks after each sign-in.
  // Only an entry that already holds data is invalidated: on a page load the
  // first enable finds none and the ordinary fetch runs once.
  useEffect(() => {
    if (!enabled) return;
    const entry = legalQueryKey(userId);
    if (qc.getQueryState(entry)?.dataUpdatedAt) void qc.invalidateQueries({ queryKey: entry });
  }, [enabled, userId, qc]);
  const accept = useMutation({
    mutationFn: (documents: LegalDocument[]) => acceptLegal(documents),
    onMutate: () => setError(null),
    onSuccess: ({ pending, accepted }) => {
      qc.setQueryData<LegalState | null>(key, (old) => (old ? { ...old, pending, accepted: { ...old.accepted, ...accepted } } : old));
      if (pending.length === 0) toast.success(LEGAL_COPY.accepted);
      // A new version landed between the read and the write: fetch the
      // latest so the dialog redraws with it (the server's `pending` is authoritative).
      else void qc.invalidateQueries({ queryKey: key });
    },
    onError: (cause) => {
      if (isLegalVersionStale(parseApiError(cause))) {
        setError(LEGAL_COPY.stale);
        void qc.invalidateQueries({ queryKey: key });
        return;
      }
      // Network or timeout included: the person just loaded the acceptances,
      // so the connection is flaky rather than absent, and the dialog stays.
      setError(errMsg(cause, LEGAL_COPY.acceptFailed));
    },
  });

  const documents = pendingDocuments(query.data);
  if (!enabled || documents.length === 0) return null;

  if (isMaterial(documents)) {
    return (
      <LegalConsentDialog
        documents={documents}
        firstAgreement={isFirstAgreement(documents, query.data?.accepted)}
        busy={accept.isPending}
        error={error}
        onAgree={() => accept.mutate(documents)}
        onSignOut={() => logout()}
      />
    );
  }

  // A notice is acknowledged by reading it: hide it for this session at once
  // and record the acknowledgement best effort. A failed write brings it
  // back on the next page load, which is fine for a non-material change.
  const dismiss = () => {
    qc.setQueryData<LegalState | null>(key, (old) => (old ? { ...old, pending: [] } : old));
    acceptLegal(documents)
      .then(({ accepted }) => {
        qc.setQueryData<LegalState | null>(key, (old) => (old ? { ...old, accepted: { ...old.accepted, ...accepted } } : old));
      })
      .catch(() => undefined);
  };
  return <LegalConsentNotice documents={documents} busy={accept.isPending} onDismiss={dismiss} />;
}
