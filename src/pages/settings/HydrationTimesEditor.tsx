import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, parseApiError } from '../../lib/api';
import {
  HYDRATION_TIMES_MAX,
  hydrationSavedToast,
  hydrationSaveErrorMessage,
  normalizeClock,
  pickNotificationSettingsResponse,
  quietHoursHint,
  validateHydrationTimes,
  type HydrationReminders,
  type NotificationSettingsResponse,
  type QuietHours,
} from '../../lib/hooks';
import { Button, IconButton, Input, useToast } from '../ui';
import { Plus, Trash } from '../icons';

/**
 * The water check-in times under the "Water check-ins" switch: up to three
 * `HH:MM` entries on the member's own clock (`settings.timezone`, which
 * lib/accountPreferences keeps in step), saved as `hydrationReminders` on
 * PUT /notifications/settings.
 *
 * Two API facts shape the requests (docs/api-contract.md, "hydrationReminders"):
 * saving times does not turn the switch on, so a save while the switch is
 * off sends `{ hydration: true, hydrationReminders: { times } }` in one
 * request, and the hint and the toast both say so; and removing every time
 * sends `{ hydrationReminders: null }`.
 *
 * Errors: a blank or malformed row is marked on the field itself (aria-invalid
 * and the per-field alert from the Input); duplicate and too-many belong to
 * the set and sit under the rows. A 400 that names `field: 'hydrationReminders'`
 * (a time inside quiet hours, no timezone yet) is worded for the web by
 * hydrationSaveErrorMessage and shown under the rows; anything else is a toast.
 */

export type HydrationTimesEditorProps = {
  /** The saved `hydrationReminders.times`, or none. */
  times: readonly string[];
  /** `settings.hydration`; the switch alone schedules nothing without times. */
  hydrationOn: boolean;
  /** `quietHours` from the same settings query; the API refuses a time inside the window. */
  quietHours?: QuietHours;
  /** Paused, or the switch itself is mid-save. */
  disabled?: boolean;
  /** Receives the API's answer so the shared settings query can be replaced. */
  onSaved: (next: NotificationSettingsResponse) => void;
};

type HydrationPatch = { hydration?: true; hydrationReminders: HydrationReminders };

/** `index` is the row at fault, or null when the sentence is about the set. */
type EditorError = { message: string; index: number | null };

const ERROR_ID = 'hydration-times-error';
const HINT_ID = 'hydration-times-hint';
const ADD_ID = 'hydration-times-add';
const inputId = (index: number) => `hydration-time-${index}`;

export function HydrationTimesEditor({ times, hydrationOn, quietHours = null, disabled = false, onSaved }: HydrationTimesEditorProps) {
  const toast = useToast();
  const saved = times.join(',');
  const [draft, setDraft] = useState<string[]>(() => [...times]);
  const [error, setError] = useState<EditorError | null>(null);
  // Where focus goes after a row is removed: the previous row's input, or Add a time when none remain.
  const focusAfterRemove = useRef<number | 'add' | null>(null);

  // Re-seed when the server's copy changes (a save answered, or the phone edited them).
  useEffect(() => {
    setDraft(saved ? saved.split(',') : []);
    setError(null);
  }, [saved]);

  // Removing a row unmounts the focused button; move focus deliberately instead of dropping it on <body>.
  useEffect(() => {
    const target = focusAfterRemove.current;
    if (target === null) return;
    focusAfterRemove.current = null;
    document.getElementById(target === 'add' ? ADD_ID : inputId(target))?.focus();
  }, [draft.length]);

  const save = useMutation({
    mutationFn: async (patch: HydrationPatch) => {
      const { data } = await api.put('/notifications/settings', patch);
      return pickNotificationSettingsResponse(data);
    },
    onSuccess: (next, patch) => {
      onSaved(next);
      setError(null);
      toast.success(
        patch.hydrationReminders ? hydrationSavedToast(patch.hydrationReminders.times, patch.hydration === true) : 'Water check-ins turned off',
      );
    },
    onError: (e) => {
      const parsed = parseApiError(e, 'Could not save your water check-in times.');
      if (parsed.field === 'hydrationReminders') {
        setError({ message: hydrationSaveErrorMessage(parsed, quietHours), index: null });
        return;
      }
      toast.error(parsed.message);
    },
  });

  const normalized = draft.map((time) => normalizeClock(time));
  const dirty = normalized.join(',') !== saved;
  const busy = disabled || save.isPending;
  const sharedError = error && error.index === null ? error.message : null;

  function submit() {
    if (normalized.length === 0) {
      setError(null);
      save.mutate({ hydrationReminders: null });
      return;
    }
    const checked = validateHydrationTimes(normalized);
    if (checked.value === undefined) {
      setError({ message: checked.error, index: checked.index ?? null });
      return;
    }
    setError(null);
    const body: HydrationPatch = { hydrationReminders: { times: checked.value } };
    // The switch is off: turn it on in the same request, or the times would sit idle. The hint says so.
    if (!hydrationOn) body.hydration = true;
    save.mutate(body);
  }

  const hintLead = 'Up to three times a day, on your clock.';
  const hintState = !hydrationOn
    ? 'Saving times turns Water check-ins on.'
    : times.length === 0
      ? 'Add at least one time to receive check-ins.'
      : null;
  const hint = [hintLead, hintState, quietHoursHint(quietHours)].filter(Boolean).join(' ');

  return (
    <fieldset className="py-3 pl-0 sm:pl-4" aria-describedby={sharedError ? ERROR_ID : HINT_ID}>
      <legend className="text-sm font-semibold text-text-1">Reminder times</legend>
      <p id={HINT_ID} className="mt-0.5 text-xs text-text-2">
        {hint}
      </p>
      {draft.length > 0 ? (
        <div className="mt-3 space-y-3">
          {draft.map((time, index) => (
            <div key={index} className="flex items-end gap-2">
              <Input
                id={inputId(index)}
                type="time"
                step={60}
                label={`Reminder time ${index + 1}`}
                value={time}
                disabled={busy}
                error={error && error.index === index ? error.message : undefined}
                aria-describedby={sharedError ? ERROR_ID : undefined}
                containerClassName="max-w-[12rem]"
                onChange={(e) => {
                  const next = e.target.value;
                  setDraft((d) => d.map((t, i) => (i === index ? next : t)));
                  if (error) setError(null);
                }}
              />
              <IconButton
                label={`Remove reminder time ${index + 1}`}
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  focusAfterRemove.current = draft.length > 1 ? Math.max(0, index - 1) : 'add';
                  setDraft((d) => d.filter((_, i) => i !== index));
                  if (error) setError(null);
                }}
              >
                <Trash size={18} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : null}
      {sharedError ? (
        <p id={ERROR_ID} role="alert" className="mt-2 text-xs text-danger">
          {sharedError}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          id={ADD_ID}
          variant="secondary"
          size="sm"
          icon={<Plus size={16} />}
          disabled={busy || draft.length >= HYDRATION_TIMES_MAX}
          onClick={() => setDraft((d) => (d.length >= HYDRATION_TIMES_MAX ? d : [...d, '']))}
        >
          Add a time
        </Button>
        <Button variant="primary" size="sm" loading={save.isPending} disabled={disabled || !dirty} onClick={submit}>
          Save times
        </Button>
      </div>
    </fieldset>
  );
}

export default HydrationTimesEditor;
