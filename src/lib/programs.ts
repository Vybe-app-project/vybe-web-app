import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useFeatureGate } from './capabilities';

/**
 * Programmes (multi-week plans) and routine folders / share links —
 * `int-vybe-backend/docs/api-contract.md`, "Programs, routines, folders,
 * share links and set annotations (v2-be-programs-routines)".
 *
 * A plan is a **suggested** schedule, never a gate. Sessions are marked and
 * un-marked in any order, a skipped slot is reversible and stays in the
 * denominator, and the only thing the clock moves is the suggested week.
 * Nothing here locks a week, resets progress or counts a day as owed.
 *
 * Every `/api/plans/*` route, the folder routes and the kept versions sit
 * behind the `programs` flag; the share-link routes behind
 * `routineShareLinks`. Both are off in production today, and a route whose
 * flag is off answers `404 { code: 'FEATURE_DISABLED', feature }`. That is a
 * state, not an error: the surface is simply absent, the way the invite
 * surfaces read `features.invites`. `programsFeature()` is the gate before
 * the request; `isFeatureDisabled(error)` is the safety net after one.
 *
 * Request paths are literals on purpose — scripts/audit-api-contracts.cjs
 * pins every one of them against the backend's mounted routes.
 */

/* ------------------------------------------------------------------ types */

export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'left';

/** The slot a session counts toward: the plan, the week, the day, the order within the day. */
export type ProgramSlot = { planId: string; week: number; day: number; order: number };

export type CompletedSession = {
  week: number;
  day: number;
  order: number;
  workoutId: string | null;
  workoutLogId: string | null;
  completedAt: string | null;
  source: 'log' | 'manual' | 'session' | null;
};

export type Enrollment = {
  _id: string;
  plan: string;
  status: EnrollmentStatus;
  startedAt: string | null;
  weekAnchor: string | null;
  weekStartsOn: number;
  timeZone?: string | null;
  completedSessions: CompletedSession[];
  skipped: Array<{ week: number; day: number; order: number; skippedAt: string | null }>;
  pausedAt: string | null;
  completedAt: string | null;
  completedVia: 'all' | 'manual' | null;
  leftAt: string | null;
  lastActivityAt: string | null;
  badgeAwardedAt: string | null;
};

export type SlotState = 'todo' | 'done' | 'skipped';

export type ScheduleSession = {
  week: number;
  day: number;
  order: number;
  workoutId: string | null;
  title: string | null;
  exerciseCount: number;
  estimatedMin: number | null;
  state: SlotState;
  completedAt?: string | null;
  workoutLogId?: string | null;
};

export type ScheduleWeek = { week: number; sessions: ScheduleSession[] };

export type EnrollmentPointer = { week: number; day: number; order: number; workoutId: string | null };

export type Progress = { done: number; skipped: number; total: number; ratio: number };

/** `POST /plans/:id/enroll` and `GET /plans/:id/enrollment` answer this. */
export type EnrollmentView = {
  enrollment: Enrollment | null;
  schedule: ScheduleWeek[];
  pointer: EnrollmentPointer | null;
  suggestedWeek: number | null;
  progress: Progress;
  /** An open row whose ratio has reached PROGRAM_COMPLETE_THRESHOLD (0.8). */
  canMarkComplete: boolean;
  participants: { count: number; scope: string } | null;
};

/**
 * What a plan the member finished hands over next. Additive and not in the
 * backend snapshot this package was built against, so every reader treats it
 * as optional: the recap line appears when the server sends one and is
 * omitted when it does not.
 */
export type PlanNext = { _id?: string; title?: string } | null;

export type SessionMarkResult = {
  enrollment: Enrollment | null;
  session: CompletedSession | null;
  pointer: EnrollmentPointer | null;
  progress: Progress;
  /** True exactly when this mark set `status: completed` via `all`. */
  completed: boolean;
  next?: PlanNext;
};

export type SessionChangeResult = {
  enrollment: Enrollment | null;
  pointer: EnrollmentPointer | null;
  progress: Progress;
  completed?: boolean;
  next?: PlanNext;
};

export type PatchResult = { enrollment: Enrollment | null; pointer: EnrollmentPointer | null; suggestedWeek: number | null };

export type EnrollmentListItem = {
  enrollment: Enrollment | null;
  plan: { _id: string; title: string; durationWeeks?: number; image?: { uri?: string } | null } | null;
  pointer: EnrollmentPointer | null;
  progress: Progress;
  suggestedWeek: number | null;
};

export type EnrollmentList = { items: EnrollmentListItem[]; page: number; total: number; hasNextPage: boolean };

