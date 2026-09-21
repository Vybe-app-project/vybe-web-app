/**
 * Shared object cards and link previews in a chat
 * (docs/api-contract.md, "Messaging v2 … shared-object cards" and
 * "Link previews (`linkUnfurl`)"; `services/sharedObjectPresenter.js`,
 * `services/linkUnfurl.js`).
 *
 * Two flags, both `false` on every deployment today:
 *
 *   sharedObjectCards   `POST /messages/send { attachment: { type, id } }`
 *                       and `GET /messages/:id/attachment`. With the flag
 *                       off the send answers `404 FEATURE_DISABLED`, and an
 *                       already-stored card arrives BARE (`{ type, id }`
 *                       with no envelope) — so the renderer must treat a
 *                       missing `preview` as "no card", not as a blank one.
 *   linkUnfurl          the server-built `linkPreview` block on a message.
 *                       Nothing is ever fetched client-side: the sender's
 *                       save enqueues a worker job behind an SSRF guard and
 *                       the result arrives on the socket event
 *                       `messageLinkPreview`.
 *
 * The card is NOT denormalised: the server stores `{ type, id }` and
 * recomputes the envelope for the reader on every read, so `access` can
 * drop from `full` to `preview` to `gone` between two loads of the same
 * thread. The renderer branches on `access` every time.
 *
 * Literal request paths on purpose: scripts/audit-api-contracts.cjs and
 * tests/shared-cards-contract.test.mjs pin each one against
 * contracts/backend-routes.json.
 */
import { api } from './api';
import { apiErrorDetails, parseApiError } from './apiError';

export const SHARED_OBJECT_CARDS_FLAG = 'sharedObjectCards';
export const LINK_UNFURL_FLAG = 'linkUnfurl';

/* ------------------------------------------------------------------ absence */

/**
 * `404 { code: 'FEATURE_DISABLED' }`. The two families answer with different
 * bodies — the messaging router names the flag (`feature`), the
 * link-preview router does not — so the code is the only thing to read.
 */
export function isFeatureDisabled(e: unknown): boolean {
  const details = apiErrorDetails(e);
  return details.status === 404 && details.code === 'FEATURE_DISABLED';
}

export function disabledFeatureOf(e: unknown): string | null {
  if (!isFeatureDisabled(e)) return null;
  const body = parseApiError(e).body as { feature?: unknown } | null;
  return typeof body?.feature === 'string' ? body.feature : null;
}

/** Refusals `POST /messages/send` can answer when the body carries an attachment. */
export const ATTACHMENT_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  ATTACHMENT_INVALID: 'That isn’t something you can share here.',
  ATTACHMENT_NOT_FOUND: 'That item isn’t available to share.',
  ATTACHMENT_NOT_VISIBLE: 'You can’t see that item, so you can’t share it.',
  REQUEST_TEXT_ONLY: 'Requests are text only until accepted.',
  FORWARD_UNSUPPORTED: 'Forward text and photos only',
});

export function attachmentErrorCopy(e: unknown, fallback = 'Could not share that.'): string {
  const parsed = parseApiError(e, fallback);
  return parsed.message || (parsed.code && ATTACHMENT_REFUSALS[parsed.code]) || fallback;
}

/* ------------------------------------------------------------------ the card */

/**
 * The eight kinds `models/extensions/message/attachment.js ATTACHMENT_TYPES`
 * accepts. There is no `meal`: a meal can only reach a chat as a post or a
 * plain link today.
 */
