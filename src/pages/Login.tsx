import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { signOutReason } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  loginFailure,
  loginNoticeFor,
  postLoginTarget,
  type FromLocation,
  type LoginFailure,
  type LoginNotice,
} from '../lib/authRedirect';
import { clearDraftEmail, readDraftEmail, writeDraftEmail } from '../lib/authDrafts';
import { isEmail } from '../lib/hooks';
import { Brand, BrandMark, Button, Callout, Checkbox, IconButton, Input, cx, useDocumentTitle } from './ui';
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
          <h1 className="type-heading text-xl text-text-1 lg:text-2xl">{title}</h1>
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

type LoginState = { from?: FromLocation; email?: string } | null;

export default function Login() {
  const login = useAuth((s) => s.login);
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

  useEffect(() => {
    writeDraftEmail(sessionStorage, email.trim());
  }, [email]);
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
