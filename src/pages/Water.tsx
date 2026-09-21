import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isValid, parseISO } from 'date-fns';
import { api, errMsg } from '../lib/api';
import { localDayParams, timeOfDay } from '../lib/timezone';
import { displayVolume, mlToOz, useUnits, volumeUnit, type UnitSystem } from '../lib/units';
import {
  Button,
  Card,
  CardGrid,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Ring,
  Section,
  Skeleton,
  Tabs,
  cx,
  formatStat,
  useToast,
} from './ui';
import { CheckCircle, Droplet, Plus, Trash } from './icons';

/* ------------------------------------------------------------------ types */

type WaterUnit = 'oz' | 'ml' | 'cups';

type WaterLog = {
  _id: string;
  amount: number;
  unit: WaterUnit;
  timestamp: string;
};

type WaterGoal = { oz: number; source: 'custom' | 'weight' | 'default' };

type TodayWater = {
  logs: WaterLog[];
  total: number;
  unit: 'oz';
  count: number;
  /** Older servers do not send one; 64 oz is the classic fallback. */
  goal?: WaterGoal;
};

/** Server-side conversion constants, mirrored so the UI can preview totals. */
const OUNCES_PER_CUP = 8;
const ML_PER_OUNCE = 29.5735;
const MAX_OUNCES_PER_LOG = 128;
const FALLBACK_GOAL: WaterGoal = { oz: 64, source: 'default' };
const GOAL_RANGE_OZ = { min: 8, max: 400 };

const GOAL_SOURCE_COPY: Record<WaterGoal['source'], string> = {
  custom: 'Your own target',
  weight: 'Based on your body weight (about 35 ml per kg)',
  default: 'The classic 8 glasses. Set your weight on Goals for a personal target.',
};

/** Whole number for display in the chosen unit, e.g. 64 oz -> "1,893 ml". */
const vol = (oz: number, system: UnitSystem) => formatStat(Math.round(displayVolume(oz, system)));

const toOunces = (amount: number, unit: WaterUnit) => {
  if (unit === 'ml') return amount / ML_PER_OUNCE;
  if (unit === 'cups') return amount * OUNCES_PER_CUP;
  return amount;
};

const roundOz = (oz: number) => Math.round(oz * 10) / 10;

const QUICK_ADDS: { amount: number; unit: WaterUnit; label: string; detail: string }[] = [
  { amount: 8, unit: 'oz', label: 'Glass', detail: '8 oz' },
  { amount: 16, unit: 'oz', label: 'Bottle', detail: '16 oz' },
  { amount: 500, unit: 'ml', label: 'Large bottle', detail: '500 ml' },
  { amount: 1, unit: 'cups', label: 'Cup', detail: '1 cup' },
];

const UNIT_TABS: { key: WaterUnit; label: string }[] = [
  { key: 'oz', label: 'oz' },
  { key: 'ml', label: 'ml' },
  { key: 'cups', label: 'cups' },
];

const UNIT_DEFAULTS: Record<WaterUnit, { value: string; step: string; placeholder: string }> = {
  oz: { value: '12', step: '0.5', placeholder: '12' },
  ml: { value: '350', step: '10', placeholder: '350' },
  cups: { value: '1', step: '0.5', placeholder: '1' },
};

const validate = (amount: number, unit: WaterUnit): string | null => {
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount greater than zero.';
  if (toOunces(amount, unit) > MAX_OUNCES_PER_LOG) return `One log can be at most ${MAX_OUNCES_PER_LOG} oz (about 3.8 L). Split larger amounts.`;
  return null;
};

const queryKey = ['water', 'today'];

/** Progress is a neutral fill (DP-005): the strong ink, never the action colour and never success/danger. */
const INK_STRONG = 'var(--primary-strong, var(--text-1))';

/* -------------------------------------------------------------- log modal */

