import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { isPasswordValid, passwordRules } from '../../lib/hooks';
import {
  classifyResetFailure,
  isResetToken,
  readResetToken,
  resetFailureMessage,
} from '../../lib/passwordReset';
import { Button, ButtonLink, Callout, EmptyState, useOnline } from '../../components/ui';
import { CheckCircle, Lock } from '../../components/icons';
import { PasswordField } from '../Login';
import { PasswordRules } from '../Register';
import { AdminAuthShell, BackToSignIn } from './AdminLogin';

type Phase = 'form' | 'done' | 'expired';

const REQUEST_NEW_LINK = { label: 'Request a new link', to: '/admin/forgot-password' };

/**
 * Landing page for the link in the staff reset email:
 * ADMIN_RESET_URL?token=<64 hex>. POST /admins/reset-password accepts the
 * token once, within 15 minutes of issue, and bumps the account's
 * tokenVersion so every existing session is revoked; the success state says
 * so and hands the administrator back to sign-in.
 *
 * Public route: it is reached from an email, so it must not require, probe
 * for, or be redirected by an existing console session.
 */
export default function AdminResetPassword() {
  const [params] = useSearchParams();
  const token = readResetToken(params);
  const forgetAdminSession = useAuth((s) => s.forgetAdminSession);
  const online = useOnline();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('form');

  const rules = passwordRules(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!isPasswordValid(password)) {
      setError('Your password does not meet all requirements yet.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await adminApi.post('/admins/reset-password', { token, password });
      // The API revoked every session for the account, including any token
      // this tab holds; forget it so sign-in does not start with a dead bearer.
      forgetAdminSession();
      setPassword('');
      setConfirm('');
      setPhase('done');
    } catch (e2) {
      const failure = classifyResetFailure(e2, {
        online: navigator.onLine,
        fallback: 'Could not update the password. Try again shortly.',
      });
      if (failure.kind === 'invalid-token') setPhase('expired');
      else setError(resetFailureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!isResetToken(token)) {
    return (
      <AdminAuthShell documentTitle="Reset link not valid · Vybe">
        <EmptyState
          variant="error"
          icon={<Lock size={26} />}
          title="Reset link is missing or malformed"
          message="Open the link exactly as it appears in the email, or request a new one. Links stop working 15 minutes after they are sent."
          action={REQUEST_NEW_LINK}
          size="sm"
          className="rounded-lg bg-surface-2"
        />
        <div className="mt-4 flex justify-center">
          <BackToSignIn />
        </div>
      </AdminAuthShell>
    );
  }

  if (phase === 'expired') {
    return (
      <AdminAuthShell documentTitle="Reset link expired · Vybe">
        <EmptyState
          variant="error"
          icon={<Lock size={26} />}
          title="This link has expired or was already used"
          message="Reset links work once and stop working 15 minutes after they are sent. Request a new one to continue."
          action={REQUEST_NEW_LINK}
          size="sm"
          className="rounded-lg bg-surface-2"
        />
        <div className="mt-4 flex justify-center">
          <BackToSignIn />
        </div>
      </AdminAuthShell>
    );
  }

  if (phase === 'done') {
    return (
      <AdminAuthShell documentTitle="Password updated · Vybe">
        <div role="status" className="flex flex-col items-center gap-2 rounded-lg bg-surface-2 px-4 py-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle size={26} />
          </div>
          <h2 className="type-heading text-md text-text-1">Password updated</h2>
          <p className="max-w-sm text-sm leading-relaxed text-text-2">
            Sign in with your new password. Every other session for this account has been signed out.
          </p>
        </div>
        <ButtonLink to="/admin/login" variant="primary" size="lg" block className="mt-5">
          Go to sign-in
        </ButtonLink>
      </AdminAuthShell>
    );
  }

  return (
    <AdminAuthShell documentTitle="Choose a new password · Vybe">
      <h2 className="type-heading text-lg text-text-1">Choose a new password</h2>
      <p className="mt-1.5 text-sm text-text-2">
        Every session for this account will be signed out and will need the new password.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <div>
          <PasswordField
            id="admin-reset-password"
            label="New password"
            autoComplete="new-password"
            placeholder="Create a strong password"
            value={password}
            visible={show}
            onVisibleChange={setShow}
            onChange={(e) => setPassword(e.target.value.slice(0, 128))}
            disabled={busy}
            aria-describedby="admin-reset-password-rules"
            autoFocus
          />
          <PasswordRules rules={rules} id="admin-reset-password-rules" />
        </div>

        <PasswordField
          id="admin-reset-confirm"
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

        {online ? null : <Callout tone="warning">You’re offline. Reconnect to update your password.</Callout>}
        {error ? <Callout tone="danger">{error}</Callout> : null}

        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!online}>
          Update password
        </Button>
      </form>

      <div className="mt-4 flex justify-center">
        <BackToSignIn />
      </div>
    </AdminAuthShell>
  );
}
