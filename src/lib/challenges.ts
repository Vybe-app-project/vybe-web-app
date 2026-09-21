/**
 * Challenges v2 — the fourteen routes the web has never called, and the
 * additive fields v2 spreads onto the shapes it already reads
 * (docs/api-contract.md, "Challenges v2"; routes/challenges.js,
 * services/challengeBoards.js, services/challengeHost.js).
 *
 * Two flags gate this package, both `false` at the deploy:
 *
 *   `challengesV2`          every route below `/:challengeId/invite` in
 *                           routes/challenges.js, plus the additive `me`,
 *                           `isHost`, `hostId` on the detail read and
 *                           `stats.v2` on the stats read. A gated route
 *                           answers `404 { code: 'FEATURE_DISABLED' }`, so
 *                           every read here resolves to `null` on that
 *                           answer and the surface is absent, never an
 *                           error card.
 *   `invites`               `POST /:challengeId/invite` mints a contextual
 *                           invite through services/invites.js and refuses
 *                           with the same 404 while that flag is off.
 *
 *   `challengePhotoProof`   stays false (D-99). `POST /:id/check-ins` and
 *                           the photo delete are therefore not called from
 *                           here at all: a v2 challenge is scored by the
 *                           server from logged sessions, which is the whole
 *                           trust rule (see TRUST_RULES).
 *
 * The list rows of `GET /challenges` and `GET /challenges/user` already
 * carry `me`, `groupGoal` and `daysLeft` (v2-be-h6-challenges-results,
 * services/challengeBoards.js standingsForList) whatever the flag says, so
 * the row helpers below are pure and need no query.
 *
 * Literal request paths on purpose: scripts/audit-api-contracts.cjs and
 * tests/challenges-v2-contract.test.mjs pin each one against
 * contracts/backend-routes.json.
 */
import { api } from './api';
import { apiErrorDetails, parseApiError } from './apiError';
import { useFeature, useFeatureGate } from './capabilities';

/* ------------------------------------------------------------------ flags and absence */

export const CHALLENGES_V2_FLAG = 'challengesV2';
export const CHALLENGE_INVITES_FLAG = 'invites';
/** Built, never called: photo proof stays off (D-99, services/challengeHost.js). */
export const CHALLENGE_PHOTO_PROOF_FLAG = 'challengePhotoProof';

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

/**
 * A v2 read that the server may refuse for a reason that means "not for
 * you": the flag is off (`404 FEATURE_DISABLED`), the challenge is not
 * visible (`404 CHALLENGE_NOT_FOUND`), the board belongs to a
 * participants-only challenge the viewer has not joined (`403`). All three
 * resolve to `null` so the pane renders nothing; anything else still throws
 * and keeps its error state.
 */
export async function absentOnRefusal<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    const status = apiErrorDetails(e).status;
    if (status === 404 || status === 403) return null;
    throw e;
  }
}

/**
 * Both switches a v2 surface needs, with the query state a page gate wants.
 * `isPending` is true until the capabilities query has answered, so the
 * page holds the v1 view rather than flashing a v2 one that then vanishes.
 */
export function useChallengesV2(): { enabled: boolean; invites: boolean; isPending: boolean } {
  // Both read the one shared capabilities query, so two named flags cost one
  // request (tests/client-policy pins that nothing outside the hook reads
  // the raw map).
  const gate = useFeatureGate(CHALLENGES_V2_FLAG);
  const invites = useFeature(CHALLENGE_INVITES_FLAG);
  return { enabled: gate.enabled, invites, isPending: gate.isPending };
}

/* ------------------------------------------------------------------ shapes */

/** `head_to_head` is reserved on the enum and refused at create (D-100). */
export type ChallengeMode = 'group_goal' | 'board' | 'head_to_head';
export type ChallengeMetric = 'session_days' | 'minutes' | 'check_ins' | 'habit_ticks';
export type ChallengeProof = 'none' | 'photo_or_device' | 'same_day_photo';
export type ChallengeVisibility = 'participants' | 'community' | 'followers';
export type ChallengeJoinPolicy = 'open' | 'approval';
export type ParticipantState = 'accepted' | 'active' | 'removed' | 'left';

export type BoardPeriod = 'week' | 'last' | 'all';
/** `challenge`, `follows`, or `community:<24-hex>`. */
export type BoardScope = string;

export const BOARD_PERIODS: readonly BoardPeriod[] = ['week', 'last', 'all'];

