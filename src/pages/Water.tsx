import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isValid, parseISO } from 'date-fns';
import { api, errMsg } from '../lib/api';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  useToast,
} from '../components/ui';
import { Droplet, Plus, Trash, Clock } from '../components/icons';

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

const QUICK_ADDS: { amount: number; unit: WaterUnit; label: string }[] = [
  { amount: 8, unit: 'oz', label: 'Glass · 8 oz' },
  { amount: 16, unit: 'oz', label: 'Bottle · 16 oz' },
  { amount: 500, unit: 'ml', label: 'Large · 500 ml' },
  { amount: 1, unit: 'cups', label: 'Cup' },
];

/* --------------------------------------------------------- hydration ring */

function HydrationGauge({ total, goal }: { total: number; goal: number }) {
  const size = 200;
  const stroke = 16;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = goal > 0 ? Math.min(total / goal, 1) : 0;
  const pct = Math.round(ratio * 100);

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`Hydration ${pct}% of daily goal`}>
        <defs>
          <linearGradient id="waterGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#7c5cff" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#262631"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#waterGradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.4,0,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <Droplet size={26} />
        <p className="mt-1 text-3xl font-bold">{Math.round(total)}</p>
        <p className="text-xs text-[var(--color-muted)]">of {goal} oz · {pct}%</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function Water() {
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('12');
  const [unit, setUnit] = useState<WaterUnit>('oz');

  const queryKey = ['water', 'today'];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<TodayWater> => {
      const { data } = await api.get<TodayWater>('/water/today', {
        params: { timezoneOffsetMinutes: new Date().getTimezoneOffset() * -1 },
      });
      return data;
    },
  });

  const logWater = useMutation({
    mutationFn: async (payload: { amount: number; unit: WaterUnit }) => {
      const ounces = toOunces(payload.amount, payload.unit);
      if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
        throw new Error('Enter a valid amount');
      }
      if (ounces > MAX_OUNCES_PER_LOG) {
        throw new Error('A single log cannot exceed 128 oz');
      }
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
          total: Math.round((previous.total + toOunces(payload.amount, payload.unit)) * 10) / 10,
        });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast.error(errMsg(e, 'Could not log water'));
    },
    onSuccess: () => toast.success('Water logged'),
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
          total:
            Math.round(Math.max(0, previous.total - toOunces(log.amount, log.unit)) * 10) / 10,
        });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast.error(errMsg(e, 'Could not delete log'));
    },
    onSuccess: () => toast.success('Log removed'),
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const logs = useMemo(() => data?.logs ?? [], [data]);
  const total = data?.total ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 p-4">
      <header>
        <h1 className="text-2xl font-bold">Hydration</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Track every glass and hit your daily {DAILY_GOAL_OZ} oz target.
        </p>
      </header>

      <Card className="space-y-4 p-5">
        {isLoading ? (
          <Skeleton className="mx-auto h-[200px] w-[200px] rounded-full" />
        ) : isError ? (
          <ErrorState
            message={errMsg(error, 'Could not load hydration data')}
            onRetry={() => refetch()}
          />
        ) : (
          <>
            <HydrationGauge total={total} goal={DAILY_GOAL_OZ} />
            <p className="text-center text-sm text-[var(--color-muted)]">
              {total >= DAILY_GOAL_OZ
                ? 'Goal reached — nicely done.'
                : `${Math.round(DAILY_GOAL_OZ - total)} oz to go · ${data?.count ?? 0} logs today`}
            </p>
          </>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUICK_ADDS.map((quick) => (
            <Button
              key={quick.label}
              variant="ghost"
              disabled={logWater.isPending}
              onClick={() => logWater.mutate({ amount: quick.amount, unit: quick.unit })}
            >
              <Droplet size={14} /> {quick.label}
            </Button>
          ))}
        </div>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            logWater.mutate({ amount: Number(amount), unit });
          }}
        >
          <label className="min-w-24 flex-1 space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Amount</span>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Unit</span>
            <select
              className="input-base"
              value={unit}
              onChange={(e) => setUnit(e.target.value as WaterUnit)}
            >
              <option value="oz">oz</option>
              <option value="ml">ml</option>
              <option value="cups">cups</option>
            </select>
          </label>
          <Button type="submit" variant="primary" loading={logWater.isPending}>
            <Plus size={16} /> Log
          </Button>
        </form>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Today’s logs</h2>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            icon={<Droplet size={24} />}
            title="Nothing logged yet"
            description="Use a quick add above to record your first drink of the day."
          />
        ) : (
          <ul className="space-y-2">
            {logs.map((log) => {
              const ts = parseISO(log.timestamp);
              const pending = log._id.startsWith('optimistic-');
              return (
                <li
                  key={log._id}
                  className={`card flex items-center justify-between gap-3 p-3 ${
                    pending ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Droplet size={18} />
                    <div>
                      <p className="text-sm font-medium">
                        {log.amount} {log.unit}
                      </p>
                      <p className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
                        <Clock size={11} />
                        {isValid(ts) ? format(ts, 'HH:mm') : '—'} ·{' '}
                        {Math.round(toOunces(log.amount, log.unit) * 10) / 10} oz
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete water log"
                    className="btn btn-ghost px-2"
                    disabled={pending || removeLog.isPending}
                    onClick={() => removeLog.mutate(log)}
                  >
                    <Trash size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
