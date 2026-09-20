/**
 * Redeeming an invite code on the web (Wave F, design-first-week-and-people.md
 * §3.2 "Have a code?", §3.4, §4, §5.4). POST /invites/:code/redeem answers
 * `{ inviter, outcome: { follow, gym, challenge }, kind, targetId, at }` and
 * no target name, so the sentences take the names from the public preview
 * read first, or fall back to "the gym" / "the challenge". The pure part:
 * the body reader, the outcome sentences, the refusal sentences, the
 * idempotency key and the words on the form. tests/people-invites.test.mjs
 * imports this file directly.
 */
import { parseApiError } from './apiError';
import { REVOKED_COPY, UNKNOWN_CODE_COPY } from './invites';

export const FOLLOW_OUTCOMES = ['followed', 'requested', 'already', 'blocked'] as const;
export const GYM_OUTCOMES = ['joined', 'requested', 'none'] as const;
export const CHALLENGE_OUTCOMES = ['joined', 'none'] as const;

export type RedeemOutcome = {
  follow: (typeof FOLLOW_OUTCOMES)[number];
  gym: (typeof GYM_OUTCOMES)[number];
  challenge: (typeof CHALLENGE_OUTCOMES)[number];
};

export type RedeemActor = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string | null;
  isIdentityVerified?: boolean;
};

export type RedeemBody = {
  inviter: RedeemActor | null;
  outcome: RedeemOutcome;
  kind: string;
  targetId: string | null;
  /** The same account redeemed this code before; the stored outcome is answered and nothing is written twice. */
  replayed: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const oneOf = <T extends readonly string[]>(list: T, value: unknown): value is T[number] => typeof value === 'string' && (list as readonly string[]).includes(value);

/** The redeem answer into one shape, or null when a field is outside the contract (the caller shows the generic failure). */
/** The public actor the API attaches to a redemption (200 `inviter`, and since a08b42e the 409 INVITE_ALREADY_USED body); null when absent or a blocked pair. */
export function parseRedeemActor(raw: unknown): RedeemActor | null {
  if (!isRecord(raw) || typeof raw._id !== 'string' || !raw._id) return null;
  return {
    _id: raw._id,
    ...(typeof raw.username === 'string' ? { username: raw.username } : {}),
    ...(typeof raw.fullName === 'string' ? { fullName: raw.fullName } : {}),
    ...(typeof raw.avatar === 'string' && raw.avatar ? { avatar: raw.avatar } : {}),
    ...(raw.isIdentityVerified === true ? { isIdentityVerified: true } : {}),
  };
}

/**
 * The inviter named by a 409 INVITE_ALREADY_USED refusal (API a08b42e): the
 * account already used an invite, but this code's inviter stays reachable,
 * the way the app keeps their profile a tap away. Null for any other failure
 * or for a blocked pair.
 */
export function redeemRefusalInviter(e: unknown): RedeemActor | null {
  const failure = (e && typeof e === 'object' ? e : {}) as { response?: { status?: number; data?: unknown } };
  const data = failure.response?.data;
  if (failure.response?.status !== 409 || !isRecord(data) || data.code !== 'INVITE_ALREADY_USED') return null;
  return parseRedeemActor(data.inviter);
}

export function parseRedeemBody(body: unknown): RedeemBody | null {
  if (!isRecord(body) || !isRecord(body.outcome)) return null;
  const { follow, gym, challenge } = body.outcome;
  if (!oneOf(FOLLOW_OUTCOMES, follow) || !oneOf(GYM_OUTCOMES, gym) || !oneOf(CHALLENGE_OUTCOMES, challenge)) return null;
  const inviter = parseRedeemActor(body.inviter);
  return {
    inviter,
    outcome: { follow, gym, challenge },
    kind: typeof body.kind === 'string' ? body.kind : 'general',
    targetId: typeof body.targetId === 'string' && body.targetId ? body.targetId : null,
    replayed: body.replayedRedemption === true || body.replayed === true,
  };
}

/** The inviter's name for the sentences: full name, else handle, else nothing (the caller falls back). */
export function actorName(actor: Partial<RedeemActor> | null | undefined): string | null {
  const full = typeof actor?.fullName === 'string' ? actor.fullName.trim() : '';
  if (full) return full;
  const handle = typeof actor?.username === 'string' ? actor.username.trim() : '';
  return handle || null;
}

/* ------------------------------------------------------------------ outcome copy */

export const BLOCKED_COPY = 'Couldn’t use this invite.';
/** When the inviter is no longer presentable (a replay after they left) and no preview named them. */
export const INVITER_FALLBACK = 'the person who invited you';
export const GYM_FALLBACK = 'the gym';
export const CHALLENGE_FALLBACK = 'the challenge';

/**
 * The sentences after a redemption, in order (spec §4 redeem.*): the follow
 * line, then the gym or challenge line when the invite was about one. A
 * blocked pair reads one neutral sentence and nothing else (spec §6).
 */
export function redeemOutcomeCopy(
  outcome: RedeemOutcome,
  { inviterName, targetName }: { inviterName?: string | null; kind?: string | null; targetName?: string | null } = {},
): string[] {
  if (outcome.follow === 'blocked') return [BLOCKED_COPY];
  const who = inviterName && inviterName.trim() ? inviterName.trim() : INVITER_FALLBACK;
  const lines: string[] = [];
  if (outcome.follow === 'followed') lines.push(`You now follow ${who}`);
  else if (outcome.follow === 'requested') lines.push(`Follow request sent to ${who}`);
  else if (outcome.follow === 'already') lines.push(`You already follow ${who}`);
  const gym = targetName && targetName.trim() ? targetName.trim() : GYM_FALLBACK;
  if (outcome.gym === 'joined') lines.push(`You joined ${gym}`);
  else if (outcome.gym === 'requested') lines.push(`Asked to join ${gym}`);
  if (outcome.challenge === 'joined') lines.push(`You joined ${targetName && targetName.trim() ? targetName.trim() : CHALLENGE_FALLBACK}`);
  return lines;
}

/* ------------------------------------------------------------------ refusals */

export const CODE_INVALID = UNKNOWN_CODE_COPY;
export const CODE_EXPIRED = REVOKED_COPY;
export const CODE_OWN = 'That’s your own code.';
export const CODE_USED = 'You already used an invite.';
export const INVITES_UNAVAILABLE = 'Invites arrive with a later update.';
export const REDEEM_FAILED = 'Could not use that code.';
/** The web's own refusal for a value that is not a code; never sent to the API. */
export const MALFORMED_CODE = 'INVITE_MALFORMED';

/**
 * The sentence for a refused redeem, by the API's code first and the status
 * second (an older API without codes still reads right). Null for anything
 * else (a 429, a 5xx, no answer): the caller shows the parsed message.
 */
export function redeemErrorCopy(code: string | null | undefined, status?: number | null): string | null {
  if (code === 'FEATURE_DISABLED') return INVITES_UNAVAILABLE;
  if (code === 'INVITE_NOT_FOUND' || code === MALFORMED_CODE) return CODE_INVALID;
  if (code === 'INVITE_REVOKED') return CODE_EXPIRED;
  if (code === 'INVITE_OWN') return CODE_OWN;
  if (code === 'INVITE_ALREADY_USED') return CODE_USED;
  if (status === 404) return CODE_INVALID;
  if (status === 410) return CODE_EXPIRED;
  if (status === 409) return CODE_USED;
  return null;
}

/** A refusal decided on the web before any request (a malformed value, the member's own code). */
export class InviteRefusal extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'InviteRefusal';
    this.code = code;
  }
}

