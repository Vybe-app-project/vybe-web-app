import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, fieldErrorsOf, tokenStore } from '../lib/api';
import { UnitsControl } from '../components/UnitsControl';
import { VersionRow } from '../components/VersionRow';
import { PlaceImage } from '../components/PlaceImage';
import { compactMetaLine } from '../components/GymHeader';
import { communityPath } from '../lib/gyms';
import { HOME_GYM_KEY, useHomeGym, useSetHomeGym } from '../lib/homeGym';
import AccountPreferenceSections from './SettingsPreferences';
import { SettingsCard, ToggleRow } from './SettingsPieces';
import {
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
import { useAuth } from '../lib/auth';
import {
  EMPTY_NOTIFICATION_SETTINGS_RESPONSE,
  NOTIFICATION_LABELS,
  NOTIFICATION_SETTING_GROUPS,
  displayName,
  isPasswordValid,
  passwordRules,
  pickNotificationSettingsResponse,
  usernameError,
  type NotificationSettings,
  type NotificationSettingsResponse,
  type PublicUser,
} from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Chip,
  ConfirmDialog,
  ErrorState,
  IconButton,
  Input,
  NO_GYM_COPY,
  PageHeader,
  ScrollX,
  Skeleton,
  Textarea,
  ThemeControl,
  cx,
  useMediaQuery,
  useToast,
} from './ui';
import type { IconComponent } from './icons';
import { Award, Bell, ChevronRight, ExternalLink, FileText, Info, LifeBuoy, Lock, LogOut, MapPin, Monitor, Palette, Shield, User as UserIcon } from './icons';
import { PasswordField } from './Login';
import { PasswordRules } from './Register';
import { DataLifecycleSection } from './settings/DataLifecycleSection';
import { EmailPreferencesSection } from './settings/EmailPreferencesSection';
import { HydrationTimesEditor } from './settings/HydrationTimesEditor';
import { LegalSection } from './settings/LegalSection';
import InviteCodeSection from './settings/InviteCodeSection';
import InviteFriendsSection from './settings/InviteFriendsSection';

