import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { isEmail, useCountdown } from '../lib/hooks';
import { Button, Callout, Input } from './ui';
import { ArrowLeft, Mail } from './icons';
import { AuthShell } from './Login';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [cooldown, startCooldown] = useCountdown();

  const trimmed = email.trim().toLowerCase();

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setFieldError(undefined);

    if (!isEmail(trimmed)) return setFieldError('Enter a valid email address.');

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

  const backLink = (
    <Link
      to="/login"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-semibold text-text-2 hover:text-text-1"
    >
      <ArrowLeft size={18} />
      Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthShell
        title="Check your inbox"
        subtitle={
          <>
            If an account exists for <span className="font-semibold text-text-1">{trimmed}</span>, a reset link is on its way.
            It expires shortly, so use it soon.
          </>
        }
        headline="Back in a minute."
        tagline="Reset links are single-use and expire quickly, which is how it should be."
        footer={backLink}
      >
        <div className="flex items-start gap-3 rounded-md bg-surface-2 p-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text">
            <Mail size={20} />
          </span>
          <div className="text-sm text-text-2">
            <p className="font-semibold text-text-1">Did not get it?</p>
            <p className="mt-0.5">Check spam, or make sure you typed the email your account uses.</p>
          </div>
        </div>

        {error ? <Callout tone="danger" className="mt-4">{error}</Callout> : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" block onClick={() => void submit()} disabled={busy || cooldown > 0} loading={busy} className="tabular">
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
          </Button>
          <Button
            variant="ghost"
            block
            onClick={() => {
              setSent(false);
              setError(null);
            }}
          >
            Use a different email
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email on your account and we will send a reset link."
      headline="Back in a minute."
      tagline="Reset links are single-use and expire quickly, which is how it should be."
      footer={backLink}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input
          id="fp-email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          placeholder="you@example.com"
          value={email}
          error={fieldError}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldError) setFieldError(undefined);
          }}
          disabled={busy}
          autoFocus
        />

        {error ? <Callout tone="danger">{error}</Callout> : null}

        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
