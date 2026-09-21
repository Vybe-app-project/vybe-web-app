import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import { PlaceImage } from '../components/PlaceImage';
import { osmHref } from '../components/MapTile';
import { memberCountLabel } from '../components/GymBand';
import { dedupeProviderPlaces, distanceLabelKm, haversineKm, presetFromPlace, providerRadiusMeters } from '../lib/gyms';
import { Pager, TEXT_ACTION, communityHref, communityLinkState, memberTotalOf, useCommunityAtPlace, useCommunityCover, type Community } from './GymCommunity';
import { GymsUnderReview, useGymsUnderReview } from './gyms/PendingGyms';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  CardGrid,
  CardMedia,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchField,
  SegmentedControl,
  Select,
  Skeleton,
  cx,
  prefersReducedMotion,
  useToast,
} from './ui';
import { ExternalLink, MapPin, Plus, Refresh, Star, Users } from './icons';

/* ------------------------------------------------------------------ types */

type Review = {
  _id?: string;
  rating?: number;
  comment?: string;
  createdAt?: string;
  date?: string;
  user?: { _id?: string; username?: string; fullName?: string; avatar?: string };
};

/** A directory gym (`GET /gyms`, `GET /gyms/:gymId`): the place people review; a community may sit at its `placeId`. */
export type Gym = {
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

/** A provider place (`GET /gyms/place-search`, `GET /gyms/google-places`): OpenStreetMap today. */
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

type GymsTab = 'places' | 'nearby' | 'all';
type GymSort = 'newest' | 'rating' | 'name';

const TABS: GymsTab[] = ['places', 'nearby', 'all'];
const isGymsTab = (v: string | null): v is GymsTab => !!v && (TABS as string[]).includes(v);

const PAGE_SIZE = 18;
const PLACE_LIMIT = 10;
const PLACE_SEARCH_ID = 'gyms-place-search';
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

export const gymImage = (g: Gym): string => mediaUrl(g.images?.[0] || g.photos?.[0]?.url || '');

export function ratingOf(g: Gym): number {
  if (typeof g.averageRating === 'number') return g.averageRating;
  if (typeof g.rating === 'number') return g.rating;
  const rs = (g.reviews || []).map((r) => r.rating).filter((n): n is number => typeof n === 'number');
  if (!rs.length) return 0;
  return rs.reduce((a, b) => a + b, 0) / rs.length;
}

export const reviewCountOf = (g: Gym): number => g.reviewCount ?? g.reviewsCount ?? g.reviews?.length ?? 0;

function distanceLabel(g: Gym): string | null {
  const km = typeof g.distanceKm === 'number' ? g.distanceKm : typeof g.distance === 'number' ? g.distance / 1000 : null;
  return distanceLabelKm(km);
}

function placeDistanceKm(p: Place, coords: Coords | null): number | null {
  if (typeof p.distanceKm === 'number') return p.distanceKm;
  const lat = p.geometry?.location?.lat;
  const lng = p.geometry?.location?.lng;
  if (!coords || typeof lat !== 'number' || typeof lng !== 'number') return null;
  return haversineKm(coords.lat, coords.lng, lat, lng);
}

/** Street-then-city as the provider composes it; empty when the tags are sparse (API.md §10a). */
const placeAddress = (p: Place) => (p.vicinity || p.formatted_address || p.formattedAddress || p.display_name || '').trim();

function placeMapHref(p: Place): string {
  const loc = p.geometry?.location;
  if (typeof loc?.lat === 'number' && typeof loc?.lng === 'number') return osmHref(loc.lat, loc.lng);
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent([p.name, placeAddress(p)].filter(Boolean).join(' '))}`;
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

export function Stars({ value, size = 14, className }: { value: number; size?: number; className?: string }) {
  const filled = Math.round(clampStars(value));
  return (
    <span role="img" aria-label={`${clampStars(value).toFixed(1)} out of 5`} className={cx('inline-flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} filled={n <= filled} className={n <= filled ? 'text-warning' : 'text-line-strong'} />
      ))}
    </span>
  );
}

/** Stars, the 1-dp value and the count — or nothing at all when nobody has rated the gym. */
export function RatingRow({ gym, size = 14 }: { gym: Gym; size?: number }) {
  const count = reviewCountOf(gym);
  const value = ratingOf(gym);
  if (!count || !value) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <Stars value={value} size={size} />
      <span className="tabular text-xs font-semibold text-text-1">{value.toFixed(1)}</span>
      <span className="text-xs text-text-3">
        {count} {count === 1 ? 'review' : 'reviews'}
      </span>
    </span>
  );
}

function OsmAttribution({ className }: { className?: string }) {
  return (
    <p className={cx('text-xs text-text-3', className)}>
      Place data ©{' '}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-text-2">
        OpenStreetMap
      </a>{' '}
      contributors.
    </p>
  );
}

function GymCardSkeleton() {
  return (
    <Card padded={false} className="p-3" aria-hidden="true">
      <Skeleton className="aspect-video w-full rounded-md" />
      <div className="mt-3 space-y-2 px-1">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </Card>
  );
}

function ListSkeleton({ count = 6, label = 'Loading gyms' }: { count?: number; label?: string }) {
  return (
    <CardGrid min="18rem" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }).map((_, i) => (
        <GymCardSkeleton key={i} />
      ))}
    </CardGrid>
  );
}

/** A directory gym card: cover (photo or the identity tile), name, address when known, rating only when real. */
function GymCard({ gym }: { gym: Gym }) {
  const img = gymImage(gym);
  const distance = distanceLabel(gym);
  const address = (gym.address || gym.vicinity || '').trim();
  const name = gym.name || 'Gym';
  return (
    <Card padded={false} container interactive className="relative p-3">
      <Link
        to={`/gyms/${encodeURIComponent(gym._id)}`}
        state={{ gym: { id: gym._id, name, city: address || undefined, photoUrl: img || undefined } }}
        viewTransition
        aria-label={`Open ${name}`}
        className="absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      <CardMedia ratio="16/9">
        <PlaceImage src={img || null} name={name} className="h-full w-full" textClassName="text-xl" />
      </CardMedia>
      <div className="mt-3 space-y-1 px-1 pb-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 truncate text-md font-semibold text-text-1">{name}</h2>
          {distance ? (
            <Badge tone="neutral" className="shrink-0">
              {distance}
            </Badge>
          ) : null}
        </div>
        {address ? <p className="truncate text-xs text-text-2">{address}</p> : null}
        <RatingRow gym={gym} />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ places */

function useAddGym(onAdded: (gym: Gym, existing: boolean) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (place: Place) => {
      const loc = place.geometry?.location;
      const { data } = await api.post('/gyms/add', {
        name: place.name || 'Gym',
        address: placeAddress(place) || place.name || '',
        location: { lat: loc?.lat, lng: loc?.lng },
        ...(place.place_id || place.placeId ? { placeId: place.place_id || place.placeId } : {}),
      });
      return data as { gym: Gym; existing?: boolean };
    },
    onSuccess: (data) => {
      if (data.existing) toast.info(`${data.gym?.name || 'This gym'} is already in the directory — opening it`);
      else toast.success(`${data.gym?.name || 'Gym'} is in the directory`);
      qc.invalidateQueries({ queryKey: ['gyms'] });
      onAdded(data.gym, Boolean(data.existing));
    },
    onError: (e) => toast.error(errMsg(e, 'Could not add this gym')),
  });
}

/**
 * The create-from-place path (API.md §10): look the place up first, offer the
 * existing community when there is one, and Create only when there is none.
 */
function PlaceCommunityAction({ place }: { place: Place }) {
  const navigate = useNavigate();
  const placeId = place.place_id || place.placeId || null;
  const existing = useCommunityAtPlace(placeId);
  const start = () => navigate('/communities', { state: { startCommunity: presetFromPlace(place) }, viewTransition: true });
  if (placeId && existing.isPending) return <Skeleton className="h-10 w-40 rounded-sm" aria-hidden="true" />;
  if (existing.data?._id) return <ExistingCommunityLink community={existing.data} />;
  return (
    <Button variant="secondary" size="sm" icon={<Users size={16} />} onClick={start} aria-label={`Start the community at ${place.name || 'this place'}`}>
      Start the community here
    </Button>
  );
}

function ExistingCommunityLink({ community }: { community: Community }) {
  const cover = useCommunityCover(community);
  const members = memberTotalOf(community);
  return (
    <ButtonLink to={communityHref(community._id)} state={communityLinkState(community, cover)} variant="secondary" size="sm" icon={<Users size={16} />}>
      Open the community{members ? ` · ${memberCountLabel(members)}` : ''}
    </ButtonLink>
  );
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
  const address = placeAddress(place);
  const loc = place.geometry?.location;
  const distance = distanceLabelKm(placeDistanceKm(place, coords));
  const name = place.name || 'Place';
  return (
    <li>
      <Card padded={false} container className="p-3">
      <div className="flex items-start gap-3">
        <PlaceImage src={place.photoUrl} name={place.name} className="h-14 w-14 rounded-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate text-md font-semibold text-text-1">{name}</h3>
            {distance ? (
              <Badge tone="neutral" className="shrink-0">
                {distance}
              </Badge>
            ) : null}
          </div>
          {address ? (
            <p className="truncate text-xs text-text-2" title={place.display_name || address}>
              {address}
            </p>
          ) : null}
          {typeof place.rating === 'number' && place.rating > 0 ? (
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
          href={placeMapHref(place)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${name} on OpenStreetMap`}
          title="Open on OpenStreetMap"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-2 transition-colors dur-1 hover:bg-surface-2 hover:text-text-1"
        >
          <ExternalLink size={20} />
        </a>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 @sm:pl-[4.25rem]">
        <PlaceCommunityAction place={place} />
        <Button
          variant="quiet"
          size="sm"
          icon={<Plus size={16} />}
          loading={adding}
          disabled={disabled || typeof loc?.lat !== 'number'}
          onClick={() => onAdd(place)}
          aria-label={`Add ${name} to the directory`}
        >
          Add to directory
        </Button>
      </div>
      </Card>
    </li>
  );
}