export type RoutineFolder = { _id: string; name: string; order: number; count: number; createdAt?: string };

export type FolderList = { folders: RoutineFolder[]; unfiled: number };

export type ShareLink = { url: string; token: string; expiresAt: string | null; activeLinks: number };

export type LinkStats = { activeLinks: number; expiresAt: string | null };

/* ------------------------------------------------------------ query keys */

export const programKeys = {
  /** The plan page's enrolment view. */
  enrollment: (planId: string) => ['plans', planId, 'enrollment'] as const,
  /** The hub's list of the member's enrolments, by status filter. */
  enrollments: (status: string) => ['plans', 'enrollments', status] as const,
  folders: ['routines', 'folders'] as const,
  links: (routineId: string) => ['routines', routineId, 'links'] as const,
};

/* -------------------------------------------------------- feature detect */

type ApiErrorShape = { response?: { status?: number; data?: { code?: string; feature?: string } } };

const statusOf = (e: unknown): number | undefined => (e as ApiErrorShape | null)?.response?.status;
const codeOf = (e: unknown): string | undefined => (e as ApiErrorShape | null)?.response?.data?.code;

/**
 * The server said this surface is not available for this caller: a `404`
 * carrying `code: 'FEATURE_DISABLED'`. Callers hide the surface rather than
 * show an error, and a bare 404 from a deployment older than Wave G (no
 * router mounted at all) reads the same way.
 */
export function isFeatureDisabled(error: unknown): boolean {
  if (statusOf(error) !== 404) return false;
  const code = codeOf(error);
  return code === undefined || code === 'FEATURE_DISABLED';
}

/** The flag named in a `FEATURE_DISABLED` body, when there is one. */
export function disabledFeature(error: unknown): string | null {
  return isFeatureDisabled(error) ? (error as ApiErrorShape).response?.data?.feature ?? null : null;
}

export type ProgramsFeature = {
  /** `/api/plans/*`, routine folders and kept versions. */
  programs: boolean;
  /** `POST /routines/:id/share-link` and its siblings. */
  shareLinks: boolean;
  /** The capabilities query has not answered yet; both flags read false until it has. */
  isPending: boolean;
};

/**
 * The two Wave G flags, read the way every other rollout surface reads one
 * (`useFeatureGate`, src/lib/capabilities.ts): false until the server has
 * answered, so nothing flashes a surface the API would then refuse. A hook,
 * despite the name — call it at the top of a component with the others. Both
 * gates share one query key, so this is one request, not two.
 */
export function programsFeature(): ProgramsFeature {
  const programs = useFeatureGate('programs');
  const shareLinks = useFeatureGate('routineShareLinks');
  return {
    programs: programs.enabled,
    shareLinks: shareLinks.enabled,
    isPending: programs.isPending || shareLinks.isPending,
  };
}

/* ---------------------------------------------------------- keyed writes */

/**
 * One `clientRequestId` per write attempt: 16–100 letters, digits,
 * underscores or dashes (services/clientRequests.js). A replay of the same
 * id with the same body answers the recorded result, which is what makes a
 * retry after a lost acknowledgement safe on `program-enroll` and
 * `program-session`.
 */
export function requestId(): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : '';
  if (uuid) return uuid;
  let id = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  while (id.length < 16) id += Math.random().toString(36).slice(2, 8);
  return id.slice(0, 100);
}

/* ------------------------------------------------------------- the dates */

const pad = (n: number) => String(n).padStart(2, '0');

/** A local calendar date as the contract's `"YYYY-MM-DD"` (never a UTC shift of it). */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * "Shift schedule to this week": the anchor that makes `pointerWeek` the
 * suggested week right now. The server snaps whatever date arrives back to
 * its week start (`weekStartOfDayKey`), so today minus whole weeks is enough
 * and the client never has to know the member's `weekStartsOn`.
 */
export function shiftAnchor(pointerWeek: number, now: Date = new Date()): string {
  const weeks = Number.isInteger(pointerWeek) && pointerWeek >= 1 ? pointerWeek : 1;
  const shifted = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (weeks - 1) * 7);
  return dateKey(shifted);
}

/* -------------------------------------------------------------- fetchers */

/** `GET /plans/:id/enrollment` — the plan's schedule with this member's state on it. */
export async function fetchEnrollment(planId: string): Promise<EnrollmentView> {
  const { data } = await api.get<EnrollmentView>(`/plans/${planId}/enrollment`);
  return data;
}

/**
 * `POST /plans/:id/enroll`. `weekStartsOn: 1` pins Monday — the contract's
 * own default, sent explicitly so the member's first week does not depend on
 * a server default changing under them. `weekAnchor` is deliberately omitted:
 * the server anchors to the start of the current week **on the member's own
 * clock** (`settings.timezone`), which the browser must not second-guess.
 */
