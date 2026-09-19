import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  NO_REAUTH_METHODS,
  reauthCache,
  reauthGateDecision,
  type ReauthMethods,
  type ReauthPurpose,
  type ReauthResult,
} from '../../lib/accountLifecycle';
import { ReauthDialog } from './ReauthDialog';

type Pending = {
  run: (token: string | null) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  purpose: ReauthPurpose;
  /** The proofs the API named on its 401 REAUTH_REQUIRED; these beat the cached status. */
  methods: ReauthMethods | null;
};

/**
 * Runs an action that needs an X-Reauth token. A cached token (ten minutes,
 * memory only) is tried first; otherwise, or when the API answers 401
 * REAUTH_REQUIRED, the dialog opens and the action runs again with the fresh
 * token while the dialog shows its loading state. Resolves with the action's
 * result, or null when the person cancels; rejects with any other error so
 * the caller can toast it. Every branch is decided by reauthGateDecision
 * (src/lib/accountLifecycle.ts), which is tested under node.
 */
export function useReauthGate({ methods, email }: { methods: ReauthMethods | undefined; email?: string }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  // True while the action runs with a token from the dialog. Cancel is refused
  // then: the request is already on its way, and the caller must see its
  // answer (a deletion that completed must still sign the person out).
  const inFlightRef = useRef(false);
  const open = (next: Pending | null) => {
    pendingRef.current = next;
    setPending(next);
  };

  const withReauth = useCallback(
    <T,>(run: (token: string | null) => Promise<T>, opts: { purpose: ReauthPurpose; waive?: boolean }): Promise<T | null> =>
      new Promise<T | null>((resolve, reject) => {
        const prompt = (found: ReauthMethods | null) =>
          open({ run, resolve: (v) => resolve(v as T | null), reject, purpose: opts.purpose, methods: found });
        const start = async () => {
          const first = reauthGateDecision({ phase: 'start', cachedToken: reauthCache.get(), waive: opts.waive === true });
          if (first.kind === 'prompt') {
            prompt(first.methods);
            return;
          }
          try {
            resolve(await run(first.token));
          } catch (error) {
            const next = reauthGateDecision({ phase: 'failed', error });
            if (next.kind === 'reject') {
              reject(error);
              return;
            }
            if (next.clearCache) reauthCache.clear();
            prompt(next.methods);
          }
        };
        void start();
      }),
    [],
  );

  const onToken = async (result: ReauthResult) => {
    const current = pendingRef.current;
    if (!current || inFlightRef.current) return;
    reauthCache.set(result);
    inFlightRef.current = true;
    try {
      const value = await current.run(result.reauthToken);
      open(null);
      current.resolve(value);
    } catch (error) {
      const next = reauthGateDecision({ phase: 'failed', error });
      if (next.kind === 'prompt') {
        // The fresh token was refused (password changed meanwhile): stay open.
        reauthCache.clear();
        throw error;
      }
      open(null);
      current.reject(error);
    } finally {
      inFlightRef.current = false;
    }
  };

  const onCancel = () => {
    if (reauthGateDecision({ phase: 'cancel', inFlight: inFlightRef.current }).kind === 'ignore') return;
    const current = pendingRef.current;
    open(null);
    current?.resolve(null);
  };

  const dialog: ReactNode = (
    <ReauthDialog
      open={pending !== null}
      methods={pending?.methods ?? methods ?? NO_REAUTH_METHODS}
      email={email}
      purpose={pending?.purpose ?? 'delete'}
      onToken={onToken}
      onCancel={onCancel}
    />
  );

  return { withReauth, dialog, prompting: pending !== null };
}
