import { useLocation, useNavigate, type Location } from 'react-router-dom';

/**
 * Detail and editor routes present as a sheet over the page that opened them
 * on `lg+` (the shell's RouteSheet reads `location.state.backgroundLocation`)
 * and as a full page on phones or when the URL is loaded cold. These helpers
 * are the two ends of that: `useSheetNav().open(to)` carries the background
 * along, `useSheetClose(fallback)` goes back when there is one and to the
 * fallback when there is not.
 */

export type SheetState = { backgroundLocation: Location };

const backgroundOf = (location: Location): Location => (location.state as Partial<SheetState> | null)?.backgroundLocation ?? location;

export function useSheetNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const state: SheetState = { backgroundLocation: backgroundOf(location) };
  return {
    state,
    open: (to: string, options: { replace?: boolean } = {}) => navigate(to, { state, viewTransition: true, replace: options.replace }),
  };
}

export function useSheetClose(fallback: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const background = (location.state as Partial<SheetState> | null)?.backgroundLocation;
  return () => {
    if (background) navigate(-1);
    else navigate(fallback, { replace: true, viewTransition: true });
  };
}

/** The plan slot a live session counts toward (src/lib/programs.ts `ProgramSlot`). */
export type ProgramSlotParam = { planId: string; week: number; day: number; order: number };

/**
 * The slot a runner URL carries, or null when it carries none. The four
 * parameters travel together or not at all: a half-written link starts an
 * ordinary session rather than marking the wrong day done.
 */
export function programSlotFromParams(params: URLSearchParams): ProgramSlotParam | null {
  const planId = params.get('plan');
  if (!planId) return null;
  const read = (name: string) => {
    const value = Number(params.get(name));
    return Number.isInteger(value) && value >= 1 ? value : null;
  };
  const week = read('week');
  const day = read('day');
  const order = read('order');
  if (week === null || day === null || order === null) return null;
  return { planId, week, day, order };
}

/* Train hub paths, in one place. */
export const TRAIN = {
  hub: '/workouts',
  /** Mine | Browse since 2026-09-21; the older keys still resolve (plans → the My plans section, explore/premade → Browse). */
  tab: (tab: 'mine' | 'browse' | 'plans' | 'explore' | 'premade') => (tab === 'mine' ? '/workouts' : tab === 'plans' ? '/workouts#plans' : '/workouts?tab=browse'),
  newWorkout: '/workouts/new',
  workout: (id: string) => `/workouts/${id}`,
  editWorkout: (id: string) => `/workouts/${id}/edit`,
  newPlan: '/workouts/plans/new',
  plan: (id: string) => `/workouts/plans/${id}`,
  editPlan: (id: string) => `/workouts/plans/${id}/edit`,
  history: '/workouts/history',
  session: (id: string, options: { edit?: boolean } = {}) => `/workouts/history/${id}${options.edit ? '?edit=1' : ''}`,
  /**
   * The live runner (src/pages/workouts/session/Runner.tsx): a page, not a
   * sheet. `from` seeds it from a library workout, `repeat` from a past
   * session, neither starts it empty. This is where every "Start" on the hub
   * goes; `newSession` below is the post-hoc form, kept for logging a session
   * that has already happened.
   *
   * `program` names the plan slot this session is being trained for, so the
   * recap can mark it done without the member going back to the plan page to
   * do it by hand. It rides the session (and its draft) all the way to
   * Finish; it never reaches `POST /workouts/logs`, which knows nothing
   * about programmes.
   */
  liveSession: (seed: { from?: string; repeat?: string; program?: ProgramSlotParam | null } = {}) => {
    const q = new URLSearchParams();
    if (seed.from) q.set('from', seed.from);
    if (seed.repeat) q.set('repeat', seed.repeat);
    if (seed.program?.planId) {
      q.set('plan', seed.program.planId);
      q.set('week', String(seed.program.week));
      q.set('day', String(seed.program.day));
      q.set('order', String(seed.program.order));
    }
    const s = q.toString();
    return `/workouts/session${s ? `?${s}` : ''}`;
  },
  /** The recap and the pre-filled log form, after Finish. */
  sessionFinish: '/workouts/session/finish',
  /** A session logged after the fact, optionally seeded from a library workout, a past session, or the first-week starter. */
  newSession: (seed: { from?: string; repeat?: string; starter?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (seed.from) q.set('from', seed.from);
    if (seed.repeat) q.set('repeat', seed.repeat);
    if (seed.starter) q.set('starter', '1');
    const s = q.toString();
    return `/workouts/history/new${s ? `?${s}` : ''}`;
  },
  progress: '/workouts/progress',
} as const;
