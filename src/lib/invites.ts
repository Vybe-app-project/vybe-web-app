/**
 * Invite codes and the /join/<code> landing (PRE-F-4).
 *
 * The API mints 8-character codes from a 32-symbol alphabet with no 0/O/1/I
 * (models/Invite.js in the v2-be-invites-people package) and shows them as
 * VYBE-XXXX-XXXX. The landing reads GET /api/public/invites/:code (no bearer,
 * per-IP limiter) and shows the inviter's first name, the target and the code
 * in plain text; redemption happens in the app (POST /invites/:code/redeem),
 * never here. This module is the pure part: the code rule, the reader for the
 * landing URL, the preview view model and the sentence for each failure.
 * tests/invite-landing.test.mjs imports it directly.
 */

import { retryWaitCopy } from './apiError';

export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;
/** A normalised code: 8 symbols from the alphabet, upper case, no separators. */
export const INVITE_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
/** The same rule before case-folding: ASCII letters in either case, nothing else. */
const INVITE_CODE_INPUT_RE = /^[A-HJ-NP-Za-hj-np-z2-9]{8}$/;
const DISPLAY_PREFIX = 'VYBE';
const DISPLAY_PREFIX_RE = /^[Vv][Yy][Bb][Ee]/;

/**
 * Read a code as a person or a link may have written it: any case, with or
 * without the VYBE- prefix, dashes or spaces ("vybe-7k2m-q9rx", "7K2M Q9RX",
 * "7k2mq9rx"). Returns the 8 upper-case symbols, or null for anything that is
 * not a code, so a malformed value never reaches the API.
 *
 * The rule is checked before the case-fold, on ASCII letters only. JavaScript
 * upper-casing maps some non-ASCII letters into the alphabet (U+017F long s
 * to S, U+00DF sharp s to SS, the U+FB00 ff ligature to FF), and folding
 * first would turn those malformed values into well-formed codes.
 */
export function normaliseInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim().replace(/[\s\-–—_]+/g, '');
  if (value.length === INVITE_CODE_LENGTH + DISPLAY_PREFIX.length && DISPLAY_PREFIX_RE.test(value)) {
    value = value.slice(DISPLAY_PREFIX.length);
  }
  return INVITE_CODE_INPUT_RE.test(value) ? value.toUpperCase() : null;
}

/** 'VYBE-7K2M-Q9RX' for a code in any accepted form; null when it is not a code. */
export function formatInviteCode(raw: unknown): string | null {
  const code = normaliseInviteCode(raw);
  if (!code) return null;
  return `${DISPLAY_PREFIX}-${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * The landing accepts the code in the path (/join/<code>, the universal link
 * the app and the AASA use) or as ?code= for a hand-built link; the path wins.
 * The value is returned as written; the caller normalises.
 */
export function readInviteCode({ param, search }: { param?: string | null; search?: string | null }): string {
  const fromPath = typeof param === 'string' ? param.trim() : '';
  if (fromPath) return fromPath;
  if (typeof search !== 'string' || !search) return '';
  try {
    return (new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('code') ?? '').trim();
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ preview */

export const INVITE_KINDS = ['general', 'gym', 'challenge'] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

export const isInviteKind = (value: unknown): value is InviteKind =>
  typeof value === 'string' && (INVITE_KINDS as readonly string[]).includes(value);

export type InvitePreview = {
  kind: InviteKind;
  inviter: {
    firstName: string;
    /** Present only when the inviter opted in (settings.invites.showAvatar). */
    avatar: string | null;
  };
  target: { kind: string; name: string; memberCount: number | null } | null;
  /** Store listings the API knows; null means there is none yet, and the page never invents one. */
  storeUrls: { ios: string | null; android: string | null };
};

const HTTPS_URL = /^https:\/\/[^\s]+$/i;

/** A store URL is shown only when the API sent an https URL; anything else is treated as absent. */
const storeUrl = (value: unknown): string | null => (typeof value === 'string' && HTTPS_URL.test(value.trim()) ? value.trim() : null);

const wholeCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/**
 * Read the body of GET /public/invites/:code into one shape, or null when it
 * is not a preview (a proxy page, an older API): the page then shows the
 * generic failure rather than a half-filled card.
 */
export function parseInvitePreview(body: unknown): InvitePreview | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (!isInviteKind(record.kind)) return null;
  const inviter = record.inviter && typeof record.inviter === 'object' ? (record.inviter as Record<string, unknown>) : null;
  const firstName = typeof inviter?.firstName === 'string' ? inviter.firstName.trim() : '';
  if (!firstName) return null;
  const avatar = typeof inviter?.avatar === 'string' && inviter.avatar.trim() ? inviter.avatar.trim() : null;
  const rawTarget = record.target && typeof record.target === 'object' ? (record.target as Record<string, unknown>) : null;
  const targetName = typeof rawTarget?.name === 'string' ? rawTarget.name.trim() : '';
  const target = rawTarget && targetName
    ? { kind: typeof rawTarget.kind === 'string' ? rawTarget.kind : record.kind, name: targetName, memberCount: wholeCount(rawTarget.memberCount) }
    : null;
  const stores = record.storeUrls && typeof record.storeUrls === 'object' ? (record.storeUrls as Record<string, unknown>) : {};
  return {
    kind: record.kind,
    inviter: { firstName, avatar },
    target,
    storeUrls: { ios: storeUrl(stores.ios), android: storeUrl(stores.android) },
  };
}

export type InvitePreviewView = {
  /** "Sam invited you to Vybe" / "Sam invited you to Iron Works". */
  title: string;
  /** What the target is, and "12 members" when the API sent a count. */
  lines: string[];
  /** The short label on the card: Invite, Gym invite, Challenge invite. */
  kindLabel: string;
  inviterName: string;
  avatar: string | null;
  targetName: string | null;
  memberCount: string | null;
};

const KIND_LABEL: Record<InviteKind, string> = {
  general: 'Invite',
  gym: 'Gym invite',
  challenge: 'Challenge invite',
};

const KIND_LINE: Record<Exclude<InviteKind, 'general'>, string> = {
  gym: 'A gym community on Vybe.',
  challenge: 'A challenge on Vybe.',
};

export const GENERAL_LINE = 'Vybe is social fitness. Workouts, meals, gyms and friends in one place.';

export function memberCountLine(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null;
  const n = Math.floor(count);
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'member' : 'members'}`;
}