export type ChallengeActor = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  isVerified?: boolean;
};

/**
 * `me`, `groupGoal` and `daysLeft` as every list row carries them
 * (standingsForList). `me.rank` is null on a Group Goal — a pooled target
 * has no ranks, ever (design §5.2) — and null before the first counted day.
 */
export type ChallengeStanding = {
  me?: { rank: number | null; progress: number; joined: boolean };
  groupGoal?: { total: number; target: number } | null;
  /** Whole days to the last local day; 0 on that day, null once it has passed. */
  daysLeft?: number | null;
};

/** The detail read's own `me`: the seat, not the score (getChallengeDetails). */
export type ChallengeSeat = {
  state: ParticipantState;
  joinedAt?: string;
  joinedDay?: number | null;
  muted: boolean;
  standings: boolean;
};

export type ChallengeBoardEntry = {
  rank: number;
  user: ChallengeActor | null;
  score: number;
  isMe: boolean;
  /** 1-based day of the window the member joined on; null for a pre-start seat. */
  joinedDay?: number | null;
};

export type ChallengeBoardMe = {
  score: number;
  rank: number | null;
  daysDone: number;
  joinedDay?: number | null;
};

export type ChallengeBoardRange = {
  key: BoardPeriod;
  weekKey: string | null;
  start: string;
  end: string;
  timezone: string;
  resetsOn: string;
};

export type ChallengeGroupGoal = {
  target: number;
  total: number;
  myPart: number;
  contributors: { user: ChallengeActor; score: number; lastAt: string | null }[];
  reachedAt: string | null;
};

/** `GET /challenges/:id/board` (services/challengeBoards.js boardFor). */
export type ChallengeBoard = {
  mode: ChallengeMode;
  metric: ChallengeMetric;
  dailyCap: number | null;
  proof: ChallengeProof;
  range: ChallengeBoardRange;
  /** The top ten, ranked; empty on a Group Goal and for a known minor. */
  entries: ChallengeBoardEntry[];
  me: ChallengeBoardMe;
  /** The five ranked rows either side of the viewer, when `around=me` and they sit outside the top. */
  around: ChallengeBoardEntry[];
  groupGoal: ChallengeGroupGoal | null;
  participants: number;
  /** A known minor reads their own row alone (D-91). */
  justMe: boolean;
  asOf: string;
};

/** The legacy board shape `GET /challenges/:id/leaderboard` answers for a v2 row too (DP-011). */
export type ChallengeLeaderboardRow = {
  user: ChallengeActor | string;
  progress?: number;
  rank?: number;
  lastUpdated?: string;
};

/** Additive `stats.v2` (services/challengeBoards.js statsFor). */
export type ChallengeStatsV2 = {
  mode: ChallengeMode;
  metric: ChallengeMetric;
  participantsActive: number;
  dayOf: number;
  daysTotal: number;
  groupTotal: number;
  groupTarget: number | null;
  medianDaysDone: number;
};

export type ChallengeInviteResult = {
  invite: { code: string; url: string } | null;
  notified: number;
  skipped: { userId: string; reason: 'already_in' | 'already_invited' | 'blocked' | 'not_visible' | 'full' | string }[];
};

export type ChallengeParticipationResult = {
  participant: { state: ParticipantState; muted: boolean; standings: boolean };
  /** The account is a known minor: standings stay off whatever was asked (D-91). */
  forced?: boolean;
};

/* ------------------------------------------------------------------ query keys */

/**
 * One namespace under the page's existing `['challenges']` root, so the
 * page's `invalidateQueries({ queryKey: ['challenges'] })` after a join, a
 * leave or a host action still drops every board and stat read with it.
 */
export const challengeKeys = {
  board: (challengeId: string, period: BoardPeriod, scope: BoardScope, around: boolean) =>
    ['challenges', 'board', challengeId, period, scope, around] as const,
  leaderboard: (challengeId: string) => ['challenges', 'leaderboard', challengeId] as const,
  stats: (challengeId: string) => ['challenges', 'stats', challengeId] as const,
};

/* ------------------------------------------------------------------ reads */

/**
 * The board. `around: true` asks the server for the five ranked rows either
 * side of the viewer when they sit outside the top ten, which is what makes
 * "your row without scrolling" possible at all.
 */
