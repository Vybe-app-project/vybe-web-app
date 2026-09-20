import { useEffect, useState } from 'react';
import { useFeature } from '../../lib/capabilities';
import type { PublicUser, WorkoutSettings } from '../../lib/hooks';
import { DEFAULT_REP_RANGE, PROGRESS_STRINGS, REP_RANGE_BOUNDS, workoutPreferencesOf } from '../../lib/progress';
import { SettingsCard, ToggleRow } from '../SettingsPieces';
import { settingsFieldError, useAccount, useSettingsSave } from '../SettingsPreferences';
import { Button, Stepper, useToast } from '../ui';

/**
 * Settings > Workouts (design-progression-hub.md §3.7 "Switch"): the
 * Suggestions switch (`settings.workout.progressionHints`) and the default
 * rep range (`settings.workout.defaultRepRange`, whole numbers 1-50 with
 * lowest below highest) behind the suggested next set. Both save through the
 * shared `PUT /users/settings` PATCH with only the `workout` key; the server's
 * `400 { message, field: 'workout' }` lands under the range controls.
 *
 * Renders nothing while `features.progression` is off for this member, so the
 * card appears with the rest of the surface and never before it.
 */
export default function WorkoutSettingsSection() {
  const enabled = useFeature('progression');
  if (!enabled) return null;
  return <WorkoutSettingsCard />;
}

const withWorkout = (old: PublicUser, next: WorkoutSettings): PublicUser => ({
  ...old,
  settings: { ...(old.settings ?? {}), workout: { ...(old.settings?.workout ?? {}), ...next } },
});

function WorkoutSettingsCard() {
  const me = useAccount();
  const account = me.data;
  const prefs = workoutPreferencesOf(account);
  const stored = prefs.defaultRepRange;
  const toast = useToast();

  const [min, setMin] = useState(stored.min);
  const [max, setMax] = useState(stored.max);
  const [rangeError, setRangeError] = useState<string | null>(null);
  // The steppers follow the account (another device may have changed it).
  useEffect(() => {
    setMin(stored.min);
    setMax(stored.max);
    setRangeError(null);
  }, [stored.min, stored.max]);

  const toggleSave = useSettingsSave({ fallback: 'Could not save this setting.' });
  const rangeSave = useSettingsSave({
    fallback: 'Could not save the rep range.',
    onError: (e) => {
      const message = settingsFieldError(e, 'workout');
      if (message) setRangeError(message);
      else toast.error(e, 'Could not save the rep range.');
    },
  });

  const busy = toggleSave.isPending || rangeSave.isPending || !account;
  const invalid = !(min < max);
  const changed = min !== stored.min || max !== stored.max;
  const isDefault = stored.min === DEFAULT_REP_RANGE.min && stored.max === DEFAULT_REP_RANGE.max;
  const shownError = rangeError ?? (invalid ? PROGRESS_STRINGS.rangeError : null);

  return (
    <SettingsCard id="workouts" title={PROGRESS_STRINGS.settingsTitle} description="Suggestions under Previous in the workout runner, and the rep range they read.">
      <ToggleRow
        title={PROGRESS_STRINGS.suggestions}
        hint={PROGRESS_STRINGS.suggestionsBody}
        checked={prefs.progressionHints}
        disabled={busy}
        onChange={(progressionHints) => toggleSave.mutate({ patch: { workout: { progressionHints } }, optimistic: (old) => withWorkout(old, { progressionHints }) })}
      />
      <form
        className="mt-3 border-t border-line pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (invalid || !changed || busy) return;
          rangeSave.mutate(
            { patch: { workout: { defaultRepRange: { min, max } } }, optimistic: (old) => withWorkout(old, { defaultRepRange: { min, max } }) },
            { onSuccess: () => setRangeError(null) },
          );
        }}
      >
        <p className="text-sm font-semibold text-text-1">{PROGRESS_STRINGS.repRange}</p>
        <p className="text-xs text-text-2">{`${stored.min}–${stored.max} reps. Suggestions go up a step at the top of the range and ease off below the bottom.`}</p>
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <Stepper
            label={PROGRESS_STRINGS.lowest}
            value={min}
            min={REP_RANGE_BOUNDS.min}
            max={REP_RANGE_BOUNDS.max}
            disabled={busy}
            onChange={(next) => {
              setMin(next);
              setRangeError(null);
            }}
          />
          <Stepper
            label={PROGRESS_STRINGS.highest}
            value={max}
            min={REP_RANGE_BOUNDS.min}
            max={REP_RANGE_BOUNDS.max}
            disabled={busy}
            onChange={(next) => {
              setMax(next);
              setRangeError(null);
            }}
          />
        </div>
        {shownError ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {shownError}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={!changed || invalid || busy} loading={rangeSave.isPending}>
            {PROGRESS_STRINGS.saveRange}
          </Button>
          {!isDefault ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              disabled={busy}
              onClick={() =>
                rangeSave.mutate(
                  { patch: { workout: { defaultRepRange: null } }, optimistic: (old) => withWorkout(old, { defaultRepRange: { ...DEFAULT_REP_RANGE } }) },
                  { onSuccess: () => setRangeError(null) },
                )
              }
            >
              {PROGRESS_STRINGS.resetRange}
            </Button>
          ) : null}
        </div>
      </form>
    </SettingsCard>
  );
}
