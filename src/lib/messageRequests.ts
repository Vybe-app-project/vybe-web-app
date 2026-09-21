/**
 * Message requests — the Instagram "Requests" fold above the inbox
 * (docs/api-contract.md, "Messaging v2: requests, unsend and edit, voice
 * notes, shared-object cards, presence and receipts, Training Mode";
 * `routes/messageRequests.js`, `controllers/messageRequestsController.js`).
 *
 * Flag `messageRequests`, `false` on every deployment today. A gated route
 * answers `404 { message, code: 'FEATURE_DISABLED', feature }`, so the page
 * gates on the flag AND treats that 404 as "there is no Requests row here",
 * never as an error: the flag is read from a cached capabilities query that
 * can be a few minutes stale, and the honest answer to a stale `true` is to
 * fall silent.
 *
 * What a request is, server-side: a chat room whose recipient row is
 * `pending`. The room is absent from the recipient's inbox
 * (`GET /messages/me/all/recent/rooms` filters `participantStatus.status:
 * 'pending'`) and from every unread count, so nothing in the existing
 * Messages page changes while the flag is off. The SENDER keeps seeing the
 * room in their own list — that asymmetry is the point: a Delete never
 * tells them.
 *
 * There are three actions and no "hide": `accept`, `delete` (the Decline
 * button; recipient-only, silent) and `block`. "Hidden requests" is not an
 * action either — it is the recipient's own hidden-words list having matched
 * the request text at send time (`requestContext.hidden`, `select: false`),
 * surfaced as a separate page of the same route.
 *
 * Literal request paths on purpose: scripts/audit-api-contracts.cjs and
 * tests/message-requests-contract.test.mjs pin each one against
 * contracts/backend-routes.json.
 */
import { api } from './api';
import { apiErrorDetails, parseApiError } from './apiError';

/** The one flag gating every route in this module. */
export const MESSAGE_REQUESTS_FLAG = 'messageRequests';

/* ------------------------------------------------------------------ absence */

/** `404 { code: 'FEATURE_DISABLED' }`: the flag is off for this caller. Hide the surface. */
export function isFeatureDisabled(e: unknown): boolean {
  const details = apiErrorDetails(e);
  return details.status === 404 && details.code === 'FEATURE_DISABLED';
}

/** Which flag the API named, when it named one (the requests router always does). */
export function disabledFeatureOf(e: unknown): string | null {
  if (!isFeatureDisabled(e)) return null;
  const body = parseApiError(e).body as { feature?: unknown } | null;
  return typeof body?.feature === 'string' ? body.feature : null;
}

/**
 * The refusals the three actions can answer with, worded for the recipient.
 * `REQUEST_NOT_PENDING` is the common one: the request was answered on
 * another device, so the row is simply gone rather than broken.
 */
export const REQUEST_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  ROOM_UNAVAILABLE: 'That request is no longer there.',
  NOT_RECIPIENT: 'Only the person who received this request can act on it.',
  REQUEST_NOT_PENDING: 'This request was already answered.',
  CHAT_BLOCKED: 'You can’t message this person.',
});

/** True when the row should just disappear rather than show an error. */
export function isRequestGone(e: unknown): boolean {
  const code = parseApiError(e).code;
  return code === 'ROOM_UNAVAILABLE' || code === 'REQUEST_NOT_PENDING';
}

export function requestErrorCopy(e: unknown, fallback = 'Could not do that.'): string {
  const parsed = parseApiError(e, fallback);
  return (parsed.code && REQUEST_REFUSALS[parsed.code]) || parsed.message || fallback;
}

/* ------------------------------------------------------------------ shapes */

export type RequestActor = { _id: string; username?: string; fullName?: string; avatar?: string };

/**
 * Why this stranger may write: a shared gym, a shared challenge, friends in
 * common, a conversation both sides deleted, a restriction, or nothing at
 * all. The server computes `label` ("3 mutual friends", "Iron Works", "You’ve
 * talked before", "Not connected"), so the row never has to guess.
 */
export type RequestContextKind = 'same_gym' | 'same_challenge' | 'mutual' | 'prior_conversation' | 'restricted' | 'open';

export type RequestContext = {
  kind: RequestContextKind;
  label?: string;
  communityId?: string;
  communityName?: string;
  challengeId?: string;
  challengeTitle?: string;
  mutualCount?: number;
};

/** The room as the requests list carries it: the ordinary room envelope, `me.status === 'pending'`. */
export type RequestRoom = {
  _id: string;
  isGroup?: boolean;
  participants?: RequestActor[];
  me?: { status?: string };
  requestContext?: { state?: string; createdAt?: string; expiresAt?: string };
  [k: string]: unknown;
};

export type MessageRequest = {
  room: RequestRoom;
  /** The single message the recipient may see — a preview, not a thread. */
  message: { _id: string; text?: string; createdAt?: string; sender?: RequestActor } | null;
  context: RequestContext;
  receivedAt?: string;
  expiresAt?: string;
  /** The recipient's hidden-words list matched this text. The sender is never told. */
  hidden: boolean;
};

export type MessageRequestsPage = {
  requests: MessageRequest[];
  /** Visible (unfiltered) pending requests, across every page. */
  total: number;
  /** Requests the word filter folded away, across every page. */
  hiddenTotal: number;
  page: number;
  hasNextPage: boolean;
  /** False for a minor, or a member who turned requests off: the surface is absent. */
  allowRequests: boolean;
};

/** `GET /messages/requests` paging (`REQUESTS_PAGE_DEFAULT`, `REQUESTS_PAGE_MAX`). */
export const REQUESTS_PAGE_SIZE = 20;
export const REQUESTS_PAGE_MAX = 50;

