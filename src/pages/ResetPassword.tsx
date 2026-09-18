import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { passwordRules, isPasswordValid } from '../lib/hooks';
import { Button, Callout, EmptyState } from './ui';
import { ArrowLeft, Lock } from './icons';
import { AuthShell, PasswordField } from './Login';
import { PasswordRules } from './Register';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = (params.get('token') || '').trim();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rules = passwordRules(password);
  const tokenLooksValid = /^[a-fA-F0-9]{64}$/.test(token);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isPasswordValid(password)) return setError('Your password does not meet all requirements yet.');
    if (password !== confirm) return setError('Passwords do not match.');

    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login?reset=1', { replace: true });
    } catch (e2) {
      setError(errMsg(e2, 'This reset link is invalid or has expired.'));
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

  if (!tokenLooksValid) {
    return (
      <AuthShell
        title="This link is not valid"
        headline="Let’s try that again."
        tagline="Reset links are single-use and expire quickly, which is how it should be."
        footer={backLink}
      >
        <EmptyState
          variant="error"
          icon={<Lock size={26} />}
          title="Reset link is missing or malformed"
          message="Request a new link and open it from the same device within a few minutes."
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
