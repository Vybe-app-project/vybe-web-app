import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** GET /api/capabilities — the server's honest report of what is configured. */
export type ServerCapabilities = {
  livestreamRelay?: boolean;
  turnRelay?: boolean;
  wearables?: boolean;
  smartInsights?: boolean;
  aiCoach?: boolean;
  [k: string]: unknown;
};

/** Client-gated capabilities that ship disabled until the server reports them. */
export type GatedCapability = 'wearables' | 'smartInsights' | 'aiCoach';

/**
 * The API does not report these keys yet, so a missing key means "not
 * configured". Reads go through `capabilityEnabled`, which falls back here —
 * an unreported capability is never assumed available.
 */
export const DEFAULT_CAPABILITIES: Record<GatedCapability, false> = {
  wearables: false,
  smartInsights: false,
  aiCoach: false,
};

/** Strict read: only an explicit `true` from the server enables a feature. */
export function capabilityEnabled(
  caps: ServerCapabilities | undefined,
  key: GatedCapability | 'livestreamRelay' | 'turnRelay',
): boolean {
  const fallback = (DEFAULT_CAPABILITIES as Record<string, false>)[key] ?? false;
  return (caps?.[key] ?? fallback) === true;
}

/**
 * Shared reader for GET /api/capabilities. Same query key and freshness as
 * the livestream page's local hook, so pages share one cached report.
 */
export function useCapabilities() {
  return useQuery({
    queryKey: ['capabilities'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get('/capabilities');
      return (data?.capabilities || {}) as ServerCapabilities;
    },
  });
}

/** Convenience wrapper: the capability query plus the strict `enabled` bit. */
export function useCapability(key: GatedCapability | 'livestreamRelay' | 'turnRelay') {
  const query = useCapabilities();
  return { ...query, enabled: capabilityEnabled(query.data, key) };
}

/**
 * Live video needs a media relay. Until the server has confirmed one exists,
 * the feature is not promoted anywhere: on servers without a relay this
 * avoids a flash of "Live" in the sidebar that then disappears, and on
 * servers with one the entry points appear once, a moment after first paint.
 */
export function liveVideoEnabled(caps: ServerCapabilities | undefined): boolean {
  return caps?.livestreamRelay === true;
}