function LogWaterModal({
  open,
  onClose,
  onSubmit,
  pending,
  defaultUnit = 'oz',
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { amount: number; unit: WaterUnit }) => Promise<unknown>;
  pending: boolean;
  /** Follows the units preference: oz for imperial, ml for metric. */
  defaultUnit?: WaterUnit;
}) {
  const [unit, setUnit] = useState<WaterUnit>(defaultUnit);
  const [amount, setAmount] = useState(UNIT_DEFAULTS[defaultUnit].value);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setUnit(defaultUnit);
      setAmount(UNIT_DEFAULTS[defaultUnit].value);
      setError(null);
    }
  }

  const changeUnit = (next: WaterUnit) => {
    setUnit(next);
    setAmount(UNIT_DEFAULTS[next].value);
    setError(null);
  };

  const parsed = Number(amount);
  const preview = Number.isFinite(parsed) && parsed > 0 ? roundOz(toOunces(parsed, unit)) : null;
  const formId = 'water-log-form';

  const submit = async () => {
    const problem = validate(parsed, unit);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await onSubmit({ amount: parsed, unit });
      onClose();
    } catch {
      // The mutation surfaces its own toast; keep the sheet open so the user can retry.
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log water"
      description="Any amount, in the unit you drink in."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={pending} icon={<Droplet size={18} />}>
            Log water
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Tabs variant="segmented" fill aria-label="Unit" tabs={UNIT_TABS} value={unit} onChange={(k) => changeUnit(k as WaterUnit)} />
        <Input
          label="Amount"
          type="number"
          inputMode="decimal"
          min={0}
          step={UNIT_DEFAULTS[unit].step}
          placeholder={UNIT_DEFAULTS[unit].placeholder}
          value={amount}
          autoFocus
          error={error ?? undefined}
          hint={error ? undefined : preview != null && unit !== 'oz' ? `About ${formatStat(preview)} oz` : `Up to ${MAX_OUNCES_PER_LOG} oz per log`}
          trailing={<span className="text-xs font-semibold">{unit}</span>}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
        />
        <div className="flex flex-wrap gap-2">
          {QUICK_ADDS.map((q) => (
            <Button
              key={q.label}
              size="sm"
              variant="secondary"
              onClick={() => {
                setUnit(q.unit);
                setAmount(String(q.amount));
                setError(null);
              }}
            >
              {q.label} {q.detail}
            </Button>
          ))}
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------- goal modal */

function GoalModal({
  open,
  goal,
  system,
  onClose,
}: {
  open: boolean;
  goal: WaterGoal;
  system: UnitSystem;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const unit = volumeUnit(system);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValue(String(Math.round(displayVolume(goal.oz, system))));
      setError(null);
    }
  }

  const save = useMutation({
    mutationFn: async (oz: number | null) => {
      const { data } = await api.put<{ goal: WaterGoal }>('/water/goal', { oz });
      return data.goal;
    },
    onSuccess: (next, oz) => {
      toast.success(oz === null ? 'Goal reset to the weight-based default' : `Daily goal set to ${vol(next.oz, system)} ${unit}`);
      qc.setQueryData<TodayWater>(queryKey, (old) => (old ? { ...old, goal: next } : old));
      qc.invalidateQueries({ queryKey });
      onClose();
    },
    onError: (e) => setError(errMsg(e, 'Could not save the goal')),
  });

  const submit = () => {
    const shown = Number(value);
    const oz = system === 'imperial' ? shown : mlToOz(shown);
    if (!Number.isFinite(shown) || shown <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (oz < GOAL_RANGE_OZ.min || oz > GOAL_RANGE_OZ.max) {
      setError(`Choose between ${vol(GOAL_RANGE_OZ.min, system)} and ${vol(GOAL_RANGE_OZ.max, system)} ${unit} a day.`);
      return;
    }
    setError(null);
    save.mutate(Math.round(oz * 10) / 10);
  };
  const formId = 'water-goal-form';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Daily water goal"
      description="How much you aim to drink each day. The rings and the remaining amount follow it."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            Save goal
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          label="Daily goal"
          type="number"
          inputMode="numeric"
          min={0}
          step={system === 'imperial' ? 4 : 100}
          value={value}
          autoFocus
          error={error ?? undefined}
          hint={error ? undefined : GOAL_SOURCE_COPY[goal.source]}
          trailing={<span className="text-xs font-semibold">{unit}</span>}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        {goal.source === 'custom' ? (
          <Button type="button" variant="secondary" size="sm" loading={save.isPending} onClick={() => save.mutate(null)}>
            Use the weight-based default instead
          </Button>
        ) : null}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------- page */

export default function Water() {
  const qc = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [logOpen, setLogOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const system = useUnits((st) => st.system);
  const unit = volumeUnit(system);

  // Deep link from the Log sheet and the PWA shortcut: /health/water?log=1
  const wantsLog = searchParams.get('log') === '1';
  useEffect(() => {
    if (!wantsLog) return;
    setLogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('log');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsLog]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<TodayWater> => {
      const { data } = await api.get<TodayWater>('/water/today', { params: localDayParams() });
      return data;
    },
  });

  const removeLog = useMutation({
    mutationFn: async (log: WaterLog) => {
      await api.delete(`/water/${log._id}`);
      return log._id;
    },
    onMutate: async (log) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<TodayWater>(queryKey);
      if (previous) {
        qc.setQueryData<TodayWater>(queryKey, {
          ...previous,
          logs: previous.logs.filter((l) => l._id !== log._id),
          count: Math.max(0, previous.count - 1),
          total: roundOz(Math.max(0, previous.total - toOunces(log.amount, log.unit))),
        });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast.error(errMsg(e, 'Could not remove that log'));
    },
    onSuccess: () => toast.success('Log removed'),
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const logWater = useMutation({
    mutationFn: async (payload: { amount: number; unit: WaterUnit }) => {
      const problem = validate(payload.amount, payload.unit);
      if (problem) throw new Error(problem);
      const { data } = await api.post<{ data: WaterLog }>('/water/log', payload);
      return data.data;
    },
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<TodayWater>(queryKey);
      if (previous) {
        const optimistic: WaterLog = {
          _id: `optimistic-${Date.now()}`,
          amount: payload.amount,
          unit: payload.unit,
          timestamp: new Date().toISOString(),
        };
        qc.setQueryData<TodayWater>(queryKey, {
          ...previous,
          logs: [optimistic, ...previous.logs],
          count: previous.count + 1,
          total: roundOz(previous.total + toOunces(payload.amount, payload.unit)),
        });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast.error(errMsg(e, 'Could not log water'));
    },
    onSuccess: (created, payload) =>
      toast.success(`${formatStat(payload.amount)} ${payload.unit} logged`, {
        // A stray quick-add is one tap to take back, like the mobile tracker's "Undo latest".
        action: { label: 'Undo', onClick: () => removeLog.mutate(created) },
        duration: 6000,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const logs = useMemo(() => data?.logs ?? [], [data]);
  const total = data?.total ?? 0;
  const goal = data?.goal ?? FALLBACK_GOAL;
  const goalOz = goal.oz;
  const remaining = Math.max(0, goalOz - total);
  const reached = total >= goalOz && !isLoading;
  const lastLog = logs.find((l) => !l._id.startsWith('optimistic-')) ?? logs[0];

  const logButton = (
    <Button variant="primary" icon={<Plus size={18} />} onClick={() => setLogOpen(true)}>
      Log water
    </Button>
  );

  const count = data?.count ?? 0;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Hydration"
        subtitle={isLoading ? 'Every glass counts toward your daily goal.' : `Every glass counts toward a ${vol(goalOz, system)} ${unit} daily goal.`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setGoalOpen(true)} disabled={isLoading || isError}>
              Edit goal
            </Button>
            {logButton}
          </>
        }
        mobileActions={
          <IconButton label="Log water" onClick={() => setLogOpen(true)}>
            <Plus size={22} />
          </IconButton>
        }
      />

      <CardGrid min="20rem">
        <Card className="flex flex-col items-center justify-center gap-4 text-center">
          {isLoading ? (
            <Skeleton className="h-[200px] w-[200px] rounded-full" />
          ) : isError ? (
            <ErrorState error={error} title="Could not load today’s hydration" retry={() => refetch()} />
          ) : (
            <>
              <Ring value={total} max={goalOz} size={200} stroke={14} color={INK_STRONG} label={`Hydration ${vol(total, system)} of ${vol(goalOz, system)} ${unit}`}>
                <Droplet size={22} className="text-text-2" />
                <span className="mt-1 text-3xl">{vol(total, system)}</span>
                <span className="text-xs font-semibold text-text-2 [font-variation-settings:'wdth'_100]">of {vol(goalOz, system)} {unit}</span>
              </Ring>
              <p className="text-sm text-text-2">
                {reached ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-text-1">
                    <CheckCircle size={16} /> Goal reached
                  </span>
                ) : (
                  <>
                    <span className="tabular font-semibold text-text-1">{vol(remaining, system)} {unit}</span> to go
                  </>
                )}
                {count > 0 ? (
                  <span className="tabular">
                    {' · '}
                    {formatStat(count)} {count === 1 ? 'log' : 'logs'}
                    {lastLog ? `, last at ${timeOfDay(lastLog.timestamp)}` : ''}
                  </span>
                ) : null}
              </p>
              <button type="button" className="min-h-11 text-xs text-text-3 underline-offset-2 hover:underline" onClick={() => setGoalOpen(true)}>
                {GOAL_SOURCE_COPY[goal.source]}
              </button>
            </>
          )}
        </Card>

        <Card container className="flex flex-col justify-center">
          <p className="type-label mb-3 text-text-2">Quick add</p>
          <div className="grid grid-cols-2 gap-2 @md:grid-cols-4">
            {QUICK_ADDS.map((quick) => (
              <Button
                key={quick.label}
                variant="secondary"
                className="h-auto flex-col gap-0 py-2.5"
                disabled={logWater.isPending || isLoading || isError}
                onClick={() => logWater.mutate({ amount: quick.amount, unit: quick.unit })}
                aria-label={`Log ${quick.label.toLowerCase()}, ${quick.detail}`}
              >
                <span className="text-sm font-semibold">{quick.label}</span>
                <span className="text-xs font-medium text-text-2">{quick.detail}</span>
              </Button>
            ))}
          </div>
          <Button variant="quiet" className="mt-2 w-full @md:w-auto" icon={<Plus size={16} />} onClick={() => setLogOpen(true)}>
            Custom amount
          </Button>
        </Card>
      </CardGrid>

      <Section title="Today’s logs" description={`Newest first. Totals are shown in ${system === 'imperial' ? 'ounces' : 'millilitres'}; change units in Settings.`}>
        {isLoading ? (
          <Card padded={false} className="divide-y divide-line" aria-busy="true" aria-label="Loading logs">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 pl-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </Card>
        ) : isError ? null : logs.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              family="body"
              title="Nothing logged yet today"
              message="Tap a quick add or log a custom amount to record your first drink of the day."
              action={{ label: 'Log water', onClick: () => setLogOpen(true), icon: <Droplet size={18} />, variant: 'secondary' }}
            />
          </Card>
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {logs.map((log) => {
                const ts = parseISO(log.timestamp);
                const pending = log._id.startsWith('optimistic-');
                const oz = roundOz(toOunces(log.amount, log.unit));
                return (
                  <li key={log._id} className={cx('flex items-center gap-3 p-3 pl-4 transition-opacity dur-2', pending && 'opacity-60')} aria-busy={pending || undefined}>
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-2">
                      <Droplet size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="type-stat text-lg text-text-1">
                        {formatStat(log.amount)}
                        <span className="ml-1 text-xs font-semibold text-text-2 [font-variation-settings:'wdth'_100]">{log.unit}</span>
                      </p>
                      <p className="text-xs text-text-2">
                        <time dateTime={isValid(ts) ? ts.toISOString() : undefined} className="tabular">
                          {timeOfDay(ts) || 'Just now'}
                        </time>
                        {log.unit !== unit ? <span className="ml-2 tabular text-text-3">{vol(oz, system)} {unit}</span> : null}
                      </p>
                    </div>
                    <IconButton label={`Remove ${formatStat(log.amount)} ${log.unit} log`} variant="danger" disabled={pending || removeLog.isPending} onClick={() => removeLog.mutate(log)}>
                      <Trash size={18} />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </Section>

      <p className="text-xs leading-relaxed text-text-3">
        Hydration is tracked from what you log here. The {vol(goalOz, system)} {unit} goal is a general guideline, not personal medical advice.
      </p>

      <LogWaterModal open={logOpen} onClose={() => setLogOpen(false)} onSubmit={(payload) => logWater.mutateAsync(payload)} pending={logWater.isPending} defaultUnit={system === 'imperial' ? 'oz' : 'ml'} />
      <GoalModal open={goalOpen} goal={goal} system={system} onClose={() => setGoalOpen(false)} />
    </div>
  );
}
