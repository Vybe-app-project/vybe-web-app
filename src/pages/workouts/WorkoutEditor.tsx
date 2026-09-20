import { RouteSheet } from '../../components/RouteSheet';
import { EmptyState } from '../../components/ui';

/**
 * PLACEHOLDER (P2 shell). P4 replaces this module with the real
 * workout editor (`/workouts/new`, `/workouts/:workoutId/edit`); the route, its ROUTES metadata and the RouteSheet wrapper are
 * already wired, so only the body changes.
 */
export default function WorkoutEditor() {
  return (
    <RouteSheet title="Workout" backTo="/workouts">
      <EmptyState family="train" title="The workout editor is on its way" message="Start a session from Workouts in the meantime." />
    </RouteSheet>
  );
}
