/**
 * Story stickers and highlight membership — the eleven routes the web client
 * had never called (docs/api-contract.md, "Stories v2: stickers, responses,
 * reactions and replies to DM, Crew, archive"; `routes/stories.js`,
 * `services/storyStickers.js`).
 *
 * Stickers are NOT behind a feature flag: `POST /api/story` has accepted
 * `stickers[]` since Wave C and every payload carries `stickers[]` already.
 * A build that never read the field simply drew nothing. So the viewer reads
 * what it is given and the composer writes it; there is no gate to wait for.
 * `isFeatureDisabled` is exported anyway because a deployment older than
 * Wave C answers `404` on the sticker routes, and a viewer must fall silent
 * rather than show an error card over someone's story.
 *
 * What a sticker carries, and who may see what:
 *
 *   viewerResponse   the caller's own footprint, always present for an
 *                    interactive sticker (null until they respond)
 *   results          the aggregate — ONLY for the author, or when the author
 *                    set `showResults` AND this caller has responded. A
 *                    viewer who has not voted never sees the tally, so the
 *                    viewer must branch on `results` being there rather than
 *                    assume a zero.
 *
 * Literal request paths on purpose: scripts/audit-api-contracts.cjs and
 * tests/story-stickers-contract.test.mjs pin each one against
 * contracts/backend-routes.json.
 */
import { api } from './api';
import { apiErrorDetails, parseApiError } from './apiError';

/* ------------------------------------------------------------------ absence */

/**
 * A route the deployment does not run answers `404 { code:
 * 'FEATURE_DISABLED' }`. Stickers have no flag, but an older API has no
 * sticker routes at all; either way the sticker falls back to read-only
 * rather than showing an error over the picture.
 */
export function isFeatureDisabled(e: unknown): boolean {
  const details = apiErrorDetails(e);
  return details.status === 404 && details.code === 'FEATURE_DISABLED';
}

/** Which flag the API named on a FEATURE_DISABLED answer, when it named one. */
export function disabledFeatureOf(e: unknown): string | null {
  if (!isFeatureDisabled(e)) return null;
  const body = parseApiError(e).body as { feature?: unknown } | null;
  return typeof body?.feature === 'string' ? body.feature : null;
}

/**
 * Every code a sticker write can answer with
 * (`controllers/storyController.js`, `services/storyStickers.js`). The API's
 * own sentences are already written for a member ("Choose one of the poll
 * options", "You can send up to 3 answers"), so `stickerErrorCopy` shows
 * them verbatim; this map is the fallback for a refusal that arrived without
 * one, and the list a test can assert against.
 */
export const STICKER_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  OWN_STICKER: 'You can’t respond to your own sticker',
  STORY_ENDED: 'This story has ended',
  STICKER_NOT_FOUND: 'Sticker not found',
  STICKER_NOT_INTERACTIVE: 'This sticker does not take responses',
  STICKER_KIND_MISMATCH: 'That sticker takes a different kind of answer',
  OPTION_INVALID: 'Choose one of the poll options',
  VALUE_INVALID: 'Slide a value between 0 and 100',
  ANSWER_INVALID: 'Write an answer of 1 to 280 characters',
  ANSWER_LIMIT: 'You can send up to 3 answers',
  REMINDER_OFF: 'This countdown does not take reminders',
  JOIN_VIA_STORY: 'Add yours: post your story to join this prompt',
  SHARE_UNSUPPORTED: 'Only question answers can be shared',
  RESPONSE_REQUIRED: 'Choose an answer to share',
});

/** The member-facing line for a sticker write: the server's own sentence first. */
export function stickerErrorCopy(e: unknown, fallback = 'Could not send that.'): string {
  const parsed = parseApiError(e, fallback);
  if (parsed.message && parsed.message !== fallback) return parsed.message;
  return (parsed.code && STICKER_REFUSALS[parsed.code]) || fallback;
}

