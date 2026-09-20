import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { type CommunityPreset, isObjectId } from '../lib/gyms';
import type { GymBandGym } from '../components/GymBand';
import { MapTile, osmHref } from '../components/MapTile';
import { type Gym, RatingRow, Stars, gymImage, ratingOf, reviewCountOf } from './Gyms';
import { CommunitySurface } from './CommunityDetail';
import { type BandPreview, ago, communityHref, statusOf, unwrapCommunity, useCommunityAtPlace } from './GymCommunity';
import { Avatar, Badge, Button, Card, CardGrid, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton, SkeletonRow, SkeletonText, Textarea, useToast } from './ui';
import { ExternalLink, MapPin, Plus, Star, Trash, Users } from './icons';

/* ------------------------------------------------------------------ types */

type Review = {
  _id?: string;
  rating?: number;
  comment?: string;
  createdAt?: string;
  date?: string;
  user?: { _id?: string; username?: string; fullName?: string; avatar?: string };
};

const coordsOf = (g?: Gym | null): { lat: number; lng: number } | undefined => {
  const lat = g?.location?.lat;
  const lng = g?.location?.lng;
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
};

/** The band's gym from a directory row (`GET /gyms/:gymId`): name, address, a real rating, coordinates. */
function bandGymOfDirectory(g: Gym): GymBandGym {
  const rating = ratingOf(g);
  return {
    id: g._id,
    name: g.name || 'Gym',
    city: (g.address || g.vicinity || '').trim() || undefined,
    photoUrl: gymImage(g) || undefined,
    rating: reviewCountOf(g) > 0 && rating > 0 ? rating : null,
    coords: coordsOf(g),
  };
}

/** Pre-fills the community form from a directory gym; the place id travels verbatim. */
export function presetFromGym(g: Gym): CommunityPreset {
  const coords = coordsOf(g);
  return {
    placeId: g.placeId || undefined,
    name: g.name || undefined,
    vicinity: (g.address || g.vicinity || '').trim() || undefined,
    location: coords ? { latitude: coords.lat, longitude: coords.lng } : null,
  };
}

/* ------------------------------------------------------------------ reviews */

function RatingPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(5, value + 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(1, value - 1));
    }
  };
  return (
    <div role="radiogroup" aria-label="Your rating" className="flex items-center gap-1" onKeyDown={onKey}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
          tabIndex={n === value ? 0 : -1}
          onClick={() => onChange(n)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-sm transition-colors dur-1 hover:bg-surface-2"
        >
          <Star size={26} filled={n <= value} className={n <= value ? 'text-warning' : 'text-line-strong'} />
        </button>
      ))}
      <span className="ml-2 text-sm text-text-2">{value} of 5</span>
    </div>
  );
}

/**
 * Ratings and reviews for a directory gym (`/gyms/:gymId/reviews`). Rendered
 * on the gym page's About tab, whether or not a community exists here.
 */
