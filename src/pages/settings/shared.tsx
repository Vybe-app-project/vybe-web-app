import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, cx } from '../ui';
import { getDeletionStatus } from '../../lib/lifecycleApi';
import type { DeletionStatus } from '../../lib/accountLifecycle';

/**
 * The Settings card frame. This mirrors the private `SettingsCard` in
 * ../Settings.tsx (same markup and classes) so the lifecycle cards read as
 * one page. It is duplicated rather than exported from Settings.tsx to keep
 * that shared file's diff to a single mount point while five branches merge;
 * once they have landed, Settings.tsx should import this one and drop its copy.
 */
export function SettingsCard({
  id,
  title,
  description,
  children,
  className,
  titleClassName,
  padded = true,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  titleClassName?: string;
  padded?: boolean;
}) {
  return (
    <Card id={id} role="region" aria-labelledby={`${id}-title`} className={cx('scroll-mt-20', className)} padded={padded}>
      <div className={cx(!padded && 'px-4 pt-4 sm:px-5 sm:pt-5')}>
        <h2 id={`${id}-title`} className={cx('type-heading text-lg text-text-1', titleClassName)}>
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-text-2">{description}</p> : null}
      </div>
      <div className={cx('mt-4', !padded && 'px-1 pb-1')}>{children}</div>
    </Card>
  );
}

export const DELETION_STATUS_KEY = ['deletion-status'] as const;

/**
 * GET /users/me/deletion, shared by the pending banner, the export card (for
 * the re-auth methods) and the delete card. One key, so the page fetches it once.
 */
export function useDeletionStatus(enabled = true) {
  return useQuery<DeletionStatus>({
    queryKey: DELETION_STATUS_KEY,
    queryFn: getDeletionStatus,
    enabled,
    staleTime: 60_000,
  });
}
