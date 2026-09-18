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
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
  TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { errMsg, mediaUrl } from '../lib/api';
import { toastViewportClass, upsertToast } from '../lib/toastPlacement';
import { Brand, BrandMark, PairFigure } from './Brand';
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

/* ================================================================== helpers */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
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

/* ================================================================== motion */

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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

/** Settings → Appearance. A radiogroup styled as a segmented control. */
export function ThemeControl({ className, label = 'Appearance' }: { className?: string; label?: string }) {
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
            onClick={() => setPreference(value)}
            className={cx(
              'inline-flex min-h-10 items-center justify-center gap-2 rounded-[calc(var(--radius-sm)-2px)] px-3 text-sm font-semibold transition-colors dur-1',
              checked ? 'bg-surface-1 text-text-1 shadow-1' : 'text-text-2 hover:text-text-1',
            )}
          >
            <Icon size={18} />
            {l}
          </button>
        );
      })}
    </div>
  );
}

/* ================================================================== page chrome */

/**
 * Pages describe their mobile top bar (title, back, actions) and optional
 * desktop right rail here; the shell renders it. Kept in an external store so
 * a page re-render never loops through the shell.
 */
export type PageChrome = {
  path: string;
  title?: string;
  subtitle?: string;
  /** `true` = history back with a sensible fallback; a string = explicit target. */
  back?: boolean | string;
  actions?: ReactNode;
  rail?: ReactNode | null;
  hideTopBar?: boolean;
  hideSectionTabs?: boolean;
  hideBottomNav?: boolean;
  /** Use the full content width (no feed max-width). */
  wide?: boolean;
};

type PageChromeState = { chrome: PageChrome | null; set: (c: PageChrome | null) => void };
export const usePageChromeStore = create<PageChromeState>((set) => ({
  chrome: null,
  set: (chrome) => set({ chrome }),
}));

export function usePageChrome(chrome: Omit<PageChrome, 'path'>) {
  const { pathname } = useLocation();
  const set = usePageChromeStore((s) => s.set);
  useEffect(() => {
    set({ ...chrome, path: pathname });
    if (chrome.title) document.title = `${chrome.title} · Vybe`;
  });
  useEffect(() => () => { if (usePageChromeStore.getState().chrome?.path === pathname) set(null); }, [pathname, set]);
}

/**
 * The one page-title treatment. On phones the title lives in the shell's top
 * bar; on desktop it renders inline here. Pages never render their own h1.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  mobileActions,
  rail,
  wide,
  hideSectionTabs,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: boolean | string;
  actions?: ReactNode;
  /** Compact actions for the mobile top bar when the desktop set is too wide. */
  mobileActions?: ReactNode;
  rail?: ReactNode | null;
  wide?: boolean;
  hideSectionTabs?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  usePageChrome({ title, subtitle, back, actions: mobileActions ?? actions, rail, wide, hideSectionTabs });
  return (
    <header className={cx('mb-6 hidden items-end justify-between gap-4 lg:flex', className)}>
      <div className="min-w-0">
        <h1 className="type-heading truncate text-2xl text-text-1">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-text-2">{subtitle}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </header>
  );
}

/** Card-group heading: 20/28 heading + optional trailing action. */
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
          <h2 className="type-heading text-lg text-text-1">{title}</h2>
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

/** Matches PostCard: header, media, two lines, action bar. */
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
}: {
  src?: string | null;
  name?: string;
  alt?: string;
  size?: AvatarSize;
  className?: string;
  /** Story ring: 2 px brand with an offset in the page background. */
  ring?: boolean;
  ringTone?: 'brand' | 'accent' | 'neutral';
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
        loading="lazy"
        style={style}
        onError={() => setBroken(true)}
        className={cx(base, 'bg-surface-3 object-cover')}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={alt || name || 'avatar'}
      title={name}
      style={style}
      className={cx(base, 'bg-surface-3 font-semibold text-text-2')}
    >
      {initialsOf(name)}
    </span>
  );
}

type AvatarLike = { src?: string | null; name?: string };

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
};

