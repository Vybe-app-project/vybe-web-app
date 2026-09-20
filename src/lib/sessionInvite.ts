/**
 * Pure rules for the Together-session landing (/session/:id and
 * /session/invite/:token): the API's payload shapes, the id-or-token link
 * dispatch, the state copy table, the viewer-reason sentences, the action
 * truth table and the fixed strings. No React and no network so the tests
 * can load it through tests/ts-loader.mjs.
 *
 * Source of truth: backend services/togetherSessions.js (`presentSession`,
 * `viewerStateFor`, `joinSession`, `cancelSession`) and the mobile strings
 * (v2-main-mobile/src/strings/sessions.ts), which the sentences here match
 * word for word. Sentence case, no exclamation marks, never a sentence that
 * names why two people cannot share a room, nothing that ranks people or
 * mentions the body (DP-004/DP-005).
 */
import { fmtStamp, plural } from './format';
import { appDeepLink } from './shareLinks';

/* ------------------------------------------------------------------ shapes */

export type SessionStatus = 'scheduled' | 'lobby' | 'live' | 'ended' | 'cancelled';
export type SessionVisibility = 'invite' | 'followers' | 'gym';
export type SessionEndReason = 'host' | 'empty' | 'maximum-duration' | 'cancelled';
export type ViewerReason = 'full' | 'ended' | 'cancelled' | 'late' | 'removed' | 'not_invited' | 'unavailable';

/** utils/publicUser.js toPublicActor; a deleted account arrives as `{ _id }` only. */
export type SessionActor = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  isVerified?: boolean;
  isIdentityVerified?: boolean;
};

export type SessionProgress = { exerciseIndex: number; setsDone: number; totalSets: number; updatedAt: string | null };

export type SessionParticipant = {
  user: SessionActor;
  role: 'host' | 'participant';
  joinedAt: string;
  leftAt: string | null;
  shareProgress: boolean;
  /** Present only when the API process hosts the socket server. */
  online?: boolean;
  /** Sharers and the caller's own row only. */
  progress?: SessionProgress | null;
  completedAt?: string | null;
  highFivesGiven?: number;
  highFivesReceived?: number;
  reminder?: boolean;
  workoutLogId?: string | null;
};

export type SessionSnapshot = {
  title: string;
  category: string;
  plannedMinutes: number;
  exercises: Array<{ name: string; sets: number; exerciseId?: string }>;
};

