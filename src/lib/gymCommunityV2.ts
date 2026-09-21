/**
 * Gym community v2 — the six flagged surfaces, plus the gym-page reads that
 * are not flagged but belong to the same page
 * (docs/api-contract.md, "Gym community v2: moderation, levels,
 * announcements, ownership, Regular, claim", "Gym community events, RSVP,
 * reminders and .ics", "Gym hours, trained today and member-added gyms",
 * "Pinned posts", "Gym equipment …").
 *
 * One router, `routes/gymCommunityV2.js`, mounted at `/api/gyms/community`
 * BEFORE the legacy community router. Six flags gate six route families, all
 * `false` at the deploy: `gymModerationQueue`, `gymNotificationLevels`,
 * `gymAnnouncements`, `gymOwnership`, `gymRegular`, `gymOwnerClaim` (the last
 * stays off past the wave, D-98 — nothing here calls it). A route whose flag
 * is off for the caller answers `404 { code: 'FEATURE_DISABLED', feature }`,
 * so **every** read below resolves to `null` on that answer and every write
 * reports it as "not on this account yet". A flag-off surface is absent, never
 * an error card.
 *
 * Literal request paths on purpose: scripts/audit-api-contracts.cjs and
 * tests/gym-community-v2-contract.test.mjs pin each one against
 * contracts/backend-routes.json.
 */
import { api } from './api';
import { apiErrorDetails, parseApiError } from './apiError';

/* ------------------------------------------------------------------ flags and absence */

/** The six PRE-G-3 flags, one per surface. `gymOwnerClaim` is listed for completeness and never called. */
export const GYM_V2_FLAGS = Object.freeze({
  moderation: 'gymModerationQueue',
  levels: 'gymNotificationLevels',
  announcements: 'gymAnnouncements',
  ownership: 'gymOwnership',
  regular: 'gymRegular',
  claim: 'gymOwnerClaim',
} as const);

export type GymV2Flag = (typeof GYM_V2_FLAGS)[keyof typeof GYM_V2_FLAGS];

/** The 404 a gated route answers while its flag is off for the caller. */
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

const statusOf = (e: unknown): number | null => apiErrorDetails(e).status;

/**
 * Every v2 read goes through here: a flag that is off (`404
 * FEATURE_DISABLED`), a community the viewer may not see (`404
 * COMMUNITY_NOT_FOUND`) and a role refusal (`403`) all mean "this surface is
 * not for you" — the caller renders nothing. Anything else still throws, so a
 * real fault keeps its error state.
 */
export async function absentOnRefusal<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    const status = statusOf(e);
    if (status === 404 || status === 403) return null;
    throw e;
  }
}

/** The envelope some gym routes still wrap their body in. */
const unwrap = <T,>(data: unknown, key: keyof T & string): T => {
  const outer = data as { data?: unknown } | null;
  if (outer && typeof outer === 'object' && outer.data && typeof outer.data === 'object' && key in (outer.data as object)) return outer.data as T;
  return data as T;
};

/* ------------------------------------------------------------------ query keys */

/**
 * Query keys, all under `['community', id, …]` so the community page's
 * existing invalidations (`['community', communityId]`) reach them.
 */
export const gymV2Keys = {
  pins: (id: string) => ['community', id, 'pins'] as const,
  announcementSeen: (id: string, postId: string) => ['community', id, 'announcement-seen', postId] as const,
  composerContext: (id: string) => ['community', id, 'composer-context'] as const,
  moderationQueue: (id: string, status: QueueStatus, page: number) => ['community', id, 'moderation', 'queue', status, page] as const,
  moderationLog: (id: string, page: number) => ['community', id, 'moderation', 'log', page] as const,
  level: (id: string) => ['community', id, 'notification-level'] as const,
  ownership: (id: string) => ['community', id, 'ownership'] as const,
  roles: (id: string) => ['community', id, 'roles'] as const,
  regulars: (id: string) => ['community', id, 'regulars'] as const,
  myRegular: (id: string) => ['community', id, 'my-regular'] as const,
  equipment: (id: string) => ['community', id, 'equipment'] as const,
  activeThisWeek: (id: string) => ['community', id, 'active-this-week'] as const,
  trainedToday: (id: string, timeZone: string) => ['community', id, 'trained-today', timeZone] as const,
  placeHours: (placeId: string, timeZone: string) => ['place', placeId, 'hours', timeZone] as const,
  eventAttendees: (eventId: string) => ['gym-event', eventId, 'attendees'] as const,
  eventInsights: (eventId: string) => ['gym-event', eventId, 'insights'] as const,
};

/* ------------------------------------------------------------------ shared shapes */

/** `toPublicActor`: what every v2 payload names a person with. */
export type Actor = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  isVerified?: boolean;
  isIdentityVerified?: boolean;
};

/* ------------------------------------------------------------------ the gym page's activity reads (not flagged) */