/** A refusal a retry cannot fix: the sticker is closed to this caller for good. */
export function isStickerClosed(e: unknown): boolean {
  const code = parseApiError(e).code;
  return code === 'OWN_STICKER' || code === 'STORY_ENDED' || code === 'ANSWER_LIMIT' || code === 'STICKER_NOT_INTERACTIVE';
}

/* ------------------------------------------------------------------ shapes */

/** Every sticker kind the API stores. Only the first four take a response. */
export type StickerKind = 'poll' | 'slider' | 'question' | 'countdown' | 'add_yours' | 'mention' | 'gym' | 'text' | 'emoji';

/** The kinds that carry `viewerResponse`, `ended` and (sometimes) `results`. */
export const INTERACTIVE_STICKER_KINDS = ['poll', 'slider', 'question', 'countdown'] as const;
export type InteractiveStickerKind = (typeof INTERACTIVE_STICKER_KINDS)[number];

export const isInteractiveSticker = (kind: string): kind is InteractiveStickerKind =>
  (INTERACTIVE_STICKER_KINDS as readonly string[]).includes(kind);

/** The three kinds the web composer can author (one per story: the API allows one interactive sticker). */
export const COMPOSABLE_STICKER_KINDS = ['poll', 'slider', 'question'] as const;
export type ComposableStickerKind = (typeof COMPOSABLE_STICKER_KINDS)[number];

export type StickerActor = { _id: string; username?: string; fullName?: string; avatar?: string };

/**
 * The aggregate. `optionCounts`/`percentages` ride with a poll, `average`
 * with a slider (null until someone slides). Never present unless the caller
 * may see it.
 */
export type StickerResults = {
  count: number;
  optionCounts?: number[];
  percentages?: number[];
  average?: number | null;
};

/** The caller's own footprint on one sticker (`services/storyStickers.js viewerResponseFor`). */
export type ViewerResponse =
  | { kind: 'vote'; option: number; respondedAt?: string }
  | { kind: 'slide'; value: number; respondedAt?: string }
  | { kind: 'answer'; answered: number; respondedAt?: string }
  | { kind: 'reminder'; reminded: true; respondedAt?: string }
  | { kind: 'joined'; joinedStoryId: string; respondedAt?: string };

/** One sticker as `presentSticker` hands it to a viewer. */
export type StorySticker = {
  _id: string;
  id: string;
  kind: StickerKind;
  /** The sticker's centre on the 9:16 canvas, 0..1. Absent on an older payload. */
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  text?: string;
  options?: Array<{ text: string }>;
  emoji?: string;
  endsAt?: string;
  remindable?: boolean;
  showResults?: boolean;
  user?: StickerActor;
  userId?: string;
  gymId?: string;
  gymName?: string;
  chainId?: string;
  /** The story (or the countdown) is over: the sticker is read-only. */
  ended?: boolean;
  viewerResponse?: ViewerResponse | null;
  results?: StickerResults;
};

/** What every sticker write answers with. */
export type StickerRespondResult = {
  success?: boolean;
  viewerResponse?: ViewerResponse | null;
  results?: StickerResults;
  /** A question answer also becomes a DM; `story_only` when the author refuses messages. */
  delivered?: 'dm' | 'story_only';
  chatRoomId?: string;
  messageId?: string;
  removed?: boolean;
  reminded?: boolean;
};

/* ------------------------------------------------------------------ limits */

/** `POST /api/story` sticker validation, mirrored so the composer refuses before the round trip. */
export const STICKER_LIMITS = Object.freeze({
  pollText: 120,
  pollOption: 40,
  pollOptionsMin: 2,
  pollOptionsMax: 4,
  sliderText: 80,
  sliderEmoji: 16,
  questionText: 120,
  answerText: 280,
  sliderMin: 0,
  sliderMax: 100,
  /** At most five stickers, at most one of them interactive. */
  perStory: 5,
  interactivePerStory: 1,
});

