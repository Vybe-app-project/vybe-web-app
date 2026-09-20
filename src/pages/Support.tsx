import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, ButtonLink, Callout, Card, Input, PageHeader, Textarea, useToast } from './ui';
import { CheckCircle } from './icons';

type FieldErrors = Partial<Record<'fullName' | 'email' | 'message', string>>;

const MESSAGE_MAX = 5000;

const validate = (v: { fullName: string; email: string; message: string }): FieldErrors => {
  const errors: FieldErrors = {};
  const name = v.fullName.trim();
  if (name.length < 2 || name.length > 100) {
    errors.fullName = 'Enter your name (2–100 characters).';
  }
  const email = v.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    errors.email = 'Enter a valid email address.';
  }
  const message = v.message.trim();
  if (message.length < 10 || message.length > MESSAGE_MAX) {
    errors.message = `Your message needs 10–${MESSAGE_MAX.toLocaleString()} characters.`;
  }
  return errors;
};

export default function Support({ standalone = false }: { standalone?: boolean }) {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const [fullName, setFullName] = useState(user?.fullName || user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [message, setMessage] = useState('');
  // Honeypot: real users never fill this, bots usually do.
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sent, setSent] = useState<string | null>(null);

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
      setSent(email.trim());
      setMessage('');
      toast.success('Message sent');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not send your message. Try again in a moment.')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = validate({ fullName, email, message });
    setErrors(next);
    if (Object.keys(next).length === 0) send.mutate();
  };

  const clear = (key: keyof FieldErrors) => {
    if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }));
  };

  return (
    <>
      {standalone ? null : (
        <PageHeader
          title="Support"
          subtitle="Report a problem, ask a question or share feedback. We usually reply within two business days."
        />
      )}
      <div className="w-full max-w-form space-y-4">
        {standalone ? null : (
          <p className="text-sm text-text-2 lg:hidden">
            Report a problem, ask a question or share feedback. We usually reply within two business days.
          </p>
        )}

        {sent ? (
          <Card className="text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckCircle size={28} />
            </span>
            <h2 className="type-heading mt-4 text-lg text-text-1">Message received</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-text-2">
              Thanks for reaching out. We sent a confirmation to <span className="font-semibold text-text-1">{sent}</span> and
              will reply there.
            </p>
            <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
              <Button variant="secondary" onClick={() => setSent(null)}>
                Send another message
              </Button>
              <ButtonLink to="/" variant="ghost">
                Back to Vybe
              </ButtonLink>
            </div>
          </Card>
        ) : (
          <Card container>
            <form className="space-y-4" onSubmit={submit} noValidate>
              <div className="grid gap-4 @md:grid-cols-2">
                <Input
                  id="support-name"
                  label="Your name"
                  autoComplete="name"
                  value={fullName}
                  maxLength={100}
                  error={errors.fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    clear('fullName');
                  }}
                  placeholder="Alex Rivera"
                />
                <Input
                  id="support-email"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  maxLength={254}
                  error={errors.email}
                  hint={errors.email ? undefined : 'We reply to this address.'}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clear('email');
                  }}
                  placeholder="you@example.com"
                />
              </div>

              <Textarea
                id="support-message"
                label="How can we help?"
                rows={6}
                autoGrow
                maxRows={14}
                value={message}
                maxLength={MESSAGE_MAX}
                error={errors.message}
                hint={errors.message ? undefined : `${message.length.toLocaleString()}/${MESSAGE_MAX.toLocaleString()} characters. Include what you expected and what happened.`}
                onChange={(e) => {
                  setMessage(e.target.value);
                  clear('message');
                }}
                placeholder="Describe the issue with as much detail as you can."
              />

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

              {send.isError ? (
                <Callout tone="danger">{errMsg(send.error, 'Could not send your message. Try again in a moment.')}</Callout>
              ) : null}

              <Button type="submit" variant="primary" size="lg" block loading={send.isPending}>
                Send message
              </Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