/**
 * `GET /gyms/community/:id/active-this-week` — `count` is the distinct
 * members with a check-in this week whatever its visibility; `members` is the
 * subset the viewer may see (at most 12, newest first); `sample` is true when
 * `members` names fewer people than `count`.
 */
export type ActiveThisWeek = { count: number; members: Actor[]; sample?: boolean };

/** `GET /gyms/community/:id/trained-today?timeZone=` — the same, for the community's local day. */
export type TrainedToday = {
  count: number;
  members: Actor[];
  /** True when `members` is shorter than `count`: say "and others", never a masked number. */
  sample?: boolean;
  localDay?: string;
  timezone?: string;
  /** `default` means the day was drawn in UTC: the community has no zone yet. */
  timezoneSource?: 'community' | 'query' | 'viewer' | 'default' | string;
};

/** `GET /gyms/places/:placeId/hours?timeZone=` — `open: null` means the provider has no hours we can read. */
export type PlaceHours = {
  open: boolean | null;
  closesAt?: string | null;
  opensAt?: string | null;
  openingHours?: unknown;
  timezone?: string;
};

/** `{ count, members }`, sometimes inside a `data` envelope; anything else is "no figure". */
export function readActivity<T extends { count: number; members: Actor[] }>(data: unknown): T | null {
  const outer = data as { data?: unknown } | null;
  const inner = outer?.data;
  const body = (inner && typeof inner === 'object' && 'count' in (inner as object) ? inner : data) as Partial<T> | null;
  if (!body || typeof body !== 'object' || typeof body.count !== 'number' || !Number.isFinite(body.count)) return null;
  const members = Array.isArray(body.members) ? body.members.filter((m): m is Actor => Boolean(m && typeof m === 'object' && (m as Actor)._id)) : [];
  return { ...(body as T), count: Math.max(0, Math.round(body.count)), members };
}

export async function fetchActiveThisWeek(communityId: string): Promise<ActiveThisWeek | null> {
  const { data } = await api.get(`/gyms/community/${communityId}/active-this-week`);
  return readActivity<ActiveThisWeek>(data);
}

export async function fetchTrainedToday(communityId: string, timeZone: string): Promise<TrainedToday | null> {
  const { data } = await api.get(`/gyms/community/${communityId}/trained-today`, { params: { timeZone } });
  return readActivity<TrainedToday>(data);
}

export async function fetchPlaceHours(placeId: string, timeZone: string): Promise<PlaceHours | null> {
  const { data } = await api.get(`/gyms/places/${encodeURIComponent(placeId)}/hours`, { params: { timeZone } });
  const outer = data as { data?: unknown } | null;
  const body = (outer?.data && typeof outer.data === 'object' && 'open' in (outer.data as object) ? outer.data : data) as PlaceHours | null;
  return body && typeof body === 'object' && 'open' in body ? body : null;
}

/* ------------------------------------------------------------------ pins and the pinned announcement */

/** One row of `GET /gyms/community/:gymId/pins`. `post` is the shape every post list returns. */
export type CommunityPin<P = PinnedPost> = {
  _id?: string;
  post?: P | null;
  pinnedBy?: Actor | null;
  pinnedAt?: string;
  position?: number;
};

/** Only the fields the announcement card reads; the post card takes the whole row. */
export type PinnedPost = {
  _id: string;
  content?: string;
  createdAt?: string;
  editedAt?: string | null;
  isAnnouncement?: boolean;
  author?: Actor | null;
  postedAs?: { kind?: string; community?: unknown; by?: Actor | string | null } | null;
};

export async function fetchPins<P = PinnedPost>(communityId: string): Promise<{ pins: CommunityPin<P>[]; limit: number }> {
  const { data } = await api.get(`/gyms/community/${communityId}/pins`);
  const body = unwrap<{ pins?: CommunityPin<P>[]; limit?: number }>(data, 'pins');
  const pins = Array.isArray(body?.pins) ? body.pins.filter((pin) => Boolean(pin?.post)) : [];
  return { pins, limit: typeof body?.limit === 'number' ? body.limit : 3 };
}

/**
 * The announcement to draw at the top of the feed: the pinned post the API
 * marked `isAnnouncement`, lowest position first. No route lists
 * announcements, so the pin strip is where the community's own notice lives
 * (`POST /announcements { pin: true }` is what puts it there).
 */
export function pinnedAnnouncementOf<P extends { isAnnouncement?: boolean }>(pins: CommunityPin<P>[]): P | null {
  const rows = [...pins].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const hit = rows.find((pin) => pin.post?.isAnnouncement === true);
  return hit?.post ?? null;
}

const BLANK_LINE = /\n\s*\n/;

/**
 * An announcement is one `content` string: the first line is its title and
 * the rest is the body (what the composer writes back). A single-line notice
 * has a title and no body; a long first paragraph is a body with no title, so
 * nothing is truncated into a headline it did not choose.
 */
