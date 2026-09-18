import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
  Callout,
  Card,
  ConfirmDialog,
  ErrorState,
  IconButton,
  Input,
  PageHeader,
  Skeleton,
  Switch,
  Textarea,
  ThemeControl,
  cx,
  useToast,
} from './ui';
import { ChevronRight, ExternalLink, FileText, LifeBuoy, LogOut, Shield } from './icons';
import { PasswordField } from './Login';
import { PasswordRules } from './Register';

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

/* ------------------------------------------------------------------ pieces */

function SettingsCard({
  id,
  title,
  description,
  children,
  className,
  titleClassName,
  padded = true,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  titleClassName?: string;
  padded?: boolean;
}) {
  return (
    <Card role="region" aria-labelledby={`${id}-title`} className={className} padded={padded}>
      <div className={cx(!padded && 'px-4 pt-4 sm:px-5 sm:pt-5')}>
        <h2 id={`${id}-title`} className={cx('type-heading text-lg text-text-1', titleClassName)}>
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-text-2">{description}</p> : null}
      </div>
      <div className={cx('mt-4', !padded && 'px-1 pb-1')}>{children}</div>
    </Card>
  );
}

function ToggleRow({
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={cx('flex min-h-11 items-center gap-4 py-2', disabled && 'opacity-70')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-1">{title}</p>
        <p className="text-xs text-text-2">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} label={title} onChange={onChange} />
    </div>
  );
}

