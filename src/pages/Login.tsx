import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { api, signOutReason } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOAuthProviders } from '../lib/capabilities';
import {
  loginFailure,
  loginNoticeFor,
  postLoginTarget,
  type FromLocation,
  type LoginFailure,
  type LoginNotice,
} from '../lib/authRedirect';
import { clearDraftEmail, readDraftEmail, writeDraftEmail } from '../lib/authDrafts';
import {
  OAUTH_LABELS,
  lastProviderAnswer,
  oauthApiErrorCopy,
  oauthSignInRequest,
  rememberOAuth,
  rememberProviderAnswer,
  readOAuthReturn,
  startOAuth,
  usableClientId,
  type OAuthProvider,
} from '../lib/oauth';
import { signupLocale } from '../lib/signupLocale';
import { isEmail } from '../lib/hooks';
import { Brand, BrandMark, Button, Callout, Checkbox, IconButton, Input, Skeleton, Spinner, cx, useDocumentTitle } from './ui';
import { Dumbbell, Eye, EyeOff, Users, Zap } from './icons';
import { PendingDeletionInterstitial, SignInLifecycleNotice } from './settings/SignInLifecycleNotice';

/* ------------------------------------------------------------------ *
 * Shared auth chrome.
 *
 * Login, Register, ForgotPassword and ResetPassword are the one "Persuade"
 * surface in the product: the two-figure V at scale on navy, one line, and
 * the form. The hero panel is wrapped in `.dark` so it reads as navy in
 * both themes while still consuming only the semantic tokens.
 * ------------------------------------------------------------------ */

