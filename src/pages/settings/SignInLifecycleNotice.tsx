import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { revokeSession, tokenStore } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { lifecycleNotice, lifecycleNoticeCopy } from '../../lib/accountLifecycle';
import { Button, Callout } from '../ui';
import { PendingDeletionBanner } from './PendingDeletionBanner';

/**
 * The one-shot notice Settings leaves for the sign-in page after a deletion
 * request ("Your account was deleted on …" or "… is scheduled for deletion on
 * …"). Read once on mount, like signOutReason.
 */
export function SignInLifecycleNotice() {
  const [notice] = useState(() => lifecycleNotice.take());
  if (!notice) return null;
  const copy = lifecycleNoticeCopy(notice);
  return (
    <Callout tone={copy.tone} title={copy.title} className="mb-5">
      {copy.body}
    </Callout>
  );
}

/**
 * Shown by Login instead of the form when the account that just signed in is
 * inside its deletion grace period: login() kept the token (the lifecycle
 * routes accept it) but left `user` unset, because every other route refuses
 * the account. "Cancel deletion" keeps the account, then bootstrap() signs the
 * person in for real; "Sign out" drops the token in place.
 */
export function PendingDeletionInterstitial({ target }: { target: string }) {
  const pending = useAuth((s) => s.pendingDeletion);
  const clearPendingDeletion = useAuth((s) => s.clearPendingDeletion);
  const bootstrap = useAuth((s) => s.bootstrap);
  const navigate = useNavigate();
  if (!pending) return null;

  const signOut = () => {
    revokeSession('/auth/logout', tokenStore.get());
    tokenStore.clear();
    clearPendingDeletion();
  };

  const onKept = async () => {
    clearPendingDeletion();
    await bootstrap();
    if (useAuth.getState().user) navigate(target, { replace: true });
  };

  return (
    <div className="space-y-4">
      <PendingDeletionBanner
        scheduledFor={pending.scheduledFor}
        onKept={onKept}
        secondaryAction={
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        }
      />
      <p className="text-sm text-text-2">
        This account is scheduled for deletion. Cancel the deletion to continue, or sign out.
      </p>
    </div>
  );
}
