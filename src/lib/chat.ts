/**
 * Pure messaging logic shared by the Messages page and its tests.
 *
 * Nothing here touches React or the network, so `node --test` can load it
 * through tests/ts-loader.mjs and pin the behaviours the thread depends on:
 * ascending order regardless of what the API returns, realtime merges that
 * never duplicate or reorder, read receipts applied from a socket payload,
 * and the typing indicator's bookkeeping.
 */

export type ChatUserLike = { _id: string; username?: string; fullName?: string; avatar?: string };

export type ChatMessageLike = {
  _id: string;
  createdAt?: string;
  sender?: ChatUserLike | string;
  chatRoom?: string | { _id: string };
  targetId?: string;
  readers?: string[];
};

export const idOf = (v: unknown): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const o = v as { _id?: string };
  return o._id ? String(o._id) : '';
};

export const roomIdOfMessage = (m: ChatMessageLike): string => idOf(m.chatRoom) || m.targetId || '';

const timeOf = (iso?: string): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Oldest first, newest last: the order a chat is read in. GET
 * /messages/conversation returns NEWEST first (the mobile list is inverted),
 * so the web must sort itself; rendering the array as-is put yesterday's
 * message at the bottom of the viewport and every new one out of sight.
 * Stable for equal timestamps, then by id so two clients agree.
 */
export function sortMessagesAscending<T extends ChatMessageLike>(messages: readonly T[]): T[] {
  return messages
    .map((m, index) => ({ m, index }))
    .sort((a, b) => timeOf(a.m.createdAt) - timeOf(b.m.createdAt) || a.m._id.localeCompare(b.m._id) || a.index - b.index)
    .map(({ m }) => m);
}

/**
 * One timeline from every source the thread has: the history held so far
 * (older pages plus every newest page seen), the current newest page, and
 * realtime deliveries for this room. Later copies of the same id win (they
 * carry fresher `readers`), deleted ids are dropped, and the result is sorted
 * so day dividers and grouping stay right no matter which source a message
 * arrived from.
 *
 * Without a `roomId` (a draft thread that has no room yet) realtime
 * deliveries are ignored entirely: the page-level buffer holds every socket
 * message since the Messages page mounted, and none of them can belong to a
 * conversation that does not exist.
 */
export function mergeThread<T extends ChatMessageLike>({
  earlier = [],
  latest = [],
  incoming = [],
  deletedIds,
  roomId,
}: {
  earlier?: readonly T[];
  latest?: readonly T[];
  incoming?: readonly T[];
  deletedIds?: ReadonlySet<string>;
  roomId?: string | null;
}): T[] {
  const byId = new Map<string, T>();
  for (const m of earlier) byId.set(m._id, m);
  for (const m of latest) byId.set(m._id, m);
  if (roomId) {
    for (const m of incoming) {
      if (roomIdOfMessage(m) !== roomId) continue;
      // A realtime copy never replaces a fetched one: the fetched copy is
      // populated (sender, sharedPost) and carries read state.
      if (!byId.has(m._id)) byId.set(m._id, m);
    }
  }
  const out: T[] = [];
  for (const m of byId.values()) if (!deletedIds?.has(m._id)) out.push(m);
  return sortMessagesAscending(out);
}

/* ------------------------------------------------------------------ pages */

/** One page of GET /messages/conversation?limit= as the thread holds it: oldest first. */
export type ThreadPage<T extends ChatMessageLike = ChatMessageLike> = {
  messages: T[];
  hasMore: boolean;
  /** Cursor for the page before this one: the oldest message's createdAt and id. */
  nextBefore: string | null;
  nextBeforeId: string | null;
};

/**
 * Everything fetched for one thread so far: the older pages loaded on
 * scroll-up plus every newest page seen. `hasMore` and the cursor describe
 * what lies beyond the oldest message held.
 */
export type ThreadHistory<T extends ChatMessageLike = ChatMessageLike> = ThreadPage<T>;