/**
 * The words on the preview card, per kind. A contextual invite whose target
 * the API left out (the community is gone, the challenge ended) reads as a
 * general one: the person still lands on the inviter.
 */
export function invitePreviewView(preview: InvitePreview): InvitePreviewView {
  const first = preview.inviter.firstName;
  const target = preview.kind === 'general' ? null : preview.target;
  const memberCount = target ? memberCountLine(target.memberCount) : null;
  if (!target) {
    return {
      title: `${first} invited you to Vybe`,
      lines: [GENERAL_LINE],
      kindLabel: KIND_LABEL.general,
      inviterName: first,
      avatar: preview.inviter.avatar,
      targetName: null,
      memberCount: null,
    };
  }
  const lines = [KIND_LINE[preview.kind as Exclude<InviteKind, 'general'>]];
  if (memberCount) lines.push(memberCount);
  return {
    title: `${first} invited you to ${target.name}`,
    lines,
    kindLabel: KIND_LABEL[preview.kind],
    inviterName: first,
    avatar: preview.inviter.avatar,
    targetName: target.name,
    memberCount,
  };
}

/* ------------------------------------------------------------------ failures */

export type InviteFailure =
  | { kind: 'malformed' }
  | { kind: 'unknown-code' }
  | { kind: 'revoked' }
  | { kind: 'rate-limited'; retryAfterSec: number | null }
  | { kind: 'network' }
  | { kind: 'failed' };

/** The subset of an Axios error this module reads; structural so a hand-built error in a test fits. */
type HttpFailure = {
  code?: string;
  response?: { status?: number; data?: unknown; headers?: unknown };
};

const positiveSeconds = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return n > 0 ? n : null;
  }
  return null;
};

const retryAfterHeader = (headers: unknown): unknown => {
  if (!headers || typeof headers !== 'object') return null;
  const record = headers as Record<string, unknown> & { get?: (name: string) => unknown };
  if (typeof record.get === 'function') {
    try {
      const got = record.get('retry-after');
      if (got !== undefined && got !== null) return got;
    } catch {
      // Fall through to the plain lookup.
    }
  }
  return record['retry-after'] ?? record['Retry-After'] ?? null;
};

/**
 * Sorts a failed GET /public/invites/:code into the states the page renders.
 *
 * - No response (a network error, a timeout, or the browser reporting offline
 *   while nothing came back): a connectivity problem; Try again is offered.
 * - 404: the code is not one the API knows.
 * - 410: the inviter turned the link off.
 * - 429: the per-IP preview limiter (60 per 15 minutes); the wait comes from the body or Retry-After.
 * - Anything else: a generic failure with Try again.
 *
 * A response with a status proves the API was reached, so the offline flag
 * never overrides one: a 404 read while the phone later drops off the network
 * stays "not one we know" instead of turning into "could not reach" with a
 * retry that cannot change the answer.
 */
