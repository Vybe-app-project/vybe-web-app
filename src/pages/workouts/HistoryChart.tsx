import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format, isValid, parseISO } from 'date-fns';
import { VIZ, chartTheme, formatStat } from '../../components/ui';

export type HistoryDay = { day: string; date: string; volume: number; minutes: number; sessions: number };
export type HistoryMetric = 'volume' | 'minutes' | 'sessions';

/**
 * The last-seven-days bars, in their own chunk. History `lazy()`-loads this
 * into a fixed 13 rem box, so Recharts is off the page's critical path and the
 * card never changes height when the chart lands. Fills the box it is given.
 */
export default function HistoryChart({ data, metric, label, suffix }: { data: HistoryDay[]; metric: HistoryMetric; label: string; suffix: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="28%">
        <CartesianGrid {...chartTheme.cartesianGrid} strokeDasharray="3 3" />
        <XAxis dataKey="day" {...chartTheme.axisProps} />
        <YAxis {...chartTheme.axisProps} allowDecimals={false} width={44} tickFormatter={(v: number) => formatStat(v, { compact: true })} />
        <Tooltip
          {...chartTheme.tooltip}
          formatter={(value) => [`${formatStat(Number(value ?? 0))}${suffix}`, label]}
          labelFormatter={(_label, payload) => {
            const iso = (payload?.[0]?.payload as { date?: string } | undefined)?.date;
            const d = iso ? parseISO(iso) : null;
            return d && isValid(d) ? format(d, 'EEEE d MMM') : String(_label);
          }}
        />
        <Bar dataKey={metric} fill={VIZ.brand} radius={[6, 6, 0, 0]} maxBarSize={40} animationDuration={chartTheme.animationDuration} />
      </BarChart>
    </ResponsiveContainer>
  );
}