export const EMPTY_HISTORY: ThreadHistory<never> = Object.freeze({ messages: [], hasMore: false, nextBefore: null, nextBeforeId: null });

/** Shape one API response (newest-first, `pagination` only when a limit was sent). */
export function toThreadPage<T extends ChatMessageLike>(data: {
  messages?: T[];
  pagination?: { hasMore?: boolean; nextBefore?: string | null; nextBeforeId?: string | null };
}): ThreadPage<T> {
  return {
    // The API is newest-first (the mobile list is inverted); the page reads top to bottom.
    messages: sortMessagesAscending(data.messages || []),
    hasMore: Boolean(data.pagination?.hasMore),
    nextBefore: data.pagination?.nextBefore ?? null,
    nextBeforeId: data.pagination?.nextBeforeId ?? null,
  };
}

/** Union by id, `fresh` copies replacing `held` ones, oldest first. */
function foldMessages<T extends ChatMessageLike>(held: readonly T[], fresh: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const m of held) byId.set(m._id, m);
  for (const m of fresh) byId.set(m._id, m);
  return sortMessagesAscending([...byId.values()]);
}

/**
 * Fold a (re)fetched newest page into the history. After a send the newest
 * page slides forward by one message, so the one that fell off its start
 * must survive here or it vanishes from the middle of the thread once older
 * pages are on screen. When the page no longer touches what is held (more
 * than a page of messages arrived while the socket was down) the older
 * history is dropped rather than shown with a silent hole in it: scrolling
 * up loads it again from the page's own cursor.
 */
export function absorbNewestPage<T extends ChatMessageLike>(history: ThreadHistory<T>, page: ThreadPage<T>): ThreadHistory<T> {
  if (!history.messages.length) return page;
  const held = new Map(history.messages.map((m) => [m._id, m] as const));
  if (page.messages.every((m) => held.get(m._id) === m)) return history;
  const overlaps = page.messages.some((m) => held.has(m._id));
  if (!overlaps && page.hasMore) return page;
  const messages = foldMessages(history.messages, page.messages);
  // A page with no older sibling is the whole thread; otherwise the history's
  // (older) cursor still marks where the next scroll-up continues.
  return page.hasMore
    ? { messages, hasMore: history.hasMore, nextBefore: history.nextBefore, nextBeforeId: history.nextBeforeId }
    : { messages, hasMore: false, nextBefore: null, nextBeforeId: null };
}

/** Prepend a page fetched with the history's cursor; the cursor moves to the page's. */
export function absorbEarlierPage<T extends ChatMessageLike>(history: ThreadHistory<T>, page: ThreadPage<T>): ThreadHistory<T> {
  return {
    messages: foldMessages(history.messages, page.messages),
    hasMore: page.hasMore,
    nextBefore: page.nextBefore,
    nextBeforeId: page.nextBeforeId,
  };
}

/** The `messageRead` socket payload (utils/socketServer + messageController). */
export type ReadReceiptPayload = {
  roomId?: string | null;
  readBy?: string;
  messagesId?: Array<{ _id: string; readers?: string[] }>;
};

/**
 * Apply a receipt to a list of messages. Readers are replaced by the
 * server's list when present, otherwise `readBy` is added, so a client that
 * only knows who read stays correct too. Returns the same array when nothing
 * changed so React state and query caches skip a render.
 */
export function applyReadReceipts<T extends ChatMessageLike>(messages: readonly T[], payload: ReadReceiptPayload): T[] {
  const updates = new Map<string, string[] | undefined>();
  for (const entry of payload.messagesId || []) if (entry?._id) updates.set(String(entry._id), entry.readers?.map(String));
  if (!updates.size) return messages as T[];
  let changed = false;
  const next = messages.map((m) => {
    if (!updates.has(m._id)) return m;
    const current = (m.readers || []).map(String);
    const readers = updates.get(m._id) ?? (payload.readBy ? [...new Set([...current, String(payload.readBy)])] : current);
    if (readers.length === current.length && readers.every((r, i) => r === current[i])) return m;
    changed = true;
    return { ...m, readers };
  });
  return changed ? next : (messages as T[]);
}

