import { QueryClient } from '@tanstack/react-query';
import { onSessionChange } from './consumerSession';

const createClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error: any) => {
        const status = error?.response?.status;
        if (typeof status === 'number' && status < 500) return false;
        return count < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
let client = createClient();
let generation = 0;
const listeners = new Set<() => void>();
export const currentQueryClient = () => client;
export const queryClientGeneration = () => generation;
export function subscribeQueryClient(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
onSessionChange(() => {
  const old = client;
  void old.cancelQueries();
  old.clear();
  // Old mutation callbacks may still write to their captured client, never the new account's.
  client = createClient();
  generation++;
  for (const listener of listeners) listener();
});
