/**
 * The stickers a story carries, drawn over its picture.
 *
 * Register (docs/DESIGN.md): a sticker is a white pill with a hairline,
 * whatever the theme — the viewer forces `.dark` but Instagram's stickers
 * are white on every screen, so the surface is pinned to the theme-invariant
 * `--navy-*` primitives the rest of this family already uses for story
 * canvases. The one blue is the viewer's own answer: the chosen poll bar,
 * the slider's filled track, the live reminder. Nothing here is a
 * `.btn-primary`, so the viewer keeps exactly one filled blue (the reply
 * Send button).
 *
 * Placement: the API gives every sticker a normalised centre (`x`, `y`,
 * default 0.5/0.5) on the 9:16 canvas, so a sticker is absolutely placed
 * there. A payload from before stickers had positions has neither, and those
 * stack in a strip at the foot of the stage instead of piling up in the
 * middle.
 *
 * Results: `results` is on the sticker ONLY for the author, or for a viewer
 * who has answered a sticker whose author turned `showResults` on. Every
 * tally below is therefore a branch on `results` being there — never a zero
 * bar drawn from an absent number.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  answeredCount,
  isInteractiveSticker,
  optionShare,
  reminderSet,
  responseCountLabel,
  slidValue,
  stickerPosition,
  votedOption,
  STICKER_LIMITS,
  type StorySticker,
} from '../../lib/stories';
import { Spinner, cx } from '../ui';
import { Bell, Check, Send } from '../icons';

/* ------------------------------------------------------------------ surface */

/**
 * The pill. `--navy-50` / `--navy-800` / `--navy-200` are primitives defined
 * once at `:root` and never overridden by `.dark`, so the card reads the
 * same over a black stage as over a white one.
 */
const CARD_STYLE = {
  background: 'var(--navy-50)',
  color: 'var(--navy-800)',
  borderColor: 'var(--navy-200)',
} as const;

const MUTED_STYLE = { color: 'var(--navy-500)' } as const;

function StickerCard({
  children,
  label,
  className,
  onClick,
  busy,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  onClick?: () => void;
  busy?: boolean;
}) {
  const body = (
    <div
      className={cx('w-full rounded-lg border p-3 text-left shadow-1', className)}
      style={CARD_STYLE}
      aria-busy={busy || undefined}
    >
      {children}
    </div>
  );
  if (!onClick) return body;
  return (
    <button type="button" onClick={onClick} aria-label={label} className="block w-full rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
      {body}
    </button>
  );
}