const ICON_BUTTON_VARIANT = {
  ghost: 'text-text-2 hover:bg-surface-2 hover:text-text-1',
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
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const cls = cx(
    'relative inline-flex shrink-0 items-center justify-center rounded-sm transition-colors dur-1',
    size === 40 ? 'h-10 w-10' : size === 48 ? 'h-12 w-12' : 'h-11 w-11',
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
      <Link to={to} viewTransition aria-label={label} title={label} className={cls}>
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

/** Unread pill used on nav items and icon buttons. */
export function CountBadge({ value, className, max = 99 }: { value: number | string; className?: string; max?: number }) {
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'number' && value <= 0) return null;
  const text = Number.isFinite(n) && n > max ? `${max}+` : String(value);
  return (
    <span
      className={cx(
        'tabular inline-flex min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-2xs font-bold leading-4.5 text-on-brand ring-2 ring-bg',
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
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & FieldProps & { leading?: ReactNode; trailing?: ReactNode }) {
  const auto = useId();
  const inputId = id || auto;
  return (
    <FieldShell id={inputId} label={label} hint={hint} error={error} hideLabel={hideLabel} containerClassName={containerClassName}>
      <div className="relative">
        {leading ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-text-3">{leading}</span>
        ) : null}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
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
  return (
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
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
  /** Hover/pressed states; combine with `to` for a whole-card link. */
  interactive?: boolean;
  to?: string;
  linkLabel?: string;
}) {
  return (
    <div
      className={cx('card', padded && 'p-4 sm:p-5', (interactive || to) && 'card-interactive', to && 'relative', className)}
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

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="truncate text-md font-semibold text-text-1">{title}</h3>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-text-2">{subtitle}</p> : null}
      </div>
      {action ? <div className="relative z-[2] shrink-0">{action}</div> : null}
    </div>
  );
}

/** Media slot inside a card: 14 px radius (card 20 → media 14 → chip 6). */
export function CardMedia({ className, children, ratio }: { className?: string; children: ReactNode; ratio?: '1/1' | '4/5' | '16/9' | '3/2' }) {
  return (
    <div
      className={cx('overflow-hidden rounded-md bg-surface-2', className)}
      style={ratio ? { aspectRatio: ratio.replace('/', ' / ') } : undefined}
    >
      {children}
    </div>
  );
}

/* ================================================================== badge / chip */

export type BadgeTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const BADGE_TONES: Record<BadgeTone, string> = {
  brand: 'bg-brand-soft text-brand-text',
  neutral: 'bg-surface-2 text-text-2 border border-line',
  success: 'bg-success-soft text-brand-text dark:text-success',
  warning: 'bg-warning-soft text-warning-text',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info-text',
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

/** Selectable / removable chip (filters, hashtags). Visual 36 px, hit area 44 px. */
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
    'relative inline-flex h-9 items-center gap-1.5 rounded-xs px-3 text-xs font-semibold transition-colors dur-1',
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
let lockedOverflow = '';
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

function useLockBody(active: boolean) {
  const enter = useModalPresence((s) => s.enter);
  const leave = useModalPresence((s) => s.leave);
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      lockedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount++;
    enter();
    return () => {
      lockCount--;
      leave();
      if (lockCount === 0) document.body.style.overflow = lockedOverflow;
    };
  }, [active, enter, leave]);
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>, initialFocus?: RefObject<HTMLElement | null>) {
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
 * and out (durations collapse under reduced motion).
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
  const { mounted, exiting } = usePresence(open, DURATION[3]);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useLockBody(mounted);
  useFocusTrap(open, panelRef, initialFocusRef);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Swipe-to-dismiss on the sheet handle / header.
  const drag = useRef<{ startY: number; startT: number; dy: number } | null>(null);
  const onDragStart = (e: ReactPointerEvent) => {
    if (!asSheet) return;
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
          '[transition:transform_var(--duration-3)_var(--ease-out)]',
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

function ToastItem({ t, onDismiss }: { t: Toast; onDismiss: (id: number) => void }) {
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
      className="anim-toast-in card pointer-events-auto flex w-full max-w-sm items-start gap-3 py-2.5 pl-3.5 pr-1.5 shadow-2"
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
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

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
      error: (e, fallback = 'Something went wrong', options) =>
        toast(typeof e === 'string' ? e : errMsg(e, fallback), { ...options, kind: 'error' }),
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
          <ToastItem key={t.id} t={t} onDismiss={dismiss} />
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
    if (a.to) {
      return (
        <ButtonLink to={a.to} state={a.state} variant={a.variant ?? fallbackVariant} icon={a.icon}>
          {a.label}
        </ButtonLink>
      );
    }
    return (
      <Button variant={a.variant ?? fallbackVariant} onClick={a.onClick} icon={a.icon}>
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
}: {
  icon?: ReactNode;
  variant?: EmptyStateVariant;
  title: string;
  message?: string;
  description?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const text = message || description;
  const glyph =
    icon ??
    (variant === 'no-results' ? <SearchIcon size={26} /> : variant === 'offline' ? <WifiOff size={26} /> : variant === 'error' ? <AlertIcon size={26} /> : null);
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' ? 'gap-2 px-4 py-8' : size === 'lg' ? 'gap-4 px-6 py-20' : 'gap-3 px-6 py-14',
        className,
      )}
    >
      {glyph ? (
        <div
          className={cx(
            'flex h-14 w-14 items-center justify-center rounded-full',
            variant === 'error' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-text-2',
          )}
        >
          {glyph}
        </div>
      ) : (
        <PairFigure size={size === 'sm' ? 64 : 96} className="text-text-3" />
      )}
      <h3 className={cx('type-heading text-text-1', size === 'sm' ? 'text-md' : 'text-lg')}>{title}</h3>
      {text ? <p className="max-w-sm text-sm leading-relaxed text-text-2">{text}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
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
  const [fade, setFade] = useState<'' | 'l' | 'r' | 'x'>('');
  const items = tabs.filter((t) => (t.key ?? t.value) !== undefined);
  const keyOf = (t: TabItem) => (t.key ?? t.value) as string;

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el) setIndicator({ x: el.offsetLeft, w: el.offsetWidth });
    else setIndicator(null);
    const overflow = list.scrollWidth - list.clientWidth;
    if (overflow <= 4) setFade('');
    else {
      const left = list.scrollLeft > 4;
      const right = list.scrollLeft < overflow - 4;
      setFade(left && right ? 'x' : left ? 'l' : right ? 'r' : '');
    }
  }, []);

  useLayoutEffect(() => {
    measure();
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el) {
      const target = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
      list.scrollTo({ left: Math.max(0, target), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [selected, items.length, measure]);

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
      'snap-item relative z-[1] inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold outline-none transition-colors dur-1',
      size === 'sm' ? 'min-h-10 px-3 text-xs' : 'min-h-11 px-3.5 text-sm',
      segmented ? 'rounded-[calc(var(--radius-sm)-2px)]' : 'rounded-xs',
      fill && 'flex-1',
      disabled ? 'cursor-not-allowed text-text-3' : isActive ? 'text-text-1' : 'text-text-2 hover:text-text-1',
      !segmented && !isActive && !disabled && 'hover:bg-surface-2',
      'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
    );

  return (
    <div className={cx('relative', segmented ? 'rounded-sm border border-line bg-surface-2 p-1' : 'border-b border-line', className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onScroll={measure}
        onKeyDown={onKeyDown}
        className={cx(
          'no-scrollbar snap-row relative flex overflow-x-auto',
          segmented ? 'gap-1' : 'gap-1',
          fade === 'l' && 'mask-fade-l',
          fade === 'r' && 'mask-fade-r',
          fade === 'x' && 'mask-fade-x',
        )}
      >
        {indicator ? (
          <span
            aria-hidden="true"
            className={cx(
              'pointer-events-none absolute transition-[transform,width] dur-2 ease-out',
              segmented ? 'inset-y-0 rounded-[calc(var(--radius-sm)-2px)] bg-surface-1 shadow-1' : 'bottom-0 h-0.5 rounded-full bg-brand',
            )}
            style={{ width: indicator.w, transform: `translateX(${indicator.x}px)`, left: 0 }}
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
  label,
  id,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
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
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-sm',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
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
  if (!data || data.length < 2) return <span className={className} style={{ display: 'inline-block', width, height }} aria-hidden="true" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const w = 100;
  const h = 40;
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
  size?: 'md' | 'lg';
  loading?: boolean;
  className?: string;
  hint?: string;
}) {
  if (loading) return <SkeletonTile className={className} />;
  const dir = delta?.direction ?? (typeof delta?.value === 'number' ? (delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : 'flat') : 'flat');
  const good = delta ? (dir === 'flat' ? null : (dir === 'up') === (delta.upIsGood ?? true)) : null;
  const deltaTone: BadgeTone = good === null ? 'neutral' : good ? 'brand' : 'accent';
  const deltaText = typeof delta?.value === 'number' ? `${delta.value > 0 ? '+' : ''}${formatStat(delta.value)}` : delta?.value;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="type-label text-text-2">{label}</span>
        {icon ? <span className={cx('shrink-0', tone === 'brand' ? 'text-brand' : tone === 'accent' ? 'text-accent' : 'text-text-3')}>{icon}</span> : null}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <span className={cx('type-stat block truncate text-text-1', size === 'lg' ? 'text-3xl' : 'text-2xl', tone === 'brand' && 'text-brand-text', tone === 'accent' && 'text-accent-text')}>
            {value}
            {unit ? <span className="ml-1 align-baseline text-xs font-semibold tracking-normal text-text-2 [font-variation-settings:'wdth'_100]">{unit}</span> : null}
          </span>
          {delta ? (
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
        {spark && spark.length > 1 ? <Sparkline data={spark} width={72} height={36} className={cx('shrink-0', tone === 'accent' ? 'text-accent' : 'text-brand')} /> : null}
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

/** 2-up on phones, 4-up on desktop. */
export function StatGrid({ children, className, columns = 4 }: { children: ReactNode; className?: string; columns?: 2 | 3 | 4 }) {
  return <div className={cx('grid grid-cols-2 gap-3', columns === 3 && 'lg:grid-cols-3', columns === 4 && 'lg:grid-cols-4', className)}>{children}</div>;
}

/** Progress ring (macros, goals). Stroke 10, animates once on mount. */
export function Ring({
  value,
  max = 100,
  size = 96,
  stroke = 10,
  color = 'brand',
  children,
  label,
  className,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  color?: VizKey | string;
  children?: ReactNode;
  label?: string;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const [drawn, setDrawn] = useState(prefersReducedMotion());
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const strokeColor = (VIZ as Record<string, string>)[color] ?? color;
  return (
    <div className={cx('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label ? `${label}: ${Math.round(pct * 100)}%` : undefined}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
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
      {children ? <div className="type-stat absolute inset-0 flex flex-col items-center justify-center text-center text-text-1">{children}</div> : null}
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
  value: number;
  max?: number;
  tone?: 'brand' | 'accent' | 'success' | 'warning' | 'danger' | VizKey;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const bg = (VIZ as Record<string, string>)[tone] ?? `var(--${tone})`;
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