/** Who is typing where: roomId -> users, each with the time we last heard from them. */
export type TypingState = Record<string, Array<{ id: string; name: string; at: number }>>;

/** Typing bubbles disappear on their own if the peer's stop event never arrives. */
export const TYPING_TTL_MS = 6000;

export type TypingEvent = { roomId: string; userId: string; name: string; at?: number };

export function typingStarted(state: TypingState, ev: TypingEvent): TypingState {
  const at = ev.at ?? Date.now();
  const room = state[ev.roomId] || [];
  const rest = room.filter((u) => u.id !== ev.userId);
  return { ...state, [ev.roomId]: [...rest, { id: ev.userId, name: ev.name, at }] };
}

export function typingStopped(state: TypingState, ev: Pick<TypingEvent, 'roomId' | 'userId'>): TypingState {
  const room = state[ev.roomId];
  if (!room || !room.some((u) => u.id === ev.userId)) return state;
  const rest = room.filter((u) => u.id !== ev.userId);
  const next = { ...state };
  if (rest.length) next[ev.roomId] = rest;
  else delete next[ev.roomId];
  return next;
}

/** Drop entries older than the TTL. Returns the same object when nothing expired. */
export function typingExpired(state: TypingState, now = Date.now(), ttl = TYPING_TTL_MS): TypingState {
  let changed = false;
  const next: TypingState = {};
  for (const [roomId, users] of Object.entries(state)) {
    const alive = users.filter((u) => now - u.at < ttl);
    if (alive.length !== users.length) changed = true;
    if (alive.length) next[roomId] = alive;
  }
  return changed ? next : state;
}

/** "Maya is typing", "Maya and Jordan are typing", "Several people are typing". */
export function typingLabel(users: ReadonlyArray<{ name: string }>): string {
  const names = users.map((u) => u.name.trim()).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return 'Several people are typing';
}

/** Attachments the composer accepts; the server verifies the same list. */
export const ACCEPTED_TYPES: Readonly<Record<string, 'image' | 'video'>> = Object.freeze({
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/heic': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
});

export const ACCEPTED_TYPES_LABEL = 'JPG, PNG, GIF, WebP, HEIC, MP4 or MOV';

/** Error codes services/chatAccess.js puts on 403s. */
export const CHAT_CONSENT_REQUIRED = 'CHAT_CONSENT_REQUIRED';
export const CHAT_BLOCKED = 'CHAT_BLOCKED';

type ErrorLike = { response?: { status?: number; data?: { code?: string; message?: string; user?: ChatUserLike } } };

/** The peer refused unsolicited messages: a retry cannot succeed, only a friend request can. */
export function isConsentError(e: unknown): boolean {
  const ax = e as ErrorLike;
  return ax?.response?.status === 403 && ax.response.data?.code === CHAT_CONSENT_REQUIRED;
}

export function consentErrorUser(e: unknown): ChatUserLike | undefined {
  return (e as ErrorLike)?.response?.data?.user;
}

/** Copy for the consent callout, shared by the draft thread and the failed bubble. */
export function consentCopy(name: string, friendStatus?: string): { title: string; body: string; cta: 'add' | 'requested' | 'accept' | null } {
  const first = name.split(' ')[0] || name;
  if (friendStatus === 'requested' || friendStatus === 'pending') {
    return { title: `Friend request sent`, body: `You can message ${first} as soon as they accept.`, cta: 'requested' };
  }
  if (friendStatus === 'incoming') {
    return { title: `${first} sent you a friend request`, body: `Accept it to start the conversation.`, cta: 'accept' };
  }
  return { title: `${name} only accepts messages from friends`, body: `Send a friend request and you can chat once ${first} accepts.`, cta: 'add' };
}
