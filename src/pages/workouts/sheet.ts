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

/* Train hub paths, in one place. */
export const TRAIN = {
  hub: '/workouts',
  tab: (tab: 'mine' | 'plans' | 'explore' | 'premade') => (tab === 'mine' ? '/workouts' : `/workouts?tab=${tab}`),
  newWorkout: '/workouts/new',
  workout: (id: string) => `/workouts/${id}`,
  editWorkout: (id: string) => `/workouts/${id}/edit`,
  newPlan: '/workouts/plans/new',
  plan: (id: string) => `/workouts/plans/${id}`,
  editPlan: (id: string) => `/workouts/plans/${id}/edit`,
  history: '/workouts/history',
  session: (id: string, options: { edit?: boolean } = {}) => `/workouts/history/${id}${options.edit ? '?edit=1' : ''}`,
  /** A new session, optionally seeded from a library workout, a past session, or the first-week starter. */
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
