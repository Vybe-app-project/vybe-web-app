import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { PublicShell } from '../components/PublicShell';
import { SHARE_LABEL, appDeepLink, isShareType, shareDestination } from '../lib/shareLinks';
import { ButtonLink, buttonClass } from './ui';

const isHandheld = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * /open.html?type=…&id=… — the landing page for links shared from the app.
 *
 * On a phone the person may have Vybe installed, so offer the deep link first
 * and the web destination second. Everywhere else go straight to the page;
 * RequireAuth keeps the destination across sign-in.
 */
export default function OpenHandoff() {
  const [params] = useSearchParams();
  const type = params.get('type');
  const id = params.get('id');
  const to = useMemo(() => shareDestination(type, id), [type, id]);
  const [handheld] = useState(isHandheld);

  if (!to || !isShareType(type) || !id) {
    return (
      <PublicShell title="That link isn't valid" subtitle="It may have been cut short when it was copied. Ask for it again, or head into Vybe.">
        <ButtonLink to="/" variant="primary" size="lg">
          Go to Vybe
        </ButtonLink>
      </PublicShell>
    );
  }

  if (!handheld) return <Navigate to={to} replace />;

  return (
    <PublicShell
      title={`Open this ${SHARE_LABEL[type]} in Vybe`}
      subtitle="If you have the app installed it opens right where you were sent. Otherwise, continue on the web."
    >
      <div className="space-y-3">
        <a href={appDeepLink(type, id)} className={buttonClass({ variant: 'primary', size: 'lg', block: true })}>
          Open in the Vybe app
        </a>
        <ButtonLink to={to} variant="secondary" size="lg" block>
          Continue on the web
        </ButtonLink>
      </div>
    </PublicShell>
  );
}
