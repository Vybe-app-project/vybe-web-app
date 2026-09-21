import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Badge, Card, CardMedia, Skeleton, cx } from '../ui';
import { Clock, MapPin } from '../icons';
import { PlaceImage } from '../../components/PlaceImage';
import { type Community, communityHref, communityLinkState, useCommunityCover } from '../GymCommunity';

/**
 * A gym the member added that the map did not have
 * (docs/api-contract.md, "Member-added gyms"): the create branch of
 * `POST /gyms/community/join` with a `user-<24 hex>` place id writes
 * `source: 'member'` and `reviewState: 'pending'`, and a pending community is
 * visible to its members only — nobody else sees it in the directory or on
 * explore, and it is `404` to them by id.
 *
 * So the creator is the only person who can be told where it stands, and
 * this is where: its own card on the directory, with the state on it. There
 * is no notification when an operator decides (the API says so in as many
 * words), which is exactly why the card has to say it.
 */

export type PendingGym = Community & { source?: string; reviewState?: string };

/** `pending` waits for an operator; `rejected` was turned down and the members still see it. */
export const isPendingReview = (c?: PendingGym | null): boolean => c?.reviewState === 'pending';
export const isRejected = (c?: PendingGym | null): boolean => c?.reviewState === 'rejected';

/** Only the member-added rows that are still under review, or were turned down. */
export function underReview(list: PendingGym[]): PendingGym[] {
  return list.filter((c) => isPendingReview(c) || isRejected(c));
}

/**
 * The member's own communities, read only to find the ones still under
 * review. One page of the list the member already has; a failure is silent,
 * because this is a note beside the directory, not the directory itself.
 */
export function useGymsUnderReview(enabled: boolean) {
  return useQuery<PendingGym[]>({
    queryKey: ['communities', 'mine', 'under-review'],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const { data } = await api.get('/gyms/community/my-communities', { params: { page: 1, limit: 50 } });
        const rows = (data.data?.gymCommunities || data.gymCommunities || []) as PendingGym[];
        return underReview(rows);
      } catch {
        return [];
      }
    },
  });
}

function PendingGymCard({ community }: { community: PendingGym }) {
  const cover = useCommunityCover(community);
  const rejected = isRejected(community);
  const name = community.name || 'Your gym';
  const place = community.vicinity?.trim();
  return (
    <Card padded={false} container interactive className="relative p-3">
      <Link
        to={communityHref(community._id)}
        state={communityLinkState(community, cover)}
        viewTransition
        aria-label={`Open ${name}`}
        className="absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      <CardMedia ratio="16/9">
        <PlaceImage src={cover || null} name={name} className="h-full w-full" textClassName="text-xl" />
      </CardMedia>
      <div className="mt-3 space-y-1 px-1 pb-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-md font-semibold text-text-1">{name}</h3>
          <Badge tone={rejected ? 'warning' : 'info'} className="shrink-0">
            <Clock size={12} />
            {rejected ? 'Not added' : 'Pending review'}
          </Badge>
        </div>
        {place ? (
          <p className="flex min-w-0 items-center gap-1 truncate text-xs text-text-2">
            <MapPin size={13} className="shrink-0 text-text-3" />
            <span className="truncate">{place}</span>
          </p>
        ) : null}
        <p className="t-meta">
          {rejected
            ? 'Vybe did not add this one to the directory. You and its members can still use it.'
            : 'You added this gym, so only you and its members can see it until Vybe adds it to the directory.'}
        </p>
      </div>
    </Card>
  );
}

/**
 * The cards, above the directory. Absent when the member has added nothing
 * that is waiting — never an empty heading.
 */
export function GymsUnderReview({ list, loading, className }: { list: PendingGym[]; loading?: boolean; className?: string }) {
  if (loading) {
    return (
      <div className={cx('space-y-2', className)} aria-busy="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64 max-w-full" />
      </div>
    );
  }
  if (!list.length) return null;
  return (
    <section className={cx('space-y-3', className)} aria-label="Gyms you added">
      <div>
        <h2 className="t-section text-text-1">{list.length === 1 ? 'The gym you added' : 'The gyms you added'}</h2>
        <p className="t-body text-text-2">Yours until Vybe adds them to the directory. You can already train, check in and post at them.</p>
      </div>
      <ul className="grid gap-3 @md:grid-cols-2">
        {list.map((c) => (
          <li key={c._id}>
            <PendingGymCard community={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}