function PlaceListSkeleton({ label }: { label: string }) {
  return (
    <ul className="space-y-2" aria-busy="true" aria-label={label}>
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i}>
          <Card padded={false} className="flex items-center gap-3 p-3">
            <Skeleton className="h-14 w-14 rounded-sm" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ nearby: location states */

function LocationPrompt({ locating, onAllow, onFallback }: { locating: boolean; onAllow: () => void; onFallback: (tab: GymsTab) => void }) {
  return (
    <Card>
      <EmptyState
        family="community"
        title="Find gyms near you"
        message="Vybe asks your browser for your position once, uses it to list gyms within a few kilometres, and does not store it."
        action={
          <Button variant="secondary" loading={locating} onClick={onAllow} icon={<MapPin size={18} />}>
            Use my location
          </Button>
        }
        secondaryAction={{ label: 'Search by name instead', onClick: () => onFallback('places') }}
      />
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
      body: 'Nearby search needs the browser location service, which is not available here. Search for your gym by name instead.',
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
    <Card>
      <EmptyState
        size="sm"
        variant="error"
        icon={<MapPin size={26} />}
        title={copy.title}
        message={copy.body}
        action={
          kind === 'unsupported' ? undefined : (
            <Button variant="secondary" loading={retrying} onClick={onRetry} icon={<Refresh size={18} />}>
              Try again
            </Button>
          )
        }
        secondaryAction={{ label: 'Search by name', onClick: () => onFallback('places') }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

export default function Gyms() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Tabs are URLs (`?tab=`) so the band action and other pages can land on
  // Places; Places is the default because searching a real place and starting
  // its community is how a gym comes to exist on Vybe.
  const [params, setParams] = useSearchParams();
  const tab: GymsTab = isGymsTab(params.get('tab')) ? (params.get('tab') as GymsTab) : 'places';
  // Each tab keeps its own query: switching Directory -> Places used to send
  // the directory term to the map provider (one wasted, rate-limited call
  // and a flash of results nobody asked for).
  const [directorySearch, setDirectorySearch] = useState('');
  const [placesSearch, setPlacesSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<GymSort>('newest');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [radius, setRadius] = useState('10');
  const [locate, setLocate] = useState<LocateState>({ kind: 'idle' });
  const [focusSearch, setFocusSearch] = useState(0);
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
  // One field at the top, bound to the list under it: the directory's own
  // term on Directory, the map's everywhere else. Typing on Nearby is a
  // search, and the results live on Places.
  const changeSearch = (value: string) => {
    if (tab === 'all') {
      changeDirectorySearch(value);
      return;
    }
    setPlacesSearch(value);
    if (tab !== 'places' && value.trim()) switchTab('places');
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
    setPage(1);
    setParams(
      (prev) => {
        if (next === 'places') prev.delete('tab');
        else prev.set('tab', next);
        return prev;
      },
      { replace: true },
    );
  };
  const addAGym = () => {
    switchTab('places');
    setFocusSearch((n) => n + 1);
  };
  useEffect(() => {
    if (!focusSearch) return;
    const el = document.getElementById(PLACE_SEARCH_ID) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }, [focusSearch, tab]);

  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setLocate({ kind: 'error', code: 0, message: 'Location is not available in this browser.' });
      return;
    }
    setLocate({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: Number(pos.coords.latitude.toFixed(4)), lng: Number(pos.coords.longitude.toFixed(4)) });
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

  // Read only on the directory, where the cards go.
  const underReview = useGymsUnderReview(tab === 'all');

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

  // Real gyms from the map provider (OpenStreetMap today) so Nearby is never
  // empty in a town nobody has seeded yet.
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
    if (gym?._id) navigate(`/gyms/${encodeURIComponent(gym._id)}`, { viewTransition: true });
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

  const nearbySubtitle = locate.kind === 'ready' ? `Updated ${ago(new Date(locate.at).toISOString()) || 'just now'}` : null;

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

  // Share links from the app land as /gyms?gym=<id>; the gym page is a route now.
  const sharedGym = params.get('gym');
  if (sharedGym) return <Navigate to={`/gyms/${encodeURIComponent(sharedGym)}`} replace />;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Gyms"
        subtitle="Find where you train. Search for the place, and its community is one tap away."
        actions={
          <button type="button" className={TEXT_ACTION} onClick={addAGym}>
            Add a gym
          </button>
        }
      />

      {/* The search is the first thing on the page: searching a real place and starting its community is
          how a gym comes to exist on Vybe. "Search for your gym" is said here, once. */}
      <SearchField
        id={PLACE_SEARCH_ID}
        label={tab === 'all' ? 'Search the directory' : 'Search for your gym'}
        hideLabel
        placeholder={tab === 'all' ? 'Search the directory by name or address' : 'Search for your gym'}
        value={tab === 'all' ? directorySearch : placesSearch}
        onChange={(e) => changeSearch(e.target.value)}
        enterKeyHint="search"
      />

      <SegmentedControl
        aria-label="Gym lists"
        tabs={[
          { value: 'places', label: 'Places' },
          { value: 'nearby', label: 'Nearby' },
          { value: 'all', label: 'Directory' },
        ]}
        value={tab}
        onChange={(k) => switchTab(k as GymsTab)}
      />

      {/* ---------------------------------------------------------------- places */}
      {tab === 'places' ? (
        <section className="space-y-4" aria-label="Place search">
          {/* The one line that says the first act. The search is already at the
              top of the page, so the state before a search is a sentence, not
              a hero: a person who has never used this needs to be told to type
              a name, and nothing more. */}
          {!debouncedPlaces ? (
            <p className="t-body text-text-2">
              Type the name of the place you train at — “Iron Works Bethlehem” —{' '}
              {coords ? 'and pick it from the map, closest to you first.' : 'and pick it from the map.'} If nobody has started its community, you can.
            </p>
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
              title={`No places match “${debouncedPlaces}”`}
              message="Try the full name or add the city, e.g. “Planet Fitness Allentown”."
            />
          ) : null}
          {placesReady && (places.data?.length || 0) > 0 ? (
            <>
              {renderPlaceRows(places.data || [])}
              <OsmAttribution />
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
                  <MapPin size={18} className="shrink-0 text-text-3" />
                  <span className="truncate">Using your current position{nearbySubtitle ? ` · ${nearbySubtitle}` : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Select label="Search radius" hideLabel options={RADIUS_OPTIONS} value={radius} onChange={changeRadius} containerClassName="w-40" />
                  <Button variant="secondary" size="md" loading={locate.kind === 'locating'} onClick={refreshNearby} icon={<Refresh size={18} />}>
                    Update
                  </Button>
                </div>
              </div>

              <section className="space-y-3" aria-label="Gyms on Vybe near you">
                <h2 className="t-section text-text-1">On Vybe</h2>
                {nearby.isLoading || (nearby.isPending && !nearby.data) ? <ListSkeleton count={3} /> : null}
                {nearby.isError ? <ErrorState error={nearby.error} onRetry={() => nearby.refetch()} /> : null}
                {nearby.isSuccess && gyms.length === 0 ? (
                  <Callout tone="info" title={`No Vybe gyms within ${radius} km yet`}>
                    Pick yours from the map results below and start its community, or{' '}
                    {radius !== '50' ? (
                      <button type="button" onClick={() => changeRadius(widerRadius)} className="font-semibold text-brand-text underline-offset-2 hover:underline">
                        widen the search to {widerRadius} km
                      </button>
                    ) : (
                      <button type="button" onClick={() => switchTab('places')} className="font-semibold text-brand-text underline-offset-2 hover:underline">
                        search for it by name
                      </button>
                    )}
                    .
                  </Callout>
                ) : null}
                {gyms.length > 0 ? (
                  <>
                    <CardGrid min="18rem">
                      {gyms.map((g) => (
                        <GymCard key={g._id} gym={g} />
                      ))}
                    </CardGrid>
                    <Pager page={page} totalPages={totalPages} hasNext={hasNext} onPrev={() => goPage(Math.max(1, page - 1))} onNext={() => goPage(page + 1)} />
                  </>
                ) : null}
              </section>

              <section className="space-y-3" aria-label="Gyms near you on the map">
                <div>
                  <h2 className="t-section text-text-1">On the map</h2>
                  <p className="text-sm text-text-2">Gyms and studios around you. Start the community at yours, or add it to the directory to review it.</p>
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
                    message={(providerNearby.data?.length || 0) > 0 ? 'Open one above to start or join its community.' : 'Widen the search, or search for the place by name.'}
                    action={radius !== '50' ? { label: `Widen to ${widerRadius} km`, onClick: () => changeRadius(widerRadius), variant: 'secondary' } : undefined}
                    secondaryAction={{ label: 'Search by name', onClick: () => switchTab('places') }}
                  />
                ) : null}
                {mapGyms.length > 0 ? (
                  <>
                    {renderPlaceRows(mapGyms)}
                    <OsmAttribution />
                  </>
                ) : null}
              </section>
            </>
          )}
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- directory */}
      {tab === 'all' ? (
        <section className="space-y-4" aria-label="Gym directory">
          {/* A gym a member added is theirs alone until an operator adds it to
              the directory, and nothing tells them when that happens — so its
              state is said here, on its own card. */}
          <GymsUnderReview list={underReview.data || []} loading={underReview.isLoading && !underReview.data} />
          <div className="flex justify-end">
            <Select label="Sort gyms" hideLabel options={SORT_OPTIONS} value={sort} onChange={changeSort} containerClassName="w-44" />
          </div>
          {all.isLoading ? <ListSkeleton /> : null}
          {all.isError ? <ErrorState error={all.error} onRetry={() => all.refetch()} /> : null}
          {all.isSuccess && gyms.length === 0 ? (
            debouncedDirectory ? (
              <EmptyState
                variant="no-results"
                title={`No gyms in the directory match “${debouncedDirectory}”`}
                message="Search the map for it instead: the place is there even before anyone on Vybe has added it."
                action={{
                  label: `Search places for “${debouncedDirectory}”`,
                  onClick: () => {
                    setPlacesSearch(directorySearch);
                    switchTab('places');
                  },
                  variant: 'secondary',
                }}
              />
            ) : (
              <EmptyState
                family="community"
                title="Add the first gym to the directory"
                message="The directory fills as members add the places they train at. Search for yours on the map and it is listed in one tap."
                action={{ label: 'Search for your gym', onClick: addAGym, variant: 'secondary', icon: <MapPin size={18} /> }}
                secondaryAction={{ label: 'Find gyms nearby', onClick: () => switchTab('nearby') }}
              />
            )
          ) : null}
          {gyms.length > 0 ? (
            <>
              <CardGrid min="18rem">
                {gyms.map((g) => (
                  <GymCard key={g._id} gym={g} />
                ))}
              </CardGrid>
              <Pager page={page} totalPages={totalPages} hasNext={hasNext} onPrev={() => goPage(Math.max(1, page - 1))} onNext={() => goPage(page + 1)} />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
