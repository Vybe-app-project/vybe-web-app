import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Link, Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { RouteErrorBoundary } from './ErrorBoundary';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLiveEnabled } from '../lib/capabilities';
import { useFeature } from '../lib/capabilities';
import type { PublicUser } from '../lib/hooks';
import { getSocket } from '../lib/socket';
import { UNREAD_COUNT_KEY, useLiveNotifications } from '../lib/notificationsLive';
import type { UnreadCount } from '../lib/notificationInbox';
import { pathOf, preload, preloadWhenIdle, selectNavigating, usePendingNavigation } from '../lib/navigation';
import { useHomeGym, useSetHomeGym } from '../lib/homeGym';
import type { HomeGymState } from '../lib/homeGym';
import { PlaceImage } from './PlaceImage';
import { SHEET_MEDIA, backgroundLocationOf } from './RouteSheet';
import {
  Avatar,
  Brand,
  BrandMark,
  Button,
  ButtonLink,
  Chip,
  CountBadge,
  GymBand,
  IconButton,
  Menu,
  Modal,
  NO_GYM_COPY,
  PageSkeleton,
  SearchField,
  Skeleton,
  Tabs,
  cx,
  fadeClass,
  formatStat,
  useMediaQuery,
  useOnline,
  usePageChromeStore,
  useToast,
  useScrollEdges,
} from './ui';
import type { GymBandGym, MenuItem, PageBand } from './ui';
import {
  ArrowLeft,
  Award,
  Bell,
  Building,
  Camera,
  Compass,
  Droplet,
  Dumbbell,
  Globe,
  Heart,
  Home,
  Image as ImageIcon,
  Inbox,
  LifeBuoy,
  LogOut,
  MapPin,
  Palette,
  Plus,
  Radio,
  Scale,
  Search as SearchIcon,
  Settings,
  Sparkles,
  Target,
  User,
  Users,
  Utensils,
  WifiOff,
  Zap,
} from './icons';
import type { IconComponent } from './icons';

/* ================================================================== information architecture */

export type TabKey = 'home' | 'meals' | 'gyms' | 'workouts' | 'you';
/** The six desktop hubs (Home is `nav: '/'` with no hub) plus Inbox. Every sub-page lives only in its hub's section tabs. */
export type HubKey = 'explore' | 'train' | 'fuel' | 'body' | 'community' | 'inbox';

export type RouteMeta = {
  pattern: string;
  title: string;
  /** Which mobile tab lights up. Mirrors the mobile app: Home · Meals · Gyms · Workouts · Profile. */
  tab: TabKey;
  /** Which sidebar item lights up. */
  nav: string;
  /** Fallback destination for the back chevron when there is no history. */
  parent?: string;
  /** Section-tab group rendered under the top bar. */
  hub?: HubKey;
  /** Tab roots: large title, no back chevron. */
  root?: boolean;
  /** Feed-width content with the desktop right rail. */
  rail?: boolean;
  hideTabs?: boolean;
};

/**
 * Every routed consumer feature, in match order (static before params).
 * Section pages carry hub tabs so sub-features are one tap away; nothing is
 * reachable only by typing a URL.
 */
export const ROUTES: RouteMeta[] = [
  { pattern: '/', title: 'Home', tab: 'home', nav: '/', root: true, rail: true },
  { pattern: '/discover', title: 'Explore', tab: 'home', nav: '/discover', hub: 'explore', rail: true },
  { pattern: '/search', title: 'Search', tab: 'home', nav: '/discover', hub: 'explore' },
  { pattern: '/stories', title: 'Stories', tab: 'home', nav: '/stories', hub: 'explore' },
  { pattern: '/live', title: 'Live', tab: 'home', nav: '/live', hub: 'explore' },
  { pattern: '/live/:streamId', title: 'Live', tab: 'home', nav: '/live', parent: '/live' },
  { pattern: '/p/:postId', title: 'Post', tab: 'home', nav: '/', parent: '/', rail: true },
  { pattern: '/u/:id', title: 'Profile', tab: 'home', nav: '/', parent: '/' },
  { pattern: '/u/:id/:kind', title: 'Connections', tab: 'home', nav: '/', parent: '/' },
  { pattern: '/notifications', title: 'Notifications', tab: 'home', nav: '/notifications', hub: 'inbox' },
  { pattern: '/messages', title: 'Messages', tab: 'home', nav: '/messages', hub: 'inbox' },
  { pattern: '/messages/:roomId', title: 'Messages', tab: 'home', nav: '/messages', parent: '/messages', hideTabs: true },
  { pattern: '/profile', title: 'Profile', tab: 'you', nav: '/profile', root: true },
  { pattern: '/profile/:kind', title: 'Connections', tab: 'you', nav: '/profile', parent: '/profile' },
  { pattern: '/friends', title: 'Friends', tab: 'you', nav: '/friends', hub: 'community' },
  { pattern: '/settings', title: 'Settings', tab: 'you', nav: '/settings', parent: '/profile' },
  { pattern: '/support', title: 'Support', tab: 'you', nav: '/support', parent: '/settings' },
  { pattern: '/gyms', title: 'Gyms', tab: 'gyms', nav: '/gyms', root: true, hub: 'community' },
  // The gym page carries its own tabs on the band (Feed · Today · Members · About): no hub row under it.
  { pattern: '/gyms/:gymId', title: 'Gym', tab: 'gyms', nav: '/gyms', parent: '/gyms' },
  { pattern: '/communities', title: 'Communities', tab: 'gyms', nav: '/communities', hub: 'community' },
  { pattern: '/communities/:communityId', title: 'Community', tab: 'gyms', nav: '/communities', parent: '/communities' },
  { pattern: '/workouts', title: 'Workouts', tab: 'workouts', nav: '/workouts', root: true, hub: 'train' },
  { pattern: '/workouts/history', title: 'History', tab: 'workouts', nav: '/workouts/history', hub: 'train' },
  { pattern: '/workouts/progress', title: 'Progress', tab: 'workouts', nav: '/workouts/progress', hub: 'train' },
  { pattern: '/challenges', title: 'Challenges', tab: 'workouts', nav: '/challenges', hub: 'train' },
  { pattern: '/achievements', title: 'Achievements', tab: 'workouts', nav: '/achievements', hub: 'train' },
  // Detail and editor routes (RouteSheet): a sheet over the parent on lg+, a page with a back chevron on phones.
  { pattern: '/workouts/new', title: 'New workout', tab: 'workouts', nav: '/workouts', parent: '/workouts' },
  { pattern: '/workouts/history/:logId', title: 'Session', tab: 'workouts', nav: '/workouts/history', parent: '/workouts/history', hideTabs: true },
  { pattern: '/workouts/plans/new', title: 'New plan', tab: 'workouts', nav: '/workouts', parent: '/workouts' },
  { pattern: '/workouts/plans/:planId/edit', title: 'Edit plan', tab: 'workouts', nav: '/workouts', parent: '/workouts' },
  { pattern: '/workouts/plans/:planId', title: 'Plan', tab: 'workouts', nav: '/workouts', parent: '/workouts' },
  { pattern: '/workouts/:workoutId/edit', title: 'Edit workout', tab: 'workouts', nav: '/workouts', parent: '/workouts' },
  { pattern: '/workouts/:workoutId', title: 'Workout', tab: 'workouts', nav: '/workouts', parent: '/workouts' },
  { pattern: '/recaps', title: 'Recaps', tab: 'workouts', nav: '/recaps', hub: 'train' },
  { pattern: '/recaps/:id', title: 'Recap', tab: 'workouts', nav: '/recaps', parent: '/recaps' },
  { pattern: '/meals', title: 'Meals', tab: 'meals', nav: '/meals', root: true, hub: 'fuel' },
  { pattern: '/meals/log', title: 'Log meal', tab: 'meals', nav: '/meals', parent: '/meals' },
  { pattern: '/meals/templates', title: 'Meal templates', tab: 'meals', nav: '/meals/templates', hub: 'fuel' },
  { pattern: '/meals/plans', title: 'Weekly plans', tab: 'meals', nav: '/meals/plans', hub: 'fuel' },
  { pattern: '/health/water', title: 'Hydration', tab: 'meals', nav: '/health/water', hub: 'fuel' },
  { pattern: '/meals/:id', title: 'Meal', tab: 'meals', nav: '/meals', parent: '/meals' },
  { pattern: '/health', title: 'Health', tab: 'you', nav: '/health', hub: 'body' },
  { pattern: '/health/goals', title: 'Goals', tab: 'you', nav: '/health/goals', hub: 'body' },
  { pattern: '/health/photos', title: 'Progress photos', tab: 'you', nav: '/health/photos', hub: 'body' },
];

