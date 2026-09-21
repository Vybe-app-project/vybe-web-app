import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import {
  Badge,
  Button,
  Card,
  Progress,
  Section,
  cx,
  formatStat,
  usePulse,
} from '../components/ui';
import {
  Award,
  CalendarDays,
  Check,
  CheckCircle,
  ChevronRight,
  Clock,
  Dumbbell,
  Flame,
  Footprints,
  Heart,
  Medal,
  Plate,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  Zap,
  type IconProps,
} from '../components/icons';
import {
  CATEGORIES,
  awardState,
  categoryOf,
  criteriaExplainer,
  criteriaUnit,
  isNewAward,
  isVisible,
  rarityOf,
  showClaim,
  type Achievement,
  type Category,
  type Rarity,
} from '../lib/achievements';

/*
 * The achievement card and the grouped grid. Pure: no store, no query, no
 * session, so react-dom/server renders exactly what the browser shows and the
 * flag and claim rules can be pinned by a render test.
 */

/**
 * Visual treatment per rarity tier, expressed only in semantic tokens.
 * Common is quiet, uncommon is the brand mint, rare is sky, epic is the
 * lilac viz colour (text stays `text-1` so it holds contrast in light mode),
 * legendary is gold. Ember is NOT used here — it is reserved for effort
 * (criteria met, awards on their way), per the design direction.
 */
export const RARITY_STYLE: Record<
  Rarity,
  {
    label: string;
    tile: string;
    chip: string;
    bar: 'brand' | 'protein' | 'alt' | 'carbs';
    ring: 'brand' | 'protein' | 'alt' | 'carbs';
  }
> = {
  common: {
    label: 'Common',
    tile: 'bg-surface-2 text-text-2',
    chip: 'bg-surface-2 text-text-2 border border-line',
    bar: 'brand',
    ring: 'brand',
  },
  uncommon: {
    label: 'Uncommon',
    tile: 'bg-brand-soft text-brand-text',
    chip: 'bg-brand-soft text-brand-text',
    bar: 'brand',
    ring: 'brand',
  },
  rare: {
    label: 'Rare',
    tile: 'bg-info-soft text-info-text',
    chip: 'bg-info-soft text-info-text',
    bar: 'protein',
    ring: 'protein',
  },
  epic: {
    label: 'Epic',
    tile: 'bg-viz-alt/20 text-text-1 [&_svg]:text-viz-alt',
    chip: 'bg-viz-alt/20 text-text-1',
    bar: 'alt',
    ring: 'alt',
  },
  legendary: {
    label: 'Legendary',
    tile: 'bg-warning-soft text-warning-text',
    chip: 'bg-warning-soft text-warning-text',
    bar: 'carbs',
    ring: 'carbs',
  },
};

export const RARITY_ORDER: Record<Rarity, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
};

export const CATEGORY_LABEL: Record<Category, string> = {
  workout: 'Training',
  nutrition: 'Nutrition',
  social: 'Community',
  streak: 'Consistency',
  milestone: 'Milestones',
  special: 'Special',
  seasonal: 'Seasonal',
};

/** One stroke icon per category — replaces the platform-dependent emoji. */
export const CATEGORY_ICON: Record<Category, (props: { size?: number; filled?: boolean }) => ReactNode> = {
  workout: (p) => <Dumbbell {...p} />,
  nutrition: (p) => <Plate {...p} />,
  social: (p) => <Users {...p} />,
  streak: (p) => <Flame {...p} />,
  milestone: (p) => <Target {...p} />,
  special: (p) => <Sparkles {...p} />,
  seasonal: (p) => <CalendarDays {...p} />,
};

/* ------------------------------------------------------------- badge art */

/**
 * The catalogue names each badge's glyph in the mobile client's icon
 * vocabulary (`icon: 'ribbon'`, `iconColor: '#00D4AA'`). Known names map to
 * our stroke icons; anything else keeps the category glyph. The colour is
 * catalogue data, not a design token, so it tints the tile and is mixed
 * toward the text colour for the glyph, which holds contrast in both themes.
 */
const BADGE_ICONS: Readonly<Record<string, (props: IconProps) => ReactNode>> = {
  ribbon: (p) => <Medal {...p} />,
  medal: (p) => <Medal {...p} />,
  trophy: (p) => <Trophy {...p} />,
  award: (p) => <Award {...p} />,
  star: (p) => <Star {...p} />,
  sparkles: (p) => <Sparkles {...p} />,
  flame: (p) => <Flame {...p} />,
  fire: (p) => <Flame {...p} />,
  flash: (p) => <Zap {...p} />,
  bolt: (p) => <Zap {...p} />,
  barbell: (p) => <Dumbbell {...p} />,
  fitness: (p) => <Dumbbell {...p} />,
  dumbbell: (p) => <Dumbbell {...p} />,
  nutrition: (p) => <Plate {...p} />,
  restaurant: (p) => <Plate {...p} />,
  people: (p) => <Users {...p} />,
  users: (p) => <Users {...p} />,
  heart: (p) => <Heart {...p} />,
  footsteps: (p) => <Footprints {...p} />,
  walk: (p) => <Footprints {...p} />,
  calendar: (p) => <CalendarDays {...p} />,
  target: (p) => <Target {...p} />,
  'checkmark-circle': (p) => <CheckCircle {...p} />,
  time: (p) => <Clock {...p} />,
};

