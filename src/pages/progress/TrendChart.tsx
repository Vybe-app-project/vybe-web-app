import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { VIZ, chartTheme } from '../ui';
import { formatClock, formatTrendValue, type TrendPoint, type TrendSeries } from '../../lib/progress';

const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: -8 };

/**
 * One movement's trend line, in its own chunk. The exercise sheet
 * `lazy()`-loads this into a fixed 13 rem box, so Recharts is off the hub's
 * critical path and the sheet never changes height when the chart lands.
 * Drawn in the brand colour as a line, never coloured as a verdict.
 */
export default function TrendChart({ series, points, timeAxis }: { series: TrendSeries; points: TrendPoint[]; timeAxis: boolean }) {
  const animation = chartTheme.animationDuration;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={CHART_MARGIN}>
        <CartesianGrid {...chartTheme.cartesianGrid} />
        <XAxis dataKey="label" {...chartTheme.axisProps} minTickGap={24} />
        <YAxis {...chartTheme.axisProps} width={56} domain={['auto', 'auto']} tickFormatter={(v) => (timeAxis ? formatClock(Number(v)) : String(v))} />
        <Tooltip {...chartTheme.tooltip} formatter={(v) => [formatTrendValue(series, Number(v ?? 0)), series.what]} />
        <Line type="monotone" dataKey="value" stroke={VIZ.brand} strokeWidth={2} dot={{ r: 3, fill: VIZ.brand, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={animation > 0} animationDuration={animation} />
      </LineChart>
    </ResponsiveContainer>
  );
}