export function announcementParts(content?: string | null): { title: string | null; body: string } {
  const text = String(content ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return { title: null, body: '' };
  const split = text.split(BLANK_LINE);
  const head = split[0].trim();
  const rest = split.slice(1).join('\n\n').trim();
  const oneLine = head.split('\n')[0].trim();
  if (split.length > 1 && head === oneLine && head.length <= 120) return { title: head, body: rest };
  if (split.length === 1 && text.split('\n').length === 1 && text.length <= 120) return { title: text, body: '' };
  return { title: null, body: text };
}

/** What the composer sends as `content`: the title, a blank line, the body. */
export const announcementContent = (title: string, body: string): string =>
  [title.trim(), body.trim()].filter(Boolean).join('\n\n');

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_CONTENT_MAX = 2200;

export type AnnouncementDraft = { title: string; body: string };

/** The form's own rule before the round trip: a title, and the two together inside `content ≤ 2200`. */
export function announcementError(draft: AnnouncementDraft): string | null {
  const title = draft.title.trim();
  if (title.length < 2) return 'Give the announcement a title of at least 2 characters';
  if (title.length > ANNOUNCEMENT_TITLE_MAX) return `Keep the title under ${ANNOUNCEMENT_TITLE_MAX} characters`;
  if (announcementContent(draft.title, draft.body).length > ANNOUNCEMENT_CONTENT_MAX) {
    return `Title and body together must stay under ${ANNOUNCEMENT_CONTENT_MAX} characters`;
  }
  return null;
}

/** `POST /gyms/community/:gymId/announcements` → `201 { post, pushed, pinned, pinReason, held }`. */
export type AnnouncementCreated<P = PinnedPost> = {
  post?: P | null;
  pushed?: number | boolean | null;
  pinned?: boolean;
  /** `limit` when three posts were already pinned: the notice posted, unpinned. */
  pinReason?: 'limit' | null;
  /** The C2 filter held it: nothing was pushed and only the poster sees it yet. */
  held?: boolean;
  replayed?: boolean;
};

export async function postAnnouncement<P = PinnedPost>(
  communityId: string,
  body: { clientRequestId: string; content: string; pin?: boolean; commentsOff?: boolean },
): Promise<AnnouncementCreated<P>> {
  const { data } = await api.post(`/gyms/community/${communityId}/announcements`, body);
  return data as AnnouncementCreated<P>;
}

export async function editAnnouncement<P = PinnedPost>(
  communityId: string,
  postId: string,
  body: { content?: string; commentsOff?: boolean },
): Promise<{ post?: P | null }> {
  const { data } = await api.patch(`/gyms/community/${communityId}/announcements/${postId}`, body);
  return data as { post?: P | null };
}

export async function deleteAnnouncement(communityId: string, postId: string): Promise<{ deletedAt?: string; restoreUntil?: string }> {
  const { data } = await api.delete(`/gyms/community/${communityId}/announcements/${postId}`);
  return data as { deletedAt?: string; restoreUntil?: string };
}

/** `PUT …/seen` → `204`. A no-op for the poster, an opted-out member and a minor; never worth an error. */
export async function markAnnouncementSeen(communityId: string, postId: string): Promise<void> {
  await api.put(`/gyms/community/${communityId}/announcements/${postId}/seen`);
}

/** `GET …/seen` → `{ count: number | null }`; `null` below `SEEN_COUNT_MIN`, so the line is omitted. */
export async function fetchAnnouncementSeen(communityId: string, postId: string): Promise<number | null> {
  const { data } = await api.get(`/gyms/community/${communityId}/announcements/${postId}/seen`);
  const count = (data as { count?: unknown } | null)?.count;
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
}

/** `GET /composer-context`: what the member may post right now, and the pin and push budgets. */
export type ComposerContext = {
  canPost?: boolean;
  reason?: null | 'paused' | 'posting_restricted' | 'posting_paused';
  until?: string;
  slowMode?: null | { seconds: number; nextAllowedAt?: string };
  newMember?: { isNew?: boolean; mode?: string };
  canPostAsGym?: boolean;
  announcementPush?: { used?: number; cap?: number; left?: number };
  pins?: { used?: number; cap?: number };
};

export async function fetchComposerContext(communityId: string): Promise<ComposerContext> {
  const { data } = await api.get(`/gyms/community/${communityId}/composer-context`);
  return data as ComposerContext;
}

/* ------------------------------------------------------------------ moderation (gymModerationQueue) */

export type QueueStatus = 'open' | 'resolved';

/** The member block on a queue row: joining, posting and rules facts only — never a visit, a session or a weight. */
export type QueueMember = {
  user?: Actor | null;
  joinedAt?: string | null;
  isNew?: boolean;
  approvedPosts?: number;
  priorActions?: number;
  notes?: number;
  postingPausedUntil?: string | null;
  rulesAcceptedAt?: string | null;
  rulesVersion?: number | null;
  currentRulesVersion?: number | null;
};

/** One queued item: a grouped pending report, or a post the hold rules are keeping back. */
export type QueueItem = {
  kind: 'report' | 'held_post';
  id: string;
  reportIds?: string[];
  reportCount?: number;
  reason?: string;
  createdAt?: string;
  status?: string;
  scope?: 'community' | 'platform' | string;
  escalatedAt?: string | null;
  heldReason?: 'new_member_hold' | 'filter' | 'slow_mode' | string;
  autoPublishAt?: string | null;
  autoPublishedAt?: string | null;
  collapsed?: boolean;
  target: {
    type?: string;
    id?: string;
    preview?: { title?: string | null; body?: string | null; imageUrl?: string | null };
    author?: Actor | null;
  };
  member?: QueueMember;
  statement?: { action?: string; ruleCode?: string | null; appeal?: { status?: string } } | null;
  communityModeration?: { action?: string; ruleCode?: string | null; ruleTitle?: string | null; at?: string | null; reversedAt?: string | null };
};

export type ModerationQueue = {
  items: QueueItem[];
  total: number;
  page: number;
  hasNextPage: boolean;
  counts?: { open?: number };
};

export async function fetchModerationQueue(
  communityId: string,
  params: { status?: QueueStatus; page?: number; limit?: number } = {},
): Promise<ModerationQueue> {
  const { data } = await api.get(`/gyms/community/${communityId}/moderation/queue`, { params });
  const body = data as Partial<ModerationQueue> | null;
  return {
    items: Array.isArray(body?.items) ? body.items : [],
    total: Number(body?.total) || 0,
    page: Number(body?.page) || 1,
    hasNextPage: body?.hasNextPage === true,
    counts: body?.counts,
  };
}

/** `services/gymModeration.js LADDER`, in its own order. `rule` means the action must name a numbered community rule. */
export const MODERATION_LADDER = Object.freeze([
  { action: 'note', label: 'Add a note', targets: ['member', 'report', 'post'], rule: false, minRole: 'moderator' },
  { action: 'approve', label: 'Approve', targets: ['post', 'report'], rule: false, minRole: 'moderator' },
  { action: 'dismiss', label: 'Dismiss', targets: ['report'], rule: false, minRole: 'moderator' },
  { action: 'collapse', label: 'Collapse', targets: ['post', 'report'], rule: true, minRole: 'moderator' },
  { action: 'remove', label: 'Remove the post', targets: ['post', 'report'], rule: true, minRole: 'moderator' },
  { action: 'mute', label: 'Pause posting', targets: ['member', 'report'], rule: true, minRole: 'moderator' },
  { action: 'remove_member', label: 'Remove the member', targets: ['member', 'report'], rule: true, minRole: 'admin' },
  { action: 'escalate', label: 'Send to Vybe', targets: ['report'], rule: false, minRole: 'moderator' },
] as const);

export type ModerationAction = (typeof MODERATION_LADDER)[number]['action'];
export type ModerationTargetKind = 'post' | 'comment' | 'member' | 'report';

const RANK: Record<string, number> = { member: 0, moderator: 1, admin: 2, owner: 3 };

/**
 * Which rungs of the ladder this row offers this moderator: the actions whose
 * `targets` include the row's target kind and whose `minRole` the viewer
 * holds. A held post's own target is the post; a report row can act on the
 * report, the post behind it or its author.
 */
export function actionsFor(item: QueueItem, role: string | null | undefined): typeof MODERATION_LADDER[number][] {
  const mine = RANK[String(role || 'member').toLowerCase()] ?? 0;
  const kinds = new Set<string>();
  if (item.kind === 'report') kinds.add('report');
  const targetType = String(item.target?.type || '').toLowerCase();
  if (targetType === 'post' || targetType === 'comment') kinds.add('post');
  if (item.kind === 'held_post') kinds.add('post');
  if (item.member?.user?._id || targetType === 'member' || targetType === 'user') kinds.add('member');
  return MODERATION_LADDER.filter((rung) => (RANK[rung.minRole] ?? 3) <= mine && rung.targets.some((t) => kinds.has(t)));
}

export type ModerationActionBody = {
  clientRequestId: string;
  action: ModerationAction;
  target: { kind: ModerationTargetKind; id: string };
  ruleCode?: string;
  note?: string;
  duration?: '24h' | '7d';
  reportIds?: string[];
};

export type ModerationOutcome = {
  outcome?: string;
  reportIds?: string[];
  member?: { id?: string };
  until?: string;
  replayed?: boolean;
};

export async function actOnModeration(communityId: string, body: ModerationActionBody): Promise<ModerationOutcome> {
  const { data } = await api.post(`/gyms/community/${communityId}/moderation/actions`, body);
  return data as ModerationOutcome;
}

/** One row of the log (and of a member's notes): a `CommunityMemberNote`. */
export type ModerationLogEntry = {
  id: string;
  kind?: 'note' | 'action' | string;
  label?: string | null;
  text?: string;
  action?: {
    type?: string;
    ruleCode?: string | null;
    ruleTitle?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    reportId?: string | null;
    duration?: string | null;
    until?: string | null;
  } | null;
  member?: string | null;
  memberActor?: Actor | null;
  author?: Actor | null;
  createdAt?: string;
};

export type ModerationLog = { items: ModerationLogEntry[]; total: number; page: number; hasNextPage: boolean };

export async function fetchModerationLog(communityId: string, params: { page?: number; limit?: number } = {}): Promise<ModerationLog> {
  const { data } = await api.get(`/gyms/community/${communityId}/moderation/log`, { params });
  const body = data as Partial<ModerationLog> | null;
  return {
    items: Array.isArray(body?.items) ? body.items : [],
    total: Number(body?.total) || 0,
    page: Number(body?.page) || 1,
    hasNextPage: body?.hasNextPage === true,
  };
}

/** `GET …/moderation/members/:userId/context` → the block, the notes, the actions taken. */
export type MemberContext = { member?: QueueMember; notes?: ModerationLogEntry[]; actions?: ModerationLogEntry[] };

export async function fetchMemberContext(communityId: string, userId: string): Promise<MemberContext> {
  const { data } = await api.get(`/gyms/community/${communityId}/moderation/members/${userId}/context`);
  return data as MemberContext;
}

/** `POST …/moderation/notes` — the controller's body is `{ memberId, label, text }` (the doc's `userId` is stale). */
export async function addModerationNote(
  communityId: string,
  body: { memberId: string; text: string; label?: string },
): Promise<{ note?: ModerationLogEntry }> {
  const { data } = await api.post(`/gyms/community/${communityId}/moderation/notes`, body);
  return data as { note?: ModerationLogEntry };
}

/** The appeals a community admin may decide: the queue rows whose statement carries an open community appeal. */
export type AppealRow = { item: QueueItem; reportId: string; status: string };

export function appealsOf(items: QueueItem[]): AppealRow[] {
  const rows: AppealRow[] = [];
  for (const item of items) {
    const appeal = item.statement?.appeal;
    const reportId = item.reportIds?.[0] || (item.kind === 'report' ? item.id : null);
    if (appeal?.status && reportId) rows.push({ item, reportId, status: String(appeal.status) });
  }
  return rows;
}

export async function decideAppeal(
  communityId: string,
  reportId: string,
  body: { decision: 'upheld' | 'reversed'; note?: string },
): Promise<{ report?: { id?: string; appeal?: { status?: string; reviewerScope?: string; restored?: boolean } } }> {
  const { data } = await api.post(`/gyms/community/${communityId}/moderation/appeals/${reportId}`, body);
  return data as { report?: { id?: string; appeal?: { status?: string; reviewerScope?: string; restored?: boolean } } };
}

/* ------------------------------------------------------------------ notification levels (gymNotificationLevels) */

export type NotificationLevel = 'all' | 'highlights' | 'mentions' | 'none';

/** `GymMemberSettings.NOTIFICATION_LEVELS`; `highlights` is the default (D-109 (b)). */
export const NOTIFICATION_LEVELS: readonly { value: NotificationLevel; label: string; description: string }[] = Object.freeze([
  { value: 'all', label: 'All', description: 'Announcements, every post and new sessions.' },
  { value: 'highlights', label: 'Highlights', description: 'Announcements and new sessions. The default.' },
  { value: 'mentions', label: 'Mentions only', description: 'Only when someone names you; the rest waits in your inbox.' },
  { value: 'none', label: 'Off', description: 'Nothing is pushed from this gym.' },
]);

export type LevelView = {
  level: NotificationLevel;
  mutedUntil: string | null;
  mutedIndefinitely: boolean;
  default: NotificationLevel;
};

const LEVEL_SET = new Set(NOTIFICATION_LEVELS.map((row) => row.value));

const readLevel = (data: unknown): LevelView => {
  const body = data as Partial<LevelView> | null;
  const level = LEVEL_SET.has(body?.level as NotificationLevel) ? (body!.level as NotificationLevel) : 'highlights';
  return {
    level,
    mutedUntil: typeof body?.mutedUntil === 'string' ? body.mutedUntil : null,
    mutedIndefinitely: body?.mutedIndefinitely === true,
    default: LEVEL_SET.has(body?.default as NotificationLevel) ? (body!.default as NotificationLevel) : 'highlights',
  };
};

export async function fetchNotificationLevel(communityId: string): Promise<LevelView> {
  const { data } = await api.get(`/gyms/community/${communityId}/me/notification-level`);
  return readLevel(data);
}

export async function saveNotificationLevel(
  communityId: string,
  body: { level?: NotificationLevel; mute?: '1h' | '8h' | '1w' | 'indefinite' | 'off' },
): Promise<LevelView> {
  const { data } = await api.put(`/gyms/community/${communityId}/me/notification-level`, body);
  return readLevel(data);
}

/** `{ showRegular?, seenByOptIn? }` — whether the laurel shows and whether the member is counted in seen-by. */
export async function saveCommunityPrefs(
  communityId: string,
  body: { showRegular?: boolean; seenByOptIn?: boolean },
): Promise<{ settings?: { showRegular?: boolean; seenByOptIn?: boolean } }> {
  const { data } = await api.put(`/gyms/community/${communityId}/me/community-prefs`, body);
  return data as { settings?: { showRegular?: boolean; seenByOptIn?: boolean } };
}

/** The whole set, for a settings screen: every community the member is in with its level. */
export async function fetchMyNotificationLevels(): Promise<{ community: { _id: string; name?: string }; level: NotificationLevel }[]> {
  const { data } = await api.get('/gyms/community/me/notification-levels');
  const rows = (data as { communities?: unknown } | null)?.communities;
  return Array.isArray(rows) ? (rows as { community: { _id: string; name?: string }; level: NotificationLevel }[]) : [];
}

/** "Notifications: Highlights", or the mute when one is on — what the overflow row reads. */
export function levelLabel(view?: LevelView | null): string {
  if (!view) return 'Notifications';
  if (view.mutedIndefinitely) return 'Notifications: muted';
  if (view.mutedUntil && new Date(view.mutedUntil).getTime() > Date.now()) return 'Notifications: muted';
  const row = NOTIFICATION_LEVELS.find((entry) => entry.value === view.level);
  return `Notifications: ${row ? row.label : view.level}`;
}

/* ------------------------------------------------------------------ ownership (gymOwnership) */

export type OwnershipOffer = {
  id: string;
  kind?: 'offer' | 'auto_offer' | 'nomination' | string;
  status?: string;
  to?: Actor | null;
  from?: string | null;
  expiresAt?: string | null;
};

export type OwnershipView = {
  owner: Actor | null;
  founder: Actor | null;
  isOwner: boolean;
  /** The one open transfer for this community, whoever it is for. */
  pendingOffer: OwnershipOffer | null;
  /** Set only when that offer is for the viewer: their Accept / Decline row. */
  myOffer: { id: string; expiresAt?: string | null } | null;
  nominatingUntil: string | null;
  pausedAt: string | null;
  pausedBy: Actor | null;
  archivedAt: string | null;
  restoreUntil: string | null;
  successorCandidate: Actor | null;
};

export async function fetchOwnership(communityId: string): Promise<OwnershipView> {
  const { data } = await api.get(`/gyms/community/${communityId}/ownership`);
  const body = data as Partial<OwnershipView> | null;
  return {
    owner: body?.owner ?? null,
    founder: body?.founder ?? null,
    isOwner: body?.isOwner === true,
    pendingOffer: body?.pendingOffer ?? null,
    myOffer: body?.myOffer ?? null,
    nominatingUntil: body?.nominatingUntil ?? null,
    pausedAt: body?.pausedAt ?? null,
    pausedBy: body?.pausedBy ?? null,
    archivedAt: body?.archivedAt ?? null,
    restoreUntil: body?.restoreUntil ?? null,
    successorCandidate: body?.successorCandidate ?? null,
  };
}

export async function offerOwnership(communityId: string, to: string): Promise<{ offer?: OwnershipOffer | null }> {
  const { data } = await api.post(`/gyms/community/${communityId}/ownership/offer`, { to });
  return data as { offer?: OwnershipOffer | null };
}

export async function cancelOwnershipOffer(communityId: string): Promise<{ offer?: { id?: string; status?: string } }> {
  const { data } = await api.delete(`/gyms/community/${communityId}/ownership/offer`);
  return data as { offer?: { id?: string; status?: string } };
}

/** Accept needs a fresh `X-Reauth` token (401 REAUTH_REQUIRED without one). */
export async function acceptOwnership(communityId: string, reauthToken: string | null): Promise<{ owner?: Actor | null }> {
  const { data } = await api.post(`/gyms/community/${communityId}/ownership/accept`, {}, { headers: reauthToken ? { 'X-Reauth': reauthToken } : {} });
  return data as { owner?: Actor | null };
}

export async function declineOwnership(communityId: string): Promise<{ offer?: { id?: string; status?: string } }> {
  const { data } = await api.post(`/gyms/community/${communityId}/ownership/decline`, {});
  return data as { offer?: { id?: string; status?: string } };
}

/** Any adult member, while the community is nominating or paused with no owner. Needs `X-Reauth`. */
export async function nominateOwner(communityId: string, reauthToken: string | null): Promise<{ owner?: Actor | null }> {
  const { data } = await api.post(`/gyms/community/${communityId}/ownership/nominate`, {}, { headers: reauthToken ? { 'X-Reauth': reauthToken } : {} });
  return data as { owner?: Actor | null };
}

/** The owner leaves: the chain offers the longest-serving admin, then a moderator, then a nomination window. */
export async function leaveAsOwner(communityId: string): Promise<{ left?: boolean; next?: 'offered' | 'nominating' | string; offer?: { to?: unknown; expiresAt?: string } }> {
  const { data } = await api.post(`/gyms/community/${communityId}/ownership/leave`, {});
  return data as { left?: boolean; next?: string; offer?: { to?: unknown; expiresAt?: string } };
}

/** `GET /roles` → who holds what. `regulars` is empty while `gymRegular` is off. */
export type RolesView = { owner: Actor | null; admins: Actor[]; moderators: Actor[]; staff: Actor[]; regulars: string[] };

export async function fetchRoles(communityId: string): Promise<RolesView> {
  const { data } = await api.get(`/gyms/community/${communityId}/roles`);
  const body = data as Partial<RolesView> | null;
  const list = (v: unknown): Actor[] => (Array.isArray(v) ? (v as Actor[]).filter((a) => Boolean(a?._id)) : []);
  return {
    owner: body?.owner ?? null,
    admins: list(body?.admins),
    moderators: list(body?.moderators),
    staff: list(body?.staff),
    regulars: Array.isArray(body?.regulars) ? body.regulars.map(String) : [],
  };
}

/** Who the owner may offer ownership to: an active adult admin or moderator, never themselves. */
export function offerCandidates(roles: RolesView | null | undefined, ownerId?: string | null): Actor[] {
  if (!roles) return [];
  const seen = new Set<string>(ownerId ? [String(ownerId)] : []);
  const out: Actor[] = [];
  for (const actor of [...roles.admins, ...roles.moderators]) {
    const id = String(actor._id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(actor);
  }
  return out;
}

/* ------------------------------------------------------------------ the Regular laurel (gymRegular) */

/** `GET /:gymId/me/regular` — the member's own facts. `offer` is true once, to ask them to show it. */
export type MyRegular = { regular: boolean; since: string | null; days90: number; showRegular: boolean; offer: boolean };

export async function fetchMyRegular(communityId: string): Promise<MyRegular> {
  const { data } = await api.get(`/gyms/community/${communityId}/me/regular`);
  const body = data as Partial<MyRegular> | null;
  return {
    regular: body?.regular === true,
    since: typeof body?.since === 'string' ? body.since : null,
    days90: Number(body?.days90) || 0,
    showRegular: body?.showRegular === true,
    offer: body?.offer === true,
  };
}

export async function markRegularOfferSeen(communityId: string): Promise<void> {
  await api.post(`/gyms/community/${communityId}/me/regular/offer-seen`, {});
}

/** `GET /:gymId/regulars` → the opted-in laurels only. Never counts or dates for anyone else. */
export async function fetchRegulars(communityId: string): Promise<{ userIds: string[]; count: number }> {
  const { data } = await api.get(`/gyms/community/${communityId}/regulars`);
  const body = data as { userIds?: unknown; count?: unknown } | null;
  const userIds = Array.isArray(body?.userIds) ? body.userIds.map(String) : [];
  return { userIds, count: typeof body?.count === 'number' ? body.count : userIds.length };
}

/** A set for the member list to test against; empty while the flag is off. */
export const regularSetOf = (regulars?: { userIds: string[] } | null): Set<string> => new Set(regulars?.userIds || []);

/* ------------------------------------------------------------------ events: RSVP, attendees, insights, .ics */

export type RsvpStatus = 'going' | 'waitlist' | 'none';

export type MyRsvp = {
  status?: RsvpStatus;
  showOnList?: boolean;
  remind?: boolean;
  reminderAt?: string | null;
  reminderChannel?: 'push' | 'inbox' | 'none';
  attendedAt?: string | null;
  removed?: boolean;
  removeReason?: string;
};

export type RsvpResult = {
  status: RsvpStatus;
  rsvp: MyRsvp | null;
  counts?: { going?: number; waitlist?: number; capacity?: number | null; spotsLeft?: number | null };
  event?: { _id?: string; goingCount?: number; waitlistCount?: number; spotsLeft?: number | null; status?: string; revision?: number };
};

const readRsvp = (data: unknown): RsvpResult => {
  const body = data as Partial<RsvpResult> | null;
  const status = body?.status === 'going' || body?.status === 'waitlist' ? body.status : 'none';
  return { status, rsvp: body?.rsvp ?? null, counts: body?.counts, event: body?.event };
};

/** `PUT /gyms/events/:eventId/rsvp { status }` — idempotent; `not_going` is the API's word for "can't". */
export async function saveRsvp(eventId: string, body: { status: 'going' | 'not_going'; showOnList?: boolean; remind?: boolean }): Promise<RsvpResult> {
  const { data } = await api.put(`/gyms/events/${eventId}/rsvp`, body);
  return readRsvp(data);
}

/** Leaving through the DELETE verb: the same answer, and the oldest waitlisted member is promoted. */
export async function leaveRsvp(eventId: string): Promise<RsvpResult> {
  const { data } = await api.delete(`/gyms/events/${eventId}/rsvp`);
  return readRsvp(data);
}

export type EventAttendee = Actor & { status?: 'going' | 'waitlist'; isMutual?: boolean; showOnList?: boolean; attendedAt?: string | null };

export type EventAttendees = { attendees: EventAttendee[]; total: number; page?: number; hasNextPage?: boolean; canManage?: boolean };

export async function fetchEventAttendees(eventId: string, params: { page?: number; limit?: number } = {}): Promise<EventAttendees> {
  const { data } = await api.get(`/gyms/events/${eventId}/attendees`, { params });
  const body = data as Partial<EventAttendees> | null;
  const attendees = Array.isArray(body?.attendees) ? body.attendees.filter((a) => Boolean(a?._id)) : [];
  return { attendees, total: Number(body?.total) || attendees.length, page: body?.page, hasNextPage: body?.hasNextPage, canManage: body?.canManage };
}

/** `GET /gyms/events/:eventId/insights` (organisers) — turnout against the last session. */
export type EventInsights = {
  going?: number;
  waitlisted?: number;
  attended?: number;
  walkIns?: number;
  previous?: { eventId?: string; title?: string; startsAt?: string; attended?: number } | null;
};

export async function fetchEventInsights(eventId: string): Promise<EventInsights> {
  const { data } = await api.get(`/gyms/events/${eventId}/insights`);
  return data as EventInsights;
}

/**
 * The calendar file. The route is bearer-only (D-54: event ids are
 * enumerable, so there is no signed public link), so this is a blob read
 * through the one client and handed to the browser — the same shape as the
 * CSV export in lib/portability.ts. The path is written out here, not built
 * from a helper, so the contract audit resolves it like every other one.
 */
export async function fetchEventIcs(eventId: string): Promise<{ blob: Blob; fileName: string }> {
  const response = await api.get<Blob>(`/gyms/events/${eventId}/ics`, { responseType: 'blob' });
  const disposition = String(response.headers?.['content-disposition'] ?? '');
  const named = /filename="?([^";]+)"?/i.exec(disposition);
  return { blob: response.data, fileName: named?.[1]?.trim() || `vybe-session-${eventId.slice(-6)}.ics` };
}

