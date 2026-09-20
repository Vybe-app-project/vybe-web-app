import { RouteSheet } from '../../components/RouteSheet';
import { EmptyState } from '../../components/ui';

/**
 * PLACEHOLDER (P2 shell). P4 replaces this module with the real
 * active session runner (`/workouts/active`); the route, its ROUTES metadata and the RouteSheet wrapper are
 * already wired, so only the body changes.
 */
export default function ActiveWorkout() {
  return (
    <RouteSheet title="Active session" backTo="/workouts">
      <EmptyState family="train" title="The session runner is on its way" message="Log a session from Workouts in the meantime." />
    </RouteSheet>
  );
}
