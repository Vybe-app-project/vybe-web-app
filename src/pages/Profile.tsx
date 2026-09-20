import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, fieldErrorsOf, mediaUrl } from '../lib/api';
import { summarize } from '../lib/achievements';
import { useAuth } from '../lib/auth';
import { useFeature } from '../lib/capabilities';
import { useMyAchievements } from '../lib/useMyAchievements';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  displayName,
  followerCount,
  followingCount,
  postCount,
  uploadImage,
  usernameError,
  type PublicUser,
} from '../lib/hooks';
import {
  Avatar,
  Button,
  ButtonLink,
  Card,
  CountBadge,
  ErrorState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Spinner,
  StatStrip,
  Textarea,
  cx,
  useToast,
} from './ui';
import { Award, Calendar, Camera, ChevronRight, MapPin, Settings as SettingsIcon, ShareUp, Users } from './icons';
import { UserBadges } from './UserRow';
import { homeGymLabel, useViewerGym, viewerGymHref, type ViewerGym } from './PostCard';
import { PROFILE_TABS, ProfileMeals, ProfilePosts, ProfileSaved, ProfileWorkouts, isProfileTab, type ProfileTabKey } from './ProfileTabs';
import { HighlightsRow } from './StoryTray';

/** The shell owns the width; profile pages fill it and split in two from `xl`. */
export const PAGE = 'w-full space-y-section';

/** Identity, stats and shortcuts left; the tabs and their content right, once there is room for both. */
export const PROFILE_GRID = 'grid gap-section xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:items-start';

/** Stat values step up to `--text-stat` once the strip has the room (a container query, not a viewport guess). */
export const STAT_STRIP_CLASS = 'border-0 bg-transparent shadow-none divide-x-0 @md:[&_.type-stat]:text-stat';

const joinedLabel = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

/** A member's own cover photo, when they have one. No generated art: the header is the avatar's. */
export function ProfileCover({ src }: { src?: string }) {
  if (!src) return null;
  return (
    <div className="aspect-[3/1] w-full overflow-hidden rounded-lg bg-surface-2 sm:aspect-[4/1]">
      <img src={mediaUrl(src)} alt="" className="h-full w-full object-cover" decoding="async" />
    </div>
  );
}

/** The gym row under the handle: pin + name, a link when there is a gym page to open. */
export function GymRow({ label, href }: { label: string | null; href: string | null }) {
  if (!label) return null;
  const inner = (
    <>
      <MapPin size={14} className="shrink-0 text-text-3" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </>
  );
  const cls = 'mt-1 inline-flex min-h-8 max-w-full items-center gap-1.5 text-sm font-medium text-text-1';
  return href ? (
    <Link to={href} viewTransition className={cx(cls, 'rounded-xs hover:underline')}>
      {inner}
    </Link>
  ) : (
    <p className={cls}>{inner}</p>
  );
}

/** Own gym: the viewer's home gym as the shell resolves it. */
function ownGym(gym: ViewerGym | null): { label: string | null; href: string | null } {
  return { label: gym?.name || null, href: viewerGymHref(gym) };
}

/** Entry points to pages that live under the profile: Achievements, Progress photos, Friends. */
function ShortcutCard({
  to,
  icon,
  label,
  value,
  hint,
  loading,
  badge,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  value?: string | number | null;
  hint?: string;
  loading?: boolean;
  badge?: number;
}) {
  return (
    <Card to={to} linkLabel={label} padded={false} className="relative flex min-h-24 flex-col justify-between gap-3 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="relative grid h-9 w-9 place-items-center rounded-sm bg-surface-2 text-text-1">
          {icon}
          {badge ? <CountBadge value={badge} className="absolute -right-1.5 -top-1.5" /> : null}
        </span>
        <ChevronRight size={18} className="text-text-3" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        {loading ? (
          <Skeleton className="mb-1.5 h-6 w-12" />
        ) : (
          <span className="type-stat block text-xl leading-none text-text-1">{value ?? '—'}</span>
        )}
        <span className="mt-1 block text-xs font-semibold leading-tight text-text-2 [text-wrap:balance]">{label}</span>
        {hint ? <span className="mt-0.5 block text-2xs leading-tight text-text-3">{hint}</span> : null}
      </div>
    </Card>
  );
}

