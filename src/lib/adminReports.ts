/**
 * Pure vocabulary and rules for the Reports page of the staff console. The
 * enumerations mirror models/Report.js and content/guidelines.json in the
 * API (commit 4e22914); the guidelines file is not served by any route, so
 * the twelve rows live here and tests/admin-ops-formatters.test.mjs pins
 * their codes. When the API cannot find the rule the console cites, it
 * falls back to the reason-derived rule, so a stale table never blocks a
 * decision.
 *
 * The SLA thresholds are web-defined: the API has no report-ageing
 * constant (support tickets carry `ageDays` only). They exist so the queue
 * reads oldest-first with a visible "overdue" mark, nothing more.
 */

export type GuidelineRule = { code: string; title: string; summary: string; reportReasons: string[] };

/** content/guidelines.json, verbatim. */
export const GUIDELINES: ReadonlyArray<GuidelineRule> = [
  { code: 'CG-01', title: 'Be kind to people', summary: 'No harassment, bullying, name-calling or piling on. Disagree with an idea, not a person.', reportReasons: ['harassment'] },
  { code: 'CG-02', title: 'No hate', summary: 'No attacks on people for who they are: race, ethnicity, religion, gender, sexuality, disability, age or body.', reportReasons: ['hate_speech'] },
  { code: 'CG-03', title: 'No violence or threats', summary: 'No threats, no encouraging harm to anyone, no celebrating violence.', reportReasons: ['violence'] },
  { code: 'CG-04', title: 'Keep it non-sexual', summary: 'No sexual content or sexual comments. Training photos are fine; sexualising them is not.', reportReasons: ['sexual_content'] },
  { code: 'CG-05', title: "Don't promote disordered eating", summary: 'No content that encourages restricting, purging, extreme fasting or chasing a number. Share what you ate, not how little.', reportReasons: ['disordered_eating'] },
  { code: 'CG-06', title: "Don't comment on bodies", summary: "No remarks about someone's shape, size or weight, positive or negative. Cheer on the work, not the body.", reportReasons: ['body_shaming'] },
  { code: 'CG-07', title: "Don't encourage dangerous activity", summary: 'No dares, no unsafe loading, no training through injury as a challenge, no substances.', reportReasons: ['dangerous_activity'] },
  { code: 'CG-08', title: "Don't spread false claims", summary: "No made-up health or training claims presented as fact. Say what worked for you; don't promise it will work for anyone.", reportReasons: ['misinformation'] },
  { code: 'CG-09', title: 'No spam or misleading content', summary: 'No repeated promotion, link farming, fake giveaways or bait. One honest mention of your own thing is fine.', reportReasons: ['spam'] },
  { code: 'CG-10', title: 'Be yourself', summary: 'No pretending to be another person, gym, coach or brand.', reportReasons: ['impersonation'] },
  { code: 'CG-11', title: "Respect other people's work", summary: 'Share only what you have the right to share. Credit programmes, photos and videos you did not make.', reportReasons: ['copyright'] },
  { code: 'CG-12', title: 'Keep Vybe safe for everyone', summary: "Anything else that makes Vybe unsafe: sharing someone's private details, content unsuitable for people under 18, evading a suspension, or breaking the law.", reportReasons: ['inappropriate_content', 'other'] },
];

export const FALLBACK_RULE_CODE = 'CG-12';

/** models/Report.js REPORT_REASONS. */
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate_speech',
  'violence',
  'sexual_content',
  'misinformation',
  'dangerous_activity',
  'copyright',
  'impersonation',
  'inappropriate_content',
  'other',
  'disordered_eating',
  'body_shaming',
] as const;

/** models/Report.js TARGET_TYPES. */
export const TARGET_TYPES = [
  'post',
  'meal',
  'workout',
  'workout_plan',
  'user',
  'comment',
  'livestream',
  'livestream_message',
  'gym_community',
  'gym_review',
] as const;