/** The body `POST /api/story` accepts under `stickers[]` for the three kinds the web composes. */
export type StickerDraft =
  | { kind: 'poll'; text: string; options: Array<{ text: string }>; showResults?: boolean; x?: number; y?: number }
  | { kind: 'slider'; text: string; emoji?: string; showResults?: boolean; x?: number; y?: number }
  | { kind: 'question'; text: string; x?: number; y?: number };

/**
 * Whether a draft is complete enough to send, and why not. Returns null when
 * the draft is good; the API's own sentences are reused verbatim so the
 * composer and the server never disagree about the wording.
 */
export function stickerDraftError(draft: StickerDraft | null): string | null {
  if (!draft) return null;
  const text = draft.text.trim();
  if (draft.kind === 'poll') {
    if (!text) return 'Ask something.';
    if (text.length > STICKER_LIMITS.pollText) return `Keep the question to ${STICKER_LIMITS.pollText} characters.`;
    const filled = draft.options.map((o) => o.text.trim()).filter(Boolean);
    if (filled.length < STICKER_LIMITS.pollOptionsMin) return 'Add at least two options.';
    if (filled.some((o) => o.length > STICKER_LIMITS.pollOption)) return `Keep each option to ${STICKER_LIMITS.pollOption} characters.`;
    return null;
  }
  if (draft.kind === 'slider') {
    if (!text) return 'Give the slider a label.';
    if (text.length > STICKER_LIMITS.sliderText) return `Keep the label to ${STICKER_LIMITS.sliderText} characters.`;
    return null;
  }
  if (!text) return 'Ask something.';
  if (text.length > STICKER_LIMITS.questionText) return `Keep the prompt to ${STICKER_LIMITS.questionText} characters.`;
  return null;
}

/** A draft as the API wants it: trimmed, empty options dropped, nothing undefined. */
export function stickerDraftBody(draft: StickerDraft): Record<string, unknown> {
  if (draft.kind === 'poll') {
    return {
      kind: 'poll',
      text: draft.text.trim(),
      options: draft.options.map((o) => ({ text: o.text.trim() })).filter((o) => o.text),
      showResults: draft.showResults === true,
    };
  }
  if (draft.kind === 'slider') {
    const emoji = draft.emoji?.trim();
    return { kind: 'slider', text: draft.text.trim(), ...(emoji ? { emoji } : {}), showResults: draft.showResults === true };
  }
  return { kind: 'question', text: draft.text.trim() };
}

/* ------------------------------------------------------------------ query keys */

export const storyKeys = {
  tray: ['stories', 'tray'] as const,
  archive: ['stories', 'archive'] as const,
  responses: (storyId: string | null) => ['stories', 'responses', storyId] as const,
  stickerResults: (storyId: string, stickerId: string) => ['stories', 'sticker-results', storyId, stickerId] as const,
};

/** Highlights for one member; shared by the profile row, the Stories page and the viewer's picker. */
export const highlightsKey = (userId?: string) => ['stories', 'highlights', userId] as const;

/* ------------------------------------------------------------------ viewer writes */

/** `POST /story/:storyId/stickers/:stickerId/vote { option }` — one vote per viewer; a second option moves it. */
export async function voteOnSticker(storyId: string, stickerId: string, option: number): Promise<StickerRespondResult> {
  const { data } = await api.post<StickerRespondResult>(`/story/${storyId}/stickers/${stickerId}/vote`, { option });
  return data;
}

/** `POST /story/:storyId/stickers/:stickerId/slide { value }` — 0..100, upserted. */
export async function slideSticker(storyId: string, stickerId: string, value: number): Promise<StickerRespondResult> {
  const { data } = await api.post<StickerRespondResult>(`/story/${storyId}/stickers/${stickerId}/slide`, { value });
  return data;
}

