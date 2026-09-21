import type { ReactNode } from 'react';
import { Card, Switch, cx } from './ui';

/**
 * The card and toggle row every Settings section is built from, shared by
 * Settings.tsx and SettingsPreferences.tsx so the page reads as one.
 *
 * The deep-link handler in Settings finds a card by `${id}-title` and the
 * closest `[role="region"]`, so every card on the page must come from here.
 */

export function SettingsCard({
  id,
  title,
  description,
  children,
  className,
  titleClassName,
  titleHidden = false,
  padded = true,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  titleClassName?: string;
  /** Keep the title for the region's name only: the card sits directly under a category heading that already says it. */
  titleHidden?: boolean;
  padded?: boolean;
}) {
  return (
    <Card id={id} role="region" aria-labelledby={`${id}-title`} className={cx('scroll-mt-28 lg:scroll-mt-20', className)} padded={padded}>
      <div className={cx(!padded && 'px-4 pt-4 sm:px-5 sm:pt-5')}>
        <h2 id={`${id}-title`} className={cx('t-section text-text-1', titleHidden && 'sr-only', titleClassName)}>
          {title}
        </h2>
        {description ? <p className={cx('text-sm text-text-2', !titleHidden && 'mt-1')}>{description}</p> : null}
      </div>
      <div className={cx(titleHidden && !description ? 'mt-0' : 'mt-4', !padded && 'px-1 pb-1')}>{children}</div>
    </Card>
  );
}

export function ToggleRow({
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={cx('flex min-h-11 items-center gap-4 py-2', disabled && 'opacity-70')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-1">{title}</p>
        <p className="text-xs text-text-2">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} label={title} onChange={onChange} />
    </div>
  );
}