export async function enroll(planId: string, clientRequestId: string = requestId()): Promise<EnrollmentView> {
  const { data } = await api.post<EnrollmentView>(`/plans/${planId}/enroll`, { clientRequestId, weekStartsOn: 1 });
  return data;
}

export type EnrollmentPatch = { status?: 'active' | 'paused' | 'left'; weekAnchor?: string };

/** `PATCH /plans/:id/enrollment` — pause, resume, leave, or move the anchor. */
export async function patchEnrollment(planId: string, patch: EnrollmentPatch, clientRequestId: string = requestId()): Promise<PatchResult> {
  const { data } = await api.patch<PatchResult>(`/plans/${planId}/enrollment`, { clientRequestId, ...patch });
  return data;
}

export type MarkSessionInput = {
  week: number;
  day: number;
  order: number;
  /** The log this session produced, when it came from the runner. */
  workoutLogId?: string;
  /** The `clientRequestId` the log was created with, when the id has not come back yet. */
  workoutLogClientRequestId?: string;
  source?: 'log' | 'manual';
};

/** `POST /plans/:id/enrollment/sessions` — this slot is done. */
export async function markSession(planId: string, input: MarkSessionInput, clientRequestId: string = requestId()): Promise<SessionMarkResult> {
  const { data } = await api.post<SessionMarkResult>(`/plans/${planId}/enrollment/sessions`, { clientRequestId, ...input });
  return data;
}

/** `DELETE /plans/:id/enrollment/sessions/:week/:day/:order` — undo a mark. */
export async function unmarkSession(planId: string, slot: { week: number; day: number; order: number }, clientRequestId: string = requestId()): Promise<SessionChangeResult> {
  const { data } = await api.delete<SessionChangeResult>(`/plans/${planId}/enrollment/sessions/${slot.week}/${slot.day}/${slot.order}`, {
    data: { clientRequestId },
  });
  return data;
}

/** `POST /plans/:id/enrollment/skip` — not this one. Reversible, and it stays in the total. */
export async function skipSession(planId: string, slot: { week: number; day: number; order: number }, clientRequestId: string = requestId()): Promise<SessionChangeResult> {
  const { data } = await api.post<SessionChangeResult>(`/plans/${planId}/enrollment/skip`, { clientRequestId, ...slot });
  return data;
}

/** `DELETE /plans/:id/enrollment/skip/:week/:day/:order` — put it back. */
export async function unskipSession(planId: string, slot: { week: number; day: number; order: number }, clientRequestId: string = requestId()): Promise<SessionChangeResult> {
  const { data } = await api.delete<SessionChangeResult>(`/plans/${planId}/enrollment/skip/${slot.week}/${slot.day}/${slot.order}`, {
    data: { clientRequestId },
  });
  return data;
}

/** `POST /plans/:id/enrollment/complete` — only offered while `canMarkComplete`. */
export async function completeEnrollment(planId: string, clientRequestId: string = requestId()): Promise<{ enrollment: Enrollment | null; completed: boolean; next?: PlanNext }> {
  const { data } = await api.post<{ enrollment: Enrollment | null; completed: boolean; next?: PlanNext }>(`/plans/${planId}/enrollment/complete`, { clientRequestId });
  return data;
}

/** `DELETE /plans/:id/enrollment/complete` — within 24 h of completing. */
export async function uncompleteEnrollment(planId: string, clientRequestId: string = requestId()): Promise<{ enrollment: Enrollment | null }> {
  const { data } = await api.delete<{ enrollment: Enrollment | null }>(`/plans/${planId}/enrollment/complete`, { data: { clientRequestId } });
  return data;
}

/** `GET /plans/enrollments` — the member's enrolments, newest activity first. */
export async function fetchEnrollments(status = 'active,paused', limit = 20): Promise<EnrollmentList> {
  const { data } = await api.get<EnrollmentList>('/plans/enrollments', { params: { status, limit } });
  return { items: data?.items ?? [], page: data?.page ?? 1, total: data?.total ?? 0, hasNextPage: data?.hasNextPage ?? false };
}

/* --------------------------------------------------- folders, share links */

/** `GET /routines/folders` — the member's folders with their counts, plus how many are unfiled. */
export async function fetchFolders(): Promise<FolderList> {
  const { data } = await api.get<FolderList>('/routines/folders');
  return { folders: data?.folders ?? [], unfiled: data?.unfiled ?? 0 };
}