export type RedeemFailure = { message: string; code: string | null; status: number | null };

/** One reader for whatever the redeem flow threw: our own refusal, an API answer, or no answer at all. */
export function describeRedeemError(e: unknown, fallback = REDEEM_FAILED): RedeemFailure {
  if (e instanceof InviteRefusal) return { message: e.message, code: e.code, status: null };
  const parsed = parseApiError(e, fallback);
  return { message: redeemErrorCopy(parsed.code, parsed.status) ?? parsed.message, code: parsed.code, status: parsed.status };
}

/**
 * Whether a refusal makes the stored pending code worthless: a code that is
 * unknown, revoked, already used (by this account or another way), the
 * member's own, or malformed cannot become valid later, so it is dropped. A
 * flag that is off, a rate limit, a server error or no answer keeps it.
 * A success clears the code in its own path.
 */
export function clearsPendingInvite(code: string | null | undefined): boolean {
  return code === 'INVITE_NOT_FOUND' || code === 'INVITE_REVOKED' || code === 'INVITE_OWN' || code === 'INVITE_ALREADY_USED' || code === MALFORMED_CODE;
}

/* ------------------------------------------------------------------ idempotency */

/** services/clientRequests.js CLIENT_REQUEST_ID_PATTERN: 16 to 100 letters, digits, underscores or dashes. */
export const REDEEM_REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,100}$/;

const randomToken = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
};

/** One id per (code) attempt, reused on a retry of the same code so the API answers the recorded body instead of writing twice. */
export const redeemRequestId = (code: string): string => `web-redeem-${code}-${randomToken()}`;

/* ------------------------------------------------------------------ form copy */

export const HAVE_CODE = 'Have a code?';
export const CODE_TITLE = 'Enter an invite code';
export const CODE_DESCRIPTION = 'Someone sent you an invite? Enter their code and you follow them from the start.';
export const CODE_FIELD = 'Invite code';
export const CODE_REDEEM = 'Use code';
export const CODE_HINT = 'Eight letters and numbers, for example VYBE-7K2M-Q9RX.';
export const CODE_PLACEHOLDER = 'VYBE-XXXX-XXXX';
export const REDEEMED_TITLE = 'Invite used';
export const USE_ON_WEB = 'Use this code on the web';
/** The landing's note for a signed-in member while invites are on: the web field and the app are both ways in (lib/invites SIGNED_IN_NOTE serves the flag-off path). */
export const SIGNED_IN_WEB_NOTE = 'You are signed in. Use this code here or in the app.';
/** Where the landing sends a signed-in member: Settings > Have a code? with the field prefilled. */
export const settingsInvitePath = (code: string): string => `/settings?invite=${encodeURIComponent(code)}#invite-code`;

/* ------------------------------------------------------------------ the welcome sheet's section */

export const invitedByTitle = (name: string): string => `${name} invited you`;
export const INVITED_BY_UNKNOWN = 'You have an invite code';
export const INVITED_BY_BODY = 'Follow back and you’ll see each other’s sessions.';
export const USE_INVITE = 'Use invite';
export const NOT_NOW = 'Not now';
