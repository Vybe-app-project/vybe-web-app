import { useEffect } from 'react';
import { useAuth } from './auth';
import { tokenStore } from './api';
import { bindWorkoutDraftAccount, invalidateWorkoutDrafts, reportWorkoutDraftStorageIssue } from './workoutDrafts';

/** Runs outside the logger too, so logout/deletion/account switches purge drafts. */
export function WorkoutDraftLifecycle() {
  const { user, verifiedToken, loading, bootstrapError } = useAuth();
  useEffect(() => {
    if (loading || bootstrapError) return;
    const token = tokenStore.get();
    if (!user || !token) {
      invalidateWorkoutDrafts();
      return;
    }
    if (!verifiedToken || verifiedToken !== token) return;
    void bindWorkoutDraftAccount(user._id, verifiedToken).catch(() => {
      reportWorkoutDraftStorageIssue('Workout storage could not be opened or purged. Open Workout log to retry; no draft will be sent automatically.');
    });
  }, [user?._id, verifiedToken, loading, bootstrapError]);
  return null;
}