/* ------------------------------------------------------------------ pieces */

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
      <SettingsCard id="account" title="Account" titleHidden>
        <RowsSkeleton rows={3} />
      </SettingsCard>
    );
  }

  if (meQuery.isError && !meQuery.data) {
    return (
      <SettingsCard id="account" title="Account" titleHidden>
        <ErrorState title="Could not load your account" error={meQuery.error} retry={() => void meQuery.refetch()} />
      </SettingsCard>
    );
  }

  return (
    <SettingsCard id="account" title="Account" titleHidden description="Your public identity across Vybe.">
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

/* ------------------------------------------------------------------ home gym */

/** The one blue control on a settings row: a text button in the brand colour, 44 px tall. */
const ROW_ACTION = 'pressable -mr-2 inline-flex min-h-11 shrink-0 items-center rounded-sm px-2 text-sm font-semibold text-brand disabled:opacity-60';

/**
 * The gym the whole app anchors to, as one settings row: thumb · name ·
 * Change. It reads the shell's `useHomeGym()` (one fetch for the whole app
 * under ['home-gym']) and writes through `useSetHomeGym()`, so Home, the gym
 * pages and this row never disagree. No gym set — the common case today — is
 * a single "Find your gym" row, not an illustration. A community the viewer
 * belongs to but has not chosen is offered with "Set as home".
 */
function HomeGymSection() {
  const { gym, community, provisional, source, loading, error } = useHomeGym();
  const setHomeGym = useSetHomeGym();
  const qc = useQueryClient();
  const toast = useToast();

  const adopt = () => {
    if (!community) return;
    setHomeGym.mutate(
      { community: String(community._id) },
      {
        onSuccess: () => toast.success('Home gym set'),
        onError: (e) => toast.error(fieldErrorsOf(e).homeGym || errMsg(e, 'Could not update your home gym.')),
      },
    );
  };

  /** Clearing is the counterpart to Change; without it a home gym can never be unset. */
  const clearHomeGym = () => {
    if (setHomeGym.isPending) return;
    setHomeGym.mutate(null, {
      onSuccess: () => toast.success('Home gym cleared'),
      onError: (e) => toast.error(fieldErrorsOf(e).homeGym || errMsg(e, 'Could not clear your home gym.')),
    });
  };

  let row: ReactNode;
  if (loading) {
    // The account points at a gym whose details are still loading: the same 56 px row, as a skeleton.
    row = (
      <div className="flex min-h-14 items-center gap-3" aria-busy="true" aria-label="Loading your home gym">
        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-36 max-w-full" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-4 w-12" />
      </div>
    );
  } else if (gym) {
    const href = community ? communityPath(String(community._id)) : null;
    const meta = compactMetaLine(gym) ?? (source === 'place' ? 'Not a Vybe community yet' : null);
    const name = <span className="t-name block truncate text-text-1">{gym.name}</span>;
    row = (
      <div className="flex min-h-14 items-center gap-3">
        <PlaceImage src={gym.photoUrl ?? null} name={gym.name} className="h-10 w-10 rounded-full" textClassName="text-xs" />
        <div className="min-w-0 flex-1">
          {href ? (
            <Link to={href} viewTransition className="block rounded-xs hover:underline">
              {name}
            </Link>
          ) : (
            name
          )}
          {meta ? <p className="t-meta truncate">{meta}</p> : null}
        </div>
        {provisional && community ? (
          <button type="button" onClick={adopt} disabled={setHomeGym.isPending} aria-label={`Make ${gym.name} your home gym`} className={ROW_ACTION}>
            Set as home
          </button>
        ) : (
          <>
            <Link to={NO_GYM_COPY.href} viewTransition className={ROW_ACTION}>
              Change
            </Link>
            {/* Setting a home gym must be reversible: PUT /users/settings { homeGym: null }
                clears it (API.md section 1, idempotent). Quiet, because clearing is rare. */}
            <button
              type="button"
              onClick={clearHomeGym}
              disabled={setHomeGym.isPending}
              aria-label={`Clear ${gym.name} as your home gym`}
              className={cx(ROW_ACTION, 'text-text-2 hover:text-text-1')}
            >
              Clear
            </button>
          </>
        )}
      </div>
    );
  } else if (error) {
    row = (
      <button type="button" onClick={() => void qc.invalidateQueries({ queryKey: HOME_GYM_KEY })} className="pressable -mx-2 flex h-12 items-center gap-3 rounded-sm px-2 text-left">
        <span className="t-body min-w-0 flex-1 truncate text-text-2">Couldn’t load your gym.</span>
        <span className="shrink-0 text-sm font-semibold text-brand">Try again</span>
      </button>
    );
  } else {
    row = (
      <Link to={NO_GYM_COPY.href} viewTransition className="pressable -mx-2 flex h-12 items-center gap-3 rounded-sm px-2 text-text-1">
        <MapPin size={22} className="shrink-0 text-text-2" />
        <span className="t-body flex-1 truncate font-semibold">{NO_GYM_COPY.action}</span>
        <ChevronRight size={18} className="shrink-0 text-text-3" />
      </Link>
    );
  }

  return (
    <SettingsCard id="home-gym" title="Home gym" description="Home, Train and Community open on this gym and the people who train there.">
      {row}
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
      description="Weight, height and hydration are shown in these units everywhere you sign in. Your saved goals are not changed."
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

const NOTIFICATION_SETTINGS_KEY = ['notification-settings'] as const;

function useNotificationSettings() {
  return useQuery({
    queryKey: NOTIFICATION_SETTINGS_KEY,
    queryFn: async () => {
      const { data } = await api.get('/notifications/settings');
      return pickNotificationSettingsResponse(data);
    },
  });
}

/**
 * Push preferences. Every switch reads from and writes to the shared query:
 * there is no per-card draft, and a save sends only the key that changed, so
 * nothing here can replay a stale value over another card's work. The 17
 * switches under "Pause all" are grouped the way the API gates them
 * (lib/notificationSettings NOTIFICATION_SETTING_GROUPS); the water check-in
 * times under the last group have their own editor and request
 * (settings/HydrationTimesEditor.tsx) and land in the same query.
 */
function NotificationsSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const settingsQuery = useNotificationSettings();

  const save = useMutation({
    mutationFn: async (patch: Partial<NotificationSettings>) => {
      const { data } = await api.put('/notifications/settings', patch);
      return pickNotificationSettingsResponse(data);
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: NOTIFICATION_SETTINGS_KEY });
      const previous = qc.getQueryData<NotificationSettingsResponse>(NOTIFICATION_SETTINGS_KEY);
      qc.setQueryData<NotificationSettingsResponse>(NOTIFICATION_SETTINGS_KEY, (old) => {
        const base = old ?? EMPTY_NOTIFICATION_SETTINGS_RESPONSE;
        return { ...base, settings: { ...base.settings, ...patch } };
      });
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
      <SettingsCard id="notifications" title="Notifications" titleHidden>
        <RowsSkeleton rows={8} height="h-12" />
      </SettingsCard>
    );
  }

  if (settingsQuery.isError) {
    return (
      <SettingsCard id="notifications" title="Notifications" titleHidden>
        <ErrorState title="Preferences unavailable" error={settingsQuery.error} retry={() => void settingsQuery.refetch()} />
      </SettingsCard>
    );
  }

  const response = settingsQuery.data ?? EMPTY_NOTIFICATION_SETTINGS_RESPONSE;
  const value = response.settings;
  const paused = value.pauseAll === true;
  const hydrationTimes = response.hydrationReminders?.times ?? [];

  return (
    <SettingsCard id="notifications" title="Notifications" titleHidden description="Choose what Vybe is allowed to notify you about. Changes save automatically.">
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
      <div className="mt-2 space-y-3">
        {NOTIFICATION_SETTING_GROUPS.map((group) => (
          <div key={group.id} role="group" aria-labelledby={`notifications-${group.id}-title`} className="border-t border-line pt-3">
            <h3 id={`notifications-${group.id}-title`} className="type-label text-text-2">
              {group.title}
            </h3>
            <div className="divide-y divide-line">
              {group.keys.map((key) => (
                <div key={key}>
                  <ToggleRow
                    title={NOTIFICATION_LABELS[key].title}
                    hint={NOTIFICATION_LABELS[key].hint}
                    checked={value[key]}
                    disabled={save.isPending || paused}
                    onChange={(checked) => save.mutate({ [key]: checked } as Partial<NotificationSettings>)}
                  />
                  {key === 'hydration' ? (
                    <HydrationTimesEditor
                      times={hydrationTimes}
                      hydrationOn={value.hydration}
                      quietHours={response.quietHours}
                      disabled={paused || save.isPending}
                      onSaved={(next) => qc.setQueryData(NOTIFICATION_SETTINGS_KEY, next)}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
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
        <VersionRow />
      </ul>
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------ groups */

type GroupId = 'account' | 'preferences' | 'privacy' | 'notifications' | 'about';

/**
 * The five categories of the two-pane layout. `cards` lists every card id in
 * the group, so a deep link such as /settings#privacy can open the right
 * pane before it scrolls to the card. Every card keeps its id.
 */
const GROUPS: Array<{ id: GroupId; label: string; hint: string; icon: IconComponent; cards: string[] }> = [
  { id: 'account', label: 'Account', hint: 'Who you are and where you train', icon: UserIcon, cards: ['account', 'home-gym', 'invite-code', 'invites', 'coaching'] },
  { id: 'preferences', label: 'Preferences', hint: 'Appearance, units, comments, accessibility, workouts', icon: Palette, cards: ['appearance', 'units', 'comments', 'accessibility', 'workouts'] },
  { id: 'privacy', label: 'Privacy & safety', hint: 'Who can see you, your password and devices', icon: Shield, cards: ['privacy', 'password', 'sessions'] },
  { id: 'notifications', label: 'Notifications', hint: 'Push and email', icon: Bell, cards: ['notifications', 'email'] },
  { id: 'about', label: 'About & data', hint: 'Help, legal and your data', icon: Info, cards: ['about', 'legal', 'data', 'delete'] },
];

const groupDomId = (id: GroupId) => `settings-group-${id}`;
const groupOfCard = (cardId: string): GroupId | null => GROUPS.find((g) => g.cards.includes(cardId))?.id ?? null;
const isGroupId = (v: string): v is GroupId => GROUPS.some((g) => g.id === v);

/** The cards of one group, in the order they read on the phone. */
function GroupCards({ id }: { id: GroupId }) {
  switch (id) {
    case 'account':
      return (
        <>
          <AccountSection />
          <HomeGymSection />
          <InviteCodeSection />
          <InviteFriendsSection />
          <CoachingSection />
        </>
      );
    case 'preferences':
      return (
        <>
          <AppearanceSection />
          <UnitsSection />
          <AccountPreferenceSections />
        </>
      );
    case 'privacy':
      return (
        <>
          <PrivacySection />
          <PasswordSection />
          <SessionsSection />
        </>
      );
    case 'notifications':
      return (
        <>
          <NotificationsSection />
          <EmailPreferencesSection />
        </>
      );
    case 'about':
      return (
        <>
          <AboutSection />
          <LegalSection />
          <DataLifecycleSection />
        </>
      );
  }
}

/** Desktop: the sticky category rail on the left. */
function SettingsRail({ active, onSelect }: { active: GroupId; onSelect: (id: GroupId) => void }) {
  return (
    <nav aria-label="Settings sections" className="hidden lg:sticky lg:top-20 lg:block">
      <ul className="space-y-1">
        {GROUPS.map((g) => {
          const Icon = g.icon;
          const current = g.id === active;
          return (
            <li key={g.id}>
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                onClick={() => onSelect(g.id)}
                className={cx(
                  'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors dur-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  current ? 'bg-surface-2 text-text-1' : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
                )}
              >
                <Icon size={18} className={cx('mt-0.5 shrink-0', current ? 'text-text-1' : 'text-text-3')} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-1">{g.label}</span>
                  <span className="block text-xs leading-snug text-text-3">{g.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Phone: the category chips pinned under the top bar; a tap scrolls to the group. */
function SettingsChips({ active, onSelect }: { active: GroupId; onSelect: (id: GroupId) => void }) {
  return (
    <div className="sticky top-[calc(var(--topbar-h)+env(safe-area-inset-top))] z-20 -mx-4 bg-bg/90 px-4 py-2 backdrop-blur-xl md:-mx-6 md:px-6 lg:hidden">
      <ScrollX fade className="-my-1 py-1">
        <ul className="flex w-max gap-2" aria-label="Settings sections">
          {GROUPS.map((g) => (
            <li key={g.id}>
              <Chip selected={g.id === active} onClick={() => onSelect(g.id)}>
                {g.label}
              </Chip>
            </li>
          ))}
        </ul>
      </ScrollX>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function Settings() {
  const logout = useAuth((s) => s.logout);
  const { hash } = useLocation();
  // Two panes from lg: the rail picks the group and only that group's cards
  // mount. Below lg every group renders in one column under the chip row.
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [active, setActive] = useState<GroupId>(() => {
    const id = hash.replace(/^#/, '');
    return (isGroupId(id) ? id : groupOfCard(id)) ?? 'account';
  });

  // Deep links such as /settings#privacy (from the Friends page) open the
  // card's group, scroll the card into view and move focus to it once the
  // sections have rendered.
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (!id) return;
    const group = isGroupId(id) ? id : groupOfCard(id);
    if (group) setActive(group);
    const t = window.setTimeout(() => {
      const card = document.getElementById(`${id}-title`)?.closest('[role="region"]') as HTMLElement | null;
      if (!card) return;
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      card.setAttribute('tabindex', '-1');
      card.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [hash]);

  // Phone: the chip row follows the group under the top bar as you scroll.
  useEffect(() => {
    if (desktop || typeof IntersectionObserver === 'undefined') return;
    const sections = GROUPS.map((g) => document.getElementById(groupDomId(g.id))).filter((el): el is HTMLElement => !!el);
    if (!sections.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = hit?.target.getAttribute('data-group');
        if (id && isGroupId(id)) setActive(id);
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [desktop]);

  const jumpTo = (id: GroupId) => {
    setActive(id);
    document.getElementById(groupDomId(id))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

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
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <SettingsRail active={active} onSelect={setActive} />
        <div className="min-w-0">
          <SettingsChips active={active} onSelect={jumpTo} />
          <div className="mt-2 w-full max-w-form space-y-10 lg:mt-0 lg:space-y-0">
            {GROUPS.map((g) => {
              if (desktop && g.id !== active) return null;
              const headingId = `${groupDomId(g.id)}-title`;
              return (
                <section key={g.id} id={groupDomId(g.id)} data-group={g.id} aria-labelledby={headingId} className="scroll-mt-28 space-y-4 lg:scroll-mt-20">
                  <div className="px-1">
                    <h2 id={headingId} className="t-section text-text-1">
                      {g.label}
                    </h2>
                    <p className="t-meta mt-0.5">{g.hint}</p>
                  </div>
                  <GroupCards id={g.id} />
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