export const HUBS: Record<HubKey, Array<{ to: string; label: string; badge?: 'chats' | 'notifications' }>> = {
  explore: [
    { to: '/discover', label: 'People' },
    { to: '/search', label: 'Search' },
    { to: '/stories', label: 'Stories' },
    { to: '/live', label: 'Live' },
  ],
  train: [
    { to: '/workouts', label: 'Library' },
    { to: '/workouts/history', label: 'History' },
    { to: '/workouts/progress', label: 'Progress' },
    { to: '/challenges', label: 'Challenges' },
    { to: '/achievements', label: 'Achievements' },
    { to: '/recaps', label: 'Recaps' },
  ],
  fuel: [
    { to: '/meals', label: 'Today' },
    { to: '/meals/templates', label: 'Templates' },
    { to: '/meals/plans', label: 'Weekly plans' },
    { to: '/health/water', label: 'Hydration' },
  ],
  body: [
    { to: '/health', label: 'Overview' },
    { to: '/health/goals', label: 'Goals' },
    { to: '/health/photos', label: 'Progress photos' },
  ],
  community: [
    { to: '/gyms', label: 'Gyms' },
    { to: '/communities', label: 'Communities' },
    { to: '/friends', label: 'Friends' },
  ],
  inbox: [
    { to: '/messages', label: 'Messages', badge: 'chats' },
    { to: '/notifications', label: 'Notifications', badge: 'notifications' },
  ],
};

const FALLBACK_META: RouteMeta = { pattern: '*', title: 'Vybe', tab: 'home', nav: '/' };

export function routeMeta(pathname: string): RouteMeta {
  for (const r of ROUTES) if (matchPath({ path: r.pattern, end: true }, pathname)) return r;
  return FALLBACK_META;
}

/** Bottom nav — agrees with the mobile app's tabs. */
const TABS: Array<{ key: TabKey; to: string; label: string; Icon: IconComponent }> = [
  { key: 'home', to: '/', label: 'Home', Icon: Home },
  { key: 'meals', to: '/meals', label: 'Meals', Icon: Utensils },
  { key: 'gyms', to: '/gyms', label: 'Gyms', Icon: Building },
  { key: 'workouts', to: '/workouts', label: 'Workouts', Icon: Dumbbell },
  { key: 'you', to: '/profile', label: 'Profile', Icon: User },
];

type SidebarItem = { to: string; label: string; Icon: IconComponent; hub?: HubKey; badge?: 'inbox' };
/**
 * The desktop sidebar: six hubs, flat, plus Inbox. Sub-pages are never listed
 * here — each hub's SectionTabs carry them — so the list fits every laptop
 * without scrolling and the active hub is always visible.
 */
const SIDEBAR: SidebarItem[] = [
  { to: '/', label: 'Home', Icon: Home },
  { to: '/discover', label: 'Explore', Icon: Compass, hub: 'explore' },
  { to: '/workouts', label: 'Train', Icon: Dumbbell, hub: 'train' },
  { to: '/meals', label: 'Fuel', Icon: Utensils, hub: 'fuel' },
  { to: '/health', label: 'Body', Icon: Heart, hub: 'body' },
  { to: '/gyms', label: 'Community', Icon: Users, hub: 'community' },
  { to: '/messages', label: 'Inbox', Icon: Inbox, hub: 'inbox', badge: 'inbox' },
];

/** Which sidebar hub a route lights up: its hub, or Home for hub-less routes under `/`. */
const sidebarActive = (meta: RouteMeta, item: SidebarItem): boolean => (item.hub ? meta.hub === item.hub : !meta.hub && meta.nav === item.to);

/** Destinations that only make sense when the server runs the feature. */
const LIVE_PATH = '/live';
/** The progression hub exists only while `features.progression` is on for the member (Wave F). */
const PROGRESS_PATH = '/workouts/progress';

/**
 * The Log action sheet. Targets carry a query flag the destination page reads
 * to open its composer/logger immediately: `?compose=1` on Home, `?log=1` on
 * Workouts, Meals, Health and Hydration.
 */
export const LOG_ACTIONS: Array<{ to: string; label: string; description: string; Icon: IconComponent }> = [
  { to: '/?compose=1', label: 'Post', description: 'Share a session, a win or a meal with your people', Icon: ImageIcon },
  { to: '/workouts?log=1', label: 'Workout', description: 'Log a session or start one from your library', Icon: Dumbbell },
  { to: '/meals?log=1', label: 'Meal', description: 'Add food and check your macros', Icon: Utensils },
  { to: '/health?log=1', label: 'Weight or steps', description: 'Today’s body stats', Icon: Scale },
  { to: '/health/water?log=1', label: 'Water', description: 'Track hydration through the day', Icon: Droplet },
];

/** Pages can open the Log sheet too (e.g. from an empty state). */
export const useLogSheet = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/* ================================================================== live data */

/** Same key and shape as Messages, so the badge and the page share one cache. */
export function useUnreadChats(enabled = true) {
  return useQuery({
    queryKey: ['unreadChats'],
    queryFn: async () => {
      const { data } = await api.get('/messages/me/all/chats/rooms/unread/count');
      return Number(data.totalUnreadChats || 0);
    },
    refetchInterval: 60_000,
    enabled,
  });
}

/**
 * Exact unread total from GET /notifications/unread-count. The key sits under
 * `['notifications']`, so invalidating that (what the page does when it marks
 * read) refreshes this too. The socket subscription in Layout bumps it live;
 * the 60 s poll is the fallback for a socket that never connected.
 */
