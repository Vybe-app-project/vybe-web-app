import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  PairFigure,
  Section,
  Skeleton,
  SkeletonTile,
  Spinner,
  StatGrid,
  StatTile,
  Tabs,
  Textarea,
  cx,
  formatStat,
  useToast,
} from './ui';
import { Award, Calendar, Camera, ChevronRight, Edit, MapPin, Settings as SettingsIcon, ShareUp, Users } from './icons';
import { UserBadges } from './UserRow';
import { PROFILE_TABS, ProfileMeals, ProfilePosts, ProfileWorkouts, isProfileTab, type ProfileTabKey } from './ProfileTabs';

const tzOffset = () => new Date().getTimezoneOffset() * -1;

/** Profile pages read best at post width; the shell owns the gutter. */
export const PAGE = 'mx-auto w-full max-w-[52rem] space-y-6';

const joinedLabel = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

/** Cover strip: the user's photo, or a quiet surface with the pair mark. */
export function ProfileCover({ src }: { src?: string }) {
  if (src) {
    return (
      <div className="h-28 w-full overflow-hidden bg-surface-2 sm:h-36">
        <img src={mediaUrl(src)} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div className="relative h-28 w-full overflow-hidden bg-surface-2 sm:h-36" aria-hidden="true">
      <PairFigure
        size={200}
        className="absolute -bottom-14 -right-4 text-line-strong opacity-60 sm:-bottom-16 sm:left-1/2 sm:right-auto sm:-translate-x-1/2"
      />
    </div>
  );
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
        <span className="relative grid h-9 w-9 place-items-center rounded-sm bg-brand-soft text-brand-text">
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
  const achievements = useQuery({
    queryKey: ['achievements', 'user', 'summary'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.get('/achievements/user', { params: { timezoneOffsetMinutes: tzOffset() } });
      const list: Array<{ isEarned?: boolean; canClaim?: boolean }> = data?.achievements || [];
      return {
        earned: list.filter((a) => a.isEarned).length,
        claimable: list.filter((a) => a.canClaim).length,
        total: list.length,
      };
    },
  });
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
    <Section title="Keep going" description="Progress, photos and the people you train with.">
      <div className="grid grid-cols-3 gap-3">
        <ShortcutCard
          to="/achievements"
          icon={<Award size={20} />}
          label="Achievements"
          loading={achievements.isLoading}
          value={achievements.isError ? null : achievements.data?.earned}
          hint={
            achievements.data?.claimable
              ? `${achievements.data.claimable} to claim`
              : achievements.data
                ? `of ${achievements.data.total} earned`
                : undefined
          }
          badge={achievements.data?.claimable || 0}
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
      </div>
    </Section>
  );
}

export default function Profile() {
  const authUser = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [params, setParams] = useSearchParams();

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
    onError: (e) => toast.error(errMsg(e, 'Could not save your profile.')),
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

  const header = (
    <PageHeader
      title="Profile"
      mobileActions={<></>}
      actions={
        <ButtonLink to="/settings" variant="secondary" icon={<SettingsIcon size={18} />}>
          Settings
        </ButtonLink>
      }
    />
  );

  if (meQuery.isLoading && !me) {
    return (
      <div className={PAGE} aria-busy="true">
        {header}
        <Card padded={false} className="overflow-hidden">
          <Skeleton className="h-28 w-full rounded-none sm:h-36" />
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <Skeleton className="h-24 w-24 rounded-full ring-4 ring-surface-1" />
              <div className="flex gap-2">
                <Skeleton className="h-11 w-32 rounded-sm" />
                <Skeleton className="h-11 w-24 rounded-sm" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
          </div>
        </Card>
        <StatGrid>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonTile key={i} />
          ))}
        </StatGrid>
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

  return (
    <div className={PAGE}>
      {header}

      <Card padded={false} className="overflow-hidden">
        <ProfileCover src={me.coverPicture} />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          {/* Stacked under `sm` so the avatar and actions never collide at 390 px. */}
          <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="relative z-[1] w-fit">
              <Avatar src={me.avatar} name={displayName(me)} size={96} className="bg-surface-1 ring-4 ring-surface-1" />
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
                size={44}
                onClick={() => fileRef.current?.click()}
                disabled={avatarBusy}
                aria-busy={avatarBusy || undefined}
                className="absolute -bottom-1 -right-1 rounded-full shadow-2"
              >
                {avatarBusy ? <Spinner size={18} /> : <Camera size={20} />}
              </IconButton>
            </div>

            <div className="flex flex-wrap gap-2 sm:pb-1">
              <Button variant="secondary" icon={<Edit size={18} />} onClick={openEditor}>
                Edit profile
              </Button>
              <Button variant="secondary" icon={<ShareUp size={18} />} onClick={shareProfile}>
                Share
              </Button>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="type-heading text-xl text-text-1">{displayName(me)}</h2>
              <UserBadges user={me} />
            </div>
            <p className="text-sm text-text-2">@{me.username}</p>
            {me.bio ? <p className="prose-measure mt-3 whitespace-pre-wrap text-base text-text-1">{me.bio}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-2">
              {me.location ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} className="text-text-3" aria-hidden="true" />
                  {me.location}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={14} className="text-text-3" aria-hidden="true" />
                {joined ? `Joined ${joined}` : 'Joined recently'}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <StatGrid>
        <StatTile label="Posts" value={formatStat(postCount(me))} onClick={() => setTab('posts')} />
        <StatTile label="Followers" value={formatStat(followerCount(me))} to="/friends" />
        <StatTile label="Following" value={formatStat(followingCount(me))} to="/friends" />
        <StatTile label="Workouts" value={formatStat(me.stats?.workouts || 0)} onClick={() => setTab('workouts')} tone="brand" />
      </StatGrid>

      <ProfileShortcuts />

      <section className="space-y-4" aria-label="Your activity">
        <Tabs
          aria-label="Profile content"
          tabs={PROFILE_TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))}
          value={tab}
          onChange={setTab}
        />
        <div className={cx('anim-fade-in')} key={tab}>
          {tab === 'posts' && <ProfilePosts userId={me._id} isOwn />}
          {tab === 'workouts' && <ProfileWorkouts userId={me._id} isOwn />}
          {tab === 'meals' && <ProfileMeals userId={me._id} isOwn />}
        </div>
      </section>

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