/**
 * `POST /story/:storyId/stickers/:stickerId/answer { text }` — up to three
 * per viewer. The answer also becomes a `story_answer` DM to the author
 * (server-side, `services/storyMessages.js`); `delivered` says whether it
 * landed, so the viewer can say "Sent to <author>" honestly.
 */
export async function answerSticker(storyId: string, stickerId: string, text: string): Promise<StickerRespondResult> {
  const { data } = await api.post<StickerRespondResult>(`/story/${storyId}/stickers/${stickerId}/answer`, { text });
  return data;
}

/**
 * `POST|DELETE /story/:storyId/stickers/:stickerId/reminder` — the countdown's
 * "Remind me". The reminder itself is local to the device; the server only
 * counts it for the author.
 */
export async function setStickerReminder(storyId: string, stickerId: string, on: boolean): Promise<StickerRespondResult> {
  if (on) {
    const { data } = await api.post<StickerRespondResult>(`/story/${storyId}/stickers/${stickerId}/reminder`, {});
    return data;
  }
  const { data } = await api.delete<StickerRespondResult>(`/story/${storyId}/stickers/${stickerId}/reminder`);
  return data;
}

/** `DELETE /story/:storyId/stickers/:stickerId/respond` — withdraw a vote or a slide before the story ends. */
export async function withdrawStickerResponse(storyId: string, stickerId: string): Promise<StickerRespondResult> {
  const { data } = await api.delete<StickerRespondResult>(`/story/${storyId}/stickers/${stickerId}/respond`);
  return data;
}

/* ------------------------------------------------------------------ author results */

/** One person's response, as the author's results page lists it. */
export type StickerRespondent = {
  _id: string;
  user?: StickerActor;
  kind: 'vote' | 'slide' | 'answer' | 'reminder' | 'joined';
  option?: number;
  optionText?: string;
  value?: number;
  text?: string;
  joinedStoryId?: string;
  createdAt?: string;
};

export type StickerResultsPage = {
  sticker: StorySticker | null;
  respondents: StickerRespondent[];
  total: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
};

/**
 * `GET /story/:storyId/stickers/:stickerId/results?page&limit` (author only).
 * Respondents who blocked the author are excluded from the query, so `total`
 * and `hasNextPage` are exact; `sticker.results` still counts everyone.
 */
export async function fetchStickerResults(storyId: string, stickerId: string, page = 1, limit = 50): Promise<StickerResultsPage> {
  const { data } = await api.get<{
    sticker?: StorySticker;
    respondents?: StickerRespondent[];
    items?: StickerRespondent[];
    total?: number;
    page?: number;
    limit?: number;
    hasNextPage?: boolean;
  }>(`/story/${storyId}/stickers/${stickerId}/results`, { params: { page, limit } });
  const respondents = data.respondents ?? data.items ?? [];
  return {
    sticker: data.sticker ?? null,
    respondents,
    total: typeof data.total === 'number' ? data.total : respondents.length,
    page: data.page ?? page,
    limit: data.limit ?? limit,
    hasNextPage: data.hasNextPage === true,
  };
}

/**
 * `POST /story/:storyId/stickers/:stickerId/share-results { responseId }` —
 * "share results" is the author POSTING one answer back out as a new text
 * story: the prompt becomes the text and a server-only `results` sticker
 * carries the answer's words. The responder's name and photo never travel.
 * Question stickers only (`400 SHARE_UNSUPPORTED` for the rest).
 */
export async function shareStickerResults(
  storyId: string,
  stickerId: string,
  responseId: string,
  privacy?: string,
): Promise<{ story?: unknown }> {
  const { data } = await api.post<{ story?: unknown }>(`/story/${storyId}/stickers/${stickerId}/share-results`, {
    responseId,
    ...(privacy ? { privacy } : {}),
  });
  return data;
}

/* ------------------------------------------------------------------ highlights */

export type HighlightRow = {
  _id: string;
  title: string;
  description?: string;
  coverImage?: string;
  storyCount?: number;
};

