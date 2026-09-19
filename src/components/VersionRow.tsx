import { useQuery } from '@tanstack/react-query';
import { WEB_BUILD, WEB_VERSION, api } from '../lib/api';
import { Info } from './icons';

/**
 * Settings > Help and legal: which web build this is and which API build it
 * talks to, for support tickets. GET /api/version is public, has no database
 * behind it and is computed once per API process (routes/version.js), so it
 * is fetched once per page load and never retried.
 */

type VersionInfo = { sha: string; builtAt: string; node: string };

/** `5228f21` plus the build date when the API reports one; 'unknown' for an API deployed without GIT_SHA. */
export function apiVersionLabel(info: VersionInfo | null | undefined): string {
  const sha = typeof info?.sha === 'string' ? info.sha.slice(0, 7) : '';
  const parsed = typeof info?.builtAt === 'string' && info.builtAt ? new Date(info.builtAt) : null;
  const built = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '';
  const label = sha || 'unknown';
  return built ? `${label} (${built})` : label;
}

/** `1.0.0+5228f21c0ffe`, or `dev` for a bundle built without a version. */
export function webVersionLabel(version: string | null = WEB_VERSION, build: string | null = WEB_BUILD): string {
  return `${version ?? 'dev'}${build ? `+${build}` : ''}`;
}

export function VersionRow() {
  const version = useQuery({
    queryKey: ['api-version'],
    queryFn: async () => (await api.get('/version')).data as VersionInfo,
    staleTime: Infinity,
    retry: false,
  });
  const apiLabel = version.isLoading ? '…' : version.isError || !version.data ? 'unavailable' : apiVersionLabel(version.data);
  return (
    <li data-testid="about-version" className="flex min-h-14 items-center gap-3 px-3 py-2">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-text-2">
        <Info size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text-1">Version</span>
        <span className="block text-xs text-text-2">Web build and API build, for support tickets.</span>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-text-3">Web</dt>
          <dd className="truncate font-mono text-text-2">{webVersionLabel()}</dd>
          <dt className="text-text-3">API</dt>
          <dd className="truncate font-mono text-text-2" aria-live="polite">
            {apiLabel}
          </dd>
        </dl>
      </span>
    </li>
  );
}