export async function fetchChallengeBoard(
  challengeId: string,
  { period = 'week', scope = 'challenge', around = true }: { period?: BoardPeriod; scope?: BoardScope; around?: boolean } = {},
): Promise<ChallengeBoard | null> {
  return absentOnRefusal(async () => {
    const { data } = await api.get<ChallengeBoard>(`/challenges/${challengeId}/board`, {
      params: { period, scope, ...(around ? { around: 'me' } : {}) },
    });
    return data;
  });
}

/** The legacy leaderboard, the one read that works with the flag off as well. */
export async function fetchChallengeLeaderboard(challengeId: string, limit = 50): Promise<ChallengeLeaderboardRow[]> {
  const { data } = await api.get<{ success: boolean; leaderboard: ChallengeLeaderboardRow[] }>(
    `/challenges/${challengeId}/leaderboard`,
    { params: { limit } },
  );
  return data.leaderboard ?? [];
}

export type ChallengeStatsResponse = {
  totalParticipants: number;
  totalProgress: number;
  averageProgress: number;
  completionRate: number;
  progressPercentage: number;
  duration: number;
  /** Milliseconds (legacy); `timeRemainingDays` is the one to print. */
  timeRemaining: number;
  timeRemainingDays?: number;
  v2?: ChallengeStatsV2;
};

export async function fetchChallengeStats(challengeId: string): Promise<ChallengeStatsResponse | null> {
  return absentOnRefusal(async () => {
    const { data } = await api.get<{ success: boolean; stats: ChallengeStatsResponse }>(`/challenges/${challengeId}/stats`);
    return data.stats;
  });
}

/* ------------------------------------------------------------------ writes */

/** At most twenty ids per call (services/challengeHost.js INVITE_USER_IDS_MAX). */
export const CHALLENGE_INVITE_MAX = 20;

/** `POST /challenges/:id/invite { userIds }`. Needs `invites` as well as `challengesV2`. */
export async function inviteToChallenge(challengeId: string, userIds: readonly string[]): Promise<ChallengeInviteResult> {
  const { data } = await api.post<ChallengeInviteResult>(`/challenges/${challengeId}/invite`, { userIds: [...userIds] });
  return data;
}

/** `POST /challenges/:id/end` — the host closes it now; `endDate` becomes this instant. */
export async function endChallengeNow(challengeId: string): Promise<void> {
  await api.post(`/challenges/${challengeId}/end`);
}

/** `POST /challenges/:id/host { userId }` — the new host has to be in the challenge. */
export async function transferChallengeHost(challengeId: string, userId: string): Promise<void> {
  await api.post(`/challenges/${challengeId}/host`, { userId });
}

/** `PATCH /challenges/:id/participants/me { muted?, standings? }`. */
export async function updateMyParticipation(
  challengeId: string,
  patch: { muted?: boolean; standings?: boolean },
): Promise<ChallengeParticipationResult> {
  const { data } = await api.patch<ChallengeParticipationResult>(`/challenges/${challengeId}/participants/me`, patch);
  return data;
}

/** `POST /challenges/:id/participants/:userId/remove { reason }` — the reason is required, one line. */
export async function removeChallengeParticipant(challengeId: string, userId: string, reason: string): Promise<void> {
  await api.post(`/challenges/${challengeId}/participants/${userId}/remove`, { reason });
}

/** `POST /challenges/:id/requests/:userId/accept` — seats the member who asked. */
export async function acceptChallengeRequest(challengeId: string, userId: string): Promise<void> {
  await api.post(`/challenges/${challengeId}/requests/${userId}/accept`);
}

/** `POST /challenges/:id/requests/:userId/decline` — silent: no row, no push. */
export async function declineChallengeRequest(challengeId: string, userId: string): Promise<void> {
  await api.post(`/challenges/${challengeId}/requests/${userId}/decline`);
}

/** `POST /challenges/:id/check-ins/:userId/:localDay/remove { reason }` — host only. */
export async function removeChallengeCheckIn(
  challengeId: string,
  userId: string,
  localDay: string,
  reason: string,
): Promise<void> {
  await api.post(`/challenges/${challengeId}/check-ins/${userId}/${localDay}/remove`, { reason });
}

/**
 * The legacy leaderboard read as board rows, so one list component draws
 * both shapes. It is the fallback for a v2 challenge whose `/board` the
 * viewer may not read yet (a `participants`-visibility challenge answers
 * 403 before you join, while `/leaderboard` still answers): a board you can
 * look at before you commit is the difference between joining and not.
 */
