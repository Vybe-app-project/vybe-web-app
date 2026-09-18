import type { SVGProps } from 'react';

/**
 * The Vybe mark: two figures whose raised arms form the "V" — literally
 * training together. Hand-authored on a 24 grid from the shipped mobile
 * LaunchLogo (mint on navy). Drawn in `currentColor` so it themes; the
 * colour is decided by the caller (`text-brand` for the mint mark).
 */
export const BRAND_MARK_VIEWBOX = '0 0 24 24';

export function BrandMarkPaths({ stroke = 3.2 }: { stroke?: number }) {
  return (
    <>
      <circle cx="6.3" cy="4.9" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="17.7" cy="4.9" r="1.9" fill="currentColor" stroke="none" />
      <path
        d="M3.9 9.2 12 20.6l8.1-11.4"
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.1 16.5 12 9.1l2.9 7.4"
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

export type BrandMarkProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  size?: number | string;
  /** Accessible name. Omit when the mark is decorative next to the wordmark. */
  title?: string;
};

export function BrandMark({ size = 24, title, className, ...rest }: BrandMarkProps) {
  return (
    <svg
      viewBox={BRAND_MARK_VIEWBOX}
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <BrandMarkPaths />
    </svg>
  );
}

const SIZES = {
  sm: { mark: 20, text: 'text-lg', gap: 'gap-1.5' },
  md: { mark: 26, text: 'text-xl', gap: 'gap-2' },
  lg: { mark: 40, text: 'text-3xl', gap: 'gap-2.5' },
  xl: { mark: 64, text: 'text-display', gap: 'gap-4' },
} as const;

export type BrandProps = {
  size?: keyof typeof SIZES;
  /** `lockup` = mark + wordmark (default); `mark` = mark only; `wordmark` = text only. */
  variant?: 'lockup' | 'mark' | 'wordmark';
  className?: string;
  /** Force the lockup to render entirely in mint (for use on navy hero panels). */
  tone?: 'auto' | 'brand' | 'inverse';
};

/**
 * `<Brand />` replaces the hand-rolled gradient wordmarks. On dark it is
 * solid mint; on light the mark stays mint and the word uses `text-1`.
 */
export function Brand({ size = 'md', variant = 'lockup', className, tone = 'auto' }: BrandProps) {
  const s = SIZES[size];
  const wordCls =
    tone === 'brand'
      ? 'text-brand'
      : tone === 'inverse'
        ? 'text-text-1'
        : 'text-text-1 dark:text-brand';
  const word = (
    <span className={`type-display ${s.text} leading-none ${wordCls}`} aria-hidden={variant === 'lockup' ? true : undefined}>
      Vybe
    </span>
  );
  if (variant === 'wordmark') {
    return <span className={`inline-flex items-center ${className ?? ''}`} aria-label="Vybe">{word}</span>;
  }
  if (variant === 'mark') {
    return <BrandMark size={s.mark} title="Vybe" className={`text-brand ${className ?? ''}`} />;
  }
  return (
    <span className={`inline-flex items-center ${s.gap} ${className ?? ''}`} role="img" aria-label="Vybe">
      <BrandMark size={s.mark} className="shrink-0 text-brand" />
      {word}
    </span>
  );
}

/**
 * Decorative "pair" illustration for empty states and covers: the two
 * figures drawn as line art in `text-3` with the raised-arm peak in mint.
 */
export function PairFigure({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="26" cy="22" r="7" />
        <circle cx="70" cy="22" r="7" />
        <path d="M14 40 48 84 82 40" />
        <path d="M22 66c-3 6-6 12-7 18M74 66c3 6 6 12 7 18" />
      </g>
      <path d="M36 62 48 38l12 24" fill="none" stroke="var(--brand)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default Brand;
