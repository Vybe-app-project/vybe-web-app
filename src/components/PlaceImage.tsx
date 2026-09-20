import { useEffect, useState } from 'react';
import { mediaUrl } from '../lib/api';
import { cx, identityStyle } from './ui';

/**
 * Picture for a place that came from the map provider (nearby gyms, place
 * search). The API hands us a signed, same-origin `photoUrl` that it resolves
 * from public map data on first request; when there is none, or the picture
 * fails to load, we draw a deterministic tile from the place's name so every
 * row still has a face: the same five token gradient pairs people get
 * (identityStyle), so a place and a person read as one system.
 */

export function placeInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '·';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

type Props = {
  /** Signed API path or absolute URL; null/undefined means "no picture known". */
  src?: string | null;
  name?: string | null;
  className?: string;
  /** Tailwind text size class for the initials tile. */
  textClassName?: string;
};

export function PlaceImage({ src, name, className, textClassName = 'text-sm' }: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const label = (name || '').trim();
  const url = src ? mediaUrl(src) : '';

  if (url && !failed) {
    return (
      <span className={cx('block shrink-0 overflow-hidden bg-surface-2', className)}>
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cx('flex shrink-0 select-none items-center justify-center font-semibold tracking-wide', textClassName, className)}
      style={identityStyle(label || 'place')}
    >
      {placeInitials(label)}
    </span>
  );
}