/** `GET /story/highlights/:userId` — the owner's collections, playable by anyone who can see the profile. */
export async function fetchHighlights(userId: string): Promise<HighlightRow[]> {
  const { data } = await api.get<{ highlights?: HighlightRow[] }>(`/story/highlights/${userId}`);
  return data.highlights || [];
}

/** `POST /story/highlights { title, description?, storyIds }` — a new collection, optionally seeded. */
export async function createHighlight(input: { title: string; description?: string; storyIds: string[] }): Promise<{ highlight?: HighlightRow }> {
  const { data } = await api.post<{ highlight?: HighlightRow }>('/story/highlights', {
    title: input.title.trim(),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    storyIds: input.storyIds,
  });
  return data;
}

/** At most this many stories in one highlight (`controllers/storyController.js addStoryToHighlight`). */
export const HIGHLIGHT_MAX_STORIES = 100;

/** `POST /story/highlights/:highlightId/add-story { storyId }` — idempotent; the author's own stories only. */
export async function addStoryToHighlight(highlightId: string, storyId: string): Promise<void> {
  await api.post(`/story/highlights/${highlightId}/add-story`, { storyId });
}

/**
 * `DELETE /story/highlights/:highlightId/stories/:storyId`. Removing the last
 * highlight that retains an expired story returns it to the author-only
 * archive, it does not go live again.
 */
export async function removeStoryFromHighlight(highlightId: string, storyId: string): Promise<void> {
  await api.delete(`/story/highlights/${highlightId}/stories/${storyId}`);
}

/* ------------------------------------------------------------------ reading a sticker */

/** Where a sticker sits, as a percentage, when the payload gave a position. */
export function stickerPosition(sticker: StorySticker): { left: string; top: string } | null {
  const { x, y } = sticker;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { left: `${Math.min(100, Math.max(0, x * 100))}%`, top: `${Math.min(100, Math.max(0, y * 100))}%` };
}

/**
 * The share of the vote for one poll option, 0..100. The API sends
 * `percentages` when it sends results; this recomputes from `optionCounts`
 * for a payload that predates them rather than drawing an empty bar.
 */
export function optionShare(results: StickerResults | undefined, index: number): number {
  if (!results) return 0;
  const direct = results.percentages?.[index];
  if (typeof direct === 'number' && Number.isFinite(direct)) return Math.min(100, Math.max(0, direct));
  const count = results.optionCounts?.[index];
  if (typeof count !== 'number' || !results.count) return 0;
  return Math.round((count / results.count) * 100);
}

/** The viewer's chosen option, or null when they have not voted. */
export function votedOption(sticker: StorySticker): number | null {
  const response = sticker.viewerResponse;
  return response && response.kind === 'vote' ? response.option : null;
}

/** The viewer's slider value, or null. */
export function slidValue(sticker: StorySticker): number | null {
  const response = sticker.viewerResponse;
  return response && response.kind === 'slide' ? response.value : null;
}

/** How many answers the viewer has already sent to a question sticker (max three). */
export function answeredCount(sticker: StorySticker): number {
  const response = sticker.viewerResponse;
  return response && response.kind === 'answer' ? response.answered : 0;
}

/** Whether the viewer has a live reminder on a countdown. */
export function reminderSet(sticker: StorySticker): boolean {
  const response = sticker.viewerResponse;
  return Boolean(response && response.kind === 'reminder' && response.reminded);
}

/**
 * "12 votes" / "1 answer" — the count under a sticker, and only when there
 * is one. A zero is a hole (docs/DESIGN.md, "The zero rule"), so this
 * returns null rather than "0 votes".
 */
export function responseCountLabel(kind: StickerKind, results: StickerResults | undefined): string | null {
  const count = results?.count;
  if (typeof count !== 'number' || count <= 0) return null;
  const noun = kind === 'poll' ? 'vote' : kind === 'question' ? 'answer' : kind === 'countdown' ? 'reminder' : 'response';
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
