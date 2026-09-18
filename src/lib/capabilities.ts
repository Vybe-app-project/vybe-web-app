import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** GET /api/capabilities — the server's honest report of what is configured. */
export type ServerCapabilities = {
  livestreamRelay?: boolean;
  turnRelay?: boolean;
  [k: string]: unknown;
};

/**
 * Shared by the shell (to hide entry points for features this server does
 * not run) and by the feature pages (to explain why). One query key, so the
 * sidebar and the Live page never disagree.
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

/**
 * Live video needs a media relay. Until the server has confirmed one exists,
 * the feature is not promoted anywhere: on servers without a relay this
 * avoids a flash of "Live" in the sidebar that then disappears, and on
 * servers with one the entry points appear once, a moment after first paint.
 */
export function liveVideoEnabled(caps: ServerCapabilities | undefined): boolean {
  return caps?.livestreamRelay === true;
}
