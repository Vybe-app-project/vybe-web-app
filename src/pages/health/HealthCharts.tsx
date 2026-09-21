import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { VIZ, chartTheme, formatStat } from '../ui';

/**
 * The Health page's four Recharts charts, in their own chunk. The page
 * `lazy()`-loads this module into fixed-height boxes, so Recharts is not on
 * the hub's critical path and nothing moves when it lands. Each chart fills
 * the box its caller gives it (`ResponsiveContainer` at 100 %).
 *
 * Body numbers are neutral (DP-005): the weight line and the "minutes" bars
 * draw in the strong ink, never in the action colour, so nothing on the page
 * reads as blue-good / red-bad.
 */

const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: -12 };
const INK_STRONG = 'var(--primary-strong, var(--text-1))';

/** 480 ms draw-in, or none under reduced motion; read per render so the OS switch is honoured live. */
const anim = () => {
  const duration = chartTheme.animationDuration;
  return { isAnimationActive: duration > 0, animationDuration: duration };
};

export type WeightPoint = { date: string; label: string; weight: number };
export type CaloriePoint = { date: string; label: string; calories: number; protein: number; carbs: number; fat: number; meals: number };
export type VolumePoint = { date: string; label: string; calories: number; duration: number; workouts: number };

export function WeightTrendChart({ data, unit }: { data: WeightPoint[]; unit: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid {...chartTheme.cartesianGrid} />
        <XAxis dataKey="label" {...chartTheme.axisProps} minTickGap={24} />
        <YAxis {...chartTheme.axisProps} width={44} domain={['dataMin - 2', 'dataMax + 2']} />
        <Tooltip {...chartTheme.tooltip} formatter={(v) => [`${formatStat(Number(v ?? 0))} ${unit}`, 'Weight']} />
        <Line type="monotone" dataKey="weight" stroke={INK_STRONG} strokeWidth={2} dot={{ r: 3, fill: INK_STRONG, strokeWidth: 0 }} activeDot={{ r: 5 }} {...anim()} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CaloriesChart({ data, goal }: { data: CaloriePoint[]; goal: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={CHART_MARGIN}>
        <defs>
          <linearGradient id="healthCaloriesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={VIZ.kcal} stopOpacity={chartTheme.areaFill.start} />
            <stop offset="100%" stopColor={VIZ.kcal} stopOpacity={chartTheme.areaFill.end} />
          </linearGradient>
        </defs>
        <CartesianGrid {...chartTheme.cartesianGrid} />
        <XAxis dataKey="label" {...chartTheme.axisProps} minTickGap={24} />
        <YAxis {...chartTheme.axisProps} width={44} />
        <Tooltip {...chartTheme.tooltip} formatter={(v) => [`${formatStat(Math.round(Number(v ?? 0)))} kcal`, 'Calories']} />
        {goal > 0 ? (
          <ReferenceLine y={goal} {...chartTheme.goalLine} ifOverflow="extendDomain" label={{ value: `Goal ${formatStat(goal)}`, position: 'insideTopRight', fill: chartTheme.text, fontSize: 11 }} />
        ) : null}
        <Area type="monotone" dataKey="calories" stroke={VIZ.kcal} strokeWidth={2} fill="url(#healthCaloriesFill)" {...anim()} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MacrosChart({ data }: { data: CaloriePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={CHART_MARGIN} barGap={2}>
        <CartesianGrid {...chartTheme.cartesianGrid} />
        <XAxis dataKey="label" {...chartTheme.axisProps} minTickGap={24} />
        <YAxis {...chartTheme.axisProps} width={44} />
        <Tooltip
          {...chartTheme.tooltip}
          formatter={(v, name) => [`${formatStat(Math.round(Number(v ?? 0)))} g`, name === 'protein' ? 'Protein' : name === 'carbs' ? 'Carbs' : 'Fat']}
        />
        <Bar dataKey="protein" stackId="macros" fill={chartTheme.macro.protein} maxBarSize={28} {...anim()} />
        <Bar dataKey="carbs" stackId="macros" fill={chartTheme.macro.carbs} maxBarSize={28} {...anim()} />
        <Bar dataKey="fat" stackId="macros" fill={chartTheme.macro.fat} radius={[6, 6, 0, 0]} maxBarSize={28} {...anim()} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VolumeChart({ data }: { data: VolumePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={CHART_MARGIN} barGap={2}>
        <CartesianGrid {...chartTheme.cartesianGrid} />
        <XAxis dataKey="label" {...chartTheme.axisProps} minTickGap={24} />
        <YAxis {...chartTheme.axisProps} width={44} />
        <Tooltip
          {...chartTheme.tooltip}
          formatter={(v, name) => [
            name === 'duration' ? `${formatStat(Number(v ?? 0))} min` : `${formatStat(Number(v ?? 0))} kcal`,
            name === 'duration' ? 'Duration' : 'Calories burned',
          ]}
        />
        <Bar dataKey="duration" fill={INK_STRONG} radius={[6, 6, 0, 0]} maxBarSize={28} {...anim()} />
        <Bar dataKey="calories" fill={VIZ.alt} radius={[6, 6, 0, 0]} maxBarSize={28} {...anim()} />
      </BarChart>
    </ResponsiveContainer>
  );
}
