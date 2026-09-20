/**
 * Invite friends (Wave F, design-first-week-and-people.md §3.3, §4, §5.4):
 * the member's own code and link from GET /invites/me, the people who joined
 * from it, the contextual gym and challenge codes from POST /invites, and the
 * words on the card. The pure part; the card and the sheet live in
 * src/pages/settings/InviteFriendsSection.tsx and src/pages/InviteLinkSheet.tsx.
 * src/lib/invites.ts (the code rule and the public landing) is left as it is.
 * tests/people-invites.test.mjs imports this file directly.
 */
import { parseApiError } from './apiError';
import { normaliseInviteCode } from './invites';

/** The universal link the API mints in production (FRONTEND_URL/join/<CODE>). */
export const INVITE_LINK_ORIGIN = 'https://vybeapp.fit';
export const inviteLink = (code: string): string => `${INVITE_LINK_ORIGIN}/join/${code}`;

export type InviteActor = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string | null;
  isIdentityVerified?: boolean;
};

export type JoinedEntry = { user: InviteActor; at: string | null; kind: string };

export type ContextualKind = 'gym' | 'challenge';

export type ContextualInvite = {
  code: string;
  url: string;
  kind: ContextualKind;
  targetId: string | null;
  targetName: string | null;
  redemptionCount: number;
  /** POST /invites answers 201 created:true when minted, 200 created:false when the link already existed. */
  created: boolean;
};

export type MyInvites = {
  code: string;
  url: string;
  joined: JoinedEntry[];
  /** Every redemption; can exceed joined.length (accounts no longer visible drop out of the list). */
  joinedCount: number;
  contextual: ContextualInvite[];
  /** D-45 opt-in: the public /join page shows the avatar only when true. */
  showAvatar: boolean;
};

const HTTPS_URL = /^https:\/\/[^\s]+$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const wholeCount = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;

/** The API's link when it is https (production); otherwise the canonical form, so a test host never leaks into a share. */
const linkFor = (value: unknown, code: string): string => (typeof value === 'string' && HTTPS_URL.test(value.trim()) ? value.trim() : inviteLink(code));

const actorOf = (value: unknown): InviteActor | null => {
  if (!isRecord(value) || typeof value._id !== 'string' || !value._id) return null;
  return {
    _id: value._id,
    ...(typeof value.username === 'string' ? { username: value.username } : {}),
    ...(typeof value.fullName === 'string' ? { fullName: value.fullName } : {}),
    ...(typeof value.avatar === 'string' && value.avatar ? { avatar: value.avatar } : {}),
    ...(value.isIdentityVerified === true ? { isIdentityVerified: true } : {}),
  };
};

/** One contextual code (a POST /invites answer or an entry of GET /invites/me contextual). */
export function parseContextualInvite(body: unknown): ContextualInvite | null {
  if (!isRecord(body)) return null;
  const code = normaliseInviteCode(body.code);
  if (!code) return null;
  if (body.kind !== 'gym' && body.kind !== 'challenge') return null;
  return {
    code,
    url: linkFor(body.url, code),
    kind: body.kind,
    targetId: text(body.targetId),
    targetName: text(body.targetName),
    redemptionCount: wholeCount(body.redemptionCount, 0),
    created: body.created === true,
  };
}

/** GET /invites/me into one shape, or null when the body is not the member's invites (an older API, a proxy page). */
export function parseMyInvites(body: unknown): MyInvites | null {
  if (!isRecord(body)) return null;
  const code = normaliseInviteCode(body.code);
  if (!code) return null;
  const joined: JoinedEntry[] = [];
  if (Array.isArray(body.joined)) {
    for (const entry of body.joined) {
      if (!isRecord(entry)) continue;
      const user = actorOf(entry.user);
      if (!user) continue;
      joined.push({ user, at: text(entry.at), kind: typeof entry.kind === 'string' ? entry.kind : 'general' });
    }
  }
  const contextual: ContextualInvite[] = [];
  if (Array.isArray(body.contextual)) {
    for (const entry of body.contextual) {
      const invite = parseContextualInvite(entry);
      if (invite) contextual.push(invite);
    }
  }
  const settings = isRecord(body.settings) ? body.settings : {};
  return {
    code,
    url: linkFor(body.url, code),
    joined,
    joinedCount: wholeCount(body.joinedCount, joined.length),
    contextual,
    showAvatar: settings.showAvatar === true,
  };
}

/* ------------------------------------------------------------------ words */

