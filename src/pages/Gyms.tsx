import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardMedia,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  SkeletonText,
  Tabs,
  Textarea,
  buttonClass,
  cx,
  useToast,
} from './ui';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MapPin,
  Refresh,
  Search,
  Star,
} from './icons';

/* ------------------------------------------------------------------ types */

type Review = {
  _id?: string;
  rating?: number;
  comment?: string;
  createdAt?: string;
  date?: string;
  user?: { _id?: string; username?: string; fullName?: string; avatar?: string };
};

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
  reviewsCount?: number;
  reviews?: Review[];
  /** Nearby search returns the great-circle distance in kilometres. */
  distanceKm?: number;
  distance?: number;
  location?: { lat?: number; lng?: number };
};

type Place = {
  place_id?: string;
  placeId?: string;
  name?: string;
  formatted_address?: string;
  formattedAddress?: string;
  vicinity?: string;
  rating?: number;
  user_ratings_total?: number;
  geometry?: { location?: { lat?: number; lng?: number } };
  source?: string;
};

type Coords = { lat: number; lng: number };

type GeoPermission = 'unsupported' | 'unknown' | 'prompt' | 'granted' | 'denied';

type LocateState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'ready'; at: number }
  | { kind: 'error'; code: number; message: string };

type GymsTab = 'all' | 'nearby' | 'places';

const PAGE_SIZE = 18;
const PLACE_LIMIT = 10;
const RADIUS_OPTIONS = [
  { value: '5', label: 'Within 5 km' },
  { value: '10', label: 'Within 10 km' },
  { value: '25', label: 'Within 25 km' },
  { value: '50', label: 'Within 50 km' },
];

/* ------------------------------------------------------------------ helpers */

const clampStars = (v: number) => Math.max(0, Math.min(5, v));

const gymImage = (g: Gym): string => mediaUrl(g.images?.[0] || g.photos?.[0]?.url || '');

function ratingOf(g: Gym): number {
  if (typeof g.averageRating === 'number') return g.averageRating;
  if (typeof g.rating === 'number') return g.rating;
  const rs = (g.reviews || []).map((r) => r.rating).filter((n): n is number => typeof n === 'number');
  if (!rs.length) return 0;
  return rs.reduce((a, b) => a + b, 0) / rs.length;
}

const reviewCountOf = (g: Gym): number => g.reviewCount ?? g.reviewsCount ?? g.reviews?.length ?? 0;

function distanceLabel(g: Gym): string | null {
  const km =
    typeof g.distanceKm === 'number'
      ? g.distanceKm
      : typeof g.distance === 'number'
        ? g.distance / 1000
        : null;
  if (km === null || !Number.isFinite(km)) return null;
  if (km < 1) return `${Math.max(50, Math.round(km * 1000 / 50) * 50)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

function mapsHref(name?: string, address?: string, loc?: { lat?: number; lng?: number }): string {
  if (typeof loc?.lat === 'number' && typeof loc?.lng === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(' '))}`;
}

const ago = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return '';
  }
};

/**
 * Mirrors the browser's geolocation permission so the page can decide between
 * asking explicitly, fetching silently (already granted) or showing the
 * blocked state — instead of triggering a prompt on tab change.
 */
function useGeoPermission(): GeoPermission {
  const [status, setStatus] = useState<GeoPermission>(() =>
    typeof navigator === 'undefined' || !('geolocation' in navigator) ? 'unsupported' : 'unknown',
  );
  useEffect(() => {
    if (status === 'unsupported') return;
    if (typeof navigator.permissions?.query !== 'function') return;
    let cancelled = false;
    let handle: PermissionStatus | null = null;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((p) => {
        if (cancelled) return;
        handle = p;
        setStatus(p.state);
        p.onchange = () => setStatus(p.state);
      })
      .catch(() => {
        /* Permissions API unavailable for geolocation: stay on 'unknown' and ask explicitly. */
      });
    return () => {
      cancelled = true;
      if (handle) handle.onchange = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return status;
}

/* ------------------------------------------------------------------ small parts */

function Stars({ value, size = 14, className }: { value: number; size?: number; className?: string }) {
  const filled = Math.round(clampStars(value));
  return (
    <span
      role="img"
      aria-label={`${clampStars(value).toFixed(1)} out of 5`}
      className={cx('inline-flex items-center gap-0.5', className)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          filled={n <= filled}
          className={n <= filled ? 'text-warning' : 'text-line-strong'}
        />
      ))}
    </span>
  );
}

function RatingRow({ gym, size = 14 }: { gym: Gym; size?: number }) {
  const count = reviewCountOf(gym);
  const value = ratingOf(gym);
  if (!count && !value) return <span className="text-xs text-text-3">No ratings yet</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <Stars value={value} size={size} />
      <span className="tabular text-xs font-semibold text-text-1">{value.toFixed(1)}</span>
      {count ? (
        <span className="text-xs text-text-3">
          {count} {count === 1 ? 'review' : 'reviews'}
        </span>
      ) : null}
    </span>
  );
}

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
      <span className="ml-2 text-sm text-text-2">
        {value} of 5
      </span>
    </div>
  );
}

