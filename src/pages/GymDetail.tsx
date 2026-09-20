import { RouteSheet } from '../components/RouteSheet';
import { EmptyState } from '../components/ui';

/**
 * PLACEHOLDER (P2 shell). P6 replaces this module with the real
 * gym page (`/gyms/:gymId`); the route, its ROUTES metadata and the RouteSheet wrapper are
 * already wired, so only the body changes.
 */
export default function GymDetail() {
  return (
    <RouteSheet title="Gym" backTo="/gyms">
      <EmptyState family="community" title="This gym page is on its way" message="Find where you train from the Gyms tab." />
    </RouteSheet>
  );
}
