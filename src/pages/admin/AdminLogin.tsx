import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errMsg } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { BrandMark, Button, Callout, Card, Input } from '../../components/ui';
import { Lock, Mail, ArrowLeft, ArrowRight } from '../../components/icons';
import { useAdminScope } from './AdminLayout';

/**
 * Chrome shared by the console's signed-out surfaces: sign-in, forgot
 * password and reset password. Deliberately a separate, austere "console"
 * look so nobody confuses it with the member app: graphite surfaces, the
 * quiet amber accent, the blueprint grid. All colour comes from the console
 * token layer (src/styles.admin.css), which useAdminScope mounts on <html>.
 */
export function AdminAuthShell({
  documentTitle,
  children,
}: {
  documentTitle: string;
  children: ReactNode;
}) {
  useAdminScope();
  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-bg px-4 py-10 text-text-1">
      <div aria-hidden className="admin-blueprint pointer-events-none fixed inset-0" />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-md bg-brand-soft text-brand">
            <BrandMark size={30} />
          </div>
          <div>
            <h1 className="type-heading text-xl text-text-1">Vybe</h1>
            <p className="admin-signature mt-1">Staff console</p>
          </div>
        </div>

        <Card padded={false} className="p-5 shadow-2 sm:p-6">
          {children}
        </Card>
      </div>
    </div>
  );
}

/** Return link under the recovery pages; 44 px tall so it is a real hit target. */
export function BackToSignIn() {
  return (
    <Link
      to="/admin/login"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-sm px-1 text-sm font-semibold text-text-2 hover:text-text-1"
    >
      <ArrowLeft size={18} />
      Back to sign-in
    </Link>
  );
}

/**
 * Staff sign-in. Carries the explicit restricted-access notice; the
 * recovery pages reached from here share AdminAuthShell.
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
    <AdminAuthShell documentTitle="Staff sign-in · Vybe">
      <form onSubmit={onSubmit} noValidate>
        <Callout tone="warning" className="mb-5">
          Restricted system. Administrator activity is recorded in the audit log.
        </Callout>

        <div className="space-y-4">
          <Input
            id="admin-email"
            label="Staff email"
            type="email"
            autoComplete="username"
            autoFocus
            spellCheck={false}
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@vybe.app"
            leading={<Mail size={18} />}
            disabled={submitting}
          />
          <Input
            id="admin-password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            leading={<Lock size={18} />}
            disabled={submitting}
          />
          <div className="flex justify-end">
            <Link
              to="/admin/forgot-password"
              className="inline-flex min-h-11 items-center rounded-sm px-1 text-sm font-semibold text-text-2 hover:text-text-1"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        {error ? (
          <Callout tone="danger" className="mt-4">
            {error}
          </Callout>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          loading={submitting}
          iconRight={<ArrowRight size={18} />}
          className="mt-4"
        >
          Sign in
        </Button>

        <p className="mt-5 text-center text-xs text-text-2">
          Looking for the member app?{' '}
          <a
            href="/login"
            className="inline-flex min-h-6 items-center font-semibold text-brand-text underline decoration-line-strong underline-offset-3 hover:decoration-current"
          >
            Member sign-in
          </a>
        </p>
      </form>
    </AdminAuthShell>
  );
}
