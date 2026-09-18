import { useEffect, useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isValid, parseISO } from 'date-fns';
import { challengeTimeLeft } from '../lib/challengeTime';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardMedia,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Progress,
  Ring,
  SearchField,
  SegmentedControl,
  Select,
  Skeleton,
  Spinner,
  StatGrid,
  StatTile,
  Switch,
  Tabs,
  Textarea,
  cx,
  formatStat,
  humanize,
  usePulse,
  useToast,
  type BadgeTone,
} from '../components/ui';
import {
  Activity,
  Calendar,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit,
  Flame,
  Medal,
  Plus,
  Search,
  Target,
  Trash,
  TrendingUp,
  Trophy,
  Users,
  Zap,
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

type MyStatus = 'active' | 'completed' | 'all';

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

/** Time-left badge: closed / ended / ending soon (ember) / N left (mint) / "Ends Nov 2036" beyond a year. */
const timeBadge = (c: Challenge): { label: string; tone: BadgeTone; urgent: boolean } => challengeTimeLeft(c);

const pctOf = (value: number, goal: number) => (goal > 0 ? Math.min((value / goal) * 100, 100) : 0);

const toDateInput = (d: Date) => format(d, 'yyyy-MM-dd');

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const typeOptions = (withAll: boolean) => [
  ...(withAll ? [{ value: '', label: 'All types' }] : []),
  ...CHALLENGE_TYPES.map((t) => ({ value: t, label: humanize(t) })),
];
const cadenceOptions = (withAll: boolean) => [
  ...(withAll ? [{ value: '', label: 'All cadences' }] : []),
  ...CHALLENGE_CATEGORIES.map((c) => ({ value: c, label: humanize(c) })),
];

/* ------------------------------------------------------------ progress row */

function MyProgress({
  value,
  goal,
  unit,
  completed,
  compact = false,
}: {
  value: number;
  goal: number;
  unit: GoalUnit;
  completed?: boolean;
  compact?: boolean;
}) {
  const pct = pctOf(value, goal);
  const done = completed || pct >= 100;
  return (
    <div className="space-y-1.5">
      <Progress value={pct} size={compact ? 'sm' : 'md'} tone={done ? 'success' : 'brand'} label="Your progress" />
      <p className="flex items-baseline justify-between gap-2 text-xs text-text-2">
        <span className="tabular">
          {formatStat(value)} / {formatStat(goal)} {humanize(unit).toLowerCase()}
        </span>
        <span className={cx('tabular font-semibold', done ? 'text-brand-text' : 'text-text-1')}>
          {done ? 'Complete' : `${Math.round(pct)}%`}
        </span>
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
  const formId = useId();
  const [form, setForm] = useState<ChallengeForm>(emptyForm);
  const [fieldError, setFieldError] = useState<Partial<Record<keyof ChallengeForm, string>>>({});

  useEffect(() => {
    if (!open) {
      setForm(emptyForm());
      setFieldError({});
    }
  }, [open]);

  const allowedUnits = unitsForType(form.type);

  const create = useMutation({
    mutationFn: async () => {
      const errors: Partial<Record<keyof ChallengeForm, string>> = {};
      const title = form.title.trim();
      const description = form.description.trim();
      if (title.length < 3) errors.title = 'Give it a title of at least 3 characters.';
      if (description.length < 10) errors.description = 'Describe the challenge in at least 10 characters.';
      const goal = Number(form.goal);
      if (!Number.isFinite(goal) || goal <= 0) errors.goal = 'Goal must be a positive number.';
      const maxParticipants = Number(form.maxParticipants);
      if (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 10000) {
        errors.maxParticipants = 'Between 1 and 10,000.';
      }
      const start = new Date(`${form.startDate}T00:00:00`);
      const end = new Date(`${form.endDate}T23:59:59`);
      if (Number.isNaN(start.getTime())) errors.startDate = 'Pick a start date.';
      if (Number.isNaN(end.getTime()) || end <= start) errors.endDate = 'End date must be after the start.';
      setFieldError(errors);
      if (Object.keys(errors).length) throw new Error('Check the highlighted fields.');

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
    onError: (e) => toast.error(errMsg(e, 'Could not create the challenge')),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New challenge"
      description="Set a goal, pick the window, and invite people to chase it with you."
      size="lg"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={create.isPending} icon={<Plus size={18} />}>
            Create challenge
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        noValidate
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
          error={fieldError.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <Textarea
          label="Description"
          rows={3}
          maxLength={2000}
          placeholder="What are people signing up for? Ground rules, how progress counts…"
          value={form.description}
          error={fieldError.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Type"
            value={form.type}
            options={typeOptions(false)}
            onChange={(v) => {
              const type = v as ChallengeType;
              const units = unitsForType(type);
              setForm((f) => ({
                ...f,
                type,
                goalUnit: units.includes(f.goalUnit) ? f.goalUnit : units[0],
              }));
            }}
          />
          <Select
            label="Cadence"
            value={form.category}
            options={cadenceOptions(false)}
            onChange={(v) => setForm({ ...form, category: v as ChallengeCategory })}
          />
          <Select
            label="Goal unit"
            value={form.goalUnit}
            options={allowedUnits.map((u) => ({ value: u, label: humanize(u) }))}
            hint={isTracked({ type: form.type } as Challenge) ? 'Tracked from logged activity' : undefined}
            onChange={(v) => setForm({ ...form, goalUnit: v as GoalUnit })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Input
            label="Goal"
            type="number"
            inputMode="numeric"
            min={1}
            step="1"
            className="tabular"
            value={form.goal}
            error={fieldError.goal}
            onChange={(e) => setForm({ ...form, goal: e.target.value })}
          />
          <Input
            label="Max participants"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            step="1"
            className="tabular"
            value={form.maxParticipants}
            error={fieldError.maxParticipants}
            onChange={(e) => setForm({ ...form, maxParticipants: e.target.value })}
          />
          <DateField
            label="Starts"
            value={form.startDate}
            error={fieldError.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
          <DateField
            label="Ends"
            value={form.endDate}
            min={form.startDate}
            error={fieldError.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
        </div>

        <Input
          label="Tags"
          hint="Comma separated, up to 20"
          placeholder="strength, beginner"
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

        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-1">Public challenge</p>
            <p className="text-xs text-text-2">Public challenges show up in Browse for everyone.</p>
          </div>
          <Switch
            label="Public challenge"
            checked={form.isPublic}
            onChange={(next) => setForm({ ...form, isPublic: next })}
          />
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
  const formId = useId();
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
      if (Object.keys(payload).length === 0) throw new Error('Nothing has changed yet.');

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
    onError: (e) => toast.error(errMsg(e, 'Could not update the challenge')),
  });

  return (
    <Modal
      open={!!challenge}
      onClose={onClose}
      title="Edit challenge"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={update.isPending}>
            Save changes
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate();
        }}
      >
        <Input label="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          label="Description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <DateField
          label="Ends"
          hint="An active challenge with participants can only be extended."
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <Input label="Rewards" maxLength={500} value={rewards} onChange={(e) => setRewards(e.target.value)} />
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-1">Public challenge</p>
            <p className="text-xs text-text-2">Visible in Browse for everyone.</p>
          </div>
          <Switch label="Public challenge" checked={isPublic} onChange={setIsPublic} />
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ leaderboard */

const RANK_STYLE: Record<number, { icon: string; label: string }> = {
  1: { icon: 'text-warning-text', label: 'First place' },
  2: { icon: 'text-text-2', label: 'Second place' },
  3: { icon: 'text-accent-text', label: 'Third place' },
};

function LeaderboardList({ challenge, myId }: { challenge: Challenge; myId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['challenges', 'leaderboard', challenge._id],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const { data } = await api.get<{ success: boolean; leaderboard: LeaderboardEntry[] }>(
        `/challenges/${challenge._id}/leaderboard`,
        { params: { limit: 50 } },
      );
      return data.leaderboard ?? [];
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading leaderboard">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <ErrorState error={error} title="Leaderboard unavailable" retry={() => refetch()} />;
  }
  if (!data?.length) {
    return (
      <EmptyState
        size="sm"
        icon={<Trophy size={24} />}
        title="No ranked athletes yet"
        message="As soon as participants log progress, the leaderboard fills in."
      />
    );
  }

  const myIndex = data.findIndex((e) => idOf(e.user) === myId);

  return (
    <div className="space-y-3">
      {myIndex >= 0 ? (
        <p className="tabular text-xs font-semibold text-text-2">
          You are #{data[myIndex].rank ?? myIndex + 1} of {formatStat(data.length)}
        </p>
      ) : null}
      <ol className="space-y-1.5">
        {data.map((entry, index) => {
          const u = userOf(entry.user);
          const rank = entry.rank ?? index + 1;
          const isMe = u._id === myId;
          const medal = RANK_STYLE[rank];
          const pct = pctOf(entry.progress, challenge.goal);
          return (
            <li
              key={`${u._id}-${rank}`}
              className={cx(
                'flex items-center gap-3 rounded-md px-3 py-2.5',
                isMe ? 'bg-brand-soft' : 'bg-surface-2',
              )}
              aria-current={isMe ? 'true' : undefined}
            >
              <span className="flex w-8 shrink-0 items-center justify-center">
                {medal ? (
                  <Medal size={22} filled className={medal.icon} aria-label={medal.label} aria-hidden={false} role="img" />
                ) : (
                  <span className="type-stat text-base text-text-2">{rank}</span>
                )}
              </span>
              <Avatar src={u.avatar} name={displayName(u)} size="sm" ring={isMe} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-text-1">
                  <span className="truncate">{displayName(u)}</span>
                  {isMe ? <Badge tone="brand" size="sm">You</Badge> : null}
                </p>
                <Progress value={pct} size="sm" tone={pct >= 100 ? 'success' : 'brand'} className="mt-1.5 max-w-48" label={`${displayName(u)} progress`} />
              </div>
              <span className="type-stat shrink-0 text-lg text-text-1">
                {formatStat(entry.progress)}
                <span className="ml-1 text-2xs font-semibold tracking-normal text-text-3 [font-variation-settings:'wdth'_100]">
                  {humanize(challenge.goalUnit).toLowerCase()}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------ detail modal */

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
  const { className: joinPulse, pulse } = usePulse();

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
  const closed = !!challenge && (challenge.isActive === false || timeBadge(challenge).label === 'Ended');
  const participantCount =
    stats.data?.totalParticipants ??
    challenge?.stats?.totalParticipants ??
    challenge?.participants?.length ??
    0;
  const full = !!challenge?.maxParticipants && participantCount >= challenge.maxParticipants;

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
      const others = participantCount;
      toast.success(
        others > 0
          ? `You're in. ${formatStat(others)} ${others === 1 ? 'other is' : 'others are'} training with you.`
          : "You're in. Invite someone to chase it with you.",
      );
      pulse();
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not join the challenge')),
  });

  const leave = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/challenges/${challengeId}/leave`);
      return data;
    },
    onSuccess: () => {
      toast.info('You left the challenge', {
        action: { label: 'Rejoin', onClick: () => join.mutate() },
      });
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not leave the challenge')),
  });

  const saveProgress = useMutation({
    mutationFn: async () => {
      const progress = Number(progressInput);
      if (!Number.isFinite(progress) || progress < 0 || progress > 1_000_000_000) {
        throw new Error('Progress must be a number between 0 and 1,000,000,000.');
      }
      const { data } = await api.put(`/challenges/${challengeId}/progress`, { progress });
      return data;
    },
    onSuccess: () => {
      toast.success('Progress saved');
      pulse();
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save progress')),
  });

  const autoUpdate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ success: boolean; progress: number }>(
        `/challenges/${challengeId}/auto-update`,
      );
      return data.progress;
    },
    onSuccess: (progress) => {
      toast.success(`Synced: ${formatStat(progress)} ${humanize(challenge?.goalUnit).toLowerCase()} logged`);
      pulse();
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not sync your activity')),
  });

  const time = challenge ? timeBadge(challenge) : null;
  const myPct = challenge ? pctOf(myParticipation?.progress ?? 0, challenge.goal) : 0;
  const myDone = !!myParticipation?.completed || myPct >= 100;

  return (
    <Modal
      open={!!challengeId}
      onClose={onClose}
      title={challenge?.title || 'Challenge'}
      description={challenge ? `${humanize(challenge.type)} · ${humanize(challenge.category)}` : undefined}
      size="lg"
      footer={
        challenge && !detail.isLoading ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {isOwner ? (
                <>
                  <Button variant="secondary" onClick={() => onEdit(challenge)} icon={<Edit size={16} />}>
                    Edit
                  </Button>
                  <Button variant="danger" onClick={() => onDelete(challenge)} icon={<Trash size={16} />}>
                    Delete
                  </Button>
                </>
              ) : null}
            </div>
            {joined ? (
              <Button variant="ghost" loading={leave.isPending} onClick={() => leave.mutate()}>
                Leave challenge
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="sm:[--btn-h:44px]"
                loading={join.isPending}
                disabled={closed || full}
                onClick={() => join.mutate()}
                icon={<Plus size={18} />}
              >
                {closed ? 'Challenge closed' : full ? 'Challenge full' : 'Join challenge'}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {detail.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading challenge">
          <Skeleton className="aspect-video w-full rounded-md" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-20 w-full rounded-md" />
        </div>
      ) : detail.isError ? (
        <ErrorState
          error={detail.error}
          title="Could not load this challenge"
          retry={() => detail.refetch()}
        />
      ) : challenge ? (
        <div className="space-y-5">
          {challenge.image ? (
            <CardMedia ratio="16/9">
              <img
                src={mediaUrl(challenge.image)}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </CardMedia>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{humanize(challenge.type)}</Badge>
            <Badge>{humanize(challenge.category)}</Badge>
            {time ? (
              <Badge tone={time.tone} dot={time.urgent}>
                {time.urgent ? <Flame size={12} /> : null}
                {time.label}
              </Badge>
            ) : null}
            {challenge.ownership === 'system' ? <Badge tone="info">Official</Badge> : null}
            {joined ? (
              <Badge tone={myDone ? 'success' : 'brand'} className={joinPulse}>
                <Check size={12} /> {myDone ? 'Completed' : "You're in"}
              </Badge>
            ) : null}
          </div>

          <p className="prose-measure text-sm leading-relaxed text-text-2">{challenge.description}</p>

          <SegmentedControl
            aria-label="Challenge sections"
            fill
            active={pane}
            onChange={(k) => setPane(k as 'overview' | 'leaderboard')}
            tabs={[
              { key: 'overview', label: 'Overview', icon: <Activity size={16} /> },
              { key: 'leaderboard', label: 'Leaderboard', icon: <Trophy size={16} />, count: participantCount || undefined },
            ]}
          />

          {pane === 'leaderboard' ? (
            <LeaderboardList challenge={challenge} myId={myId} />
          ) : (
            <>
              <StatGrid columns={4}>
                <StatTile
                  label="Goal"
                  value={formatStat(challenge.goal)}
                  unit={humanize(challenge.goalUnit).toLowerCase()}
                  icon={<Target size={20} />}
                  tone="brand"
                />
                <StatTile
                  label="Participants"
                  value={formatStat(participantCount)}
                  unit={challenge.maxParticipants ? `of ${formatStat(challenge.maxParticipants)}` : undefined}
                  icon={<Users size={20} />}
                  loading={stats.isLoading && !challenge.stats}
                />
                <StatTile
                  label="Average progress"
                  value={formatStat(stats.data?.averageProgress ?? challenge.stats?.averageProgress ?? 0)}
                  unit={humanize(challenge.goalUnit).toLowerCase()}
                  icon={<TrendingUp size={20} />}
                  loading={stats.isLoading && !challenge.stats}
                />
                <StatTile
                  label="Completion"
                  value={Math.round(stats.data?.completionRate ?? challenge.stats?.completionRate ?? 0)}
                  unit="%"
                  icon={<CheckCircle size={20} />}
                  tone={(stats.data?.completionRate ?? 0) > 0 ? 'accent' : 'neutral'}
                  loading={stats.isLoading && !challenge.stats}
                />
              </StatGrid>

              <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-text-2">
                <li className="inline-flex items-center gap-1.5">
                  <Calendar size={14} /> {fmtDate(challenge.startDate)} to {fmtDate(challenge.endDate)}
                </li>
                <li className="inline-flex items-center gap-1.5 tabular">
                  <Clock size={14} />
                  {stats.data
                    ? `${stats.data.duration} ${stats.data.duration === 1 ? 'day' : 'days'}${
                        stats.data.timeRemaining > 0 ? `, ${formatStat(stats.data.timeRemaining)} remaining` : ''
                      }`
                    : 'Duration pending'}
                </li>
                {challenge.tags?.length ? (
                  <li className="inline-flex flex-wrap items-center gap-1">
                    {challenge.tags.slice(0, 6).map((t) => (
                      <Badge key={t} size="sm">
                        #{t}
                      </Badge>
                    ))}
                  </li>
                ) : null}
              </ul>

              {challenge.rewards ? (
                <Callout tone="brand" icon={<Trophy size={20} className="text-brand" />} title="Rewards">
                  {challenge.rewards}
                </Callout>
              ) : null}

              {joined ? (
                <div className="card space-y-4 p-4">
                  <div className="flex items-center gap-4">
                    <Ring
                      value={myPct}
                      size={88}
                      color={myDone ? 'var(--success)' : 'brand'}
                      label="Your progress"
                      className={joinPulse}
                    >
                      {myDone ? <CheckCircle size={28} className="text-brand" /> : <span className="text-xl">{Math.round(myPct)}%</span>}
                    </Ring>
                    <div className="min-w-0 flex-1">
                      <p className="type-label text-text-2">Your progress</p>
                      <p className="type-stat mt-1 text-2xl text-text-1">
                        {formatStat(myParticipation?.progress ?? 0)}
                        <span className="text-text-3"> / {formatStat(challenge.goal)}</span>
                        <span className="ml-1.5 text-xs font-semibold tracking-normal text-text-2 [font-variation-settings:'wdth'_100]">
                          {humanize(challenge.goalUnit).toLowerCase()}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-text-2">
                        {myDone
                          ? 'Goal reached. Keep logging to climb the board.'
                          : `${formatStat(Math.max(0, challenge.goal - (myParticipation?.progress ?? 0)))} ${humanize(challenge.goalUnit).toLowerCase()} to go.`}
                      </p>
                    </div>
                  </div>

                  {isTracked(challenge) ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                      <p className="text-xs text-text-2">
                        Counts your logged {humanize(challenge.goalUnit).toLowerCase()} automatically.
                      </p>
                      <Button
                        variant="secondary"
                        loading={autoUpdate.isPending}
                        disabled={closed}
                        onClick={() => autoUpdate.mutate()}
                        icon={<TrendingUp size={16} />}
                      >
                        Sync my activity
                      </Button>
                    </div>
                  ) : (
                    <form
                      className="flex items-end gap-2 border-t border-line pt-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveProgress.mutate();
                      }}
                    >
                      <Input
                        label={`Progress in ${humanize(challenge.goalUnit).toLowerCase()}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        className="tabular"
                        containerClassName="flex-1"
                        disabled={closed}
                        value={progressInput}
                        onChange={(e) => setProgressInput(e.target.value)}
                      />
                      <Button type="submit" variant="primary" loading={saveProgress.isPending} disabled={closed} icon={<Check size={16} />}>
                        Save
                      </Button>
                    </form>
                  )}
                </div>
              ) : closed ? (
                <Callout tone="info" title="This challenge has ended">
                  Check the leaderboard for the final standings, or browse what is running now.
                </Callout>
              ) : null}
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
  const time = timeBadge(challenge);
  const done = !!mine && (mine.completed || pctOf(mine.progress ?? 0, challenge.goal) >= 100);

  return (
    <Card
      interactive
      padded={false}
      className={cx('relative flex h-full flex-col gap-3 p-4', done && 'border-brand/30')}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${challenge.title}: open challenge`}
        className="absolute inset-0 z-[1] rounded-[inherit]"
      />

      {challenge.image ? (
        <CardMedia ratio="16/9">
          <img
            src={mediaUrl(challenge.image)}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </CardMedia>
      ) : null}

      <div className="min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="line-clamp-2 text-md font-semibold text-text-1">{challenge.title}</h2>
          {challenge.ownership === 'system' ? <Badge tone="info">Official</Badge> : null}
        </div>
        <p className="line-clamp-2 text-xs leading-5 text-text-2">{challenge.description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="brand">{humanize(challenge.type)}</Badge>
        <Badge>{humanize(challenge.category)}</Badge>
        <Badge tone={time.tone} dot={time.urgent}>
          {time.urgent ? <Flame size={12} /> : null}
          {time.label}
        </Badge>
      </div>

      {mine ? (
        <MyProgress
          value={mine.progress ?? 0}
          goal={challenge.goal}
          unit={challenge.goalUnit}
          completed={mine.completed}
          compact
        />
      ) : (
        <p className="tabular text-xs text-text-2">
          Goal: <span className="font-semibold text-text-1">{formatStat(challenge.goal)}</span>{' '}
          {humanize(challenge.goalUnit).toLowerCase()}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-text-2">
          {creator ? <Avatar src={creator.avatar} name={displayName(creator)} size="xs" /> : null}
          <span className="inline-flex items-center gap-1 truncate tabular">
            <Users size={14} /> {formatStat(participants)}
            {challenge.maxParticipants ? ` / ${formatStat(challenge.maxParticipants)}` : ''}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-text-2">
          {mine ? (done ? 'Completed' : 'Joined') : 'View'} <ChevronRight size={14} />
        </span>
      </div>
    </Card>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading challenges">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <div className="flex gap-1.5">
            <Skeleton className="h-6 w-20 rounded-xs" />
            <Skeleton className="h-6 w-16 rounded-xs" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
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
  const [myStatus, setMyStatus] = useState<MyStatus>('active');
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

  /* Everything I am in, for the summary tiles and the status counts. */
  const mineAll = useQuery({
    queryKey: ['challenges', 'user', 'all'],
    queryFn: async (): Promise<Challenge[]> => {
      const { data } = await api.get<ChallengeListResponse>('/challenges/user', {
        params: { status: 'all' },
      });
      return data.challenges ?? [];
    },
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
      toast.success('Challenge deleted');
      qc.invalidateQueries({ queryKey: ['challenges'] });
      setPendingDelete(null);
      if (detailId === id) setDetailId(null);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete the challenge')),
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

  /* Summary derived from every challenge I am part of. */
  const summary = useMemo(() => {
    const all = mineAll.data ?? [];
    let active = 0;
    let completed = 0;
    let pctSum = 0;
    let pctCount = 0;
    let urgent = 0;
    for (const c of all) {
      const p = c.participants?.find((x) => idOf(x.user) === myId);
      const pct = pctOf(p?.progress ?? 0, c.goal);
      const done = !!p?.completed || pct >= 100;
      const t = timeBadge(c);
      const open = c.isActive !== false && t.label !== 'Ended';
      if (done) completed += 1;
      else if (open) {
        active += 1;
        pctSum += pct;
        pctCount += 1;
        if (t.urgent) urgent += 1;
      }
    }
    return {
      total: all.length,
      active,
      completed,
      avgPct: pctCount ? Math.round(pctSum / pctCount) : 0,
      urgent,
    };
  }, [mineAll.data, myId]);

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

  const browseFiltersActive = Boolean(typeFilter || categoryFilter);
  const clearBrowseFilters = () => {
    setTerm('');
    setTypeFilter('');
    setCategoryFilter('');
  };

  const emptyCopy = (() => {
    if (tab === 'browse') {
      if (searching) {
        return {
          variant: 'no-results' as const,
          title: `No challenges match “${debouncedTerm.trim()}”`,
          message: 'Try a shorter search, or start the challenge you were looking for.',
          action: { label: 'Clear search', onClick: clearBrowseFilters, variant: 'secondary' as const },
          secondary: { label: 'New challenge', onClick: () => setCreateOpen(true), icon: <Plus size={18} /> },
        };
      }
      if (browseFiltersActive) {
        return {
          variant: 'no-results' as const,
          title: 'Nothing running with those filters',
          message: 'Widen the type or cadence filter to see more.',
          action: { label: 'Clear filters', onClick: clearBrowseFilters },
          secondary: undefined,
        };
      }
      return {
        variant: 'first-run' as const,
        title: 'No public challenges right now',
        message: 'Be the first: set a goal, pick a window, and invite your circle.',
        action: { label: 'New challenge', onClick: () => setCreateOpen(true), icon: <Plus size={18} /> },
        secondary: undefined,
      };
    }
    if (tab === 'mine') {
      if (myStatus === 'completed') {
        return {
          variant: 'first-run' as const,
          title: 'No completed challenges yet',
          message: 'Finish an active challenge and it lands here.',
          action: { label: 'See active', onClick: () => setMyStatus('active'), variant: 'secondary' as const },
          secondary: undefined,
        };
      }
      return {
        variant: 'first-run' as const,
        title: 'You have not joined a challenge yet',
        message: 'Pick one from Browse and the leaderboard starts counting you in.',
        action: { label: 'Browse challenges', onClick: () => setTab('browse'), icon: <Search size={18} /> },
        secondary: { label: 'New challenge', onClick: () => setCreateOpen(true), icon: <Plus size={18} />, variant: 'secondary' as const },
      };
    }
    return {
      variant: 'first-run' as const,
      title: 'You have not created a challenge yet',
      message: 'Design one, invite your circle, and set the pace.',
      action: { label: 'New challenge', onClick: () => setCreateOpen(true), icon: <Plus size={18} /> },
      secondary: undefined,
    };
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Challenges"
        subtitle="Compete, stay accountable, and climb the leaderboard."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)} icon={<Plus size={18} />}>
            New challenge
          </Button>
        }
        mobileActions={
          <IconButton label="New challenge" onClick={() => setCreateOpen(true)}>
            <Plus size={22} />
          </IconButton>
        }
      />

      <StatGrid columns={4}>
        <StatTile
          label="Active"
          value={summary.active}
          icon={<Zap size={20} />}
          tone="brand"
          loading={mineAll.isLoading}
          hint={summary.urgent > 0 ? `${summary.urgent} ending soon` : summary.active ? 'In progress' : 'Join one to start'}
          onClick={() => {
            setTab('mine');
            setMyStatus('active');
          }}
        />
        <StatTile
          label="Completed"
          value={summary.completed}
          icon={<Trophy size={20} />}
          loading={mineAll.isLoading}
          hint={summary.total ? `of ${summary.total} joined` : undefined}
          onClick={() => {
            setTab('mine');
            setMyStatus('completed');
          }}
        />
        <StatTile
          label="Average progress"
          value={summary.avgPct}
          unit="%"
          icon={<TrendingUp size={20} />}
          tone={summary.avgPct >= 50 ? 'accent' : 'neutral'}
          loading={mineAll.isLoading}
          hint={summary.active ? 'Across active challenges' : 'No active challenges'}
        />
        <StatTile
          label="Ending soon"
          value={summary.urgent}
          icon={<Flame size={20} />}
          tone={summary.urgent > 0 ? 'accent' : 'neutral'}
          loading={mineAll.isLoading}
          hint={summary.urgent > 0 ? 'Within 2 days, push now' : 'Nothing closing this week'}
        />
      </StatGrid>

      <Tabs
        aria-label="Challenge lists"
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabs={[
          { key: 'browse', label: 'Browse', icon: <Search size={16} /> },
          { key: 'mine', label: 'My challenges', icon: <Activity size={16} />, count: summary.total || undefined },
          { key: 'created', label: 'Created by me', icon: <Edit size={16} /> },
        ]}
      />

      {tab === 'browse' ? (
        <div className="flex flex-wrap items-end gap-3">
          <SearchField
            label="Search challenges"
            hideLabel
            placeholder="Search challenges"
            containerClassName="min-w-56 flex-1"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <Select
            label="Type"
            hideLabel
            aria-label="Filter by type"
            containerClassName="w-[calc(50%-6px)] sm:w-44"
            value={typeFilter}
            options={typeOptions(true)}
            onChange={(v) => setTypeFilter(v as '' | ChallengeType)}
          />
          <Select
            label="Cadence"
            hideLabel
            aria-label="Filter by cadence"
            containerClassName="w-[calc(50%-6px)] sm:w-44"
            value={categoryFilter}
            options={cadenceOptions(true)}
            onChange={(v) => setCategoryFilter(v as '' | ChallengeCategory)}
          />
          {browseFiltersActive || term ? (
            <Button variant="ghost" onClick={clearBrowseFilters}>
              Clear
            </Button>
          ) : null}
          {browse.isFetching && !browse.isLoading ? (
            <span className="inline-flex h-11 items-center" aria-live="polite" aria-label="Refreshing">
              <Spinner size={16} />
            </span>
          ) : null}
        </div>
      ) : tab === 'mine' ? (
        <SegmentedControl
          aria-label="Filter my challenges"
          active={myStatus}
          onChange={(k) => setMyStatus(k as MyStatus)}
          tabs={[
            { key: 'active', label: 'Active', count: summary.active || undefined },
            { key: 'completed', label: 'Completed', count: summary.completed || undefined },
            { key: 'all', label: 'All' },
          ]}
        />
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
          variant={emptyCopy.variant}
          title={emptyCopy.title}
          message={emptyCopy.message}
          action={emptyCopy.action}
          secondaryAction={emptyCopy.secondary}
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
        <nav className="flex items-center justify-between gap-3 sm:justify-center" aria-label="Pagination">
          <Button
            variant="secondary"
            disabled={page <= 1 || browse.isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            icon={<ChevronLeft size={16} />}
          >
            Previous
          </Button>
          <span className="tabular text-xs font-semibold text-text-2">
            Page {pagination.page} of {pagination.pages}
            <span className="hidden sm:inline"> · {formatStat(pagination.total)} challenges</span>
          </span>
          <Button
            variant="secondary"
            disabled={page >= pagination.pages || browse.isFetching}
            onClick={() => setPage((p) => p + 1)}
            iconRight={<ChevronRight size={16} />}
          >
            Next
          </Button>
        </nav>
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
            ? `“${pendingDelete.title}” will be deleted. If it already has participants it is closed out instead, so their history is kept.`
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
