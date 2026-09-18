import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Brand, ButtonLink, cx, useDocumentTitle } from './ui';

/**
 * Chrome for the few pages that must work without an account. Today that is
 * Support: the iOS app and the store listings link straight to /support, and
 * App Review loads the support URL signed out. Signed-in users never see this
 * shell — App.tsx routes them into <Layout> with the same page inside.
 */
export function PublicShell({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // The share handoff (/open.html) renders this shell for signed-in people
  // too; offering them "Log in / Join Vybe" read as if the session was gone.
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);
  useDocumentTitle(title);
  return (
    <div className="min-h-dvh bg-bg text-text-1">
      <header className="safe-top border-b border-line bg-surface-1">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-4 px-4 md:px-6 lg:px-8">
          <Link to="/" className="inline-flex rounded-sm" aria-label="Vybe">
            <Brand size="md" />
          </Link>
          <nav aria-label="Account" className="flex items-center gap-2">
            {loading ? null : user ? (
              <ButtonLink to="/" variant="secondary" size="sm">
                Open Vybe
              </ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost" size="sm">
                  Log in
                </ButtonLink>
                <ButtonLink to="/register" variant="primary" size="sm">
                  Join Vybe
                </ButtonLink>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-form px-4 pb-16 pt-8 outline-none md:px-6 lg:pt-12">
        <h1 className="type-heading text-2xl text-text-1">{title}</h1>
        {subtitle ? <p className="mt-2 text-sm text-text-2 lg:text-md">{subtitle}</p> : null}
        <div className={cx('mt-8', className)}>{children}</div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-text-3 md:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} Vybe · Social fitness</p>
          <p>
            <a href="/privacy-policy.html" className="hover:underline">Privacy</a>
            {' · '}
            <a href="/terms-and-conditions.html" className="hover:underline">Terms</a>
            {' · '}
            <a href="/account-deletion.html" className="hover:underline">Account deletion</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