export function legacyBoardEntries(
  rows: readonly ChallengeLeaderboardRow[],
  myId: string,
): ChallengeBoardEntry[] {
  return rows.map((row, index) => {
    const user = typeof row.user === 'string' ? { _id: row.user } : row.user;
    return {
      rank: typeof row.rank === 'number' && row.rank > 0 ? row.rank : index + 1,
      user,
      score: Number(row.progress) || 0,
      isMe: !!myId && user?._id === myId,
    };
  });
}

/* ------------------------------------------------------------------ the trust rule */

/**
 * What the metric counts, in the server's own words
 * (services/challengeCopy.js METRIC_LINES / METRIC_LABELS). Mirrored here
 * because the board sends `metric` and not the sentence; the pair is pinned
 * against the backend by tests/challenges-v2-contract.test.mjs.
 */
export const METRIC_LABELS: Readonly<Record<ChallengeMetric, string>> = Object.freeze({
  session_days: 'sessions',
  minutes: 'minutes',
  check_ins: 'check-ins',
  habit_ticks: 'days with water logged',
});

export const TRUST_RULES: Readonly<Record<ChallengeMetric, string>> = Object.freeze({
  session_days: 'Counts the days you train',
  minutes: 'Counts your training minutes, capped per day',
  check_ins: 'Counts the days you check in at the gym',
  habit_ticks: 'Counts the days you log water',
});

/**
 * The trust sentence a board or stats read earns: what counts, and that
 * nobody types it in. `PUT /progress` and `POST /auto-update` both answer
 * `400 CHALLENGE_PROGRESS_COMPUTED` on a v2 row, so there is nothing to
 * enter and the screen says so rather than offering a field that refuses.
 */
export function trustRuleFor(source: { metric?: ChallengeMetric | null; dailyCap?: number | null } | null | undefined): string {
  const metric = source?.metric ?? 'session_days';
  const base = TRUST_RULES[metric] ?? TRUST_RULES.session_days;
  if (metric === 'minutes' && typeof source?.dailyCap === 'number' && source.dailyCap > 0) {
    return `Counts your training minutes, up to ${source.dailyCap} a day. Nothing is typed in.`;
  }
  return `${base}. Nothing is typed in — Vybe scores it from what you log.`;
}

/** The unit word a metric prints after a number. */
export function metricLabel(metric?: ChallengeMetric | null): string {
  return METRIC_LABELS[(metric ?? 'session_days') as ChallengeMetric] ?? METRIC_LABELS.session_days;
}

/* ------------------------------------------------------------------ row helpers (pure) */

/**
 * The zero rule for a standing: a rank is a fact only once the member has a
 * seat AND a counted day. Before that the row says nothing about where they
 * stand, and offers the next action instead.
 */
export function hasStanding(me: ChallengeStanding['me'] | null | undefined): boolean {
  return !!me && me.joined === true && typeof me.rank === 'number' && me.rank > 0;
}

/** Has the member counted anything at all (a progress line is honest without a rank). */
export function hasProgress(me: ChallengeStanding['me'] | null | undefined): boolean {
  return !!me && me.joined === true && Number.isFinite(me.progress) && me.progress > 0;
}

/**
 * "Joined · #4 of 31" once there is a rank, "Joined" while the first day is
 * still to come, and nothing at all for someone who has not joined. A Group
 * Goal never has ranks, so it reads "Joined" and the pooled line carries the
 * news.
 */
export function standingLabel(
  me: ChallengeStanding['me'] | null | undefined,
  participants: number | null | undefined,
): string | null {
  if (!me?.joined) return null;
  if (!hasStanding(me)) return 'Joined';
  const of = Number.isFinite(Number(participants)) && Number(participants) > 0 ? ` of ${Number(participants)}` : '';
  return `Joined · #${me.rank}${of}`;
}

/**
 * "12 of 20 km" — the progress line the research asked for, with no bar.
 * Returns null when there is nothing true to say: an unjoined row prints the
 * goal instead, and a joined row with no counted day prints the goal too
 * rather than "0 of 20".
 */
export function progressLine(
  value: number | null | undefined,
  target: number | null | undefined,
  unit: string,
): string | null {
  const total = Number(target);
  if (!Number.isFinite(total) || total <= 0) return null;
  const done = Number(value);
  if (!Number.isFinite(done) || done <= 0) return null;
  const shown = Number.isInteger(done) ? String(done) : String(Math.round(done * 10) / 10);
  const goal = Number.isInteger(total) ? String(total) : String(Math.round(total * 10) / 10);
  return unit ? `${shown} of ${goal} ${unit}` : `${shown} of ${goal}`;
}