export function classifyInviteFailure(error: unknown, { online = true }: { online?: boolean } = {}): InviteFailure {
  const failure = (error && typeof error === 'object' ? error : {}) as HttpFailure;
  const status = failure.response?.status;
  if (failure.code === 'ERR_NETWORK') return { kind: 'network' };
  if (!status && (online === false || failure.code === 'ECONNABORTED' || failure.code === 'ETIMEDOUT')) {
    return { kind: 'network' };
  }
  if (status === 404) return { kind: 'unknown-code' };
  if (status === 410) return { kind: 'revoked' };
  if (status === 429) {
    const data = failure.response?.data as { retryAfterSec?: unknown; retryAfter?: unknown } | undefined;
    const retryAfterSec = positiveSeconds(data?.retryAfterSec) ?? positiveSeconds(data?.retryAfter) ?? positiveSeconds(retryAfterHeader(failure.response?.headers));
    return { kind: 'rate-limited', retryAfterSec };
  }
  return { kind: 'failed' };
}

export const INVITE_FAILURE_TITLE: Record<InviteFailure['kind'], string> = {
  malformed: 'That code is not one we know',
  'unknown-code': 'That code is not one we know',
  revoked: 'This link was turned off',
  'rate-limited': 'Too many requests',
  network: 'Could not reach Vybe',
  failed: 'Something went wrong',
};

export const UNKNOWN_CODE_COPY = 'That code isn’t one we know. Check the letters and try again.';
export const REVOKED_COPY = 'This link was turned off by the person who made it.';
export const NETWORK_COPY = 'Could not reach Vybe. Check your connection and try again.';
export const FAILED_COPY = 'Could not load this invite. Try again in a moment.';

/** "Too many invite links were opened from this connection. Try again in about 15 minutes." */
export function rateLimitedInviteCopy(retryAfterSec: number | null | undefined): string {
  return `Too many invite links were opened from this connection. Try again ${retryWaitCopy(retryAfterSec)}.`;
}

export function inviteFailureMessage(failure: InviteFailure): string {
  switch (failure.kind) {
    case 'malformed':
    case 'unknown-code':
      return UNKNOWN_CODE_COPY;
    case 'revoked':
      return REVOKED_COPY;
    case 'rate-limited':
      return rateLimitedInviteCopy(failure.retryAfterSec);
    case 'network':
      return NETWORK_COPY;
    case 'failed':
      return FAILED_COPY;
  }
}

/** Only a connectivity problem or a server-side failure is worth a second GET. */
export const canRetryInvite = (failure: InviteFailure): boolean => failure.kind === 'network' || failure.kind === 'failed';

/**
 * The code is still worth showing when the failure says nothing about it: a
 * rate-limited or offline recipient can type it into the app after sign-up.
 */
export const showsCodeOnFailure = (failure: InviteFailure): boolean =>
  failure.kind === 'rate-limited' || failure.kind === 'network' || failure.kind === 'failed';

/* ------------------------------------------------------------------ page copy */

export const INVITE_PAGE_TITLE = 'Your invite';
export const OPEN_IN_APP = 'Open in the Vybe app';
export const CODE_LABEL = 'Your invite code';
export const CODE_HINT = 'Enter this code after you sign up.';
export const COPY_CODE = 'Copy code';
export const CODE_COPIED = 'Code copied';
export const CODE_SELECTED = 'Copying is blocked here. The code is selected, so copy it by hand.';
export const CREATE_ACCOUNT_WEB = 'Create your account on the web';
export const SIGN_IN = 'Sign in';
export const SIGNED_IN_NOTE = 'You are signed in; open the app to use this code';
export const STORE_IOS = 'Download on the App Store';
export const STORE_ANDROID = 'Get it on Google Play';
export const APP_IN_TESTING = 'The Vybe app is in testing. Store links arrive when it is listed.';
export const LOADING_INVITE = 'Loading your invite…';

/** Where "Create your account on the web" goes: sign-up with the code kept in the URL. */
export const registerWithInvitePath = (code: string): string => `/register?invite=${encodeURIComponent(code)}`;

/** The line Register keeps visible for a person who arrived from /join/<code>. */
export function registerInviteLine(raw: unknown): string | null {
  const shown = formatInviteCode(raw);
  return shown ? `Invite code: ${shown} (use it in the app after sign-up)` : null;
}
