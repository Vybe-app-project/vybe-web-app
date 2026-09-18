import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isValid, parseISO } from 'date-fns';
import { api, errMsg } from '../lib/api';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Ring,
  Section,
  Skeleton,
  StatTile,
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

type TodayWater = {
  logs: WaterLog[];
  total: number;
  unit: 'oz';
  count: number;
};

/** Server-side conversion constants, mirrored so the UI can preview totals. */
const OUNCES_PER_CUP = 8;
const ML_PER_OUNCE = 29.5735;
const MAX_OUNCES_PER_LOG = 128;
const DAILY_GOAL_OZ = 64;

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

/* -------------------------------------------------------------- log modal */

function LogWaterModal({
  open,
  onClose,
  onSubmit,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { amount: number; unit: WaterUnit }) => Promise<unknown>;
  pending: boolean;
}) {
  const [unit, setUnit] = useState<WaterUnit>('oz');
  const [amount, setAmount] = useState(UNIT_DEFAULTS.oz.value);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setUnit('oz');
      setAmount(UNIT_DEFAULTS.oz.value);
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

/* ------------------------------------------------------------------- page */

export default function Water() {
  const qc = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [logOpen, setLogOpen] = useState(false);

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
      const { data } = await api.get<TodayWater>('/water/today', {
        params: { timezoneOffsetMinutes: new Date().getTimezoneOffset() },
      });
      return data;
    },
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
    onSuccess: (_d, payload) => toast.success(`${formatStat(payload.amount)} ${payload.unit} logged`),
    onSettled: () => qc.invalidateQueries({ queryKey }),
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

  const logs = useMemo(() => data?.logs ?? [], [data]);
  const total = data?.total ?? 0;
  const remaining = Math.max(0, DAILY_GOAL_OZ - total);
  const reached = total >= DAILY_GOAL_OZ && !isLoading;
  const pct = Math.round(Math.min(1, total / DAILY_GOAL_OZ) * 100);
  const lastLog = logs.find((l) => !l._id.startsWith('optimistic-')) ?? logs[0];
  const lastLogTime = lastLog ? parseISO(lastLog.timestamp) : null;

  const logButton = (
    <Button variant="primary" icon={<Plus size={18} />} onClick={() => setLogOpen(true)}>
      Log water
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hydration"
        subtitle={`Every glass counts toward a ${DAILY_GOAL_OZ} oz daily goal.`}
        actions={logButton}
        mobileActions={
          <IconButton label="Log water" onClick={() => setLogOpen(true)}>
            <Plus size={22} />
          </IconButton>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card className="flex flex-col items-center justify-center gap-4 text-center">
          {isLoading ? (
            <Skeleton className="h-[200px] w-[200px] rounded-full" />
          ) : isError ? (
            <ErrorState error={error} title="Could not load today’s hydration" retry={() => refetch()} />
          ) : (
            <>
              <Ring value={total} max={DAILY_GOAL_OZ} size={200} stroke={14} color={reached ? 'brand' : 'protein'} label="Hydration">
                <Droplet size={22} className={cx(reached ? 'text-brand' : 'text-info')} />
                <span className="mt-1 text-3xl">{formatStat(Math.round(total))}</span>
                <span className="text-xs font-semibold text-text-2 [font-variation-settings:'wdth'_100]">of {DAILY_GOAL_OZ} oz</span>
              </Ring>
              {reached ? (
                <Badge tone="success" size="md">
                  <CheckCircle size={14} /> Goal reached
                </Badge>
              ) : (
                <p className="text-sm text-text-2">
                  <span className="tabular font-semibold text-text-1">{formatStat(Math.round(remaining))} oz</span> to go
                </p>
              )}
            </>
          )}
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatTile loading={isLoading} label="Today" value={formatStat(pct)} unit="%" tone={reached ? 'brand' : 'neutral'} hint="of your daily goal" />
            <StatTile loading={isLoading} label="Logs" value={formatStat(data?.count ?? 0)} hint={data?.count ? `${data.count === 1 ? 'entry' : 'entries'} so far today` : 'None yet today'} />
            <StatTile
              loading={isLoading}
              label="Last drink"
              value={lastLogTime && isValid(lastLogTime) ? format(lastLogTime, 'HH:mm') : '—'}
              hint={lastLog ? `${formatStat(lastLog.amount)} ${lastLog.unit}` : 'Nothing logged yet'}
            />
          </div>

          <Card>
            <p className="type-label mb-3 text-text-2">Quick add</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
            <Button variant="ghost" className="mt-2 w-full sm:w-auto" icon={<Plus size={16} />} onClick={() => setLogOpen(true)}>
              Custom amount
            </Button>
          </Card>
        </div>
      </div>

      <Section title="Today’s logs" description="Newest first. Totals are shown in ounces.">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? null : logs.length === 0 ? (
          <EmptyState
            title="Nothing logged yet today"
            message="Tap a quick add or log a custom amount to record your first drink of the day."
            action={{ label: 'Log water', onClick: () => setLogOpen(true), icon: <Droplet size={18} /> }}
          />
        ) : (
          <ul className="space-y-2">
            {logs.map((log) => {
              const ts = parseISO(log.timestamp);
              const pending = log._id.startsWith('optimistic-');
              const oz = roundOz(toOunces(log.amount, log.unit));
              return (
                <li key={log._id} className={cx('card flex items-center gap-3 p-3 pl-4 transition-opacity dur-2', pending && 'opacity-60')} aria-busy={pending || undefined}>
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
                    <Droplet size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="type-stat text-lg text-text-1">
                      {formatStat(log.amount)}
                      <span className="ml-1 text-xs font-semibold text-text-2 [font-variation-settings:'wdth'_100]">{log.unit}</span>
                    </p>
                    <p className="text-xs text-text-2">
                      <time dateTime={isValid(ts) ? ts.toISOString() : undefined} className="tabular">
                        {isValid(ts) ? format(ts, 'HH:mm') : 'Just now'}
                      </time>
                      {log.unit !== 'oz' ? <span className="ml-2 tabular text-text-3">{formatStat(oz)} oz</span> : null}
                    </p>
                  </div>
                  <IconButton label={`Remove ${formatStat(log.amount)} ${log.unit} log`} variant="danger" disabled={pending || removeLog.isPending} onClick={() => removeLog.mutate(log)}>
                    <Trash size={18} />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Callout tone="info">
        Hydration is tracked from what you log here. The {DAILY_GOAL_OZ} oz goal is a general guideline, not personal medical advice.
      </Callout>

      <LogWaterModal open={logOpen} onClose={() => setLogOpen(false)} onSubmit={(payload) => logWater.mutateAsync(payload)} pending={logWater.isPending} />
    </div>
  );
}