const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function badgeGlyph(achievement: Pick<Achievement, 'icon' | 'category'>): (props: IconProps) => ReactNode {
  const key = String(achievement.icon || '')
    .trim()
    .toLowerCase()
    .replace(/-(outline|sharp)$/, '');
  return BADGE_ICONS[key] ?? CATEGORY_ICON[categoryOf(achievement)];
}

export function badgeTint(iconColor?: string | null): CSSProperties | undefined {
  const value = (iconColor || '').trim();
  if (!HEX_COLOUR.test(value)) return undefined;
  return {
    background: `color-mix(in oklab, ${value} 22%, var(--surface-1))`,
    color: `color-mix(in oklab, ${value} 65%, var(--text-1))`,
  };
}

/**
 * The card's whole-surface details button carries a stable id so the page can
 * hand focus to it once a Claim control has replaced itself with "Details".
 */
export const detailsButtonId = (achievementId: string) => `achievement-${achievementId}-details`;

export const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'MMM d, yyyy') : '';
};

/** "Awarded" for a silent backfill, "Earned Sep 12, 2026" otherwise. */
export function earnedLine(a: Achievement): string {
  const state = awardState(a);
  if (state.kind === 'unearned') return '';
  if (!state.showDate) return state.label;
  const when = fmtDate(a.earnedAt);
  return `${state.label} ${when || 'recently'}`;
}

/** Criteria met first, then rarer first, then by title. */
export function compareForGrid(x: Achievement, y: Achievement): number {
  const metDelta = Number(Boolean(y.canClaim && !y.isEarned)) - Number(Boolean(x.canClaim && !x.isEarned));
  if (metDelta !== 0) return metDelta;
  const rarityDelta = RARITY_ORDER[rarityOf(x)] - RARITY_ORDER[rarityOf(y)];
  return rarityDelta !== 0 ? rarityDelta : x.title.localeCompare(y.title);
}

export function groupByCategory(items: readonly Achievement[]): Array<readonly [Category, Achievement[]]> {
  const buckets = new Map<Category, Achievement[]>();
  for (const a of items) {
    if (!isVisible(a)) continue;
    const key = categoryOf(a);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(a);
    else buckets.set(key, [a]);
  }
  for (const bucket of buckets.values()) bucket.sort(compareForGrid);
  return CATEGORIES.filter((c) => buckets.has(c)).map((c) => [c, buckets.get(c) as Achievement[]] as const);
}

/* --------------------------------------------------------------- sub views */

export function RarityChip({ rarity, size = 'md' }: { rarity: Rarity; size?: 'sm' | 'md' }) {
  const style = RARITY_STYLE[rarity];
  const strong = rarity === 'epic' || rarity === 'legendary';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-xs font-semibold',
        size === 'sm' ? 'h-5 px-1.5 text-2xs' : 'h-6 px-2 text-2xs',
        style.chip,
      )}
    >
      <Star size={12} filled={strong} />
      {style.label}
    </span>
  );
}

/** The badge's art: the catalogue's own glyph and colour where it names them, else the category glyph on the rarity tile. */
export function BadgeTile({
  achievement,
  size = 'md',
  className,
  earned,
}: {
  achievement: Achievement;
  size?: 'md' | 'lg';
  className?: string;
  earned?: boolean;
}) {
  const rarity = rarityOf(achievement);
  const Glyph = badgeGlyph(achievement);
  const tint = badgeTint(achievement.iconColor);
  return (
    <div
      className={cx(
        'flex shrink-0 items-center justify-center rounded-md',
        size === 'lg' ? 'h-16 w-16' : 'h-12 w-12',
        !tint && RARITY_STYLE[rarity].tile,
        earned === false && 'opacity-70 saturate-50',
        className,
      )}
      style={tint}
      aria-hidden="true"
    >
      {Glyph({ size: size === 'lg' ? 30 : 22 })}
    </div>
  );
}

