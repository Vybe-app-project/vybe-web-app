import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import axios, { type AxiosError } from 'axios';
import { useQuery } from '@tanstack/react-query';
import { API_BASE, api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { postLoginTarget, type FromLocation } from '../lib/authRedirect';
import {
  clearRegisterDraft,
  markWelcomePending,
  readRegisterDraft,
  resendSecondsLeft,
  writeRegisterDraft,
  type RegisterStep,
} from '../lib/authDrafts';
import {
  isEmail,
  passwordRules,
  isPasswordValid,
  usernameError,
  useCountdown,
  useDebounced,
  type PasswordRule,
} from '../lib/hooks';
import { Button, Callout, Input, Spinner, cx, useToast } from './ui';
import { Check, X } from './icons';
import { AuthShell, LegalLine, PasswordField, focusField } from './Login';

type Step = RegisterStep;

const registrationApi = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
});

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Email' },
  { n: 2, label: 'Verify' },
  { n: 3, label: 'Profile' },
];

const FIELD_IDS = {
  email: 'reg-email',
  otp: 'reg-otp',
  fullName: 'reg-name',
  username: 'reg-username',
  password: 'reg-password',
  confirm: 'reg-confirm',
} as const;

type FieldKey = keyof typeof FIELD_IDS;
type FieldErrors = Partial<Record<FieldKey, string>>;

const USERNAME_HINT = '3–30 characters. Letters, numbers, periods and underscores.';
const USERNAME_TAKEN = 'That username is taken. Try another one.';

