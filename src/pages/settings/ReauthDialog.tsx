import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
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
const noop = () => undefined;

/**
 * Copy for an account that can offer no proof: no password, and the server
 * cannot send email right now (email codes and the set-a-password email use
 * the same delivery, so there is no form to point at). Says what still works.
 */
function noMethodCopy(purpose: ReauthPurpose, methods: ReauthMethods): string {
  const base = 'This account has no password, and email is not available right now, so we cannot confirm it is you.';
  if (purpose === 'delete' && methods.scheduledWithoutReauth) {
    return `${base} You can still choose Schedule deletion, which does not need confirmation.`;
  }
  return `${base} Try again later.`;
}

/**
 * "Confirm it is you": mints a short-lived re-auth token (POST /auth/reauth)
 * with the password or, for a passwordless account, a 6-digit email code.
 * `onToken` may run the guarded action and throw to keep the dialog open with
 * the error under the field (a stale token answers 401 REAUTH_REQUIRED).
 * Every control is a native button or input, so the dialog is fully keyboard
 * reachable; the Modal traps focus and Escape cancels, except while the
 * guarded action is running, when the dialog cannot be dismissed.
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
  // One stable ref object for the Modal's focus trap, pointed at the input
  // only while the input can take focus. In code mode the input is disabled
  // until a code has been sent; a disabled target makes focus() a no-op and
  // leaves focus on the trigger behind the dialog, so until then the ref is
  // empty and the trap falls back to the first control, the Send code button.
  // Keeping the object stable means the trap is not re-armed (and focus not
  // bounced through the trigger) when the code arrives.
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // What the polite live region says. It changes twice per code: when the
  // code is sent and when another may be requested. The countdown itself is
  // not live, so a screen reader is not read sixty numbers.
  const [announcement, setAnnouncement] = useState('');

  useLayoutEffect(() => {
    initialFocusRef.current = mode === 'code' && !codeSent ? null : inputRef.current;
  });

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
    setAnnouncement('');
  }, [open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (!open || !codeSent || cooldown > 0) return;
    setAnnouncement('You can ask for another code now.');
  }, [open, codeSent, cooldown]);

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
      setAnnouncement('Code sent. Check your email.');
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
      // While the guarded action runs, Escape, the backdrop, the sheet drag and
      // the close control do nothing: the request is already on its way.
      onClose={submitting ? noop : onCancel}
      closeOnBackdrop={!submitting}
      title="Confirm it is you"
      description={description}
      size="sm"
      initialFocusRef={initialFocusRef}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            {mode === 'none' ? 'Close' : 'Cancel'}
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
        <Callout tone="warning">{noMethodCopy(purpose, methods)}</Callout>
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
                {cooldown > 0 ? <span className="text-xs text-text-3">You can ask for another code in {cooldown} s.</span> : null}
              </div>
              <p className="sr-only" aria-live="polite">
                {announcement}
              </p>
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
