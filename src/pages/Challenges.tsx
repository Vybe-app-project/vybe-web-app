import { useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format, isValid, parseISO } from 'date-fns';
import { api, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  CHALLENGE_MAX_DAYS_DEFAULT,
  CHALLENGE_TYPE_UNAVAILABLE,
  checkChallengeType,
  checkCreateWindow,
  checkEndDate,
  humanEndDateMessage,
  isWeightScored,
  mapChallengeError,
  type ChallengeField,
} from '../lib/challengeRules';
import {
  formatChallengeWindow,
  pluralUnit,
  remainingLabel,
  timeBadgeFor,
  unitLabel,
  windowDays,
  withUnit,
  type TimeBadge,
} from '../lib/challengeFormat';
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
  Lock,
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
import { ContextualInviteButton } from './InviteLinkSheet';

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
  /** Absent on a legacy weight-scored challenge: the API redacts every progress number there. */
  progress?: number;
  lastUpdated?: string;
  completed?: boolean;
};

type LeaderboardEntry = {
  user: ChallengeUser | string;
  progress?: number;
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
  /** What a `custom` unit is called; printed after every number. */
  goalUnitLabel?: string;
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
  /** A legacy weight-scored challenge keeps only the head count here. */
  stats?: {
    totalParticipants: number;
    totalProgress?: number;
    averageProgress?: number;
    completionRate?: number;
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
  /** Milliseconds (legacy). */
  timeRemaining: number;
  timeRemainingDays?: number;
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

/**
 * What the create form offers. The API refuses anything scored on body
 * weight (type weight_loss, unit pounds) with CHALLENGE_TYPE_UNAVAILABLE and
 * answers an empty board for that type filter, so neither is offered. The
 * unions above keep both so legacy documents still render as what they are.
 */
const CREATABLE_TYPES: ChallengeType[] = CHALLENGE_TYPES.filter((t) => !isWeightScored({ type: t }));
const CREATABLE_UNITS: GoalUnit[] = GOAL_UNITS.filter((u) => !isWeightScored({ goalUnit: u }));

const unitsForType = (type: ChallengeType): GoalUnit[] =>
  TRACKED_GOAL_UNITS[type] ?? CREATABLE_UNITS;

const isTracked = (c: Challenge) => Boolean(TRACKED_GOAL_UNITS[c.type]);

const PAGE_LIMIT = 12;

type MyStatus = 'active' | 'completed' | 'all';

/* -------------------------------------------------------------- utilities */

const idOf = (value: ChallengeUser | string | null | undefined): string =>
  typeof value === 'string' ? value : (value?._id ?? '');

const userOf = (value: ChallengeUser | string): ChallengeUser =>
  typeof value === 'string' ? { _id: value } : value;

const displayName = (u: ChallengeUser) => u.fullName || u.username || 'Vybe athlete';

/** Time-left badge: Closed / Ended / Ends today / N days left (ember) / N weeks left / Ongoing. */
const timeBadge = (c: Challenge): TimeBadge & { tone: BadgeTone } => timeBadgeFor(c);

/** The unit word for a challenge: "workouts", the creator's label for a custom unit, or nothing. */
const unitOf = (c: Pick<Challenge, 'goalUnit' | 'goalUnitLabel'>) => unitLabel(c.goalUnit, c.goalUnitLabel);

const pctOf = (value: number, goal: number) => (goal > 0 ? Math.min((value / goal) * 100, 100) : 0);

const toDateInput = (d: Date) => format(d, 'yyyy-MM-dd');

/**
 * Latest end the picker offers for a start: the day before CHALLENGE_MAX_DAYS
 * elapse. The forms send the end as local T23:59:59, so a full 365 calendar
 * days would be 365 d + 23:59:59 and the API refuses it; this max is a
 * convenience for the picker and `checkEndDate` on the exact instants is the
 * rule.
 */
const maxEndInput = (startInput: string | undefined): string | undefined => {
  if (!startInput) return undefined;
  const start = new Date(`${startInput}T00:00:00`);
  return Number.isNaN(start.getTime()) ? undefined : toDateInput(addDays(start, CHALLENGE_MAX_DAYS_DEFAULT - 1));
};

const responseData = (e: unknown): unknown => (e as { response?: { data?: unknown } } | undefined)?.response?.data;

/** A toast sentence for a failed challenge call: the API body through the mapper, our own thrown Error as is, never a raw server string. */
const challengeErrorMessage = (e: unknown, fallback: string): string => {
  const response = (e as { response?: { data?: unknown } } | undefined)?.response;
  if (response) return mapChallengeError(response.data, fallback).message;
  return e instanceof Error && e.message ? e.message : fallback;
};

/** Stable ids on the create form so a refusal, ours or the API's, can land focus on the field it names. */
const CREATE_FIELD_IDS: Record<ChallengeField, string> = {
  title: 'ch-title',
  description: 'ch-description',
  type: 'ch-type',
  category: 'ch-cadence',
  goalUnit: 'ch-goal-unit',
  goalUnitLabel: 'ch-goal-unit-label',
  goal: 'ch-goal',
  maxParticipants: 'ch-max',
  startDate: 'ch-starts',
  endDate: 'ch-ends',
  tags: 'ch-tags',
  rewards: 'ch-rewards',
};

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
  ...CREATABLE_TYPES.map((t) => ({ value: t, label: humanize(t) })),
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
  /** Already resolved with `unitOf`; empty when a custom unit has no label. */
  unit: string;
  completed?: boolean;
  compact?: boolean;
}) {
  const pct = pctOf(value, goal);
  const done = completed || pct >= 100;
  return (
    <div className="space-y-1.5">
      <Progress value={pct} size={compact ? 'sm' : 'md'} tone={done ? 'success' : 'brand'} label="Your progress" />
      <p className="flex items-baseline justify-between gap-2 text-xs text-text-2">
        <span className="tabular">{withUnit(`${formatStat(value)} / ${formatStat(goal)}`, unit)}</span>
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
  goalUnitLabel: string;
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
    goalUnitLabel: '',
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

  /** Every edit clears that field's error, so a corrected field stops being flagged immediately. */
  const setField = <K extends keyof ChallengeForm>(key: K, value: ChallengeForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldError((errors) => (errors[key] ? { ...errors, [key]: undefined } : errors));
  };

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
      // The exact instants the API will judge: local start of day and local end of day.
      const start = new Date(`${form.startDate}T00:00:00`);
      const end = new Date(`${form.endDate}T23:59:59`);
      if (Number.isNaN(start.getTime())) errors.startDate = 'Pick a start date.';
      const endRule = checkEndDate({ startDate: start, endDate: form.endDate ? end : '' });
      if (endRule) errors.endDate = humanEndDateMessage(endRule.message);
      else if (!errors.startDate) {
        const bounds = checkCreateWindow({ startDate: start, endDate: end });
        if (bounds) errors[bounds.field] = bounds.message;
      }
      const typeRule = checkChallengeType({ type: form.type, goalUnit: form.goalUnit });
      if (typeRule) errors[typeRule.field] = typeRule.message;
      else if (!allowedUnits.includes(form.goalUnit)) errors.goalUnit = 'That unit is not tracked for this type. Pick another unit.';
      if (form.goalUnit === 'custom' && form.goalUnitLabel.trim().length > 30) errors.goalUnitLabel = 'Keep the unit under 30 characters.';
      setFieldError(errors);
      if (Object.keys(errors).length) throw Object.assign(new Error('Check the highlighted fields.'), { validation: true });

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
        ...(form.goalUnit === 'custom' && form.goalUnitLabel.trim() ? { goalUnitLabel: form.goalUnitLabel.trim() } : {}),
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
    // Validation toasts share a key so repeated taps replace the toast
    // rather than stacking three copies over the sheet footer.
    onError: (e) => {
      if ((e as { validation?: boolean })?.validation) {
        toast.error(challengeErrorMessage(e, 'Check the highlighted fields.'), undefined, { key: 'challenge-validation' });
        return;
      }
      // A refusal that names a field lands under it, with focus; anything else is a toast in plain words.
      const m = mapChallengeError(responseData(e), 'Could not create the challenge');
      if (m.kind === 'field') {
        setFieldError((x) => ({ ...x, [m.field]: m.message }));
        document.getElementById(CREATE_FIELD_IDS[m.field])?.focus();
        return;
      }
      toast.error(m.message);
    },
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
          id={CREATE_FIELD_IDS.title}
          label="Title"
          placeholder="e.g. 5 workouts this week"
          maxLength={120}
          value={form.title}
          error={fieldError.title}
          onChange={(e) => setField('title', e.target.value)}
        />
        <Textarea
          id={CREATE_FIELD_IDS.description}
          label="Description"
          rows={3}
          maxLength={2000}
          placeholder="What are people signing up for? Ground rules, how progress counts…"
          value={form.description}
          error={fieldError.description}
          onChange={(e) => setField('description', e.target.value)}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            id={CREATE_FIELD_IDS.type}
            label="Type"
            value={form.type}
            options={typeOptions(false)}
            error={fieldError.type}
            onChange={(v) => {
              const type = v as ChallengeType;
              const units = unitsForType(type);
              setForm((f) => ({
                ...f,
                type,
                goalUnit: units.includes(f.goalUnit) ? f.goalUnit : units[0],
              }));
              setFieldError((errors) => (errors.type || errors.goalUnit ? { ...errors, type: undefined, goalUnit: undefined } : errors));
            }}
          />
          <Select
            id={CREATE_FIELD_IDS.category}
            label="Cadence"
            value={form.category}
            options={cadenceOptions(false)}
            error={fieldError.category}
            onChange={(v) => setField('category', v as ChallengeCategory)}
          />
          <Select
            id={CREATE_FIELD_IDS.goalUnit}
            label="Goal unit"
            value={form.goalUnit}
            options={allowedUnits.map((u) => ({ value: u, label: humanize(u) }))}
            hint={isTracked({ type: form.type } as Challenge) ? 'Tracked from logged activity' : undefined}
            error={fieldError.goalUnit}
            onChange={(v) => setField('goalUnit', v as GoalUnit)}
          />
        </div>
        {form.goalUnit === 'custom' ? (
          <Input
            id={CREATE_FIELD_IDS.goalUnitLabel}
            label="Unit name"
            hint="What are people counting? Shown after every number, e.g. “40 / 100 pull-ups”."
            placeholder="pull-ups"
            maxLength={30}
            value={form.goalUnitLabel}
            error={fieldError.goalUnitLabel}
            onChange={(e) => setField('goalUnitLabel', e.target.value)}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Input
            id={CREATE_FIELD_IDS.goal}
            label="Goal"
            type="number"
            inputMode="numeric"
            min={1}
            step="1"
            className="tabular"
            value={form.goal}
            error={fieldError.goal}
            onChange={(e) => setField('goal', e.target.value)}
          />
          <Input
            id={CREATE_FIELD_IDS.maxParticipants}
            label="Max participants"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            step="1"
            className="tabular"
            value={form.maxParticipants}
            error={fieldError.maxParticipants}
            onChange={(e) => setField('maxParticipants', e.target.value)}
          />
          <DateField
            id={CREATE_FIELD_IDS.startDate}
            label="Starts"
            value={form.startDate}
            min={toDateInput(new Date())}
            error={fieldError.startDate}
            onChange={(e) => setField('startDate', e.target.value)}
          />
          <DateField
            id={CREATE_FIELD_IDS.endDate}
            label="Ends"
            hint="Up to a year long."
            value={form.endDate}
            min={form.startDate}
            max={maxEndInput(form.startDate)}
            error={fieldError.endDate}
            onChange={(e) => setField('endDate', e.target.value)}
          />
        </div>

        <Input
          id={CREATE_FIELD_IDS.tags}
          label="Tags"
          hint="Comma separated, up to 20"
          placeholder="strength, beginner"
          value={form.tags}
          onChange={(e) => setField('tags', e.target.value)}
        />
        <Input
          id={CREATE_FIELD_IDS.rewards}
          label="Rewards"
          placeholder="Bragging rights, a badge, a rest day…"
          maxLength={500}
          value={form.rewards}
          onChange={(e) => setField('rewards', e.target.value)}
        />

        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-1">Public challenge</p>
            <p className="text-xs text-text-2">Public challenges show up in Browse for everyone.</p>
          </div>
          <Switch
            label="Public challenge"
            checked={form.isPublic}
            onChange={(next) => setField('isPublic', next)}
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
  const [goalUnitLabel, setGoalUnitLabel] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [fieldError, setFieldError] = useState<{ endDate?: string }>({});

  useEffect(() => {
    if (!challenge) return;
    setTitle(challenge.title);
    setDescription(challenge.description);
    const end = parseISO(challenge.endDate);
    setEndDate(isValid(end) ? toDateInput(end) : '');
    setRewards(challenge.rewards ?? '');
    setGoalUnitLabel(challenge.goalUnitLabel ?? '');
    setIsPublic(challenge.isPublic !== false);
    setFieldError({});
  }, [challenge]);

  // The end date is judged from the stored start, on patch as on create.
  const storedStart = challenge ? parseISO(challenge.startDate) : null;
  const startInput = storedStart && isValid(storedStart) ? toDateInput(storedStart) : undefined;
  // Once people have joined the end can only move later, so the picker's
  // floor is the stored end (or the start, whichever is later), not the start.
  const minEndInput = (() => {
    if (!challenge) return startInput;
    const original = parseISO(challenge.endDate);
    if ((challenge.participants?.length ?? 0) === 0 || !isValid(original)) return startInput;
    const floor = storedStart && isValid(storedStart) && storedStart > original ? storedStart : original;
    return toDateInput(floor);
  })();

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
        // The API's end-date rule measured from the stored start, then its two patch-only rules.
        const end = new Date(`${endDate}T23:59:59`);
        const start = parseISO(challenge.startDate);
        const rule = checkEndDate({ startDate: isValid(start) ? start : null, endDate: end });
        const refusal = rule
          ? humanEndDateMessage(rule.message)
          : end <= new Date()
            ? 'Pick an end date in the future.'
            : (challenge.participants?.length ?? 0) > 0 && isValid(original) && end < original
              ? humanEndDateMessage('An active challenge with participants can only be extended')
              : null;
        if (refusal) {
          setFieldError({ endDate: refusal });
          throw Object.assign(new Error('Check the highlighted fields.'), { validation: true });
        }
        payload.endDate = end.toISOString();
      }
      if ((rewards.trim() || '') !== (challenge.rewards ?? '')) payload.rewards = rewards.trim();
      if (challenge.goalUnit === 'custom' && goalUnitLabel.trim() !== (challenge.goalUnitLabel ?? '')) {
        payload.goalUnitLabel = goalUnitLabel.trim();
      }
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
    onError: (e) => {
      if ((e as { validation?: boolean })?.validation) {
        toast.error(challengeErrorMessage(e, 'Check the highlighted fields.'), undefined, { key: 'challenge-validation' });
        document.getElementById('ch-edit-ends')?.focus();
        return;
      }
      const m = mapChallengeError(responseData(e), 'Could not update the challenge');
      if (m.kind === 'field' && m.field === 'endDate') {
        setFieldError({ endDate: m.message });
        document.getElementById('ch-edit-ends')?.focus();
        return;
      }
      toast.error(m.message);
    },
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
          id="ch-edit-ends"
          label="Ends"
          hint="Up to a year after the start. Once people have joined, the end can only move later."
          value={endDate}
          min={minEndInput}
          max={maxEndInput(startInput)}
          error={fieldError.endDate}
          onChange={(e) => {
            setEndDate(e.target.value);
            setFieldError({});
          }}
        />
        <Input label="Rewards" maxLength={500} value={rewards} onChange={(e) => setRewards(e.target.value)} />
        {challenge?.goalUnit === 'custom' ? (
          <Input
            label="Unit name"
            hint="Shown after every number, e.g. “40 / 100 pull-ups”."
            placeholder="pull-ups"
            maxLength={30}
            value={goalUnitLabel}
            onChange={(e) => setGoalUnitLabel(e.target.value)}
          />
        ) : null}
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
          const pct = pctOf(entry.progress ?? 0, challenge.goal);
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
                {formatStat(entry.progress ?? 0)}
                {unitOf(challenge) ? (
                  <span className="ml-1 text-2xs font-semibold tracking-normal text-text-3 [font-variation-settings:'wdth'_100]">
                    {unitOf(challenge)}
                  </span>
                ) : null}
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

  const challenge = detail.data;
  // A legacy weight-scored challenge: the API blanks its board (no progress
  // numbers, an empty leaderboard, the head count only) and answers 404 on
  // /leaderboard and /stats, so neither is asked for and nothing here treats
  // that as a failure. It can still be left, and its creator can still close it.
  const legacy = !!challenge && isWeightScored(challenge);

  const stats = useQuery({
    queryKey: ['challenges', 'stats', challengeId],
    queryFn: async (): Promise<ChallengeStats> => {
      const { data } = await api.get<{ success: boolean; stats: ChallengeStats }>(
        `/challenges/${challengeId}/stats`,
      );
      return data.stats;
    },
    enabled: !!challengeId && !legacy,
  });
  const myId = me?._id ?? '';
  const myParticipation = challenge?.participants?.find((p) => idOf(p.user) === myId);
  const joined = !!myParticipation;
  const isOwner =
    !!challenge && challenge.ownership === 'user' && idOf(challenge.createdBy) === myId;
  const closed = !!challenge && ['closed', 'ended'].includes(timeBadge(challenge).state);
  // isActive false means the owner already closed it: the history is kept and
  // there is nothing left for the owner to edit or remove.
  const archived = challenge?.isActive === false;
  const hasParticipants = (challenge?.participants?.length ?? 0) > 0;
  const unit = challenge ? unitOf(challenge) : '';
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

  /** Plain words in the toast; a CHALLENGE_TYPE_UNAVAILABLE answer also refreshes the view into its no-longer-scored state. */
  const onChallengeError = (e: unknown, fallback: string) => {
    const response = (e as { response?: { data?: unknown } } | undefined)?.response;
    if (!response) {
      toast.error(challengeErrorMessage(e, fallback));
      return;
    }
    const m = mapChallengeError(response.data, fallback);
    toast.error(m.message);
    if (m.code === CHALLENGE_TYPE_UNAVAILABLE) invalidate();
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
    onError: (e) => onChallengeError(e, 'Could not join the challenge'),
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
    onError: (e) => onChallengeError(e, 'Could not leave the challenge'),
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
    onError: (e) => onChallengeError(e, 'Could not save progress'),
  });

  const autoUpdate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ success: boolean; progress: number }>(
        `/challenges/${challengeId}/auto-update`,
      );
      return data.progress;
    },
    onSuccess: (progress) => {
      toast.success(`Synced: ${withUnit(formatStat(progress), unit ? pluralUnit(unit, progress) : 'logged')}${unit ? ' logged' : ''}`);
      pulse();
      invalidate();
    },
    onError: (e) => onChallengeError(e, 'Could not sync your activity'),
  });

  const time = challenge ? timeBadge(challenge) : null;
  const myPct = challenge ? pctOf(myParticipation?.progress ?? 0, challenge.goal) : 0;
  const left = Math.max(0, (challenge?.goal ?? 0) - (myParticipation?.progress ?? 0));
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
              {/* Wave F: a contextual invite link (behind features.invites; POST /invites) for a participant or the creator of an open, public, scored challenge. */}
              {(joined || isOwner) && !legacy && !archived && challenge.isPublic !== false ? (
                <ContextualInviteButton kind="challenge" targetId={challenge._id} targetName={challenge.title} />
              ) : null}
              {isOwner && !archived ? (
                <>
                  <Button variant="secondary" onClick={() => onEdit(challenge)} icon={<Edit size={16} />}>
                    Edit
                  </Button>
                  {/* A joined challenge is closed, never deleted; the button says which. */}
                  <Button
                    variant="danger"
                    onClick={() => onDelete(challenge)}
                    icon={hasParticipants ? <Lock size={16} /> : <Trash size={16} />}
                  >
                    {hasParticipants ? 'Close challenge' : 'Delete'}
                  </Button>
                </>
              ) : isOwner ? (
                <p className="text-sm text-text-3">Closed. Participants keep their history.</p>
              ) : null}
            </div>
            {joined ? (
              <Button variant="ghost" loading={leave.isPending} onClick={() => leave.mutate()}>
                Leave challenge
              </Button>
            ) : legacy ? (
              <p className="text-sm text-text-3">No longer open to join.</p>
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

          {legacy ? (
            <Callout tone="info" title="This challenge is no longer scored">
              {/* Only say what this viewer can do: Leave shows when joined, Close when the creator has not closed it yet. */}
              {[
                'Vybe does not run challenges scored on body weight.',
                joined && isOwner && !archived
                  ? 'You can still leave it or close it.'
                  : joined
                    ? 'You can still leave it.'
                    : isOwner && !archived
                      ? 'You can still close it.'
                      : null,
              ]
                .filter(Boolean)
                .join(' ')}
            </Callout>
          ) : null}

          {pane === 'leaderboard' ? (
            legacy ? (
              <EmptyState size="sm" icon={<Trophy size={24} />} title="No leaderboard" message="Progress is not shown for this challenge." />
            ) : (
              <LeaderboardList challenge={challenge} myId={myId} />
            )
          ) : (
            <>
              <StatGrid columns={legacy ? 2 : 4}>
                <StatTile
                  label="Goal"
                  value={formatStat(challenge.goal)}
                  unit={unit || undefined}
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
                {legacy ? null : (
                  <>
                    <StatTile
                      label="Average progress"
                      value={formatStat(stats.data?.averageProgress ?? challenge.stats?.averageProgress ?? 0)}
                      unit={unit || undefined}
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
                  </>
                )}
              </StatGrid>

              <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-text-2">
                <li className="inline-flex items-center gap-1.5">
                  <Calendar size={14} /> {formatChallengeWindow(challenge.startDate, challenge.endDate)}
                </li>
                <li className="inline-flex items-center gap-1.5 tabular">
                  <Clock size={14} />
                  {(() => {
                    const days = stats.data?.duration ?? windowDays(challenge.startDate, challenge.endDate);
                    const left = remainingLabel(challenge.endDate);
                    const span = days >= 365 ? `${Math.round(days / 365)}-year window` : `${formatStat(days)} ${days === 1 ? 'day' : 'days'}`;
                    return left ? `${span}, ${left}` : span;
                  })()}
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

              {joined && !legacy ? (
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
                        {unit ? (
                          <span className="ml-1.5 text-xs font-semibold tracking-normal text-text-2 [font-variation-settings:'wdth'_100]">{unit}</span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-xs text-text-2">
                        {myDone
                          ? 'Goal reached. Keep logging to climb the board.'
                          : `${withUnit(formatStat(left), pluralUnit(unit, left))} to go.`}
                      </p>
                    </div>
                  </div>

                  {isTracked(challenge) ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                      <p className="text-xs text-text-2">
                        Counts your logged {unit || 'activity'} automatically. Saving a session updates this for you.
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
                        label={unit ? `Progress in ${unit}` : 'Your progress'}
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
              ) : closed && !legacy ? (
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
          unit={unitOf(challenge)}
          completed={mine.completed}
          compact
        />
      ) : (
        <p className="tabular text-xs text-text-2">
          Goal: <span className="font-semibold text-text-1">{formatStat(challenge.goal)}</span>
          {unitOf(challenge) ? ` ${unitOf(challenge)}` : ''}
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
  // Search results and shared links land on /challenges?open=<id>.
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailId, setDetailId] = useState<string | null>(() => searchParams.get('open'));
  useEffect(() => {
    const open = searchParams.get('open');
    if (open) setDetailId(open);
  }, [searchParams]);
  const [editing, setEditing] = useState<Challenge | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Challenge | null>(null);
  const pendingHasParticipants = (pendingDelete?.participants?.length ?? 0) > 0;

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

  /* Everything I created, including closed challenges the active list drops. */
  const createdByMe = useQuery({
    queryKey: ['challenges', 'created', myId],
    queryFn: async (): Promise<Challenge[]> => {
      const { data } = await api.get<ChallengeListResponse>('/challenges/created');
      return data.challenges ?? [];
    },
    enabled: tab === 'created' && !!myId,
  });

  const remove = useMutation({
    mutationFn: async (challenge: Challenge) => {
      // 200 { closed: true } when participants exist (history kept), 204 when removed.
      const { data, status } = await api.delete<{ closed?: boolean } | ''>(`/challenges/${challenge._id}`);
      const closed = status === 200 && typeof data === 'object' && data !== null && data.closed === true;
      return { id: challenge._id, closed };
    },
    onSuccess: ({ id, closed }) => {
      toast.success(closed ? 'Challenge closed. Participants keep their history.' : 'Challenge deleted');
      qc.invalidateQueries({ queryKey: ['challenges'] });
      setPendingDelete(null);
      if (detailId === id) setDetailId(null);
    },
    onError: (e) => toast.error(challengeErrorMessage(e, 'Could not delete the challenge')),
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
      const open = !['closed', 'ended'].includes(t.state);
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
        onClose={() => {
          setDetailId(null);
          if (searchParams.get('open')) {
            setSearchParams(
              (prev) => {
                prev.delete('open');
                return prev;
              },
              { replace: true },
            );
          }
        }}
        onEdit={(c) => setEditing(c)}
        onDelete={(c) => setPendingDelete(c)}
      />
      <EditChallengeModal challenge={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={!!pendingDelete}
        destructive
        title={pendingHasParticipants ? 'Close this challenge?' : 'Delete this challenge?'}
        message={
          pendingDelete
            ? pendingHasParticipants
              ? `“${pendingDelete.title}” closes for everyone. Participants keep their progress and it stays under Created by me with a Closed badge.`
              : `“${pendingDelete.title}” will be deleted. Nobody has joined, so nothing else is lost.`
            : undefined
        }
        confirmLabel={pendingHasParticipants ? 'Close challenge' : 'Delete challenge'}
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete);
        }}
      />
    </div>
  );
}
