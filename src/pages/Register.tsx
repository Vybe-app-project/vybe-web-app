import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE, api, errMsg, tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  isEmail,
  passwordRules,
  isPasswordValid,
  usernameError,
  useCountdown,
} from '../lib/hooks';
import { Button, Input, Card } from './ui';
import { Check, X } from './icons';

type Step = 1 | 2 | 3;

const registrationApi = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
});

const STEP_LABELS: Record<Step, string> = {
  1: 'Your email',
  2: 'Verify code',
  3: 'Create profile',
};

export default function Register() {
  const navigate = useNavigate();
  const setUser = useAuth((s) => s.setUser);

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
        navigate('/', { replace: true });
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

    const uErr = usernameError(username.trim());
    if (uErr) return setError(uErr);
    if (fullName.trim().length < 2) return setError('Enter your full name (2+ characters).');
    if (!isPasswordValid(password))
      return setError('Your password does not meet all requirements yet.');
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
      navigate('/', { replace: true });
    } catch (e2) {
      setError(errMsg(e2, 'Could not create your account.'));
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
          <p className="text-sm text-[var(--color-muted)] mt-2">Create your account</p>
        </div>

        <Card className="p-6">
          {/* progress */}
          <div className="flex items-center gap-2 mb-5">
            {([1, 2, 3] as Step[]).map((n) => (
              <div key={n} className="flex-1">
                <div
                  className={`h-1 rounded-full ${
                    n <= step
                      ? 'bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-brand-2)]'
                      : 'bg-[var(--color-line)]'
                  }`}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--color-muted)] mb-4">
            Step {step} of 3 — {STEP_LABELS[step]}
          </p>

          {info && (
            <div
              role="status"
              className="mb-4 rounded-xl border border-[var(--color-brand)]/40 bg-[var(--color-brand)]/10 px-3 py-2 text-sm"
            >
              {info}
            </div>
          )}
          {error && (
            <p role="alert" className="mb-4 text-sm text-red-400">
              {error}
            </p>
          )}

          {step === 1 && (
            <form onSubmit={sendOtp} className="space-y-4" noValidate>
              <div>
                <label htmlFor="reg-email" className="block text-xs font-semibold mb-1.5">
                  Email
                </label>
                <Input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
                <p className="mt-1.5 text-xs text-[var(--color-muted)]">
                  We&apos;ll email you a 6-digit verification code.
                </p>
              </div>
              <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={busy}>
                Send code
              </Button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={verifyOtp} className="space-y-4" noValidate>
              <div>
                <label htmlFor="reg-otp" className="block text-xs font-semibold mb-1.5">
                  Verification code
                </label>
                <Input
                  id="reg-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  className="tracking-[0.5em] text-center text-lg"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={busy}
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={busy}
                disabled={busy || otp.length !== 6}
              >
                Verify email
              </Button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-[var(--color-muted)] hover:text-white"
                  onClick={() => {
                    setStep(1);
                    setOtp('');
                    setError(null);
                    setInfo(null);
                  }}
                  disabled={busy}
                >
                  Change email
                </button>
                <button
                  type="button"
                  className="text-[var(--color-brand-2)] disabled:text-[var(--color-muted)]"
                  onClick={() => sendOtp()}
                  disabled={busy || resendIn > 0}
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                </button>
              </div>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={register} className="space-y-4" noValidate>
              <div>
                <label htmlFor="reg-name" className="block text-xs font-semibold mb-1.5">
                  Full name
                </label>
                <Input
                  id="reg-name"
                  autoComplete="name"
                  placeholder="Alex Rivera"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={busy}
                />
              </div>

              <div>
                <label htmlFor="reg-username" className="block text-xs font-semibold mb-1.5">
                  Username
                </label>
                <Input
                  id="reg-username"
                  autoComplete="username"
                  placeholder="alex.rivera"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                  disabled={busy}
                />
                <p className="mt-1.5 text-xs text-[var(--color-muted)]">
                  3–30 characters. Letters, numbers, periods and underscores only.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="reg-password" className="block text-xs font-semibold">
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
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value.slice(0, 128))}
                  disabled={busy}
                />
                <ul className="mt-2 space-y-1">
                  {rules.map((rule) => (
                    <li
                      key={rule.id}
                      className={`flex items-center gap-2 text-xs ${
                        rule.ok ? 'text-emerald-400' : 'text-[var(--color-muted)]'
                      }`}
                    >
                      {rule.ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                      {rule.label}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <label htmlFor="reg-confirm" className="block text-xs font-semibold mb-1.5">
                  Confirm password
                </label>
                <Input
                  id="reg-confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value.slice(0, 128))}
                  disabled={busy}
                />
                {confirm.length > 0 && confirm !== password && (
                  <p className="mt-1.5 text-xs text-red-400">Passwords do not match.</p>
                )}
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={busy}
                disabled={busy}
              >
                Create account
              </Button>
            </form>
          )}

          <div className="mt-5 text-center text-sm text-[var(--color-muted)]">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-[var(--color-brand-2)]">
              Sign in
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
