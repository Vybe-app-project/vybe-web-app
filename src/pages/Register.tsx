import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE, api, errMsg, tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  isEmail,
  passwordRules,
  isPasswordValid,
  usernameError,
  useCountdown,
  type PasswordRule,
} from '../lib/hooks';
import { Button, Callout, Input, cx } from './ui';
import { Check, X } from './icons';
import { AuthShell, LegalLine, PasswordField } from './Login';

type Step = 1 | 2 | 3;

const registrationApi = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
});

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Email' },
  { n: 2, label: 'Verify' },
  { n: 3, label: 'Profile' },
];

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

function safePath(p?: string | null): string | null {
  if (!p || !p.startsWith('/') || p.startsWith('//') || p.startsWith('/login') || p.startsWith('/register')) return null;
  return p;
}

type FromState = { from?: { pathname?: string; search?: string } } | null;

export default function Register() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useAuth((s) => s.setUser);
  const from = (location.state as FromState)?.from;
  const target = safePath(from?.pathname ? `${from.pathname}${from.search ?? ''}` : null) ?? '/';

  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [preToken, setPreToken] = useState('');

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, startResendCountdown] = useCountdown();

  const rules = passwordRules(password);
  const trimmedEmail = email.trim().toLowerCase();
  const uErr = username ? usernameError(username.trim()) : null;

  /* ---------------- step 1: send the OTP ---------------- */
  async function sendOtp(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    if (!isEmail(trimmedEmail)) return setError('Enter a valid email address.');

    setBusy(true);
    try {
      await api.post('/auth/sendEmailOtp', { email: trimmedEmail });
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
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit code from your email.');

    setBusy(true);
    try {
      // The API accepts the code as `code`; `otp` is sent for compatibility.
      const { data } = await api.post('/auth/verifyEmailOtp', {
        email: trimmedEmail,
        otp,
        code: otp,
      });

      // Existing verified accounts are logged straight in.
      if (data?.token) {
        tokenStore.set(data.token);
        if (data.user) setUser(data.user);
        navigate(target, { replace: true });
        return;
      }

      const pre = data?.preToken || data?.token;
      if (!pre) throw new Error('Verification did not return a registration token.');
      setPreToken(pre);
      setStep(3);
    } catch (e2) {
      setError(errMsg(e2, 'That code is invalid or expired.'));
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- step 3: finish registration ---------------- */
  async function register(e?: FormEvent) {
    e?.preventDefault();
    setError(null);

    const nameErr = usernameError(username.trim());
    if (nameErr) return setError(nameErr);
    if (fullName.trim().length < 2) return setError('Enter your full name (2+ characters).');
    if (!isPasswordValid(password)) return setError('Your password does not meet all requirements yet.');
    if (password !== confirm) return setError('Passwords do not match.');

    setBusy(true);
    try {
      // A dedicated client is used so the pre-token (not the session token)
      // is sent as the bearer credential.
      const { data } = await registrationApi.post(
        '/auth/register-password',
        {
          email: trimmedEmail,
          username: username.trim().toLowerCase(),
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
      tokenStore.set(data.token);
      if (data.user) setUser(data.user);
      navigate(target, { replace: true });
    } catch (e2) {
      setError(errMsg(e2, 'Could not create your account.'));
    } finally {
      setBusy(false);
    }
  }

  const subtitle =
    step === 1
      ? 'Start with your email. We will send a code to verify it.'
      : step === 2
        ? 'Enter the code to confirm your email.'
        : 'Pick a username and a strong password.';

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
        {error ? <Callout tone="danger">{error}</Callout> : null}

        {step === 1 && (
          <form onSubmit={sendOtp} className="space-y-4" noValidate>
            <Input
              id="reg-email"
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              placeholder="you@example.com"
              hint="We will email you a 6-digit verification code."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              id="reg-otp"
              label="Verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              className="tabular text-center text-xl tracking-[0.4em]"
              hint={`Sent to ${trimmedEmail}. Codes expire after a few minutes.`}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={busy}
              autoFocus
            />
            <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={otp.length !== 6}>
              Verify email
            </Button>
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep(1);
                  setOtp('');
                  setError(null);
                  setInfo(null);
                }}
                disabled={busy}
              >
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
              id="reg-name"
              label="Full name"
              autoComplete="name"
              placeholder="Alex Rivera"
              maxLength={100}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={busy}
              autoFocus
            />

            <Input
              id="reg-username"
              label="Username"
              autoComplete="username"
              autoCapitalize="none"
              placeholder="alex.rivera"
              leading={<span className="text-sm font-semibold">@</span>}
              hint={uErr ? undefined : '3–30 characters. Letters, numbers, periods and underscores.'}
              error={uErr ?? undefined}
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
              disabled={busy}
            />

            <div>
              <PasswordField
                id="reg-password"
                label="Password"
                autoComplete="new-password"
                placeholder="Create a strong password"
                value={password}
                visible={showPassword}
                onVisibleChange={setShowPassword}
                onChange={(e) => setPassword(e.target.value.slice(0, 128))}
                disabled={busy}
                aria-describedby="reg-password-rules"
              />
              <PasswordRules rules={rules} id="reg-password-rules" />
            </div>

            <PasswordField
              id="reg-confirm"
              label="Confirm password"
              autoComplete="new-password"
              placeholder="Repeat your password"
              value={confirm}
              visible={showPassword}
              onVisibleChange={setShowPassword}
              error={confirm.length > 0 && confirm !== password ? 'Passwords do not match.' : undefined}
              onChange={(e) => setConfirm(e.target.value.slice(0, 128))}
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