export function GymReviews({ gym }: { gym: Gym }) {
  const gymId = gym._id;
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reviewPage, setReviewPage] = useState(1);
  const [writing, setWriting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const own = gym.viewerReview || null;
  // Seed the form from the viewer's review once it is known, so re-posting
  // reads as "Update review" rather than silently overwriting.
  useEffect(() => {
    if (own) {
      setRating(own.rating || 5);
      setComment(own.comment || '');
    }
  }, [own?.rating, own?.comment, own?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reviews = useQuery({
    queryKey: ['gym', gymId, 'reviews', reviewPage],
    queryFn: async () => {
      const { data } = await api.get(`/gyms/${gymId}/reviews`, { params: { page: reviewPage, limit: 10 } });
      return data as { reviews: Review[]; hasNextPage?: boolean; total?: number; totalPages?: number };
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['gym', gymId] });
    qc.invalidateQueries({ queryKey: ['gyms'] });
  };

  const saveReview = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/gyms/${gymId}/review`, { rating, comment: comment.trim() || undefined });
      return data as { message?: string };
    },
    onSuccess: (data) => {
      toast.success(data?.message || (own ? 'Review updated' : 'Review posted'));
      setReviewPage(1);
      setWriting(false);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save your review')),
  });

  const removeReview = useMutation({
    mutationFn: async () => {
      const { data } = await api.delete(`/gyms/${gymId}/review`);
      return data as { message?: string };
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Review removed');
      setConfirmRemove(false);
      setRating(5);
      setComment('');
      setReviewPage(1);
      invalidate();
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not remove your review'));
      setConfirmRemove(false);
    },
  });

  const count = reviewCountOf(gym);
  const list = reviews.data?.reviews || [];
  const hasNext = Boolean(reviews.data?.hasNextPage);

  return (
    <Card container>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="type-heading text-lg text-text-1">Ratings and reviews</h2>
          <div className="mt-1">{count > 0 ? <RatingRow gym={gym} size={16} /> : <p className="text-sm text-text-2">Train here? Your review helps the next person choose.</p>}</div>
        </div>
        {!writing && !own ? (
          <Button variant="secondary" size="sm" icon={<Star size={16} />} onClick={() => setWriting(true)}>
            Write a review
          </Button>
        ) : null}
        {!writing && own ? (
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setWriting(true)}>
              Edit your review
            </Button>
            <Button variant="ghost" size="sm" icon={<Trash size={16} />} onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          </div>
        ) : null}
      </div>

      {writing ? (
        <section className="mt-4 space-y-3 rounded-md bg-surface-2 p-3" aria-label={own ? 'Your review' : 'Write a review'}>
          {own?.date ? <p className="text-xs text-text-3">Posted {ago(own.date)}. Changes replace your earlier review.</p> : null}
          <RatingPicker value={rating} onChange={setRating} />
          <Textarea
            label="Your review"
            hint="Optional — what stood out about the equipment, staff or crowd?"
            rows={3}
            autoGrow
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setWriting(false)} disabled={saveReview.isPending}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" loading={saveReview.isPending} onClick={() => saveReview.mutate()}>
              {own ? 'Update review' : 'Post review'}
            </Button>
          </div>
        </section>
      ) : null}

      <div className="mt-4">
        {reviews.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : null}
        {reviews.isError ? <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} className="py-6" /> : null}
        {reviews.isSuccess && list.length === 0 && reviewPage > 1 ? <p className="text-sm text-text-2">You have reached the end of the list.</p> : null}
        {list.length > 0 ? (
          <ul className="divide-y divide-line">
            {list.map((r, i) => {
              const who = r.user?.fullName || r.user?.username || 'Member';
              const mine = Boolean(me?._id && r.user?._id && String(r.user._id) === String(me._id));
              return (
                <li key={r._id || i} className="flex gap-3 py-3">
                  <Avatar src={r.user?.avatar} name={who} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-text-1">
                        <span className="truncate">{who}</span>
                        {mine ? (
                          <Badge tone="brand" size="sm">
                            You
                          </Badge>
                        ) : null}
                      </p>
                      <span className="text-xs text-text-3">{ago(r.createdAt || r.date)}</span>
                    </div>
                    <Stars value={r.rating || 0} size={13} className="mt-0.5" />
                    {r.comment ? <p className="mt-1.5 whitespace-pre-wrap text-sm text-text-1">{r.comment}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        {reviewPage > 1 || hasNext ? (
          <nav aria-label="Review pages" className="mt-3 flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" disabled={reviewPage <= 1} onClick={() => setReviewPage((p) => Math.max(1, p - 1))}>
              Newer
            </Button>
            <span className="tabular text-xs font-semibold text-text-2">Page {reviewPage}</span>
            <Button variant="ghost" size="sm" disabled={!hasNext} onClick={() => setReviewPage((p) => p + 1)}>
              Older
            </Button>
          </nav>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title="Remove your review?"
        message="Your rating and comment come off this gym. You can write a new one any time."
        confirmLabel="Remove review"
        destructive
        loading={removeReview.isPending}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => removeReview.mutate()}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ a directory gym with no community yet */

function DirectoryGymSurface({ gym }: { gym: Gym }) {
  const navigate = useNavigate();
  const coords = coordsOf(gym);
  const address = (gym.address || gym.vicinity || '').trim();
  const name = gym.name || 'Gym';
  const start = () => navigate('/communities', { state: { startCommunity: presetFromGym(gym) }, viewTransition: true });
  return (
    <div className="space-y-section">
      <PageHeader
        title={name}
        back="/gyms"
        hideSectionTabs
        band={{
          variant: 'full',
          gym: bandGymOfDirectory(gym),
          action: (
            <Button variant="primary" size="lg" icon={<Users size={18} />} onClick={start}>
              Start the community
            </Button>
          ),
        }}
      />
      <CardGrid min="20rem" aria-label={`About ${name}`}>
        <Card container>
          <h2 className="type-heading text-lg text-text-1">Nobody trains here on Vybe yet</h2>
          <p className="mt-1 text-sm text-text-2">
            Start the community at {name} and it becomes a place in the app: a feed, a check-in board and the people who train here. You are its first admin.
          </p>
          <div className="mt-3">
            <Button variant="secondary" size="sm" icon={<Plus size={16} />} onClick={start}>
              Start the community at {name}
            </Button>
          </div>
        </Card>
        {coords || address ? (
          <Card container>
            <h2 className="type-heading text-lg text-text-1">Where</h2>
            <div className="mt-3 flex flex-wrap items-start gap-4">
              {coords ? (
                <a
                  href={osmHref(coords.lat, coords.lng)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${name} on OpenStreetMap`}
                  className="block shrink-0 overflow-hidden rounded-md shadow-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <MapTile lat={coords.lat} lng={coords.lng} size={160} />
                </a>
              ) : null}
              <div className="min-w-0 flex-1 space-y-2">
                {address ? (
                  <p className="flex items-start gap-1.5 text-sm text-text-1">
                    <MapPin size={16} className="mt-0.5 shrink-0 text-text-3" />
                    <span>{address}</span>
                  </p>
                ) : null}
                {gym.description ? <p className="prose-measure text-sm text-text-2">{gym.description}</p> : null}
                {coords ? (
                  <a href={osmHref(coords.lat, coords.lng)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-text underline-offset-2 hover:underline">
                    Open in OpenStreetMap
                    <ExternalLink size={14} />
                  </a>
                ) : null}
              </div>
            </div>
          </Card>
        ) : null}
        <GymReviews gym={gym} />
      </CardGrid>
    </div>
  );
}