function ProfileShortcuts() {
  /*
   * Same list and key as the Achievements page (one shape under one key).
   * Under auto-award nothing is left to claim; the badge counts awards the
   * member has not yet seen instead.
   */
  const autoAward = useFeature('achievementAutoAward');
  const achievements = useMyAchievements(summarize);
  const photos = useQuery({
    queryKey: ['progress-photos', 'count'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.get('/progress-photos');
      const list = Array.isArray(data) ? data : data?.photos || [];
      const latest = list[0]?.date || list[0]?.createdAt;
      return { count: list.length, latest: latest as string | undefined };
    },
  });
  const friends = useQuery({
    queryKey: ['friends', 'list'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get('/friends/list');
      return (data.friends || []) as PublicUser[];
    },
  });
  const pending = useQuery({
    queryKey: ['friends', 'pending'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get('/friends/pending');
      return (data.requests || []) as unknown[];
    },
  });

  const photoHint = photos.data?.latest
    ? `Latest ${new Date(photos.data.latest).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : 'See how you change';
  const pendingCount = pending.data?.length || 0;

  return (
    <section aria-label="Keep going" className="grid grid-cols-3 gap-3">
      <ShortcutCard
        to="/achievements"
        icon={<Award size={20} />}
        label="Achievements"
        loading={achievements.isLoading}
        value={achievements.isError ? null : achievements.data?.earned}
        hint={
          !achievements.data
            ? undefined
            : autoAward
              ? achievements.data.newAwards
                ? `${achievements.data.newAwards} new`
                : `of ${achievements.data.total} earned`
              : achievements.data.claimable
                ? `${achievements.data.claimable} to claim`
                : `of ${achievements.data.total} earned`
        }
        badge={achievements.data ? (autoAward ? achievements.data.newAwards : achievements.data.claimable) : 0}
      />
      <ShortcutCard
        to="/health/photos"
        icon={<Camera size={20} />}
        label="Progress photos"
        loading={photos.isLoading}
        value={photos.isError ? null : photos.data?.count}
        hint={photos.isError ? undefined : photoHint}
      />
      <ShortcutCard
        to="/friends"
        icon={<Users size={20} />}
        label="Friends"
        loading={friends.isLoading}
        value={friends.isError ? null : friends.data?.length}
        hint={pendingCount ? `${pendingCount} waiting` : 'Train together'}
        badge={pendingCount}
      />
    </section>
  );
}

/** The header skeleton: avatar left, three stats right, then two text lines. */
export function ProfileHeaderSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex items-center gap-5 sm:gap-8">
        <Skeleton className="h-20 w-20 shrink-0 rounded-full sm:h-24 sm:w-24" />
        <div className="grid flex-1 grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <Skeleton className="h-6 w-10" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <Skeleton className="mt-4 h-11 w-full rounded-sm" />
    </div>
  );
}

export default function Profile() {
  const authUser = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [params, setParams] = useSearchParams();
  const gym = useViewerGym();
  const rhythm = useMyAchievements(summarize);
  const weeksKept = rhythm.data?.weeksKept?.progress ?? 0;

  const tabParam = params.get('tab');
  const tab: ProfileTabKey = isProfileTab(tabParam) ? tabParam : 'posts';
  const setTab = (next: string) => {
    setParams(
      (prev) => {
        if (next === 'posts') prev.delete('tab');
        else prev.set('tab', next);
        return prev;
      },
      { replace: true },
    );
  };

  const [editing, setEditing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await api.get('/users/me');
      return (data.user || data) as PublicUser;
    },
    initialData: (authUser as PublicUser) ?? undefined,
  });

  const me = meQuery.data;

  const [form, setForm] = useState({ fullName: '', username: '', bio: '' });
  const [errors, setErrors] = useState<{ fullName?: string; username?: string }>({});

  function openEditor() {
    setForm({
      fullName: me?.fullName || '',
      username: me?.username || '',
      bio: me?.bio || '',
    });
    setErrors({});
    setEditing(true);
  }

  const saveProfile = useMutation({
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
      qc.invalidateQueries({ queryKey: ['me'] });
      setEditing(false);
      toast.success('Profile saved');
    },
    onError: (e) => {
      const message = errMsg(e, 'Could not save your profile.');
      const field = fieldErrorsOf(e);
      // A taken or malformed handle belongs under the field, where the
      // person is looking, with focus moved there; the toast alone left the
      // input looking valid.
      if (field.username || /username/i.test(message)) {
        setErrors((er) => ({ ...er, username: field.username || message }));
        document.getElementById('pf-username')?.focus();
        return;
      }
      if (field.fullName) {
        setErrors((er) => ({ ...er, fullName: field.fullName }));
        document.getElementById('pf-name')?.focus();
        return;
      }
      toast.error(message);
    },
  });

  const saveAvatar = useMutation({
    mutationFn: async (imageKey: string) => {
      const { data } = await api.put('/users/profile-picture', { image: imageKey });
      return (data.user || data) as PublicUser;
    },
    onSuccess: (user) => {
      setUser(user as any);
      qc.setQueryData(['me'], user);
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('Profile photo updated');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not update your profile photo.')),
  });

  async function onAvatarPicked(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return toast.error('Choose a JPEG, PNG, WebP or HEIC image.');
    if (file.size > MAX_UPLOAD_BYTES) return toast.error('Images must be smaller than 10 MB.');

    setUploadingAvatar(true);
    try {
      const uploaded = await uploadImage(file, 'avatars');
      await saveAvatar.mutateAsync(uploaded.key || uploaded.url);
    } catch (e) {
      toast.error(errMsg(e, 'Photo upload failed.'));
    } finally {
      setUploadingAvatar(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function shareProfile() {
    if (!me) return;
    const url = `${window.location.origin}/u/${me._id}`;
    const title = `${displayName(me)} on Vybe`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Profile link copied');
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      toast.error('Could not share your profile.');
    }
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const uErr = usernameError(form.username.trim());
    if (uErr) next.username = uErr;
    if (form.fullName.trim().length < 2) next.fullName = 'Enter your full name.';
    setErrors(next);
    if (Object.keys(next).length) return;
    saveProfile.mutate();
  }

  /*
   * The hub band: the member's gym as context and the weeks they have kept
   * their rhythm as the one figure — omitted at zero, when the next step
   * takes its place. No action on the band: the action colour is reserved
   * for Follow on other people's profiles.
   */
  const header = (
    <PageHeader
      title="Profile"
      mobileActions={<></>}
      actions={
        <ButtonLink to="/settings" variant="secondary" icon={<SettingsIcon size={18} />}>
          Settings
        </ButtonLink>
      }
      band={{
        variant: 'hub',
        context: gym ? 'Training at {gym}' : undefined,
        figure: weeksKept,
        figureLabel: weeksKept === 1 ? 'week kept' : 'weeks kept',
        children: !weeksKept && rhythm.isSuccess ? (
          <Link to="/workouts" viewTransition className="inline-flex min-h-11 items-center text-sm font-semibold text-band-ink hover:underline">
            Log a session this week to start your rhythm
          </Link>
        ) : undefined,
      }}
    />
  );

  if (meQuery.isLoading && !me) {
    return (
      <div className={PAGE} aria-busy="true">
        {header}
        <div className={PROFILE_GRID}>
          <div className="space-y-section">
            <ProfileHeaderSkeleton />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (meQuery.isError || !me) {
    return (
      <div className={PAGE}>
        {header}
        <ErrorState
          error={meQuery.error}
          title="Profile unavailable"
          message={errMsg(meQuery.error, 'Your profile did not load.')}
          onRetry={() => meQuery.refetch()}
        />
      </div>
    );
  }

  const avatarBusy = uploadingAvatar || saveAvatar.isPending;
  const joined = joinedLabel(me.createdAt);
  const gymRow = ownGym(gym);
  const gymLabel = gymRow.label ?? homeGymLabel(me, gym);

  return (
    <div className={PAGE}>
      {header}

      <div className={PROFILE_GRID}>
        <div className="space-y-section">
          <ProfileCover src={me.coverPicture} />

          {/* The Instagram header: avatar left, three stats right, then name, gym and bio. */}
          <section aria-label="About you" className="@container">
            <div className="flex items-center gap-5 sm:gap-8">
              <div className="relative shrink-0">
                <Avatar src={me.avatar} name={displayName(me)} size={88} seed={me._id} className="ring-1 ring-line" />
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(',')}
                  hidden
                  onChange={(e) => onAvatarPicked(e.target.files)}
                />
                <IconButton
                  label={avatarBusy ? 'Uploading photo' : 'Change profile photo'}
                  variant="secondary"
                  size={40}
                  onClick={() => fileRef.current?.click()}
                  disabled={avatarBusy}
                  aria-busy={avatarBusy || undefined}
                  className="absolute -bottom-1 -right-1 rounded-full shadow-2"
                >
                  {avatarBusy ? <Spinner size={18} /> : <Camera size={18} />}
                </IconButton>
              </div>

              <StatStrip
                aria-label="Profile stats"
                className={cx('flex-1', STAT_STRIP_CLASS)}
                items={[
                  { label: 'posts', value: postCount(me), onClick: () => setTab('posts') },
                  { label: 'followers', value: followerCount(me), to: '/profile/followers' },
                  { label: 'following', value: followingCount(me), to: '/profile/following' },
                ]}
              />
            </div>

            <div className="mt-4 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="text-md font-semibold text-text-1">{displayName(me)}</h2>
                <UserBadges user={me} />
              </div>
              <p className="text-sm text-text-2">@{me.username}</p>
              <GymRow label={gymLabel} href={gymRow.href} />
              {me.bio ? <p className="prose-measure mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-1">{me.bio}</p> : null}
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-3">
                <Calendar size={14} aria-hidden="true" />
                {joined ? `Joined ${joined}` : 'Joined recently'}
              </p>
            </div>

            {/* Tonal, full width: the action colour is not spent on your own profile. */}
            <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
              <Button variant="secondary" block className="border-transparent bg-surface-3" onClick={openEditor}>
                Edit profile
              </Button>
              <IconButton label="Share profile" variant="secondary" className="border-transparent bg-surface-3" onClick={shareProfile}>
                <ShareUp size={20} />
              </IconButton>
            </div>
          </section>

          <HighlightsRow userId={me._id} isOwn author={me} />

          <ProfileShortcuts />
        </div>

        <section className="space-y-4" aria-label="Your activity">
          <SegmentedControl
            aria-label="Profile content"
            tabs={PROFILE_TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))}
            value={tab}
            onChange={setTab}
          />
          <div className={cx('anim-fade-in')} key={tab}>
            {tab === 'posts' && <ProfilePosts userId={me._id} isOwn />}
            {tab === 'workouts' && <ProfileWorkouts userId={me._id} isOwn />}
            {tab === 'meals' && <ProfileMeals userId={me._id} isOwn />}
            {tab === 'saved' && <ProfileSaved />}
          </div>
        </section>
      </div>

      <Modal
        open={editing}
        title="Edit profile"
        description="Your name, username and bio are visible to everyone on Vybe."
        onClose={() => setEditing(false)}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saveProfile.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="profile-edit-form" variant="primary" loading={saveProfile.isPending}>
              Save changes
            </Button>
          </>
        }
      >
        <form id="profile-edit-form" onSubmit={submitEdit} className="space-y-4" noValidate>
          <Input
            id="pf-name"
            label="Full name"
            autoComplete="name"
            value={form.fullName}
            maxLength={100}
            error={errors.fullName}
            onChange={(e) => {
              setForm((f) => ({ ...f, fullName: e.target.value }));
              if (errors.fullName) setErrors((er) => ({ ...er, fullName: undefined }));
            }}
          />
          <Input
            id="pf-username"
            label="Username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            leading={<span className="text-sm">@</span>}
            value={form.username}
            maxLength={30}
            error={errors.username}
            hint="3–30 characters. Letters, numbers, periods and underscores."
            onChange={(e) => {
              setForm((f) => ({ ...f, username: e.target.value.replace(/\s/g, '') }));
              if (errors.username) setErrors((er) => ({ ...er, username: undefined }));
            }}
          />
          <Textarea
            id="pf-bio"
            label="Bio"
            rows={3}
            autoGrow
            maxRows={8}
            maxLength={300}
            value={form.bio}
            hint={`${form.bio.length}/300`}
            placeholder="What are you training for?"
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
          />
        </form>
      </Modal>
    </div>
  );
}