/* ------------------------------------------------------------------ equipment */

export type GymEquipment = {
  gymCommunityId?: string;
  bars?: { name: string; weightKg: number }[];
  dumbbellsKg?: number[];
  platesKg?: number[];
  machines?: { name: string; note?: string }[];
  isEmpty?: boolean;
  updatedBy?: Actor | null;
  updatedAt?: string | null;
  revision?: number;
  limits?: { bars?: number; dumbbellsKg?: number; platesKg?: number; machines?: number };
};

/** A gym nobody has described yet is not a 404: it reads as the empty inventory. */
export async function fetchEquipment(communityId: string): Promise<GymEquipment | null> {
  const { data } = await api.get(`/gyms/community/${communityId}/equipment`);
  const body = (data as { equipment?: GymEquipment } | null)?.equipment;
  return body && typeof body === 'object' ? body : null;
}

/** "11 dumbbells · 7 plates · 2 bars": what the About tab says when the floor is described. */
export function equipmentSummary(equipment?: GymEquipment | null): string | null {
  if (!equipment || equipment.isEmpty === true) return null;
  const parts: string[] = [];
  const bars = equipment.bars?.length || 0;
  const dumbbells = equipment.dumbbellsKg?.length || 0;
  const plates = equipment.platesKg?.length || 0;
  const machines = equipment.machines?.length || 0;
  if (bars) parts.push(bars === 1 ? '1 bar' : `${bars} bars`);
  if (dumbbells) parts.push(dumbbells === 1 ? '1 dumbbell' : `${dumbbells} dumbbells`);
  if (plates) parts.push(plates === 1 ? '1 plate size' : `${plates} plate sizes`);
  if (machines) parts.push(machines === 1 ? '1 machine' : `${machines} machines`);
  return parts.length ? parts.join(' · ') : null;
}

/* ------------------------------------------------------------------ client request ids */

/**
 * `CLIENT_REQUEST_ID_PATTERN`: 16–100 of `[A-Za-z0-9_-]`. Announcements and
 * moderation actions are keyed on one, so a retry replays rather than
 * doubling; the id is minted per attempt and reused until it succeeds.
 */
export function clientRequestId(prefix = 'web'): string {
  const random = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random()}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100).padEnd(16, '0');
}
