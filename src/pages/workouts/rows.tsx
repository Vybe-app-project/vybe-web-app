import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Skeleton, cx, formatStat, humanize, type MenuItem } from '../../components/ui';
import { Activity, ChevronRight, Dumbbell, Footprints, Heart, Layers, Trophy, Zap } from '../../components/icons';
import type { SocialWorkout, WorkoutPlan } from './model';

/**
 * The Train hub's rows (2026-09-21). A workout is a 72 px hairline row —
 * glyph tile · title · duration-first meta · the first three exercise names —
 * the whole row opens the detail sheet, and the one action on it is a blue
 * text "Start" (Instagram's repeated-action register: "Follow" on every
 * suggested row). Nothing in the catalogue has a cover image, so no row
 * reserves one; the tile is one monochrome glyph on the surface-2 wash.
 *
 * Pure props — no store or query hook — so the rows render under
 * react-dom/server in tests/train-hub.render.test.mjs.
 */

/** The blue text action at the end of a row, 44 px tall (Friends and GymCommunity use the same string). */
export const ROW_ACTION = 'pressable -mr-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm px-2 text-sm font-semibold text-brand';

/** Row geometry shared by the rows and their skeleton: 72 px, tile · text · trailing control. */
const ROW = 'relative flex min-h-18 items-center gap-3 py-2';

const GLYPH: Record<string, typeof Dumbbell> = {
  strength: Dumbbell,
  cardio: Activity,
  hiit: Zap,
  running: Footprints,
  yoga: Heart,
  flexibility: Heart,
  sports: Trophy,
};

/** Category labels the humaniser would get wrong. */
export const categoryLabel = (category?: string | null): string => (category === 'hiit' ? 'HIIT' : humanize(category ?? ''));

/** 48 px tile: one monochrome glyph on the surface-2 wash with a hairline. Never a colour block. */
export function CategoryTile({ category, icon, className }: { category?: string; icon?: ReactNode; className?: string }) {
  const Glyph = GLYPH[category ?? ''] ?? Dumbbell;
  return (
    <span aria-hidden="true" className={cx('flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-text-2', className)}>
      {icon ?? <Glyph size={22} />}
    </span>
  );
}

/**
 * "25 min · Beginner · Yoga · 90 kcal" — duration first, then only what the
 * record carries. `compact` keeps duration and the extras only: a member's own
 * row has a menu and Start on its right, and "Done yesterday" must not be the
 * fact that truncates away (it is the one lifters ask for).
 */
export function workoutMeta(
  w: Pick<SocialWorkout, 'duration' | 'level' | 'category' | 'caloriesBurned' | 'exercises'>,
  extra: ReadonlyArray<string | null | undefined | false> = [],
  { compact = false }: { compact?: boolean } = {},
): string {
  const parts = [
    w.duration ? `${formatStat(w.duration)} min` : null,
    !compact && w.level ? humanize(w.level) : null,
    !compact && w.category ? categoryLabel(w.category) : null,
    !compact && w.caloriesBurned ? `${formatStat(w.caloriesBurned)} kcal` : null,
    ...extra,
  ].filter(Boolean) as string[];
  if (parts.length) return parts.join(' · ');
  const n = w.exercises?.length ?? 0;
  return n ? `${formatStat(n)} ${n === 1 ? 'exercise' : 'exercises'}` : '';
}

/** "Child pose breathing · Low lunge flow · Supported pigeon · +1" — Hevy's card preview on one line. */
export function exercisePreview(exercises: ReadonlyArray<{ name?: string | null }> | undefined, shown = 3): string {
  const names = (exercises ?? []).map((e) => (e.name ?? '').trim()).filter(Boolean);
  if (!names.length) return '';
  const head = names.slice(0, shown).join(' · ');
  return names.length > shown ? `${head} · +${names.length - shown}` : head;
}

/** Whole-row link. Sits under the trailing controls (`z-[2]`), so a tap anywhere else opens the detail. */
export function RowLink({ to, label, state }: { to: string; label: string; state?: unknown }) {
  return <Link to={to} state={state} viewTransition aria-label={label} className="absolute inset-0 z-[1] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus" />;
}

/** Hairline-separated rows. */
export function RowList({ className, children, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={cx('divide-y divide-line', className)} {...rest}>
      {children}
    </ul>
  );
}

