/**
 * "Add a sticker" in the story composer: a poll, an emoji slider or a
 * question.
 *
 * One sticker, not five. The API allows five stickers of which one may be
 * interactive, and all three kinds the web can author ARE interactive — so
 * the honest control is a single choice, and the row reads as a choice
 * rather than a list you can keep adding to. The other six kinds (mention,
 * gym, countdown, Add yours, text, emoji) need a placement canvas the web
 * does not have; the viewer renders them, the composer does not offer them.
 *
 * Placement: the web has no canvas, so a new sticker goes to the lower
 * third (`DEFAULT_STICKER_PLACEMENT`), where Instagram drops one and where
 * the server's own share-results sticker sits. The API's default is dead
 * centre, which would land on top of a photo's subject every time.
 *
 * Every limit below is the server's, so the composer refuses before the
 * round trip and with the server's own words (`stickerDraftError`).
 */
import { useId } from 'react';
import {
  STICKER_LIMITS,
  stickerDraftError,
  type ComposableStickerKind,
  type StickerDraft,
} from '../../lib/stories';
import { Input, Switch, cx } from '../ui';
import { BarChart, MessageCircle, Smile, X } from '../icons';

const KINDS: Array<{ kind: ComposableStickerKind; label: string; Icon: typeof BarChart }> = [
  { kind: 'poll', label: 'Poll', Icon: BarChart },
  { kind: 'slider', label: 'Slider', Icon: Smile },
  { kind: 'question', label: 'Question', Icon: MessageCircle },
];

/** A blank draft of one kind, ready for the fields below. */
export function emptyStickerDraft(kind: ComposableStickerKind): StickerDraft {
  if (kind === 'poll') return { kind: 'poll', text: '', options: [{ text: '' }, { text: '' }], showResults: true };
  if (kind === 'slider') return { kind: 'slider', text: '', emoji: '😍', showResults: true };
  return { kind: 'question', text: '' };
}

export function StickerComposer({
  draft,
  onChange,
  disabled,
}: {
  draft: StickerDraft | null;
  onChange: (next: StickerDraft | null) => void;
  disabled?: boolean;
}) {
  const groupId = useId();
  const error = stickerDraftError(draft);
  // Only complain once there is something to complain about: an empty field
  // the member has not reached yet is not a mistake.
  const touched = Boolean(draft && (draft.text.trim() || (draft.kind === 'poll' && draft.options.some((o) => o.text.trim()))));

  return (
    <div>
      <p className="type-label mb-1.5 text-text-2" id={groupId}>
        Add a sticker <span className="font-medium text-text-3">(optional)</span>
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={groupId}>
        {KINDS.map(({ kind, label, Icon }) => {
          const on = draft?.kind === kind;
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(on ? null : emptyStickerDraft(kind))}
              className={cx(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors dur-1',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                on ? 'border-brand bg-brand-soft text-brand-text' : 'border-line text-text-2 hover:bg-surface-2 hover:text-text-1',
              )}
            >
              <Icon size={16} />
              {label}
              {on ? <X size={14} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      {draft ? (
        <div className="mt-3 space-y-3 rounded-md border border-line bg-surface-2 p-3">
          {draft.kind === 'poll' ? (
            <>
              <Input
                label="Question"
                placeholder="Squat or deadlift?"
                maxLength={STICKER_LIMITS.pollText}
                value={draft.text}
                autoComplete="off"
                onChange={(e) => onChange({ ...draft, text: e.target.value })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {draft.options.map((option, i) => (
                  <Input
                    key={i}
                    label={`Option ${i + 1}`}
                    placeholder={i === 0 ? 'Squat' : 'Deadlift'}
                    maxLength={STICKER_LIMITS.pollOption}
                    value={option.text}
                    autoComplete="off"
                    onChange={(e) =>
                      onChange({ ...draft, options: draft.options.map((o, j) => (j === i ? { text: e.target.value } : o)) })
                    }
                  />
                ))}
              </div>
              {draft.options.length < STICKER_LIMITS.pollOptionsMax ? (
                <button
                  type="button"
                  onClick={() => onChange({ ...draft, options: [...draft.options, { text: '' }] })}
                  className="min-h-9 text-sm font-semibold text-brand-text hover:underline"
                >
                  Add another option
                </button>
              ) : null}
              <Switch
                label="Show results to voters"
                checked={draft.showResults !== false}
                onChange={(next) => onChange({ ...draft, showResults: next })}
              />
            </>
          ) : null}

          {draft.kind === 'slider' ? (
            <>
              <Input
                label="Label"
                placeholder="How hard was that?"
                maxLength={STICKER_LIMITS.sliderText}
                value={draft.text}
                autoComplete="off"
                onChange={(e) => onChange({ ...draft, text: e.target.value })}
              />
              <Input
                label="Emoji"
                hint="One emoji rides the slider"
                maxLength={STICKER_LIMITS.sliderEmoji}
                value={draft.emoji || ''}
                autoComplete="off"
                containerClassName="max-w-32"
                onChange={(e) => onChange({ ...draft, emoji: e.target.value })}
              />
              <Switch
                label="Show the average to everyone"
                checked={draft.showResults !== false}
                onChange={(next) => onChange({ ...draft, showResults: next })}
              />
            </>
          ) : null}

          {draft.kind === 'question' ? (
            <Input
              label="Prompt"
              hint="Answers come back as a message"
              placeholder="Ask me anything"
              maxLength={STICKER_LIMITS.questionText}
              value={draft.text}
              autoComplete="off"
              onChange={(e) => onChange({ ...draft, text: e.target.value })}
            />
          ) : null}

          {touched && error ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
