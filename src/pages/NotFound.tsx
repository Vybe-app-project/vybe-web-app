import { useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import { PublicShell } from '../components/PublicShell';
import { useAuth } from '../lib/auth';
import { EmptyState, FullPageSpinner, PageHeader, useDocumentTitle } from './ui';
import { ArrowLeft, Search } from './icons';

/**
 * Unknown consumer URL. The old catch-all silently redirected to Home, which
 * made a mistyped or stale link look like the app had ignored the tap.
 * Signed-in members see this inside the shell; visitors get the public frame.
 */
export default function NotFound() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  useDocumentTitle(user ? undefined : 'Page not found');
  if (loading) return <FullPageSpinner />;

  const body = (
    <EmptyState
      variant="no-results"
      icon={<Search size={26} />}
      title="We couldn’t find that page"
      message={`Nothing lives at ${pathname}. The link may be old, or the address may have a typo.`}
      action={{ label: 'Back to home', to: '/', icon: <ArrowLeft size={18} /> }}
      secondaryAction={user ? { label: 'Search Vybe', to: '/search' } : { label: 'Sign in', to: '/login' }}
    />
  );

  if (user) {
    return (
      <Layout>
        <PageHeader title="Page not found" back="/" />
        {body}
      </Layout>
    );
  }
  return (
    <PublicShell title="Page not found" subtitle="The address you followed does not match anything on Vybe.">
      {body}
    </PublicShell>
  );
}
