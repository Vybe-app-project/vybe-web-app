import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  Spinner,
  Switch,
  Tabs,
  Textarea,
  cx,
  useToast,
} from '../components/ui';
import {
  Activity,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit,
  Plus,
  Search,
  Trash,
  TrendingUp,
  Trophy,
  Users,
} from '../components/icons';

/* ------------------------------------------------------------------ types */

type ChallengeType =
  | 'workout'
  | 'nutrition'
  | 'steps'
  | 'weight_loss'
  | 'strength'
  | 'cardio'
  | 'custom';
type ChallengeCategory = 'daily' | 'weekly' | 'monthly' | 'custom';
type GoalUnit =
  | 'workouts'
  | 'calories'
  | 'steps'
  | 'pounds'
  | 'miles'
  | 'minutes'
  | 'custom';

type ChallengeUser = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
};

type Participant = {
  user: ChallengeUser | string;
  joinedAt?: string;
  progress: number;
  lastUpdated?: string;
  completed?: boolean;
};

type LeaderboardEntry = {
  user: ChallengeUser | string;
  progress: number;
  rank?: number;
  lastUpdated?: string;
};

export type Challenge = {
  _id: string;
  title: string;
  description: string;
  type: ChallengeType;
  category: ChallengeCategory;
  goal: number;
  goalUnit: GoalUnit;
  startDate: string;
  endDate: string;
  createdBy?: ChallengeUser | string | null;
  ownership: 'user' | 'system';
  participants?: Participant[];
  maxParticipants?: number;
  isPublic?: boolean;
  isActive?: boolean;
  isCompleted?: boolean;
  image?: string;
  tags?: string[];
  rewards?: string;
  leaderboard?: LeaderboardEntry[];
  stats?: {
    totalParticipants: number;
    totalProgress: number;
    averageProgress: number;
    completionRate: number;
  };
};

type Pagination = { page: number; limit: number; total: number; pages: number };

type ChallengeListResponse = {
  success: boolean;
  challenges: Challenge[];
  pagination?: Pagination;
};

type ChallengeStats = {
  totalParticipants: number;
  totalProgress: number;
  averageProgress: number;
  completionRate: number;
  progressPercentage: number;
  duration: number;
  timeRemaining: number;
};

const CHALLENGE_TYPES: ChallengeType[] = [
  'workout',
  'nutrition',
  'steps',
  'weight_loss',
  'strength',
  'cardio',
  'custom',
];
const CHALLENGE_CATEGORIES: ChallengeCategory[] = ['daily', 'weekly', 'monthly', 'custom'];
const GOAL_UNITS: GoalUnit[] = [
  'workouts',
  'calories',
  'steps',
  'pounds',
  'miles',
  'minutes',
  'custom',
];

/** Mirrors the server's TRACKED_GOAL_UNITS map so the form can't submit a rejected pair. */
const TRACKED_GOAL_UNITS: Partial<Record<ChallengeType, GoalUnit[]>> = {
  workout: ['workouts', 'calories', 'minutes'],
  strength: ['workouts', 'calories', 'minutes'],
  cardio: ['workouts', 'calories', 'minutes'],
  steps: ['steps'],
};

const unitsForType = (type: ChallengeType): GoalUnit[] =>
  TRACKED_GOAL_UNITS[type] ?? GOAL_UNITS;

const isTracked = (c: Challenge) => Boolean(TRACKED_GOAL_UNITS[c.type]);

const PAGE_LIMIT = 12;

/* -------------------------------------------------------------- utilities */

const idOf = (value: ChallengeUser | string | null | undefined): string =>
  typeof value === 'string' ? value : (value?._id ?? '');

const userOf = (value: ChallengeUser | string): ChallengeUser =>
  typeof value === 'string' ? { _id: value } : value;

const displayName = (u: ChallengeUser) => u.fullName || u.username || 'Vybe athlete';

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'MMM d') : '—';
};

const endsIn = (iso?: string) => {
  if (!iso) return '—';
  const d = parseISO(iso);
  if (!isValid(d)) return '—';
  if (d.getTime() <= Date.now()) return 'ended';
  return `${formatDistanceToNowStrict(d)} left`;
};

const toDateInput = (d: Date) => format(d, 'yyyy-MM-dd');

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/* ------------------------------------------------------------ progress bar */

