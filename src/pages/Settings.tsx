import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTING_KEYS,
  isPasswordValid,
  passwordRules,
  pickNotificationSettings,
  usernameError,
  type NotificationSettingKey,
  type NotificationSettings,
  type PublicUser,
} from '../lib/hooks';
import {
  Button,
  Card,
  ErrorState,
  Input,
  Skeleton,
  Switch,
  Textarea,
  useToast,
} from './ui';
import { Check, X } from './icons';

const NOTIFICATION_LABELS: Record<NotificationSettingKey, { title: string; hint: string }> = {
  pauseAll: {
    title: 'Pause all notifications',
    hint: 'Temporarily stop every push notification from Vybe.',
  },
  messagesFromFollowing: {
    title: 'Messages from people you follow',
    hint: 'Direct messages from accounts you follow.',
  },
  messagesFromOthers: {
    title: 'Messages from everyone else',
    hint: 'Direct messages from accounts you do not follow.',
  },
  newFollowers: { title: 'New followers', hint: 'When someone follows you.' },
  workoutPosts: { title: 'Workout posts', hint: 'Activity posts from people you follow.' },
  likes: { title: 'Likes', hint: 'When someone likes your post or comment.' },
  comments: { title: 'Comments', hint: 'When someone comments on your post.' },
  friendRequests: { title: 'Friend requests', hint: 'Incoming and accepted friend requests.' },
};

