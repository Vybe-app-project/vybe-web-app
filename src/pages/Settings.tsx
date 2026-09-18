import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, fieldErrorsOf, tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTING_KEYS,
  displayName,
  isPasswordValid,
  passwordRules,
  pickNotificationSettings,
  usernameError,
  type NotificationSettingKey,
  type NotificationSettings,
  type PublicUser,
} from '../lib/hooks';
import {
  Avatar,
  MAX_CREDENTIAL_URLS,
  MAX_TRAINER_FIELDS,
  SUMMARY_MAX,
  SUMMARY_MIN,
  TRAINER_FIELDS,
  parseCredentialUrls,
  statusCopy,
  validateTrainerApplication,
  type TrainerApplicationErrors,
  type TrainerApplicationStatus,
} from '../lib/trainerApplication';
import {
  Badge,
  Button,
  Callout,
  Card,
  Chip,
  ConfirmDialog,
  ErrorState,
  IconButton,
  Input,
  PageHeader,
  Skeleton,
  SkeletonRow,
  Switch,
  Textarea,
  ThemeControl,
  cx,
  useToast,
} from './ui';
import { UnitsControl } from '../components/UnitsControl';
import { Award, ChevronRight, ExternalLink, FileText, LifeBuoy, Lock, LogOut, Shield } from './icons';
import { ROW_LINK } from './UserRow';
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
    <Card id={id} role="region" aria-labelledby={`${id}-title`} className={cx('scroll-mt-20', className)} padded={padded}>
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
      const field = fieldErrorsOf(e);
      // "Username is already taken" belongs under the field, with focus
      // there; a toast alone left the input looking valid.
      if (field.username || /username/i.test(message)) {
        setErrors((x) => ({ ...x, username: field.username || message }));
        document.getElementById('set-username')?.focus();
        return;
      }
      if (field.fullName) {
        setErrors((x) => ({ ...x, fullName: field.fullName }));
        document.getElementById('set-name')?.focus();
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

/* ------------------------------------------------------------------ coaching */

type TrainerApplicationResponse = {
  application: {
    status: TrainerApplicationStatus;
    fields: string[];
    experienceSummary: string;
    credentialUrls: string[];
    submittedAt?: string | null;
    reviewedAt?: string | null;
    decisionNote?: string;
  };
  isTrainer: boolean;
};

const STATUS_TONE: Record<TrainerApplicationStatus, 'neutral' | 'warning' | 'success' | 'danger'> = {
  none: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

/**
 * The same two-step coach application the phone has: specialties, an
 * experience summary and optional credential links, plus the review status.
 * Web-only members had no way into the coach directory before this.
 */
function CoachingSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const setUser = useAuth((s) => s.setUser);
  const [fields, setFields] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [links, setLinks] = useState('');
  const [errors, setErrors] = useState<TrainerApplicationErrors>({});
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const application = useQuery({
    queryKey: ['trainer-application'],
    queryFn: async () => {
      const { data } = await api.get<TrainerApplicationResponse>('/auth/trainer-application');
      return data;
    },
  });

  const status: TrainerApplicationStatus = application.data?.application.status ?? 'none';
  const seedKey = application.data ? `${status}:${application.data.application.submittedAt ?? ''}` : null;
  useEffect(() => {
    if (!application.data || hydratedFor === seedKey) return;
    setFields(application.data.application.fields ?? []);
    setSummary(application.data.application.experienceSummary ?? '');
    setLinks((application.data.application.credentialUrls ?? []).join('\n'));
    setHydratedFor(seedKey);
  }, [application.data, hydratedFor, seedKey]);

  const submit = useMutation({
    mutationFn: async () => {
      const credentialUrls = parseCredentialUrls(links);
      const next = validateTrainerApplication({ fields, experienceSummary: summary, credentialUrls });
      setErrors(next);
      if (Object.keys(next).length) throw Object.assign(new Error('Check the highlighted fields.'), { silent: true });
      const { data } = await api.post<{ application: TrainerApplicationResponse['application']; user?: PublicUser }>('/auth/becomeTrainer', {
        fields,
        experienceSummary: summary.trim(),
        credentialUrls,
      });
      return data;
    },
    onSuccess: (data) => {
      toast.success('Application sent. We will review it and let you know.');
      setEditing(false);
      qc.setQueryData<TrainerApplicationResponse>(['trainer-application'], (old) => ({
        application: data.application,
        isTrainer: old?.isTrainer ?? false,
      }));
      qc.invalidateQueries({ queryKey: ['trainer-application'] });
      if (data.user) setUser(data.user as any);
    },
    onError: (e) => {
      if ((e as { silent?: boolean })?.silent) {
        toast.error('Check the highlighted fields.', undefined, { key: 'coaching-validation' });
        return;
      }
      toast.error(errMsg(e, 'Could not send your application.'));
    },
  });

  const toggleField = (value: string) => {
    setFields((current) => {
      if (current.includes(value)) return current.filter((f) => f !== value);
      if (current.length >= MAX_TRAINER_FIELDS) {
        toast.info(`Up to ${MAX_TRAINER_FIELDS} specialties.`, { key: 'coaching-fields' });
        return current;
      }
      return [...current, value];
    });
    if (errors.fields) setErrors((x) => ({ ...x, fields: undefined }));
  };

  if (application.isLoading) {
    return (
      <SettingsCard id="coaching" title="Coaching">
        <RowsSkeleton rows={3} />
      </SettingsCard>
    );
  }
  if (application.isError) {
    return (
      <SettingsCard id="coaching" title="Coaching">
        <ErrorState title="Could not load your coach application" error={application.error} retry={() => void application.refetch()} />
      </SettingsCard>
    );
  }

  const copy = statusCopy(status);
  const showForm = status === 'none' || status === 'rejected' || editing;
  const summaryLength = summary.trim().length;
  const decisionNote = application.data?.application.decisionNote;

  return (
    <SettingsCard id="coaching" title="Coaching" description="Coach on Vybe: a badge on your profile and a place in the coach directory.">
      <div className="space-y-4">
        <Callout
          tone={status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : status === 'pending' ? 'warning' : 'brand'}
          icon={<Award size={20} className={status === 'approved' ? 'text-success' : 'text-brand'} />}
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              {copy.title}
              {status !== 'none' ? <Badge tone={STATUS_TONE[status]}>{status === 'pending' ? 'Pending' : status === 'approved' ? 'Approved' : 'Not approved'}</Badge> : null}
            </span>
          }
          action={
            status === 'pending' && !editing ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Update
              </Button>
            ) : undefined
          }
        >
          {copy.body}
          {status === 'rejected' && decisionNote ? <span className="mt-1 block font-medium text-text-1">Reviewer note: {decisionNote}</span> : null}
        </Callout>

        {status === 'approved' && application.data?.application.fields.length ? (
          <div>
            <p className="type-label mb-1.5 text-text-2">Your specialties</p>
            <ul className="flex flex-wrap gap-1.5" aria-label="Coaching specialties">
              {application.data.application.fields.map((f) => (
                <li key={f}>
                  <Badge tone="info">{TRAINER_FIELDS.find((t) => t.value === f)?.label ?? f}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {showForm ? (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <fieldset>
              <legend className="type-label mb-1.5 text-text-2">Specialties</legend>
              <p id="coaching-fields-hint" className="mb-2 text-xs text-text-3">
                Pick up to {MAX_TRAINER_FIELDS}. {fields.length ? `${fields.length} selected.` : ''}
              </p>
              <ul className="flex flex-wrap gap-1.5" aria-describedby="coaching-fields-hint">
                {TRAINER_FIELDS.map((f) => {
                  const selected = fields.includes(f.value);
                  return (
                    <li key={f.value}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        onClick={() => toggleField(f.value)}
                        className={cx(
                          'relative inline-flex h-9 items-center gap-1.5 rounded-xs px-3 text-xs font-semibold transition-colors dur-1',
                          'before:absolute before:-inset-1 before:content-[""]',
                          selected ? 'bg-brand-soft text-brand-text' : 'border border-line bg-surface-2 text-text-2 hover:text-text-1',
                        )}
                      >
                        {f.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {errors.fields ? (
                <p role="alert" className="mt-1.5 text-xs text-danger">
                  {errors.fields}
                </p>
              ) : null}
            </fieldset>
            <Textarea
              id="coaching-summary"
              label="Experience summary"
              rows={4}
              autoGrow
              maxLength={SUMMARY_MAX}
              placeholder="Certifications, years coaching, who you work with and how."
              hint={`${summaryLength}/${SUMMARY_MAX} characters${summaryLength < SUMMARY_MIN ? ` · at least ${SUMMARY_MIN}` : ''}`}
              error={errors.experienceSummary}
              value={summary}
              onChange={(e) => {
                setSummary(e.target.value);
                if (errors.experienceSummary) setErrors((x) => ({ ...x, experienceSummary: undefined }));
              }}
            />
            <Textarea
              id="coaching-links"
              label="Credential links"
              rows={2}
              autoGrow
              placeholder={'https://…\nOne per line, up to ' + MAX_CREDENTIAL_URLS}
              hint={`Optional. Up to ${MAX_CREDENTIAL_URLS} https:// links to certificates or a coaching page.`}
              error={errors.credentialUrls}
              value={links}
              onChange={(e) => {
                setLinks(e.target.value);
                if (errors.credentialUrls) setErrors((x) => ({ ...x, credentialUrls: undefined }));
              }}
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {editing ? (
                <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={submit.isPending}>
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" variant="primary" loading={submit.isPending} icon={<Award size={18} />}>
                {status === 'none' ? 'Apply to coach' : 'Resubmit application'}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
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

/* ------------------------------------------------------------------ units */

function UnitsSection() {
  return (
    <SettingsCard
      id="units"
      title="Units"
      description="Weight, height and hydration are shown in these units everywhere on the web. Your saved goals are not changed."
    >
      <UnitsControl />
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

/* ------------------------------------------------------------------ privacy */

function useMe() {
  const authUser = useAuth((s) => s.user);
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await api.get('/users/me');
      return (data.user || data) as PublicUser;
    },
    initialData: (authUser as PublicUser) ?? undefined,
  });
}

/**
 * Account privacy. The mobile app has had this switch since launch; on the web
 * the only way to go private was a raw API call, and the Friends page's
 * "Privacy settings" call to action landed on a page without it.
 */
function PrivacySection() {
  const setUser = useAuth((s) => s.setUser);
  const qc = useQueryClient();
  const toast = useToast();
  const meQuery = useMe();
  const isPrivate = meQuery.data?.settings?.privacy === 'private';

  const save = useMutation({
    mutationFn: async (nextPrivate: boolean) => {
      const { data } = await api.put('/users/settings', { privacy: nextPrivate ? 'private' : 'public' });
      return (data.user || data) as PublicUser;
    },
    onMutate: (nextPrivate) => {
      const previous = meQuery.data;
      if (previous) {
        qc.setQueryData(['me'], { ...previous, settings: { ...previous.settings, privacy: nextPrivate ? 'private' : 'public' } });
      }
      return previous;
    },
    onSuccess: (user, nextPrivate) => {
      setUser(user as any);
      qc.setQueryData(['me'], user);
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['followRequests'] });
      toast.success(nextPrivate ? 'Your account is now private' : 'Your account is now public');
    },
    onError: (e, _next, previous) => {
      if (previous) qc.setQueryData(['me'], previous);
      toast.error(errMsg(e, 'Could not update your privacy setting.'));
    },
  });

  return (
    <SettingsCard
      id="privacy"
      title="Privacy"
      description="Who can see what you share."
    >
      {meQuery.isLoading && !meQuery.data ? (
        <RowsSkeleton rows={1} height="h-12" />
      ) : (
        <>
          <ToggleRow
            title="Private account"
            hint="Only approved followers see your posts, workouts and meals. New followers must ask first."
            checked={isPrivate}
            disabled={save.isPending || !meQuery.data}
            onChange={(checked) => save.mutate(checked)}
          />
          <p className="mt-2 flex items-start gap-2 text-xs text-text-3">
            <Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {isPrivate
                ? 'People who already follow you keep access. Requests wait for you under Friends › Follow requests.'
                : 'Anyone on Vybe can see your profile and follow you without asking.'}
              {' '}
              <Link to="/friends?tab=follows" viewTransition className="font-semibold text-text-2 hover:underline">
                Follow requests
              </Link>
            </span>
          </p>
        </>
      )}
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ blocked accounts */

/**
 * The way back from a block. Blocking removed every trace of the person
 * (profile 404, hidden from search), so without this list a block could not
 * be undone from the app at all.
 */
function BlockedAccountsSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const blocked = useQuery({
    queryKey: ['blocked'],
    queryFn: async () => {
      const { data } = await api.get('/users/blocked');
      return (data.users || []) as PublicUser[];
    },
  });

  const unblock = useMutation({
    mutationFn: async (user: PublicUser) => {
      await api.post('/users/unblock', { userId: user._id });
      return user;
    },
    onMutate: (user) => {
      const previous = blocked.data;
      qc.setQueryData<PublicUser[]>(['blocked'], (list) => (list || []).filter((u) => u._id !== user._id));
      return previous;
    },
    onSuccess: (user) => {
      toast.success(`${displayName(user)} unblocked`);
      qc.invalidateQueries({ queryKey: ['blocked'] });
      qc.invalidateQueries({ queryKey: ['user', user._id] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['search'] });
    },
    onError: (e, _user, previous) => {
      if (previous) qc.setQueryData(['blocked'], previous);
      toast.error(errMsg(e, 'Could not unblock this account.'));
    },
  });

  return (
    <SettingsCard
      id="blocked"
      title="Blocked accounts"
      description="People you have blocked cannot see your profile or message you, and you will not see them. Unblocking does not restore a follow or friendship."
      padded={false}
    >
      {blocked.isLoading ? (
        <div className="space-y-1 px-2 pb-2" aria-busy="true">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : blocked.isError ? (
        <ErrorState title="Blocked accounts unavailable" error={blocked.error} retry={() => void blocked.refetch()} className="py-6" />
      ) : !blocked.data?.length ? (
        <p className="px-3 pb-3 text-sm text-text-2">You haven’t blocked anyone. Block someone from the ⋯ menu on their profile.</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Blocked accounts">
          {blocked.data.map((u) => (
            <li key={u._id} className="flex min-h-16 items-center gap-3 px-3 py-2.5 sm:px-4">
              <Avatar src={u.avatar} name={displayName(u)} size={44} />
              <div className="min-w-0 flex-1">
                <p className={cx(ROW_LINK, 'hover:no-underline')}>{displayName(u)}</p>
                <p className="truncate text-xs text-text-2">@{u.username}</p>
              </div>
              <Button
                variant="secondary"
                loading={unblock.isPending && unblock.variables?._id === u._id}
                disabled={unblock.isPending}
                onClick={() => unblock.mutate(u)}
                aria-label={`Unblock ${displayName(u)}`}
              >
                Unblock
              </Button>
            </li>
          ))}
        </ul>
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
  const { hash } = useLocation();

  // Deep links such as /settings#privacy (from the Friends page) scroll the
  // card into view and move focus to it once the sections have rendered.
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (!id) return;
    const t = window.setTimeout(() => {
      const card = document.getElementById(`${id}-title`)?.closest('[role="region"]') as HTMLElement | null;
      if (!card) return;
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      card.setAttribute('tabindex', '-1');
      card.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [hash]);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Account, appearance, units, notifications and privacy."
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
        <PrivacySection />
        <CoachingSection />
        <AppearanceSection />
        <UnitsSection />
        <PasswordSection />
        <NotificationsSection />
        <EmailPreferencesSection />
        <BlockedAccountsSection />
        <AboutSection />
        <DangerZone />
      </div>
    </>
  );
}