export function WorkoutRow({
  workout,
  to,
  startTo,
  state,
  extra,
  menu,
  compact = false,
}: {
  workout: SocialWorkout;
  /** The detail sheet. */
  to: string;
  /** A new session seeded from this workout. */
  startTo: string;
  state?: unknown;
  /** Facts appended to the meta line — "Done yesterday", "Private" — only when true. */
  extra?: ReadonlyArray<string | null | undefined | false>;
  /** Owner actions; catalogue rows have none (Share, Add to plan and Report live on the detail sheet). */
  menu?: MenuItem[];
  /** The member's own rows: duration and the extras only, so "Done yesterday" survives the narrow column. */
  compact?: boolean;
}) {
  const title = workout.title;
  const meta = workoutMeta(workout, extra ?? [], { compact });
  const preview = exercisePreview(workout.exercises);
  return (
    <li className={cx(ROW, 'pressable rounded-sm')}>
      <RowLink to={to} label={`Open ${title}`} state={state} />
      <CategoryTile category={workout.category} />
      <div className="min-w-0 flex-1">
        <p className="t-name truncate text-text-1">{title}</p>
        {meta ? <p className="t-meta tabular truncate">{meta}</p> : null}
        {preview ? <p className="t-meta truncate text-text-3">{preview}</p> : null}
      </div>
      <div className="relative z-[2] flex shrink-0 items-center">
        {menu?.length ? <Menu items={menu} label={`More options for ${title}`} /> : null}
        {/* No sheet background: Start opens the live runner, which is a page
            on every width. A background would make the shell keep the hub on
            screen while the URL said /workouts/session (RouteSheet renders
            only SHEET_ROUTES over a background). */}
        <Link to={startTo} viewTransition aria-label={`Start ${title}`} className={ROW_ACTION}>
          Start
        </Link>
      </div>
    </li>
  );
}

/** "4 weeks · 12 workouts · Beginner" — a zero count is not a count. */
export function planMeta(plan: Pick<WorkoutPlan, 'durationWeeks' | 'level' | 'workouts'>, extra: ReadonlyArray<string | null | undefined | false> = []): string {
  const included = (plan.workouts ?? []).filter((w) => w.workout).length;
  return [
    plan.durationWeeks ? `${formatStat(plan.durationWeeks)} ${plan.durationWeeks === 1 ? 'week' : 'weeks'}` : null,
    included ? `${formatStat(included)} ${included === 1 ? 'workout' : 'workouts'}` : 'Nothing scheduled yet',
    plan.level ? humanize(plan.level) : null,
    ...extra,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A programme is a commitment: the row opens its schedule, and Start lives there. */
export function PlanRow({
  plan,
  to,
  state,
  extra,
  menu,
}: {
  plan: WorkoutPlan;
  to: string;
  state?: unknown;
  extra?: ReadonlyArray<string | null | undefined | false>;
  menu?: MenuItem[];
}) {
  const included = (plan.workouts ?? []).filter((w) => w.workout);
  const preview = exercisePreview(included.map((e) => ({ name: e.workout?.title })));
  return (
    <li className={cx(ROW, 'pressable rounded-sm')}>
      <RowLink to={to} label={`Open ${plan.title}`} state={state} />
      <CategoryTile icon={<Layers size={22} />} />
      <div className="min-w-0 flex-1">
        <p className="t-name truncate text-text-1">{plan.title}</p>
        <p className="t-meta tabular truncate">{planMeta(plan, extra ?? [])}</p>
        {preview ? <p className="t-meta truncate text-text-3">{preview}</p> : null}
      </div>
      <div className="relative z-[2] flex shrink-0 items-center gap-1">
        {menu?.length ? <Menu items={menu} label={`More options for ${plan.title}`} /> : null}
        <span aria-hidden="true" className="inline-flex h-11 w-8 items-center justify-center text-text-3">
          <ChevronRight size={20} />
        </span>
      </div>
    </li>
  );
}

/** Same 72 px geometry as the rows, so a list never shifts when it fills. */
export function RowSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <ul aria-hidden="true" className={cx('divide-y divide-line', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className={ROW}>
          <Skeleton className="h-12 w-12 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-10" />
        </li>
      ))}
    </ul>
  );
}
