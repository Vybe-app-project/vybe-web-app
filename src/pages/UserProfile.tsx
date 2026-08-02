import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  compactNumber,
  displayName,
  followerCount,
  followingCount,
  postCount,
  timeAgo,
  type PublicUser,
} from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  Tabs,
  Textarea,
  useToast,
} from './ui';
import { FollowButton } from './UserRow';
import {
  PROFILE_TABS,
  ProfileMeals,
  ProfilePosts,
  ProfileWorkouts,
  type ProfileTabKey,
} from './ProfileTabs';

const REPORT_REASONS = [
  'spam',
  'harassment',
  'nudity',
  'hate_speech',
  'impersonation',
  'other',
] as const;

const REASON_LABELS: Record<string, string> = {
  spam: 'Spam or scam',
  harassment: 'Harassment or bullying',
  nudity: 'Nudity or sexual content',
  hate_speech: 'Hate speech',
  impersonation: 'Impersonation',
  other: 'Something else',
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-base font-bold">{compactNumber(value)}</div>
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
    </div>
  );
}

export default function UserProfile() {
  const { id = '' } = useParams();
  const me = useAuth((s) => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<ProfileTabKey>('posts');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>('spam');
  const [reportDetail, setReportDetail] = useState('');
  const [confirmBlock, setConfirmBlock] = useState(false);

  const userQuery = useQuery({
    queryKey: ['user', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await api.get(`/users/${id}`);
      return (data.user || data) as PublicUser;
    },
  });

  const block = useMutation({
    mutationFn: async () => {
      await api.post('/users/block', { userId: id });
    },
    onSuccess: () => {
      toast.success('User blocked');
      setConfirmBlock(false);
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['user', id] });
      navigate('/discover', { replace: true });
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not block this user.'));
      setConfirmBlock(false);
    },
  });

  const report = useMutation({
    mutationFn: async () => {
      await api.post('/users/report', {
        userId: id,
        reason: reportReason,
        ...(reportDetail.trim() ? { detail: reportDetail.trim() } : {}),
      });
    },
    onSuccess: () => {
      setReportOpen(false);
      setReportDetail('');
      toast.success('Report submitted. Our moderation team will review it.');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not submit your report.')),
  });

  if (me && String(me._id) === String(id)) return <Navigate to="/profile" replace />;

  if (userQuery.isLoading) {
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
          <div className="mt-5 grid grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-xl" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (userQuery.isError || !userQuery.data) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <ErrorState
          title="Profile not found"
          message={errMsg(
            userQuery.error,
            'This account may have been removed, or it is not visible to you.',
          )}
          action={
            <Button variant="primary" onClick={() => navigate('/discover')}>
              Discover people
            </Button>
          }
        />
      </div>
    );
  }

  const user = userQuery.data;
  const isPrivate = user.settings?.privacy === 'private';
  const canViewContent = user.canViewContent !== false;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <Card className="overflow-hidden">
        {user.coverPicture ? (
          <img src={mediaUrl(user.coverPicture)} alt="" className="h-32 w-full object-cover" />
        ) : (
          <div className="h-24 w-full bg-gradient-to-r from-[var(--color-brand)]/40 to-[var(--color-brand-2)]/30" />
        )}

        <div className="p-5">
          <div className="-mt-14 flex items-end justify-between">
            <Avatar
              src={mediaUrl(user.avatar)}
              name={displayName(user)}
              size={88}
              className="ring-4 ring-[var(--color-surface)]"
            />
            <div className="flex items-center gap-2">
              <FollowButton user={user} onChanged={() => userQuery.refetch()} />
              <Button variant="ghost" onClick={() => setReportOpen(true)}>
                Report
              </Button>
              <Button variant="ghost" onClick={() => setConfirmBlock(true)}>
                Block
              </Button>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold">{displayName(user)}</h1>
              {user.isVerified && <Badge variant="brand">Verified</Badge>}
              {(user.isCoach || user.isTrainer) && <Badge>Coach</Badge>}
              {isPrivate && <Badge>Private</Badge>}
            </div>
            <p className="text-sm text-[var(--color-muted)]">@{user.username}</p>
            {user.bio && <p className="mt-2 whitespace-pre-wrap text-sm">{user.bio}</p>}
            {!!user.fields?.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {user.fields.map((f) => (
                  <Badge key={f}>{f}</Badge>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              {user.location ? `${user.location} · ` : ''}
              Joined {user.createdAt ? timeAgo(user.createdAt) + ' ago' : 'recently'}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 border-t border-[var(--color-line)] pt-4">
            <Stat label="Posts" value={postCount(user)} />
            <Stat label="Followers" value={followerCount(user)} />
            <Stat label="Following" value={followingCount(user)} />
            <Stat label="Workouts" value={user.stats?.workouts || 0} />
          </div>
        </div>
      </Card>

      {!canViewContent ? (
        <EmptyState
          title="This account is private"
          message={`Follow ${displayName(user)} to see their posts, workouts and meals.`}
          action={<FollowButton user={user} onChanged={() => userQuery.refetch()} />}
        />
      ) : (
        <>
          <Tabs
            tabs={PROFILE_TABS.map((t) => ({ key: t.key, label: t.label }))}
            value={tab}
            onChange={(key) => setTab(key as ProfileTabKey)}
          />
          {tab === 'posts' && <ProfilePosts userId={user._id} />}
          {tab === 'workouts' && <ProfileWorkouts userId={user._id} isOwn={false} />}
          {tab === 'meals' && <ProfileMeals userId={user._id} isOwn={false} />}
        </>
      )}

      <Modal open={reportOpen} title={`Report ${displayName(user)}`} onClose={() => setReportOpen(false)}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            report.mutate();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-semibold">Why are you reporting?</legend>
            {REPORT_REASONS.map((reason) => (
              <label
                key={reason}
                className="flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm"
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={reason}
                  checked={reportReason === reason}
                  onChange={() => setReportReason(reason)}
                />
                {REASON_LABELS[reason]}
              </label>
            ))}
          </fieldset>

          <div>
            <label htmlFor="report-detail" className="mb-1.5 block text-xs font-semibold">
              Additional detail (optional)
            </label>
            <Textarea
              id="report-detail"
              rows={3}
              maxLength={500}
              value={reportDetail}
              onChange={(e) => setReportDetail(e.target.value)}
              placeholder="Anything that helps our moderators…"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setReportOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={report.isPending} disabled={report.isPending}>
              Submit report
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmBlock}
        title={`Block ${displayName(user)}?`}
        message="You will no longer see each other's posts, comments or messages, and any follow relationship is removed."
        confirmLabel="Block user"
        destructive
        loading={block.isPending}
        onConfirm={() => block.mutate()}
        onCancel={() => setConfirmBlock(false)}
      />
    </div>
  );
}
