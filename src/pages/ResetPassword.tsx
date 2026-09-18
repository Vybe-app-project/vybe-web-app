import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { passwordRules, isPasswordValid } from '../lib/hooks';
import { classifyResetFailure, isResetToken, readResetToken, resetFailureMessage } from '../lib/passwordReset';
import { Button, Callout, EmptyState } from './ui';
import { ArrowLeft, Lock } from './icons';
import { AuthShell, PasswordField, focusField } from './Login';
import { PasswordRules } from './Register';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = readResetToken(params);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the API refuses the token: reused, or older than 15 minutes.
  const [linkDead, setLinkDead] = useState(false);

  const rules = passwordRules(password);
  const tokenLooksValid = isResetToken(token);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isPasswordValid(password)) {
      setError('Your password does not meet all requirements yet.');
      focusField('rp-password');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      focusField('rp-confirm');
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post('/auth/reset-password', { token, password });
      // The API names the account so sign-in only needs the new password.
      navigate('/login?reset=1', { replace: true, state: { email: typeof data?.email === 'string' ? data.email : undefined } });
    } catch (e2) {
      const failure = classifyResetFailure(e2, {
        online: navigator.onLine,
        fallback: 'This reset link is invalid or has expired.',
      });
      // A dead link is not a form error: swap to the recovery state with a
      // way forward instead of leaving the form up under a raw API message.
      if (failure.kind === 'invalid-token') {
        setLinkDead(true);
        return;
      }
      setError(resetFailureMessage(failure));
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

  if (!tokenLooksValid || linkDead) {
    return (
      <AuthShell
        title="This link is not valid"
        documentTitle="Reset your password"
        headline="Let’s try that again."
        tagline="Reset links are single-use and expire quickly, which is how it should be."
        footer={backLink}
      >
        <EmptyState
          variant="error"
          icon={<Lock size={26} />}
          title={linkDead ? 'This reset link has expired or was already used' : 'Reset link is missing or malformed'}
          message={
            linkDead
              ? 'Links work once and for 15 minutes. Request a new one and open it from the same device.'
              : 'Request a new link and open it from the same device within a few minutes.'
          }
          action={{ label: 'Request a new link', to: '/forgot-password' }}
          size="sm"
          className="rounded-lg bg-surface-2"
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      documentTitle="Reset your password"
      subtitle="Every other device will be signed out and will need the new password."
      headline="Let’s try that again."
      tagline="Reset links are single-use and expire quickly, which is how it should be."
      footer={backLink}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <PasswordField
            id="rp-password"
            label="New password"
            autoComplete="new-password"
            placeholder="Create a strong password"
            value={password}
            visible={show}
            onVisibleChange={setShow}
            onChange={(e) => setPassword(e.target.value.slice(0, 128))}
            disabled={busy}
            aria-describedby="rp-password-rules"
            autoFocus
          />
          <PasswordRules rules={rules} id="rp-password-rules" />
        </div>

        <PasswordField
          id="rp-confirm"
          label="Confirm new password"
          autoComplete="new-password"
          placeholder="Repeat your password"
          value={confirm}
          visible={show}
          onVisibleChange={setShow}
          error={mismatch ? 'Passwords do not match.' : undefined}
          onChange={(e) => setConfirm(e.target.value.slice(0, 128))}
          disabled={busy}
        />

        {error ? <Callout tone="danger">{error}</Callout> : null}

        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