function Pager({
  page,
  hasNext,
  onPrev,
  onNext,
  className,
}: {
  page: number;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}) {
  return (
    <nav aria-label="Pagination" className={cx('flex items-center justify-between gap-3', className)}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={onPrev} icon={<ChevronLeft size={16} />}>
        Previous
      </Button>
      <span className="tabular text-xs font-semibold text-text-2">Page {page}</span>
      <Button variant="secondary" size="sm" disabled={!hasNext} onClick={onNext} iconRight={<ChevronRight size={16} />}>
        Next
      </Button>
    </nav>
  );
}

function GymCardSkeleton() {
  return (
    <div className="card p-3">
      <Skeleton className="aspect-video w-full rounded-md" />
      <div className="mt-3 space-y-2 px-1">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading gyms">
      {Array.from({ length: count }).map((_, i) => (
        <GymCardSkeleton key={i} />
      ))}
    </div>
  );
}

function GymCard({ gym, onOpen }: { gym: Gym; onOpen: () => void }) {
  const img = gymImage(gym);
  const distance = distanceLabel(gym);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card card-interactive w-full p-3 text-left"
      aria-label={`${gym.name || 'Gym'} — open details`}
    >
      <CardMedia ratio="16/9">
        {img ? (
          <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-text-3">
            <MapPin size={28} />
          </span>
        )}
      </CardMedia>
      <div className="mt-3 space-y-1 px-1 pb-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-md font-semibold text-text-1">{gym.name || 'Unnamed gym'}</p>
          {distance ? (
            <Badge tone="brand" className="shrink-0">
              {distance}
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-text-2">{gym.address || gym.vicinity || 'Address not listed'}</p>
        <div className="pt-1">
          <RatingRow gym={gym} />
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ detail */

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
      setReviewPage(1);
      qc.invalidateQueries({ queryKey: ['gym', gymId] });
      qc.invalidateQueries({ queryKey: ['gyms'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not post your review')),
  });

  const gym = detail.data;
  const img = gym ? gymImage(gym) : '';

  return (
    <Modal
      open={Boolean(gymId)}
      onClose={onClose}
      size="lg"
      title={gym?.name || 'Gym'}
      description={gym ? gym.address || gym.vicinity || undefined : undefined}
    >
      {detail.isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="aspect-video w-full rounded-md" />
          <SkeletonText lines={3} />
        </div>
      ) : null}
      {detail.isError ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} /> : null}
      {gym ? (
        <div className="space-y-6">
          {img ? (
            <CardMedia ratio="16/9">
              <img src={img} alt={gym.name || 'Gym'} className="h-full w-full object-cover" />
            </CardMedia>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <RatingRow gym={gym} size={16} />
            <a
              href={mapsHref(gym.name, gym.address || gym.vicinity, gym.location)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ variant: 'secondary', size: 'sm' })}
            >
              <MapPin size={16} />
              Directions
              <ExternalLink size={14} className="text-text-3" />
            </a>
          </div>

          {gym.description ? <p className="prose-measure text-base text-text-1">{gym.description}</p> : null}

          <section className="space-y-3">
            <h3 className="type-heading text-lg text-text-1">Write a review</h3>
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
            <div className="flex justify-end">
              <Button variant="primary" loading={addReview.isPending} onClick={() => addReview.mutate()}>
                Post review
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="type-heading text-lg text-text-1">Reviews</h3>
            {reviews.isLoading ? (
              <div className="space-y-2" aria-busy="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-md" />
                ))}
              </div>
            ) : null}
            {reviews.isError ? <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} /> : null}
            {reviews.isSuccess && (reviews.data.reviews?.length || 0) === 0 ? (
              <EmptyState
                size="sm"
                icon={<Star size={24} />}
                title={reviewPage > 1 ? 'No more reviews' : 'No reviews yet'}
                message={reviewPage > 1 ? 'You have reached the end of the list.' : 'Train here? Your review helps the next person choose.'}
              />
            ) : null}
            {(reviews.data?.reviews?.length || 0) > 0 ? (
              <ul className="space-y-2">
                {(reviews.data?.reviews || []).map((r, i) => {
                  const name = r.user?.fullName || r.user?.username || 'Member';
                  return (
                    <li key={r._id || i} className="flex gap-3 rounded-md bg-surface-2 p-3">
                      <Avatar src={r.user?.avatar} name={name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <p className="truncate text-sm font-semibold text-text-1">{name}</p>
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
            {(reviews.data?.reviews?.length || 0) > 0 || reviewPage > 1 ? (
              <Pager
                page={reviewPage}
                hasNext={Boolean(reviews.data?.hasNextPage)}
                onPrev={() => setReviewPage((p) => Math.max(1, p - 1))}
                onNext={() => setReviewPage((p) => p + 1)}
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ nearby: location states */

function LocationPrompt({
  locating,
  onAllow,
  onFallback,
}: {
  locating: boolean;
  onAllow: () => void;
  onFallback: (tab: GymsTab) => void;
}) {
  return (
    <Card className="flex flex-col items-center gap-4 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand-text">
        <MapPin size={28} />
      </span>
      <div className="max-w-md space-y-1">
        <h2 className="type-heading text-lg text-text-1">Find gyms near you</h2>
        <p className="text-sm leading-relaxed text-text-2">
          Vybe asks your browser for your position once, uses it to list gyms within a few kilometres, and does not store it.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" loading={locating} onClick={onAllow} icon={<MapPin size={18} />}>
          Use my location
        </Button>
        <Button variant="ghost" onClick={() => onFallback('all')}>
          Browse the directory
        </Button>
      </div>
      <button type="button" onClick={() => onFallback('places')} className="btn btn-link text-sm">
        Or look a place up by name
      </button>
    </Card>
  );
}

function LocationBlocked({
  kind,
  message,
  retrying,
  onRetry,
  onFallback,
}: {
  kind: 'denied' | 'unsupported' | 'unavailable' | 'timeout';
  message?: string;
  retrying: boolean;
  onRetry: () => void;
  onFallback: (tab: GymsTab) => void;
}) {
  const copy = {
    denied: {
      title: 'Location is blocked for this site',
      body: 'Your browser is not sharing your position with Vybe. Open the site settings for this page (the icon next to the address), set Location to Allow, then try again.',
    },
    unsupported: {
      title: 'This browser cannot share your location',
      body: 'Nearby search needs the browser location service, which is not available here. You can still search the directory or look a place up by name.',
    },
    unavailable: {
      title: 'Your position could not be determined',
      body: message || 'The device could not get a fix. Check that location services are switched on and try again.',
    },
    timeout: {
      title: 'Locating took too long',
      body: 'The browser did not return a position in time. Move somewhere with better signal or try again.',
    },
  }[kind];
  return (
    <Card className="space-y-4">
      <EmptyState
        size="sm"
        variant="error"
        icon={<MapPin size={26} />}
        title={copy.title}
        message={copy.body}
        action={
          kind === 'unsupported' ? undefined : (
            <Button variant="primary" loading={retrying} onClick={onRetry} icon={<Refresh size={18} />}>
              Try again
            </Button>
          )
        }
        secondaryAction={{ label: 'Search by name', onClick: () => onFallback('all') }}
      />
      <Callout tone="brand" title="Prefer not to share your location?">
        Search the{' '}
        <button type="button" onClick={() => onFallback('all')} className="font-semibold text-brand-text underline-offset-2 hover:underline">
          gym directory
        </button>{' '}
        or find any{' '}
        <button type="button" onClick={() => onFallback('places')} className="font-semibold text-brand-text underline-offset-2 hover:underline">
          place by name
        </button>
        .
      </Callout>
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

export default function Gyms() {
  const [tab, setTab] = useState<GymsTab>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Share links land here as /gyms?gym=<id> (see lib/shareLinks.ts); the
  // detail modal opens for it and the parameter is dropped once it closes.
  const [params, setParams] = useSearchParams();
  const [openGym, setOpenGym] = useState<string | null>(() => params.get('gym'));
  const closeGym = () => {
    setOpenGym(null);
    if (params.has('gym')) {
      const next = new URLSearchParams(params);
      next.delete('gym');
      setParams(next, { replace: true });
    }
  };
  const [coords, setCoords] = useState<Coords | null>(null);
  const [radius, setRadius] = useState('10');
  const [locate, setLocate] = useState<LocateState>({ kind: 'idle' });
  const permission = useGeoPermission();
  const debounced = useDebounced(search.trim(), 400);

  useEffect(() => setPage(1), [debounced, tab, radius, coords]);

  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setLocate({ kind: 'error', code: 0, message: 'Location is not available in this browser.' });
      return;
    }
    setLocate({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: Number(pos.coords.latitude.toFixed(4)),
          lng: Number(pos.coords.longitude.toFixed(4)),
        });
        setLocate({ kind: 'ready', at: Date.now() });
      },
      (err) => {
        setLocate({ kind: 'error', code: err.code, message: err.message });
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  // Permission already granted: fetch silently. Otherwise wait for the explicit button.
  useEffect(() => {
    if (tab === 'nearby' && permission === 'granted' && !coords && locate.kind === 'idle') requestLocation();
  }, [tab, permission, coords, locate.kind, requestLocation]);

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
    queryKey: ['gyms', 'nearby', coords?.lat, coords?.lng, radius, page],
    enabled: tab === 'nearby' && Boolean(coords),
    queryFn: async () => {
      const { data } = await api.get('/gyms/nearby', {
        params: { lat: coords!.lat, lng: coords!.lng, radius: Number(radius), page, limit: PAGE_SIZE },
      });
      return data as { gyms: Gym[]; total: number; hasNextPage: boolean };
    },
  });

  const places = useQuery({
    queryKey: ['gyms', 'places', debounced],
    enabled: tab === 'places' && debounced.length > 0,
    queryFn: async () => {
      const { data } = await api.get('/gyms/place-search', {
        params: { q: debounced, limit: PLACE_LIMIT },
      });
      return (data.results || data.places || []) as Place[];
    },
  });

  const listQuery = tab === 'all' ? all : nearby;
  const gyms = useMemo<Gym[]>(() => listQuery.data?.gyms || [], [listQuery.data]);
  const hasNext = Boolean(listQuery.data?.hasNextPage);

  const switchTab = (next: GymsTab) => {
    setTab(next);
    if (next !== 'nearby') setSearch('');
  };

  const geoBlocked: 'denied' | 'unsupported' | 'unavailable' | 'timeout' | null =
    permission === 'unsupported'
      ? 'unsupported'
      : locate.kind === 'error'
        ? locate.code === 1
          ? 'denied'
          : locate.code === 3
            ? 'timeout'
            : locate.code === 2
              ? 'unavailable'
              : 'unsupported'
        : permission === 'denied' && !coords
          ? 'denied'
          : null;

  const nearbySubtitle =
    locate.kind === 'ready' ? `Updated ${ago(new Date(locate.at).toISOString()) || 'just now'}` : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Gyms" subtitle="Find a place to train and read what members think of it." />

      <Tabs
        variant="segmented"
        fill
        aria-label="Gym lists"
        tabs={[
          { value: 'all', label: 'Directory' },
          { value: 'nearby', label: 'Nearby' },
          { value: 'places', label: 'Places' },
        ]}
        value={tab}
        onChange={(k) => switchTab(k as GymsTab)}
      />

      {/* ---------------------------------------------------------------- directory */}
      {tab === 'all' ? (
        <section className="space-y-4" aria-label="Gym directory">
          <SearchField
            label="Search gyms"
            hideLabel
            placeholder="Search by gym name or address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {all.isLoading ? <CardGridSkeleton /> : null}
          {all.isError ? <ErrorState error={all.error} onRetry={() => all.refetch()} /> : null}
          {all.isSuccess && gyms.length === 0 ? (
            debounced ? (
              <EmptyState
                variant="no-results"
                title={`No gyms match “${debounced}”`}
                message="Check the spelling, or try the Places tab to look it up on the map."
                action={{ label: 'Search places', onClick: () => switchTab('places'), variant: 'secondary' }}
              />
            ) : (
              <EmptyState
                title="No gyms listed yet"
                message="Gyms appear here as members add and review them. Find the ones around you to start."
                action={{ label: 'Find gyms nearby', onClick: () => switchTab('nearby') }}
              />
            )
          ) : null}
          {gyms.length > 0 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {gyms.map((g) => (
                  <GymCard key={g._id} gym={g} onOpen={() => setOpenGym(g._id)} />
                ))}
              </div>
              <Pager
                page={page}
                hasNext={hasNext}
                onPrev={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => p + 1)}
              />
            </>
          ) : null}
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- nearby */}
      {tab === 'nearby' ? (
        <section className="space-y-4" aria-label="Gyms near you">
          {geoBlocked ? (
            <LocationBlocked
              kind={geoBlocked}
              message={locate.kind === 'error' ? locate.message : undefined}
              retrying={locate.kind === 'locating'}
              onRetry={requestLocation}
              onFallback={switchTab}
            />
          ) : !coords ? (
            <LocationPrompt locating={locate.kind === 'locating'} onAllow={requestLocation} onFallback={switchTab} />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-sm text-text-2">
                  <MapPin size={18} className="shrink-0 text-brand" />
                  <span className="truncate">
                    Using your current position{nearbySubtitle ? ` · ${nearbySubtitle}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    label="Search radius"
                    hideLabel
                    options={RADIUS_OPTIONS}
                    value={radius}
                    onChange={(v) => setRadius(v)}
                    containerClassName="w-40"
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    loading={locate.kind === 'locating'}
                    onClick={requestLocation}
                    icon={<Refresh size={18} />}
                  >
                    Update
                  </Button>
                </div>
              </div>

              {nearby.isLoading || (nearby.isPending && !nearby.data) ? <CardGridSkeleton /> : null}
              {nearby.isError ? <ErrorState error={nearby.error} onRetry={() => nearby.refetch()} /> : null}
              {nearby.isSuccess && gyms.length === 0 ? (
                <EmptyState
                  icon={<MapPin size={26} />}
                  title={`No gyms within ${radius} km`}
                  message="Nobody has added a gym in this area yet. Widen the search, or look one up by name and add it to your community."
                  action={
                    radius !== '50'
                      ? {
                          label: `Widen to ${RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.length - 1, RADIUS_OPTIONS.findIndex((o) => o.value === radius) + 1)].value} km`,
                          onClick: () =>
                            setRadius(
                              RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.length - 1, RADIUS_OPTIONS.findIndex((o) => o.value === radius) + 1)].value,
                            ),
                        }
                      : undefined
                  }
                  secondaryAction={{ label: 'Search places', onClick: () => switchTab('places') }}
                />
              ) : null}
              {gyms.length > 0 ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {gyms.map((g) => (
                      <GymCard key={g._id} gym={g} onOpen={() => setOpenGym(g._id)} />
                    ))}
                  </div>
                  <Pager
                    page={page}
                    hasNext={hasNext}
                    onPrev={() => setPage((p) => Math.max(1, p - 1))}
                    onNext={() => setPage((p) => p + 1)}
                  />
                </>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- places */}
      {tab === 'places' ? (
        <section className="space-y-4" aria-label="Place search">
          <SearchField
            label="Search places"
            hideLabel
            placeholder="Gym or studio name, e.g. “Iron Works Bethlehem”"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {!debounced ? (
            <EmptyState
              icon={<Search size={26} />}
              title="Look a place up by name"
              message="Searches the map provider for gyms and studios anywhere, including ones nobody on Vybe has added yet."
            />
          ) : null}
          {debounced && places.isLoading ? (
            <ul className="space-y-2" aria-busy="true" aria-label="Searching places">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="card flex items-center gap-3 p-3">
                  <Skeleton className="h-10 w-10 rounded-sm" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {places.isError ? (
            <ErrorState
              error={places.error}
              title="Place search is unavailable"
              message={errMsg(places.error, 'The map provider did not answer. Try again in a moment.')}
              onRetry={() => places.refetch()}
            />
          ) : null}
          {places.isSuccess && (places.data?.length || 0) === 0 ? (
            <EmptyState
              variant="no-results"
              title={`No places found for “${debounced}”`}
              message="Try the full name or add the city, e.g. “Planet Fitness Allentown”."
            />
          ) : null}
          {(places.data?.length || 0) > 0 ? (
            <ul className="space-y-2">
              {(places.data || []).map((p, i) => {
                const address = p.formatted_address || p.formattedAddress || p.vicinity || '';
                const loc = p.geometry?.location;
                return (
                  <li key={p.place_id || p.placeId || i} className="card flex items-center gap-3 p-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-text-2">
                      <MapPin size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text-1">{p.name || 'Place'}</p>
                      {address ? <p className="truncate text-xs text-text-2">{address}</p> : null}
                      {typeof p.rating === 'number' ? (
                        <span className="mt-1 inline-flex items-center gap-2">
                          <Stars value={p.rating} size={12} />
                          <span className="tabular text-xs text-text-2">
                            {p.rating.toFixed(1)}
                            {typeof p.user_ratings_total === 'number' ? ` · ${p.user_ratings_total.toLocaleString()} ratings` : ''}
                          </span>
                        </span>
                      ) : null}
                    </div>
                    <a
                      href={mapsHref(p.name, address, loc)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${p.name || 'place'} in Maps`}
                      title="Open in Maps"
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-2 transition-colors dur-1 hover:bg-surface-2 hover:text-text-1"
                    >
                      <ExternalLink size={20} />
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      <GymDetailModal gymId={openGym} onClose={closeGym} />
    </div>
  );
}