export function useUnreadNotifications(enabled = true) {
  return useQuery<UnreadCount>({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: async () => {
      const { data } = await api.get('/notifications/unread-count');
      return { count: Number(data.count || 0), more: false };
    },
    refetchInterval: 60_000,
    enabled,
  });
}

const badgeText = (n?: number, more?: boolean): string | number | null => (!n ? null : more ? `${n}+` : n);

type RealtimeMessage = {
  _id?: string;
  text?: string;
  sender?: { _id?: string; fullName?: string; username?: string } | string;
  chatRoom?: string | { _id?: string; isGroup?: boolean; roomName?: string };
  targetId?: string;
  isGroup?: boolean;
  media?: unknown[];
};

const senderIdOf = (m: RealtimeMessage): string => (typeof m.sender === 'string' ? m.sender : m.sender?._id ? String(m.sender._id) : '');
const roomIdOf = (m: RealtimeMessage): string => (typeof m.chatRoom === 'string' ? m.chatRoom : m.chatRoom?._id ? String(m.chatRoom._id) : m.targetId || '');

/**
 * App-wide realtime bookkeeping. The chat socket is connected on every page,
 * but until now only the Messages page listened to it, so the Inbox badge in
 * the nav waited for its 60 s poll when a message arrived while you were on
 * the feed. This keeps the unread count and room list fresh everywhere and
 * offers an "Open" toast for messages that land while you are elsewhere.
 * The Messages page keeps its own listeners for the thread itself.
 */
function useRealtimeSync(enabled: boolean, meId?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const meRef = useRef(meId);
  meRef.current = meId;

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    if (!socket) return;
    const refreshCounts = () => {
      qc.invalidateQueries({ queryKey: ['unreadChats'] });
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
    };
    const onMessage = (m: RealtimeMessage) => {
      refreshCounts();
      const from = senderIdOf(m);
      if (!from || from === meRef.current) return;
      const roomId = roomIdOf(m);
      // On the messaging pages the list row and thread update by themselves.
      if (pathRef.current.startsWith('/messages')) return;
      const sender = typeof m.sender === 'object' && m.sender ? m.sender : undefined;
      const name = sender?.fullName?.trim() || sender?.username || 'Someone';
      const room = typeof m.chatRoom === 'object' && m.chatRoom ? m.chatRoom : undefined;
      const where = (m.isGroup || room?.isGroup) && room?.roomName ? ` in ${room.roomName}` : '';
      const preview = m.text ? `: ${m.text.length > 60 ? `${m.text.slice(0, 57)}…` : m.text}` : Array.isArray(m.media) && m.media.length ? ': sent a photo' : '';
      toast.info(`${name}${where}${preview}`, {
        duration: 6000,
        action: roomId ? { label: 'Open', onClick: () => navigate(`/messages/${roomId}`, { viewTransition: true }) } : undefined,
      });
    };
    const onRooms = () => qc.invalidateQueries({ queryKey: ['chatRooms'] });
    let everConnected = socket.connected;
    const onConnect = () => {
      if (everConnected) refreshCounts();
      everConnected = true;
    };
    socket.on('connect', onConnect);
    socket.on('message', onMessage);
    socket.on('newMessage', onMessage);
    socket.on('newGroupChat', refreshCounts);
    socket.on('chatRoomUpdate', onRooms);
    socket.on('messageDeleted', refreshCounts);
    socket.on('messageRead', onRooms);
    return () => {
      socket.off('connect', onConnect);
      socket.off('message', onMessage);
      socket.off('newMessage', onMessage);
      socket.off('newGroupChat', refreshCounts);
      socket.off('chatRoomUpdate', onRooms);
      socket.off('messageDeleted', refreshCounts);
      socket.off('messageRead', onRooms);
    };
  }, [enabled, qc, toast, navigate]);
}

/* ================================================================== navigation feedback */

/** A plain left click that React Router will handle in this tab (not a modifier/new-tab click). */
const willNavigateHere = (e: ReactMouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;

/**
 * Props for any shell link: warm the destination's chunk as soon as the user
 * shows intent, and record the pending destination on activation so the tab
 * highlight and progress bar respond before the location commits.
 */
function useNavLinkProps(to: string) {
  const { pathname } = useLocation();
  const start = usePendingNavigation((s) => s.start);
  const warm = () => {
    void preload(to);
  };
  // pointerdown covers touch as well; a touchstart handler on top of it only
  // doubled the calls for the taps that begin a scroll.
  return {
    onPointerDown: warm,
    onMouseEnter: warm,
    onFocus: warm,
    onClick: (e: ReactMouseEvent) => {
      const path = pathOf(to);
      if (willNavigateHere(e) && path !== pathname) start(path);
    },
  };
}

/**
 * Thin indeterminate bar under the top edge while a route's code downloads.
 * Driven by the store's grace-timed flag, so a chunk that is in memory
 * (lazyPage) or lands within NAV_GRACE_MS never flashes it.
 */
function NavProgress() {
  const show = usePendingNavigation(selectNavigating);
  if (!show) return null;
  return (
    <div role="progressbar" aria-label="Loading page" aria-busy="true" className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-brand-soft">
      <div className="anim-nav-progress h-full w-1/3 rounded-full bg-brand" />
    </div>
  );
}

/**
 * The page region's Suspense fallback. Navigations never reach it (the
 * previous page is held, then swapped for the skeleton below); it mounts on a
 * hard load whose chunk is still downloading and keeps the progress bar up
 * for the whole wait.
 */
function RouteFallback() {
  const setChunkLoading = usePendingNavigation((s) => s.setChunkLoading);
  useEffect(() => {
    setChunkLoading(true);
    return () => setChunkLoading(false);
  }, [setChunkLoading]);
  return <PageSkeleton />;
}

/* ================================================================== pieces */

function SkipLink() {
  return (
    <a
      href="#main"
      className="btn btn-primary sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300]"
    >
      Skip to content
    </a>
  );
}

function OfflineBanner() {
  const online = useOnline();
  const sessionStale = useAuth((s) => s.sessionStale);
  if (online && !sessionStale) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-xs font-semibold text-warning-text">
      <WifiOff size={16} />
      {online ? 'Can’t reach Vybe right now — showing what’s already loaded. Reconnecting…' : 'You’re offline — showing what’s already loaded.'}
    </div>
  );
}

function SearchBox({ className }: { className?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const start = usePendingNavigation((s) => s.start);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (location.pathname !== '/search') setQ('');
  }, [location.pathname]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = q.trim();
    if (!value) return;
    if (location.pathname !== '/search') start('/search');
    navigate(`/search?q=${encodeURIComponent(value)}`, { viewTransition: true });
  };

  return (
    <form onSubmit={submit} role="search" className={className}>
      <SearchField
        label="Search"
        hideLabel
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people, posts, workouts, meals…"
        className="h-10 min-h-10"
        onFocus={() => preload('/search')}
      />
    </form>
  );
}

/**
 * The create action. Compact (phone top bar) is a plus in the mint circle —
 * the brand mark it used to show sat where apps put the avatar and read as a
 * logo, not "add". The desktop button keeps its label.
 */