export const ATTACHMENT_TYPES = ['post', 'workout', 'routine', 'recap', 'session', 'event', 'challenge', 'gym'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export const isAttachmentType = (value: unknown): value is AttachmentType =>
  typeof value === 'string' && (ATTACHMENT_TYPES as readonly string[]).includes(value);

/**
 * The three kinds the web composer can pick from the member's own things.
 * `workout` is a logged session (`WorkoutLog`, from `GET /workouts/logs`),
 * `routine` is a saved workout (`SocialWorkout`, from `GET /workouts/my`) —
 * the two are different collections behind two different words, which is
 * exactly the trap to avoid when wiring the picker.
 */
export const SHAREABLE_FROM_WEB = ['workout', 'routine', 'recap'] as const;
export type ShareableType = (typeof SHAREABLE_FROM_WEB)[number];

/** The word for a kind, for the card's label and the "gone" state. */
export const ATTACHMENT_WORD: Readonly<Record<AttachmentType, string>> = Object.freeze({
  post: 'Post',
  workout: 'Workout',
  routine: 'Routine',
  recap: 'Recap',
  session: 'Session',
  event: 'Event',
  challenge: 'Challenge',
  gym: 'Gym',
});

/** One of the "two facts" under a card title. */
export type AttachmentChip = { label: string; value: string };

/**
 * What the presenter hands the reader. `access` is recomputed per read:
 *   full     the viewer may open the object; `detail` rides along
 *   preview  the viewer saw the card but may not open the object — what was
 *            seen is not retracted, so the title and chips stay
 *   gone      the object was deleted; only the type word survives
 */
export type SharedAttachment = {
  type: AttachmentType;
  id: string;
  deepLink?: { app?: string; web?: string | null };
  access?: 'full' | 'preview' | 'gone';
  preview?: { title?: string; subtitle?: string; thumbKey?: string; chips?: AttachmentChip[] };
  detail?: Record<string, unknown>;
  /** True when this room holds the D-88 grant for an otherwise Only-me object. */
  sharedWith?: boolean;
};

/** A stored row with no envelope: the flag is off for this reader. */
export const isBareAttachment = (a: SharedAttachment | null | undefined): boolean =>
  Boolean(a && a.type && a.id && !a.preview && !a.access);

/**
 * Where a card taps through to inside the web app, or null when this build
 * has no page for it. The five that land somewhere are a post, a public
 * routine, a recap, a gym community and a together session; a workout log,
 * a gym event and a single challenge have no standalone web route (the
 * challenge hub is a list), so their cards read without a tap rather than
 * pointing at a 404. Returns an in-app path, not the server's absolute
 * `deepLink.web`, so the card is a client-side `<Link>` and the thread
 * stays mounted.
 */
export function attachmentHref(attachment: SharedAttachment): string | null {
  if (!attachment?.id || attachment.access === 'gone') return null;
  switch (attachment.type) {
    case 'post':
      return `/p/${attachment.id}`;
    // Only a public routine has a page; `deepLink.web` is the server saying so.
    case 'routine':
      return attachment.deepLink?.web ? `/r/${attachment.id}` : null;
    case 'recap':
      return `/recaps/${attachment.id}`;
    // `gym` carries a GymCommunity id (`services/sharedObjectPresenter.js`), not a place id.
    case 'gym':
      return `/communities/${attachment.id}`;
    case 'session':
      return `/session/${attachment.id}`;
    default:
      return null;
  }
}

/** The card's heading: the presenter's title, else the type word. Never blank. */
export function attachmentTitle(attachment: SharedAttachment): string {
  const title = attachment.preview?.title?.trim();
  if (title) return title;
  return ATTACHMENT_WORD[attachment.type] || 'Shared';
}

/**
 * The two facts under the title. The presenter sends up to three chips; the
 * card shows two, because a third wraps the row on a 390 px phone. A chip
 * with no value is dropped rather than drawn as an empty cell.
 */
export function attachmentFacts(attachment: SharedAttachment, max = 2): string[] {
  const chips = attachment.preview?.chips || [];
  return chips
    .map((chip) => chip?.value?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, max);
}

/** `GET /messages/:messageId/attachment` — the envelope alone, re-presented for the caller. */
export async function fetchMessageAttachment(messageId: string): Promise<SharedAttachment | null> {
  try {
    const { data } = await api.get<{ attachment?: SharedAttachment }>(`/messages/${messageId}/attachment`);
    return data.attachment || null;
  } catch (e) {
    if (isFeatureDisabled(e)) return null;
    throw e;
  }
}

/** The body `POST /messages/send` takes for a card. Nothing else may ride with it. */
export function attachmentBody(type: AttachmentType, id: string): { attachment: { type: AttachmentType; id: string } } {
  return { attachment: { type, id: String(id) } };
}

/* ------------------------------------------------------------------ the picker */

/** One row in the "share a thing" picker, whatever kind it came from. */
export type ShareCandidate = {
  type: ShareableType;
  id: string;
  title: string;
  /** One line of context: a date, an exercise count, a period. Never a metric. */
  subtitle?: string;
};

export const SHARE_TAB_LABEL: Readonly<Record<ShareableType, string>> = Object.freeze({
  workout: 'Sessions',
  routine: 'Routines',
  recap: 'Recaps',
});

/* ------------------------------------------------------------------ link previews */

/**
 * `status` says what the server did, and every one of them is a different
 * thing to draw:
 *   pending  queued; the card arrives on `messageLinkPreview`
 *   ok       a real preview
 *   none     nothing worth showing
 *   blocked  the room is a request, or the sender is restricted — a
 *            participant may ask for it with `showLinkPreview`
 *   error    refused address, timeout, oversize, not HTML. Never retried
 *   removed  the sender took it down
 *   skipped  the sender's hourly budget was spent
 *   vybe     a vybeapp.fit link; the card family renders it, not this
 */
export type LinkPreviewStatus = 'pending' | 'ok' | 'none' | 'blocked' | 'error' | 'removed' | 'skipped' | 'vybe';

/**
 * The block the server puts on a message. There is NO image in this wave
 * (D-117): `imageKey` is reserved on the model and `presentLinkPreview`
 * never emits it, so the card is text-only and reserves no media box.
 */
export type LinkPreview = {
  status: LinkPreviewStatus;
  url?: string;
  canonicalUrl?: string;
  siteName?: string;
  title?: string;
  description?: string;
  fetchedAt?: string;
  removedBySender?: boolean;
};

/** Only an `ok` preview with something to say is worth a card. */
export function hasLinkPreview(preview: LinkPreview | null | undefined): preview is LinkPreview {
  if (!preview || preview.status !== 'ok') return false;
  return Boolean(preview.title?.trim() || preview.description?.trim() || preview.siteName?.trim());
}

/** The host under the title: the site's own name, else the URL's host, else null. */
export function linkPreviewHost(preview: LinkPreview | null | undefined): string | null {
  const site = preview?.siteName?.trim();
  if (site) return site;
  const raw = preview?.canonicalUrl || preview?.url;
  if (!raw) return null;
  try {
    return new URL(raw).host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** `DELETE /messages/:messageId/link-preview` — sender only, idempotent. */
export async function removeLinkPreview(messageId: string): Promise<LinkPreview | null> {
  const { data } = await api.delete<{ linkPreview?: LinkPreview }>(`/messages/${messageId}/link-preview`);
  return data.linkPreview || null;
}

/**
 * `POST /messages/:messageId/link-preview/show` — any participant may ask
 * for a `blocked` preview. Answers `202 { status: 'pending' }`; the preview
 * itself arrives on the socket, never from a poll.
 */
export async function showLinkPreview(messageId: string): Promise<{ status?: string }> {
  const { data } = await api.post<{ status?: string }>(`/messages/${messageId}/link-preview/show`, {});
  return data;
}

/** The Socket.IO event that delivers a finished preview to every participant. */
export const LINK_PREVIEW_EVENT = 'messageLinkPreview';

export type LinkPreviewEvent = { messageId?: string; roomId?: string; linkPreview?: LinkPreview };

/**
 * Fold a `messageLinkPreview` payload into a list of messages. Returns the
 * same array when nothing matched, so a cache write and a render are both
 * skipped for an event about another thread.
 */
export function applyLinkPreview<T extends { _id: string; linkPreview?: LinkPreview | null }>(
  messages: readonly T[],
  event: LinkPreviewEvent,
): T[] {
  const id = event?.messageId ? String(event.messageId) : '';
  if (!id || !event.linkPreview) return messages as T[];
  let changed = false;
  const next = messages.map((m) => {
    if (m._id !== id) return m;
    changed = true;
    return { ...m, linkPreview: event.linkPreview as LinkPreview };
  });
  return changed ? next : (messages as T[]);
}