export type TogetherSession = {
  _id: string;
  title: string;
  host: SessionActor;
  createdBy: string;
  program: { kind: 'workout' | 'planDay'; workoutId: string; planId?: string; week?: number; day?: number };
  snapshot: SessionSnapshot;
  status: SessionStatus;
  /** For a "now" session this is the creation instant. */
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  maximumEndsAt: string | null;
  /** startedAt + 15 min, only while live. */
  lateJoinUntil: string | null;
  endReason: SessionEndReason | null;
  /** '' when none. */
  cancelReason: string;
  visibility: SessionVisibility;
  communityId: string | null;
  community?: { _id: string; name: string };
  capacity: number;
  /** Active members only. */
  participantCount: number;
  spotsLeft: number;
  isFull: boolean;
  /** Includes members who left (leftAt set); [] for a removed viewer. */
  participants: SessionParticipant[];
  chatRoomId: string | null;
  reminderSentAt: string | null;
  summary: { durationSec: number; participantCount: number; completedCount: number; highFives: number } | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionViewer = {
  /** Active participant. */
  joined: boolean;
  isHost: boolean;
  shareProgress: boolean;
  /** True for an active participant too (idempotent join). */
  canJoin: boolean;
  reason?: ViewerReason;
};

export type SessionEnvelope = { session: TogetherSession; viewer: SessionViewer };

/* ------------------------------------------------------------------ link shapes */

/** mongoose.isValidObjectId: 24 hex, either case. */
export const SESSION_ID = /^[a-f0-9]{24}$/i;
/** utils/shareToken.js TOKEN_PATTERN: 64 lowercase hex; uppercase hashes to null and is a 404. */
export const INVITE_TOKEN = /^[a-f0-9]{64}$/;

export type SessionLookup = { kind: 'id' | 'token' | 'invalid'; value: string };

/**
 * The route param of /session/:id is either a 24-hex session id (the mobile
 * share link) or the API's 64-hex invite token (`inviteUrl`); the mobile app
 * dispatches by shape too (utils/deepLinks.ts). Anything else is a bad link.
 */
export function sessionLookup(param: string | null | undefined): SessionLookup {
  const value = typeof param === 'string' ? param.trim() : '';
  if (SESSION_ID.test(value)) return { kind: 'id', value };
  if (INVITE_TOKEN.test(value)) return { kind: 'token', value };
  return { kind: 'invalid', value };
}

/** vybe://open?type=session&id=<id or token>; the app resolves a 64-hex value as an invite token. */
export const sessionDeepLink = (idOrToken: string): string => appDeepLink('session', idOrToken);

/* ------------------------------------------------------------------ constants */

export const OPEN_STATUSES: readonly SessionStatus[] = ['scheduled', 'lobby', 'live'];
/** SESSIONS_LATE_JOIN_MINUTES default; the API's sentence names the number. */
export const LATE_JOIN_MINUTES = 15;
export const LOBBY_LEAD_MINUTES = 10;
export const CANCEL_REASON_MAX = 200;
/** cancelReason services/sessionReportTarget.js writes; the host did not cancel that one. */
const MODERATION_CANCEL_REASON = 'Removed by moderation';

export const SESSIONS_OFF_TITLE = 'Training together isn’t available right now.';
export const SESSIONS_OFF_BODY = 'Sessions are switched off on this server. Check back later.';
export const ROLLOUT_NOTE = 'Training together is still rolling out. This link works because you were invited.';
export const ROOM_NOTE = 'The live room, progress and high fives are in the Vybe app. This page shows the details and lets you join or leave.';
export const INVALID_LINK_TITLE = 'This link isn’t valid';
export const INVALID_LINK_BODY = 'It may have been cut short when it was copied. Ask the host for it again.';
export const UNAVAILABLE_TITLE = 'This session isn’t available.';
export const UNAVAILABLE_BODY = 'It may have been cancelled, or the link may be for someone else. Ask the host for a fresh link.';
export const SIGNED_OUT_TITLE = 'Train together on Vybe';
export const SIGNED_OUT_SUBTITLE = 'Sign in to see who’s in and join. If you have the Vybe app, open it there.';
export const OPEN_IN_APP = 'Open in the Vybe app';
export const SHARE_PROGRESS_LABEL = 'Share my progress';
/** D-37 (mobile privacy.progressHelper). */
export const SHARE_PROGRESS_HELPER = 'People in this session see which exercise you’re on and how many sets you’ve done. Never your weights.';
export const LEAVE_TITLE = 'Leave session?';
export const CANCEL_TITLE = 'Cancel session?';
export const CANCEL_MESSAGE = 'Cancel this session? Everyone who joined will be told.';
export const CANCEL_CONFIRM_LABEL = 'Cancel session';
export const CANCEL_REASON_LABEL = 'Reason (optional)';
export const JUST_YOU = 'Just you so far';

/* ------------------------------------------------------------------ names and times */

/** Mobile `actorName`: fullName, then username, then "someone". */
export const actorName = (actor?: SessionActor | null): string => actor?.fullName?.trim() || actor?.username || 'someone';

export const hostName = (session: Pick<TogetherSession, 'host'>): string => actorName(session.host);

export const programTitle = (session: Pick<TogetherSession, 'snapshot' | 'title'>): string => session.snapshot?.title || session.title;

export type SessionTimeOptions = { timeZone?: string; locale?: string };

/** "Sep 25, 2026, 18:00 EDT" in the viewer's zone; pass `timeZone` in tests. */
export function formatSessionTime(iso: string | null | undefined, opts: SessionTimeOptions = {}): string {
  return fmtStamp(iso, { timeZone: opts.timeZone, locale: opts.locale });
}

export const isOpenStatus = (status: SessionStatus): boolean => OPEN_STATUSES.includes(status);

export const activeParticipants = (session: Pick<TogetherSession, 'participants'>): SessionParticipant[] =>
  (session.participants || []).filter((participant) => !participant.leftAt);

/* ------------------------------------------------------------------ state copy */

export type StateTone = 'info' | 'success' | 'warning' | 'neutral';
export type StateCopy = { title: string; body: string | null; tone: StateTone };
export type StateCopyOptions = SessionTimeOptions & { now?: Date };

const instant = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/** The headline and body of the state block, one row per status. */
export function sessionStateCopy(
  session: Pick<TogetherSession, 'status' | 'scheduledAt' | 'startedAt' | 'lateJoinUntil' | 'endReason' | 'cancelReason' | 'host'>,
  viewer: Pick<SessionViewer, 'joined' | 'isHost'>,
  opts: StateCopyOptions = {},
): StateCopy {
  const host = hostName(session);
  const time = (iso: string | null | undefined) => formatSessionTime(iso, opts);
  const now = (opts.now ?? new Date()).getTime();
  switch (session.status) {
    case 'scheduled':
      return { title: `Starts ${time(session.scheduledAt)}`, body: `The room opens ${LOBBY_LEAD_MINUTES} minutes before the start.`, tone: 'info' };
    case 'lobby':
      return { title: 'Starting soon', body: viewer.isHost ? 'Start it from the Vybe app.' : `Waiting for ${host} to start.`, tone: 'info' };
    case 'live': {
      const lines = [`Started ${time(session.startedAt)}.`];
      const until = instant(session.lateJoinUntil);
      if (!viewer.joined && until !== null && until > now) lines.push(`You can join until ${time(session.lateJoinUntil)}.`);
      return { title: 'Live now', body: lines.join(' '), tone: 'success' };
    }
    case 'ended':
      return { title: 'This session has ended.', body: 'The summary is in the Vybe app.', tone: 'neutral' };
    case 'cancelled':
    default: {
      if (session.endReason === 'empty') {
        return { title: 'This session closed before it started.', body: 'Everyone left before the start.', tone: 'neutral' };
      }
      const reason = String(session.cancelReason || '').trim();
      if (reason === MODERATION_CANCEL_REASON) {
        return { title: 'This session was removed.', body: 'It is no longer available.', tone: 'neutral' };
      }
      return { title: `${host} cancelled this session.`, body: reason || null, tone: 'neutral' };
    }
  }
}

/** The API's sentences (and the mobile `state.*` strings), by viewer.reason. */
export function viewerReasonCopy(reason: ViewerReason, host = 'The host'): string {
  switch (reason) {
    case 'full':
      return 'This session is full.';
    case 'ended':
      return 'This session has ended.';
    case 'cancelled':
      return `${host} cancelled this session.`;
    case 'late':
      return `This session started more than ${LATE_JOIN_MINUTES} minutes ago. You can still open the program on your own.`;
    case 'removed':
      return 'The host removed you from this session. You can still finish your workout.';
    case 'not_invited':
      return 'This session is invite-only. Ask the host for a link.';
    case 'unavailable':
    default:
      return 'This session isn’t available.';
  }
}

/**
 * The reason sentence worth printing under the state block: the ended and
 * cancelled reasons repeat the headline, so only the others come back.
 */
export function viewerReasonLine(viewer: Pick<SessionViewer, 'reason'>, host: string): string | null {
  const { reason } = viewer;
  if (!reason || reason === 'ended' || reason === 'cancelled') return null;
  return viewerReasonCopy(reason, host);
}

/* ------------------------------------------------------------------ actions */

export type SessionActions = {
  join: boolean;
  leave: boolean;
  cancel: boolean;
  openInApp: boolean;
  openProgram: boolean;
};

/**
 * What the API lets this viewer do. Start and End are never offered: the
 * room is socket-only and the web has no client, so a host starting here
 * would strand everyone in a live room.
 */
export function sessionActions(session: Pick<TogetherSession, 'status'>, viewer: SessionViewer): SessionActions {
  const open = isOpenStatus(session.status);
  return {
    join: open && !viewer.joined && viewer.canJoin,
    leave: open && viewer.joined,
    cancel: viewer.isHost && viewer.joined && (session.status === 'scheduled' || session.status === 'lobby'),
    openInApp: true,
    openProgram: viewer.reason === 'late',
  };
}

/** Mobile `viewerReasonFromError`: the join refusals that map to a viewer reason. */
export function viewerReasonFromCode(code: string | null | undefined): ViewerReason | null {
  switch (code) {
    case 'SESSION_FULL':
      return 'full';
    case 'SESSION_ENDED':
      return 'ended';
    case 'SESSION_CANCELLED':
      return 'cancelled';
    case 'SESSION_LATE':
      return 'late';
    case 'SESSION_REMOVED':
      return 'removed';
    case 'SESSION_NOT_INVITED':
      return 'not_invited';
    case 'SESSION_UNAVAILABLE':
      return 'unavailable';
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ lines */

/** "2 of 8 in · 6 spots left", or "… · Full". */
export function countLine(session: Pick<TogetherSession, 'participantCount' | 'capacity' | 'spotsLeft' | 'isFull'>): string {
  const count = Number(session.participantCount) || 0;
  const capacity = Number(session.capacity) || 0;
  const spots = Math.max(0, Number(session.spotsLeft) || 0);
  const tail = session.isFull || spots === 0 ? 'Full' : `${plural(spots, 'spot')} left`;
  return `${count} of ${capacity} in · ${tail}`;
}

/** "Invite only" | "Sam’s followers" | "Iron Works members" (or "Gym members"). */
export function visibilityLine(session: Pick<TogetherSession, 'visibility' | 'host' | 'community'>): string {
  switch (session.visibility) {
    case 'followers':
      return `${hostName(session)}’s followers`;
    case 'gym':
      return session.community?.name ? `${session.community.name} members` : 'Gym members';
    case 'invite':
    default:
      return 'Invite only';
  }
}

/** "5 exercises · 45 min" (the minutes only when known). */
export function programLine(session: Pick<TogetherSession, 'snapshot'>): string {
  const exercises = session.snapshot?.exercises?.length ?? 0;
  const minutes = Number(session.snapshot?.plannedMinutes) || 0;
  const head = plural(exercises, 'exercise');
  return minutes > 0 ? `${head} · ${minutes} min` : head;
}

/** The people-list empty copy: nothing for a redacted (removed) viewer, "Just you so far" for a lone host. */
export function emptyPeopleLine(
  session: Pick<TogetherSession, 'participants' | 'host'>,
  viewer: Pick<SessionViewer, 'isHost' | 'reason'>,
): string | null {
  if (viewer.reason === 'removed') return null;
  const active = activeParticipants(session);
  if (active.length !== 1) return null;
  return viewer.isHost ? JUST_YOU : `${hostName(session)} is the only one in so far.`;
}

/** The leave confirmation, honest about the room's two side effects. */
export function leaveConfirmMessage(viewer: Pick<SessionViewer, 'isHost'>, activeCount: number): string {
  const parts = ['Leave this session? You can rejoin while there is room.'];
  if (activeCount <= 1) parts.push('You are the last one in, so the session closes.');
  else if (viewer.isHost) parts.push('Hosting passes to the next person.');
  return parts.join(' ');
}

/** The program page for the late-join fallback. */
export const programPath = (session: Pick<TogetherSession, 'program'>): string | null =>
  session.program?.workoutId ? `/workouts/${encodeURIComponent(String(session.program.workoutId))}` : null;