/** The pooled line of a Group Goal: "84 of 120 sessions together". */
export function groupGoalLine(groupGoal: ChallengeStanding['groupGoal'], unit: string): string | null {
  if (!groupGoal) return null;
  const line = progressLine(groupGoal.total, groupGoal.target, unit);
  return line ? `${line} together` : null;
}

/**
 * "5 days left", "Ends today", "Ended". `daysLeft` is the server's count
 * (services/challengeScoring.js daysLeftOf) and its two edges are exact:
 * **null** once the window has closed, **0** on the last local day. A row
 * that never carried the field (search results, `GET /created`) says
 * nothing rather than guessing, so `undefined` is not "Ended".
 */
export function daysLeftLabel(daysLeft: number | null | undefined): string | null {
  if (daysLeft === undefined) return null;
  if (daysLeft === null) return 'Ended';
  const days = Number(daysLeft);
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return 'Ends today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

/** The last three days are the ember ones, as on the v1 badge; 0 is today. */
export function daysLeftUrgent(daysLeft: number | null | undefined): boolean {
  if (daysLeft === undefined || daysLeft === null) return false;
  const days = Number(daysLeft);
  return Number.isFinite(days) && days >= 0 && days <= 2;
}

/**
 * The board rows to draw, with the viewer's own row pinned at the top when
 * it is not in the visible slice — the research's "a leaderboard you can see
 * yourself in without scrolling". The pinned row is built from `me` (always
 * present) and, when the server sent them, the `around` rows carry the
 * neighbours that give the rank its context.
 *
 * `pinned` is null when the viewer is already in `entries`, when they have
 * no rank yet (the zero rule: no standing before the first entry) and on a
 * Group Goal, which has no ranks at all.
 */
export function pinnedBoardRow(board: ChallengeBoard | null | undefined, me: ChallengeActor | null): ChallengeBoardEntry | null {
  if (!board || board.mode === 'group_goal') return null;
  if (typeof board.me.rank !== 'number' || board.me.rank <= 0) return null;
  if (board.entries.some((entry) => entry.isMe)) return null;
  const fromAround = board.around.find((entry) => entry.isMe);
  if (fromAround) return fromAround;
  return {
    rank: board.me.rank,
    user: me,
    score: board.me.score,
    isMe: true,
    joinedDay: board.me.joinedDay ?? null,
  };
}

/**
 * The rows under the pinned one: the top ten, then a gap marker, then the
 * viewer's neighbourhood when the server sent it. The gap is a real fact
 * (the ranks are not contiguous), so it is drawn rather than hidden.
 */
export function boardRows(board: ChallengeBoard | null | undefined): { entries: ChallengeBoardEntry[]; around: ChallengeBoardEntry[]; gap: boolean } {
  const entries = board?.entries ?? [];
  const around = (board?.around ?? []).filter((row) => !entries.some((entry) => entry.rank === row.rank && entry.isMe === row.isMe));
  const lastTop = entries.length ? entries[entries.length - 1].rank : 0;
  const firstAround = around.length ? around[0].rank : 0;
  return { entries, around, gap: around.length > 0 && firstAround > lastTop + 1 };
}

/** "Your share: 12 of 84" for the Stats pane; null when there is no share to state. */
export function myShareLine(stats: ChallengeStatsV2 | null | undefined, mine: number | null | undefined): string | null {
  const total = Number(stats?.groupTotal);
  const part = Number(mine);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(part) || part <= 0) return null;
  return `${part} of ${total}`;
}

/** "Day 9 of 30" — omitted before the window opens (`dayOf` is 0 then). */
export function dayOfLine(stats: ChallengeStatsV2 | null | undefined): string | null {
  const day = Number(stats?.dayOf);
  const total = Number(stats?.daysTotal);
  if (!Number.isFinite(day) || day <= 0 || !Number.isFinite(total) || total <= 0) return null;
  return `Day ${day} of ${total}`;
}

/** The refusal a v2 row answers to a typed or synced progress write. */
export const PROGRESS_COMPUTED_CODE = 'CHALLENGE_PROGRESS_COMPUTED';

/** How a board period reads in the segmented control. */
export const BOARD_PERIOD_LABELS: Readonly<Record<BoardPeriod, string>> = Object.freeze({
  week: 'This week',
  last: 'Last week',
  all: 'All',
});
