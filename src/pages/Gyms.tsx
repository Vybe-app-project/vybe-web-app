import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounced } from '../lib/hooks';
import { PlaceImage } from '../components/PlaceImage';
import {
  communityPath,
  dedupeProviderPlaces,
  distanceLabelKm,
  haversineKm,
  isObjectId,
  presetFromPlace,
  providerRadiusMeters,
} from '../lib/gyms';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardMedia,
  ConfirmDialog,
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
  prefersReducedMotion,
  useToast,
} from './ui';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MapPin,
  Plus,
  Refresh,
  Search,
  Star,
  Trash,
  Users,
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
  placeId?: string;
  rating?: number;
  averageRating?: number | null;
  reviewCount?: number;
  reviewsCount?: number;
  reviews?: Review[];
  viewerReview?: { _id?: string; rating?: number; comment?: string; date?: string } | null;
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
  display_name?: string;
  vicinity?: string;
  rating?: number;
  user_ratings_total?: number;
  distanceKm?: number;
  geometry?: { location?: { lat?: number; lng?: number } };
  /** Signed same-origin picture link resolved by the API from public map data; null = draw a tile. */
  photoUrl?: string | null;
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
type GymSort = 'newest' | 'rating' | 'name';

const PAGE_SIZE = 18;
const PLACE_LIMIT = 10;
const RADIUS_OPTIONS = [
  { value: '5', label: 'Within 5 km' },
  { value: '10', label: 'Within 10 km' },
  { value: '25', label: 'Within 25 km' },
  { value: '50', label: 'Within 50 km' },
];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'rating', label: 'Top rated' },
  { value: 'name', label: 'Name A–Z' },
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
  return distanceLabelKm(km);
}

function placeDistanceKm(p: Place, coords: Coords | null): number | null {
  if (typeof p.distanceKm === 'number') return p.distanceKm;
  const lat = p.geometry?.location?.lat;
  const lng = p.geometry?.location?.lng;
  if (!coords || typeof lat !== 'number' || typeof lng !== 'number') return null;
  return haversineKm(coords.lat, coords.lng, lat, lng);
}

const placeAddress = (p: Place) => p.formatted_address || p.formattedAddress || p.vicinity || p.display_name || '';

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

const scrollToTop = () => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });

const statusOf = (error: unknown): number | undefined => (error as { response?: { status?: number } } | null)?.response?.status;

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
  totalPages,
  hasNext,
  onPrev,
  onNext,
  className,
}: {
  page: number;
  totalPages?: number;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}) {
  // A single page needs no pager: "Previous · Page 1 · Next" with both
  // buttons disabled reads as broken.
  if (page <= 1 && !hasNext) return null;
  return (
    <nav aria-label="Pagination" className={cx('flex items-center justify-between gap-3', className)}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={onPrev} icon={<ChevronLeft size={16} />}>
        Previous
      </Button>
      <span className="tabular text-xs font-semibold text-text-2">
        Page {page}
        {totalPages ? ` of ${Math.max(totalPages, 1)}` : ''}
      </span>
      <Button variant="secondary" size="sm" disabled={!hasNext} onClick={onNext} iconRight={<ChevronRight size={16} />}>
        Next
      </Button>
    </nav>
  );
}

