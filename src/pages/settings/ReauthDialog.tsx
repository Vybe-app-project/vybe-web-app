import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import {
  reauthErrorCopy,
  type ReauthMethods,
  type ReauthPurpose,
  type ReauthResult,
} from '../../lib/accountLifecycle';
import { reauthenticate } from '../../lib/lifecycleApi';
import { Button, Callout, Input, Modal } from '../ui';
import { PasswordField } from '../Login';

const PURPOSE_COPY: Record<ReauthPurpose, string> = {
  delete: 'Confirm it is you before anything is deleted.',
  export: 'Confirm it is you before we prepare a copy of your data.',
  download: 'Confirm it is you before we prepare the download.',
};

const RESEND_COOLDOWN_SECONDS = 60;
const FORM_ID = 'reauth-form';

/**
 * "Confirm it is you": mints a short-lived re-auth token (POST /auth/reauth)
 * with the password or, for a passwordless account, a 6-digit email code.
 * `onToken` may run the guarded action and throw to keep the dialog open with
 * the error under the field (a stale token answers 401 REAUTH_REQUIRED).
 * Every control is a native button or input, so the dialog is fully keyboard
 * reachable; the Modal traps focus and Escape cancels.
 */
export function ReauthDialog({
  open,
  methods,
  email,
  purpose,
  onToken,
  onCancel,
}: {
  open: boolean;
  methods: ReauthMethods;
  email?: string;
  purpose: ReauthPurpose;
  onToken: (result: ReauthResult) => Promise<void> | void;
  onCancel: () => void;
}) {
  const mode: 'password' | 'code' | 'none' = methods.password ? 'password' : methods.emailCode ? 'code' : 'none';
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // A closed dialog forgets everything typed into it.
  useEffect(() => {
    if (open) return;
    setPassword('');
    setCode('');
    setError(null);
    setSubmitting(false);
    setSending(false);
    setCodeSent(false);
    setCooldown(0);
  }, [open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    if (!email) {
      setError('We do not have an email address for this account.');
      return;
    }
    setError(null);
    setSending(true);
    try {
      await api.post('/auth/sendEmailOtp', { email });
      setCodeSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e) {
      setError(reauthErrorCopy(e, 'Could not send the code. Try again in a moment.'));
    } finally {
      setSending(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting || mode === 'none') return;
    if (mode === 'password' && !password) {
      setError('Enter your password.');
      inputRef.current?.focus();
      return;
    }
    if (mode === 'code' && !/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email.');
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await reauthenticate(mode === 'password' ? { password } : { code });
      await onToken(result);
    } catch (err) {
      setError(reauthErrorCopy(err));
      if (mode === 'code') setCode('');
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setSubmitting(false);
    }
  }

  const description =
    mode === 'password'
      ? 'Enter your password to continue.'
      : mode === 'code'
        ? codeSent
          ? `We sent a 6-digit code to ${email}. Enter it to continue.`
          : `We will email a 6-digit code to ${email ?? 'your address'}.`
        : undefined;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Confirm it is you"
      description={description}
      size="sm"
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          {mode !== 'none' ? (
            <Button variant="primary" type="submit" form={FORM_ID} loading={submitting} disabled={mode === 'code' && !codeSent}>
              Continue
            </Button>
          ) : null}
        </>
      }
    >
      <p className="mb-4 text-sm text-text-2">{PURPOSE_COPY[purpose]}</p>
      {mode === 'none' ? (
        <Callout
          tone="warning"
          action={
            <Link to="/settings#password" onClick={onCancel} className="inline-flex min-h-11 items-center rounded-sm px-2 text-sm font-semibold text-text-1 underline-offset-2 hover:underline">
              Set a password
            </Link>
          }
        >
          This account has no password and email codes are not available. Set a password first.
        </Callout>
      ) : (
        <form id={FORM_ID} onSubmit={submit} className="space-y-3" noValidate>
          {mode === 'password' ? (
            <PasswordField
              ref={inputRef}
              id="reauth-password"
              name="password"
              label="Password"
              autoComplete="current-password"
              maxLength={128}
              value={password}
              error={error}
              disabled={submitting}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" loading={sending} disabled={cooldown > 0 || submitting} onClick={() => void sendCode()}>
                  {codeSent ? 'Send a new code' : 'Send code'}
                </Button>
                {cooldown > 0 ? (
                  <span className="text-xs text-text-3" aria-live="polite">
                    You can ask for another code in {cooldown} s.
                  </span>
                ) : null}
              </div>
              <Input
                ref={inputRef}
                id="reauth-code"
                name="code"
                label="6-digit code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                error={error}
                disabled={submitting || !codeSent}
                hint={codeSent ? 'The code works once and expires after 5 minutes.' : 'Send the code first.'}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  if (error) setError(null);
                }}
              />
            </>
          )}
        </form>
      )}
    </Modal>
  );
}