/** What a page looks like before the server has answered; also the shape a disabled flag resolves to. */
export const EMPTY_REQUESTS: MessageRequestsPage = Object.freeze({
  requests: [],
  total: 0,
  hiddenTotal: 0,
  page: 1,
  hasNextPage: false,
  allowRequests: false,
});

/* ------------------------------------------------------------------ query keys */

export const messageRequestKeys = {
  all: ['messageRequests'] as const,
  list: (hidden: boolean, page: number) => ['messageRequests', hidden ? 'hidden' : 'visible', page] as const,
};

/* ------------------------------------------------------------------ reads */

/**
 * `GET /messages/requests?page&limit&hidden` — newest first, offset paged.
 * `total` and `hiddenTotal` are full counts, not this page's length, so
 * "Requests (N)" is right on page one. Resolves to `EMPTY_REQUESTS` when
 * the flag is off for the caller rather than throwing: a Requests row that
 * flickers into an error card is worse than no row.
 */
export async function fetchMessageRequests(
  { hidden = false, page = 1, limit = REQUESTS_PAGE_SIZE }: { hidden?: boolean; page?: number; limit?: number } = {},
): Promise<MessageRequestsPage> {
  try {
    const { data } = await api.get<Partial<MessageRequestsPage>>('/messages/requests', {
      params: { page, limit, hidden: hidden ? 1 : 0 },
    });
    return {
      requests: data.requests || [],
      total: typeof data.total === 'number' ? data.total : 0,
      hiddenTotal: typeof data.hiddenTotal === 'number' ? data.hiddenTotal : 0,
      page: typeof data.page === 'number' ? data.page : page,
      hasNextPage: data.hasNextPage === true,
      allowRequests: data.allowRequests !== false,
    };
  } catch (e) {
    if (isFeatureDisabled(e)) return EMPTY_REQUESTS;
    throw e;
  }
}

/* ------------------------------------------------------------------ writes */

/**
 * `POST /messages/requests/:roomId/accept` — the row turns active, the two
 * accounts become friends (D-85 (a)), a system line lands in the thread and
 * the sender's sockets get `requestAccepted`. The room appears in the inbox
 * from here, so the caller must invalidate `['chatRooms']`.
 */
export async function acceptMessageRequest(roomId: string): Promise<{ room?: RequestRoom; delivery?: string }> {
  const { data } = await api.post<{ room?: RequestRoom; delivery?: string }>(`/messages/requests/${roomId}/accept`, {});
  return data;
}

/**
 * `POST /messages/requests/:roomId/delete` — Decline. Recipient-only and
 * silent: the sender's room stays and their next send still answers `409
 * REQUEST_PENDING` until the request expires, so a Delete leaks nothing.
 */
export async function declineMessageRequest(roomId: string): Promise<{ deleted?: boolean }> {
  const { data } = await api.post<{ deleted?: boolean }>(`/messages/requests/${roomId}/delete`, {});
  return data;
}

/** `POST /messages/requests/:roomId/block` — decline and block the sender. */
export async function blockMessageRequest(roomId: string): Promise<{ blocked?: boolean; userId?: string }> {
  const { data } = await api.post<{ blocked?: boolean; userId?: string }>(`/messages/requests/${roomId}/block`, {});
  return data;
}

/* ------------------------------------------------------------------ reading a room */

/**
 * Whether the thread on screen is a request waiting on the viewer. There is
 * no `isRequest` field: the truth is the viewer's own participant row
 * (`me.status === 'pending'`), with `requestContext.state` as the fallback
 * for a payload that did not carry `me`.
 */
export function isPendingRequestRoom(room: { me?: { status?: string }; requestContext?: { state?: string } } | null | undefined): boolean {
  if (!room) return false;
  if (room.me?.status === 'pending') return true;
  return room.requestContext?.state === 'pending';
}

/** The other person in a request, for the row's name and profile link. */
export function requestSender(request: MessageRequest, meId?: string): RequestActor | undefined {
  return request.message?.sender || (request.room.participants || []).find((p) => p._id !== meId);
}

/**
 * "Requests" / "Requests (3)". Never a numeric badge per row (Instagram
 * shows one count on the fold and nothing beside each thread), and never a
 * zero: with nothing pending the row reads plain.
 */
export function requestsRowLabel(total: number): string {
  return total > 0 ? `Requests (${total})` : 'Requests';
}

/** "3 hidden requests" under the fold, or null when there are none. */
export function hiddenRequestsLabel(hiddenTotal: number): string | null {
  if (!Number.isFinite(hiddenTotal) || hiddenTotal <= 0) return null;
  return `${hiddenTotal} hidden ${hiddenTotal === 1 ? 'request' : 'requests'}`;
}

/** The context line under a request: the server's own label, else the kind in words. */
export function contextLabel(context: RequestContext | undefined): string | null {
  if (!context) return null;
  if (context.label) return context.label;
  switch (context.kind) {
    case 'same_gym':
      return context.communityName || 'Same gym';
    case 'same_challenge':
      return context.challengeTitle || 'Same challenge';
    case 'mutual':
      return typeof context.mutualCount === 'number' && context.mutualCount > 0
        ? `${context.mutualCount} mutual ${context.mutualCount === 1 ? 'friend' : 'friends'}`
        : 'Mutual friends';
    case 'prior_conversation':
      return 'You’ve talked before';
    case 'restricted':
      return 'Restricted';
    case 'open':
      return 'Not connected';
    default:
      return null;
  }
}