export function AuthShell({
  title,
  documentTitle,
  subtitle,
  children,
  footer,
  headline = 'Train together.',
  tagline = 'Log the work, share the wins and keep each other honest.',
}: {
  title: string;
  /** Tab / history title when it should differ from the on-page heading. */
  documentTitle?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  headline?: string;
  tagline?: string;
}) {
  // The app shell titles every in-app page ("Home · Vybe"); the signed-out
  // pages sit outside it and used to leave the tab reading just "Vybe".
  useDocumentTitle(documentTitle ?? title);

  return (
    <div className="min-h-dvh bg-bg text-text-1 lg:grid lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
      <aside className="auth-hero dark safe-top relative flex flex-col overflow-hidden bg-bg text-text-1 lg:min-h-dvh lg:justify-between lg:px-14 lg:py-12">
        <span className="auth-hero-geo auth-hero-geo-1" aria-hidden="true" />
        <span className="auth-hero-geo auth-hero-geo-2" aria-hidden="true" />
        {/* Mobile band: mark + wordmark + the line */}
        <div className="relative flex flex-col items-center px-6 pb-8 pt-10 text-center lg:hidden">
          <BrandMark size={56} title="Vybe" className="text-mark" />
          <p className="type-display mt-4 text-xl text-text-1">{headline}</p>
        </div>

        {/* Desktop hero */}
        <Link to="/login" className="relative hidden w-fit rounded-sm lg:inline-flex" aria-label="Vybe">
          <Brand size="md" tone="brand" />
        </Link>
        <div className="relative hidden lg:block">
          <h2 className="type-display text-display text-text-1">{headline}</h2>
          <p className="mt-5 max-w-md text-md text-text-2">{tagline}</p>
          <ul className="mt-10 grid max-w-md gap-3" aria-label="What Vybe does">
            {AUTH_POINTS.map((p) => (
              <li key={p.title} className="flex items-start gap-3 rounded-md border border-line bg-surface-1/60 p-3.5 backdrop-blur-sm">
                <span className="mt-0.5 inline-grid size-8 shrink-0 place-items-center rounded-sm bg-brand-soft text-brand-text">
                  <p.Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-1">{p.title}</span>
                  <span className="block text-xs leading-relaxed text-text-2">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative hidden text-xs text-text-3 lg:block">Vybe is social fitness. Free to join.</p>
      </aside>

      <main className="flex flex-1 flex-col lg:min-h-dvh lg:justify-center lg:bg-surface-1">
        <div className="mx-auto w-full max-w-[26rem] px-4 pb-12 pt-8 sm:px-6 lg:px-8 lg:py-16">
          <h1 className="t-title text-text-1">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-sm text-text-2">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
          {footer ? <div className="mt-6">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}

const AUTH_POINTS = [
  { Icon: Dumbbell, title: 'Log the work', body: 'Sessions, meals, water and weight in one place.' },
  { Icon: Users, title: 'Find your gym', body: 'See who trains where you do and keep each other honest.' },
  { Icon: Zap, title: 'Share the wins', body: 'Post a PR, join a challenge, earn the badge.' },
] as const;

/**
 * Move focus to the first field in error so keyboard and screen-reader users
 * hear it at once. Deferred by frames so the error text (aria-describedby)
 * is in the DOM when focus lands, and retried for a few frames because after
 * a failed request the field is still `disabled` until the submitting state
 * commits -- a disabled input silently refuses focus.
 */
export function focusField(id: string, attempts = 6) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id) as HTMLElement | null;
    if (el && !(el as HTMLInputElement).disabled) {
      el.focus();
      if (document.activeElement === el) return;
    }
    if (attempts > 1) focusField(id, attempts - 1);
  });
}

/** Password input with a 40 px show/hide control that keeps the field's label. */
export function PasswordField({
  visible,
  onVisibleChange,
  className,
  ...rest
}: Omit<Parameters<typeof Input>[0], 'type' | 'trailing'> & {
  visible?: boolean;
  onVisibleChange?: (next: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const shown = visible ?? own;
  const toggle = () => (onVisibleChange ? onVisibleChange(!shown) : setOwn((v) => !v));
  return (
    <Input
      type={shown ? 'text' : 'password'}
      spellCheck={false}
      className={cx('pr-12', className)}
      trailing={
        <IconButton
          size={40}
          label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          onClick={toggle}
          className="text-text-2"
        >
          {shown ? <EyeOff size={20} /> : <Eye size={20} />}
        </IconButton>
      }
      {...rest}
    />
  );
}

/**
 * Links to the legal pages shipped in `public/`. They open in a new tab so a
 * half-finished sign-up or sign-in is not thrown away, and each is a 44 px
 * target (the inline text alone measured 14 px tall on a phone).
 */
const LEGAL_LINK = 'inline-flex min-h-11 items-center -my-3 rounded-sm px-1 -mx-1 font-semibold text-text-2 underline-offset-2 hover:underline whitespace-nowrap';

export function LegalLine({ className }: { className?: string }) {
  return (
    <p className={cx('text-balance text-center text-xs leading-relaxed text-text-3', className)}>
      By continuing you agree to the Vybe{' '}
      <a href="/terms-and-conditions.html" target="_blank" rel="noopener noreferrer" className={LEGAL_LINK}>
        Terms<span className="sr-only"> (opens in a new tab)</span>
      </a>{' '}
      and{' '}
      <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className={LEGAL_LINK}>
        Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
      </a>
      .
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * One-tap sign-in.
 *
 * Read property by property so Vite can inline each one (lib/api does the
 * same with the build identity). The ids are the owner's to configure: the
 * Google **web** client id and the Apple **Services** id. A server that has
 * provider credentials but a bundle that has no client id cannot start a
 * flow, so both halves are required before a button is drawn.
 * ------------------------------------------------------------------ */
const OAUTH_ENV = {
  VITE_GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined,
  VITE_APPLE_SERVICES_ID: import.meta.env.VITE_APPLE_SERVICES_ID as string | undefined,
};

/** Apple's mark is black or white only, so it takes the button's own colour. */
function AppleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M16.36 12.66c.02 2.5 2.19 3.33 2.21 3.34-.02.06-.35 1.2-1.15 2.37-.69 1.02-1.41 2.03-2.55 2.05-1.11.02-1.47-.66-2.75-.66-1.27 0-1.67.64-2.73.68-1.09.04-1.92-1.1-2.62-2.11-1.43-2.07-2.52-5.85-1.05-8.4.73-1.27 2.03-2.07 3.45-2.09 1.07-.02 2.08.72 2.74.72.65 0 1.88-.89 3.17-.76.54.02 2.06.22 3.03 1.64-.08.05-1.81 1.06-1.79 3.16M14.3 5.6c.58-.71.98-1.7.87-2.68-.84.03-1.86.56-2.46 1.27-.54.62-1.01 1.62-.88 2.58.94.07 1.89-.47 2.47-1.17" />
    </svg>
  );
}

/**
 * Google's G in its brand colours. The one place raw hex is right: the mark
 * is a third-party asset whose colours are fixed by Google's guidelines, and
 * a token would be wrong in both themes.
 */
function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5-4.3 6.6v5.5h7c4.1-3.8 6.6-9.4 6.6-16.3" />
      <path fill="#34A853" d="M24 46c5.8 0 10.7-1.9 14.3-5.2l-7-5.5c-1.9 1.3-4.4 2.1-7.3 2.1-5.6 0-10.4-3.8-12.1-8.9H4.7v5.7C8.3 41.4 15.6 46 24 46" />
      <path fill="#FBBC05" d="M11.9 28.5c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1v-5.7H4.7C3.2 17.5 2.4 20.6 2.4 24s.8 6.5 2.3 9.3z" />
      <path fill="#EA4335" d="M24 10.6c3.2 0 6 1.1 8.2 3.2l6.2-6.2C34.7 4.2 29.8 2 24 2 15.6 2 8.3 6.6 4.7 14.6l7.2 5.7c1.7-5.1 6.5-8.9 12.1-8.9" />
    </svg>
  );
}

const PROVIDER_MARKS: Record<OAuthProvider, (props: { size?: number }) => ReactNode> = {
  google: GoogleMark,
  apple: AppleMark,
};

const DIVIDER_CLASS = 'flex items-center gap-3 text-2xs uppercase tracking-wide text-text-3';

/** Apple leads on Apple hardware, which is where people expect it first. */
function providerOrder(): OAuthProvider[] {
  const platform = typeof navigator === 'undefined' ? '' : `${navigator.platform || ''} ${navigator.userAgent || ''}`;
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? ['apple', 'google'] : ['google', 'apple'];
}

/**
 * The provider buttons above the email form. Nothing is drawn until the
 * server reports the provider is configured (`capabilities.googleOAuth` /
 * `appleOAuth`, both false today) and this build carries the matching client
 * id — so the signed-out page on the live host is exactly what it is now.
 *
 * Neither button is the screen's filled blue: the email submit is, and there
 * is only ever one. Starting a flow is a top-level navigation to the
 * provider, so nothing here needs a CSP host.
 */
export function ProviderSignIn({
  returnTo,
  disabled,
  onError,
}: {
  returnTo: string;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const { google, apple, isLoading } = useOAuthProviders();
  // What this browser saw last time, read once: it decides whether the space
  // is worth holding while the capability query is still out.
  const [seenBefore] = useState(() => lastProviderAnswer(localStorage));
  const ids: Record<OAuthProvider, string | null> = {
    google: usableClientId(OAUTH_ENV.VITE_GOOGLE_CLIENT_ID),
    apple: usableClientId(OAUTH_ENV.VITE_APPLE_SERVICES_ID),
  };
  const enabled: Record<OAuthProvider, boolean> = { google, apple };
  // What this build could offer, and what the server says it may.
  const configured = providerOrder().filter((p) => ids[p]);
  const providers = configured.filter((p) => enabled[p]);
  const anyProvider = providers.length > 0;

  // Remember the answer for the first frame of the next cold load.
  useEffect(() => {
    if (!isLoading) rememberProviderAnswer(localStorage, anyProvider);
  }, [isLoading, anyProvider]);

  if (providers.length === 0) {
    // A build with no client ids reserves nothing and can never shift: that
    // is the deployed case today. A build that carries one holds the exact
    // geometry of its buttons while the capability query is still out, so
    // the email form does not jump down when the answer lands (this cost
    // CLS 0.11 on a phone before the block was reserved) -- unless this
    // browser has already been told the providers are off, in which case
    // reserving would be the shift.
    if (!isLoading || configured.length === 0 || seenBefore === false) return null;
    return (
      <div className="mb-5 space-y-3" aria-hidden="true">
        <div className="grid gap-2">
          {configured.map((p) => (
            <Skeleton key={p} className="h-[52px] w-full rounded-sm" />
          ))}
        </div>
        <p className={DIVIDER_CLASS}>
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
          or
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </p>
      </div>
    );
  }

  const begin = (provider: OAuthProvider) => {
    const started = startOAuth({ provider, clientId: ids[provider], origin: window.location.origin, returnTo });
    if (!started) {
      onError(`${OAUTH_LABELS[provider]} is not configured for this site yet.`);
      return;
    }
    rememberOAuth(sessionStorage, started.pending);
    window.location.assign(started.url);
  };

  return (
    <div className="mb-5 space-y-3">
      <div className="grid gap-2">
        {providers.map((provider) => {
          const Mark = PROVIDER_MARKS[provider];
          return (
            <Button
              key={provider}
              type="button"
              variant="secondary"
              size="lg"
              block
              disabled={disabled}
              onClick={() => begin(provider)}
              icon={<Mark size={18} />}
            >
              {OAUTH_LABELS[provider]}
            </Button>
          );
        })}
      </div>
      <p className={DIVIDER_CLASS}>
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
        or
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
      </p>
    </div>
  );
}

type LoginState = { from?: FromLocation; email?: string } | null;

export default function Login() {
  const login = useAuth((s) => s.login);
  const adoptSession = useAuth((s) => s.adoptSession);
  // An account in its deletion grace period signs in to the interstitial, not the app.
  const pendingDeletion = useAuth((s) => s.pendingDeletion);
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const state = location.state as LoginState;
  const target = postLoginTarget({ from: state?.from, next: params.get('next') });

  // A completed password reset hands the account's email over in router
  // state; otherwise the last typed email survives a reload (sessionStorage,
  // tab-scoped). The password never persists.
  const [email, setEmail] = useState(() => state?.email ?? readDraftEmail(sessionStorage));
  const [prefilled] = useState(() => email.length > 0);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<LoginFailure | null>(null);
  // Read once on mount: the 401 interceptor and "Sign out of all devices"
  // leave a note explaining why the user is looking at this page.
  const [reason] = useState(() => signOutReason.take());
  const [notice, setNotice] = useState<LoginNotice | null>(
    () => loginNoticeFor(params)
      ?? (reason === 'signed-out-all'
        ? { kind: 'signed-out-all', tone: 'success', text: 'Signed out of all devices. Sign in again on the ones you still use.' }
        : null),
  );
  const [submitting, setSubmitting] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerBusy, setProviderBusy] = useState(false);

  useEffect(() => {
    writeDraftEmail(sessionStorage, email.trim());
  }, [email]);

  /**
   * The provider redirect lands back here with `#id_token=…&state=…`. The
   * state is checked against the one this tab stored before anything is
   * posted, the fragment is wiped from history at once (it is a credential),
   * and the session is stored through the same store action the email form
   * uses. Runs once: a re-run after the fragment is gone reads null.
   */
  useEffect(() => {
    const answer = readOAuthReturn(window.location.hash, sessionStorage);
    if (!answer) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (answer.kind === 'error') {
      setProviderError(answer.message);
      return;
    }
    // The two routes are written out rather than indexed, so the contract
    // audit can see them (scripts/audit-api-contracts.cjs resolves literals).
    const { body } = oauthSignInRequest(answer.provider, answer.idToken, signupLocale());
    setProviderBusy(true);
    (answer.provider === 'google' ? api.post('/auth/google/mobile', body) : api.post('/auth/apple/mobile', body))
      .then(({ data }) => {
        if (!data?.token) throw new Error('Sign-in did not return a session.');
        adoptSession({ token: data.token, user: data.user });
        clearDraftEmail(sessionStorage);
        if (!useAuth.getState().pendingDeletion) navigate(answer.returnTo, { replace: true });
      })
      .catch((e) => setProviderError(oauthApiErrorCopy(e, answer.provider)))
      .finally(() => setProviderBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The interstitial replaces the form for a pending-deletion account. Forget
  // the typed password then, so "Sign out" from it does not hand the next
  // person at a shared computer a form with the password still in it.
  useEffect(() => {
    if (!pendingDeletion) return;
    setPassword('');
    setFieldError({});
  }, [pendingDeletion]);
  const sessionNotice =
    reason === 'session-ended'
      ? 'You were signed out. This happens after a password change, after “Sign out of all devices” on another device, or when a session expires. Sign in again to continue.'
      : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Acting on the form retires the arrival notice, so "Password updated"
    // never sits above a fresh error.
    setNotice(null);

    const trimmed = email.trim();
    const next: { email?: string; password?: string } = {};
    if (!isEmail(trimmed)) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setFieldError(next);
    if (next.email || next.password) {
      focusField(next.email ? 'login-email' : 'login-password');
      return;
    }

    setSubmitting(true);
    try {
      await login(trimmed, password, { remember });
      clearDraftEmail(sessionStorage);
      if (!useAuth.getState().pendingDeletion) navigate(target, { replace: true });
    } catch (e2) {
      const failure = loginFailure(e2, {
        online: navigator.onLine,
        fallback: 'Could not sign in. Check your details and try again.',
      });
      setError(failure);
      if (failure.offerReset) {
        setPassword('');
        focusField('login-password');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      documentTitle="Sign in"
      subtitle="Sign in to pick up where you left off."
      footer={<LegalLine />}
    >
      <SignInLifecycleNotice />
      {notice ? (
        <Callout tone={notice.tone} className="mb-5">
          {notice.text}
        </Callout>
      ) : null}
      {sessionNotice ? (
        <Callout tone="warning" title="Signed out on this device" className="mb-5">
          {sessionNotice}
        </Callout>
      ) : null}

      {pendingDeletion ? <PendingDeletionInterstitial target={target} /> : null}
      {providerError ? (
        <Callout tone="danger" className="mb-5">
          {providerError}
        </Callout>
      ) : null}
      {providerBusy ? (
        <p className="mb-5 inline-flex items-center gap-2 text-sm text-text-2" aria-live="polite">
          <Spinner size={16} /> Finishing sign-in…
        </p>
      ) : null}
      {!pendingDeletion ? <ProviderSignIn returnTo={target} disabled={submitting || providerBusy} onError={setProviderError} /> : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate hidden={!!pendingDeletion}>
        <Input
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          placeholder="you@example.com"
          value={email}
          error={fieldError.email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldError.email) setFieldError((f) => ({ ...f, email: undefined }));
          }}
          disabled={submitting}
          autoFocus={!prefilled}
        />

        <PasswordField
          id="login-password"
          label="Password"
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          error={fieldError.password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldError.password) setFieldError((f) => ({ ...f, password: undefined }));
          }}
          disabled={submitting}
          autoFocus={prefilled}
        />

        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <Checkbox
            id="login-remember"
            checked={remember}
            onChange={setRemember}
            disabled={submitting}
            label="Keep me signed in"
            description="Untick on a shared or public computer."
            className="py-1.5"
          />
          <Link
            to="/forgot-password"
            state={{ email: email.trim() }}
            className="inline-flex min-h-11 items-center rounded-sm px-1 text-sm font-semibold text-text-2 hover:text-text-1"
          >
            Forgot password?
          </Link>
        </div>

        {error ? (
          <Callout
            tone="danger"
            action={
              error.offerReset ? (
                <Link
                  to="/forgot-password"
                  state={{ email: email.trim() }}
                  className="inline-flex min-h-11 items-center rounded-sm px-2 text-sm font-semibold text-text-1 underline-offset-2 hover:underline"
                >
                  Reset password
                </Link>
              ) : undefined
            }
          >
            {error.text}
          </Callout>
        ) : null}

        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-2" hidden={!!pendingDeletion}>
        New to Vybe?{' '}
        <Link
          to="/register"
          state={location.state}
          className="inline-flex min-h-11 items-center font-semibold text-brand-text underline-offset-2 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