export function AchievementCard({
  achievement,
  claimAllowed,
  onClaim,
  claiming,
  celebrate,
  onOpen,
}: {
  achievement: Achievement;
  /** False until capabilities have answered, and false under auto-award. */
  claimAllowed: boolean;
  onClaim: () => void;
  claiming: boolean;
  /** Flips to true once right after a successful claim to play the spring. */
  celebrate: boolean;
  onOpen: () => void;
}) {
  const rarity = rarityOf(achievement);
  const style = RARITY_STYLE[rarity];
  const earned = Boolean(achievement.isEarned);
  const required = achievement.required ?? achievement.criteria?.value ?? 1;
  const current = achievement.progress ?? 0;
  const percent =
    achievement.progressPercentage ??
    (required > 0 ? Math.min((current / required) * 100, 100) : 0);
  // "9 / 1 posts" reads as a bug; once the target is met the count caps there.
  const shown = Math.min(current, required);
  // Criteria met but not yet awarded: ember, whether Claim is offered or the award is on its way.
  const met = !earned && (achievement.canClaim === true || current >= required);
  const claimable = showClaim(achievement, claimAllowed);
  const fresh = isNewAward(achievement);
  const explainer = criteriaExplainer(achievement.criteria?.type);
  const { className: pulseClass, pulse } = usePulse();

  useEffect(() => {
    if (celebrate) pulse();
  }, [celebrate, pulse]);

  return (
    <Card
      interactive
      padded={false}
      className={cx(
        'relative flex h-full flex-col gap-3 p-4',
        met && 'border-accent/40',
        earned && 'border-brand/30',
      )}
    >
      {/* Whole-card target; controls below sit above it. */}
      <button
        type="button"
        id={detailsButtonId(achievement._id)}
        onClick={onOpen}
        aria-label={`${achievement.title}: details`}
        className="absolute inset-0 z-[1] rounded-[inherit]"
      />

      <div className="flex items-start gap-3">
        <BadgeTile achievement={achievement} earned={earned || met} className={pulseClass} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-md font-semibold text-text-1">{achievement.title}</h3>
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-text-2">
            {achievement.description}
          </p>
        </div>
        {earned ? (
          <span
            className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text"
            aria-label="Earned"
            role="img"
          >
            <Check size={16} />
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <RarityChip rarity={rarity} />
        {fresh ? <Badge tone="brand">New</Badge> : null}
        {achievement.isSeasonal ? (
          <Badge tone="warning">
            <CalendarDays size={12} /> Seasonal
          </Badge>
        ) : null}
        {achievement.rewards?.points ? (
          <Badge tone="brand" className="tabular">{`+${formatStat(achievement.rewards.points)} pts`}</Badge>
        ) : null}
        {achievement.rewards?.experience ? (
          <Badge tone="info" className="tabular">{`+${formatStat(achievement.rewards.experience)} XP`}</Badge>
        ) : null}
      </div>

      {earned ? (
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-text">
          <Trophy size={14} /> {earnedLine(achievement)}
        </p>
      ) : (
        <div className="space-y-1.5">
          <Progress
            value={percent}
            size="sm"
            tone={met ? 'accent' : style.bar}
            label={`${achievement.title} progress`}
          />
          <p className="flex items-baseline justify-between text-xs text-text-2">
            <span className="tabular">
              {`${formatStat(shown)} / ${formatStat(required)} ${criteriaUnit(achievement.criteria?.type, required)}`}
            </span>
            <span className={cx('tabular font-semibold', met ? 'text-accent-text' : 'text-text-1')}>
              {current >= required ? 'Criteria met' : `${Math.round(percent)}%`}
            </span>
          </p>
          {explainer ? <p className="text-xs leading-5 text-text-2">{explainer}</p> : null}
        </div>
      )}

      <div className="mt-auto pt-1">
        {claimable ? (
          <Button
            variant="primary"
            block
            loading={claiming}
            onClick={onClaim}
            icon={<Award size={18} />}
            className="relative z-[2]"
          >
            Claim reward
          </Button>
        ) : (
          <span className="inline-flex h-6 items-center gap-1 text-xs font-semibold text-text-2">
            Details <ChevronRight size={14} />
          </span>
        )}
      </div>
    </Card>
  );
}

/** Cards grouped by category; retired rows appear only when already earned. */
export function AchievementGrid({
  items,
  claimAllowed,
  claimingId,
  celebrateId,
  onClaim,
  onOpen,
  showEarnedCounts = true,
}: {
  items: readonly Achievement[];
  claimAllowed: boolean;
  claimingId?: string | null;
  celebrateId?: string | null;
  onClaim: (achievement: Achievement) => void;
  onOpen: (achievement: Achievement) => void;
  /** "3/5 earned" per group (the member's view) or "5 badges" (the catalogue). */
  showEarnedCounts?: boolean;
}) {
  const grouped = groupByCategory(items);
  return (
    <div className="space-y-8">
      {grouped.map(([cat, list]) => {
        const earnedHere = list.filter((a) => a.isEarned).length;
        return (
          <Section
            key={cat}
            title={
              <span className="inline-flex items-center gap-2">
                <span className={cx(cat === 'streak' ? 'text-accent' : 'text-brand')}>
                  {CATEGORY_ICON[cat]({ size: 20 })}
                </span>
                {CATEGORY_LABEL[cat]}
              </span>
            }
            action={
              <span className="tabular text-xs font-semibold text-text-2">
                {showEarnedCounts
                  ? `${earnedHere}/${list.length} earned`
                  : `${list.length} ${list.length === 1 ? 'badge' : 'badges'}`}
              </span>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((achievement) => (
                <AchievementCard
                  key={achievement._id}
                  achievement={achievement}
                  claimAllowed={claimAllowed}
                  claiming={claimingId === achievement._id}
                  celebrate={celebrateId === achievement._id}
                  onClaim={() => onClaim(achievement)}
                  onOpen={() => onOpen(achievement)}
                />
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}
