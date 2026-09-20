import { cx } from './ui';

/**
 * An abstract map tile drawn from a coordinate pair: a few streets, a park
 * block, a stretch of water and the mint pin. Pure SVG, no tiles, no network,
 * and the same coordinates always draw the same tile. Decorative only: wrap it
 * in a link to a real map when the place should be navigable.
 */

export type MapTileProps = {
  lat: number;
  lng: number;
  /** 84 on phones, 104 on desktop bands. */
  size?: 84 | 104 | number;
  className?: string;
};

function seedFrom(lat: number, lng: number): number {
  const text = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Bits of the seed as a 0..1 value, one slot per feature so features move independently. */
const slot = (seed: number, n: number) => ((seed >>> (n * 4)) & 0xf) / 15;

export function MapTile({ lat, lng, size = 84, className }: MapTileProps) {
  const seed = seedFrom(lat, lng);
  const tilt = (slot(seed, 0) - 0.5) * 24; // -12..12 degrees
  const h1 = 22 + slot(seed, 1) * 14; // horizontal streets
  const h2 = 58 + slot(seed, 2) * 14;
  const v1 = 20 + slot(seed, 3) * 16; // vertical streets
  const v2 = 58 + slot(seed, 4) * 16;
  const parkX = slot(seed, 5) > 0.5 ? v2 + 4 : v1 - 26;
  const parkY = slot(seed, 6) > 0.5 ? h2 + 4 : h1 - 26;
  const waterY = 74 + slot(seed, 7) * 16;
  const waterBend = (slot(seed, 8) - 0.5) * 30;
  const avenue = slot(seed, 9) > 0.6;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cx('block', className)}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="100" height="100" fill="var(--navy-100)" />
      <g transform={`rotate(${tilt.toFixed(1)} 50 50)`}>
        <rect x={parkX} y={parkY} width="22" height="22" rx="3" fill="var(--mint-100)" />
        <path
          d={`M-20 ${h1} H120 M-20 ${h2} H120 M${v1} -20 V120 M${v2} -20 V120${avenue ? ' M-20 110 L110 -20' : ''}`}
          stroke="var(--navy-50)"
          strokeWidth="6"
        />
        <path
          d={`M-20 ${h1} H120 M-20 ${h2} H120 M${v1} -20 V120 M${v2} -20 V120${avenue ? ' M-20 110 L110 -20' : ''}`}
          stroke="var(--navy-200)"
          strokeWidth="1"
        />
        <path d={`M-10 ${waterY} Q50 ${waterY + waterBend} 110 ${waterY - 6}`} stroke="var(--mint-200)" strokeWidth="8" fill="none" strokeLinecap="round" />
      </g>
      <circle cx="50" cy="50" r="11" fill="var(--mint-500)" opacity="0.35" />
      <circle cx="50" cy="50" r="5.5" fill="var(--mint-600)" stroke="var(--navy-50)" strokeWidth="2.5" />
    </svg>
  );
}

/** OpenStreetMap permalink for a coordinate pair, the link the tile sits in. */
export const osmHref = (lat: number, lng: number) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