/** The first word of the name; the handle when there is none; never an email. */
export function firstNameOf(user: Partial<InviteActor> | null | undefined): string {
  const full = typeof user?.fullName === 'string' ? user.fullName.trim() : '';
  const first = full.split(/\s+/)[0];
  if (first) return first;
  const handle = typeof user?.username === 'string' ? user.username.trim() : '';
  return handle || 'Someone';
}

/** "1 person joined from your invite" / "3 people joined from your invite". */
export function joinedLine(count: number): string {
  const n = Math.max(0, Math.floor(count));
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'person' : 'people'} joined from your invite`;
}

/** The people counted in joinedCount but not listed (no longer visible to the member). */
export const moreJoinedLine = (count: number): string => `and ${Math.max(0, Math.floor(count)).toLocaleString('en-US')} more`;

export const SHARE_TITLE = 'Join me on Vybe';
export const shareText = (url: string): string => `${SHARE_TITLE}. ${url}`;

export const INVITE_TITLE = 'Invite friends';
export const inviteTitleFor = (name: string): string => `Invite to ${name}`;
export const YOUR_LINK = 'Your link';
export const HONEST = 'Anyone with this link can follow you. You can make a new one.';
export const ABOUT = 'Vybe gives nothing for an invite. The only thing you get is the person.';
export const COPY_CODE = 'Copy code';
export const COPY_LINK = 'Copy link';
export const SHARE = 'Share';
export const CODE_COPIED = 'Code copied';
export const LINK_COPIED = 'Link copied';
export const NEW_LINK = 'New link';
export const NEW_LINK_TITLE = 'Make a new link?';
export const NEW_LINK_BODY = 'The old link stops working. People who already joined stay.';
export const NEW_LINK_CONFIRM = 'Make new';
export const KEEP_LINK = 'Keep';
export const NEW_LINK_READY = 'New link ready';
export const WHO_JOINED = 'Who joined';
export const JOINED_EMPTY = 'When someone joins from your link, their name shows here';
export const JOINED_LIST_LABEL = 'People who joined from your invite';
export const CONTEXTUAL_HEADING = 'Your gym and challenge links';
export const SHOW_AVATAR_TITLE = 'Show my photo on the invite page';
export const SHOW_AVATAR_HINT = 'Otherwise the page shows your first name only.';
export const INVITE_ERROR = 'Couldn’t load your invite link.';
export const RETRY = 'Retry';
export const INVITE_ACTION = 'Invite';
export const MINT_FAILED = 'Could not make an invite link.';
export const GYM_LINK_LINE = 'Anyone with this link lands on you and this community.';
export const CHALLENGE_LINK_LINE = 'Anyone with this link lands on you and this challenge.';

/** What a contextual code is about when the API sent no name. */
export const contextualFallbackName = (kind: ContextualKind): string => (kind === 'gym' ? 'this community' : 'this challenge');

/* ------------------------------------------------------------------ errors */

/**
 * The refusals of POST /invites in the API's own words (services/invitesCopy.js),
 * keyed by code so a changed server sentence never reaches the screen unread.
 * Null for anything else; the caller falls back to the parsed message.
 */
export function contextualInviteError(code: string | null | undefined, kind: ContextualKind): string | null {
  switch (code) {
    case 'INVITES_NOT_ALLOWED':
      return kind === 'gym' ? 'This community is not taking invites right now.' : 'This challenge is not taking invites right now.';
    case 'INVITE_MEMBERSHIP_REQUIRED':
      return 'Join the community before inviting people to it.';
    case 'INVITE_PARTICIPATION_REQUIRED':
      return 'Join the challenge before inviting people to it.';
    case 'INVITE_LIMIT_REACHED':
      return 'You made a lot of invite links today. Try again tomorrow.';
    case 'INVITE_TARGET_NOT_FOUND':
      return 'We could not find that community or challenge.';
    default:
      return null;
  }
}

/** A 404 whose body says FEATURE_DISABLED: the flag turned off for this caller; hide, never an error card. */
export const isFeatureDisabledError = (e: unknown): boolean => parseApiError(e).code === 'FEATURE_DISABLED';

/** The sentence for a failed POST /invites: the known refusal, else the parsed message (never axios text). */
export function contextualInviteMessage(e: unknown, kind: ContextualKind, fallback = MINT_FAILED): string {
  const parsed = parseApiError(e, fallback);
  return contextualInviteError(parsed.code, kind) ?? parsed.message;
}