function ProgressBar({ value, goal }: { value: number; goal: number }) {
  const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-brand-2)] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-[var(--color-muted)]">
        {Math.round(value)} / {Math.round(goal)} · {Math.round(pct)}%
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- create form */

type ChallengeForm = {
  title: string;
  description: string;
  type: ChallengeType;
  category: ChallengeCategory;
  goal: string;
  goalUnit: GoalUnit;
  startDate: string;
  endDate: string;
  maxParticipants: string;
  isPublic: boolean;
  tags: string;
  rewards: string;
};

const emptyForm = (): ChallengeForm => {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    title: '',
    description: '',
    type: 'workout',
    category: 'weekly',
    goal: '5',
    goalUnit: 'workouts',
    startDate: toDateInput(now),
    endDate: toDateInput(end),
    maxParticipants: '100',
    isPublic: true,
    tags: '',
    rewards: '',
  };
};

function CreateChallengeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<ChallengeForm>(emptyForm);

  useEffect(() => {
    if (!open) setForm(emptyForm());
  }, [open]);

  const allowedUnits = unitsForType(form.type);

  const create = useMutation({
    mutationFn: async () => {
      const title = form.title.trim();
      const description = form.description.trim();
      if (title.length < 3) throw new Error('Title must be at least 3 characters');
      if (description.length < 10) {
        throw new Error('Description must be at least 10 characters');
      }
      const goal = Number(form.goal);
      if (!Number.isFinite(goal) || goal <= 0) throw new Error('Goal must be a positive number');
      const maxParticipants = Number(form.maxParticipants);
      if (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 10000) {
        throw new Error('Max participants must be between 1 and 10000');
      }
      const start = new Date(`${form.startDate}T00:00:00`);
      const end = new Date(`${form.endDate}T23:59:59`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        throw new Error('End date must be after the start date');
      }
      const tags = form.tags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20);

      const { data } = await api.post<{ success: boolean; challenge: Challenge }>('/challenges', {
        title,
        description,
        type: form.type,
        category: form.category,
        goal,
        goalUnit: form.goalUnit,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        maxParticipants,
        isPublic: form.isPublic,
        ...(tags.length ? { tags } : {}),
        ...(form.rewards.trim() ? { rewards: form.rewards.trim() } : {}),
      });
      return data.challenge;
    },
    onSuccess: () => {
      toast.success('Challenge created');
      qc.invalidateQueries({ queryKey: ['challenges'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not create challenge')),
  });

  return (
    <Modal open={open} onClose={onClose} title="Create a challenge" size="lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Input
          label="Title"
          placeholder="e.g. 5 workouts this week"
          maxLength={120}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <Textarea
          label="Description"
          rows={3}
          maxLength={2000}
          placeholder="What are people signing up for? Ground rules, how progress counts…"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="w-full">
            <span className="mb-1.5 block text-xs font-semibold text-[var(--color-muted)]">
              Type
            </span>
            <select
              className="input-base"
              value={form.type}
              onChange={(e) => {
                const type = e.target.value as ChallengeType;
                const units = unitsForType(type);
                setForm((f) => ({
                  ...f,
                  type,
                  goalUnit: units.includes(f.goalUnit) ? f.goalUnit : units[0],
                }));
              }}
            >
              {CHALLENGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="w-full">
            <span className="mb-1.5 block text-xs font-semibold text-[var(--color-muted)]">
              Cadence
            </span>
            <select
              className="input-base"
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value as ChallengeCategory })
              }
            >
              {CHALLENGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="w-full">
            <span className="mb-1.5 block text-xs font-semibold text-[var(--color-muted)]">
              Goal unit
            </span>
            <select
              className="input-base"
              value={form.goalUnit}
              onChange={(e) => setForm({ ...form, goalUnit: e.target.value as GoalUnit })}
            >
              {allowedUnits.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Input
            label="Goal"
            type="number"
            min={1}
            step="1"
            value={form.goal}
            onChange={(e) => setForm({ ...form, goal: e.target.value })}
          />
          <Input
            label="Max participants"
            type="number"
            min={1}
            max={10000}
            step="1"
            value={form.maxParticipants}
            onChange={(e) => setForm({ ...form, maxParticipants: e.target.value })}
          />
          <Input
            label="Starts"
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
          <Input
            label="Ends"
            type="date"
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
        </div>

        <Input
          label="Tags"
          placeholder="comma separated, e.g. strength, beginner"
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
        />
        <Input
          label="Rewards"
          placeholder="Bragging rights, a badge, a rest day…"
          maxLength={500}
          value={form.rewards}
          onChange={(e) => setForm({ ...form, rewards: e.target.value })}
        />

        <div className="flex items-center justify-between rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
          <div>
            <p className="text-sm font-semibold">Public challenge</p>
            <p className="text-xs text-[var(--color-muted)]">
              Public challenges show up in Browse for everyone.
            </p>
          </div>
          <Switch
            label="Public challenge"
            checked={form.isPublic}
            onChange={(next) => setForm({ ...form, isPublic: next })}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create challenge
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- edit modal */

function EditChallengeModal({
  challenge,
  onClose,
}: {
  challenge: Challenge | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rewards, setRewards] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  useEffect(() => {
    if (!challenge) return;
    setTitle(challenge.title);
    setDescription(challenge.description);
    const end = parseISO(challenge.endDate);
    setEndDate(isValid(end) ? toDateInput(end) : '');
    setRewards(challenge.rewards ?? '');
    setIsPublic(challenge.isPublic !== false);
  }, [challenge]);

  const update = useMutation({
    mutationFn: async () => {
      if (!challenge) throw new Error('No challenge selected');
      const payload: Record<string, unknown> = {};
      if (title.trim() && title.trim() !== challenge.title) payload.title = title.trim();
      if (description.trim() && description.trim() !== challenge.description) {
        payload.description = description.trim();
      }
      const original = parseISO(challenge.endDate);
      if (endDate && (!isValid(original) || toDateInput(original) !== endDate)) {
        payload.endDate = new Date(`${endDate}T23:59:59`).toISOString();
      }
      if ((rewards.trim() || '') !== (challenge.rewards ?? '')) payload.rewards = rewards.trim();
      if (isPublic !== (challenge.isPublic !== false)) payload.isPublic = isPublic;
      if (Object.keys(payload).length === 0) throw new Error('Nothing to update');

      const { data } = await api.patch<{ success: boolean; challenge: Challenge }>(
        `/challenges/${challenge._id}`,
        payload,
      );
      return data.challenge;
    },
    onSuccess: () => {
      toast.success('Challenge updated');
      qc.invalidateQueries({ queryKey: ['challenges'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not update challenge')),
  });

  return (
    <Modal open={!!challenge} onClose={onClose} title="Edit challenge">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate();
        }}
      >
        <Input
          label="Title"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          label="Description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Input
          label="Ends"
          type="date"
          hint="An active challenge with participants can only be extended."
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <Input
          label="Rewards"
          maxLength={500}
          value={rewards}
          onChange={(e) => setRewards(e.target.value)}
        />
        <div className="flex items-center justify-between rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-sm font-semibold">Public challenge</p>
          <Switch label="Public challenge" checked={isPublic} onChange={setIsPublic} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={update.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ detail modal */

function LeaderboardList({ challengeId }: { challengeId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['challenges', 'leaderboard', challengeId],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const { data } = await api.get<{ success: boolean; leaderboard: LeaderboardEntry[] }>(
        `/challenges/${challengeId}/leaderboard`,
        { params: { limit: 50 } },
      );
      return data.leaderboard ?? [];
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorState error={error} title="Leaderboard unavailable" retry={() => refetch()} />
    );
  }
  if (!data?.length) {
    return (
      <EmptyState
        icon={<Trophy size={22} />}
        title="No ranked athletes yet"
        message="As soon as participants log progress, the leaderboard fills in."
      />
    );
  }

  return (
    <ol className="space-y-2">
      {data.map((entry, index) => {
        const u = userOf(entry.user);
        const rank = entry.rank ?? index + 1;
        return (
          <li
            key={`${u._id}-${rank}`}
            className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-2)] px-3 py-2"
          >
            <span
              className={cx(
                'w-7 shrink-0 text-center text-sm font-bold',
                rank === 1
                  ? 'text-amber-300'
                  : rank === 2
                    ? 'text-slate-300'
                    : rank === 3
                      ? 'text-orange-300'
                      : 'text-[var(--color-muted)]',
              )}
            >
              #{rank}
            </span>
            <Avatar src={u.avatar} name={displayName(u)} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{displayName(u)}</p>
              {u.username ? (
                <p className="truncate text-[11px] text-[var(--color-muted)]">@{u.username}</p>
              ) : null}
            </div>
            <span className="text-sm font-bold">{Math.round(entry.progress)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ChallengeDetailModal({
  challengeId,
  onClose,
  onEdit,
  onDelete,
}: {
  challengeId: string | null;
  onClose: () => void;
  onEdit: (c: Challenge) => void;
  onDelete: (c: Challenge) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const [progressInput, setProgressInput] = useState('');
  const [pane, setPane] = useState<'overview' | 'leaderboard'>('overview');

  useEffect(() => {
    setPane('overview');
    setProgressInput('');
  }, [challengeId]);

  const detail = useQuery({
    queryKey: ['challenges', 'detail', challengeId],
    queryFn: async (): Promise<Challenge> => {
      const { data } = await api.get<{ success: boolean; challenge: Challenge }>(
        `/challenges/${challengeId}`,
      );
      return data.challenge;
    },
    enabled: !!challengeId,
  });

  const stats = useQuery({
    queryKey: ['challenges', 'stats', challengeId],
    queryFn: async (): Promise<ChallengeStats> => {
      const { data } = await api.get<{ success: boolean; stats: ChallengeStats }>(
        `/challenges/${challengeId}/stats`,
      );
      return data.stats;
    },
    enabled: !!challengeId,
  });

  const challenge = detail.data;
  const myId = me?._id ?? '';
  const myParticipation = challenge?.participants?.find((p) => idOf(p.user) === myId);
  const joined = !!myParticipation;
  const isOwner =
    !!challenge && challenge.ownership === 'user' && idOf(challenge.createdBy) === myId;

  useEffect(() => {
    if (myParticipation) setProgressInput(String(myParticipation.progress ?? 0));
  }, [myParticipation]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['challenges'] });
  };

  const join = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/challenges/${challengeId}/join`);
      return data;
    },
    onSuccess: () => {
      toast.success('You joined the challenge');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not join challenge')),
  });

  const leave = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/challenges/${challengeId}/leave`);
      return data;
    },
    onSuccess: () => {
      toast.success('You left the challenge');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not leave challenge')),
  });

  const saveProgress = useMutation({
    mutationFn: async () => {
      const progress = Number(progressInput);
      if (!Number.isFinite(progress) || progress < 0 || progress > 1000000000) {
        throw new Error('Progress must be a number between 0 and 1000000000');
      }
      const { data } = await api.put(`/challenges/${challengeId}/progress`, { progress });
      return data;
    },
    onSuccess: () => {
      toast.success('Progress updated');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not update progress')),
  });

  const autoUpdate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ success: boolean; progress: number }>(
        `/challenges/${challengeId}/auto-update`,
      );
      return data.progress;
    },
    onSuccess: (progress) => {
      toast.success(`Synced — ${Math.round(progress)} logged`);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not sync progress')),
  });

  return (
    <Modal
      open={!!challengeId}
      onClose={onClose}
      title={challenge?.title || 'Challenge'}
      size="lg"
    >
      {detail.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : detail.isError ? (
        <ErrorState
          error={detail.error}
          title="Could not load this challenge"
          retry={() => detail.refetch()}
        />
      ) : challenge ? (
        <div className="space-y-4">
          {challenge.image ? (
            <img
              src={mediaUrl(challenge.image)}
              alt={challenge.title}
              className="h-40 w-full rounded-xl object-cover"
              loading="lazy"
            />
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            <Badge tone="brand" className="capitalize">
              {challenge.type.replace('_', ' ')}
            </Badge>
            <Badge className="capitalize">{challenge.category}</Badge>
            <Badge tone={challenge.isActive === false ? 'neutral' : 'success'}>
              {challenge.isActive === false ? 'Closed' : endsIn(challenge.endDate)}
            </Badge>
            {challenge.ownership === 'system' ? <Badge tone="info">Official</Badge> : null}
          </div>

          <p className="text-sm leading-relaxed text-[var(--color-muted)]">
            {challenge.description}
          </p>

          <Tabs
            fill
            active={pane}
            onChange={(k) => setPane(k as 'overview' | 'leaderboard')}
            tabs={[
              { key: 'overview', label: 'Overview', icon: <Activity size={14} /> },
              { key: 'leaderboard', label: 'Leaderboard', icon: <Trophy size={14} /> },
            ]}
          />

          {pane === 'leaderboard' ? (
            <LeaderboardList challengeId={challenge._id} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-[var(--color-surface-2)] p-3">
                  <p className="text-xs text-[var(--color-muted)]">Goal</p>
                  <p className="text-lg font-bold">
                    {challenge.goal}
                    <span className="ml-1 text-xs font-normal text-[var(--color-muted)]">
                      {challenge.goalUnit}
                    </span>
                  </p>
                </div>
                <div className="rounded-xl bg-[var(--color-surface-2)] p-3">
                  <p className="text-xs text-[var(--color-muted)]">Participants</p>
                  <p className="text-lg font-bold">
                    {stats.data?.totalParticipants ??
                      challenge.stats?.totalParticipants ??
                      challenge.participants?.length ??
                      0}
                  </p>
                </div>
                <div className="rounded-xl bg-[var(--color-surface-2)] p-3">
                  <p className="text-xs text-[var(--color-muted)]">Avg progress</p>
                  <p className="text-lg font-bold">
                    {stats.isLoading
                      ? '—'
                      : Math.round(stats.data?.averageProgress ?? 0)}
                  </p>
                </div>
                <div className="rounded-xl bg-[var(--color-surface-2)] p-3">
                  <p className="text-xs text-[var(--color-muted)]">Completion</p>
                  <p className="text-lg font-bold">
                    {stats.isLoading ? '—' : `${Math.round(stats.data?.completionRate ?? 0)}%`}
                  </p>
                </div>
              </div>

              <p className="inline-flex items-center gap-3 text-xs text-[var(--color-muted)]">
                <span className="inline-flex items-center gap-1">
                  <Calendar size={12} /> {fmtDate(challenge.startDate)} –{' '}
                  {fmtDate(challenge.endDate)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} /> {stats.data ? `${stats.data.duration} days` : '—'}
                </span>
              </p>

              {challenge.rewards ? (
                <p className="rounded-xl border border-[var(--color-line)] p-3 text-sm">
                  <span className="font-semibold">Rewards: </span>
                  {challenge.rewards}
                </p>
              ) : null}

              {joined ? (
                <div className="space-y-3 rounded-xl border border-[var(--color-line)] p-3">
                  <p className="text-sm font-semibold">Your progress</p>
                  <ProgressBar
                    value={myParticipation?.progress ?? 0}
                    goal={challenge.goal}
                  />
                  {isTracked(challenge) ? (
                    <div className="space-y-2">
                      <p className="text-xs text-[var(--color-muted)]">
                        This challenge tracks your logged activity automatically.
                      </p>
                      <Button
                        variant="primary"
                        loading={autoUpdate.isPending}
                        onClick={() => autoUpdate.mutate()}
                      >
                        <TrendingUp size={15} /> Sync my activity
                      </Button>
                    </div>
                  ) : (
                    <form
                      className="flex items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveProgress.mutate();
                      }}
                    >
                      <Input
                        label={`Progress (${challenge.goalUnit})`}
                        type="number"
                        min={0}
                        step="any"
                        value={progressInput}
                        onChange={(e) => setProgressInput(e.target.value)}
                      />
                      <Button type="submit" variant="primary" loading={saveProgress.isPending}>
                        <Check size={15} /> Save
                      </Button>
                    </form>
                  )}
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                {isOwner ? (
                  <>
                    <Button variant="ghost" onClick={() => onEdit(challenge)}>
                      <Edit size={15} /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      className="border-red-500/40 bg-red-500/10 text-red-300"
                      onClick={() => onDelete(challenge)}
                    >
                      <Trash size={15} /> Delete
                    </Button>
                  </>
                ) : null}
                {joined ? (
                  <Button variant="ghost" loading={leave.isPending} onClick={() => leave.mutate()}>
                    Leave challenge
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    loading={join.isPending}
                    disabled={challenge.isActive === false}
                    onClick={() => join.mutate()}
                  >
                    <Plus size={15} /> Join challenge
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

/* -------------------------------------------------------------- list cards */

function ChallengeCard({
  challenge,
  myId,
  onOpen,
}: {
  challenge: Challenge;
  myId: string;
  onOpen: () => void;
}) {
  const participants =
    challenge.stats?.totalParticipants ?? challenge.participants?.length ?? 0;
  const mine = challenge.participants?.find((p) => idOf(p.user) === myId);
  const creator = challenge.createdBy ? userOf(challenge.createdBy) : null;

  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      {challenge.image ? (
        <img
          src={mediaUrl(challenge.image)}
          alt={challenge.title}
          className="h-28 w-full rounded-lg object-cover"
          loading="lazy"
        />
      ) : null}

      <div className="min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-bold">{challenge.title}</h3>
          {challenge.ownership === 'system' ? <Badge tone="info">Official</Badge> : null}
        </div>
        <p className="line-clamp-2 text-xs leading-relaxed text-[var(--color-muted)]">
          {challenge.description}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone="brand" className="capitalize">
          {challenge.type.replace('_', ' ')}
        </Badge>
        <Badge className="capitalize">{challenge.category}</Badge>
        <Badge tone={challenge.isActive === false ? 'neutral' : 'success'}>
          {challenge.isActive === false ? 'Closed' : endsIn(challenge.endDate)}
        </Badge>
      </div>

      {mine ? <ProgressBar value={mine.progress ?? 0} goal={challenge.goal} /> : null}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="flex min-w-0 items-center gap-2">
          {creator ? (
            <Avatar src={creator.avatar} name={displayName(creator)} size={24} />
          ) : null}
          <span className="inline-flex items-center gap-1 truncate text-[11px] text-[var(--color-muted)]">
            <Users size={12} /> {participants} · {challenge.goal} {challenge.goalUnit}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onOpen}>
          View
        </Button>
      </div>
    </Card>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="space-y-3 p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- page */

type TabKey = 'browse' | 'mine' | 'created';

export default function Challenges() {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const myId = me?._id ?? '';

  const [tab, setTab] = useState<TabKey>('browse');
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | ChallengeType>('');
  const [categoryFilter, setCategoryFilter] = useState<'' | ChallengeCategory>('');
  const [myStatus, setMyStatus] = useState<'active' | 'completed' | 'all'>('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Challenge | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Challenge | null>(null);

  const debouncedTerm = useDebounced(term, 400);
  const searching = debouncedTerm.trim().length > 0;

  useEffect(() => {
    setPage(1);
  }, [debouncedTerm, typeFilter, categoryFilter, tab]);

  const browse = useQuery({
    queryKey: [
      'challenges',
      'browse',
      { searching, q: debouncedTerm.trim(), page, typeFilter, categoryFilter },
    ],
    queryFn: async (): Promise<ChallengeListResponse> => {
      const params: Record<string, string | number> = { page, limit: PAGE_LIMIT };
      if (typeFilter) params.type = typeFilter;
      if (categoryFilter) params.category = categoryFilter;
      if (searching) params.q = debouncedTerm.trim();
      const { data } = await api.get<ChallengeListResponse>(
        searching ? '/challenges/search' : '/challenges',
        { params },
      );
      return data;
    },
    enabled: tab === 'browse',
    placeholderData: (prev) => prev,
  });

  const mine = useQuery({
    queryKey: ['challenges', 'user', myStatus],
    queryFn: async (): Promise<Challenge[]> => {
      const { data } = await api.get<ChallengeListResponse>('/challenges/user', {
        params: { status: myStatus },
      });
      return data.challenges ?? [];
    },
    enabled: tab === 'mine' || tab === 'created',
  });

  const createdByMe = useQuery({
    queryKey: ['challenges', 'created', myId],
    queryFn: async (): Promise<Challenge[]> => {
      const collected: Challenge[] = [];
      let current = 1;
      let pages = 1;
      do {
        const { data } = await api.get<ChallengeListResponse>('/challenges', {
          params: { page: current, limit: 50 },
        });
        collected.push(...(data.challenges ?? []));
        pages = data.pagination?.pages ?? 1;
        current += 1;
      } while (current <= pages && current <= 5);
      return collected.filter(
        (c) => c.ownership === 'user' && idOf(c.createdBy) === myId,
      );
    },
    enabled: tab === 'created' && !!myId,
  });

  const remove = useMutation({
    mutationFn: async (challenge: Challenge) => {
      await api.delete(`/challenges/${challenge._id}`);
      return challenge._id;
    },
    onSuccess: (id) => {
      toast.success('Challenge removed');
      qc.invalidateQueries({ queryKey: ['challenges'] });
      setPendingDelete(null);
      if (detailId === id) setDetailId(null);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete challenge')),
  });

  const browseList = browse.data?.challenges ?? [];
  const pagination = browse.data?.pagination;
  const myList = mine.data ?? [];
  const createdList = useMemo(() => {
    const fromMine = myList.filter(
      (c) => c.ownership === 'user' && idOf(c.createdBy) === myId,
    );
    const map = new Map<string, Challenge>();
    for (const c of [...(createdByMe.data ?? []), ...fromMine]) map.set(c._id, c);
    return [...map.values()];
  }, [createdByMe.data, myList, myId]);

  const activePane = (() => {
    if (tab === 'browse') {
      return {
        loading: browse.isLoading,
        error: browse.isError ? browse.error : null,
        retry: () => browse.refetch(),
        items: browseList,
      };
    }
    if (tab === 'mine') {
      return {
        loading: mine.isLoading,
        error: mine.isError ? mine.error : null,
        retry: () => mine.refetch(),
        items: myList,
      };
    }
    return {
      loading: createdByMe.isLoading || mine.isLoading,
      error: createdByMe.isError ? createdByMe.error : mine.isError ? mine.error : null,
      retry: () => {
        createdByMe.refetch();
        mine.refetch();
      },
      items: createdList,
    };
  })();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Challenges</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Compete, stay accountable, and climb the leaderboard.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> Create
        </Button>
      </header>

      <Tabs
        fill
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabs={[
          { key: 'browse', label: 'Browse', icon: <Search size={15} /> },
          { key: 'mine', label: 'My challenges', icon: <Activity size={15} /> },
          { key: 'created', label: 'Created by me', icon: <Trophy size={15} /> },
        ]}
      />

      {tab === 'browse' ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Input
              placeholder="Search challenges…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            {browse.isFetching ? (
              <span className="absolute top-1/2 right-3 -translate-y-1/2">
                <Spinner size={16} />
              </span>
            ) : null}
          </div>
          <select
            className="input-base w-36 capitalize"
            aria-label="Filter by type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as '' | ChallengeType)}
          >
            <option value="">All types</option>
            {CHALLENGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
          <select
            className="input-base w-36 capitalize"
            aria-label="Filter by cadence"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as '' | ChallengeCategory)}
          >
            <option value="">All cadences</option>
            {CHALLENGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      ) : tab === 'mine' ? (
        <div className="flex items-center gap-2">
          <select
            className="input-base w-40 capitalize"
            aria-label="Filter my challenges"
            value={myStatus}
            onChange={(e) => setMyStatus(e.target.value as 'active' | 'completed' | 'all')}
          >
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="all">All</option>
          </select>
        </div>
      ) : null}

      {activePane.loading ? (
        <CardGridSkeleton />
      ) : activePane.error ? (
        <ErrorState
          error={activePane.error}
          title="Could not load challenges"
          retry={activePane.retry}
        />
      ) : activePane.items.length === 0 ? (
        <EmptyState
          icon={<Trophy size={24} />}
          title={
            tab === 'browse'
              ? searching
                ? `No challenges matched “${debouncedTerm.trim()}”`
                : 'No active challenges right now'
              : tab === 'mine'
                ? 'You have not joined a challenge yet'
                : 'You have not created a challenge yet'
          }
          message={
            tab === 'created'
              ? 'Design a challenge, invite your circle, and set the pace.'
              : 'Browse what is running or start your own — the leaderboard is waiting.'
          }
          action={
            tab === 'mine' ? (
              <Button variant="primary" onClick={() => setTab('browse')}>
                Browse challenges
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={16} /> Create a challenge
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {activePane.items.map((challenge) => (
            <ChallengeCard
              key={challenge._id}
              challenge={challenge}
              myId={myId}
              onOpen={() => setDetailId(challenge._id)}
            />
          ))}
        </div>
      )}

      {tab === 'browse' && pagination && pagination.pages > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            disabled={page <= 1 || browse.isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={15} /> Previous
          </Button>
          <span className="text-xs text-[var(--color-muted)]">
            Page {pagination.page} of {pagination.pages} · {pagination.total} total
          </span>
          <Button
            variant="ghost"
            disabled={page >= pagination.pages || browse.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight size={15} />
          </Button>
        </div>
      ) : null}

      <CreateChallengeModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ChallengeDetailModal
        challengeId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(c) => setEditing(c)}
        onDelete={(c) => setPendingDelete(c)}
      />
      <EditChallengeModal challenge={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={!!pendingDelete}
        destructive
        title="Delete this challenge?"
        message={
          pendingDelete
            ? `“${pendingDelete.title}” will be deleted. If it already has participants it is closed out instead, preserving their history.`
            : undefined
        }
        confirmLabel="Delete challenge"
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete);
        }}
      />
    </div>
  );
}