function LogButton({ className, compact = false, band = false, mint = false }: { className?: string; compact?: boolean; band?: boolean; mint?: boolean }) {
  const setOpen = useLogSheet((s) => s.setOpen);
  if (band) {
    // On the band: a tonal chip unless the screen has no other primary control
    // (`mint`), so a hub keeps exactly one brand-coloured action. Icon-only on
    // phones (the chrome row also carries search, inbox and the bell at 320 px).
    return (
      <button
        type="button"
        aria-label="Log something"
        onClick={() => setOpen(true)}
        className={cx(
          'inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-0 text-sm font-semibold transition-colors dur-1 sm:px-3.5',
          mint ? 'bg-brand text-on-brand hover:bg-brand-hover' : 'gym-band-chip hover:bg-band-chip-line',
          className,
        )}
      >
        <Plus size={20} />
        <span className="hidden sm:inline">Log</span>
      </button>
    );
  }
  if (compact) {
    return (
      <button
        type="button"
        aria-label="Log something"
        onClick={() => setOpen(true)}
        className={cx('inline-flex h-11 w-11 items-center justify-center', className)}
      >
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand text-on-brand shadow-1 transition-transform dur-1 active:scale-95">
          <Plus size={22} />
        </span>
      </button>
    );
  }
  return (
    <Button variant="primary" block onClick={() => setOpen(true)} icon={<Plus size={20} />} className={className}>
      <span className="hidden xl:inline">Log</span>
    </Button>
  );
}