/** Three labelled dots; the current one is announced with `aria-current`. */
function Steps({ step }: { step: Step }) {
  return (
    <ol className="flex items-center gap-2" aria-label={`Step ${step} of ${STEPS.length}`}>
      {STEPS.map(({ n, label }, i) => {
        const done = n < step;
        const current = n === step;
        return (
          <li key={n} className={cx('flex items-center gap-2', i < STEPS.length - 1 && 'flex-1')} aria-current={current ? 'step' : undefined}>
            <span
              className={cx(
                'tabular inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-bold transition-colors dur-2',
                done || current ? 'bg-brand text-on-brand' : 'bg-surface-3 text-text-3',
              )}
              aria-hidden="true"
            >
              {done ? <Check size={14} strokeWidth={2.6} /> : n}
            </span>
            <span className={cx('text-xs font-semibold', current ? 'text-text-1' : 'text-text-3')}>
              {label}
            </span>
            {i < STEPS.length - 1 ? <span className="mx-1 h-px flex-1 bg-line" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Live checklist under the password field. */
export function PasswordRules({ rules, id }: { rules: PasswordRule[]; id?: string }) {
  return (
    <ul id={id} className="mt-2 grid gap-1 sm:grid-cols-2" aria-label="Password requirements">
      {rules.map((rule) => (
        <li
          key={rule.id}
          className={cx('flex items-center gap-1.5 text-xs transition-colors dur-1', rule.ok ? 'text-brand-text' : 'text-text-3')}
        >
          {rule.ok ? <Check size={14} strokeWidth={2.4} /> : <X size={14} />}
          <span>{rule.label}</span>
          <span className="sr-only">{rule.ok ? ' (met)' : ' (not met)'}</span>
        </li>
      ))}
    </ul>
  );
}

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; username: string }
  | { state: 'taken'; username: string; suggestions: string[] }
  /** Rate-limited or offline: say nothing and let the server decide on submit. */
  | { state: 'unknown' };

/**
 * Availability while typing, the way Instagram does it: one request per
 * 300 ms pause, never for a handle that fails the format rule, and the
 * answer is cached briefly so retyping the same handle does not re-ask.
 */
function useUsernameAvailability(username: string, fullName: string, enabled: boolean): Availability {
  const debounced = useDebounced(username, 300);
  // The name feeds the suggestions (first.last), so it is part of the key:
  // a name typed after the handle refreshes them instead of leaving stale ones.
  const debouncedName = useDebounced(fullName.trim(), 300);
  const valid = enabled && debounced.length >= 3 && !usernameError(debounced);
  const query = useQuery({
    queryKey: ['username-available', debounced, debouncedName],
    enabled: valid,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get('/auth/username-available', {
        params: { username: debounced, ...(debouncedName ? { fullName: debouncedName } : {}) },
      });
      return data as { available: boolean; suggestions?: string[] };
    },
  });
  if (!valid) return { state: 'idle' };
  if (debounced !== username || query.isPending) return { state: 'checking' };
  if (query.isError || !query.data) return { state: 'unknown' };
  return query.data.available
    ? { state: 'available', username: debounced }
    : { state: 'taken', username: debounced, suggestions: query.data.suggestions ?? [] };
}

type FromState = { from?: FromLocation } | null;
type ConflictBody = { message?: string; field?: string; suggestions?: string[] };

export default function Register() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const acceptSession = useAuth((s) => s.acceptSession);
  const from = (location.state as FromState)?.from;
  const target = postLoginTarget({ from, next: new URLSearchParams(location.search).get('next') });

  // Progress survives a reload or a trip to Mail for the code (see authDrafts).
  const [draft] = useState(() => readRegisterDraft(sessionStorage));
  const [step, setStep] = useState<Step>(draft?.step ?? 1);
  const [email, setEmail] = useState(draft?.email ?? '');
  const [otp, setOtp] = useState('');
  const [preToken, setPreToken] = useState(draft?.preToken ?? '');
  const [sentAt, setSentAt] = useState<number | undefined>(draft?.sentAt);

  const [username, setUsername] = useState(draft?.username ?? '');
  const [fullName, setFullName] = useState(draft?.fullName ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [fieldError, setFieldError] = useState<FieldErrors>({});
  const [serverSuggestions, setServerSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(() =>
    draft?.step === 2 ? `We sent a 6-digit code to ${draft.email}.` : null,
  );
  const [busy, setBusy] = useState(false);
  const [resendIn, startResendCountdown] = useCountdown();

  const rules = passwordRules(password);
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedUsername = username.trim().toLowerCase();
  const formatErr = username ? usernameError(username.trim()) : null;
  const availability = useUsernameAvailability(trimmedUsername, fullName, step === 3 && !formatErr);

  // Honour the resend cooldown of a code sent before the reload.
  useEffect(() => {
    const left = resendSecondsLeft(draft?.sentAt);
    if (draft?.step === 2 && left > 0) startResendCountdown(left);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeRegisterDraft(sessionStorage, {
      step,
      email: trimmedEmail,
      sentAt,
      preToken: preToken || undefined,
      ...(step === 3 ? { fullName: fullName.trim() || undefined, username: trimmedUsername || undefined } : {}),
    });
  }, [step, trimmedEmail, sentAt, preToken, fullName, trimmedUsername]);

  function setErrors(next: FieldErrors, order: FieldKey[]): boolean {
    setFieldError(next);
    const first = order.find((key) => next[key]);
    if (first) focusField(FIELD_IDS[first]);
    return Boolean(first);
  }

  const clearFieldError = (key: FieldKey) => {
    if (fieldError[key]) setFieldError((f) => ({ ...f, [key]: undefined }));
  };

  /* ---------------- step 1: send the OTP ---------------- */
  async function sendOtp(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    if (!isEmail(trimmedEmail)) {
      setErrors({ email: 'Enter a valid email address.' }, ['email']);
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/sendEmailOtp', { email: trimmedEmail });
      setSentAt(Date.now());
      setStep(2);
      setInfo(`We sent a 6-digit code to ${trimmedEmail}.`);
      startResendCountdown(45);
    } catch (e2) {
      setError(errMsg(e2, 'Could not send the verification code.'));
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- step 2: verify the OTP ---------------- */
  async function verifyOtp(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    if (!/^\d{6}$/.test(otp)) {
      setErrors({ otp: 'Enter the 6-digit code from your email.' }, ['otp']);
      return;
    }

    setBusy(true);
    try {
      // The API accepts the code as `code`; `otp` is sent for compatibility.
      const { data } = await api.post('/auth/verifyEmailOtp', {
        email: trimmedEmail,
        otp,
        code: otp,
      });

      // The address already has an account: the code signs it in (as on
      // mobile). Say so, rather than landing on Home under "Create your account".
      if (data?.token) {
        await acceptSession(data.user, data.token);
        clearRegisterDraft(sessionStorage);
        const handle = data.user?.username ? `@${data.user.username}` : trimmedEmail;
        toast.info(`You already had an account, so we signed you in as ${handle}.`, { duration: 8000 });
        navigate(target, { replace: true });
        return;
      }

      const pre = data?.preToken;
      if (!pre) throw new Error('Verification did not return a registration token.');
      setPreToken(pre);
      setStep(3);
    } catch (e2) {
      setErrors({ otp: errMsg(e2, 'That code is invalid or expired.') }, ['otp']);
    } finally {
      setBusy(false);
    }
  }

  function changeEmail() {
    setStep(1);
    setOtp('');
    setSentAt(undefined);
    setPreToken('');
    setError(null);
    setInfo(null);
    setFieldError({});
  }

  /* ---------------- step 3: finish registration ---------------- */
  async function register(e?: FormEvent) {
    e?.preventDefault();
    setError(null);

    const next: FieldErrors = {};
    if (fullName.trim().length < 2) next.fullName = 'Enter your full name (2+ characters).';
    const nameErr = usernameError(username.trim());
    if (nameErr) next.username = nameErr;
    else if (availability.state === 'taken' && availability.username === trimmedUsername) next.username = USERNAME_TAKEN;
    if (!isPasswordValid(password)) next.password = 'Your password does not meet all requirements yet.';
    if (password !== confirm) next.confirm = 'Passwords do not match.';
    if (setErrors(next, ['fullName', 'username', 'password', 'confirm'])) return;

    setBusy(true);
    try {
      // A dedicated client is used so the pre-token (not the session token)
      // is sent as the bearer credential.
      const { data } = await registrationApi.post(
        '/auth/register-password',
        {
          email: trimmedEmail,
          username: trimmedUsername,
          fullName: fullName.trim(),
          password,
          fcmTokens: [],
        },
        {
          headers: {
            Authorization: `Bearer ${preToken}`,
            'X-Platform': 'web',
            'Content-Type': 'application/json',
          },
        },
      );

      if (!data?.token) throw new Error('Registration did not return a session token.');
      // First run: the welcome sheet opens on whatever page sign-up lands on.
      // Marked before the store update so GuestOnly's redirect cannot lose it.
      markWelcomePending(sessionStorage);
      clearRegisterDraft(sessionStorage);
      await acceptSession(data.user, data.token);
      navigate(target, { replace: true });
    } catch (e2) {
      const response = (e2 as AxiosError<ConflictBody>)?.response;
      const body = response?.data;
      if (response?.status === 409 && body?.field === 'username') {
        // Put the error where the person can act on it, with free alternatives.
        setServerSuggestions(body.suggestions ?? []);
        setErrors({ username: body.message || USERNAME_TAKEN }, ['username']);
        return;
      }
      if (response?.status === 409 && body?.field === 'email') {
        setError(body.message || 'An account with this email already exists. Sign in instead.');
        return;
      }
      if (response?.status === 401) {
        // The 10-minute registration proof has expired; a fresh code is needed.
        setPreToken('');
        setStep(1);
        setError('Your email verification expired. Send yourself a new code to continue.');
        focusField(FIELD_IDS.email);
        return;
      }
      setError(errMsg(e2, 'Could not create your account.'));
    } finally {
      setBusy(false);
    }
  }

  function pickSuggestion(handle: string) {
    setUsername(handle);
    setServerSuggestions([]);
    clearFieldError('username');
    focusField(FIELD_IDS.username);
  }

  const subtitle =
    step === 1
      ? 'Start with your email. We will send a code to verify it.'
      : step === 2
        ? 'Enter the code to confirm your email or sign in.'
        : 'Pick a username and a strong password.';

  // Under the username field: the format rule, the live availability check,
  // or the error (format / taken) with alternatives to tap.
  const usernameErrorText = fieldError.username ?? formatErr ?? (availability.state === 'taken' ? USERNAME_TAKEN : undefined);
  const suggestions = fieldError.username && serverSuggestions.length
    ? serverSuggestions
    : availability.state === 'taken'
      ? availability.suggestions
      : [];

  return (
    <AuthShell
      title="Create your account"
      subtitle={subtitle}
      headline="Train together."
      tagline="Workouts, meals, gyms and friends in one place. Set up takes about a minute."
      footer={<LegalLine />}
    >
      <Steps step={step} />

      <div className="mt-6 space-y-4">
        {info ? <Callout tone="brand">{info}</Callout> : null}
        {error ? (
          <Callout
            tone="danger"
            action={
              /already exists/i.test(error) ? (
                <Link
                  to="/login"
                  state={{ ...(location.state as object | null), email: trimmedEmail }}
                  className="inline-flex min-h-11 items-center rounded-sm px-2 text-sm font-semibold text-text-1 underline-offset-2 hover:underline"
                >
                  Sign in
                </Link>
              ) : undefined
            }
          >
            {error}
          </Callout>
        ) : null}

        {step === 1 && (
          <form onSubmit={sendOtp} className="space-y-4" noValidate>
            <Input
              id={FIELD_IDS.email}
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              placeholder="you@example.com"
              hint="We will email you a 6-digit code. If this address already has an account, the code signs you in."
              value={email}
              error={fieldError.email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearFieldError('email');
              }}
              disabled={busy}
              autoFocus
            />
            <Button type="submit" variant="primary" size="lg" block loading={busy}>
              Send code
            </Button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={verifyOtp} className="space-y-4" noValidate>
            <Input
              id={FIELD_IDS.otp}
              label="Verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              className="tabular text-center text-xl tracking-[0.4em]"
              hint={`Sent to ${trimmedEmail}. Codes expire after a few minutes.`}
              value={otp}
              error={fieldError.otp}
              onChange={(e) => {
                setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                clearFieldError('otp');
              }}
              disabled={busy}
              autoFocus
            />
            <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={otp.length !== 6}>
              Verify email
            </Button>
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={changeEmail} disabled={busy}>
                Change email
              </Button>
              <Button variant="link" size="sm" onClick={() => void sendOtp()} disabled={busy || resendIn > 0} className="tabular">
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </Button>
            </div>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={register} className="space-y-4" noValidate>
            <Input
              id={FIELD_IDS.fullName}
              label="Full name"
              autoComplete="name"
              placeholder="Alex Rivera"
              maxLength={100}
              value={fullName}
              error={fieldError.fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                clearFieldError('fullName');
              }}
              disabled={busy}
              autoFocus
            />

            <div>
              <Input
                id={FIELD_IDS.username}
                label="Username"
                autoComplete="username"
                autoCapitalize="none"
                placeholder="alex.rivera"
                leading={<span className="text-sm font-semibold">@</span>}
                hint={usernameErrorText || availability.state !== 'idle' ? undefined : USERNAME_HINT}
                error={usernameErrorText}
                aria-describedby={!usernameErrorText && availability.state !== 'idle' ? 'reg-username-status' : undefined}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value.replace(/\s/g, ''));
                  setServerSuggestions([]);
                  clearFieldError('username');
                }}
                disabled={busy}
              />
              {!usernameErrorText && availability.state !== 'idle' ? (
                <p id="reg-username-status" className="mt-1.5 min-h-4 text-xs" aria-live="polite">
                  {availability.state === 'checking' ? (
                    <span className="inline-flex items-center gap-1.5 text-text-3">
                      <Spinner size={12} /> Checking availability…
                    </span>
                  ) : availability.state === 'available' ? (
                    <span className="inline-flex items-center gap-1.5 text-brand-text">
                      <Check size={14} strokeWidth={2.4} /> @{availability.username} is available
                    </span>
                  ) : (
                    <span className="text-text-3">{USERNAME_HINT}</span>
                  )}
                </p>
              ) : null}
              {suggestions.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Available usernames">
                  <span className="text-xs text-text-3">Try</span>
                  {suggestions.map((handle) => (
                    <Button key={handle} variant="secondary" size="sm" onClick={() => pickSuggestion(handle)} disabled={busy}>
                      @{handle}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>

            <div>
              <PasswordField
                id={FIELD_IDS.password}
                label="Password"
                autoComplete="new-password"
                placeholder="Create a strong password"
                value={password}
                visible={showPassword}
                onVisibleChange={setShowPassword}
                error={fieldError.password}
                onChange={(e) => {
                  setPassword(e.target.value.slice(0, 128));
                  clearFieldError('password');
                }}
                disabled={busy}
                aria-describedby="reg-password-rules"
              />
              <PasswordRules rules={rules} id="reg-password-rules" />
            </div>

            <PasswordField
              id={FIELD_IDS.confirm}
              label="Confirm password"
              autoComplete="new-password"
              placeholder="Repeat your password"
              value={confirm}
              visible={showPassword}
              onVisibleChange={setShowPassword}
              error={fieldError.confirm ?? (confirm.length > 0 && confirm !== password ? 'Passwords do not match.' : undefined)}
              onChange={(e) => {
                setConfirm(e.target.value.slice(0, 128));
                clearFieldError('confirm');
              }}
              disabled={busy}
            />

            <Button type="submit" variant="primary" size="lg" block loading={busy}>
              Create account
            </Button>
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-text-2">
        Already have an account?{' '}
        <Link
          to="/login"
          state={location.state}
          className="inline-flex min-h-11 items-center font-semibold text-brand-text underline-offset-2 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