function RowsSkeleton({ rows, height = 'h-11' }: { rows: number; height?: string }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cx('w-full rounded-sm', height)} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ account */

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
  const [errors, setErrors] = useState<{ fullName?: string; username?: string }>({});

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

  const dirty =
    !!meQuery.data &&
    (form.fullName !== (meQuery.data.fullName || '') ||
      form.username !== (meQuery.data.username || '') ||
      form.bio !== (meQuery.data.bio || ''));

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
      setForm({ fullName: user.fullName || '', username: user.username || '', bio: user.bio || '' });
      toast.success('Account details saved');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save your account details.')),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const uErr = usernameError(form.username.trim());
    if (uErr) next.username = uErr;
    if (form.fullName.trim().length < 2) next.fullName = 'Enter your full name (2+ characters).';
    setErrors(next);
    if (next.username || next.fullName) return;
    save.mutate();
  }

  if (meQuery.isLoading && !meQuery.data) {
    return (
      <SettingsCard id="account" title="Account">
        <RowsSkeleton rows={3} />
      </SettingsCard>
    );
  }

  if (meQuery.isError && !meQuery.data) {
    return (
      <SettingsCard id="account" title="Account">
        <ErrorState title="Could not load your account" error={meQuery.error} retry={() => void meQuery.refetch()} />
      </SettingsCard>
    );
  }

  return (
    <SettingsCard id="account" title="Account" description="Your public identity across Vybe.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input
          id="set-name"
          label="Full name"
          autoComplete="name"
          maxLength={100}
          value={form.fullName}
          error={errors.fullName}
          onChange={(e) => {
            setForm((f) => ({ ...f, fullName: e.target.value }));
            if (errors.fullName) setErrors((x) => ({ ...x, fullName: undefined }));
          }}
        />
        <Input
          id="set-username"
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          maxLength={30}
          leading={<span className="text-sm font-semibold">@</span>}
          hint={errors.username ? undefined : '3–30 characters. Letters, numbers, periods and underscores.'}
          error={errors.username}
          value={form.username}
          onChange={(e) => {
            setForm((f) => ({ ...f, username: e.target.value.replace(/\s/g, '') }));
            if (errors.username) setErrors((x) => ({ ...x, username: undefined }));
          }}
        />
        <Textarea
          id="set-bio"
          label="Bio"
          rows={3}
          autoGrow
          maxLength={300}
          placeholder="A line about how you train."
          hint={`${form.bio.length}/300 characters`}
          value={form.bio}
          onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          {meQuery.data?.email ? (
            <p className="text-xs text-text-3">
              Signed in as <span className="font-semibold text-text-2">{meQuery.data.email}</span>
            </p>
          ) : (
            <span />
          )}
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ appearance */

function AppearanceSection() {
  return (
    <SettingsCard
      id="appearance"
      title="Appearance"
      description="Choose how Vybe looks. System follows your device setting and switches automatically."
    >
      <ThemeControl />
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ password */

function PasswordSection() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});

  const rules = passwordRules(newPassword);

  const change = useMutation({
    mutationFn: async () => {
      await api.put('/users/password', { currentPassword, newPassword });
    },
    onSuccess: () => {
      toast.success('Password changed. Sign in again to continue.');
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
    const next: typeof errors = {};
    if (!currentPassword) next.current = 'Enter your current password.';
    if (!isPasswordValid(newPassword)) next.next = 'Your new password does not meet all requirements yet.';
    else if (newPassword === currentPassword) next.next = 'Choose a password different from your current one.';
    if (newPassword !== confirm) next.confirm = 'New passwords do not match.';
    setErrors(next);
    if (next.current || next.next || next.confirm) return;
    change.mutate();
  }

  return (
    <SettingsCard id="password" title="Password" description="Changing your password signs you out of every device.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <PasswordField
          id="set-current"
          label="Current password"
          autoComplete="current-password"
          value={currentPassword}
          visible={show}
          onVisibleChange={setShow}
          error={errors.current}
          onChange={(e) => {
            setCurrentPassword(e.target.value.slice(0, 128));
            if (errors.current) setErrors((x) => ({ ...x, current: undefined }));
          }}
        />
        <div>
          <PasswordField
            id="set-new"
            label="New password"
            autoComplete="new-password"
            value={newPassword}
            visible={show}
            onVisibleChange={setShow}
            error={errors.next}
            aria-describedby="set-new-rules"
            onChange={(e) => {
              setNewPassword(e.target.value.slice(0, 128));
              if (errors.next) setErrors((x) => ({ ...x, next: undefined }));
            }}
          />
          <PasswordRules rules={rules} id="set-new-rules" />
        </div>
        <PasswordField
          id="set-confirm"
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          visible={show}
          onVisibleChange={setShow}
          error={errors.confirm ?? (confirm.length > 0 && confirm !== newPassword ? 'New passwords do not match.' : undefined)}
          onChange={(e) => {
            setConfirm(e.target.value.slice(0, 128));
            if (errors.confirm) setErrors((x) => ({ ...x, confirm: undefined }));
          }}
        />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={change.isPending} disabled={!currentPassword || !newPassword || !confirm}>
            Change password
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ notifications */

function useNotificationSettings() {
  return useQuery({
    queryKey: ['notification-settings'],
    queryFn: async () => {
      const { data } = await api.get('/notifications/settings');
      return pickNotificationSettings(data.settings || data);
    },
  });
}

function NotificationsSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const settingsQuery = useNotificationSettings();

  useEffect(() => {
    if (settingsQuery.data && !draft) setDraft(settingsQuery.data);
  }, [settingsQuery.data, draft]);

  const save = useMutation({
    mutationFn: async (next: NotificationSettings) => {
      const payload = pickNotificationSettings(next);
      const { data } = await api.put('/notifications/settings', payload);
      return pickNotificationSettings(data.settings || payload);
    },
    onMutate: (next) => {
      const prev = draft;
      setDraft(next);
      return prev;
    },
    onSuccess: (settings) => {
      setDraft(settings);
      qc.setQueryData(['notification-settings'], settings);
    },
    onError: (e, _v, ctx) => {
      if (ctx) setDraft(ctx as NotificationSettings);
      toast.error(errMsg(e, 'Could not save your notification preferences.'));
    },
  });

  if (settingsQuery.isLoading) {
    return (
      <SettingsCard id="notifications" title="Notifications">
        <RowsSkeleton rows={5} height="h-12" />
      </SettingsCard>
    );
  }

  if (settingsQuery.isError) {
    return (
      <SettingsCard id="notifications" title="Notifications">
        <ErrorState title="Preferences unavailable" error={settingsQuery.error} retry={() => void settingsQuery.refetch()} />
      </SettingsCard>
    );
  }

  const value = draft || settingsQuery.data || DEFAULT_NOTIFICATION_SETTINGS;
  const paused = value.pauseAll === true;
  const rest = NOTIFICATION_SETTING_KEYS.filter((k) => k !== 'pauseAll');

  return (
    <SettingsCard id="notifications" title="Notifications" description="Choose what Vybe is allowed to notify you about. Changes save automatically.">
      <ToggleRow
        title={NOTIFICATION_LABELS.pauseAll.title}
        hint={NOTIFICATION_LABELS.pauseAll.hint}
        checked={paused}
        disabled={save.isPending}
        onChange={(checked) => save.mutate({ ...value, pauseAll: checked })}
      />
      {paused ? (
        <Callout tone="warning" className="my-2">
          All notifications are paused. Turn “Pause all notifications” off to adjust the individual settings.
        </Callout>
      ) : null}
      <div className="mt-1 divide-y divide-line border-t border-line">
        {rest.map((key) => (
          <ToggleRow
            key={key}
            title={NOTIFICATION_LABELS[key].title}
            hint={NOTIFICATION_LABELS[key].hint}
            checked={value[key]}
            disabled={save.isPending || paused}
            onChange={(checked) => save.mutate({ ...value, [key]: checked })}
          />
        ))}
      </div>
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ email */

const EMAIL_KEYS: NotificationSettingKey[] = ['newFollowers', 'likes', 'comments', 'friendRequests', 'workoutPosts'];

function EmailPreferencesSection() {
  const toast = useToast();
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const settingsQuery = useNotificationSettings();

  useEffect(() => {
    if (settingsQuery.data && !draft) setDraft(settingsQuery.data);
  }, [settingsQuery.data, draft]);

  const save = useMutation({
    mutationFn: async (next: NotificationSettings) => {
      await api.put('/users/email-preferences', { notifications: pickNotificationSettings(next) });
      return next;
    },
    onSuccess: () => toast.success('Email preferences saved'),
    onError: (e) => toast.error(errMsg(e, 'Could not save your email preferences.')),
  });

  const value = draft || settingsQuery.data || DEFAULT_NOTIFICATION_SETTINGS;
  const base = settingsQuery.data || DEFAULT_NOTIFICATION_SETTINGS;
  const dirty = EMAIL_KEYS.some((k) => value[k] !== base[k]);

  return (
    <SettingsCard id="email" title="Email preferences" description="Which of these updates you also receive by email.">
      {settingsQuery.isLoading ? (
        <RowsSkeleton rows={4} height="h-12" />
      ) : settingsQuery.isError ? (
        <ErrorState title="Preferences unavailable" error={settingsQuery.error} retry={() => void settingsQuery.refetch()} />
      ) : (
        <>
          <div className="divide-y divide-line">
            {EMAIL_KEYS.map((key) => (
              <ToggleRow
                key={key}
                title={NOTIFICATION_LABELS[key].title}
                hint={NOTIFICATION_LABELS[key].hint}
                checked={value[key]}
                disabled={save.isPending}
                onChange={(checked) => setDraft({ ...value, [key]: checked })}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-text-3">{dirty ? 'You have unsaved changes.' : 'Up to date.'}</p>
            <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(value)}>
              Save email preferences
            </Button>
          </div>
        </>
      )}
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ about / legal */

const ABOUT_LINKS: Array<{ label: string; hint: string; icon: ReactNode; to?: string; href?: string }> = [
  { label: 'Contact support', hint: 'Report a problem or ask a question.', icon: <LifeBuoy size={20} />, to: '/support' },
  { label: 'Privacy policy', hint: 'What we collect and why.', icon: <Shield size={20} />, href: '/privacy-policy.html' },
  { label: 'Terms and conditions', hint: 'The rules of the road.', icon: <FileText size={20} />, href: '/terms-and-conditions.html' },
];

function AboutSection() {
  const rowCls =
    'flex min-h-14 items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors dur-1 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px]';
  return (
    <SettingsCard id="about" title="Help and legal" padded={false}>
      <ul className="divide-y divide-line">
        {ABOUT_LINKS.map((l) => {
          const body = (
            <>
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-text-2">{l.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text-1">{l.label}</span>
                <span className="block text-xs text-text-2">{l.hint}</span>
              </span>
              {l.href ? <ExternalLink size={18} className="shrink-0 text-text-3" /> : <ChevronRight size={18} className="shrink-0 text-text-3" />}
            </>
          );
          return (
            <li key={l.label}>
              {l.to ? (
                <Link to={l.to} viewTransition className={rowCls}>
                  {body}
                </Link>
              ) : (
                <a href={l.href} className={rowCls}>
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ danger zone */

function DangerZone() {
  const toast = useToast();
  const logout = useAuth((s) => s.logout);
  const [phrase, setPhrase] = useState('');
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete('/users/me');
    },
    onSuccess: () => {
      setConfirming(false);
      toast.success('Your account has been permanently deleted.');
      setTimeout(() => logout(), 800);
    },
    onError: (e) => {
      setConfirming(false);
      toast.error(errMsg(e, 'Could not delete your account.'));
    },
  });

  const ready = phrase === DELETE_PHRASE;

  return (
    <SettingsCard
      id="delete"
      title="Delete account"
      titleClassName="text-danger"
      className="border-danger/40"
      description="This permanently deletes your profile, posts, comments, workouts and meals. It cannot be undone."
    >
      <div className="space-y-3">
        <Input
          id="del-phrase"
          label={`Type ${DELETE_PHRASE} to confirm`}
          hint="Case-sensitive. The button unlocks once the phrase matches."
          value={phrase}
          placeholder={DELETE_PHRASE}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setPhrase(e.target.value)}
        />
        <div className="flex justify-end">
          <Button variant="danger" disabled={!ready} loading={remove.isPending} onClick={() => setConfirming(true)}>
            Permanently delete my account
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete your account?"
        message="Everything you have posted, logged and saved on Vybe will be removed for good. There is no recovery."
        confirmLabel="Delete account"
        cancelLabel="Keep my account"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ page */

export default function Settings() {
  const logout = useAuth((s) => s.logout);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Account, appearance, notifications and privacy."
        actions={
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => logout()}>
            Sign out
          </Button>
        }
        mobileActions={
          <IconButton label="Sign out" onClick={() => logout()}>
            <LogOut size={22} />
          </IconButton>
        }
      />
      <div className="w-full max-w-form space-y-4">
        <AccountSection />
        <AppearanceSection />
        <PasswordSection />
        <NotificationsSection />
        <EmailPreferencesSection />
        <AboutSection />
        <DangerZone />
      </div>
    </>
  );
}
