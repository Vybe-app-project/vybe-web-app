import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { isEmail } from '../lib/hooks';
import { Brand, BrandMark, Button, Callout, IconButton, Input, cx, useDocumentTitle } from './ui';
import { Eye, EyeOff } from './icons';

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
  subtitle,
  children,
  footer,
  headline = 'Train together.',
  tagline = 'Log the work, share the wins and keep each other honest.',
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  headline?: string;
  tagline?: string;
}) {
  useDocumentTitle(title);
  return (
    <div className="min-h-dvh bg-bg text-text-1 lg:grid lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
      <aside className="dark safe-top relative flex flex-col bg-bg text-text-1 lg:min-h-dvh lg:justify-between lg:px-14 lg:py-12">
        {/* Mobile band: mark + wordmark + the line */}
        <div className="flex flex-col items-center px-6 pb-8 pt-10 text-center lg:hidden">
          <BrandMark size={56} title="Vybe" className="text-brand" />
          <p className="type-display mt-4 text-xl text-text-1">{headline}</p>
        </div>

        {/* Desktop hero */}
        <Link to="/login" className="hidden w-fit rounded-sm lg:inline-flex" aria-label="Vybe">
          <Brand size="md" tone="brand" />
        </Link>
        <div className="hidden lg:block">
          <BrandMark size={200} className="text-brand" />
          <h2 className="type-display mt-10 text-display text-text-1">{headline}</h2>
          <p className="mt-5 max-w-md text-md text-text-2">{tagline}</p>
        </div>
        <p className="hidden text-xs text-text-3 lg:block">Vybe is social fitness. Free to join.</p>
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

/** Links to the legal pages shipped in `public/`. */
export function LegalLine({ className }: { className?: string }) {
  return (
    <p className={cx('text-center text-xs leading-relaxed text-text-3', className)}>
      By continuing you agree to the Vybe{' '}
      <a href="/terms-and-conditions.html" className="font-semibold text-text-2 underline-offset-2 hover:underline">
        Terms
      </a>{' '}
      and{' '}
      <a href="/privacy-policy.html" className="font-semibold text-text-2 underline-offset-2 hover:underline">
        Privacy Policy
      </a>
      .
    </p>
  );
}

/** Only same-origin absolute paths may be used as a post-login destination. */
function safePath(p?: string | null): string | null {
  if (!p || !p.startsWith('/') || p.startsWith('//') || p.startsWith('/login')) return null;
  return p;
}

type FromState = { from?: { pathname?: string; search?: string } } | null;

export default function Login() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const from = (location.state as FromState)?.from;
  const target =
    safePath(from?.pathname ? `${from.pathname}${from.search ?? ''}` : null) ??
    safePath(params.get('next')) ??
    '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const notice =
    params.get('reset') === '1'
      ? 'Password updated. Sign in with your new password.'
      : params.get('registered') === '1'
        ? 'Account created. Welcome to Vybe.'
        : null;
  // The API interceptor sends revoked sessions here (sign-out elsewhere, password change, expiry).
  const expired = params.get('reason') === 'expired';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = email.trim();
    const next: { email?: string; password?: string } = {};
    if (!isEmail(trimmed)) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setFieldError(next);
    if (next.email || next.password) return;

    setSubmitting(true);
    try {
      await login(trimmed, password);
      navigate(target, { replace: true });
    } catch (e2) {
      setError(errMsg(e2, 'Could not sign in. Check your details and try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      footer={<LegalLine />}
    >
      {notice ? (
        <Callout tone="success" className="mb-5">
          {notice}
        </Callout>
      ) : expired ? (
        <Callout tone="info" title="You were signed out" className="mb-5">
          Your session ended — that happens after a password change or a sign-out on another device. Sign in again to pick up where you left off.
        </Callout>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
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
          autoFocus
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
        />

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="inline-flex min-h-11 items-center rounded-sm px-1 text-sm font-semibold text-text-2 hover:text-text-1"
          >
            Forgot password?
          </Link>
        </div>

        {error ? <Callout tone="danger">{error}</Callout> : null}

        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-2">
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
