import { useEffect, useState } from 'react';
import { Button, Callout, DateField, Modal, RadioGroup } from '../ui';
import { FOCUS_OPTIONS, INSIGHTS_STRINGS, type Focus, type FocusBody, type FocusKind } from '../../lib/insights';

/**
 * The focus sheet: the four values `PUT /api/me/focus` accepts, with the
 * server's own labels (`services/focusRules.js FOCUS_LABELS`), and the event
 * day the route requires when — and only when — the kind is Event.
 *
 * Focus gates nothing. It changes what the server's own rules suggest (a
 * raise, a comeback session's length, the Training Load offer, the recap
 * caption), which is why the value is the member's to set and nothing here
 * explains it as a goal or a plan.
 *
 * The route's own errors land under the field the API named: `400 field
 * eventDate` for a day in the past or over two years ahead, `400 field focus`
 * for anything outside the enum.
 */
export function FocusSheet({
  open,
  focus,
  onClose,
  onSave,
  busy = false,
  error,
  fieldError,
}: {
  open: boolean;
  focus: Focus | null;
  onClose: () => void;
  onSave: (body: FocusBody) => void;
  busy?: boolean;
  /** The API's sentence, rendered as given. */
  error?: string | null;
  /** Which field the API blamed, so the sentence lands under it. */
  fieldError?: string | null;
}) {
  const [kind, setKind] = useState<FocusKind | ''>(focus?.kind ?? '');
  const [eventDate, setEventDate] = useState(focus?.eventDate?.slice(0, 10) ?? '');

  // The sheet opens on the member's current answer every time.
  useEffect(() => {
    if (!open) return;
    setKind(focus?.kind ?? '');
    setEventDate(focus?.eventDate?.slice(0, 10) ?? '');
  }, [open, focus]);

  const needsDate = kind === 'event';
  const canSave = !!kind && (!needsDate || !!eventDate);

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={INSIGHTS_STRINGS.focusSheet}
      size="sm"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!canSave}
            onClick={() => {
              if (!kind) return;
              onSave({ focus: kind, ...(needsDate ? { eventDate } : {}) });
            }}
            data-testid="focus-save"
          >
            {INSIGHTS_STRINGS.focusSave}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <RadioGroup
          label={INSIGHTS_STRINGS.focusSheet}
          hideLabel
          value={kind}
          onChange={(next) => setKind(next as FocusKind)}
          options={FOCUS_OPTIONS.map((option) => ({ value: option.kind, label: option.label }))}
          error={fieldError === 'focus' ? error : null}
        />
        {needsDate ? (
          <DateField
            label={INSIGHTS_STRINGS.focusEventDate}
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            error={fieldError === 'eventDate' ? error : null}
            disabled={busy}
          />
        ) : null}
        {error && fieldError !== 'focus' && fieldError !== 'eventDate' ? <Callout tone="danger">{error}</Callout> : null}
      </div>
    </Modal>
  );
}

export default FocusSheet;
