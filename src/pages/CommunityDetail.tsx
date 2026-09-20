import { RouteSheet } from '../components/RouteSheet';
import { EmptyState } from '../components/ui';

/**
 * PLACEHOLDER (P2 shell). P6 replaces this module with the real
 * community page (`/communities/:communityId`); the route, its ROUTES metadata and the RouteSheet wrapper are
 * already wired, so only the body changes.
 */
export default function CommunityDetail() {
  return (
    <RouteSheet title="Community" backTo="/communities">
      <EmptyState family="community" title="This community page is on its way" message="Browse communities from the Gyms tab." />
    </RouteSheet>
  );
}
