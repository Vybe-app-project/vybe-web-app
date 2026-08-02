import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { isEmail } from '../lib/hooks';
import { Button, Input, Card } from './ui';

export default function Login() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const notice =
    params.get('reset') === '1'
      ? 'Password updated. Sign in with your new password.'
      : params.get('registered') === '1'
        ? 'Account created. Welcome to Vybe!'
        : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = email.trim();
    if (!isEmail(trimmed)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');

    setSubmitting(true);
    try {
      await login(trimmed, password);
      navigate(next, { replace: true });
    } catch (e2) {
      setError(errMsg(e2, 'Could not sign in. Check your details and try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl font-black tracking-tight bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-brand-2)] bg-clip-text text-transparent">
            Vybe
          </div>
          <p className="text-sm text-[var(--color-muted)] mt-2">
            Train together. Share the grind.
          </p>
        </div>

        <Card className="p-6">
          <h1 className="text-lg font-bold mb-1">Welcome back</h1>
          <p className="text-sm text-[var(--color-muted)] mb-5">
            Sign in to continue to your feed.
          </p>

          {notice && (
            <div
              role="status"
              className="mb-4 rounded-xl border border-[var(--color-brand)]/40 bg-[var(--color-brand)]/10 px-3 py-2 text-sm"
            >
              {notice}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-email" className="block text-xs font-semibold mb-1.5">
                Email
              </label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="block text-xs font-semibold">
                  Password
                </label>
                <button
                  type="button"
                  className="text-xs text-[var(--color-muted)] hover:text-white"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <Input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={submitting}
              disabled={submitting}
            >
              Sign in
            </Button>
          </form>

          <div className="mt-5 flex items-center justify-between text-sm">
            <Link to="/forgot-password" className="text-[var(--color-muted)] hover:text-white">
              Forgot password?
            </Link>
            <Link to="/register" className="font-semibold text-[var(--color-brand-2)]">
              Create account
            </Link>
          </div>
        </Card>

        <p className="mt-6 text-center text-xs text-[var(--color-muted)]">
          By continuing you agree to the Vybe Terms and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
