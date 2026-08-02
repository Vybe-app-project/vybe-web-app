import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  Spinner,
  Tabs,
  Textarea,
  useToast,
} from './ui';
import { MapPin, Search } from './icons';

type Gym = {
  _id: string;
  name?: string;
  address?: string;
  vicinity?: string;
  description?: string;
  images?: string[];
  photos?: { url?: string }[];
  rating?: number;
  averageRating?: number;
  reviewCount?: number;
  distance?: number;
  location?: { coordinates?: [number, number] };
};

type Place = {
  placeId?: string;
  place_id?: string;
  name?: string;
  address?: string;
  vicinity?: string;
  formattedAddress?: string;
  rating?: number;
  location?: { lat?: number; lng?: number };
};

type Review = {
  _id?: string;
  rating?: number;
  comment?: string;
  createdAt?: string;
  user?: { _id?: string; username?: string; fullName?: string; avatar?: string };
};

const PAGE_SIZE = 20;

function useDebounced<T>(value: T, delay = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

const gymImage = (g: Gym): string =>
  mediaUrl(g.images?.[0] || g.photos?.[0]?.url || '');

const ratingOf = (g: Gym) => g.averageRating ?? g.rating ?? 0;

const Stars = ({ value }: { value: number }) => (
  <span className="text-xs text-amber-300" aria-label={`${value} out of 5`}>
    {'★'.repeat(Math.round(Math.max(0, Math.min(value, 5))))}
    <span className="text-[var(--color-line)]">
      {'★'.repeat(5 - Math.round(Math.max(0, Math.min(value, 5))))}
    </span>
  </span>
);

function GymCard({ gym, onOpen }: { gym: Gym; onOpen: () => void }) {
  const img = gymImage(gym);
  return (
    <button type="button" onClick={onOpen} className="card overflow-hidden text-left">
      <div className="h-32 w-full bg-[var(--color-surface-2)]">
        {img ? (
          <img src={img} alt={gym.name || 'Gym'} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[var(--color-muted)]">
            <MapPin />
          </span>
        )}
      </div>
      <div className="space-y-1 p-3">
        <p className="truncate text-sm font-semibold">{gym.name || 'Unnamed gym'}</p>
        <p className="truncate text-xs text-[var(--color-muted)]">
          {gym.address || gym.vicinity || 'No address on file'}
        </p>
        <div className="flex items-center gap-2">
          <Stars value={ratingOf(gym)} />
          {typeof gym.distance === 'number' && (
            <Badge>{(gym.distance / 1000).toFixed(1)} km</Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function GymDetailModal({ gymId, onClose }: { gymId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reviewPage, setReviewPage] = useState(1);

  useEffect(() => {
    setRating(5);
    setComment('');
    setReviewPage(1);
  }, [gymId]);

  const detail = useQuery({
    queryKey: ['gym', gymId],
    enabled: Boolean(gymId),
    queryFn: async () => {
      const { data } = await api.get(`/gyms/${gymId}`);
      return (data.gym || data) as Gym;
    },
  });

  const reviews = useQuery({
    queryKey: ['gym', gymId, 'reviews', reviewPage],
    enabled: Boolean(gymId),
    queryFn: async () => {
      const { data } = await api.get(`/gyms/${gymId}/reviews`, {
        params: { page: reviewPage, limit: 10 },
      });
      return data as { reviews: Review[]; hasNextPage?: boolean };
    },
  });

  const addReview = useMutation({
    mutationFn: async () => {
      await api.post(`/gyms/${gymId}/review`, { rating, comment: comment.trim() || undefined });
    },
    onSuccess: () => {
      toast.success('Review posted');
      setComment('');
      qc.invalidateQueries({ queryKey: ['gym', gymId] });
      reviews.refetch();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not post the review')),
  });

  const gym = detail.data;

  return (
    <Modal open={Boolean(gymId)} onClose={onClose} title={gym?.name || 'Gym details'}>
      {detail.isLoading && <Skeleton className="h-40 w-full" />}
      {detail.isError && (
        <ErrorState message={errMsg(detail.error)} onRetry={() => detail.refetch()} />
      )}
      {gym && (
        <div className="space-y-4">
          {gymImage(gym) && (
            <img
              src={gymImage(gym)}
              alt={gym.name || 'Gym'}
              className="h-40 w-full rounded-xl object-cover"
            />
          )}
          <div>
            <p className="text-sm text-[var(--color-muted)]">
              {gym.address || gym.vicinity || 'No address on file'}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <Stars value={ratingOf(gym)} />
              <span className="text-xs text-[var(--color-muted)]">
                {gym.reviewCount ?? 0} reviews
              </span>
            </div>
          </div>
          {gym.description && <p className="text-sm">{gym.description}</p>}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Write a review</h3>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  className={`text-xl ${n <= rating ? 'text-amber-300' : 'text-[var(--color-line)]'}`}
                  aria-label={`Rate ${n}`}
                >
                  ★
                </button>
              ))}
            </div>
            <Textarea
              rows={3}
              placeholder="Share your experience"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <Button disabled={addReview.isPending} onClick={() => addReview.mutate()}>
              {addReview.isPending ? <Spinner size={16} /> : 'Post review'}
            </Button>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Reviews</h3>
            {reviews.isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            {reviews.isError && (
              <ErrorState message={errMsg(reviews.error)} onRetry={() => reviews.refetch()} />
            )}
            {reviews.isSuccess && (reviews.data.reviews?.length || 0) === 0 && (
              <EmptyState title="No reviews yet" description="Be the first to review this gym." />
            )}
            <ul className="space-y-2">
              {(reviews.data?.reviews || []).map((r, i) => (
                <li key={r._id || i} className="flex gap-3 rounded-xl bg-[var(--color-surface-2)] p-3">
                  <Avatar
                    src={mediaUrl(r.user?.avatar)}
                    name={r.user?.fullName || r.user?.username}
                    size={32}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">
                      {r.user?.fullName || r.user?.username || 'Member'}
                    </p>
                    <Stars value={r.rating || 0} />
                    {r.comment && <p className="mt-1 text-sm">{r.comment}</p>}
                    {r.createdAt && (
                      <p className="mt-1 text-[11px] text-[var(--color-muted)]">
                        {formatDistanceToNowStrict(new Date(r.createdAt), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                disabled={reviewPage === 1}
                onClick={() => setReviewPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-xs text-[var(--color-muted)]">Page {reviewPage}</span>
              <Button
                variant="ghost"
                disabled={!reviews.data?.hasNextPage}
                onClick={() => setReviewPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}

export default function Gyms() {
  const toast = useToast();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openGym, setOpenGym] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const debounced = useDebounced(search);

  useEffect(() => setPage(1), [debounced, tab]);

  const requestLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeoError('Location is not available in this browser.');
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoLoading(false);
      },
      (err) => {
        setGeoLoading(false);
        setGeoError(err.message || 'Location permission denied.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  useEffect(() => {
    if (tab === 'nearby' && !coords && !geoError && !geoLoading) requestLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const all = useQuery({
    queryKey: ['gyms', 'all', page, debounced],
    enabled: tab === 'all',
    queryFn: async () => {
      const { data } = await api.get('/gyms', {
        params: { page, limit: PAGE_SIZE, q: debounced || undefined },
      });
      return data as { gyms: Gym[]; total: number; page: number; hasNextPage: boolean };
    },
  });

  const nearby = useQuery({
    queryKey: ['gyms', 'nearby', coords?.lat, coords?.lng, page],
    enabled: tab === 'nearby' && Boolean(coords),
    queryFn: async () => {
      const { data } = await api.get('/gyms/nearby', {
        params: { lat: coords!.lat, lng: coords!.lng, page, limit: PAGE_SIZE },
      });
      return data as { gyms: Gym[]; total: number; hasNextPage: boolean };
    },
  });

  const places = useQuery({
    queryKey: ['gyms', 'places', debounced],
    enabled: tab === 'places' && debounced.trim().length > 0,
    queryFn: async () => {
      const { data } = await api.get('/gyms/place-search', {
        params: { q: debounced.trim(), limit: 20 },
      });
      return (data.places || data.results || []) as Place[];
    },
  });

  const activeQuery = tab === 'all' ? all : tab === 'nearby' ? nearby : places;
  const gyms = useMemo<Gym[]>(() => {
    if (tab === 'all') return all.data?.gyms || [];
    if (tab === 'nearby') return nearby.data?.gyms || [];
    return [];
  }, [tab, all.data, nearby.data]);

  const hasNext =
    tab === 'all' ? Boolean(all.data?.hasNextPage) : tab === 'nearby' ? Boolean(nearby.data?.hasNextPage) : false;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Gyms</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Discover gyms nearby, browse the directory and read member reviews.
          </p>
        </div>
        {tab === 'nearby' && (
          <Button variant="ghost" disabled={geoLoading} onClick={requestLocation}>
            {geoLoading ? <Spinner size={16} /> : 'Refresh location'}
          </Button>
        )}
      </header>

      <Tabs
        tabs={[
          { value: 'all', label: 'Directory' },
          { value: 'nearby', label: 'Nearby' },
          { value: 'places', label: 'Place search' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {(tab === 'all' || tab === 'places') && (
        <Input
          placeholder={tab === 'places' ? 'Search places by name' : 'Search gyms'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {tab === 'nearby' && geoError && (
        <Card className="p-4">
          <ErrorState message={geoError} onRetry={requestLocation} />
        </Card>
      )}

      {activeQuery.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      )}

      {activeQuery.isError && (
        <ErrorState message={errMsg(activeQuery.error)} onRetry={() => activeQuery.refetch()} />
      )}

      {tab === 'places' ? (
        <>
          {places.isSuccess && (places.data?.length || 0) === 0 && (
            <EmptyState
              icon={<Search />}
              title="No places found"
              description="Try a different search term."
            />
          )}
          {debounced.trim().length === 0 && (
            <EmptyState
              icon={<Search />}
              title="Search for a place"
              description="Type a gym or studio name to look it up."
            />
          )}
          <ul className="space-y-2">
            {(places.data || []).map((p, i) => (
              <li
                key={p.placeId || p.place_id || i}
                className="card flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-xs text-[var(--color-muted)]">
                    {p.address || p.formattedAddress || p.vicinity}
                  </p>
                </div>
                {typeof p.rating === 'number' && <Stars value={p.rating} />}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {activeQuery.isSuccess && gyms.length === 0 && (
            <EmptyState
              icon={<MapPin />}
              title="No gyms found"
              description={
                tab === 'nearby'
                  ? 'We could not find gyms around your location.'
                  : 'Try another search term.'
              }
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gyms.map((g) => (
              <GymCard key={g._id} gym={g} onOpen={() => setOpenGym(g._id)} />
            ))}
          </div>
          {gyms.length > 0 && (
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-xs text-[var(--color-muted)]">Page {page}</span>
              <Button variant="ghost" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}

      <GymDetailModal gymId={openGym} onClose={() => setOpenGym(null)} />
    </div>
  );
}
