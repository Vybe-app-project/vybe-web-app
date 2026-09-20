import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, parseApiError } from '../../lib/api';
import {
  HYDRATION_TIMES_MAX,
  normalizeClock,
  pickNotificationSettingsResponse,
  validateHydrationTimes,
  type HydrationReminders,
  type NotificationSettingsResponse,
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
 * request; and removing every time sends `{ hydrationReminders: null }`.
 * A 400 that names `field: 'hydrationReminders'` (shape, a time inside quiet
 * hours, no timezone yet) is shown under the fields; anything else is a toast.
 */

export type HydrationTimesEditorProps = {
  /** The saved `hydrationReminders.times`, or none. */
  times: readonly string[];
  /** `settings.hydration`; the switch alone schedules nothing without times. */
  hydrationOn: boolean;
  /** Paused, or the switch itself is mid-save. */
  disabled?: boolean;
  /** Receives the API's answer so the shared settings query can be replaced. */
  onSaved: (next: NotificationSettingsResponse) => void;
};

type HydrationPatch = { hydration?: true; hydrationReminders: HydrationReminders };

const ERROR_ID = 'hydration-times-error';

export function HydrationTimesEditor({ times, hydrationOn, disabled = false, onSaved }: HydrationTimesEditorProps) {
  const toast = useToast();
  const saved = times.join(',');
  const [draft, setDraft] = useState<string[]>(() => [...times]);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the server's copy changes (a save answered, or the phone edited them).
  useEffect(() => {
    setDraft(saved ? saved.split(',') : []);
    setError(null);
  }, [saved]);

  const save = useMutation({
    mutationFn: async (patch: HydrationPatch) => {
      const { data } = await api.put('/notifications/settings', patch);
      return pickNotificationSettingsResponse(data);
    },
    onSuccess: (next, patch) => {
      onSaved(next);
      setError(null);
      toast.success(patch.hydrationReminders ? 'Water check-in times saved' : 'Water check-ins turned off');
    },
    onError: (e) => {
      const parsed = parseApiError(e, 'Could not save your water check-in times.');
      if (parsed.field === 'hydrationReminders') {
        setError(parsed.message);
        return;
      }
      toast.error(parsed.message);
    },
  });

  const normalized = draft.map((time) => normalizeClock(time));
  const dirty = normalized.join(',') !== saved;
  const busy = disabled || save.isPending;

  function submit() {
    if (normalized.length === 0) {
      setError(null);
      save.mutate({ hydrationReminders: null });
      return;
    }
    const checked = validateHydrationTimes(normalized);
    if (checked.value === undefined) {
      setError(checked.error);
      return;
    }
    setError(null);
    const body: HydrationPatch = { hydrationReminders: { times: checked.value } };
    // The switch is off: turn it on in the same request, or the times would sit idle.
    if (!hydrationOn) body.hydration = true;
    save.mutate(body);
  }

  const hint = !hydrationOn
    ? 'Up to three times a day, on your clock. Turn on Water check-ins to receive these.'
    : times.length === 0
      ? 'Up to three times a day, on your clock. Add at least one time to receive check-ins.'
      : 'Up to three times a day, on your clock.';

  return (
    <fieldset className="py-3 pl-0 sm:pl-4" aria-describedby={error ? ERROR_ID : 'hydration-times-hint'}>
      <legend className="text-sm font-semibold text-text-1">Reminder times</legend>
      <p id="hydration-times-hint" className="mt-0.5 text-xs text-text-2">
        {hint}
      </p>
      {draft.length > 0 ? (
        <div className="mt-3 space-y-3">
          {draft.map((time, index) => (
            <div key={index} className="flex items-end gap-2">
              <Input
                id={`hydration-time-${index}`}
                type="time"
                step={60}
                label={`Reminder time ${index + 1}`}
                value={time}
                disabled={busy}
                aria-describedby={error ? ERROR_ID : undefined}
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
      {error ? (
        <p id={ERROR_ID} role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
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