const DELETE_PHRASE = 'DELETE MY ACCOUNT';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <h2 className="text-base font-bold">{title}</h2>
      {description && (
        <p className="mt-1 text-sm text-[var(--color-muted)]">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function AccountSection() {
  const authUser = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const qc = useQueryClient();
  const toast = useToast();

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await api.get('/users/me');
      return (data.user || data) as PublicUser;
    },
    initialData: (authUser as PublicUser) ?? undefined,
  });

  const [form, setForm] = useState({ fullName: '', username: '', bio: '' });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (meQuery.data && !hydrated) {
      setForm({
        fullName: meQuery.data.fullName || '',
        username: meQuery.data.username || '',
        bio: meQuery.data.bio || '',
      });
      setHydrated(true);
    }
  }, [meQuery.data, hydrated]);

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await api.put('/users/me', {
        fullName: form.fullName.trim(),
        username: form.username.trim().toLowerCase(),
        bio: form.bio.trim(),
      });
      return (data.user || data) as PublicUser;
    },
    onSuccess: (user) => {
      setUser(user as any);
      qc.setQueryData(['me'], user);
      toast.success('Account details saved');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save your account details.')),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const uErr = usernameError(form.username.trim());
    if (uErr) return toast.error(uErr);
    if (form.fullName.trim().length < 2) return toast.error('Enter your full name.');
    save.mutate();
  }

  if (meQuery.isLoading && !meQuery.data) {
    return (
      <Section title="Account">
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </Section>
    );
  }

  if (meQuery.isError) {
    return (
      <Section title="Account">
        <ErrorState
          title="Could not load your account"
          message={errMsg(meQuery.error, 'Please try again.')}
          action={
            <Button variant="primary" onClick={() => meQuery.refetch()}>
              Retry
            </Button>
          }
        />
      </Section>
    );
  }

  return (
    <Section title="Account" description="Your public identity across Vybe.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="set-name" className="mb-1.5 block text-xs font-semibold">
            Full name
          </label>
          <Input
            id="set-name"
            maxLength={100}
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
          />
        </div>
        <div>
          <label htmlFor="set-username" className="mb-1.5 block text-xs font-semibold">
            Username
          </label>
          <Input
            id="set-username"
            maxLength={30}
            value={form.username}
            onChange={(e) =>
              setForm((f) => ({ ...f, username: e.target.value.replace(/\s/g, '') }))
            }
          />
        </div>
        <div>
          <label htmlFor="set-bio" className="mb-1.5 block text-xs font-semibold">
            Bio
          </label>
          <Textarea
            id="set-bio"
            rows={3}
            maxLength={300}
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
          />
        </div>
        {meQuery.data?.email && (
          <p className="text-xs text-[var(--color-muted)]">
            Signed in as {meQuery.data.email}
          </p>
        )}
        <Button type="submit" variant="primary" loading={save.isPending} disabled={save.isPending}>
          Save changes
        </Button>
      </form>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function PasswordSection() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);

  const rules = passwordRules(newPassword);

  const change = useMutation({
    mutationFn: async () => {
      await api.put('/users/password', { currentPassword, newPassword });
    },
    onSuccess: () => {
      toast.success('Password changed. Please sign in again.');
      // The API revokes existing sessions, so drop the token and force re-login.
      tokenStore.clear();
      setTimeout(() => {
        window.location.href = '/login';
      }, 900);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not change your password.')),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!currentPassword) return toast.error('Enter your current password.');
    if (!isPasswordValid(newPassword))
      return toast.error('Your new password does not meet all requirements.');
    if (newPassword === currentPassword)
      return toast.error('Choose a password different from your current one.');
    if (newPassword !== confirm) return toast.error('New passwords do not match.');
    change.mutate();
  }

  return (
    <Section
      title="Password"
      description="Changing your password signs you out of every device."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="set-current" className="block text-xs font-semibold">
              Current password
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
            id="set-current"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value.slice(0, 128))}
          />
        </div>

        <div>
          <label htmlFor="set-new" className="mb-1.5 block text-xs font-semibold">
            New password
          </label>
          <Input
            id="set-new"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value.slice(0, 128))}
          />
          <ul className="mt-2 space-y-1">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className={`flex items-center gap-2 text-xs ${
                  rule.ok ? 'text-emerald-400' : 'text-[var(--color-muted)]'
                }`}
              >
                {rule.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                {rule.label}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <label htmlFor="set-confirm" className="mb-1.5 block text-xs font-semibold">
            Confirm new password
          </label>
          <Input
            id="set-confirm"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.slice(0, 128))}
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          loading={change.isPending}
          disabled={change.isPending}
        >
          Change password
        </Button>
      </form>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function NotificationsSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<NotificationSettings | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['notification-settings'],
    queryFn: async () => {
      const { data } = await api.get('/notifications/settings');
      return pickNotificationSettings(data.settings || data);
    },
  });

  useEffect(() => {
    if (settingsQuery.data && !draft) setDraft(settingsQuery.data);
  }, [settingsQuery.data, draft]);

  const save = useMutation({
    mutationFn: async (next: NotificationSettings) => {
      const payload = pickNotificationSettings(next);
      const { data } = await api.put('/notifications/settings', payload);
      return pickNotificationSettings(data.settings || payload);
    },
    onSuccess: (settings) => {
      setDraft(settings);
      qc.setQueryData(['notification-settings'], settings);
      toast.success('Notification preferences saved');
    },
    onError: (e, _v, ctx) => {
      if (ctx) setDraft(ctx as NotificationSettings);
      toast.error(errMsg(e, 'Could not save your notification preferences.'));
    },
    onMutate: (next) => {
      const prev = draft;
      setDraft(next);
      return prev;
    },
  });

  if (settingsQuery.isLoading) {
    return (
      <Section title="Notifications">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </Section>
    );
  }

  if (settingsQuery.isError) {
    return (
      <Section title="Notifications">
        <ErrorState
          title="Preferences unavailable"
          message={errMsg(settingsQuery.error, 'Please try again.')}
          action={
            <Button variant="primary" onClick={() => settingsQuery.refetch()}>
              Retry
            </Button>
          }
        />
      </Section>
    );
  }

  const value = draft || settingsQuery.data || DEFAULT_NOTIFICATION_SETTINGS;

  return (
    <Section
      title="Notifications"
      description="Choose what Vybe is allowed to notify you about."
    >
      <div className="divide-y divide-[var(--color-line)]">
        {NOTIFICATION_SETTING_KEYS.map((key) => {
          const meta = NOTIFICATION_LABELS[key];
          const disabled =
            save.isPending || (key !== 'pauseAll' && value.pauseAll === true);
          return (
            <div key={key} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{meta.title}</p>
                <p className="text-xs text-[var(--color-muted)]">{meta.hint}</p>
              </div>
              <Switch
                checked={value[key]}
                disabled={disabled}
                label={meta.title}
                onChange={(checked) => save.mutate({ ...value, [key]: checked })}
              />
            </div>
          );
        })}
      </div>
      {value.pauseAll && (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          All notifications are paused. Turn off “Pause all notifications” to adjust the
          individual settings.
        </p>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function EmailPreferencesSection() {
  const toast = useToast();
  const [draft, setDraft] = useState<NotificationSettings | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['notification-settings'],
    queryFn: async () => {
      const { data } = await api.get('/notifications/settings');
      return pickNotificationSettings(data.settings || data);
    },
  });

  useEffect(() => {
    if (settingsQuery.data && !draft) setDraft(settingsQuery.data);
  }, [settingsQuery.data, draft]);

  const save = useMutation({
    mutationFn: async (next: NotificationSettings) => {
      await api.put('/users/email-preferences', {
        notifications: pickNotificationSettings(next),
      });
      return next;
    },
    onSuccess: () => toast.success('Email preferences saved'),
    onError: (e) => toast.error(errMsg(e, 'Could not save your email preferences.')),
  });

  const value = draft || settingsQuery.data || DEFAULT_NOTIFICATION_SETTINGS;

  const emailKeys: NotificationSettingKey[] = [
    'newFollowers',
    'likes',
    'comments',
    'friendRequests',
    'workoutPosts',
  ];

  return (
    <Section
      title="Email preferences"
      description="Which of these updates you also receive by email."
    >
      {settingsQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="divide-y divide-[var(--color-line)]">
            {emailKeys.map((key) => (
              <div key={key} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{NOTIFICATION_LABELS[key].title}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {NOTIFICATION_LABELS[key].hint}
                  </p>
                </div>
                <Switch
                  checked={value[key]}
                  label={NOTIFICATION_LABELS[key].title}
                  disabled={save.isPending}
                  onChange={(checked) => setDraft({ ...value, [key]: checked })}
                />
              </div>
            ))}
          </div>
          <Button
            variant="primary"
            className="mt-4"
            loading={save.isPending}
            disabled={save.isPending}
            onClick={() => save.mutate(value)}
          >
            Save email preferences
          </Button>
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function DangerZone() {
  const toast = useToast();
  const logout = useAuth((s) => s.logout);
  const [phrase, setPhrase] = useState('');

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete('/users/me');
    },
    onSuccess: () => {
      toast.success('Your account has been permanently deleted.');
      setTimeout(() => logout(), 800);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete your account.')),
  });

  return (
    <Card className="border-red-500/40 p-5">
      <h2 className="text-base font-bold text-red-400">Delete account</h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        This permanently deletes your profile, posts, comments, workouts and meals. It cannot
        be undone.
      </p>
      <div className="mt-4 space-y-3">
        <label htmlFor="del-phrase" className="block text-xs font-semibold">
          Type <span className="font-mono text-red-400">{DELETE_PHRASE}</span> to confirm
        </label>
        <Input
          id="del-phrase"
          value={phrase}
          placeholder={DELETE_PHRASE}
          autoComplete="off"
          onChange={(e) => setPhrase(e.target.value)}
        />
        <Button
          variant="danger"
          disabled={phrase !== DELETE_PHRASE || remove.isPending}
          loading={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Permanently delete my account
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export default function Settings() {
  const logout = useAuth((s) => s.logout);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Settings</h1>
        <Button variant="ghost" onClick={() => logout()}>
          Sign out
        </Button>
      </header>

      <AccountSection />
      <PasswordSection />
      <NotificationsSection />
      <EmailPreferencesSection />
      <DangerZone />
    </div>
  );
}
