import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { passwordRules, isPasswordValid } from '../lib/hooks';
import { Button, Input, Card, ErrorState } from './ui';
import { Check, X } from './icons';

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isPasswordValid(password))
      return setError('Your password does not meet all requirements yet.');
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

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl font-black tracking-tight bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-brand-2)] bg-clip-text text-transparent">
            Vybe
          </div>
        </div>

        <Card className="p-6">
          {!tokenLooksValid ? (
            <ErrorState
              title="Reset link is not valid"
              message="This password reset link is missing or malformed. Request a new one to continue."
              action={
                <Link to="/forgot-password">
                  <Button variant="primary">Request a new link</Button>
                </Link>
              }
            />
          ) : (
            <>
              <h1 className="text-lg font-bold mb-1">Choose a new password</h1>
              <p className="text-sm text-[var(--color-muted)] mb-5">
                Signing in elsewhere will require the new password.
              </p>

              <form onSubmit={submit} className="space-y-4" noValidate>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="rp-password" className="block text-xs font-semibold">
                      New password
                    </label>
                    <button
                      type="button"
                      className="text-xs text-[var(--color-muted)] hover:text-white"
                      onClick={() => setShow((v) => !v)}
                    >
                      {show ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <Input
                    id="rp-password"
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
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
                        {rule.ok ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <X className="w-3.5 h-3.5" />
                        )}
                        {rule.label}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <label htmlFor="rp-confirm" className="block text-xs font-semibold mb-1.5">
                    Confirm new password
                  </label>
                  <Input
                    id="rp-confirm"
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value.slice(0, 128))}
                    disabled={busy}
                  />
                  {confirm.length > 0 && confirm !== password && (
                    <p className="mt-1.5 text-xs text-red-400">Passwords do not match.</p>
                  )}
                </div>

                {error && (
                  <p role="alert" className="text-sm text-red-400">
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  loading={busy}
                  disabled={busy}
                >
                  Update password
                </Button>
              </form>
            </>
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
