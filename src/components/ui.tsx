import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { errMsg, mediaUrl } from '../lib/api';
import { X as XIcon } from './icons';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ Spinner */

export function Spinner({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
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
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] w-full flex-col items-center justify-center gap-3">
      <Spinner size={28} className="text-[var(--color-brand)]" />
      {label ? <p className="text-sm text-[var(--color-muted)]">{label}</p> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Skeleton */

export function Skeleton({
  className,
  style,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('skeleton', className)} style={style} {...rest} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- Avatar */

const AVATAR_SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 88 } as const;
export type AvatarSize = keyof typeof AVATAR_SIZES | number;

function initialsOf(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({
  src,
  name,
  alt,
  size = 'md',
  className,
  ring,
}: {
  src?: string | null;
  name?: string;
  alt?: string;
  size?: AvatarSize;
  className?: string;
  ring?: boolean;
}) {
  const px = typeof size === 'number' ? size : AVATAR_SIZES[size];
  const [broken, setBroken] = useState(false);
  const url = src ? mediaUrl(src) : '';

  useEffect(() => {
    setBroken(false);
  }, [url]);

  const style = {
    width: px,
    height: px,
    minWidth: px,
    fontSize: Math.max(10, Math.round(px * 0.38)),
  } as const;

  const base = cx(
    'inline-flex select-none items-center justify-center overflow-hidden rounded-full',
    ring && 'ring-2 ring-[var(--color-brand)] ring-offset-2 ring-offset-[var(--color-ink)]',
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
        className={cx(base, 'object-cover')}
      />
    );
  }

  return (
    <span
      aria-label={name || 'avatar'}
      title={name}
      style={{
        ...style,
        background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-2))',
      }}
      className={cx(base, 'font-bold text-[#08080d]')}
    >
      {initialsOf(name)}
    </span>
  );
}

/* ------------------------------------------------------------------- Button */

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = 'ghost',
  size = 'md',
  loading = false,
  block = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const sizeCls =
    size === 'sm'
      ? 'text-xs px-3 py-1.5'
      : size === 'lg'
        ? 'text-base px-5 py-3'
        : '';
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'btn',
        variant === 'primary'
          ? 'btn-primary'
          : variant === 'danger'
            ? 'btn-ghost border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25'
            : 'btn-ghost',
        sizeCls,
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-xl text-[var(--color-muted)]',
        'transition-colors hover:bg-[var(--color-surface-2)] hover:text-white',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- Input/Field */

type FieldProps = {
  label?: string;
  hint?: string;
  error?: string | null;
  containerClassName?: string;
};

