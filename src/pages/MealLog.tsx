import { RouteSheet } from '../components/RouteSheet';
import { EmptyState } from '../components/ui';

/**
 * PLACEHOLDER (P2 shell). P5 replaces this module with the real
 * meal logger (`/meals/log`); the route, its ROUTES metadata and the RouteSheet wrapper are
 * already wired, so only the body changes.
 */
export default function MealLog() {
  return (
    <RouteSheet title="Log meal" backTo="/meals">
      <EmptyState family="fuel" title="The meal logger is on its way" message="Log a meal from Meals in the meantime." />
    </RouteSheet>
  );
}