function LogSheet() {
  const open = useLogSheet((s) => s.open);
  const setOpen = useLogSheet((s) => s.setOpen);
  const { pathname } = useLocation();
  const start = usePendingNavigation((s) => s.start);
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Log activity" description="What did you just do?" size="sm">
      <ul className="-mx-1 grid gap-1">
        {LOG_ACTIONS.map(({ to, label, description, Icon }) => (
          <li key={to}>
            <Link
              to={to}
              viewTransition
              onPointerDown={() => preload(to)}
              onClick={(e) => {
                setOpen(false);
                if (willNavigateHere(e) && pathOf(to) !== pathname) start(pathOf(to));
              }}
              className="flex min-h-16 items-center gap-4 rounded-md px-3 py-2.5 transition-colors dur-1 hover:bg-surface-2 focus-visible:bg-surface-2"
            >
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text">
                <Icon size={24} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-md font-semibold text-text-1">{label}</span>
                <span className="block text-xs text-text-2">{description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** What "Log out" does: every device, not just this one. */
const LOGOUT_SCOPE = 'Signs you out on every device';

function AccountMenu({ align = 'end' }: { align?: 'start' | 'end' }) {
  const { user, logout } = useAuth();
  const items: MenuItem[] = [
    { label: 'Profile', icon: <User size={18} />, to: '/profile' },
    { label: 'Settings', icon: <Settings size={18} />, to: '/settings' },
    { label: 'Appearance', description: 'System, light or dark', icon: <Palette size={18} />, to: '/settings#appearance' },
    { label: 'Support', icon: <LifeBuoy size={18} />, to: '/support' },
    // Sign-out revokes every session (the API bumps tokenVersion), so a phone
    // signed in to the same account goes too. Say so where the choice is made;
    // Settings > Password already explains the same behaviour.
    { label: 'Log out', description: LOGOUT_SCOPE, icon: <LogOut size={18} />, onSelect: logout, danger: true, divider: true },
  ];
  return (
    <Menu
      label="Account menu"
      align={align}
      items={items}
      trigger={() => (
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full">
          <Avatar src={user?.avatar} name={user?.fullName || user?.username} size="sm" />
        </span>
      )}
    />
  );
}

function SideLink({ item, active, badge }: { item: SidebarItem; active: boolean; badge: string | number | null }) {
  const { to, label, Icon } = item;
  const navProps = useNavLinkProps(to);
  return (
    <Link
      to={to}
      viewTransition
      aria-current={active ? 'page' : undefined}
      title={label}
      data-active={active ? 'true' : undefined}
      {...navProps}
      className={cx(
        // The current hub is marked the way a tab bar marks it: bold label and a
        // filled icon, no tinted background. scroll-margin keeps it clear of the fades.
        'relative flex h-10 items-center justify-center gap-3 rounded-sm px-3 text-sm transition-colors dur-1 scroll-my-12 pointer-coarse:min-h-11 xl:justify-start',
        active ? 'font-bold text-text-1' : 'font-medium text-text-2 hover:bg-surface-2 hover:text-text-1',
      )}
    >
      <span className="relative shrink-0">
        <Icon size={24} filled={active} />
        {badge ? <CountBadge value={badge} className="absolute -right-2.5 -top-1.5 xl:hidden" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate max-xl:hidden">{label}</span>
      {badge ? <CountBadge value={badge} className="max-xl:hidden" /> : null}
    </Link>
  );
}

/**
 * The gym identity card at the top of the sidebar: cover thumbnail, name and
 * "Your gym · Switch". With no home gym it keeps the same shape and says
 * "Find your gym"; the first of the member's communities shows as a
 * provisional gym with a one-tap "Make this my home gym". Collapses to the
 * thumbnail on the icon rail (lg–xl).
 */
function SidebarGym({ home }: { home: HomeGymState }) {
  const setHome = useSetHomeGym();
  const toast = useToast();
  const gym = home.gym;
  const communityId = home.community?._id ? String(home.community._id) : null;
  const gymHref = communityId ? `/gyms/${communityId}` : NO_GYM_COPY.href;
  const makeHome = () => {
    if (!communityId) return;
    setHome.mutate({ community: communityId }, { onError: () => toast.error('Couldn’t set your home gym. Try again.') });
  };
  if (home.loading) {
    return (
      <div className="mx-3 mb-1 flex items-center gap-3 rounded-md p-2 xl:mx-4" aria-busy="true" aria-label="Loading your gym">
        <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1 space-y-2 max-xl:hidden">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      </div>
    );
  }
  return (
    <div className="mx-3 mb-1 rounded-md bg-surface-2 p-2 xl:mx-4">
      <div className="flex items-center gap-3">
        <Link to={gymHref} viewTransition aria-label={gym ? `${gym.name}, your gym` : NO_GYM_COPY.kicker} className="block shrink-0 rounded-md">
          {gym ? (
            <PlaceImage src={gym.photoUrl} name={gym.name} className="h-10 w-10 rounded-md" textClassName="text-xs" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-1 text-text-1">
              <MapPin size={20} />
            </span>
          )}
        </Link>
        <div className="min-w-0 flex-1 max-xl:hidden">
          <Link to={gymHref} viewTransition className="block truncate text-sm font-semibold text-text-1 hover:underline">
            {gym ? gym.name : NO_GYM_COPY.kicker}
          </Link>
          <p className="truncate text-xs text-text-2">
            {gym ? (
              home.provisional ? (
                <button type="button" onClick={makeHome} disabled={setHome.isPending} className="font-semibold text-text-1 hover:underline disabled:opacity-60">
                  {setHome.isPending ? 'Setting…' : 'Make this my home gym'}
                </button>
              ) : (
                <>
                  Your gym ·{' '}
                  <Link to="/gyms" viewTransition className="font-semibold text-text-1 hover:underline">
                    Switch
                  </Link>
                </>
              )
            ) : (
              'Pick where you train'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Desktop navigation: the gym identity card, then the six hubs and Inbox,
 * flat. Sub-pages live in each hub's SectionTabs, so the list fits a 900 px
 * laptop without scrolling; when it does scroll (large text), the active row is
 * kept clear of the edge fades by scroll-padding on the list and scroll-margin
 * on the row. Settings/Support stay in the account menu. On hub roots the
 * band's Log button is the only compose affordance, so the sidebar's hides.
 */
function Sidebar({ meta, inbox, home, showLog }: { meta: RouteMeta; inbox: string | number | null; home: HomeGymState; showLog: boolean }) {
  const { user } = useAuth();
  const navRef = useRef<HTMLElement>(null);
  const edges = useScrollEdges(navRef, 'y');
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [meta.nav, meta.hub]);
  return (
    <aside className="vt-sidebar sticky top-0 hidden h-dvh w-[4.5rem] shrink-0 flex-col border-r border-line bg-surface-1 lg:flex xl:w-60">
      <div className="flex h-16 shrink-0 items-center justify-center px-3 xl:justify-start xl:px-5">
        <Link to="/" viewTransition aria-label="Vybe home" className="inline-flex h-11 items-center rounded-sm px-1">
          <BrandMark size={28} className="text-mark xl:hidden" />
          <Brand size="md" className="max-xl:hidden" />
        </Link>
      </div>
      <SidebarGym home={home} />
      {showLog ? (
        <div className="px-3 xl:px-4">
          <LogButton className="xl:justify-start" />
        </div>
      ) : null}
      <nav
        ref={navRef}
        aria-label="Primary"
        data-scroll-start={edges.start || undefined}
        data-scroll-end={edges.end || undefined}
        className={cx('scroll-visible mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-3 [scroll-padding-block:3rem] xl:px-4', fadeClass(edges, 'y'))}
      >
        <ul className="space-y-0.5">
          {SIDEBAR.map((item) => (
            <li key={item.to}>
              <SideLink item={item} active={sidebarActive(meta, item)} badge={item.badge === 'inbox' ? inbox : null} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="shrink-0 border-t border-line p-3 xl:p-4">
        <div className="flex items-center justify-center gap-3 xl:justify-start">
          <AccountMenu align="start" />
          <div className="min-w-0 flex-1 max-xl:hidden">
            <p className="truncate text-sm font-semibold text-text-1">{user?.fullName || user?.username}</p>
            <p className="truncate text-xs text-text-2">@{user?.username}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function DesktopTopBar({ notifications }: { notifications: string | number | null }) {
  const notificationsNav = useNavLinkProps('/notifications');
  return (
    <header className="vt-header sticky top-0 z-40 hidden h-14 items-center gap-4 border-b border-line bg-surface-1 px-gutter lg:flex">
      <SearchBox className="w-full max-w-md" />
      <div className="ml-auto flex items-center gap-1">
        <IconButton to="/notifications" label="Notifications" badge={notifications} className="text-text-1" linkProps={notificationsNav}>
          <Bell size={24} />
        </IconButton>
        <AccountMenu />
      </div>
    </header>
  );
}

/** Whether a screen shows a back chevron: an explicit `back`, or any page that is not a tab root, hub page or Home. */
const wantsBack = (meta: RouteMeta, back: boolean | string | undefined) =>
  typeof back === 'string' || back === true || (back === undefined && !meta.root && !meta.hub && meta.pattern !== '/');

/** Back: the page's own target, else history, else the route's parent (a deep link has no history). */
function useGoBack(meta: RouteMeta, back: boolean | string | undefined) {
  const navigate = useNavigate();
  return () => {
    if (typeof back === 'string') return navigate(back, { viewTransition: true });
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(meta.parent ?? '/', { replace: true, viewTransition: true });
  };
}

function MobileTopBar({
  meta,
  title,
  titleNode,
  back,
  actions,
  chats,
  notifications,
}: {
  meta: RouteMeta;
  title: string;
  titleNode?: ReactNode;
  back: boolean | string | undefined;
  actions: ReactNode;
  chats: string | number | null;
  notifications: string | number | null;
}) {
  const { logout } = useAuth();
  const isHome = meta.pattern === '/';
  const showBack = wantsBack(meta, back);
  // The Home top bar's icons are primary entry points too: same preload-on-intent
  // and pending-destination feedback as the tabs.
  const searchNav = useNavLinkProps('/search');
  const messagesNav = useNavLinkProps('/messages');
  const notificationsNav = useNavLinkProps('/notifications');
  const goBack = useGoBack(meta, back);

  const profileMenu: MenuItem[] = [
    { label: 'Friends', icon: <Users size={18} />, to: '/friends' },
    { label: 'Challenges', icon: <Zap size={18} />, to: '/challenges' },
    { label: 'Achievements', icon: <Award size={18} />, to: '/achievements' },
    { label: 'Health', icon: <Heart size={18} />, to: '/health', divider: true },
    { label: 'Goals', icon: <Target size={18} />, to: '/health/goals' },
    { label: 'Progress photos', icon: <Camera size={18} />, to: '/health/photos' },
    { label: 'Settings', icon: <Settings size={18} />, to: '/settings', divider: true },
    { label: 'Support', icon: <LifeBuoy size={18} />, to: '/support' },
    { label: 'Log out', description: LOGOUT_SCOPE, icon: <LogOut size={18} />, onSelect: logout, danger: true, divider: true },
  ];

  return (
    <header className="vt-header safe-top sticky top-0 z-40 border-b border-line bg-surface-1 lg:hidden">
      <div className="flex h-12 items-center gap-1 px-2 text-text-1">
        {isHome ? (
          <>
            {/* The wordmark is the visual title; the page still needs a level-one heading. */}
            <h1 className="sr-only">Home</h1>
            <Link to="/" viewTransition className="inline-flex h-11 items-center rounded-sm px-2" aria-label="Vybe home">
              <Brand size="sm" />
            </Link>
          </>
        ) : (
          <>
            {showBack ? (
              <IconButton label="Back" onClick={goBack} className="text-text-1">
                <ArrowLeft size={24} />
              </IconButton>
            ) : null}
            <h1 className={cx('type-heading flex min-w-0 flex-1 items-center text-text-1', showBack ? 'text-md' : 'pl-2 text-xl', !titleNode && 'truncate')}>{titleNode ?? title}</h1>
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center">
          {actions}
          {isHome ? (
            <>
              <IconButton to="/search" label="Search" className="text-text-1" linkProps={searchNav}>
                <SearchIcon size={24} />
              </IconButton>
              <IconButton to="/messages" label="Messages" badge={chats} className="text-text-1" linkProps={messagesNav}>
                <Inbox size={24} />
              </IconButton>
              <IconButton to="/notifications" label="Notifications" badge={notifications} className="text-text-1" linkProps={notificationsNav}>
                <Bell size={24} />
              </IconButton>
            </>
          ) : null}
          {meta.pattern === '/profile' ? <Menu label="More" items={profileMenu} /> : null}
          {isHome || meta.root || meta.hub ? <LogButton compact /> : null}
        </div>
      </div>
    </header>
  );
}

function SectionTabs({
  hub,
  pathname,
  chats,
  notifications,
  liveEnabled,
  underBand = false,
}: {
  hub: HubKey;
  pathname: string;
  chats: string | number | null;
  notifications: string | number | null;
  liveEnabled: boolean;
  /** The band's 56 px bar is above this row instead of the top bar. */
  underBand?: boolean;
}) {
  const start = usePendingNavigation((s) => s.start);
  const tabs = HUBS[hub]
    .filter((t) => liveEnabled || t.to !== LIVE_PATH)
    .map((t) => ({
      key: t.to,
      label: t.label,
      to: t.to,
      badge:
        t.badge === 'chats' && chats ? <CountBadge value={chats} className="ring-0" /> : t.badge === 'notifications' && notifications ? <CountBadge value={notifications} className="ring-0" /> : undefined,
    }));
  const active = tabs.find((t) => t.key === pathname)?.key ?? tabs.find((t) => pathname.startsWith(`${t.key}/`))?.key ?? '';
  // The siblings of the current section are the likeliest next taps.
  useEffect(() => preloadWhenIdle(tabs.map((t) => t.to)), [hub]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <nav
      aria-label="Sections"
      className={cx(
        'sticky z-30 border-b border-line bg-surface-1',
        underBand ? 'top-[var(--band-bar-h)]' : 'top-[calc(3rem+env(safe-area-inset-top))] lg:top-14',
      )}
    >
      <div className="mx-auto max-w-content">
        <Tabs
          tabs={tabs}
          active={active}
          className="border-b-0"
          aria-label="Section tabs"
          onChange={(key) => {
            if (key !== pathname) start(key);
          }}
        />
      </div>
    </nav>
  );
}

function BottomTab({ tab, active, badge }: { tab: (typeof TABS)[number]; active: boolean; badge: string | number | null }) {
  const { key, to, label, Icon } = tab;
  const navProps = useNavLinkProps(to);
  return (
    <li className="flex flex-1">
      <Link
        to={to}
        viewTransition
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        {...navProps}
        className={cx(
          'relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-sm pt-1.5 pb-1 transition-colors dur-1',
          active ? 'text-text-1' : 'text-text-3 hover:text-text-1',
        )}
      >
        <span className="relative">
          <Icon size={24} filled={active} strokeWidth={active ? 2.2 : 1.8} />
          {key === 'home' && badge ? <CountBadge value={badge} className="absolute -right-2.5 -top-1.5" /> : null}
        </span>
        <span className={cx('text-[0.6875rem] leading-none', active ? 'font-semibold' : 'font-medium')}>{label}</span>
      </Link>
    </li>
  );
}

function BottomNav({ meta, homeBadge }: { meta: RouteMeta; homeBadge: string | number | null }) {
  return (
    <nav aria-label="Primary" className="vt-nav safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-1/95 backdrop-blur-xl lg:hidden">
      <ul className="mx-auto flex h-14 max-w-lg items-stretch justify-around px-1">
        {TABS.map((tab) => (
          <BottomTab key={tab.key} tab={tab} active={meta.tab === tab.key} badge={homeBadge} />
        ))}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ right rail */

function RailCard({ title, to, linkLabel, children }: { title: string; to?: string; linkLabel?: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="type-heading text-md text-text-1">{title}</h2>
        {to ? (
          <Link to={to} viewTransition className="text-xs font-semibold text-brand-text hover:underline">
            {linkLabel ?? 'See all'}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function RailError({ what, retry }: { what: string; retry: () => void }) {
  return (
    <p className="text-xs text-text-2">
      Couldn’t load {what}.{' '}
      <button type="button" onClick={retry} className="font-semibold text-brand-text hover:underline">
        Retry
      </button>
    </p>
  );
}

const EXPLORE_MORE: Array<{ to: string; label: string; Icon: IconComponent }> = [
  { to: '/challenges', label: 'Challenges', Icon: Zap },
  { to: '/live', label: 'Live', Icon: Radio },
  { to: '/stories', label: 'Stories', Icon: Sparkles },
  { to: '/communities', label: 'Communities', Icon: Globe },
  { to: '/achievements', label: 'Achievements', Icon: Award },
  { to: '/friends', label: 'Friends', Icon: Users },
];

export function DefaultRail() {
  const liveEnabled = useLiveEnabled().enabled;
  const tags = useQuery({
    queryKey: ['trending-hashtags'],
    queryFn: async () => {
      const { data } = await api.get('/posts/trending-hashtags');
      return (data.hashtags || []) as { _id: string; count: number }[];
    },
    staleTime: 5 * 60_000,
  });
  const coaches = useQuery({
    queryKey: ['discover-coaches', ''],
    queryFn: async () => {
      const { data } = await api.get('/users/coaches');
      return (data.coaches || data.users || []) as PublicUser[];
    },
    staleTime: 5 * 60_000,
  });

  return (
    <div className="space-y-4">
      <RailCard title="Trending" to="/search" linkLabel="Search">
        {tags.isLoading ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-20" />
            ))}
          </div>
        ) : tags.isError ? (
          <RailError what="trending tags" retry={() => void tags.refetch()} />
        ) : tags.data && tags.data.length ? (
          <div className="flex flex-wrap gap-2">
            {tags.data.slice(0, 8).map((t) => (
              <Chip key={t._id} to={`/search?q=${encodeURIComponent(`#${t._id}`)}`}>
                #{t._id}
                <span className="tabular ml-1 font-medium text-text-3">{formatStat(t.count, { compact: true })}</span>
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-2">Nothing is trending yet — start a tag with your next post.</p>
        )}
      </RailCard>

      <RailCard title="Coaches to follow" to="/discover" linkLabel="Explore">
        {coaches.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : coaches.isError ? (
          <RailError what="coaches" retry={() => void coaches.refetch()} />
        ) : coaches.data && coaches.data.length ? (
          <ul className="space-y-1">
            {coaches.data.slice(0, 4).map((u) => (
              <li key={u._id}>
                <Link to={`/u/${u._id}`} viewTransition className="-mx-2 flex min-h-12 items-center gap-3 rounded-sm px-2 py-1.5 transition-colors dur-1 hover:bg-surface-2">
                  <Avatar src={u.avatar} name={u.fullName || u.username} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text-1">{u.fullName || u.username}</span>
                    <span className="block truncate text-xs text-text-2">@{u.username}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-text-2">No coaches on Vybe yet.</p>
        )}
      </RailCard>

      <RailCard title="More to explore">
        <ul className="grid grid-cols-2 gap-1">
          {EXPLORE_MORE.filter((e) => liveEnabled || e.to !== LIVE_PATH).map(({ to, label, Icon }) => (
            <li key={to}>
              <Link
                to={to}
                viewTransition
                onPointerDown={() => preload(to)}
                onMouseEnter={() => preload(to)}
                className="flex min-h-11 items-center gap-2 rounded-sm px-2 text-sm font-medium text-text-2 transition-colors dur-1 hover:bg-surface-2 hover:text-text-1"
              >
                <Icon size={18} className="text-text-3" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </RailCard>

      <p className="px-1 text-2xs text-text-3">
        <Link to="/support" className="hover:underline">Support</Link>
        {' · '}
        <a href="/privacy-policy.html" className="hover:underline">Privacy</a>
        {' · '}
        <a href="/terms-and-conditions.html" className="hover:underline">Terms</a>
      </p>
    </div>
  );
}

/* ================================================================== the band */

/**
 * The chrome row that rides on the band: brand (fades out as the collapsed
 * title takes its place), the desktop search box, inbox, notifications and Log.
 * Deeper phone pages (a gym page) get the back chevron here instead of the
 * top bar, and drop the phone search icon to fit 320 px. The cluster's width
 * is measured into `--band-actions-w` so the collapsed title never runs
 * under it.
 */
function BandChrome({ meta, back, chats, notifications, mint }: { meta: RouteMeta; back: boolean | string | undefined; chats: string | number | null; notifications: string | number | null; mint: boolean }) {
  const showBack = wantsBack(meta, back);
  const goBack = useGoBack(meta, back);
  const searchNav = useNavLinkProps('/search');
  const messagesNav = useNavLinkProps('/messages');
  const notificationsNav = useNavLinkProps('/notifications');
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = actionsRef.current;
    if (!el) return;
    const band = el.closest<HTMLElement>('.gym-band');
    if (!band) return;
    const measure = () => band.style.setProperty('--band-actions-w', `${Math.ceil(el.getBoundingClientRect().width) + 8}px`);
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return (
    <>
      {showBack ? (
        <IconButton label="Back" onClick={goBack} className="-ml-2 text-band-ink lg:hidden">
          <ArrowLeft size={24} />
        </IconButton>
      ) : null}
      <Link to="/" viewTransition aria-label="Vybe home" className="gym-band-brand inline-flex h-11 shrink-0 items-center rounded-sm px-1">
        <Brand size="sm" tone="inverse" />
      </Link>
      <div ref={actionsRef} className="ml-auto flex items-center gap-1">
        <SearchBox className="mr-2 hidden w-64 lg:block xl:w-80" />
        {!showBack ? (
          <IconButton to="/search" label="Search" className="text-band-ink lg:hidden" linkProps={searchNav}>
            <SearchIcon size={24} />
          </IconButton>
        ) : null}
        <IconButton to="/messages" label="Messages" badge={chats} className="text-band-ink" linkProps={messagesNav}>
          <Inbox size={24} />
        </IconButton>
        <IconButton to="/notifications" label="Notifications" badge={notifications} className="text-band-ink" linkProps={notificationsNav}>
          <Bell size={24} />
        </IconButton>
        <LogButton band mint={mint} />
      </div>
    </>
  );
}

/** "Your week at {gym}" → the real name; a placeholder with no gym to fill it drops the line (the band then offers "Find your gym"). */
export function bandContext(context: string | undefined, gymName: string | undefined): string | undefined {
  if (context === undefined) return undefined;
  if (!/\{gym\}/.test(context)) return context;
  return gymName ? context.replace(/\{gym\}/g, gymName) : undefined;
}

/**
 * The shell's rendering of a page's `band`. The page declares what it knows
 * (title, context, one figure or the next action, the primary action, gym
 * tabs); the shell brings the viewer's home gym and the chrome row.
 *
 *  - Phones show the page's variant: hub bands carry the hub title and its
 *    one figure or next action; Home and gym pages are `full`.
 *  - From `lg` the band is the gym identity (`full`) on every hub, as in the
 *    desktop render, and the page's own header below it carries the title and
 *    actions — so the collapsed bar reads the gym, never a duplicate title.
 *  - No home gym (production today): the find-your-gym state renders at once,
 *    never a skeleton. A skeleton appears only while a gym the account already
 *    points at is loading.
 *  - One brand-coloured control per screen: the band's Log button is a chip
 *    unless nothing else on the band is primary.
 */
function ShellBand({
  band,
  home,
  title,
  meta,
  back,
  wide,
  chats,
  notifications,
}: {
  band: PageBand;
  home: HomeGymState;
  title: string;
  meta: RouteMeta;
  back: boolean | string | undefined;
  wide: boolean;
  chats: string | number | null;
  notifications: string | number | null;
}) {
  const pageGym: GymBandGym | null | undefined = band.gym;
  const gym = pageGym !== undefined ? pageGym : home.gym;
  const loading = pageGym === undefined && home.loading;
  const variant: 'full' | 'hub' = band.variant === 'full' || wide ? 'full' : 'hub';
  const context = bandContext(band.context, gym?.name);
  const hub = variant === 'hub';
  // Desktop, no gym: the page header below owns the page's primary action, so
  // the band's find-your-gym call is tonal there; on phones the band is the
  // page's header and its one CTA is the page's action, else find-your-gym.
  // On the Gyms page itself the search field below is the way to find a gym,
  // so a button that reloads the same page is dropped.
  const onGymsPage = meta.pattern === NO_GYM_COPY.href;
  const noGymAction = !hub && !gym && !loading ? (wide ? (onGymsPage ? null : <ButtonLink to={NO_GYM_COPY.href} variant="secondary">{NO_GYM_COPY.action}</ButtonLink>) : band.action) : undefined;
  const bandHasPrimary = hub ? !!band.action : !gym && !loading && !wide;
  const mintLog = !bandHasPrimary && !wide && !!gym;
  return (
    <GymBand
      variant={variant}
      gym={gym}
      loading={loading}
      title={band.bandTitle ?? title}
      context={hub ? context : undefined}
      figure={hub ? band.figure : undefined}
      figureLabel={band.figureLabel}
      figureUnit={band.figureUnit}
      action={hub ? band.action : noGymAction}
      secondaryAction={hub ? band.secondaryAction : undefined}
      tabs={band.tabs}
      titleAs={hub ? 'h1' : 'p'}
      chrome={<BandChrome meta={meta} back={back} chats={chats} notifications={notifications} mint={mintLog} />}
    >
      {hub ? band.children : null}
    </GymBand>
  );
}

/**
 * Route-change announcer for screen readers, and focus to the page region so
 * the next Tab lands in the new content rather than back in the nav. Skipped
 * for a sheet opening or closing over its parent (the dialog manages focus).
 */
function RouteAnnouncer({ pathname, title, sheet }: { pathname: string; title: string; sheet: boolean }) {
  const [message, setMessage] = useState('');
  // Keyed on the path, not a first-run flag, so StrictMode's double effect on mount does not count as a navigation.
  const lastPath = useRef(pathname);
  const titleRef = useRef(title);
  titleRef.current = title;
  const wasSheet = useRef(sheet);
  useEffect(() => {
    const skip = sheet || wasSheet.current;
    wasSheet.current = sheet;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (skip) return;
    // The page sets its title in an effect of its own; read it a beat later.
    const t = window.setTimeout(() => setMessage(titleRef.current), 80);
    const main = document.getElementById('main');
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
    return () => window.clearTimeout(t);
  }, [pathname, sheet]);
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}

/* ================================================================== shell */

/** Chunks worth having before the user asks: the five tab roots. */
const TAB_ROOT_PATHS = TABS.map((t) => t.to);

export default function Layout({ children }: { children?: ReactNode }) {
  const location = useLocation();
  const { pathname } = location;
  const meta = useMemo(() => routeMeta(pathname), [pathname]);
  const sheet = !!backgroundLocationOf(location);
  const wide = useMediaQuery(SHEET_MEDIA);
  const storedChrome = usePageChromeStore((s) => s.chrome);
  const chrome = storedChrome && storedChrome.path === pathname ? storedChrome : null;
  const { user } = useAuth();
  const sessionStale = useAuth((s) => s.sessionStale);
  const qc = useQueryClient();

  // Route-change feedback: the destination a nav control was activated for,
  // until the location catches up (see lib/navigation.ts).
  const pendingPath = usePendingNavigation((s) => s.pendingPath);
  const slow = usePendingNavigation((s) => s.slow);
  const finish = usePendingNavigation((s) => s.finish);
  useEffect(() => {
    finish();
  }, [pathname, finish]);
  useEffect(() => {
    if (pendingPath === null) return;
    // Safety net: a navigation that never commits (blocked, failed chunk) must not pin the bar.
    const t = window.setTimeout(finish, 10_000);
    return () => window.clearTimeout(t);
  }, [pendingPath, finish]);
  const pending = pendingPath !== null && pendingPath !== pathname;
  const navMeta = useMemo(() => (pending && pendingPath ? routeMeta(pendingPath) : meta), [pending, pendingPath, meta]);
  // The router commits a location change inside startTransition, so while the
  // destination's code downloads React holds the previous page. The tapped tab
  // lights up at once (navMeta), and a chunk already in memory renders straight
  // through (lazyPage). Only past the grace period do the destination's chrome
  // and a skeleton replace the held page: a Suspense fallback is never
  // committed for a navigation, because React would then hold it for its
  // 300 ms throttle and every quick chunk would flash a skeleton.
  const waiting = pending && slow;
  const shellMeta = waiting ? navMeta : meta;
  const shellChrome = waiting ? null : chrome;
  const shellPath = waiting && pendingPath ? pendingPath : pathname;

  useEffect(() => preloadWhenIdle(TAB_ROOT_PATHS), []);

  const liveEnabled = useLiveEnabled().enabled;

  const unreadChats = useUnreadChats(!!user);
  const unreadNotifs = useUnreadNotifications(!!user);
  useRealtimeSync(!!user, user?._id);
  // Open the shared socket for the whole session so likes, comments and
  // follows land in the inbox and on the bell as they happen.
  useLiveNotifications(!!user);
  // When a session restored from the offline snapshot is verified again, every
  // query that failed while the API was unreachable is retried at once rather
  // than on its next poll, so the shell fills back in without a "Try again".
  useEffect(() => {
    if (sessionStale) return;
    void qc.invalidateQueries({ predicate: (query) => query.state.status === 'error' });
  }, [sessionStale, qc]);
  const chats = badgeText(unreadChats.data);
  const notifications = badgeText(unreadNotifs.data?.count, unreadNotifs.data?.more);
  const homeTotal = (unreadChats.data ?? 0) + (unreadNotifs.data?.count ?? 0);
  const homeBadge = badgeText(homeTotal, unreadNotifs.data?.more);

  const title = shellChrome?.title || shellMeta.title;
  useEffect(() => {
    document.title = shellPath === '/' ? 'Vybe' : `${title} · Vybe`;
  }, [title, shellPath]);

  const hub = shellMeta.hub && !shellMeta.hideTabs && !shellChrome?.hideSectionTabs ? shellMeta.hub : null;
  const rail: ReactNode = shellChrome && 'rail' in shellChrome && shellChrome.rail !== undefined ? shellChrome.rail : shellMeta.rail ? <DefaultRail /> : null;
  const feedWidth = !!rail && !shellChrome?.wide;

  // The band: fetched once here for the sidebar card and every page's band.
  // A page that declares `band` wears it in place of both top bars; the band
  // is a direct child of the scrolling column so its sticky collapse works.
  const home = useHomeGym();
  const band = !waiting && !shellChrome?.hideTopBar ? shellChrome?.band ?? null : null;
  const fullBandOnPhone = !!band && (band.variant === 'full' || wide);

  return (
    <div className="min-h-dvh bg-bg text-text-1 lg:flex">
      <SkipLink />
      <NavProgress />
      <RouteAnnouncer pathname={pathname} title={title} sheet={sheet} />
      <Sidebar meta={navMeta} inbox={homeBadge} home={home} showLog={!band} />

      <div className="min-w-0 flex-1 overflow-x-clip">
        {band ? (
          <ShellBand band={band} home={home} title={title} meta={shellMeta} back={shellChrome?.back} wide={wide} chats={chats} notifications={notifications} />
        ) : !shellChrome?.hideTopBar ? (
          <>
            <MobileTopBar meta={shellMeta} title={title} titleNode={shellChrome?.titleNode} back={shellChrome?.back} actions={shellChrome?.actions} chats={chats} notifications={notifications} />
            <DesktopTopBar notifications={notifications} />
          </>
        ) : null}
        {/* A full band names the gym, not the page; the page still needs its level-one heading on phones (the desktop header has one). */}
        {fullBandOnPhone ? <h1 className="sr-only lg:hidden">{title}</h1> : null}
        <OfflineBanner />
        {hub ? <SectionTabs hub={hub} pathname={shellPath} chats={chats} notifications={notifications} liveEnabled={liveEnabled} underBand={!!band} /> : null}

        {/* The shell owns width: content is min(90rem, 100% − 2 gutters), centred,
            so 320 px keeps a gutter and 1920 px fills honestly. Feed-width pages
            centre a 600 px column from tablets up; the rail joins at lg. */}
        <div className={cx('mx-auto flex w-full gap-8', feedWidth ? 'max-w-[min(62rem,100%_-_2*var(--gutter))] justify-center' : 'max-w-content')}>
          <main id="main" tabIndex={-1} className={cx('min-w-0 flex-1 pt-4 outline-none focus-visible:outline-none lg:pt-6', shellChrome?.hideBottomNav ? 'pb-6' : 'pb-nav lg:pb-10', feedWidth && 'md:max-w-feed')}>
            <Suspense fallback={<RouteFallback />}>
              <RouteErrorBoundary>{waiting ? <PageSkeleton /> : (children ?? <Outlet />)}</RouteErrorBoundary>
            </Suspense>
          </main>
          {rail ? (
            <aside aria-label="Highlights" className="hidden w-72 shrink-0 pt-6 lg:block xl:w-80 2xl:w-96">
              <div className={cx('sticky space-y-4', band ? 'top-[calc(var(--band-bar-h)+1.5rem)]' : 'top-20')}>{rail}</div>
            </aside>
          ) : null}
        </div>
      </div>

      {!shellChrome?.hideBottomNav ? <BottomNav meta={navMeta} homeBadge={homeBadge} /> : null}
      <LogSheet />
    </div>
  );
}
