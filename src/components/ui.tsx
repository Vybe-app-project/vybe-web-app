import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  Ref,
  RefObject,
  TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { errMsg, mediaUrl } from '../lib/api';
import { RATE_LIMITED_TOAST_KEY, isRateLimitedCopy, parseApiError } from '../lib/apiError';
import { describedByIds } from '../lib/a11y';
import { useAuth } from '../lib/auth';
import { toastViewportClass, upsertToast } from '../lib/toastPlacement';
import { Brand, BrandMark, PairFigure } from './Brand';
import { ILLUSTRATIONS } from './icons';
import type { IllustrationFamily } from './icons';
import {
  Alert as AlertIcon,
  Calendar as CalendarIcon,
  Check as CheckIcon,
  CheckCircle,
  ChevronDown,
  Info as InfoIcon,
  Minus,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Search as SearchIcon,
  Sun,
  TrendingDown,
  TrendingUp,
  WifiOff,
  X as XIcon,
} from './icons';

export { Brand, BrandMark, PairFigure };
/* Gym copy helpers (and the deprecated GymBand shim), the map tile, and the
   page chrome store — PageChrome.tsx owns it now, re-exported here so no import
   site moves. */
export { GymBand, NO_GYM_COPY, memberCountLabel, trainingTodayLine } from './GymBand';
export type { GymBandGym, GymBandProps } from './GymBand';
export { MapTile, osmHref } from './MapTile';
export type { MapTileProps } from './MapTile';
export { PageHeader, usePageChrome, usePageChromeStore } from './PageChrome';
export type { PageBand, PageChrome } from './PageChrome';
export type { IllustrationFamily } from './icons';

/* ================================================================== helpers */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Generated identity: one of five token gradient pairs (--identity-1..5) with
 * its ink, picked by hashing an id or handle so a person or place always gets
 * the same colour everywhere. The grey-initials tile is gone.
 */
export function identityIndex(seed?: string | null): 1 | 2 | 3 | 4 | 5 {
  const text = (seed ?? '').trim() || '?';
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return ((h % 5) + 1) as 1 | 2 | 3 | 4 | 5;
}
export function identityStyle(seed?: string | null): CSSProperties {
  const n = identityIndex(seed);
  return { background: `var(--identity-${n})`, color: `var(--identity-${n}-ink)` };
}

const ACRONYMS: Record<string, string> = {
  hiit: 'HIIT',
  amrap: 'AMRAP',
  emom: 'EMOM',
  bmi: 'BMI',
  pr: 'PR',
  kcal: 'kcal',
  km: 'km',
  mi: 'mi',
  tv: 'TV',
};

/** `strength_training` → "Strength training", `hiit` → "HIIT". */
export { plural, fmtStamp, isoStamp, ensureSentence } from '../lib/format';

export function humanize(value?: string | null): string {
  if (!value) return '';
  const words = String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/);
  return words
    .map((w, i) => (ACRONYMS[w] ? ACRONYMS[w] : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Stat formatting: thousands separators below 100k, compact above. */
export function formatStat(n?: number | null, opts: { compact?: boolean } = {}): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  if (opts.compact || Math.abs(v) >= 100_000) return compactFormat.format(v);
  return numberFormat.format(v);
}

/**
 * A number worth drawing as a metric: finite and above zero. Zero is never a
 * metric ("0 kcal" is a hole, not a fact); StatTile, StatStrip, Ring and
 * Metric render their `fallback` — the next action — instead.
 */
export function hasMetric(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** null, undefined or a number that is not a metric: the cases `fallback` covers. Strings and nodes render as given. */
export function isEmptyMetric(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && !hasMetric(v));
}

/* ================================================================== motion */

/** The OS preference OR the account's `settings.accessibility.reduceMotion` (lib/accessibility sets the <html> attribute). */
export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-reduce-motion') === 'true';
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
export const useIsTouch = () => useMediaQuery('(pointer: coarse)');
/** Mirrors Tailwind's `md` breakpoint; used for sheet-vs-dialog presentation. */
export const useIsCompact = () => useMediaQuery('(max-width: 767px)');

export const DURATION = { 1: 120, 2: 200, 3: 320, 4: 480 } as const;

/**
 * Keeps a component mounted while it plays its exit animation.
 * Returns `{ mounted, exiting }`; durations collapse under reduced motion.
 */
export function usePresence(open: boolean, duration: number = DURATION[3]) {
  const [mounted, setMounted] = useState(open);
  const [exiting, setExiting] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setExiting(false);
      return;
    }
    setMounted((m) => {
      if (!m) return m;
      setExiting(true);
      return m;
    });
    const id = setTimeout(
      () => {
        setMounted(false);
        setExiting(false);
      },
      prefersReducedMotion() ? 0 : duration,
    );
    return () => clearTimeout(id);
  }, [open, duration]);
  return { mounted, exiting };
}

/**
 * Spring micro-interaction for like / save. `pulse()` replays the
 * scale 1 → 1.25 → 1 animation on whatever carries `className`.
 */
export function usePulse(): { className: string; pulse: () => void } {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulse = useCallback(() => {
    if (prefersReducedMotion()) return;
    setActive(false);
    if (timer.current) clearTimeout(timer.current);
    // Restart the animation on the next frame even if it is mid-flight.
    requestAnimationFrame(() => {
      setActive(true);
      timer.current = setTimeout(() => setActive(false), DURATION[3] + 40);
    });
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { className: active ? 'motion-pulse' : '', pulse };
}

/* ================================================================== theme */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'vybe.theme';

function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref;
}

/** Applies the class before paint and keeps the browser chrome colour in step. */
export function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) {
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
      m.content = bg;
    });
  }
}

type ThemeState = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
};

