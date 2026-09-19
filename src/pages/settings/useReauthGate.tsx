import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  NO_REAUTH_METHODS,
  isReauthRequired,
  reauthCache,
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
};

/**
 * Runs an action that needs an X-Reauth token. A cached token (ten minutes,
 * memory only) is tried first; otherwise, or when the API answers 401
 * REAUTH_REQUIRED, the dialog opens and the action runs again with the fresh
 * token while the dialog shows its loading state. Resolves with the action's
 * result, or null when the person cancels; rejects with any other error so
 * the caller can toast it.
 */
export function useReauthGate({ methods, email }: { methods: ReauthMethods | undefined; email?: string }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const open = (next: Pending | null) => {
    pendingRef.current = next;
    setPending(next);
  };

  const withReauth = useCallback(
    <T,>(run: (token: string | null) => Promise<T>, opts: { purpose: ReauthPurpose; waive?: boolean }): Promise<T | null> =>
      new Promise<T | null>((resolve, reject) => {
        const start = async () => {
          const cachedToken = reauthCache.get();
          if (cachedToken || opts.waive) {
            try {
              resolve(await run(cachedToken));
              return;
            } catch (error) {
              if (!isReauthRequired(error)) {
                reject(error);
                return;
              }
              reauthCache.clear();
            }
          }
          open({ run, resolve: (v) => resolve(v as T | null), reject, purpose: opts.purpose });
        };
        void start();
      }),
    [],
  );

  const onToken = async (result: ReauthResult) => {
    const current = pendingRef.current;
    if (!current) return;
    reauthCache.set(result);
    try {
      const value = await current.run(result.reauthToken);
      open(null);
      current.resolve(value);
    } catch (error) {
      if (isReauthRequired(error)) {
        // The fresh token was refused (password changed meanwhile): stay open.
        reauthCache.clear();
        throw error;
      }
      open(null);
      current.reject(error);
    }
  };

  const onCancel = () => {
    const current = pendingRef.current;
    open(null);
    current?.resolve(null);
  };

  const dialog: ReactNode = (
    <ReauthDialog
      open={pending !== null}
      methods={methods ?? NO_REAUTH_METHODS}
      email={email}
      purpose={pending?.purpose ?? 'delete'}
      onToken={onToken}
      onCancel={onCancel}
    />
  );

  return { withReauth, dialog, prompting: pending !== null };
}
