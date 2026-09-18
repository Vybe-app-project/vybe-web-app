import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  DEFAULT_EMAIL_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
  EMAIL_SETTING_KEYS,
  NOTIFICATION_SETTING_KEYS,
  displayName,
  isPasswordValid,
  passwordRules,
  pickEmailSettings,
  pickNotificationSettings,
  usernameError,
  type EmailSettingKey,
  type EmailSettings,
  type NotificationSettingKey,
  type NotificationSettings,
  type PublicUser,
} from '../lib/hooks';
import {
  Avatar,
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
import { ChevronRight, ExternalLink, FileText, LifeBuoy, Lock, LogOut, Monitor, Shield } from './icons';
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
    onError: (e) => {
      const message = errMsg(e, 'Could not save your account details.');
      // A username conflict belongs under the field, like the length rule,
      // where it stays visible; a toast is gone before a phone user has read it.
      if (/username/i.test(message)) {
        setErrors((x) => ({ ...x, username: message }));
        document.getElementById('set-username')?.focus();
        return;
      }
      toast.error(message);
    },
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

const NOTIFICATION_SETTINGS_KEY = ['notification-settings'] as const;

function useNotificationSettings() {
  return useQuery({
    queryKey: NOTIFICATION_SETTINGS_KEY,
    queryFn: async () => {
      const { data } = await api.get('/notifications/settings');
      return pickNotificationSettings(data.settings || data);
    },
  });
}

/**
 * Push preferences. Every switch reads from and writes to the shared query:
 * there is no per-card draft, and a save sends only the key that changed, so
 * nothing here can replay a stale value over another card's work.
 */
function NotificationsSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const settingsQuery = useNotificationSettings();

  const save = useMutation({
    mutationFn: async (patch: Partial<NotificationSettings>) => {
      const { data } = await api.put('/notifications/settings', patch);
      return pickNotificationSettings(data.settings || { ...settingsQuery.data, ...patch });
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: NOTIFICATION_SETTINGS_KEY });
      const previous = qc.getQueryData<NotificationSettings>(NOTIFICATION_SETTINGS_KEY);
      qc.setQueryData<NotificationSettings>(NOTIFICATION_SETTINGS_KEY, (old) => ({ ...(old ?? DEFAULT_NOTIFICATION_SETTINGS), ...patch }));
      return { previous };
    },
    onSuccess: (settings) => qc.setQueryData(NOTIFICATION_SETTINGS_KEY, settings),
    onError: (e, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(NOTIFICATION_SETTINGS_KEY, ctx.previous);
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

  const value = settingsQuery.data || DEFAULT_NOTIFICATION_SETTINGS;
  const paused = value.pauseAll === true;
  const rest = NOTIFICATION_SETTING_KEYS.filter((k) => k !== 'pauseAll');

  return (
    <SettingsCard id="notifications" title="Notifications" description="Choose what Vybe is allowed to notify you about. Changes save automatically.">
      <ToggleRow
        title={NOTIFICATION_LABELS.pauseAll.title}
        hint={NOTIFICATION_LABELS.pauseAll.hint}
        checked={paused}
        disabled={save.isPending}
        onChange={(checked) => save.mutate({ pauseAll: checked })}
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
            onChange={(checked) => save.mutate({ [key]: checked } as Partial<NotificationSettings>)}
          />
        ))}
      </div>
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ email */

const EMAIL_SETTINGS_KEY = ['email-preferences'] as const;

/**
 * Email is its own store on the API (settings.emailNotifications). Until it
 * was, this card wrote the push object with every key from a draft taken at
 * page load, so "Save email preferences" silently flipped push switches back.
 * The draft here holds only the keys the user touched.
 */
function EmailPreferencesSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Partial<EmailSettings>>({});

  const settingsQuery = useQuery({
    queryKey: EMAIL_SETTINGS_KEY,
    queryFn: async () => {
      const { data } = await api.get('/users/email-preferences');
      return pickEmailSettings(data.settings || data);
    },
  });

  const base = settingsQuery.data || DEFAULT_EMAIL_SETTINGS;
  const value: EmailSettings = { ...base, ...draft };
  const changed = Object.fromEntries(
    EMAIL_SETTING_KEYS.filter((k) => value[k] !== base[k]).map((k) => [k, value[k]]),
  ) as Partial<EmailSettings>;
  const dirty = Object.keys(changed).length > 0;

  const save = useMutation({
    mutationFn: async (patch: Partial<EmailSettings>) => {
      const { data } = await api.put('/users/email-preferences', { notifications: patch });
      return pickEmailSettings(data.settings || { ...base, ...patch });
    },
    onSuccess: (settings) => {
      qc.setQueryData(EMAIL_SETTINGS_KEY, settings);
      setDraft({});
      toast.success('Email preferences saved');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save your email preferences.')),
  });

  return (
    <SettingsCard id="email" title="Email preferences" description="Which of these updates you also receive by email. Separate from push notifications.">
      {settingsQuery.isLoading ? (
        <RowsSkeleton rows={4} height="h-12" />
      ) : settingsQuery.isError ? (
        <ErrorState title="Preferences unavailable" error={settingsQuery.error} retry={() => void settingsQuery.refetch()} />
      ) : (
        <>
          <div className="divide-y divide-line">
            {EMAIL_SETTING_KEYS.map((key: EmailSettingKey) => (
              <ToggleRow
                key={key}
                title={NOTIFICATION_LABELS[key].title}
                hint={NOTIFICATION_LABELS[key].hint}
                checked={value[key]}
                disabled={save.isPending}
                onChange={(checked) => setDraft((d) => ({ ...d, [key]: checked }))}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-text-3" aria-live="polite">
              {dirty ? 'You have unsaved changes.' : 'Up to date.'}
            </p>
            <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(changed)}>
              Save email preferences
            </Button>
          </div>
        </>
      )}
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ privacy */

type BlockedUser = Pick<PublicUser, '_id' | 'username' | 'fullName' | 'avatar'>;

/**
 * Account privacy, which the page subtitle promised and the mobile app has had
 * all along. The switch mirrors mobile's Account privacy screen and writes
 * PUT /users/settings { privacy }; the list underneath is GET /users/blocked.
 */
function PrivacySection() {
  const toast = useToast();
  const qc = useQueryClient();
  const authUser = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await api.get('/users/me');
      return (data.user || data) as PublicUser;
    },
    initialData: (authUser as PublicUser) ?? undefined,
  });
  const isPrivate = meQuery.data?.settings?.privacy === 'private';

  const savePrivacy = useMutation({
    mutationFn: async (privacy: 'public' | 'private') => {
      const { data } = await api.put('/users/settings', { privacy });
      return (data.user || data) as PublicUser;
    },
    onMutate: async (privacy) => {
      await qc.cancelQueries({ queryKey: ['me'] });
      const previous = qc.getQueryData<PublicUser>(['me']);
      qc.setQueryData<PublicUser>(['me'], (old) => (old ? { ...old, settings: { ...(old.settings ?? {}), privacy } } : old));
      return { previous };
    },
    onSuccess: (user) => {
      qc.setQueryData(['me'], user);
      setUser(user as any);
      toast.success(user.settings?.privacy === 'private' ? 'Your account is now private' : 'Your account is now public');
    },
    onError: (e, _privacy, ctx) => {
      if (ctx?.previous) qc.setQueryData(['me'], ctx.previous);
      toast.error(errMsg(e, 'Could not update your privacy setting.'));
    },
  });

  const blockedQuery = useQuery({
    queryKey: ['blocked-users'],
    queryFn: async () => {
      const { data } = await api.get('/users/blocked');
      return (data.users || []) as BlockedUser[];
    },
  });

  const unblock = useMutation({
    mutationFn: async (userId: string) => {
      await api.post('/users/unblock', { userId });
    },
    onMutate: async (userId) => {
      await qc.cancelQueries({ queryKey: ['blocked-users'] });
      const previous = qc.getQueryData<BlockedUser[]>(['blocked-users']);
      qc.setQueryData<BlockedUser[]>(['blocked-users'], (old) => (old ?? []).filter((u) => u._id !== userId));
      return { previous };
    },
    onSuccess: () => toast.success('Unblocked'),
    onError: (e, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(['blocked-users'], ctx.previous);
      toast.error(errMsg(e, 'Could not unblock this account.'));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['blocked-users'] }),
  });

  return (
    <SettingsCard id="privacy" title="Privacy" description="Who can see what you share and who cannot reach you at all.">
      <ToggleRow
        title="Private account"
        hint={isPrivate ? 'Only followers you approve can see your posts, workouts and meals.' : 'Anyone on Vybe can see your posts, workouts and meals.'}
        checked={isPrivate}
        disabled={savePrivacy.isPending || !meQuery.data}
        onChange={(checked) => savePrivacy.mutate(checked ? 'private' : 'public')}
      />
      <div className="mt-2 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-text-1">Blocked accounts</h3>
        <p className="text-xs text-text-2">Blocked accounts cannot follow, message or find you. You can unblock them here.</p>
        <div className="mt-3">
          {blockedQuery.isLoading ? (
            <RowsSkeleton rows={2} />
          ) : blockedQuery.isError ? (
            <ErrorState title="Could not load blocked accounts" error={blockedQuery.error} retry={() => void blockedQuery.refetch()} />
          ) : blockedQuery.data && blockedQuery.data.length > 0 ? (
            <ul className="divide-y divide-line" aria-label="Blocked accounts">
              {blockedQuery.data.map((u) => (
                <li key={u._id} className="flex min-h-14 items-center gap-3 py-2">
                  <Avatar src={u.avatar} name={displayName(u as PublicUser)} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text-1">{displayName(u as PublicUser)}</span>
                    <span className="block truncate text-xs text-text-2">@{u.username}</span>
                  </span>
                  <Button variant="secondary" size="sm" disabled={unblock.isPending} onClick={() => unblock.mutate(u._id)} aria-label={`Unblock ${displayName(u as PublicUser)}`}>
                    Unblock
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-sm bg-surface-2 px-3 py-3 text-sm text-text-2">You haven’t blocked anyone. Block someone from the menu on their profile.</p>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ sessions */

/**
 * "Sign out" at the top of the page ends this device only (POST /auth/logout
 * revokes the presenting session). Ending every session is a different,
 * deliberate action, so it lives here behind a confirmation.
 */
function SessionsSection() {
  const logoutEverywhere = useAuth((s) => s.logoutEverywhere);
  const [confirming, setConfirming] = useState(false);
  return (
    <SettingsCard id="sessions" title="Devices" description="Signing out from the top of this page only signs out this device.">
      <div className="flex min-h-11 flex-wrap items-center gap-4 py-2">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-text-2">
          <Monitor size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-1">Sign out of all devices</p>
          <p className="text-xs text-text-2">Ends every session on every phone, tablet and computer, including this one. Use it if you left yourself signed in somewhere.</p>
        </div>
        <Button variant="secondary" icon={<Lock size={18} />} onClick={() => setConfirming(true)}>
          Sign out everywhere
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Sign out of all devices?"
        message="Every device signed in to your account will be signed out, including this one. You can sign back in straight away."
        confirmLabel="Sign out everywhere"
        cancelLabel="Keep me signed in"
        destructive
        onConfirm={() => logoutEverywhere()}
        onCancel={() => setConfirming(false)}
      />
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
        <PrivacySection />
        <PasswordSection />
        <SessionsSection />
        <NotificationsSection />
        <EmailPreferencesSection />
        <AboutSection />
        <DangerZone />
      </div>
    </>
  );
}
