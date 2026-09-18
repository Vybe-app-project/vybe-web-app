/**
 * Exercise `duration` is stored in seconds everywhere (seed data, the mobile
 * app's "Duration (sec)" field, the API). The web used to print and edit the
 * same number as minutes, so a 3-minute hold read "180 min".
 */

/** `180` → "3 min", `90` → "1 min 30 s", `45` → "45 s", `3600` → "1 h". */
export function formatSeconds(seconds?: number | null): string {
  const total = Math.round(Number(seconds ?? 0));
  if (!Number.isFinite(total) || total <= 0) return '';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (secs && !hours) parts.push(`${secs} s`);
  return parts.join(' ');
}

/** Split seconds into the pieces a labelled prescription shows. */
export function secondsParts(seconds?: number | null): Array<[string, string]> {
  const label = formatSeconds(seconds);
  if (!label) return [];
  return label.split(/(?<=\S) (?=\d)/).map((chunk) => {
    const [value, unit] = chunk.split(' ');
    return [value, unit];
  });
}