/* ------------------------------------------------------------------ route: /gyms/:gymId */

/**
 * The gym page. A directory gym (`GET /gyms/:gymId`) that has a community at
 * its place renders the full community surface with its reviews folded into
 * About; one without a community invites the viewer to start it. An id that is
 * only a community (older share links used type=gym) redirects to its route.
 */
export default function GymDetail() {
  const { gymId = '' } = useParams();
  const location = useLocation();
  const preview = (location.state as { gym?: BandPreview } | null)?.gym || null;

  const detail = useQuery({
    queryKey: ['gym', gymId],
    enabled: Boolean(gymId),
    retry: (count, error) => statusOf(error) !== 404 && count < 2,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/${gymId}`);
      return (data.gym || data) as Gym;
    },
  });
  const notFound = detail.isError && statusOf(detail.error) === 404;

  const communityFallback = useQuery({
    queryKey: ['gym', gymId, 'community-fallback'],
    enabled: notFound && isObjectId(gymId),
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${gymId}`);
      return unwrapCommunity(data);
    },
  });

  const gym = detail.data;
  const linked = useCommunityAtPlace(gym?.placeId);

  if (communityFallback.isSuccess && communityFallback.data?._id) {
    return <Navigate to={communityHref(communityFallback.data._id)} replace />;
  }

  const resolving = detail.isLoading || (notFound && isObjectId(gymId) && communityFallback.isPending) || (Boolean(gym?.placeId) && linked.isPending);

  if (resolving) {
    return (
      <div className="space-y-section">
        <PageHeader title={preview?.name || 'Gym'} back="/gyms" hideSectionTabs band={preview ? { variant: 'full', gym: { id: preview.id ?? gymId, name: preview.name, city: preview.city, photoUrl: preview.photoUrl } } : undefined} />
        <div className="space-y-4" aria-busy="true" aria-label="Loading gym">
          <Skeleton className="h-8 w-56" />
          <SkeletonText lines={2} />
          <SkeletonRow />
        </div>
      </div>
    );
  }

  if (notFound || !gym) {
    return (
      <div className="space-y-section">
        <PageHeader title="Gym" back="/gyms" hideSectionTabs />
        {detail.isError && !notFound ? (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        ) : (
          <EmptyState
            variant="no-results"
            title="This gym is no longer listed"
            message="The link may be old, or the gym was removed from the directory. Search for the place and it is back in one tap."
            action={{ label: 'Search places', to: '/gyms?tab=places' }}
            secondaryAction={{ label: 'Browse the directory', to: '/gyms?tab=all' }}
          />
        )}
      </div>
    );
  }

  if (linked.data?._id) {
    return <CommunitySurface key={linked.data._id} communityId={linked.data._id} preview={preview} back="/gyms" aboutExtra={<GymReviews gym={gym} />} />;
  }
  return <DirectoryGymSurface gym={gym} />;
}
