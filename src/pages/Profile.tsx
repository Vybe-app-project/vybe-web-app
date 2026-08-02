import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  compactNumber,
  displayName,
  followerCount,
  followingCount,
  postCount,
  timeAgo,
  uploadImage,
  usernameError,
  type PublicUser,
} from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  Tabs,
  Textarea,
  useToast,
} from './ui';
import { Camera, Settings as SettingsIcon } from './icons';
import {
  PROFILE_TABS,
  ProfileMeals,
  ProfilePosts,
  ProfileWorkouts,
  type ProfileTabKey,
} from './ProfileTabs';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-base font-bold">{compactNumber(value)}</div>
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
    </div>
  );
}

export default function Profile() {
  const authUser = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<ProfileTabKey>('posts');
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

  function openEditor() {
    setForm({
      fullName: me?.fullName || '',
      username: me?.username || '',
      bio: me?.bio || '',
    });
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
      toast.success('Profile updated');
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
      toast.success('Profile picture updated');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not update your profile picture.')),
  });

  async function onAvatarPicked(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type))
      return toast.error('Choose a JPEG, PNG, WebP or HEIC image.');
    if (file.size > MAX_UPLOAD_BYTES) return toast.error('Images must be smaller than 10 MB.');

    setUploadingAvatar(true);
    try {
      const uploaded = await uploadImage(file, 'avatars');
      await saveAvatar.mutateAsync(uploaded.key || uploaded.url);
    } catch (e) {
      toast.error(errMsg(e, 'Avatar upload failed.'));
    } finally {
      setUploadingAvatar(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault();
    const uErr = usernameError(form.username.trim());
    if (uErr) return toast.error(uErr);
    if (form.fullName.trim().length < 2) return toast.error('Enter your full name.');
    saveProfile.mutate();
  }

  if (meQuery.isLoading && !me) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (meQuery.isError || !me) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <ErrorState
          title="Profile unavailable"
          message={errMsg(meQuery.error, 'We could not load your profile.')}
          action={
            <Button variant="primary" onClick={() => meQuery.refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <Card className="overflow-hidden">
        {me.coverPicture ? (
          <img src={mediaUrl(me.coverPicture)} alt="" className="h-32 w-full object-cover" />
        ) : (
          <div className="h-24 w-full bg-gradient-to-r from-[var(--color-brand)]/40 to-[var(--color-brand-2)]/30" />
        )}

        <div className="p-5">
          <div className="-mt-14 flex items-end justify-between">
            <div className="relative">
              <Avatar
                src={mediaUrl(me.avatar)}
                name={displayName(me)}
                size={88}
                className="ring-4 ring-[var(--color-surface)]"
              />
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(',')}
                hidden
                onChange={(e) => onAvatarPicked(e.target.files)}
              />
              <button
                type="button"
                aria-label="Change profile picture"
                onClick={() => fileRef.current?.click()}
                disabled={uploadingAvatar || saveAvatar.isPending}
                className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] disabled:opacity-60"
              >
                <Camera className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={openEditor}>
                Edit profile
              </Button>
              <Link to="/settings" aria-label="Settings" className="btn btn-ghost">
                <SettingsIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold">{displayName(me)}</h1>
              {me.isVerified && <Badge variant="brand">Verified</Badge>}
              {(me.isCoach || me.isTrainer) && <Badge>Coach</Badge>}
              {me.isPremium && <Badge variant="brand">Premium</Badge>}
            </div>
            <p className="text-sm text-[var(--color-muted)]">@{me.username}</p>
            {me.bio && <p className="mt-2 whitespace-pre-wrap text-sm">{me.bio}</p>}
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              {me.location ? `${me.location} · ` : ''}
              Joined {me.createdAt ? timeAgo(me.createdAt) + ' ago' : 'recently'}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 border-t border-[var(--color-line)] pt-4">
            <Stat label="Posts" value={postCount(me)} />
            <Stat label="Followers" value={followerCount(me)} />
            <Stat label="Following" value={followingCount(me)} />
            <Stat label="Workouts" value={me.stats?.workouts || 0} />
          </div>
        </div>
      </Card>

      <Tabs
        tabs={PROFILE_TABS.map((t) => ({ key: t.key, label: t.label }))}
        value={tab}
        onChange={(key) => setTab(key as ProfileTabKey)}
      />

      {tab === 'posts' && <ProfilePosts userId={me._id} />}
      {tab === 'workouts' && <ProfileWorkouts userId={me._id} isOwn />}
      {tab === 'meals' && <ProfileMeals userId={me._id} isOwn />}

      <Modal open={editing} title="Edit profile" onClose={() => setEditing(false)}>
        <form onSubmit={submitEdit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="pf-name" className="mb-1.5 block text-xs font-semibold">
              Full name
            </label>
            <Input
              id="pf-name"
              value={form.fullName}
              maxLength={100}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="pf-username" className="mb-1.5 block text-xs font-semibold">
              Username
            </label>
            <Input
              id="pf-username"
              value={form.username}
              maxLength={30}
              onChange={(e) =>
                setForm((f) => ({ ...f, username: e.target.value.replace(/\s/g, '') }))
              }
            />
            <p className="mt-1.5 text-xs text-[var(--color-muted)]">
              3–30 characters. Letters, numbers, periods and underscores only.
            </p>
          </div>
          <div>
            <label htmlFor="pf-bio" className="mb-1.5 block text-xs font-semibold">
              Bio
            </label>
            <Textarea
              id="pf-bio"
              rows={4}
              maxLength={300}
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            />
            <p className="mt-1 text-right text-xs text-[var(--color-muted)]">
              {form.bio.length}/300
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={saveProfile.isPending}
              disabled={saveProfile.isPending}
            >
              Save changes
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