/** `POST /routines/folders`. */
export async function createFolder(name: string): Promise<RoutineFolder | null> {
  const { data } = await api.post<{ folder?: RoutineFolder }>('/routines/folders', { name });
  return data?.folder ?? null;
}

/** `PATCH /routines/folders/:folderId`. */
export async function renameFolder(folderId: string, name: string): Promise<RoutineFolder | null> {
  const { data } = await api.patch<{ folder?: RoutineFolder }>(`/routines/folders/${folderId}`, { name });
  return data?.folder ?? null;
}

/** `DELETE /routines/folders/:folderId` — its routines go back to Unfiled, none is deleted. */
export async function deleteFolder(folderId: string): Promise<number> {
  const { data } = await api.delete<{ moved?: number }>(`/routines/folders/${folderId}`);
  return data?.moved ?? 0;
}

/** `PATCH /routines/:id/folder` — `null` means Unfiled. */
export async function moveRoutineToFolder(routineId: string, folderId: string | null): Promise<void> {
  await api.patch(`/routines/${routineId}/folder`, { folderId });
}

/** `POST /routines/:id/share-link` — the token is shown once and stored hashed. */
export async function createShareLink(routineId: string): Promise<ShareLink> {
  const { data } = await api.post<ShareLink>(`/routines/${routineId}/share-link`);
  return data;
}

/** `DELETE /routines/:id/share-link` — every live token for this routine. */
export async function revokeShareLinks(routineId: string): Promise<number> {
  const { data } = await api.delete<{ revoked?: number }>(`/routines/${routineId}/share-link`);
  return data?.revoked ?? 0;
}

/** `GET /routines/:id/links` — counts only, never a token. */
export async function fetchLinkStats(routineId: string): Promise<LinkStats> {
  const { data } = await api.get<LinkStats>(`/routines/${routineId}/links`);
  return { activeLinks: data?.activeLinks ?? 0, expiresAt: data?.expiresAt ?? null };
}

/* ------------------------------------------------------------------ hooks */

/**
 * The plan page's enrolment view. Gated on the flag, and a `FEATURE_DISABLED`
 * answer from a server that disagrees is swallowed rather than retried: the
 * card is absent and the schedule below it stays readable, which is exactly
 * what the page did before this package.
 */
export function useEnrollment(planId: string, enabled = true) {
  const { programs } = programsFeature();
  return useQuery({
    queryKey: programKeys.enrollment(planId),
    queryFn: () => fetchEnrollment(planId),
    enabled: Boolean(planId) && enabled && programs,
    retry: (count, error) => !isFeatureDisabled(error) && count < 2,
    staleTime: 30_000,
  });
}

/** The member's folders, or null when the flag is off (the chip row is then absent). */
export function useRoutineFolders(enabled = true) {
  const { programs } = programsFeature();
  return useQuery({
    queryKey: programKeys.folders,
    queryFn: fetchFolders,
    enabled: enabled && programs,
    retry: (count, error) => !isFeatureDisabled(error) && count < 2,
    staleTime: 60_000,
  });
}

/* ----------------------------------------------------------- the schedule */

/** A plan slot as the plan document carries it, before anyone has enrolled. */
export type PlanSlotInput = { week: number; day: number; order?: number; title?: string | null; workoutId?: string | null; estimatedMin?: number | null; exerciseCount?: number };

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** `Mon` … `Sun` for days 1–7, and `Day 8` for anything a plan puts outside the week. */
export function dayName(day: number): string {
  return day >= 1 && day <= 7 ? DAY_NAMES[day - 1] : `Day ${day}`;
}

const sameSlot = (a: { week: number; day: number; order: number }, b: { week: number; day: number; order: number }) =>
  a.week === b.week && a.day === b.day && a.order === b.order;

export type ScheduleRow = ScheduleSession & {
  /** The pointer: the first slot neither done nor skipped. "Pick up where you left off". */
  isNext: boolean;
};

/** One day of a week. A day with no session is a rest day, not an absence. */
export type ScheduleDay = { day: number; label: string; rest: boolean; rows: ScheduleRow[] };

export type ScheduleWeekRows = { week: number; days: ScheduleDay[]; done: number; total: number };

/**
 * The week list the plan page draws, from whichever source is available: the
 * enrolment view's `schedule` (states included) when the member is on the
 * plan, and the plan document's own slots when they are not — so every week
 * is readable before joining, which is the whole point of the redesign.
 *
 * Every week runs Monday to Sunday whether or not the plan filled each day:
 * a day with nothing on it reads "Tue · Rest", dimmed, because a rest day is
 * part of the plan and a gap is not. Weeks a plan advertises but never fills
 * still appear; a slot whose workout has gone leaves the row without a title
 * rather than a hole.
 */
