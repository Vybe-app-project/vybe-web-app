import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { isEmail, useCountdown } from '../lib/hooks';
import { Button, Input, Card } from './ui';
import { Check } from './icons';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCountdown();

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setError(null);

    const trimmed = email.trim().toLowerCase();
    if (!isEmail(trimmed)) return setError('Enter a valid email address.');

    setBusy(true);
    try {
      await api.post('/auth/request-reset', { email: trimmed });
      setSent(true);
      startCooldown(60);
    } catch (e2) {
      setError(errMsg(e2, 'Could not send the reset email. Try again shortly.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl font-black tracking-tight bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-brand-2)] bg-clip-text text-transparent">
            Vybe
          </div>
        </div>

        <Card className="p-6">
          <h1 className="text-lg font-bold mb-1">Reset your password</h1>
          <p className="text-sm text-[var(--color-muted)] mb-5">
            Enter the email on your account and we&apos;ll send a reset link.
          </p>

          {sent ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3">
                <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold">Check your inbox</p>
                  <p className="text-[var(--color-muted)] mt-1">
                    If an account exists for {email.trim().toLowerCase()}, a reset link is on
                    its way. The link expires shortly, so use it soon.
                  </p>
                </div>
              </div>

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => submit()}
                disabled={busy || cooldown > 0}
                loading={busy}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
              </Button>

              {error && (
                <p role="alert" className="text-sm text-red-400">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="fp-email" className="block text-xs font-semibold mb-1.5">
                  Email
                </label>
                <Input
                  id="fp-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-red-400">
                  {error}
                </p>
              )}

              <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={busy}>
                Send reset link
              </Button>
            </form>
          )}

          <div className="mt-5 text-center text-sm">
            <Link to="/login" className="text-[var(--color-muted)] hover:text-white">
              Back to sign in
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
