import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { errMsg } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Input } from '../../components/ui';
import { Shield, Lock, Mail, Alert } from '../../components/icons';

/**
 * Staff sign-in. Deliberately styled as a separate, austere "console" surface
 * so nobody confuses it with the consumer app: no brand gradient, slate/amber
 * palette, mono type, and an explicit restricted-access warning.
 */
export default function AdminLogin() {
  const navigate = useNavigate();
  const adminLogin = useAuth((s) => s.adminLogin);
  const admin = useAuth((s) => s.admin);
  const bootstrapAdmin = useAuth((s) => s.bootstrapAdmin);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void bootstrapAdmin();
  }, [bootstrapAdmin]);

  useEffect(() => {
    if (admin) navigate('/admin', { replace: true });
  }, [admin, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setError('Enter your staff email and password.');
      return;
    }
    setSubmitting(true);
    try {
      await adminLogin(trimmed, password);
      navigate('/admin', { replace: true });
    } catch (e2) {
      setError(errMsg(e2, 'Sign-in failed. Check your credentials and try again.'));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#05070c] px-4 py-10">
      {/* Faint grid so the staff surface reads as an ops console. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300">
            <Shield size={28} />
          </div>
          <div>
            <h1 className="font-mono text-xl font-bold tracking-[0.22em] text-slate-100 uppercase">
              Vybe Staff
            </h1>
            <p className="mt-1 font-mono text-[11px] tracking-[0.16em] text-slate-500 uppercase">
              Administration console
            </p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 shadow-2xl shadow-black/60 backdrop-blur"
          noValidate
        >
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2.5">
            <Alert size={16} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-[12px] leading-relaxed text-amber-200/80">
              Restricted system. Administrator activity is recorded in the audit log.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="admin-email"
                className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase"
              >
                <Mail size={13} /> Staff email
              </label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="username"
                autoFocus
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@vybe.app"
                className="border-slate-800 bg-slate-900/70 font-mono text-sm text-slate-100"
                disabled={submitting}
              />
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase"
              >
                <Lock size={13} /> Password
              </label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="border-slate-800 bg-slate-900/70 font-mono text-sm text-slate-100"
                disabled={submitting}
              />
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            block
            loading={submitting}
            className="mt-6 border-amber-500/40 bg-amber-500/15 font-mono text-sm font-bold tracking-[0.14em] text-amber-200 uppercase hover:bg-amber-500/25"
          >
            {submitting ? 'Authenticating' : 'Sign in'}
          </Button>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-600">
            Looking for the Vybe app?{' '}
            <a href="/login" className="text-slate-400 underline underline-offset-2 hover:text-slate-200">
              Member sign-in
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