/** routes/admin.js action validator. */
export const MODERATION_ACTIONS = ['mark_reviewed', 'dismiss', 'remove_content', 'suspend_user', 'restore_user', 'mark_sensitive'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** GET /admin/reports?appeal= accepted values (reportController.listReports). */
export const APPEAL_FILTERS = ['open', 'upheld', 'reversed', 'any', 'none'] as const;
export type AppealFilter = (typeof APPEAL_FILTERS)[number];

/** Actions that write a statement the member can appeal (services/enforcement.js APPEALABLE_ACTIONS). */
export const APPEALABLE_ACTIONS = ['remove_content', 'suspend_user', 'mark_sensitive'] as const;

/** Actions whose PATCH body may carry a `rule`; the API records a statement for each. */
export const RULE_CITING_ACTIONS = ['remove_content', 'suspend_user', 'mark_sensitive', 'dismiss'] as const;

/** routes/admin.js: durationDays is an integer from 1 to SUSPENSION_MAX_DAYS. */
export const SUSPENSION_DAYS = { min: 1, max: 365 } as const;

/** models/Report.js note limits (>= 5 for destructive actions and appeal decisions, <= 1000 always). */
export const NOTE_LIMITS = { min: 5, max: 1000 } as const;

/**
 * Content types with a `reverse` handler in reportController.TARGETS: posts,
 * live streams and communities are soft-removed, so reversing a
 * remove_content brings them back. Meals, workouts, plans, comments, chat
 * lines and reviews were deleted outright and cannot return. Suspensions
 * and sensitivity screens reverse whatever the target type; see
 * reversalOutcome().
 */
export const RESTORABLE_TARGETS = ['post', 'livestream', 'gym_community'] as const;

export const guidelineByCode = (code: string | null | undefined): GuidelineRule | null =>
  GUIDELINES.find((rule) => rule.code === String(code ?? '').trim().toUpperCase()) ?? null;

/** Mirrors services/enforcement.js ruleForReason: every reason maps to one rule, anything else to CG-12. */
export function ruleForReason(reason: string | null | undefined): GuidelineRule {
  const hit = GUIDELINES.find((rule) => rule.reportReasons.includes(String(reason ?? '')));
  return hit ?? (guidelineByCode(FALLBACK_RULE_CODE) as GuidelineRule);
}

/** "CG-09 · No spam or misleading content", the way the picker and the statement print a rule. */
export const ruleLabel = (rule: { code: string; title: string }): string => `${rule.code} · ${rule.title}`;

/* -------------------------------------------------------------- appeals */

export type AppealStatus = 'open' | 'upheld' | 'reversed';

export type ReportAppeal = {
  message?: string;
  status?: AppealStatus | string;
  openedAt?: string | null;
  decidedAt?: string | null;
  decidedBy?: { _id?: string; fullName?: string; email?: string } | string | null;
  note?: string;
  restored?: boolean;
  contactMessage?: string | null;
};

export type ReportStatement = {
  action?: 'remove_content' | 'suspend_user' | 'mark_sensitive' | 'no_action' | string;
  ruleCode?: string;
  ruleTitle?: string;
  note?: string;
  issuedAt?: string | null;
  /** A bare admin id, never populated. */
  issuedBy?: string | { _id?: string } | null;
  detectedBy?: string;
};

export type AppealState = 'none' | 'open' | 'upheld' | 'reversed' | 'window_open' | 'window_closed';

type ReportLike = {
  appeal?: ReportAppeal | null;
  appealUntil?: string | null;
  statement?: ReportStatement | null;
  reviewedBy?: { _id?: string } | string | null;
};

/** appeal.status wins; otherwise the appeal window against `now`; otherwise 'none'. */
export function appealState(report: ReportLike | null | undefined, now: number): AppealState {
  const status = report?.appeal?.status;
  if (status === 'open' || status === 'upheld' || status === 'reversed') return status;
  if (report?.appealUntil) {
    const until = Date.parse(report.appealUntil);
    if (!Number.isNaN(until)) return until > now ? 'window_open' : 'window_closed';
  }
  return 'none';
}

/* ------------------------------------------------------------------ SLA */

export const REPORT_SLA_HOURS = { due: 24, overdue: 72 } as const;
export const APPEAL_SLA_DAYS = { due: 3, overdue: 7 } as const;

export type SlaState = 'fresh' | 'due' | 'overdue' | 'unknown';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Age of a queue item against the web-defined thresholds above. */
export function slaState(sinceIso: string | null | undefined, now: number, kind: 'report' | 'appeal'): { state: SlaState; ageMs: number | null } {
  if (!sinceIso) return { state: 'unknown', ageMs: null };
  const t = Date.parse(sinceIso);
  if (Number.isNaN(t)) return { state: 'unknown', ageMs: null };
  const ageMs = Math.max(0, now - t);
  const [due, overdue] =
    kind === 'appeal'
      ? [APPEAL_SLA_DAYS.due * DAY, APPEAL_SLA_DAYS.overdue * DAY]
      : [REPORT_SLA_HOURS.due * HOUR, REPORT_SLA_HOURS.overdue * HOUR];
  return { state: ageMs >= overdue ? 'overdue' : ageMs >= due ? 'due' : 'fresh', ageMs };
}

/** "Waiting 3 h", "Waiting 4 d"; minutes under an hour, days from 48 hours. */
export function ageLabel(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs)) return 'Age unknown';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'Waiting under a minute';
  if (minutes < 60) return `Waiting ${minutes} min`;
  const hours = Math.floor(ageMs / HOUR);
  if (hours < 48) return `Waiting ${hours} h`;
  return `Waiting ${Math.floor(ageMs / DAY)} d`;
}

/**
 * The queue badge text. The SLA state rides in the words, not only in the
 * badge tone, so keyboard, touch and screen-reader users read "overdue"
 * where sighted mouse users used to hover for it.
 */
