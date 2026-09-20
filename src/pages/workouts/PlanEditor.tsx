import { RouteSheet } from '../../components/RouteSheet';
import { EmptyState } from '../../components/ui';

/**
 * PLACEHOLDER (P2 shell). P4 replaces this module with the real
 * plan editor (`/workouts/plans/new`, `/workouts/plans/:planId/edit`); the route, its ROUTES metadata and the RouteSheet wrapper are
 * already wired, so only the body changes.
 */
export default function PlanEditor() {
  return (
    <RouteSheet title="Plan" backTo="/workouts">
      <EmptyState family="train" title="The plan editor is on its way" message="Browse plans from Workouts in the meantime." />
    </RouteSheet>
  );
}