function Prompt({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-sm font-semibold leading-5 [overflow-wrap:anywhere]">{children}</p>;
}

/** "12 votes" under a sticker, and nothing at all at zero (the zero rule). */
function CountLine({ sticker }: { sticker: StorySticker }) {
  const label = responseCountLabel(sticker.kind, sticker.results);
  if (!label) return null;
  return (
    <p className="tabular mt-2 text-2xs" style={MUTED_STYLE}>
      {label}
    </p>
  );
}

/* ------------------------------------------------------------------ poll */

export function PollSticker({
  sticker,
  disabled,
  busy,
  onVote,
}: {
  sticker: StorySticker;
  disabled?: boolean;
  busy?: boolean;
  onVote: (option: number) => void;
}) {
  const chosen = votedOption(sticker);
  const options = sticker.options || [];
  const results = sticker.results;
  const closed = disabled || sticker.ended === true;

  return (
    <StickerCard busy={busy}>
      <Prompt>{sticker.text}</Prompt>
      <ul className="space-y-1.5" role="group" aria-label={sticker.text || 'Poll'}>
        {options.map((option, i) => {
          const active = chosen === i;
          const share = results ? optionShare(results, i) : 0;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={closed || busy}
                aria-pressed={active}
                onClick={() => onVote(i)}
                className={cx(
                  'relative block min-h-9 w-full overflow-hidden rounded-sm border px-2.5 py-1.5 text-left text-sm transition-colors dur-1',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                  closed && 'cursor-default',
                )}
                style={{ borderColor: active ? 'var(--brand)' : 'var(--navy-200)' }}
              >
                {/* The tally bar: the viewer's own choice is the one blue. */}
                {results ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 transition-[width] dur-2 ease-out"
                    style={{ width: `${share}%`, background: active ? 'var(--brand-soft)' : 'var(--navy-100)' }}
                  />
                ) : null}
                <span className="relative flex items-center justify-between gap-2">
                  <span className={cx('min-w-0 truncate', active && 'font-semibold')} style={active ? { color: 'var(--brand)' } : undefined}>
                    {option.text}
                  </span>
                  {results ? (
                    <span className="tabular shrink-0 text-2xs font-semibold" style={active ? { color: 'var(--brand)' } : MUTED_STYLE}>
                      {share}%
                    </span>
                  ) : active ? (
                    <Check size={14} style={{ color: 'var(--brand)' }} className="shrink-0" />
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <CountLine sticker={sticker} />
    </StickerCard>
  );
}

/* ------------------------------------------------------------------ slider */

/**
 * The emoji slider. The value is committed on release (pointer up or a key
 * that settles), never on every frame of the drag: each commit is a write.
 */
export function SliderSticker({
  sticker,
  disabled,
  busy,
  onSlide,
  onActive,
}: {
  sticker: StorySticker;
  disabled?: boolean;
  busy?: boolean;
  onSlide: (value: number) => void;
  onActive?: (active: boolean) => void;
}) {
  const committed = slidValue(sticker);
  const [value, setValue] = useState(committed ?? 50);
  const id = useId();
  const closed = disabled || sticker.ended === true;

  // A fresh answer from the server (or a different story) wins over the drag.
  useEffect(() => {
    if (committed !== null) setValue(committed);
  }, [committed, sticker._id]);

  const commit = () => {
    onActive?.(false);
    if (closed || busy) return;
    if (committed === value) return;
    onSlide(value);
  };

  const average = sticker.results?.average;

  return (
    <StickerCard busy={busy}>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold leading-5 [overflow-wrap:anywhere]">
        {sticker.text}
      </label>
      <div className="relative">
        <input
          id={id}
          type="range"
          min={STICKER_LIMITS.sliderMin}
          max={STICKER_LIMITS.sliderMax}
          step={1}
          value={value}
          disabled={closed}
          aria-valuetext={`${value} out of 100`}
          onChange={(e) => {
            onActive?.(true);
            setValue(Number(e.target.value));
          }}
          onPointerUp={commit}
          onBlur={commit}
          onKeyUp={(e) => {
            if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') commit();
          }}
          className="h-6 w-full cursor-pointer accent-[var(--brand)]"
        />
        {sticker.emoji ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-1 text-base transition-[left] dur-1"
            style={{ left: `calc(${value}% - 0.5rem)` }}
          >
            {sticker.emoji}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="tabular text-2xs font-semibold" style={{ color: committed === null ? 'var(--navy-500)' : 'var(--brand)' }}>
          {committed === null ? `${value}` : `You: ${committed}`}
        </span>
        {typeof average === 'number' ? (
          <span className="tabular text-2xs" style={MUTED_STYLE}>
            Average {average}
          </span>
        ) : null}
      </div>
      <CountLine sticker={sticker} />
    </StickerCard>
  );
}

/* ------------------------------------------------------------------ question */

/**
 * The question box. An answer also becomes a DM to the author server-side,
 * so the confirmation says where it went. Three answers per viewer is the
 * API's limit; the box closes on the third rather than letting the send
 * fail.
 */
export function QuestionSticker({
  sticker,
  disabled,
  busy,
  onAnswer,
  onActive,
  sent,
}: {
  sticker: StorySticker;
  disabled?: boolean;
  busy?: boolean;
  onAnswer: (text: string) => void;
  onActive?: (active: boolean) => void;
  /** Set once an answer landed, so the card can say so without a refetch. */
  sent?: boolean;
}) {
  const [text, setText] = useState('');
  const answered = answeredCount(sticker);
  const spent = answered >= 3;
  const closed = disabled || sticker.ended === true || spent;
  const id = useId();

  return (
    <StickerCard busy={busy}>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold leading-5 [overflow-wrap:anywhere]">
        {sticker.text}
      </label>
      {closed ? (
        <p className="text-sm" style={MUTED_STYLE}>
          {spent ? 'You’ve sent all three answers.' : 'This story has ended.'}
        </p>
      ) : (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const value = text.trim();
            if (!value || busy) return;
            onAnswer(value);
            setText('');
          }}
        >
          <input
            id={id}
            type="text"
            value={text}
            maxLength={STICKER_LIMITS.answerText}
            autoComplete="off"
            enterKeyHint="send"
            placeholder="Type something…"
            onFocus={() => onActive?.(true)}
            onBlur={() => onActive?.(false)}
            onChange={(e) => setText(e.target.value)}
            className="min-h-9 min-w-0 flex-1 rounded-sm border bg-transparent px-2.5 text-sm outline-none placeholder:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            style={{ borderColor: 'var(--navy-200)', color: 'var(--navy-800)' }}
          />
          <button
            type="submit"
            disabled={!text.trim() || busy}
            aria-label="Send answer"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-sm transition-opacity dur-1 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            style={{ color: 'var(--brand)' }}
          >
            {busy ? <Spinner size={16} /> : <Send size={18} />}
          </button>
        </form>
      )}
      {answered > 0 || sent ? (
        <p className="mt-2 text-2xs font-semibold" style={{ color: 'var(--brand)' }}>
          {answered > 1 ? `${answered} answers sent` : 'Answer sent'}
        </p>
      ) : null}
      <CountLine sticker={sticker} />
    </StickerCard>
  );
}

/* ------------------------------------------------------------------ countdown */

const timeLeft = (endsAt?: string): string | null => {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
};

export function CountdownSticker({
  sticker,
  disabled,
  busy,
  onRemind,
}: {
  sticker: StorySticker;
  disabled?: boolean;
  busy?: boolean;
  onRemind: (on: boolean) => void;
}) {
  const on = reminderSet(sticker);
  const left = timeLeft(sticker.endsAt);
  const closed = disabled || sticker.ended === true || !left;

  return (
    <StickerCard busy={busy}>
      <Prompt>{sticker.text}</Prompt>
      <p className="tabular text-2xs" style={MUTED_STYLE}>
        {left ?? 'Ended'}
      </p>
      {sticker.remindable !== false && !closed ? (
        <button
          type="button"
          disabled={busy}
          aria-pressed={on}
          onClick={() => onRemind(!on)}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-2.5 text-sm font-semibold transition-colors dur-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          style={on ? { borderColor: 'var(--brand)', color: 'var(--brand)' } : { borderColor: 'var(--navy-200)' }}
        >
          <Bell size={16} filled={on} />
          {on ? 'Reminder on' : 'Remind me'}
        </button>
      ) : null}
      <CountLine sticker={sticker} />
    </StickerCard>
  );
}

/* ------------------------------------------------------------------ the quiet kinds */

/** Mention, gym, text, emoji and Add yours: a label the mobile app placed; the web only renders it. */
export function StaticSticker({ sticker }: { sticker: StorySticker }) {
  const label =
    sticker.kind === 'mention'
      ? `@${sticker.user?.username || 'someone'}`
      : sticker.kind === 'gym'
        ? sticker.gymName || 'Gym'
        : sticker.kind === 'emoji'
          ? sticker.emoji || ''
          : sticker.text || '';
  if (!label) return null;
  return (
    <span
      className="inline-block rounded-sm border px-2.5 py-1 text-sm font-semibold shadow-1"
      style={CARD_STYLE}
    >
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ the layer */

export type StickerAction =
  | { kind: 'vote'; sticker: StorySticker; option: number }
  | { kind: 'slide'; sticker: StorySticker; value: number }
  | { kind: 'answer'; sticker: StorySticker; text: string }
  | { kind: 'reminder'; sticker: StorySticker; on: boolean };

/**
 * Every sticker on one story. The author cannot respond to their own
 * (`400 OWN_STICKER`), so for them a sticker is a button that opens the
 * results sheet instead.
 *
 * The layer sits above the viewer's prev/next tap zones and swallows the
 * events that would otherwise page the story or pause it under a finger.
 */
export function StickerLayer({
  stickers,
  mine,
  pendingId,
  answeredIds,
  onAction,
  onOpenResults,
  onActive,
}: {
  stickers: StorySticker[];
  mine: boolean;
  /** The sticker with a write in flight. */
  pendingId?: string | null;
  /** Stickers this session already answered, for the confirmation line. */
  answeredIds?: ReadonlySet<string>;
  onAction: (action: StickerAction) => void;
  onOpenResults: (sticker: StorySticker) => void;
  /** True while a field is focused or a slider dragged: the story must hold. */
  onActive?: (active: boolean) => void;
}) {
  const list = stickers || [];
  if (!list.length) return null;
  const positioned = list.filter((s) => stickerPosition(s) !== null);
  const stacked = list.filter((s) => stickerPosition(s) === null);

  const render = (sticker: StorySticker) => {
    const busy = pendingId === sticker._id;
    if (!isInteractiveSticker(sticker.kind)) return <StaticSticker sticker={sticker} />;
    if (mine) {
      // The author's own sticker is a way into the results, never a vote.
      return (
        <StickerCard
          onClick={() => onOpenResults(sticker)}
          label={`See ${sticker.kind === 'poll' ? 'poll' : sticker.kind === 'question' ? 'question' : sticker.kind === 'slider' ? 'slider' : 'countdown'} results`}
        >
          <Prompt>{sticker.text}</Prompt>
          <p className="text-2xs font-semibold" style={{ color: 'var(--brand)' }}>
            {responseCountLabel(sticker.kind, sticker.results) ?? 'See results'}
          </p>
        </StickerCard>
      );
    }
    switch (sticker.kind) {
      case 'poll':
        return <PollSticker sticker={sticker} busy={busy} onVote={(option) => onAction({ kind: 'vote', sticker, option })} />;
      case 'slider':
        return <SliderSticker sticker={sticker} busy={busy} onActive={onActive} onSlide={(value) => onAction({ kind: 'slide', sticker, value })} />;
      case 'question':
        return (
          <QuestionSticker
            sticker={sticker}
            busy={busy}
            sent={answeredIds?.has(sticker._id)}
            onActive={onActive}
            onAnswer={(text) => onAction({ kind: 'answer', sticker, text })}
          />
        );
      default:
        return <CountdownSticker sticker={sticker} busy={busy} onRemind={(on) => onAction({ kind: 'reminder', sticker, on })} />;
    }
  };

  return (
    <div
      className="pointer-events-none absolute inset-0"
      data-sticker-layer=""
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {positioned.map((sticker) => {
        const at = stickerPosition(sticker)!;
        return (
          <div
            key={sticker._id}
            className="pointer-events-auto absolute w-[min(17rem,78%)] -translate-x-1/2 -translate-y-1/2"
            style={{ left: at.left, top: at.top }}
          >
            {render(sticker)}
          </div>
        );
      })}
      {stacked.length ? (
        <div className="pointer-events-auto absolute inset-x-4 bottom-4 space-y-2">
          {stacked.map((sticker) => (
            <div key={sticker._id}>{render(sticker)}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Whether a story has anything for the layer to draw. */
export function hasStickers(stickers?: StorySticker[] | null): boolean {
  return Array.isArray(stickers) && stickers.length > 0;
}

/** Ref-free helper the viewer uses to know a tap landed on a sticker. */
export function isStickerTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.('[data-sticker-layer]'));
}

/** Kept so a future placement UI can share the grid; the composer places at the lower third. */
export const DEFAULT_STICKER_PLACEMENT = { x: 0.5, y: 0.72 } as const;
