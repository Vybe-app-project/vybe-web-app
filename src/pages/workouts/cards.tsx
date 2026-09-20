import type { ReactNode } from 'react';
import { mediaUrl } from '../../lib/api';
import { cx, formatStat, humanize, usePulse, type BadgeTone } from '../../components/ui';
import { Dumbbell, Heart } from '../../components/icons';
import type { SocialWorkout } from './model';

/* Small presentational pieces the Train pages share. */

/** Quiet, non-interactive facts about a workout: exercises, minutes, kcal. */
export function MetaList({
  items,
  className,
}: {
  items: Array<{ icon: ReactNode; label: string; title?: string } | null | false>;
  className?: string;
}) {
  const list = items.filter(Boolean) as Array<{ icon: ReactNode; label: string; title?: string }>;
  if (!list.length) return null;
  return (
    <ul className={cx('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-text-2', className)}>
      {list.map((m) => (
        <li key={m.label} className="inline-flex items-center gap-1.5 tabular" title={m.title}>
          <span className="text-text-3" aria-hidden="true">
            {m.icon}
          </span>
          {m.label}
        </li>
      ))}
    </ul>
  );
}

/** Heart with the spring pulse. `count` stays visible so the button reads as a stat too. */
export function LikeButton({
  liked,
  count,
  onToggle,
  disabled,
  className,
}: {
  liked: boolean;
  count: number;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const { className: pulseClass, pulse } = usePulse();
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={`${liked ? 'Unlike' : 'Like'}, ${formatStat(count)} ${count === 1 ? 'like' : 'likes'}`}
      disabled={disabled}
      onClick={() => {
        if (!liked) pulse();
        onToggle();
      }}
      className={cx(
        'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm px-2.5 text-sm font-semibold transition-colors dur-1',
        liked ? 'text-text-1' : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
        'disabled:cursor-not-allowed disabled:text-text-3',
        className,
      )}
    >
      <Heart size={20} filled={liked} className={pulseClass} />
      <span className="tabular">{formatStat(count)}</span>
    </button>
  );
}

export function CoverArt({ workout, className, compact = false }: { workout: SocialWorkout; className?: string; compact?: boolean }) {
  const cover = workout.image?.uri ? mediaUrl(workout.image.uri) : '';
  if (cover) {
    return <img src={cover} alt="" loading="lazy" decoding="async" className={cx('h-full w-full object-cover', className)} />;
  }
  return (
    <div className={cx('flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-2 text-text-3', className)} aria-hidden="true">
      <Dumbbell size={compact ? 18 : 32} />
      {compact ? null : <span className="type-label text-text-3">{humanize(workout.category)}</span>}
    </div>
  );
}

/** Category chips stay tonal: the one coloured control on a screen is its action. */
export const categoryTone = (category: string): BadgeTone => {
  switch (category) {
    case 'cardio':
    case 'running':
    case 'hiit':
      return 'accent';
    case 'yoga':
    case 'flexibility':
      return 'info';
    default:
      return 'neutral';
  }
};

export const exerciseCount = (n: number) => `${formatStat(n)} ${n === 1 ? 'exercise' : 'exercises'}`;