export function slaLabel(sla: { state: SlaState; ageMs: number | null }): string {
  const age = ageLabel(sla.ageMs);
  if (sla.state === 'overdue') return `${age} · overdue`;
  if (sla.state === 'due') return `${age} · due`;
  return age;
}

/* -------------------------------------------------------- permissions */

const idOf = (v: unknown): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && '_id' in (v as object)) return String((v as { _id?: unknown })._id ?? '');
  return String(v);
};

/**
 * Reviewer independence, as reportController.decideReportAppeal enforces it:
 * the admin who took the original action (reviewedBy, else statement.issuedBy)
 * may not decide the appeal unless they are SUPER_ADMIN. Both refs are
 * compared by id whether populated or bare.
 */
export function canDecideAppeal(
  report: ReportLike | null | undefined,
  me: { _id?: string; role?: string } | null | undefined,
): { ok: boolean; reason: string | null } {
  if (report?.appeal?.status !== 'open') return { ok: false, reason: 'No open appeal' };
  const actor = idOf(report.reviewedBy) || idOf(report.statement?.issuedBy);
  const mine = idOf(me?._id);
  if (actor && mine && actor === mine && me?.role !== 'SUPER_ADMIN') {
    return { ok: false, reason: 'You took the original action' };
  }
  return { ok: true, reason: null };
}

/* ------------------------------------------------------------ reversal */

export type ReversalOutcome = 'account' | 'screen' | 'content' | 'none';

/**
 * What reversing this report's enforcement brings back, keyed on the
 * statement's action exactly as reportController.reverseEnforcement is:
 * suspend_user lifts the suspension and removes the strike whatever the
 * target type; mark_sensitive clears the screen; remove_content restores
 * only the targets with a reverse handler (RESTORABLE_TARGETS). A report
 * without a statement never removed anything the API can put back.
 */
export function reversalOutcome(report: { targetType?: string | null; statement?: ReportStatement | null } | null | undefined): ReversalOutcome {
  const action = report?.statement?.action;
  if (action === 'suspend_user') return 'account';
  if (action === 'mark_sensitive') return 'screen';
  if (action === 'remove_content') {
    return (RESTORABLE_TARGETS as readonly string[]).includes(String(report?.targetType ?? '')) ? 'content' : 'none';
  }
  return 'none';
}

/** The consequence a moderator reads under "Reverse the decision". */
export const REVERSAL_COPY: Record<ReversalOutcome, string> = {
  account: 'The account is restored and the strike is removed. The member is told.',
  screen: 'The sensitivity screen is cleared. The member is told.',
  content: 'The post, live stream or community comes back. The member is told.',
  none: 'Nothing comes back: meals, workouts, plans, comments, chat lines and reviews were deleted outright. The record is corrected and the member is told.',
};

export const reversalDescription = (report: Parameters<typeof reversalOutcome>[0]): string => REVERSAL_COPY[reversalOutcome(report)];

/* ---------------------------------------------------------- form bodies */

/** PATCH /admin/reports/:id body; routes/admin.js rejects any other key with a 400. */
export type ModerationBody = { action: ModerationAction; note?: string; rule?: string; durationDays?: number };

/**
 * Build the moderation request. Only what the API accepts for the chosen
 * action goes on the wire: an empty note is omitted, `rule` only for
 * RULE_CITING_ACTIONS, `durationDays` only for suspend_user (the API
 * answers 400 'A duration applies to suspend_user only' otherwise) and only
 * when a length was typed, since empty means indefinite.
 */
export function moderationBody(input: {
  action: ModerationAction;
  note?: string | null;
  rule?: string | null;
  durationDays?: string | number | null;
}): ModerationBody {
  const body: ModerationBody = { action: input.action };
  const note = String(input.note ?? '').trim();
  if (note) body.note = note.slice(0, NOTE_LIMITS.max);
  const rule = String(input.rule ?? '').trim();
  if (rule && (RULE_CITING_ACTIONS as readonly string[]).includes(input.action)) body.rule = rule;
  const duration = String(input.durationDays ?? '').trim();
  if (input.action === 'suspend_user' && duration !== '') body.durationDays = Number(duration);
  return body;
}

/** Form-level message for a moderation or appeal note, or null when it passes. */
export function noteError(note: string, required: boolean): string | null {
  const length = String(note ?? '').trim().length;
  if (required && length < NOTE_LIMITS.min) return `A short reason (at least ${NOTE_LIMITS.min} characters) is required for this action.`;
  if (length > NOTE_LIMITS.max) return `Notes must be ${NOTE_LIMITS.max.toLocaleString()} characters or fewer.`;
  return null;
}

/** Form-level message for a suspension length; empty means indefinite and passes. */
export function durationError(raw: string): string | null {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < SUSPENSION_DAYS.min || n > SUSPENSION_DAYS.max) {
    return `Suspension length must be a whole number of days from ${SUSPENSION_DAYS.min} to ${SUSPENSION_DAYS.max}.`;
  }
  return null;
}