export function scheduleWeeks(input: {
  slots?: readonly PlanSlotInput[] | null;
  schedule?: readonly ScheduleWeek[] | null;
  pointer?: { week: number; day: number; order: number } | null;
  durationWeeks?: number | null;
}): ScheduleWeekRows[] {
  const fromView = (input.schedule ?? []).flatMap((week) => week.sessions ?? []);
  const sessions: ScheduleSession[] = fromView.length
    ? fromView.map((session) => ({ ...session, order: session.order ?? 1 }))
    : (input.slots ?? []).map((slot) => ({
        week: Number(slot.week),
        day: Number(slot.day),
        order: slot.order === undefined || slot.order === null ? 1 : Number(slot.order),
        workoutId: slot.workoutId ?? null,
        title: slot.title ?? null,
        exerciseCount: slot.exerciseCount ?? 0,
        estimatedMin: slot.estimatedMin ?? null,
        state: 'todo' as SlotState,
      }));

  const byWeek = new Map<number, ScheduleSession[]>();
  for (const session of sessions) {
    if (!Number.isInteger(session.week) || !Number.isInteger(session.day)) continue;
    const list = byWeek.get(session.week) ?? [];
    list.push(session);
    byWeek.set(session.week, list);
  }

  const declared = Number.isInteger(input.durationWeeks) && (input.durationWeeks as number) > 0 ? (input.durationWeeks as number) : 0;
  const weeks = new Set<number>(byWeek.keys());
  for (let week = 1; week <= declared; week += 1) weeks.add(week);

  return [...weeks]
    .sort((a, b) => a - b)
    .map((week) => {
      const inWeek = (byWeek.get(week) ?? []).slice().sort((a, b) => a.day - b.day || a.order - b.order);
      const dayNumbers = new Set<number>([1, 2, 3, 4, 5, 6, 7]);
      for (const session of inWeek) dayNumbers.add(session.day);
      const days: ScheduleDay[] = [...dayNumbers]
        .sort((a, b) => a - b)
        .map((day) => {
          const rows = inWeek
            .filter((session) => session.day === day)
            .map((session) => ({ ...session, isNext: Boolean(input.pointer && sameSlot(session, input.pointer)) }));
          return { day, label: dayName(day), rest: rows.length === 0, rows };
        });
      return {
        week,
        days,
        done: inWeek.filter((session) => session.state === 'done').length,
        total: inWeek.length,
      };
    });
}

/** The week a plan page opens on: the suggested week, else the pointer's, else the first. */
export function openWeek(weeks: readonly ScheduleWeekRows[], suggestedWeek?: number | null, pointer?: { week: number } | null): number {
  const available = new Set(weeks.map((week) => week.week));
  if (suggestedWeek && available.has(suggestedWeek)) return suggestedWeek;
  if (pointer?.week && available.has(pointer.week)) return pointer.week;
  return weeks[0]?.week ?? 1;
}

/** "Week 2 of 4 · 5 of 12 done" — the programme state in one line. */
export function progressLine(progress: Progress | null | undefined, week: number | null | undefined, durationWeeks: number | null | undefined): string {
  const parts: string[] = [];
  if (week && durationWeeks) parts.push(`Week ${week} of ${durationWeeks}`);
  else if (week) parts.push(`Week ${week}`);
  if (progress && progress.total > 0) parts.push(`${progress.done} of ${progress.total} done`);
  if (progress && progress.skipped > 0) parts.push(`${progress.skipped} skipped`);
  return parts.join(' · ');
}

/** "Next: Day 3 · Lower Body Strength · 42 min" — the one next-up row, never a list. */
export function nextUpLine(row: Pick<ScheduleRow, 'day' | 'title' | 'estimatedMin'> | null | undefined): string {
  if (!row) return '';
  return [dayName(row.day), row.title || 'Session', row.estimatedMin ? `${row.estimatedMin} min` : null].filter(Boolean).join(' · ');
}

/** The hub's Programs meta: "Enrolled · Week 2 of 4", or nothing at all. */
export function enrolledMeta(item: EnrollmentListItem | null | undefined): string | null {
  if (!item || !item.enrollment) return null;
  const status = item.enrollment.status;
  if (status === 'left') return null;
  if (status === 'completed') return 'Completed';
  const weeks = item.plan?.durationWeeks;
  const week = item.suggestedWeek;
  const label = status === 'paused' ? 'Paused' : 'Enrolled';
  if (week && weeks) return `${label} · Week ${week} of ${weeks}`;
  if (week) return `${label} · Week ${week}`;
  return label;
}
