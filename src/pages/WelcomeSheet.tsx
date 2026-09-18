import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { WELCOME_PARAM } from '../lib/authRedirect';
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES, displayName, uploadImage, type PublicUser } from '../lib/hooks';
import { Avatar, Button, ButtonLink, Modal, Spinner, useToast } from './ui';
import { Camera, Compass } from './icons';
import UserRow, { UserRowSkeleton } from './UserRow';

const SUGGESTION_COUNT = 5;

/**
 * First-run moment after sign-up, matching the mobile onboarding (add a
 * photo with Skip, then "Welcome to Vybe, {name}"). Sign-up lands on
 * `?welcome=1`; the param is consumed on open so a reload does not bring the
 * sheet back. Both steps are optional and live on one sheet: a photo, and a
 * few people to follow so the feed is not quiet on the first visit.
 */
export default function WelcomeSheet() {
  const [params, setParams] = useSearchParams();
  const me = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const requested = params.get(WELCOME_PARAM) === '1';
  useEffect(() => {
    if (!requested) return;
    setOpen(true);
    const next = new URLSearchParams(params);
    next.delete(WELCOME_PARAM);
    setParams(next, { replace: true });
  }, [requested, params, setParams]);

  const people = useQuery({
    queryKey: ['welcome-people'],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.get('/searching/suggest');
      return ((data?.users || []) as PublicUser[]).slice(0, SUGGESTION_COUNT);
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
      toast.success('Profile photo added');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save your profile photo.')),
  });

  async function onPicked(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return toast.error('Choose a JPEG, PNG, WebP or HEIC image.');
    if (file.size > MAX_UPLOAD_BYTES) return toast.error('Images must be smaller than 10 MB.');
    setUploading(true);
    try {
      const uploaded = await uploadImage(file, 'avatars');
      await saveAvatar.mutateAsync(uploaded.key || uploaded.url);
    } catch (e) {
      toast.error(errMsg(e, 'Photo upload failed.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (!me) return null;
  const firstName = (me.fullName || me.username || '').trim().split(/\s+/)[0] || 'there';
  const busy = uploading || saveAvatar.isPending;
  const close = () => setOpen(false);

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Welcome to Vybe, ${firstName}`}
      description="Two quick things, both optional. You can change them any time from your profile."
      size="sm"
      footer={
        <Button variant="primary" onClick={close}>
          {me.avatar ? 'Go to my feed' : 'Skip for now'}
        </Button>
      }
    >
      <div className="space-y-6">
        <section aria-labelledby="welcome-photo-heading" className="flex items-center gap-4">
          <div className="relative shrink-0">
            <Avatar src={me.avatar} name={displayName(me)} size={72} className="bg-surface-2" />
            {busy ? (
              <span className="absolute inset-0 inline-flex items-center justify-center rounded-full bg-bg/70" aria-hidden="true">
                <Spinner size={20} />
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="welcome-photo-heading" className="text-md font-semibold text-text-1">
              {me.avatar ? 'Looking good' : 'Add a profile photo'}
            </h3>
            <p className="mt-0.5 text-sm text-text-2">
              {me.avatar ? 'Your photo is set. Friends will recognise you in the feed.' : 'People follow faces. A photo makes your posts and comments yours.'}
            </p>
            <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden onChange={(e) => void onPicked(e.target.files)} />
            <Button
              variant={me.avatar ? 'secondary' : 'brand'}
              size="sm"
              className="mt-2"
              icon={<Camera size={18} />}
              onClick={() => fileRef.current?.click()}
              loading={busy}
              aria-label={me.avatar ? 'Change profile photo' : 'Add a profile photo'}
            >
              {me.avatar ? 'Change photo' : 'Add photo'}
            </Button>
          </div>
        </section>

        <section aria-labelledby="welcome-people-heading">
          <div className="flex items-baseline justify-between gap-2">
            <h3 id="welcome-people-heading" className="text-md font-semibold text-text-1">
              People to follow
            </h3>
            <ButtonLink to="/discover" variant="link" size="sm" icon={<Compass size={16} />} onClick={close}>
              See more
            </ButtonLink>
          </div>
          <p className="mt-0.5 text-sm text-text-2">Following a few people fills your feed with their sessions.</p>

          <div className="mt-3 space-y-2" aria-busy={people.isLoading || undefined}>
            {people.isLoading
              ? Array.from({ length: 3 }).map((_, i) => <UserRowSkeleton key={i} />)
              : people.isError
                ? (
                  <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 p-3 text-sm text-text-2">
                    <span>Could not load suggestions.</span>
                    <Button variant="secondary" size="sm" onClick={() => void people.refetch()}>
                      Try again
                    </Button>
                  </div>
                )
                : people.data?.length
                  ? people.data.map((user) => <UserRow key={user._id} user={user} />)
                  : (
                    <p className="rounded-md bg-surface-2 p-3 text-sm text-text-2">
                      No suggestions yet. Explore to find athletes, coaches and gyms near you.
                    </p>
                  )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