function GymRowSkeleton() {
  return (
    <div className="card flex items-center gap-3 p-3">
      <Skeleton className="h-14 w-14 shrink-0 rounded-md" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

function ListSkeleton({ count = 6, label = 'Loading gyms' }: { count?: number; label?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }).map((_, i) => (
        <GymRowSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * A gym with a photo gets the media card; without one it is a compact row
 * (tile, name, address, rating) so a phone can scan eighteen gyms without a
 * 12,000 px scroll of empty 16:9 placeholders.
 */
function GymCard({ gym, onOpen }: { gym: Gym; onOpen: () => void }) {
  const img = gymImage(gym);
  const distance = distanceLabel(gym);
  if (!img) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="card card-interactive flex w-full items-center gap-3 p-3 text-left"
        aria-label={`${gym.name || 'Gym'} — open details`}
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-2">
          <MapPin size={24} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 truncate text-md font-semibold text-text-1">{gym.name || 'Unnamed gym'}</span>
            {distance ? (
              <Badge tone="brand" className="shrink-0">
                {distance}
              </Badge>
            ) : null}
          </span>
          <span className="block truncate text-xs text-text-2">{gym.address || gym.vicinity || 'Address not listed'}</span>
          <span className="mt-1 block">
            <RatingRow gym={gym} />
          </span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card card-interactive w-full p-3 text-left"
      aria-label={`${gym.name || 'Gym'} — open details`}
    >
      <CardMedia ratio="16/9">
        <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
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

/* ------------------------------------------------------------------ map results */

function useAddGym(onAdded: (gym: Gym, existing: boolean) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (place: Place) => {
      const loc = place.geometry?.location;
      const { data } = await api.post('/gyms/add', {
        name: place.name || 'Gym',
        address: placeAddress(place) || place.name || 'Address not listed',
        location: { lat: loc?.lat, lng: loc?.lng },
        ...(place.place_id || place.placeId ? { placeId: place.place_id || place.placeId } : {}),
      });
      return data as { gym: Gym; existing?: boolean };
    },
    onSuccess: (data) => {
      if (data.existing) toast.info(`${data.gym?.name || 'This gym'} is already on Vybe — opening it`);
      else toast.success(`${data.gym?.name || 'Gym'} added to Vybe`);
      qc.invalidateQueries({ queryKey: ['gyms'] });
      onAdded(data.gym, Boolean(data.existing));
    },
    onError: (e) => toast.error(errMsg(e, 'Could not add this gym')),
  });
}

function PlaceRow({
  place,
  coords,
  onAdd,
  adding,
  disabled,
}: {
  place: Place;
  coords: Coords | null;
  onAdd: (place: Place) => void;
  adding: boolean;
  disabled: boolean;
}) {
  const navigate = useNavigate();
  const address = placeAddress(place);
  const loc = place.geometry?.location;
  const distance = distanceLabelKm(placeDistanceKm(place, coords));
  const key = place.place_id || place.placeId;
  return (
    <li className="card p-3">
      <div className="flex items-start gap-3">
        <PlaceImage src={place.photoUrl} name={place.name} className="h-14 w-14 rounded-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold text-text-1">{place.name || 'Place'}</p>
            {distance ? (
              <Badge tone="brand" className="shrink-0">
                {distance}
              </Badge>
            ) : null}
          </div>
          {address ? (
            <p className="truncate text-xs text-text-2" title={place.display_name || address}>
              {address}
            </p>
          ) : null}
          {typeof place.rating === 'number' ? (
            <span className="mt-1 inline-flex items-center gap-2">
              <Stars value={place.rating} size={12} />
              <span className="tabular text-xs text-text-2">
                {place.rating.toFixed(1)}
                {typeof place.user_ratings_total === 'number' ? ` · ${place.user_ratings_total.toLocaleString()} ratings` : ''}
              </span>
            </span>
          ) : null}
        </div>
        <a
          href={mapsHref(place.name, address, loc)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${place.name || 'place'} in Maps`}
          title="Open in Maps"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-2 transition-colors dur-1 hover:bg-surface-2 hover:text-text-1"
        >
          <ExternalLink size={20} />
        </a>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 sm:pl-[4.25rem]">
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={16} />}
          loading={adding}
          disabled={disabled || typeof loc?.lat !== 'number'}
          onClick={() => onAdd(place)}
          aria-label={`Add ${place.name || 'this gym'} to Vybe`}
        >
          Add to Vybe
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Users size={16} />}
          onClick={() => navigate('/communities', { state: { startCommunity: presetFromPlace(place) } })}
          aria-label={`Start a community at ${place.name || 'this place'}`}
        >
          Start a community here
        </Button>
        {key ? <span className="sr-only">{key}</span> : null}
      </div>
    </li>
  );
}

function PlaceListSkeleton({ label }: { label: string }) {
  return (
    <ul className="space-y-2" aria-busy="true" aria-label={label}>
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="card flex items-center gap-3 p-3">
          <Skeleton className="h-11 w-11 rounded-sm" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ detail */

function GymDetailModal({
  gymId,
  onClose,
  onSearchPlaces,
}: {
  gymId: string | null;
  onClose: () => void;
  onSearchPlaces: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reviewPage, setReviewPage] = useState(1);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setRating(5);
    setComment('');
    setReviewPage(1);
  }, [gymId]);

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

  // Older app builds shared communities as type=gym, so a 404 here with an
  // ObjectId-shaped id is checked against the community route before the
  // person sees "not found"; a hit sends them to the community view.
  const communityFallback = useQuery({
    queryKey: ['gym', gymId, 'community-fallback'],
    enabled: notFound && isObjectId(gymId),
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${gymId}`);
      return (data.data || data) as { _id?: string };
    },
  });
  useEffect(() => {
    if (communityFallback.isSuccess && communityFallback.data?._id) {
      navigate(communityPath(communityFallback.data._id), { replace: true });
    }
  }, [communityFallback.isSuccess, communityFallback.data, navigate]);

  const gym = detail.data;
  const own = gym?.viewerReview || null;
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
    enabled: Boolean(gymId) && detail.isSuccess,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/${gymId}/reviews`, {
        params: { page: reviewPage, limit: 10 },
      });
      return data as { reviews: Review[]; hasNextPage?: boolean; total?: number; totalPages?: number };
    },
  });

  const saveReview = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/gyms/${gymId}/review`, { rating, comment: comment.trim() || undefined });
      return data as { message?: string };
    },
    onSuccess: (data) => {
      toast.success(data?.message || (own ? 'Review updated' : 'Review posted'));
      setReviewPage(1);
      qc.invalidateQueries({ queryKey: ['gym', gymId] });
      qc.invalidateQueries({ queryKey: ['gyms'] });
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
      qc.invalidateQueries({ queryKey: ['gym', gymId] });
      qc.invalidateQueries({ queryKey: ['gyms'] });
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not remove your review'));
      setConfirmRemove(false);
    },
  });

  const img = gym ? gymImage(gym) : '';
  const communityResolving = notFound && isObjectId(gymId) && (communityFallback.isPending || communityFallback.isSuccess);

  return (
    <Modal
      open={Boolean(gymId)}
      onClose={onClose}
      size="lg"
      title={gym?.name || 'Gym'}
      description={gym ? gym.address || gym.vicinity || undefined : undefined}
    >
      {detail.isLoading || communityResolving ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="aspect-video w-full rounded-md" />
          <SkeletonText lines={3} />
        </div>
      ) : null}
      {notFound && !communityResolving ? (
        <EmptyState
          variant="no-results"
          title="This gym is no longer listed"
          message="The link may be old, or the gym was removed from the directory. Browse what is listed, or look the place up on the map and add it back."
          action={{ label: 'Browse the directory', onClick: onClose }}
          secondaryAction={{ label: 'Search places', onClick: onSearchPlaces }}
        />
      ) : null}
      {detail.isError && !notFound ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} /> : null}
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

          <section className="space-y-3" aria-label={own ? 'Your review' : 'Write a review'}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="type-heading text-lg text-text-1">{own ? 'Your review' : 'Write a review'}</h3>
              {own ? (
                <Button variant="ghost" size="sm" icon={<Trash size={16} />} onClick={() => setConfirmRemove(true)}>
                  Remove review
                </Button>
              ) : null}
            </div>
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
            <div className="flex justify-end">
              <Button variant="primary" loading={saveReview.isPending} onClick={() => saveReview.mutate()}>
                {own ? 'Update review' : 'Post review'}
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
                  const mine = Boolean(me?._id && r.user?._id && String(r.user._id) === String(me._id));
                  return (
                    <li key={r._id || i} className={cx('flex gap-3 rounded-md p-3', mine ? 'bg-brand-soft/40 ring-1 ring-brand/30' : 'bg-surface-2')}>
                      <Avatar src={r.user?.avatar} name={name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-text-1">
                            <span className="truncate">{name}</span>
                            {mine ? <Badge tone="brand" size="sm">You</Badge> : null}
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
            <Pager
              page={reviewPage}
              totalPages={reviews.data?.totalPages}
              hasNext={Boolean(reviews.data?.hasNextPage)}
              onPrev={() => setReviewPage((p) => Math.max(1, p - 1))}
              onNext={() => setReviewPage((p) => p + 1)}
            />
          </section>
        </div>
      ) : null}
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
  const qc = useQueryClient();
  const [tab, setTab] = useState<GymsTab>('all');
  // Each tab keeps its own query: switching Directory -> Places used to send
  // the directory term to the map provider (one wasted, rate-limited call
  // and a flash of results nobody asked for).
  const [directorySearch, setDirectorySearch] = useState('');
  const [placesSearch, setPlacesSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<GymSort>('newest');
  // Share links land here as /gyms?gym=<id> (see lib/shareLinks.ts); the
  // detail modal opens for it and the parameter is dropped once it closes.
  const [params, setParams] = useSearchParams();
  const [openGym, setOpenGym] = useState<string | null>(() => params.get('gym'));
  const showGym = (id: string) => {
    setOpenGym(id);
    const next = new URLSearchParams(params);
    next.set('gym', id);
    setParams(next, { replace: true });
  };
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
  const debouncedDirectory = useDebounced(directorySearch.trim(), 400);
  const debouncedPlaces = useDebounced(placesSearch.trim(), 400);

  // Page resets travel with the change that invalidates it (same render),
  // so a radius change on page 2 never requests page 2 of the new radius.
  const goPage = (next: number) => {
    setPage(next);
    scrollToTop();
  };
  const changeDirectorySearch = (value: string) => {
    setDirectorySearch(value);
    setPage(1);
  };
  const changeRadius = (value: string) => {
    setRadius(value);
    setPage(1);
  };
  const changeSort = (value: string) => {
    setSort(value as GymSort);
    setPage(1);
  };
  const switchTab = (next: GymsTab) => {
    setTab(next);
    setPage(1);
  };

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
        setPage(1);
        setLocate({ kind: 'ready', at: Date.now() });
      },
      (err) => {
        setLocate({ kind: 'error', code: err.code, message: err.message });
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  // "Update" re-locates and drops both nearby caches so a gym added a moment
  // ago (by you or anyone) shows up.
  const refreshNearby = () => {
    qc.invalidateQueries({ queryKey: ['gyms', 'nearby'] });
    qc.invalidateQueries({ queryKey: ['gyms', 'provider-nearby'] });
    requestLocation();
  };

  // Permission already granted: fetch silently. Otherwise wait for the explicit button.
  useEffect(() => {
    if (tab === 'nearby' && permission === 'granted' && !coords && locate.kind === 'idle') requestLocation();
  }, [tab, permission, coords, locate.kind, requestLocation]);

  const all = useQuery({
    queryKey: ['gyms', 'all', page, debouncedDirectory, sort],
    enabled: tab === 'all',
    queryFn: async () => {
      const { data } = await api.get('/gyms', {
        params: { page, limit: PAGE_SIZE, q: debouncedDirectory || undefined, sort },
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

  // Real gyms from the map provider (OpenStreetMap, or Google when a key is
  // configured) so Nearby is never empty in a town nobody has seeded yet.
  const providerNearby = useQuery({
    queryKey: ['gyms', 'provider-nearby', coords?.lat, coords?.lng, radius],
    enabled: tab === 'nearby' && Boolean(coords),
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data } = await api.get('/gyms/google-places', {
        params: { lat: coords!.lat, lng: coords!.lng, radius: providerRadiusMeters(radius) },
      });
      return (data.results || []) as Place[];
    },
  });

  const placesReady = tab === 'places' && placesSearch.trim() === debouncedPlaces && debouncedPlaces.length > 0;
  const places = useQuery({
    queryKey: ['gyms', 'places', debouncedPlaces, coords?.lat, coords?.lng],
    enabled: placesReady,
    queryFn: async () => {
      // kind=gym keeps the provider from offering farms and cafés as gyms;
      // the viewer position (when Nearby has it) ranks the closest branch first.
      const { data } = await api.get('/gyms/place-search', {
        params: {
          q: debouncedPlaces,
          limit: PLACE_LIMIT,
          kind: 'gym',
          ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        },
      });
      return (data.results || data.places || []) as Place[];
    },
  });

  const listQuery = tab === 'all' ? all : nearby;
  const gyms = useMemo<Gym[]>(() => listQuery.data?.gyms || [], [listQuery.data]);
  const hasNext = Boolean(listQuery.data?.hasNextPage);
  const totalPages = listQuery.data?.total ? Math.max(1, Math.ceil(listQuery.data.total / PAGE_SIZE)) : undefined;

  const mapGyms = useMemo(() => {
    const results = providerNearby.data || [];
    const deduped = dedupeProviderPlaces(results, gyms);
    return deduped
      .map((p) => ({ ...p, distanceKm: placeDistanceKm(p, coords) ?? undefined }))
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }, [providerNearby.data, gyms, coords]);

  const addGym = useAddGym((gym) => {
    if (gym?._id) showGym(gym._id);
  });
  const addingId = addGym.isPending ? addGym.variables?.place_id || addGym.variables?.placeId || addGym.variables?.name : null;

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

  const widerRadius = RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.length - 1, RADIUS_OPTIONS.findIndex((o) => o.value === radius) + 1)].value;

  const renderPlaceRows = (list: Place[]) => (
    <ul className="space-y-2">
      {list.map((p, i) => {
        const key = p.place_id || p.placeId || `${p.name}-${i}`;
        return (
          <PlaceRow
            key={key}
            place={p}
            coords={coords}
            onAdd={(place) => addGym.mutate(place)}
            adding={addGym.isPending && addingId === (p.place_id || p.placeId || p.name)}
            disabled={addGym.isPending}
          />
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Gyms" subtitle="Find a place to train, add yours, and read what members think of it." />

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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchField
              label="Search gyms"
              hideLabel
              placeholder="Search by gym name or address"
              value={directorySearch}
              onChange={(e) => changeDirectorySearch(e.target.value)}
              containerClassName="flex-1"
            />
            <Select label="Sort gyms" hideLabel options={SORT_OPTIONS} value={sort} onChange={changeSort} containerClassName="sm:w-44" />
          </div>
          {all.isLoading ? <ListSkeleton /> : null}
          {all.isError ? <ErrorState error={all.error} onRetry={() => all.refetch()} /> : null}
          {all.isSuccess && gyms.length === 0 ? (
            debouncedDirectory ? (
              <EmptyState
                variant="no-results"
                title={`No gyms match “${debouncedDirectory}”`}
                message="Check the spelling, or look it up on the map and add it to Vybe in one tap."
                action={{
                  label: 'Search places',
                  onClick: () => {
                    setPlacesSearch(directorySearch);
                    switchTab('places');
                  },
                  variant: 'secondary',
                }}
              />
            ) : (
              <EmptyState
                title="No gyms listed yet"
                message="Gyms appear here as members add them. Add the one you train at from the map, or find gyms around you."
                action={{ label: 'Find gyms nearby', onClick: () => switchTab('nearby') }}
                secondaryAction={{ label: 'Search places', onClick: () => switchTab('places') }}
              />
            )
          ) : null}
          {gyms.length > 0 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {gyms.map((g) => (
                  <GymCard key={g._id} gym={g} onOpen={() => showGym(g._id)} />
                ))}
              </div>
              <Pager
                page={page}
                totalPages={totalPages}
                hasNext={hasNext}
                onPrev={() => goPage(Math.max(1, page - 1))}
                onNext={() => goPage(page + 1)}
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
                    onChange={changeRadius}
                    containerClassName="w-40"
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    loading={locate.kind === 'locating'}
                    onClick={refreshNearby}
                    icon={<Refresh size={18} />}
                  >
                    Update
                  </Button>
                </div>
              </div>

              <section className="space-y-3" aria-label="Gyms on Vybe near you">
                <h2 className="type-heading text-lg text-text-1">On Vybe</h2>
                {nearby.isLoading || (nearby.isPending && !nearby.data) ? <ListSkeleton count={3} /> : null}
                {nearby.isError ? <ErrorState error={nearby.error} onRetry={() => nearby.refetch()} /> : null}
                {nearby.isSuccess && gyms.length === 0 ? (
                  <Callout tone="info" title={`No Vybe gyms within ${radius} km yet`}>
                    Nobody has added a gym here. Add one from the map results below — it takes one tap — or{' '}
                    {radius !== '50' ? (
                      <button type="button" onClick={() => changeRadius(widerRadius)} className="font-semibold text-brand-text underline-offset-2 hover:underline">
                        widen the search to {widerRadius} km
                      </button>
                    ) : (
                      <button type="button" onClick={() => switchTab('places')} className="font-semibold text-brand-text underline-offset-2 hover:underline">
                        look a place up by name
                      </button>
                    )}
                    .
                  </Callout>
                ) : null}
                {gyms.length > 0 ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {gyms.map((g) => (
                        <GymCard key={g._id} gym={g} onOpen={() => showGym(g._id)} />
                      ))}
                    </div>
                    <Pager
                      page={page}
                      totalPages={totalPages}
                      hasNext={hasNext}
                      onPrev={() => goPage(Math.max(1, page - 1))}
                      onNext={() => goPage(page + 1)}
                    />
                  </>
                ) : null}
              </section>

              <section className="space-y-3" aria-label="Gyms near you on the map">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h2 className="type-heading text-lg text-text-1">Gyms near you on the map</h2>
                    <p className="text-sm text-text-2">From the map provider. Add one to Vybe to review it and start a community there.</p>
                  </div>
                </div>
                {providerNearby.isLoading ? <PlaceListSkeleton label="Searching the map" /> : null}
                {providerNearby.isError ? (
                  <ErrorState
                    error={providerNearby.error}
                    title="The map provider did not answer"
                    message={errMsg(providerNearby.error, 'Nearby map results are unavailable right now. Try again in a moment, or search by name.')}
                    onRetry={() => providerNearby.refetch()}
                  />
                ) : null}
                {providerNearby.isSuccess && mapGyms.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon={<MapPin size={24} />}
                    title={(providerNearby.data?.length || 0) > 0 ? 'Every gym on the map here is already on Vybe' : `No gyms on the map within ${radius} km`}
                    message={(providerNearby.data?.length || 0) > 0 ? 'Open one above to review it or start a community.' : 'Widen the search, or look the place up by name.'}
                    action={radius !== '50' ? { label: `Widen to ${widerRadius} km`, onClick: () => changeRadius(widerRadius), variant: 'secondary' } : undefined}
                    secondaryAction={{ label: 'Search places', onClick: () => switchTab('places') }}
                  />
                ) : null}
                {mapGyms.length > 0 ? renderPlaceRows(mapGyms) : null}
              </section>
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
            value={placesSearch}
            onChange={(e) => setPlacesSearch(e.target.value)}
            autoFocus
          />
          {!debouncedPlaces ? (
            <EmptyState
              icon={<Search size={26} />}
              title="Look a place up by name"
              message={
                coords
                  ? 'Searches the map provider for gyms and studios, closest to you first, including ones nobody on Vybe has added yet.'
                  : 'Searches the map provider for gyms and studios anywhere. Share your location on the Nearby tab to rank the closest first.'
              }
            />
          ) : null}
          {placesReady && places.isLoading ? <PlaceListSkeleton label="Searching places" /> : null}
          {places.isError ? (
            <ErrorState
              error={places.error}
              title="Place search is unavailable"
              message={errMsg(places.error, 'The map provider did not answer. Try again in a moment.')}
              onRetry={() => places.refetch()}
            />
          ) : null}
          {placesReady && places.isSuccess && (places.data?.length || 0) === 0 ? (
            <EmptyState
              variant="no-results"
              title={`No places found for “${debouncedPlaces}”`}
              message="Try the full name or add the city, e.g. “Planet Fitness Allentown”."
            />
          ) : null}
          {placesReady && (places.data?.length || 0) > 0 ? renderPlaceRows(places.data || []) : null}
        </section>
      ) : null}

      <GymDetailModal
        gymId={openGym}
        onClose={closeGym}
        onSearchPlaces={() => {
          closeGym();
          switchTab('places');
        }}
      />
    </div>
  );
}