export function Input({
  label,
  hint,
  error,
  containerClassName,
  className,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const auto = useId();
  const inputId = id || auto;
  return (
    <div className={cx('w-full', containerClassName)}>
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-semibold text-[var(--color-muted)]">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        aria-invalid={!!error}
        className={cx('input-base', error && 'border-red-500/70', className)}
        {...rest}
      />
      {error ? (
        <p className="mt-1 text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-[var(--color-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

export function Textarea({
  label,
  hint,
  error,
  containerClassName,
  className,
  id,
  rows = 4,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  const auto = useId();
  const taId = id || auto;
  return (
    <div className={cx('w-full', containerClassName)}>
      {label ? (
        <label htmlFor={taId} className="mb-1.5 block text-xs font-semibold text-[var(--color-muted)]">
          {label}
        </label>
      ) : null}
      <textarea
        id={taId}
        rows={rows}
        aria-invalid={!!error}
        className={cx('input-base resize-y leading-relaxed', error && 'border-red-500/70', className)}
        {...rest}
      />
      {error ? (
        <p className="mt-1 text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-[var(--color-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------- Card */

export function Card({
  className,
  padded = true,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div className={cx('card', padded && 'p-4', className)} {...rest}>
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
        <h3 className="truncate text-sm font-bold text-white">{title}</h3>
        {subtitle ? (
          <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------- Badge */

export type BadgeTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  brand: 'bg-[var(--color-brand)]/15 text-[var(--color-brand)] border-[var(--color-brand)]/30',
  neutral: 'bg-[var(--color-surface-2)] text-[var(--color-muted)] border-[var(--color-line)]',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  danger: 'bg-red-500/15 text-red-300 border-red-500/30',
  info: 'bg-[var(--color-brand-2)]/15 text-[var(--color-brand-2)] border-[var(--color-brand-2)]/30',
};

export function Badge({
  tone = 'neutral',
  variant,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; variant?: BadgeTone }) {
  const resolvedTone = variant || tone;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        BADGE_TONES[resolvedTone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------- Modal */

function useLockBody(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeOnBackdrop?: boolean;
}) {
  useLockBody(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const width = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-3xl' : 'max-w-lg';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        className={cx(
          'card safe-bottom w-full overflow-hidden rounded-b-none sm:rounded-2xl',
          'max-h-[92vh] shadow-2xl shadow-black/60',
          width,
        )}
      >
        {title ? (
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
            <h2 className="truncate text-base font-bold text-white">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <XIcon size={18} />
            </IconButton>
          </div>
        ) : null}
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-[var(--color-line)] px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------- ConfirmDialog */

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
          <Button
            variant={destructive ? 'ghost' : 'primary'}
            loading={loading}
            onClick={onConfirm}
            className={destructive ? 'border-red-500/40 bg-red-500/15 text-red-300' : undefined}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-[var(--color-muted)]">
        {message || description || 'This action cannot be undone.'}
      </p>
    </Modal>
  );
}

/* -------------------------------------------------------------------- Toast */

export type ToastKind = 'success' | 'error' | 'info';
export type Toast = { id: number; kind: ToastKind; message: string };

type ToastApi = {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (e: unknown, fallback?: string) => void;
  info: (message: string) => void;
  dismiss: (id: number) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

const TOAST_TONE: Record<ToastKind, string> = {
  success: 'border-emerald-500/40 text-emerald-200',
  error: 'border-red-500/40 text-red-200',
  info: 'border-[var(--color-line)] text-white',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      if (!message) return;
      const id = ++seq.current;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 4000),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach(clearTimeout);
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      dismiss,
      success: (m: string) => toast(m, 'success'),
      info: (m: string) => toast(m, 'info'),
      error: (e: unknown, fallback = 'Something went wrong') =>
        toast(typeof e === 'string' ? e : errMsg(e, fallback), 'error'),
    }),
    [toast, dismiss],
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex flex-col items-center gap-2 p-4 pb-24 lg:pb-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            onClick={() => dismiss(t.id)}
            className={cx(
              'pointer-events-auto w-full max-w-sm cursor-pointer rounded-xl border bg-[var(--color-surface)] px-4 py-3',
              'text-sm font-medium shadow-xl shadow-black/50',
              TOAST_TONE[t.kind],
            )}
          >
            {t.message}
          </div>
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

/* --------------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  message,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center gap-3 px-6 py-14 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-brand)]">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-bold text-white">{title}</h3>
      {message || description ? (
        <p className="max-w-sm text-sm leading-relaxed text-[var(--color-muted)]">
          {message || description}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------- ErrorState */

export function ErrorState({
  error,
  retry,
  onRetry,
  title = 'Something went wrong',
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
  const detail = message
    || (error ? errMsg(error, 'Please try again in a moment.') : 'Please try again in a moment.');
  const retryAction = retry || onRetry;
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-xl text-red-300">
        !
      </div>
      <h3 className="text-base font-bold text-white">{title}</h3>
      <p className="max-w-sm text-sm leading-relaxed text-[var(--color-muted)]">{detail}</p>
      {action ? <div className="mt-1">{action}</div> : retryAction ? (
        <Button variant="primary" onClick={() => void retryAction()} className="mt-1">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------- Tabs */

export type TabItem = {
  key?: string;
  value?: string;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
};

export function Tabs({
  tabs,
  active,
  value,
  onChange,
  className,
  fill = false,
}: {
  tabs: TabItem[];
  active?: string;
  value?: string;
  onChange: (key: string) => void;
  className?: string;
  fill?: boolean;
}) {
  const selected = active ?? value ?? '';
  return (
    <div
      role="tablist"
      className={cx(
        'flex gap-1 overflow-x-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1',
        className,
      )}
    >
      {tabs.map((t) => {
        const key = t.key ?? t.value;
        if (!key) return null;
        const isActive = key === selected;
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className={cx(
              'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2',
              'text-sm font-semibold transition-colors',
              fill && 'flex-1',
              isActive
                ? 'bg-[var(--color-brand)]/15 text-[var(--color-brand)]'
                : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-white',
            )}
          >
            {t.icon}
            {t.label}
            {typeof t.count === 'number' ? (
              <span className="rounded-full bg-[var(--color-surface-2)] px-1.5 text-[11px] text-[var(--color-muted)]">
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
        checked
          ? 'border-transparent bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-brand-2)]'
          : 'border-[var(--color-line)] bg-[var(--color-surface-2)]'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
        style={{ width: 18, height: 18 }}
      />
    </button>
  );
}