export const useTheme = create<ThemeState>((set) => {
  const preference = readThemePreference();
  return {
    preference,
    resolved: resolveTheme(preference),
    setPreference: (p) => {
      try {
        if (p === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
        else localStorage.setItem(THEME_STORAGE_KEY, p);
      } catch {
        /* private mode: keep it in memory */
      }
      const resolved = resolveTheme(p);
      applyTheme(resolved);
      set({ preference: p, resolved });
    },
  };
});

/** Mount once (App) so a `system` preference follows OS changes live. */
export function useThemeSync() {
  useEffect(() => {
    applyTheme(useTheme.getState().resolved);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (useTheme.getState().preference !== 'system') return;
      const resolved = resolveTheme('system');
      applyTheme(resolved);
      useTheme.setState({ resolved });
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/**
 * Settings → Appearance. A radiogroup styled as a segmented control.
 * `iconOnly` is for rails narrower than ~280 px (the staff console sidebar):
 * three labelled segments there squeezed the icons to 0–10 px, so the label
 * moves to the accessible name and a tooltip instead.
 */
export function ThemeControl({ className, label = 'Appearance', iconOnly = false }: { className?: string; label?: string; iconOnly?: boolean }) {
  const preference = useTheme((s) => s.preference);
  const setPreference = useTheme((s) => s.setPreference);
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-grid w-full grid-cols-3 gap-1 rounded-sm border border-line bg-surface-2 p-1', className)}>
      {THEME_OPTIONS.map(({ value, label: l, Icon }) => {
        const checked = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={iconOnly ? l : undefined}
            title={iconOnly ? l : undefined}
            onClick={() => setPreference(value)}
            className={cx(
              'inline-flex min-h-10 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[calc(var(--radius-sm)-2px)] px-2 text-sm font-semibold transition-colors dur-1 pointer-coarse:min-h-11',
              checked ? 'bg-surface-1 text-text-1 shadow-1' : 'text-text-2 hover:text-text-1',
            )}
          >
            <Icon size={18} className="shrink-0" />
            {iconOnly ? null : <span className="truncate">{l}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ================================================================== document title */

/**
 * Sets the tab title for pages outside the app shell (auth, public support,
 * not-found). Layout owns the title for routed pages; this restores whatever
 * was there when the page unmounts so the two never fight.
 */
export function useDocumentTitle(title: string | undefined, suffix = ' · Vybe') {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title}${suffix}`;
    return () => {
      document.title = previous;
    };
  }, [title, suffix]);
}

/* ================================================================== section */

/** Section heading: `.t-section` (16/600) + optional trailing action. */
export function Section({
  title,
  action,
  children,
  className,
  description,
}: {
  title: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('space-y-3', className)}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="t-section text-text-1">{title}</h2>
          {description ? <p className="text-sm text-text-2">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ================================================================== spinner */

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={cx('animate-spin', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.18" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] w-full flex-col items-center justify-center gap-3">
      <Spinner size={28} className="text-brand" />
      {label ? <p className="text-sm text-text-2">{label}</p> : null}
    </div>
  );
}

/* ================================================================== skeleton */

export function Skeleton({ className, style, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cx('skeleton', className)} style={style} {...rest} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

/** Avatar + two lines: user rows, notifications, room lists. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center gap-3 py-2', className)}>
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

/** Boxed skeleton for card consumers (header, media, two lines, action bar). The feed's hairline rows have their own PostCardSkeleton in PostCard.tsx. */
export function SkeletonCard({ media = true, className }: { media?: boolean; className?: string }) {
  return (
    <div className={cx('card p-4', className)}>
      <SkeletonRow className="py-0" />
      {media ? <Skeleton className="mt-4 aspect-[4/5] w-full rounded-md" /> : null}
      <SkeletonText lines={2} className="mt-4" />
      <div className="mt-4 flex gap-4">
        <Skeleton className="h-6 w-12" />
        <Skeleton className="h-6 w-12" />
        <Skeleton className="h-6 w-12" />
      </div>
    </div>
  );
}

/** Matches StatTile. */
export function SkeletonTile({ className }: { className?: string }) {
  return (
    <div className={cx('card p-4', className)}>
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="mt-3 h-8 w-2/3" />
      <Skeleton className="mt-3 h-3 w-1/3" />
    </div>
  );
}

/* ================================================================== avatar */

const AVATAR_SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 88, '2xl': 96 } as const;
export type AvatarSize = keyof typeof AVATAR_SIZES | number;

export function initialsOf(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function avatarPx(size: AvatarSize): number {
  return typeof size === 'number' ? size : AVATAR_SIZES[size];
}

export function Avatar({
  src,
  name,
  alt,
  size = 'md',
  className,
  ring,
  ringTone = 'brand',
  seed,
  loading = 'eager',
}: {
  src?: string | null;
  name?: string;
  alt?: string;
  size?: AvatarSize;
  className?: string;
  /** Story ring: 2 px brand with an offset in the page background. */
  ring?: boolean;
  ringTone?: 'brand' | 'accent' | 'neutral';
  /** Id or handle that picks the generated colour; falls back to the name. */
  seed?: string | null;
  /** `lazy` defers the fetch until the avatar nears the viewport — for long lists only. Above the fold an eager avatar never pops in late. */
  loading?: 'eager' | 'lazy';
}) {
  const px = avatarPx(size);
  const [broken, setBroken] = useState(false);
  const url = src ? mediaUrl(src) : '';

  useEffect(() => {
    setBroken(false);
  }, [url]);

  const style: CSSProperties = {
    width: px,
    height: px,
    minWidth: px,
    fontSize: Math.max(11, Math.round(px * 0.36)),
  };

  const base = cx(
    'inline-flex select-none items-center justify-center overflow-hidden rounded-full align-middle',
    ring && 'ring-2 ring-offset-2 ring-offset-bg',
    ring && ringTone === 'brand' && 'ring-brand',
    ring && ringTone === 'accent' && 'ring-accent',
    ring && ringTone === 'neutral' && 'ring-line-strong',
    className,
  );

  if (url && !broken) {
    return (
      <img
        src={url}
        alt={alt || name || 'avatar'}
        width={px}
        height={px}
        loading={loading === 'lazy' ? 'lazy' : undefined}
        decoding="async"
        style={style}
        onError={() => {
          setBroken(true);
          // Signed media URLs expire; when one does, re-read the session so
          // the store (and every avatar bound to it) gets a fresh URL. The
          // effect above clears `broken` once `src` changes.
          if (url.includes('/api/media/content/')) void useAuth.getState().refreshUser();
        }}
        className={cx(base, 'bg-surface-3 object-cover')}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={alt || name || 'avatar'}
      title={name}
      style={{ ...style, ...identityStyle(seed || name) }}
      className={cx(base, 'font-semibold')}
    >
      {initialsOf(name)}
    </span>
  );
}

type AvatarLike = { src?: string | null; name?: string; seed?: string | null };

/** Two overlapping avatars — "trained with". */
export function AvatarPair({ a, b, size = 'md', className }: { a: AvatarLike; b: AvatarLike; size?: AvatarSize; className?: string }) {
  const px = avatarPx(size);
  return (
    <span className={cx('inline-flex items-center', className)} style={{ height: px, width: px * 1.6 }}>
      <Avatar {...a} size={px} className="relative z-10 ring-2 ring-bg" />
      <span className="inline-flex" style={{ marginLeft: -px * 0.4 }}>
        <Avatar {...b} size={px} className="ring-2 ring-bg" />
      </span>
    </span>
  );
}

/** Up to `max` participants with a "+N" tail. */
export function AvatarStack({
  users,
  size = 'sm',
  max = 4,
  className,
}: {
  users: AvatarLike[];
  size?: AvatarSize;
  max?: number;
  className?: string;
}) {
  const px = avatarPx(size);
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className={cx('inline-flex items-center', className)}>
      {shown.map((u, i) => (
        <span key={i} className="rounded-full ring-2 ring-bg" style={{ marginLeft: i === 0 ? 0 : -px * 0.3 }}>
          <Avatar {...u} size={px} />
        </span>
      ))}
      {rest > 0 ? (
        <span
          className="tabular inline-flex items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-text-2 ring-2 ring-bg"
          style={{ width: px, height: px, marginLeft: -px * 0.3 }}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

/* ================================================================== button */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' | 'brand' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  brand: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-quiet',
  quiet: 'btn-quiet',
  danger: 'btn-danger',
  link: 'btn-link',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: '[--btn-h:40px] px-3 text-xs',
  md: '[--btn-h:44px]',
  lg: '[--btn-h:52px] px-6 text-base',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
};

export function buttonClass({
  variant = 'secondary',
  size = 'md',
  block = false,
  className,
}: Pick<ButtonProps, 'variant' | 'size' | 'block' | 'className'>): string {
  return cx('btn', BUTTON_VARIANT[variant], BUTTON_SIZE[size], block && 'w-full', className);
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  iconRight,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonClass({ variant, size, block, className }), loading && 'relative')}
      {...rest}
    >
      {loading ? (
        <span className="absolute inset-0 inline-flex items-center justify-center" aria-hidden="true">
          <Spinner size={18} />
        </span>
      ) : null}
      <span className={cx('inline-flex items-center gap-2', loading && 'invisible')}>
        {icon}
        {children}
        {iconRight}
      </span>
    </button>
  );
}

/** Router link styled as a button. */
export function ButtonLink({
  to,
  variant = 'secondary',
  size = 'md',
  block,
  icon,
  iconRight,
  className,
  children,
  viewTransition = true,
  state,
  ...rest
}: {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  className?: string;
  children?: ReactNode;
  viewTransition?: boolean;
  /** Router location state for the destination (e.g. where its back link should return to). */
  state?: unknown;
} & Omit<HTMLAttributes<HTMLAnchorElement>, 'className' | 'children'>) {
  return (
    <Link to={to} state={state} viewTransition={viewTransition} className={buttonClass({ variant, size, block, className })} {...rest}>
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  size?: 40 | 44 | 48;
  variant?: 'ghost' | 'secondary' | 'primary' | 'danger';
  active?: boolean;
  /** Small count pill in the top-right corner. */
  badge?: number | string | null;
  to?: string;
  /** Router state for `to` links. */
  state?: unknown;
  /** Handlers for the link form (`to`), e.g. the shell's route-change intent props (preload + pending destination). */
  linkProps?: Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'onPointerDown' | 'onMouseEnter' | 'onFocus' | 'onClick'>;
};

const ICON_BUTTON_VARIANT = {
  ghost: 'text-text-2 hover:text-text-1',
  secondary: 'border border-line-strong bg-surface-2 text-text-1 hover:bg-surface-3',
  primary: 'bg-brand text-on-brand hover:bg-brand-hover',
  danger: 'text-danger hover:bg-danger-soft',
} as const;

export function IconButton({
  label,
  size = 44,
  variant = 'ghost',
  active = false,
  badge,
  to,
  state,
  linkProps,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const cls = cx(
    'pressable relative inline-flex shrink-0 items-center justify-center rounded-sm transition-colors dur-1',
    size === 40 ? 'h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11' : size === 48 ? 'h-12 w-12' : 'h-11 w-11',
    ICON_BUTTON_VARIANT[variant],
    active && variant === 'ghost' && 'bg-brand-soft text-brand-text',
    className,
  );
  const inner = (
    <>
      {children}
      {badge ? <CountBadge value={badge} className="absolute -right-0.5 -top-0.5" /> : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} state={state} viewTransition aria-label={label} title={label} className={cls} {...linkProps}>
        {inner}
      </Link>
    );
  }
  return (
    <button type={type} aria-label={label} title={label} className={cls} {...rest}>
      {inner}
    </button>
  );
}

/** Unread pill on nav items and icon buttons: Instagram's red, the one semantic colour in the chrome. */
export function CountBadge({ value, className, max = 99 }: { value: number | string; className?: string; max?: number }) {
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'number' && value <= 0) return null;
  const text = Number.isFinite(n) && n > max ? `${max}+` : String(value);
  return (
    <span
      className={cx(
        'tabular inline-flex min-w-4.5 items-center justify-center rounded-full bg-danger px-1 text-2xs font-bold leading-4.5 text-on-brand ring-2 ring-bg',
        className,
      )}
    >
      {text}
    </span>
  );
}

/* ================================================================== fields */

type FieldProps = {
  label?: string;
  hint?: string;
  error?: string | null;
  containerClassName?: string;
  /** Visually hide the label but keep it for assistive tech. */
  hideLabel?: boolean;
};

function FieldShell({
  id,
  label,
  hint,
  error,
  hideLabel,
  containerClassName,
  children,
  labelAs = 'label',
}: FieldProps & { id: string; children: ReactNode; labelAs?: 'label' | 'span' }) {
  const LabelTag = labelAs;
  return (
    <div className={cx('w-full', containerClassName)}>
      {label ? (
        <LabelTag
          id={`${id}-label`}
          htmlFor={labelAs === 'label' ? id : undefined}
          className={cx('type-label mb-1.5 block text-text-2', hideLabel && 'sr-only')}
        >
          {label}
        </LabelTag>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
          <AlertIcon size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-text-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  label,
  hint,
  error,
  hideLabel,
  containerClassName,
  className,
  id,
  leading,
  trailing,
  ref,
  'aria-describedby': describedBy,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & FieldProps & { leading?: ReactNode; trailing?: ReactNode; ref?: Ref<HTMLInputElement> }) {
  const auto = useId();
  const inputId = id || auto;
  return (
    <FieldShell id={inputId} label={label} hint={hint} error={error} hideLabel={hideLabel} containerClassName={containerClassName}>
      <div className="relative">
        {leading ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-text-3">{leading}</span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds(inputId, error, hint, describedBy)}
          className={cx('input-base', !!leading && 'pl-10', !!trailing && 'pr-10', className)}
          {...rest}
        />
        {trailing ? <span className="absolute inset-y-0 right-2 inline-flex items-center text-text-3">{trailing}</span> : null}
      </div>
    </FieldShell>
  );
}

/** Search input with the icon and `type="search"` semantics baked in. */
export function SearchField(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & FieldProps) {
  return <Input type="search" inputMode="search" autoComplete="off" leading={<SearchIcon size={18} />} {...props} />;
}

export function Textarea({
  label,
  hint,
  error,
  hideLabel,
  containerClassName,
  className,
  id,
  rows = 4,
  autoGrow = false,
  maxRows = 8,
  onInput,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps & { autoGrow?: boolean; maxRows?: number }) {
  const auto = useId();
  const taId = id || auto;
  const ref = useRef<HTMLTextAreaElement>(null);

  const grow = useCallback(() => {
    const el = ref.current;
    if (!el || !autoGrow) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const max = line * maxRows + 20;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [autoGrow, maxRows]);

  useLayoutEffect(() => {
    grow();
  }, [grow, rest.value]);

  return (
    <FieldShell id={taId} label={label} hint={hint} error={error} hideLabel={hideLabel} containerClassName={containerClassName}>
      <textarea
        ref={ref}
        id={taId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${taId}-error` : hint ? `${taId}-hint` : undefined}
        onInput={(e) => {
          grow();
          onInput?.(e);
        }}
        className={cx('input-base leading-relaxed', autoGrow ? 'resize-none' : 'resize-y', className)}
        {...rest}
      />
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ popover positioning */

type PopoverPlacement = { top?: number; bottom?: number; left?: number; right?: number; width?: number; maxHeight: number; above: boolean };

function usePopoverPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLElement | null>,
  opts: { align?: 'start' | 'end'; matchWidth?: boolean; gap?: number; minWidth?: number } = {},
) {
  const { align = 'start', matchWidth = false, gap = 6, minWidth = 180 } = opts;
  const [pos, setPos] = useState<PopoverPlacement | null>(null);

  const compute = useCallback(() => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const popH = popRef.current?.offsetHeight ?? 320;
    const spaceBelow = vh - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const above = spaceBelow < Math.min(popH, 288) && spaceAbove > spaceBelow;
    const width = matchWidth ? Math.max(r.width, minWidth) : undefined;
    const popW = width ?? popRef.current?.offsetWidth ?? 240;
    const next: PopoverPlacement = {
      maxHeight: Math.max(160, (above ? spaceAbove : spaceBelow) - gap),
      above,
      width,
    };
    if (above) next.bottom = vh - r.top + gap;
    else next.top = r.bottom + gap;
    if (align === 'end') next.right = Math.max(8, vw - r.right);
    else next.left = Math.min(Math.max(8, r.left), Math.max(8, vw - popW - 8));
    setPos(next);
  }, [anchorRef, popRef, align, matchWidth, gap, minWidth]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    compute();
    const raf = requestAnimationFrame(compute);
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, compute]);

  return pos;
}

function useOutsideClose(open: boolean, refs: Array<RefObject<HTMLElement | null>>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current && r.current.contains(t))) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, refs, onClose]);
}

/* ------------------------------------------------------------------ select */

export type SelectOption = {
  value: string;
  label: ReactNode;
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
};

function optionText(o: SelectOption): string {
  return typeof o.label === 'string' || typeof o.label === 'number' ? String(o.label) : o.value;
}

/**
 * Custom listbox: keyboard navigation, typeahead, flips above when short on
 * space. Emits a hidden input so it works inside plain forms.
 */
export function Select({
  label,
  hint,
  error,
  hideLabel,
  containerClassName,
  className,
  id,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  name,
  'aria-label': ariaLabel,
  leading,
}: FieldProps & {
  className?: string;
  id?: string;
  value?: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  'aria-label'?: string;
  leading?: ReactNode;
}) {
  const auto = useId();
  const selectId = id || auto;
  const listId = `${selectId}-list`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ buffer: '', at: 0 });
  const pos = usePopoverPosition(open, triggerRef, popRef, { matchWidth: true });
  const { mounted, exiting } = usePresence(open, DURATION[2]);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose(open, [triggerRef, popRef], close);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const openList = () => {
    if (disabled) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex((o) => !o.disabled));
    setOpen(true);
  };

  const commit = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const move = (dir: 1 | -1, from = activeIndex) => {
    if (!options.length) return;
    let i = from;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) {
        setActiveIndex(i);
        return;
      }
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList();
        else move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openList();
        else move(-1);
        break;
      case 'Home':
        if (open) { e.preventDefault(); move(1, -1); }
        break;
      case 'End':
        if (open) { e.preventDefault(); move(-1, 0); }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!open) openList();
        else commit(activeIndex);
        break;
      case 'Escape':
        if (open) { e.preventDefault(); setOpen(false); }
        break;
      case 'Tab':
        if (open) setOpen(false);
        break;
      default: {
        if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
        const now = Date.now();
        const t = typeahead.current;
        t.buffer = now - t.at > 600 ? e.key : t.buffer + e.key;
        t.at = now;
        const q = t.buffer.toLowerCase();
        const start = open ? activeIndex : selectedIndex;
        for (let n = 1; n <= options.length; n++) {
          const i = (start + n) % options.length;
          if (!options[i].disabled && optionText(options[i]).toLowerCase().startsWith(q)) {
            if (open) setActiveIndex(i);
            else onChange(options[i].value);
            break;
          }
        }
      }
    }
  };

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = popRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  return (
    <FieldShell id={selectId} label={label} hint={hint} error={error} hideLabel={hideLabel} containerClassName={containerClassName} labelAs="span">
      {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        aria-labelledby={!ariaLabel && label ? `${selectId}-label` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cx('input-base flex items-center gap-2 text-left', className)}
      >
        {leading ? <span className="shrink-0 text-text-3">{leading}</span> : null}
        {selected?.icon ? <span className="shrink-0">{selected.icon}</span> : null}
        <span className={cx('min-w-0 flex-1 truncate', !selected && 'text-text-3')}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={18} className={cx('shrink-0 text-text-2 transition-transform dur-2', open && 'rotate-180')} />
      </button>
      {mounted && pos
        ? createPortal(
            <div
              ref={popRef}
              id={listId}
              role="listbox"
              aria-labelledby={selectId}
              tabIndex={-1}
              style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, width: pos.width, maxHeight: pos.maxHeight, zIndex: 130 }}
              className={cx(
                'card overflow-y-auto overscroll-contain p-1 shadow-2',
                exiting ? 'anim-fade-out' : 'anim-pop-in',
              )}
            >
              {options.length === 0 ? <p className="px-3 py-2 text-sm text-text-3">No options</p> : null}
              {options.map((o, i) => {
                const isSel = o.value === value;
                const isActive = i === activeIndex;
                return (
                  <div
                    key={o.value}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={isSel}
                    aria-disabled={o.disabled || undefined}
                    onPointerMove={() => !o.disabled && setActiveIndex(i)}
                    onClick={() => commit(i)}
                    className={cx(
                      'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xs px-3 py-2 text-sm',
                      isActive && !o.disabled && 'bg-surface-2',
                      o.disabled ? 'cursor-not-allowed text-text-3' : 'text-text-1',
                    )}
                  >
                    {o.icon ? <span className="shrink-0 text-text-2">{o.icon}</span> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{o.label}</span>
                      {o.description ? <span className="block truncate text-xs text-text-2">{o.description}</span> : null}
                    </span>
                    {isSel ? <CheckIcon size={16} className="shrink-0 text-brand" /> : null}
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ checkbox / radio */

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  indeterminate,
  required,
  error,
  name,
  value,
  className,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  indeterminate?: boolean;
  /** Must be ticked to submit (aria semantics only; forms here run noValidate). */
  required?: boolean;
  /** Validation message announced under the box; the input points at it and reads invalid. */
  error?: string | null;
  name?: string;
  value?: string;
  className?: string;
  id?: string;
}) {
  const auto = useId();
  const inputId = id || auto;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const errorId = `${inputId}-error`;
  return (
    <>
      <label
        htmlFor={inputId}
        className={cx('flex min-h-11 cursor-pointer items-start gap-3 py-2.5', disabled && 'cursor-not-allowed opacity-60', className)}
      >
        <span className="relative mt-0.5 inline-flex h-5 w-5 shrink-0">
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            name={name}
            value={value}
            checked={checked}
            disabled={disabled}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => onChange(e.target.checked)}
            className="peer absolute inset-0 h-5 w-5 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
          <span
            aria-hidden="true"
            className={cx(
              'pointer-events-none inline-flex h-5 w-5 items-center justify-center rounded-xs border transition-colors dur-1',
              'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
              checked || indeterminate ? 'border-brand bg-brand text-on-brand' : 'border-control bg-surface-2 text-transparent',
            )}
          >
            {indeterminate && !checked ? <Minus size={14} strokeWidth={2.6} /> : <CheckIcon size={14} strokeWidth={2.8} />}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-text-1">{label}</span>
          {description ? <span className="block text-xs text-text-2">{description}</span> : null}
        </span>
      </label>
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-danger">
          <AlertIcon size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </>
  );
}

export type RadioOption = { value: string; label: ReactNode; description?: ReactNode; disabled?: boolean };

export function RadioGroup({
  label,
  hint,
  error,
  hideLabel,
  containerClassName,
  name,
  value,
  onChange,
  options,
  orientation = 'vertical',
  className,
}: FieldProps & {
  name?: string;
  value?: string | null;
  onChange: (value: string) => void;
  options: RadioOption[];
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}) {
  const auto = useId();
  const groupName = name || auto;
  return (
    <fieldset className={cx('min-w-0 border-0 p-0', containerClassName)} aria-describedby={error ? `${auto}-error` : hint ? `${auto}-hint` : undefined}>
      {label ? <legend className={cx('type-label mb-1.5 block text-text-2', hideLabel && 'sr-only')}>{label}</legend> : null}
      <div className={cx(orientation === 'horizontal' ? 'flex flex-wrap gap-x-6' : 'flex flex-col', className)}>
        {options.map((o) => {
          const checked = o.value === value;
          const id = `${auto}-${o.value}`;
          return (
            <label key={o.value} htmlFor={id} className={cx('flex min-h-11 cursor-pointer items-start gap-3 py-2.5', o.disabled && 'cursor-not-allowed opacity-60')}>
              <span className="relative mt-0.5 inline-flex h-5 w-5 shrink-0">
                <input
                  id={id}
                  type="radio"
                  name={groupName}
                  value={o.value}
                  checked={checked}
                  disabled={o.disabled}
                  onChange={() => onChange(o.value)}
                  className="peer absolute inset-0 h-5 w-5 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                />
                <span
                  aria-hidden="true"
                  className={cx(
                    'pointer-events-none inline-flex h-5 w-5 items-center justify-center rounded-full border transition-colors dur-1',
                    'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
                    checked ? 'border-brand' : 'border-control bg-surface-2',
                  )}
                >
                  <span className={cx('h-2.5 w-2.5 rounded-full bg-brand transition-transform dur-1', checked ? 'scale-100' : 'scale-0')} />
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-1">{o.label}</span>
                {o.description ? <span className="block text-xs text-text-2">{o.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={`${auto}-error`} role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
          <AlertIcon size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${auto}-hint`} className="mt-1.5 text-xs text-text-3">{hint}</p>
      ) : null}
    </fieldset>
  );
}

/** Native date/time input styled to the tokens; `color-scheme` keeps the picker themed. */
export function DateField({
  type = 'date',
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & FieldProps & { type?: 'date' | 'time' | 'datetime-local' | 'month' }) {
  return <Input type={type} trailing={<CalendarIcon size={18} className="pointer-events-none" />} className={cx('tabular', className)} {...rest} />;
}

/** −/＋ control for sets, reps, servings. Both targets are 44². */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  unit,
  disabled,
  format,
  hideLabel,
  containerClassName,
  className,
  hint,
  error,
}: FieldProps & {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  format?: (v: number) => string;
  className?: string;
}) {
  const id = useId();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const dec = () => onChange(clamp(value - step));
  const inc = () => onChange(clamp(value + step));
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} containerClassName={containerClassName} labelAs="span">
      <div className={cx('inline-flex items-center rounded-sm border border-control bg-surface-2', className)} role="group" aria-labelledby={label ? `${id}-label` : undefined}>
        <button type="button" aria-label={`Decrease ${label ?? ''}`.trim()} onClick={dec} disabled={disabled || value <= min} className="inline-flex h-11 w-11 items-center justify-center rounded-l-sm text-text-1 hover:bg-surface-3 disabled:text-text-3">
          <Minus size={18} />
        </button>
        <output id={id} aria-live="polite" className="type-stat min-w-14 px-2 text-center text-lg text-text-1">
          {format ? format(value) : value}
          {unit ? <span className="ml-1 text-xs font-medium text-text-2">{unit}</span> : null}
        </output>
        <button type="button" aria-label={`Increase ${label ?? ''}`.trim()} onClick={inc} disabled={disabled || value >= max} className="inline-flex h-11 w-11 items-center justify-center rounded-r-sm text-text-1 hover:bg-surface-3 disabled:text-text-3">
          <Plus size={18} />
        </button>
      </div>
    </FieldShell>
  );
}

/* ================================================================== card */

export function Card({
  className,
  padded = true,
  interactive = false,
  to,
  linkLabel,
  container = false,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
  /** Hover/pressed states; combine with `to` for a whole-card link. */
  interactive?: boolean;
  to?: string;
  linkLabel?: string;
  /** `container-type: inline-size`, so the card's internals can reflow with `@sm:`/`@md:` by the card's own width. */
  container?: boolean;
}) {
  return (
    <div
      className={cx('card', padded && 'p-4 sm:p-5', (interactive || to) && 'card-interactive', to && 'relative', container && '@container', className)}
      {...rest}
    >
      {to ? (
        <Link
          to={to}
          viewTransition
          aria-label={linkLabel}
          className="absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
      ) : null}
      {children}
    </div>
  );
}

/**
 * Card grid that fills by the space it has: `repeat(auto-fill, minmax(min(100%, min), 1fr))`.
 * Replaces the hard `sm:grid-cols-2 xl:grid-cols-3` pattern so 320 px, 1440 px and 1920 px all fill honestly.
 */
export function CardGrid({
  min,
  className,
  style,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  /** Minimum column width; default 22rem. Any CSS length. */
  min?: string;
}) {
  const vars = min ? ({ ...style, '--card-min': min } as CSSProperties) : style;
  return (
    <div className={cx('card-grid', className)} style={vars} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
  level = 2,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Heading level. Cards sit directly under the page h1 by default; pass 3 inside a titled Section. */
  level?: 2 | 3 | 4;
}) {
  const Heading = `h${level}` as const;
  return (
    <div className={cx('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <Heading className="t-section truncate text-text-1">{title}</Heading>
        {subtitle ? <p className="t-meta mt-0.5 truncate">{subtitle}</p> : null}
      </div>
      {action ? <div className="relative z-[2] shrink-0">{action}</div> : null}
    </div>
  );
}

/** Media slot inside a card: --radius-md (card 12 → media 10 → chip 6). */
export function CardMedia({
  className,
  children,
  ratio,
  as: Tag = 'div',
}: {
  className?: string;
  children: ReactNode;
  ratio?: '1/1' | '4/5' | '16/9' | '3/2';
  /** `span` when the media sits inside a `<button>` (block content is invalid there). */
  as?: 'div' | 'span';
}) {
  return (
    <Tag
      className={cx('block overflow-hidden rounded-md bg-surface-2', className)}
      style={ratio ? { aspectRatio: ratio.replace('/', ' / ') } : undefined}
    >
      {children}
    </Tag>
  );
}

/* ================================================================== badge / chip */

export type BadgeTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

/* One accent: `info` reads as brand, `success` in its own green (5.4:1 on the
   soft), `accent` (ember) is for effort — a PR badge — and never for chrome. */
const BADGE_TONES: Record<BadgeTone, string> = {
  brand: 'bg-brand-soft text-brand-text',
  neutral: 'bg-surface-2 text-text-2 border border-line',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning-text',
  danger: 'bg-danger-soft text-danger-text',
  info: 'bg-brand-soft text-brand-text',
  accent: 'bg-accent-soft text-accent-text',
};

export function Badge({
  tone = 'neutral',
  variant,
  dot = false,
  size = 'md',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; variant?: BadgeTone; dot?: boolean; size?: 'sm' | 'md' }) {
  const resolvedTone = variant || tone;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-xs font-semibold',
        size === 'sm' ? 'h-5 px-1.5 text-2xs' : 'h-6 px-2 text-2xs',
        BADGE_TONES[resolvedTone],
        className,
      )}
      {...rest}
    >
      {dot ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/** Selectable / removable chip (filters, hashtags). 36 px with a mouse, 44 px on touch. */
export function Chip({
  selected = false,
  onClick,
  onRemove,
  icon,
  to,
  className,
  children,
  removeLabel = 'Remove',
}: {
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  icon?: ReactNode;
  to?: string;
  className?: string;
  children: ReactNode;
  removeLabel?: string;
}) {
  const cls = cx(
    'pressable relative inline-flex h-9 items-center gap-1.5 rounded-xs px-3 text-xs font-semibold transition-colors dur-1 pointer-coarse:min-h-11',
    'before:absolute before:-inset-1 before:content-[""]',
    selected ? 'bg-brand-soft text-brand-text' : 'border border-line bg-surface-2 text-text-2 hover:text-text-1',
    className,
  );
  const body = (
    <>
      {icon}
      <span>{children}</span>
    </>
  );
  if (to) {
    return (
      <Link to={to} viewTransition className={cls}>
        {body}
      </Link>
    );
  }
  if (onRemove) {
    return (
      <span className={cx(cls, 'pr-1')}>
        {body}
        <button type="button" aria-label={removeLabel} onClick={onRemove} className="ml-0.5 inline-flex h-7 w-7 items-center justify-center rounded-xs hover:bg-surface-3">
          <XIcon size={14} />
        </button>
      </span>
    );
  }
  return (
    <button type="button" aria-pressed={onClick ? selected : undefined} onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

/* ================================================================== modal / sheet */

let lockCount = 0;
let lockedScrollY = 0;
const LOCK_KEYS = ['overflow', 'position', 'top', 'left', 'right', 'width'] as const;
let lockedStyle: Partial<Record<(typeof LOCK_KEYS)[number], string>> = {};

/** iPhone, iPod and iPad (which reports itself as a Mac with touch points): the Safari that scrolls the page behind an overflow:hidden body. */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iP(hone|ad|od)/.test(navigator.platform) || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);
}
/**
 * How many modals/sheets are mounted. The toast viewport reads this so that
 * on a phone, while a sheet is open, toasts anchor to the top instead of
 * covering the sheet footer and its primary button.
 */
export const useModalPresence = create<{ count: number; enter: () => void; leave: () => void }>((set) => ({
  count: 0,
  enter: () => set((s) => ({ count: s.count + 1 })),
  leave: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
}));

/** Body scroll lock shared by every overlay (nested overlays count once). */
export function useLockBody(active: boolean) {
  const enter = useModalPresence((s) => s.enter);
  const leave = useModalPresence((s) => s.leave);
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      const body = document.body;
      lockedScrollY = window.scrollY;
      lockedStyle = Object.fromEntries(LOCK_KEYS.map((k) => [k, body.style[k]]));
      body.style.overflow = 'hidden';
      // iOS Safari keeps scrolling the page under a sheet despite overflow:hidden.
      // Pinning the body at its scroll offset stops it for real; the offset is
      // put back on release so the page never jumps to the top. (html carries
      // scrollbar-gutter: stable, so desktop loses no width when the bar goes.)
      if (isIOS()) {
        body.style.position = 'fixed';
        body.style.top = `-${lockedScrollY}px`;
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
      }
    }
    lockCount++;
    enter();
    return () => {
      lockCount--;
      leave();
      if (lockCount === 0) {
        const body = document.body;
        const pinned = body.style.position === 'fixed';
        for (const k of LOCK_KEYS) body.style[k] = lockedStyle[k] ?? '';
        if (pinned) window.scrollTo(0, lockedScrollY);
      }
    };
  }, [active, enter, leave]);
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside `ref` while active and restores focus on release. */
export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>, initialFocus?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    const t = setTimeout(() => {
      const target = initialFocus?.current || focusables().find((el) => !el.hasAttribute('data-autofocus-skip')) || root;
      target.focus({ preventScroll: true });
    }, 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      root.removeEventListener('keydown', onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [active, ref, initialFocus]);
}

/** Open modals, bottom to top; see the Escape handling in Modal. */
const modalStack: symbol[] = [];
export const isTopmostModal = (token: symbol | null) => (
  modalStack.length > 0 && modalStack[modalStack.length - 1] === token
);

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';
const MODAL_WIDTH: Record<ModalSize, string> = {
  sm: 'md:max-w-[30rem]',
  md: 'md:max-w-[40rem]',
  lg: 'md:max-w-[55rem]',
  xl: 'md:max-w-[65rem]',
};

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
  /** `auto` = bottom sheet under `md`, centred dialog above. */
  presentation?: 'auto' | 'dialog' | 'sheet';
  hideClose?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
};

/**
 * Dialog on desktop, drag-to-dismiss sheet on phones. Focus is trapped and
 * restored, Escape closes, body scroll locks, and both surfaces animate in
 * and out (durations collapse under reduced motion). The panel has ONE motion
 * source: the .anim-*-in/-out classes are transitions (entering from
 * @starting-style), never a keyframe with a forwards fill — that fill pinned
 * the transform and swallowed the drag — so the inline transform the
 * swipe-to-dismiss writes is honoured and the snap-back rides the same
 * transition.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  presentation = 'auto',
  hideClose = false,
  initialFocusRef,
  className,
  bodyClassName,
}: ModalProps) {
  const compact = useIsCompact();
  const asSheet = presentation === 'sheet' || (presentation === 'auto' && compact);
  const { mounted, exiting } = usePresence(open, DURATION[2]);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useLockBody(mounted);
  // The panel mounts one render after `open` flips (usePresence), so the trap
  // has to wait for it: armed on `open` alone it read a null panel ref, never
  // re-ran, and Tab walked the page behind the sheet.
  useFocusTrap(open && mounted, panelRef, initialFocusRef);

  // Only the topmost open modal answers Escape. Every Modal listens on
  // window, and stopPropagation inside one listener does not silence its
  // siblings, so a ConfirmDialog over a sheet used to take both down.
  const stackToken = useRef<symbol | null>(null);
  useEffect(() => {
    if (!open) return;
    const mine = Symbol('modal');
    stackToken.current = mine;
    modalStack.push(mine);
    return () => {
      const at = modalStack.indexOf(mine);
      if (at >= 0) modalStack.splice(at, 1);
      if (stackToken.current === mine) stackToken.current = null;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!isTopmostModal(stackToken.current)) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Swipe-to-dismiss on the sheet handle / header. Only a finger starts a
  // drag: capturing a mouse/pen pointer here stole the click from the Close
  // button (the X did nothing on a narrow desktop window or an iPad with a
  // trackpad), and a press that begins on a control is that control's.
  const drag = useRef<{ startY: number; startT: number; dy: number } | null>(null);
  const onDragStart = (e: ReactPointerEvent) => {
    if (!asSheet) return;
    if (e.pointerType !== 'touch') return;
    if ((e.target as HTMLElement | null)?.closest?.('button, a, input, textarea, select, [role="button"]')) return;
    drag.current = { startY: e.clientY, startT: performance.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (panelRef.current) panelRef.current.style.transition = 'none';
  };
  const onDragMove = (e: ReactPointerEvent) => {
    if (!drag.current || !panelRef.current) return;
    const dy = Math.max(0, e.clientY - drag.current.startY);
    drag.current.dy = dy;
    panelRef.current.style.transform = `translateY(${dy}px)`;
  };
  const onDragEnd = () => {
    const d = drag.current;
    const panel = panelRef.current;
    drag.current = null;
    if (!d || !panel) return;
    const velocity = d.dy / Math.max(1, performance.now() - d.startT);
    panel.style.transition = '';
    if (d.dy > 96 || velocity > 0.6) {
      onClose();
    } else {
      panel.style.transform = '';
    }
  };

  useEffect(() => {
    if (!open && panelRef.current) panelRef.current.style.transform = '';
  }, [open]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cx(
        'fixed inset-0 z-[100] flex justify-center bg-scrim',
        asSheet ? 'items-end' : 'items-center p-4',
        exiting ? 'anim-fade-out' : 'anim-fade-in',
      )}
      onPointerDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? 'Dialog' : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx(
          'flex w-full flex-col bg-surface-1 text-text-1 shadow-3 outline-none',
          asSheet
            ? 'max-h-[calc(100dvh-4rem)] rounded-t-xl border-t border-line pb-[env(safe-area-inset-bottom)]'
            : cx('max-h-[calc(100dvh-2rem)] rounded-lg border border-line', MODAL_WIDTH[size]),
          asSheet ? (exiting ? 'anim-sheet-out' : 'anim-sheet-in') : exiting ? 'anim-dialog-out' : 'anim-dialog-in',
          className,
        )}
      >
        {asSheet ? (
          <div
            className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-3 active:cursor-grabbing"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            aria-hidden="true"
          >
            <span className="h-1.5 w-10 rounded-full bg-line-strong" />
          </div>
        ) : null}
        {title || !hideClose ? (
          <div
            className={cx('flex shrink-0 items-start justify-between gap-3 px-4 sm:px-5', asSheet ? 'pb-3 pt-1' : 'pb-3 pt-4')}
            onPointerDown={asSheet ? onDragStart : undefined}
            onPointerMove={asSheet ? onDragMove : undefined}
            onPointerUp={asSheet ? onDragEnd : undefined}
            onPointerCancel={asSheet ? onDragEnd : undefined}
          >
            <div className="min-w-0 pt-1.5">
              {title ? <h2 id={titleId} className="type-heading truncate text-lg text-text-1">{title}</h2> : null}
              {description ? <p id={descId} className="mt-0.5 text-sm text-text-2">{description}</p> : null}
            </div>
            {!hideClose ? (
              <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1" data-autofocus-skip>
                <XIcon size={20} />
              </IconButton>
            ) : null}
          </div>
        ) : null}
        <div className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-5', !title && hideClose && 'pt-4', bodyClassName)}>
          {children}
        </div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/** Always a bottom sheet, at every width (Log action sheet, pickers). */
export function Sheet(props: Omit<ModalProps, 'presentation'>) {
  return <Modal presentation="sheet" {...props} />;
}

/** Always a centred dialog. */
export function Dialog(props: Omit<ModalProps, 'presentation'>) {
  return <Modal presentation="dialog" {...props} />;
}

/* ================================================================== confirm */

export function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
  onClose,
}: {
  open: boolean;
  title?: string;
  message?: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => unknown;
  onCancel?: () => void;
  onClose?: () => void;
}) {
  const cancel = onCancel || onClose || (() => {});
  return (
    <Modal
      open={open}
      onClose={cancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={cancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-text-2">{message || description || 'This action cannot be undone.'}</p>
    </Modal>
  );
}

/* ================================================================== menu */

export type MenuItem = {
  key?: string;
  label: ReactNode;
  description?: string;
  icon?: ReactNode;
  onSelect?: () => void;
  to?: string;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a separator above this item. */
  divider?: boolean;
};

/** `⋯` overflow menu with full keyboard support. */
export function Menu({
  items,
  trigger,
  label = 'More options',
  align = 'end',
  className,
  triggerClassName,
  size = 44,
}: {
  items: MenuItem[];
  /** Custom trigger; defaults to a `⋯` icon button. Receives open state. */
  trigger?: (p: { open: boolean }) => ReactNode;
  label?: string;
  align?: 'start' | 'end';
  className?: string;
  triggerClassName?: string;
  size?: 40 | 44 | 48;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const menuId = useId();
  const pos = usePopoverPosition(open, wrapRef, popRef, { align });
  const { mounted, exiting } = usePresence(open, DURATION[2]);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose(open, [wrapRef, popRef], close);

  const enabled = items.map((it, i) => (!it.disabled ? i : -1)).filter((i) => i >= 0);

  const activate = (it: MenuItem) => {
    if (it.disabled) return;
    setOpen(false);
    if (it.to) navigate(it.to, { viewTransition: true });
    else if (it.href) window.open(it.href, '_blank', 'noopener');
    it.onSelect?.();
  };

  const focusItem = (i: number) => {
    setActiveIndex(i);
    popRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (enabled.length) focusItem(enabled[0]);
    }, 20);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!open) return;
    const at = enabled.indexOf(activeIndex);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(enabled[(at + 1) % enabled.length]);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(enabled[(at - 1 + enabled.length) % enabled.length]);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(enabled[0]);
        break;
      case 'End':
        e.preventDefault();
        focusItem(enabled[enabled.length - 1]);
        break;
      case 'Escape':
      case 'Tab':
        e.preventDefault();
        // Escape belongs to the menu while it is open: the Modal listens for
        // it on window, and without this a member menu inside a community
        // sheet took the whole sheet down with it.
        e.stopPropagation();
        setOpen(false);
        wrapRef.current?.querySelector<HTMLElement>('button')?.focus();
        break;
    }
  };

  return (
    <span ref={wrapRef} className={cx('inline-flex', className)}>
      {trigger ? (
        <span
          role="button"
          tabIndex={0}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={cx('inline-flex cursor-pointer', triggerClassName)}
        >
          {trigger({ open })}
        </span>
      ) : (
        <IconButton
          label={label}
          size={size}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={triggerClassName}
        >
          <MoreHorizontal size={20} />
        </IconButton>
      )}
      {mounted && pos
        ? createPortal(
            <div
              ref={popRef}
              id={menuId}
              role="menu"
              aria-label={label}
              onKeyDown={onKeyDown}
              style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, maxHeight: pos.maxHeight, zIndex: 130 }}
              className={cx('card min-w-52 max-w-[min(20rem,calc(100vw-1rem))] overflow-y-auto p-1.5 shadow-2', exiting ? 'anim-fade-out' : 'anim-pop-in')}
            >
              {items.map((it, i) => (
                <div key={it.key ?? i}>
                  {it.divider && i > 0 ? <div role="separator" className="my-1.5 border-t border-line" /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    data-index={i}
                    tabIndex={-1}
                    disabled={it.disabled}
                    onClick={() => activate(it)}
                    onPointerMove={() => !it.disabled && setActiveIndex(i)}
                    className={cx(
                      'flex w-full min-h-11 items-center gap-3 rounded-xs px-3 py-2 text-left text-sm font-medium outline-none transition-colors dur-1',
                      'focus-visible:bg-surface-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-text-3',
                      it.danger ? 'text-danger' : 'text-text-1',
                    )}
                  >
                    {it.icon ? <span className={cx('shrink-0', it.danger ? 'text-danger' : 'text-text-2')}>{it.icon}</span> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{it.label}</span>
                      {it.description ? <span className="block truncate text-xs font-normal text-text-2">{it.description}</span> : null}
                    </span>
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

/* ================================================================== toast */

export type ToastKind = 'success' | 'error' | 'info';
export type ToastAction = { label: string; onClick: () => void };
export type Toast = { id: number; kind: ToastKind; message: string; action?: ToastAction; duration: number; key?: string };
/** `key`: a later toast with the same key replaces the live one instead of stacking (validation errors). */
export type ToastOptions = { kind?: ToastKind; action?: ToastAction; duration?: number; key?: string };

type ToastApi = {
  toast: (message: string, kindOrOptions?: ToastKind | ToastOptions) => number;
  success: (message: string, options?: Omit<ToastOptions, 'kind'>) => number;
  error: (e: unknown, fallback?: string, options?: Omit<ToastOptions, 'kind'>) => number;
  info: (message: string, options?: Omit<ToastOptions, 'kind'>) => number;
  dismiss: (id: number) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

const TOAST_ICON: Record<ToastKind, ReactNode> = {
  success: <CheckCircle size={20} className="text-success" />,
  error: <AlertIcon size={20} className="text-danger" />,
  info: <InfoIcon size={20} className="text-info" />,
};

/** The toast's exit (`.anim-toast-out`, --duration-out); the item stays mounted this long after dismiss. */
const TOAST_EXIT_MS = 140;

function ToastItem({ t, exiting, onDismiss }: { t: Toast; exiting: boolean; onDismiss: (id: number) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onDismiss(t.id), t.duration);
  }, [t.id, t.duration, onDismiss]);
  useEffect(() => {
    start();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [start]);
  const pause = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  return (
    <div
      role="status"
      onMouseEnter={pause}
      onMouseLeave={start}
      onFocus={pause}
      onBlur={start}
      className={cx(exiting ? 'anim-toast-out' : 'anim-toast-in', 'card pointer-events-auto flex w-full max-w-sm items-start gap-3 py-2.5 pl-3.5 pr-1.5 shadow-2')}
    >
      <span className="mt-2 shrink-0">{TOAST_ICON[t.kind]}</span>
      <p className="min-w-0 flex-1 py-2 text-sm font-medium text-text-1">{t.message}</p>
      {t.action ? (
        <Button
          variant="link"
          size="sm"
          className="mt-0.5 shrink-0"
          onClick={() => {
            t.action?.onClick();
            onDismiss(t.id);
          }}
        >
          {t.action.label}
        </Button>
      ) : null}
      <IconButton label="Dismiss" size={40} onClick={() => onDismiss(t.id)} className="shrink-0">
        <XIcon size={18} />
      </IconButton>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(() => new Set());
  const seq = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((x) => x.id !== id));
    setLeaving((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);
  // Dismiss plays the exit first: the item is marked leaving (its class flips
  // to .anim-toast-out) and leaves the list once the transition has run.
  const dismiss = useCallback((id: number) => {
    setLeaving((s) => (s.has(id) ? s : new Set(s).add(id)));
    setTimeout(() => remove(id), prefersReducedMotion() ? 0 : TOAST_EXIT_MS);
  }, [remove]);

  const toast = useCallback((message: string, kindOrOptions: ToastKind | ToastOptions = 'info') => {
    if (!message) return -1;
    const opts: ToastOptions = typeof kindOrOptions === 'string' ? { kind: kindOrOptions } : kindOrOptions;
    const id = ++seq.current;
    setToasts((list) =>
      upsertToast(list, {
        id,
        kind: opts.kind ?? 'info',
        message,
        action: opts.action,
        duration: opts.duration ?? (opts.action ? 6000 : 4000),
        key: opts.key,
      }),
    );
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      dismiss,
      success: (m, o) => toast(m, { ...o, kind: 'success' }),
      info: (m, o) => toast(m, { ...o, kind: 'info' }),
      error: (e, fallback = 'Something went wrong', options) => {
        const message = typeof e === 'string' ? e : errMsg(e, fallback);
        // Every 429 shares one key, so a page's own toast and the app-wide
        // one (components/ApiNotices.tsx) replace each other instead of
        // stacking the same sentence twice.
        const rateLimited = typeof e === 'string' ? isRateLimitedCopy(e) : parseApiError(e).status === 429;
        const key = options?.key ?? (rateLimited ? RATE_LIMITED_TOAST_KEY : undefined);
        return toast(message, { ...options, key, kind: 'error' });
      },
    }),
    [toast, dismiss],
  );

  const compact = useIsCompact();
  const modalOpen = useModalPresence((s) => s.count > 0);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className={toastViewportClass(compact, modalOpen)}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} exiting={leaving.has(t.id)} onDismiss={dismiss} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within a <ToastProvider>');
  return ctx;
}

/* ================================================================== empty / error */

export type EmptyStateVariant = 'first-run' | 'no-results' | 'offline' | 'error';
type EmptyStateActionSpec = { label: string; onClick?: () => void; to?: string; state?: unknown; icon?: ReactNode; variant?: ButtonVariant };
export type EmptyStateAction = ReactNode | EmptyStateActionSpec;

function isActionSpec(a: EmptyStateAction): a is EmptyStateActionSpec {
  return !!a && typeof a === 'object' && 'label' in (a as object) && typeof (a as { label?: unknown }).label === 'string';
}

function renderAction(a: EmptyStateAction, fallbackVariant: ButtonVariant) {
  if (!a) return null;
  if (isActionSpec(a)) {
    // The first action in an empty state is the screen's one blue: nothing
    // else on an empty screen competes for it. Pages that passed `secondary`
    // while the shell band held the blue are promoted; `quiet`/`link` stay.
    const requested = a.variant ?? fallbackVariant;
    const variant: ButtonVariant = fallbackVariant === 'primary' && requested === 'secondary' ? 'primary' : requested;
    if (a.to) {
      return (
        <ButtonLink to={a.to} state={a.state} variant={variant} icon={a.icon}>
          {a.label}
        </ButtonLink>
      );
    }
    return (
      <Button variant={variant} onClick={a.onClick} icon={a.icon}>
        {a.label}
      </Button>
    );
  }
  return a as ReactNode;
}

/**
 * One sentence of direction and one primary action. The `first-run` variant
 * shows the pair figure; `no-results`, `offline` and `error` use an icon.
 */
export function EmptyState({
  icon,
  variant = 'first-run',
  title,
  message,
  description,
  action,
  secondaryAction,
  size = 'md',
  className,
  level = 2,
  family,
}: {
  icon?: ReactNode;
  variant?: EmptyStateVariant;
  /** Hub illustration for a first-run state; without it the pair figure stays. */
  family?: IllustrationFamily;
  title: string;
  message?: string;
  description?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Heading level; an empty state usually stands in for the page body, one step under the h1. */
  level?: 2 | 3;
}) {
  const text = message || description;
  const Heading = `h${level}` as const;
  const glyph =
    icon ??
    (variant === 'no-results' ? <SearchIcon size={26} /> : variant === 'offline' ? <WifiOff size={26} /> : variant === 'error' ? <AlertIcon size={26} /> : null);
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' ? 'gap-2 px-4 py-6' : size === 'lg' ? 'gap-3.5 px-6 py-14' : 'gap-3 px-6 py-10',
        className,
      )}
    >
      {glyph ? (
        <div
          className={cx(
            'mb-1 flex h-14 w-14 items-center justify-center rounded-full',
            variant === 'error' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-text-2',
          )}
        >
          {glyph}
        </div>
      ) : family ? (
        (() => {
          const Art = ILLUSTRATIONS[family];
          return (
            <span className={cx('mb-1 inline-grid place-items-center rounded-full bg-surface-2', size === 'sm' ? 'size-20' : 'size-28')}>
              <Art size={size === 'sm' ? 48 : 68} className="text-text-2" />
            </span>
          );
        })()
      ) : (
        <span className={cx('mb-1 inline-grid place-items-center rounded-full bg-surface-2', size === 'sm' ? 'size-20' : 'size-28')}>
          <PairFigure size={size === 'sm' ? 48 : 68} className="text-text-2" />
        </span>
      )}
      <Heading className={cx('type-heading text-balance text-text-1', size === 'sm' ? 'text-md' : 'text-lg')}>{title}</Heading>
      {text ? <p className="max-w-sm text-balance text-sm leading-relaxed text-text-2">{text}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {renderAction(action, 'primary')}
          {renderAction(secondaryAction, 'ghost')}
        </div>
      ) : null}
    </div>
  );
}

function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const code = (error as { code?: string } | undefined)?.code;
  return code === 'ERR_NETWORK';
}

export function ErrorState({
  error,
  retry,
  onRetry,
  title,
  message,
  action,
  className,
}: {
  error?: unknown;
  retry?: () => void;
  onRetry?: () => unknown;
  title?: string;
  message?: string;
  action?: ReactNode;
  className?: string;
}) {
  const offline = isOfflineError(error);
  const retryAction = retry || onRetry;
  const detail = message || (offline ? 'Check your connection and try again.' : error ? errMsg(error, 'Try again in a moment.') : 'Try again in a moment.');
  return (
    <EmptyState
      variant={offline ? 'offline' : 'error'}
      title={title || (offline ? 'You’re offline' : 'Something went wrong')}
      message={detail}
      className={className}
      action={
        action ?? (retryAction ? (
          <Button variant="primary" onClick={() => void retryAction()}>
            Try again
          </Button>
        ) : undefined)
      }
    />
  );
}

/* ================================================================== tabs */

export type TabItem = {
  key?: string;
  value?: string;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
  /** Render as a router link (hub section tabs). */
  to?: string;
  badge?: ReactNode;
  disabled?: boolean;
};

/**
 * `underline` scrolls with snap points, an animated indicator and edge fades;
 * `segmented` is a sliding pill for ≤4 items. Roving tabindex, arrow keys.
 */
export function Tabs({
  tabs,
  active,
  value,
  onChange,
  className,
  fill = false,
  variant = 'underline',
  size = 'md',
  'aria-label': ariaLabel,
}: {
  tabs: TabItem[];
  active?: string;
  value?: string;
  onChange?: (key: string) => void;
  className?: string;
  fill?: boolean;
  variant?: 'underline' | 'segmented';
  size?: 'sm' | 'md';
  'aria-label'?: string;
}) {
  const selected = active ?? value ?? '';
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);
  // The indicator slides only between positions it has already painted: the
  // first measurement lands it in place with no transition.
  const [settled, setSettled] = useState(false);
  const [fade, setFade] = useState<'' | 'l' | 'r' | 'x'>('');
  const frame = useRef(0);
  const items = tabs.filter((t) => (t.key ?? t.value) !== undefined);
  const keyOf = (t: TabItem) => (t.key ?? t.value) as string;

  const measureNow = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el) {
      const next = { x: el.offsetLeft, w: el.offsetWidth };
      setIndicator((prev) => (prev && prev.x === next.x && prev.w === next.w ? prev : next));
    } else setIndicator(null);
    const overflow = list.scrollWidth - list.clientWidth;
    if (overflow <= 4) setFade('');
    else {
      const left = list.scrollLeft > 4;
      const right = list.scrollLeft < overflow - 4;
      setFade(left && right ? 'x' : left ? 'l' : right ? 'r' : '');
    }
  }, []);
  // Scroll and resize fire faster than frames: one forced layout per frame is
  // plenty, and the fade and indicator still settle before paint.
  const measure = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measureNow();
    });
  }, [measureNow]);

  useLayoutEffect(() => {
    measureNow();
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el) {
      const target = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
      list.scrollTo({ left: Math.max(0, target), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    // Observe the tabs too: the list's own box does not change when a label
    // or count grows, but the overflow (and so the edge fade) does.
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    for (const child of Array.from(list.children)) ro.observe(child);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      ro.disconnect();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [selected, items.length, measure, measureNow]);

  useEffect(() => {
    if (!indicator || settled) return;
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, [indicator, settled]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = items.filter((t) => !t.disabled).map(keyOf);
    const i = keys.indexOf(selected);
    let next: string | undefined;
    if (e.key === 'ArrowRight') next = keys[(i + 1) % keys.length];
    else if (e.key === 'ArrowLeft') next = keys[(i - 1 + keys.length) % keys.length];
    else if (e.key === 'Home') next = keys[0];
    else if (e.key === 'End') next = keys[keys.length - 1];
    if (!next) return;
    e.preventDefault();
    const target = items.find((t) => keyOf(t) === next);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next)}"]`);
    el?.focus();
    if (target?.to) el?.click();
    else onChange?.(next);
  };

  const segmented = variant === 'segmented';
  const tabCls = (isActive: boolean, disabled?: boolean) =>
    cx(
      'pressable snap-item relative z-[1] inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold outline-none transition-colors dur-1',
      size === 'sm' ? 'min-h-10 px-3 text-xs pointer-coarse:min-h-11' : 'min-h-11 px-3.5 text-sm',
      segmented ? 'rounded-[calc(var(--radius-sm)-2px)]' : 'rounded-xs',
      fill && 'flex-1',
      disabled ? 'cursor-not-allowed text-text-3' : isActive ? 'text-text-1' : 'text-text-2 hover:text-text-1',
      'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
    );

  // The indicator moves on `transform` only, never on `width`. The underline
  // is a 1 px bar scaled to the tab (scaleX of a solid bar is exact); the
  // segmented thumb keeps a real width — scaling would stretch its corners and
  // shadow — and slides on translateX, its width set without a transition.
  const indicatorStyle: CSSProperties | undefined = indicator
    ? segmented
      ? { width: indicator.w, transform: `translateX(${indicator.x}px)` }
      : { width: 1, transform: `translateX(${indicator.x}px) scaleX(${indicator.w})` }
    : undefined;

  return (
    <div className={cx('relative', segmented ? 'rounded-sm border border-line bg-surface-2 p-1' : 'border-b border-line', className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onScroll={measure}
        onKeyDown={onKeyDown}
        className={cx(
          'no-scrollbar snap-row relative flex gap-1 overflow-x-auto',
          fade === 'l' && 'mask-fade-l',
          fade === 'r' && 'mask-fade-r',
          fade === 'x' && 'mask-fade-x',
        )}
      >
        {indicator ? (
          <span
            aria-hidden="true"
            className={cx(
              'pointer-events-none absolute left-0 origin-left',
              settled && 'transition-transform dur-2 ease-out',
              segmented ? 'inset-y-0 rounded-[calc(var(--radius-sm)-2px)] bg-surface-1 shadow-1' : 'bottom-0 h-0.5 bg-brand',
            )}
            style={indicatorStyle}
          />
        ) : null}
        {items.map((t) => {
          const key = keyOf(t);
          const isActive = key === selected;
          const content = (
            <>
              {t.icon}
              {t.label}
              {typeof t.count === 'number' ? (
                <span className={cx('tabular rounded-full px-1.5 text-2xs leading-4.5', isActive ? 'bg-brand-soft text-brand-text' : 'bg-surface-3 text-text-2')}>
                  {formatStat(t.count, { compact: true })}
                </span>
              ) : null}
              {t.badge}
            </>
          );
          if (t.to) {
            return (
              <Link
                key={key}
                to={t.to}
                viewTransition
                role="tab"
                data-key={key}
                aria-selected={isActive}
                aria-disabled={t.disabled || undefined}
                tabIndex={isActive ? 0 : -1}
                onClick={(e) => {
                  if (t.disabled) e.preventDefault();
                  else onChange?.(key);
                }}
                className={tabCls(isActive, t.disabled)}
              >
                {content}
              </Link>
            );
          }
          return (
            <button
              key={key}
              role="tab"
              type="button"
              data-key={key}
              aria-selected={isActive}
              disabled={t.disabled}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange?.(key)}
              className={tabCls(isActive, t.disabled)}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** ≤4 options, sliding pill — same keyboard model as Tabs. */
export function SegmentedControl(props: Omit<Parameters<typeof Tabs>[0], 'variant'>) {
  return <Tabs variant="segmented" fill {...props} />;
}

/* ================================================================== switch */

export function Switch({
  checked,
  onChange,
  disabled,
  busy = false,
  label,
  id,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /**
   * A save is in flight: the switch stays in the tab order (so keyboard focus
   * is not thrown away), reads aria-busy, dims, and ignores clicks until it settles.
   */
  busy?: boolean;
  label: string;
  id?: string;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => {
        if (!busy) onChange(!checked);
      }}
      className={cx(
        'relative inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-sm',
        disabled ? 'cursor-not-allowed opacity-50' : busy ? 'cursor-progress opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-block h-6 w-11 rounded-full border transition-colors dur-1',
          checked ? 'border-transparent bg-brand' : 'border-line-strong bg-surface-3',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0.5 h-4.5 w-4.5 rounded-full shadow-1 transition-transform dur-1 ease-out',
            checked ? 'translate-x-5 bg-on-brand' : 'translate-x-0 bg-surface-1',
          )}
        />
      </span>
    </button>
  );
}

/* ================================================================== stats & charts */

export const VIZ = {
  kcal: 'var(--viz-kcal)',
  calories: 'var(--viz-kcal)',
  protein: 'var(--viz-protein)',
  carbs: 'var(--viz-carbs)',
  fat: 'var(--viz-fat)',
  alt: 'var(--viz-alt)',
  brand: 'var(--brand)',
  accent: 'var(--accent)',
} as const;
export type VizKey = keyof typeof VIZ;

/**
 * One chart theme for every Recharts instance, read from tokens so light and
 * dark need no per-chart code. Series order: brand → protein → carbs → fat → alt.
 */
export const chartTheme = {
  grid: 'var(--line)',
  axis: 'var(--text-3)',
  text: 'var(--text-2)',
  fontSize: 12,
  series: [VIZ.brand, VIZ.protein, VIZ.carbs, VIZ.fat, VIZ.alt] as string[],
  macro: { kcal: VIZ.kcal, calories: VIZ.kcal, protein: VIZ.protein, carbs: VIZ.carbs, fat: VIZ.fat } as Record<string, string>,
  areaFill: { start: 0.24, end: 0 },
  goalLine: { stroke: 'var(--text-3)', strokeDasharray: '4 4', strokeWidth: 1 },
  /** The one mark a chart draws when it has no data: a dashed baseline, never a full axis frame. */
  emptyBaseline: { stroke: 'var(--text-3)', strokeDasharray: '3 4', strokeWidth: 1 } as const,
  cartesianGrid: { stroke: 'var(--line)', vertical: false } as const,
  axisProps: {
    tick: { fill: 'var(--text-3)', fontSize: 12 },
    axisLine: false,
    tickLine: false,
    stroke: 'var(--line)',
  } as const,
  tooltip: {
    contentStyle: {
      background: 'var(--surface-2)',
      border: '1px solid var(--line)',
      borderRadius: 10,
      boxShadow: 'var(--shadow-2)',
      color: 'var(--text-1)',
      fontSize: 13,
      padding: '8px 12px',
    } as CSSProperties,
    labelStyle: { color: 'var(--text-2)', marginBottom: 4 } as CSSProperties,
    itemStyle: { color: 'var(--text-1)', padding: 0 } as CSSProperties,
    cursor: { stroke: 'var(--line-strong)', fill: 'var(--surface-2)', opacity: 0.6 },
  },
  /** 480 ms draw-in, or 0 when the user prefers reduced motion. */
  get animationDuration(): number {
    return prefersReducedMotion() ? 0 : DURATION[4];
  },
};

export const seriesColor = (i: number) => chartTheme.series[i % chartTheme.series.length];

/** A dashed baseline across a chart's box, with an optional line of direction under it; the empty state for any chart. */
export function ChartEmpty({ height = 160, label, className }: { height?: number; label?: string; className?: string }) {
  // A ghost of the chart to come: faint gridlines and a flat baseline, so the
  // card keeps its shape and the eye reads "no data yet" rather than "broken".
  return (
    <div className={cx('flex flex-col items-center justify-end', className)} style={{ height }} role={label ? 'img' : undefined} aria-label={label}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" className="min-h-0 flex-1">
        {[8, 18, 28].map((y) => (
          <path key={y} d={`M0 ${y} L100 ${y}`} fill="none" stroke="var(--line)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        ))}
        <path d="M0 38 L100 38" fill="none" {...chartTheme.emptyBaseline} vectorEffect="non-scaling-stroke" />
      </svg>
      {label ? <p className="mt-3 text-center text-xs text-text-2">{label}</p> : null}
    </div>
  );
}

/** 40 px tokenised sparkline with a one-time draw-in. */
export function Sparkline({
  data,
  width = 96,
  height = 40,
  className,
  stroke = 2,
  fill = true,
  color = 'currentColor',
}: {
  data: number[];
  width?: number | string;
  height?: number;
  className?: string;
  stroke?: number;
  fill?: boolean;
  color?: string;
}) {
  const id = useId();
  const w = 100;
  const h = 40;
  // No data, or a flat series with no trend to show: a quiet dashed baseline in
  // place of the line, never an empty box and never full axes.
  const baseline = (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width={width} height={height} className={className} aria-hidden="true">
      <path d={`M0 ${h - 3} L${w} ${h - 3}`} fill="none" stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
  const min = data?.length ? Math.min(...data) : 0;
  const max = data?.length ? Math.max(...data) : 0;
  if (!data || data.length < 2 || max === min) return baseline;
  const span = max - min;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width={width} height={height} className={className} aria-hidden="true" style={{ color }}>
      {fill ? (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity={0.24} />
              <stop offset="1" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      ) : null}
      <path d={line} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pathLength={1} className="anim-draw" />
    </svg>
  );
}

export type StatDelta = {
  value: number | string;
  /** Defaults from the sign of a numeric value. */
  direction?: 'up' | 'down' | 'flat';
  label?: string;
  /** When false (e.g. body weight for a cut), down is the good direction. */
  upIsGood?: boolean;
};

/** Label 12 · value in condensed tabular numerals · unit · delta · sparkline. */
export function StatTile({
  label,
  value,
  unit,
  delta,
  spark,
  icon,
  to,
  onClick,
  tone = 'neutral',
  size = 'md',
  loading = false,
  className,
  hint,
  fallback,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: StatDelta;
  spark?: number[];
  icon?: ReactNode;
  to?: string;
  onClick?: () => void;
  tone?: 'neutral' | 'brand' | 'accent';
  /** `hero` sets the value in `.t-metric` (32–44 px, the one big number on a hub). */
  size?: 'md' | 'lg' | 'hero';
  loading?: boolean;
  className?: string;
  hint?: string;
  /** In the value's place when `value` is 0, null or undefined: the next action, never a zero. The tile keeps its box. */
  fallback?: ReactNode;
}) {
  if (loading) return <SkeletonTile className={className} />;
  const empty = fallback !== undefined && isEmptyMetric(value);
  const dir = delta?.direction ?? (typeof delta?.value === 'number' ? (delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : 'flat') : 'flat');
  const good = delta ? (dir === 'flat' ? null : (dir === 'up') === (delta.upIsGood ?? true)) : null;
  // Semantic colour only where it means something: green for the good direction, red for the bad one.
  const deltaTone: BadgeTone = good === null ? 'neutral' : good ? 'success' : 'danger';
  const deltaText = typeof delta?.value === 'number' ? `${delta.value > 0 ? '+' : ''}${formatStat(delta.value)}` : delta?.value;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="type-label text-text-2">{label}</span>
        {icon ? <span className={cx('shrink-0', tone === 'brand' ? 'text-brand' : tone === 'accent' ? 'text-accent' : 'text-text-3')}>{icon}</span> : null}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {empty ? (
            <div className="t-body min-h-8 text-text-2">{fallback}</div>
          ) : (
            <span className={cx('type-stat block truncate text-text-1', size === 'hero' ? 't-metric' : size === 'lg' ? 'text-3xl' : 'text-2xl', tone === 'brand' && 'text-brand-text', tone === 'accent' && 'text-accent-text')}>
              {value}
              {unit ? <span className="ml-1 align-baseline text-xs font-semibold tracking-normal text-text-2 [font-variation-settings:'wdth'_100]">{unit}</span> : null}
            </span>
          )}
          {!empty && delta ? (
            <span className="mt-1.5 inline-flex items-center gap-1.5">
              <Badge tone={deltaTone} size="sm">
                {dir === 'up' ? <TrendingUp size={12} /> : dir === 'down' ? <TrendingDown size={12} /> : null}
                {deltaText}
              </Badge>
              {delta.label ? <span className="text-2xs text-text-3">{delta.label}</span> : null}
            </span>
          ) : hint ? (
            <span className="mt-1.5 block text-2xs text-text-3">{hint}</span>
          ) : null}
        </div>
        {!empty && spark && spark.length > 1 ? <Sparkline data={spark} width={72} height={36} className={cx('shrink-0', tone === 'accent' ? 'text-accent' : 'text-brand')} /> : null}
      </div>
    </>
  );
  if (to) {
    return (
      <Link to={to} viewTransition className={cx('card card-interactive block p-4 text-left', className)} aria-label={`${label}: ${typeof value === 'string' || typeof value === 'number' ? value : ''} ${unit ?? ''}`.trim()}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cx('card card-interactive block w-full p-4 text-left', className)}>
        {body}
      </button>
    );
  }
  return <div className={cx('card p-4', className)}>{body}</div>;
}

/** 2-up on phones, full row from tablets (md). A 3-up grid lets its third tile span the phone row instead of leaving a hole. */
export function StatGrid({ children, className, columns = 4 }: { children: ReactNode; className?: string; columns?: 2 | 3 | 4 }) {
  return (
    <div
      className={cx(
        'grid grid-cols-2 gap-3',
        columns === 3 && 'md:grid-cols-3 max-md:[&>*:nth-child(3n)]:col-span-2',
        columns === 4 && 'md:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export type StatStripItem = {
  label: string;
  value?: number | string | null;
  to?: string;
  onClick?: () => void;
  tone?: 'neutral' | 'brand';
  /** In the number's place when `value` is 0, null or undefined — the next action ("Share one"), never a zero. */
  fallback?: ReactNode;
};

/**
 * Profile counters in one row (posts · followers · following · workouts):
 * tabular numerals over a 12 px label, each cell a 44 px target when it links
 * somewhere. Replaces four full StatTiles, which cost 400 px of phone before
 * any content.
 */
export function StatStrip({ items, className, 'aria-label': ariaLabel = 'Stats' }: { items: StatStripItem[]; className?: string; 'aria-label'?: string }) {
  return (
    <ul aria-label={ariaLabel} className={cx('card grid divide-x divide-line', className)} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => {
        const empty = item.fallback !== undefined && isEmptyMetric(item.value);
        const body = (
          <>
            {empty ? (
              <span className="t-meta block truncate text-text-1">{item.fallback}</span>
            ) : (
              <span className={cx('type-stat block truncate text-stat-sm', item.tone === 'brand' ? 'text-brand-text' : 'text-text-1')}>
                {typeof item.value === 'number' ? formatStat(item.value) : item.value}
              </span>
            )}
            <span className="type-label block truncate text-text-2">{item.label}</span>
          </>
        );
        const cls = 'flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-1 py-2 text-center';
        const interactive = 'rounded-[inherit] transition-colors dur-1 hover:bg-surface-2 focus-visible:bg-surface-2 outline-none';
        return (
          <li key={item.label} className="min-w-0">
            {item.to ? (
              <Link to={item.to} viewTransition className={cx(cls, interactive)}>
                {body}
              </Link>
            ) : item.onClick ? (
              <button type="button" onClick={item.onClick} className={cx(cls, interactive)}>
                {body}
              </button>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Progress ring (macros, goals). Stroke 10, animates once on mount. Without a
 * metric (0, null) there is no goal to measure against: the dashed "nothing
 * yet" ring, `fallback` in the centre, no percentage in the accessible name.
 */
export function Ring({
  value,
  max: maxProp = 100,
  size = 96,
  stroke = 10,
  color = 'brand',
  children,
  fallback,
  label,
  className,
}: {
  value?: number | null;
  max?: number;
  size?: number;
  stroke?: number;
  color?: VizKey | string;
  children?: ReactNode;
  /** Rendered in the centre in place of `children` when `value` is not a metric: the next action, never "0". */
  fallback?: ReactNode;
  label?: string;
  className?: string;
}) {
  const empty = !hasMetric(value);
  const max = empty ? 0 : maxProp;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.max(0, Math.min(1, (hasMetric(value) ? value : 0) / max)) : 0;
  const [drawn, setDrawn] = useState(prefersReducedMotion());
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const strokeColor = (VIZ as Record<string, string>)[color] ?? color;
  return (
    <div
      className={cx('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      // No percentage when there is no target: "Calories 134 kcal: 0%" told
      // screen-reader users they had eaten none of a goal that did not exist.
      aria-label={label ? (max > 0 ? `${label}: ${Math.round(pct * 100)}%` : label) : undefined}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        {max > 0 ? (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        ) : (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 4" />
        )}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={drawn ? c * (1 - pct) : c}
          style={{ transition: 'stroke-dashoffset var(--duration-4) var(--ease-out)' }}
        />
      </svg>
      {empty && fallback !== undefined ? (
        <div className="t-meta absolute inset-0 flex flex-col items-center justify-center px-3 text-center text-text-1">{fallback}</div>
      ) : children ? (
        <div className="type-stat absolute inset-0 flex flex-col items-center justify-center text-center text-text-1">{children}</div>
      ) : null}
    </div>
  );
}

/** Linear progress. */
export function Progress({
  value,
  max = 100,
  tone = 'brand',
  size = 'md',
  label,
  className,
}: {
  /** null/undefined = nothing logged yet: a dashed baseline replaces the track. */
  value?: number | null;
  max?: number;
  tone?: 'brand' | 'accent' | 'success' | 'warning' | 'danger' | VizKey;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}) {
  const bg = (VIZ as Record<string, string>)[tone] ?? `var(--${tone})`;
  if (value === null || value === undefined || !(max > 0)) {
    return (
      <div role="img" aria-label={label ? `${label}: nothing yet` : undefined} className={cx('w-full', size === 'sm' ? 'h-1.5' : 'h-2.5', className)}>
        <svg viewBox="0 0 100 4" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
          <path d="M0 2 L100 2" fill="none" {...chartTheme.emptyBaseline} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      className={cx('w-full overflow-hidden rounded-full bg-surface-3', size === 'sm' ? 'h-1.5' : 'h-2.5', className)}
    >
      <div className="h-full rounded-full [transition:width_var(--duration-4)_var(--ease-out)]" style={{ width: `${pct}%`, background: bg }} />
    </div>
  );
}

/* ================================================================== callout */

const CALLOUT_TONE = {
  info: 'border-info/30 bg-info-soft text-text-1',
  success: 'border-success/30 bg-success-soft text-text-1',
  warning: 'border-warning/30 bg-warning-soft text-text-1',
  danger: 'border-danger/30 bg-danger-soft text-text-1',
  brand: 'border-brand/30 bg-brand-soft text-text-1',
} as const;
const CALLOUT_ICON = {
  info: <InfoIcon size={20} className="text-info" />,
  success: <CheckCircle size={20} className="text-success" />,
  warning: <AlertIcon size={20} className="text-warning" />,
  danger: <AlertIcon size={20} className="text-danger" />,
  brand: <InfoIcon size={20} className="text-brand" />,
} as const;

export function Callout({
  tone = 'info',
  title,
  children,
  action,
  icon,
  className,
}: {
  tone?: keyof typeof CALLOUT_TONE;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'note'} className={cx('flex items-start gap-3 rounded-md border p-3.5', CALLOUT_TONE[tone], className)}>
      <span className="mt-0.5 shrink-0">{icon ?? CALLOUT_ICON[tone]}</span>
      <div className="min-w-0 flex-1 text-sm">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cx('text-text-2', !!title && 'mt-0.5')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ================================================================== scroll edges */

export type ScrollEdges = {
  /** Content extends past the start edge (left / top). */
  start: boolean;
  /** Content extends past the end edge (right / bottom). */
  end: boolean;
  /** The element scrolls at all. */
  overflow: boolean;
};

/**
 * Tracks whether a scroll container has more content beyond each edge, so
 * callers can paint an edge fade or a shadow. Re-measures on scroll, on
 * resize of the container and its children, and once fonts have loaded —
 * measuring only on scroll (the previous Tabs behaviour) left first paint
 * without the fade.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>, axis: 'x' | 'y' = 'x'): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false, overflow: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const size = axis === 'x' ? el.clientWidth : el.clientHeight;
      const scroll = axis === 'x' ? el.scrollWidth : el.scrollHeight;
      const pos = axis === 'x' ? el.scrollLeft : el.scrollTop;
      const overflow = scroll - size;
      const next: ScrollEdges = overflow <= 4 ? { start: false, end: false, overflow: false } : { start: pos > 4, end: pos < overflow - 4, overflow: true };
      setEdges((prev) => (prev.start === next.start && prev.end === next.end && prev.overflow === next.overflow ? prev : next));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [ref, axis]);
  return edges;
}

/** Class for the mask utilities given the edges that have more content. */
export function fadeClass(edges: ScrollEdges, axis: 'x' | 'y' = 'x'): string {
  const [a, b, both] = axis === 'x' ? (['mask-fade-l', 'mask-fade-r', 'mask-fade-x'] as const) : (['mask-fade-t', 'mask-fade-b', 'mask-fade-y'] as const);
  if (edges.start && edges.end) return both;
  if (edges.start) return a;
  if (edges.end) return b;
  return '';
}

/**
 * Horizontal scroll container with a painted scrollbar and `data-overflow` /
 * `data-fade="l r"` attributes for CSS (admin tables pin their actions column
 * and shadow it while columns hide beneath). Add `fade` for the mask-image
 * treatment on rows without sticky cells.
 */
export function ScrollX({ className, fade = false, children, ...rest }: HTMLAttributes<HTMLDivElement> & { fade?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(ref, 'x');
  return (
    <div
      ref={ref}
      data-overflow={edges.overflow ? 'true' : 'false'}
      data-fade={[edges.start && 'l', edges.end && 'r'].filter(Boolean).join(' ') || undefined}
      className={cx('overflow-x-auto', fade && fadeClass(edges, 'x'), className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ================================================================== page skeleton */

/**
 * Stand-in for a route whose code is still downloading: the page region
 * shows structure immediately instead of holding the previous page.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading page">
      <div className="hidden space-y-2 lg:block">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonTile key={i} />
        ))}
      </div>
      <SkeletonCard media={false} />
      <SkeletonCard media={false} />
    </div>
  );
}

/* ================================================================== offline banner */

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
