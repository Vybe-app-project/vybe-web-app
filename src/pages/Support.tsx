import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, Input, Spinner, Textarea, useToast } from './ui';
import { Check } from './icons';

type FieldErrors = Partial<Record<'fullName' | 'email' | 'message', string>>;

const validate = (v: { fullName: string; email: string; message: string }): FieldErrors => {
  const errors: FieldErrors = {};
  const name = v.fullName.trim();
  if (name.length < 2 || name.length > 100) {
    errors.fullName = 'Please enter your name (2–100 characters).';
  }
  const email = v.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    errors.email = 'Please enter a valid email address.';
  }
  const message = v.message.trim();
  if (message.length < 10 || message.length > 5000) {
    errors.message = 'Your message must be between 10 and 5000 characters.';
  }
  return errors;
};

export default function Support() {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const [fullName, setFullName] = useState(user?.fullName || user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [message, setMessage] = useState('');
  // Honeypot: real users never fill this, bots usually do.
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sent, setSent] = useState(false);

  const send = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/support/message', {
        fullName: fullName.trim(),
        email: email.trim(),
        message: message.trim(),
        website,
      });
      return data;
    },
    onSuccess: () => {
      setSent(true);
      setMessage('');
      toast.success('Message sent. Our team will reply by email.');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not send your message')),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = validate({ fullName, email, message });
    setErrors(next);
    if (Object.keys(next).length === 0) send.mutate();
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Contact support</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Report a problem, ask a question or share feedback. We usually reply within
          two business days.
        </p>
      </header>

      {sent ? (
        <Card className="space-y-4 p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-emerald-400">
            <Check />
          </span>
          <h2 className="text-lg font-semibold">Message received</h2>
          <p className="text-sm text-[var(--color-muted)]">
            Thanks for reaching out. We sent a confirmation to {email}.
          </p>
          <Button variant="ghost" onClick={() => setSent(false)}>
            Send another message
          </Button>
        </Card>
      ) : (
        <Card className="p-6">
          <form className="space-y-4" onSubmit={submit} noValidate>
            <div className="space-y-1">
              <label className="text-xs text-[var(--color-muted)]" htmlFor="support-name">
                Your name
              </label>
              <Input
                id="support-name"
                value={fullName}
                maxLength={100}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
              />
              {errors.fullName && (
                <p className="text-xs text-[var(--color-accent)]">{errors.fullName}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-[var(--color-muted)]" htmlFor="support-email">
                Email
              </label>
              <Input
                id="support-email"
                type="email"
                value={email}
                maxLength={254}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              {errors.email && (
                <p className="text-xs text-[var(--color-accent)]">{errors.email}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-[var(--color-muted)]" htmlFor="support-message">
                How can we help?
              </label>
              <Textarea
                id="support-message"
                rows={6}
                value={message}
                maxLength={5000}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe the issue with as much detail as you can."
              />
              <div className="flex justify-between">
                {errors.message ? (
                  <p className="text-xs text-[var(--color-accent)]">{errors.message}</p>
                ) : (
                  <span />
                )}
                <p className="text-[11px] text-[var(--color-muted)]">{message.length}/5000</p>
              </div>
            </div>

            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="hidden"
            />

            <Button type="submit" className="w-full" disabled={send.isPending}>
              {send.isPending ? <Spinner size={16} /> : 'Send message'}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
