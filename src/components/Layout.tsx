import { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Link, Outlet, matchPath, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import type { NavigationType } from 'react-router-dom';
import { RouteErrorBoundary } from './ErrorBoundary';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLiveEnabled } from '../lib/capabilities';
import type { PublicUser } from '../lib/hooks';
import { getSocket } from '../lib/socket';
import { UNREAD_COUNT_KEY, useLiveNotifications } from '../lib/notificationsLive';
import type { UnreadCount } from '../lib/notificationInbox';
import { pathOf, preload, preloadWhenIdle, selectNavigating, usePendingNavigation } from '../lib/navigation';
import { usePageChromeField } from './PageChrome';
import { SHEET_MEDIA, backgroundLocationOf } from './RouteSheet';
import {
  Avatar,
  Brand,
  BrandMark,
  Button,
  Card,
  Chip,
  CountBadge,
  IconButton,
  Menu,
  Modal,
  PageSkeleton,
  SearchField,
  Skeleton,
  Tabs,
  cx,
  fadeClass,
  formatStat,
  useMediaQuery,
  useOnline,
  useToast,
  useScrollEdges,
} from './ui';
import type { MenuItem } from './ui';
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
  /** Tab roots: no back chevron. */
  root?: boolean;
  /** Feed-width content with the desktop right rail. */
  rail?: boolean;
  hideTabs?: boolean;
};

/**
 * Every routed consumer feature, in match order (static before params).
 * Section pages carry hub tabs so sub-features are one tap away; nothing is
 * reachable only by typing a URL. The title here is what the header shows on
 * the first frame of a route; a page with a live name (a profile, a gym, a
 * meal) publishes its own through PageChrome and the header swaps the text.
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
  // The gym page carries its own tabs in its profile header (Feed · Today · Members · About): no hub row under it.
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

/** Routes without a row (the not-found page, a session landing): the app's own name until the page publishes one. */
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
 * The create action. Compact (phone header) is Instagram's outline plus on the
 * bar's leading edge — where Instagram (2026) and the Vybe mobile app both put
 * create — not a filled disc: the disc made the corner the loudest thing on the
 * screen. The desktop button is the sidebar's primary, always present, and
 * keeps its label from xl.
 */
function LogButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  const setOpen = useLogSheet((s) => s.setOpen);
  if (compact) {
    return (
      <button
        type="button"
        aria-label="Log something"
        onClick={() => setOpen(true)}
        className={cx('pressable inline-flex h-11 w-11 items-center justify-center rounded-sm text-text-1', className)}
      >
        <Plus size={26} />
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
              className="pressable flex min-h-16 items-center gap-4 rounded-md px-3 py-2.5 focus-visible:bg-surface-2"
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
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
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
        <span className="pressable inline-flex h-11 w-11 items-center justify-center rounded-full">
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
        // Instagram's row: 48 px, a 24 px icon and the label in the body size;
        // the current hub is a filled icon and a bold label, no tinted
        // background. scroll-margin keeps it clear of the edge fades.
        'pressable relative flex h-12 items-center justify-center gap-4 rounded-sm px-3 text-base text-text-1 scroll-my-12 xl:justify-start',
        active ? 'font-bold' : 'font-normal',
      )}
    >
      <span className="relative shrink-0">
        <Icon size={24} filled={active} strokeWidth={active ? 2.2 : 1.8} />
        {badge ? <CountBadge value={badge} className="absolute -right-2.5 -top-1.5 xl:hidden" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate max-xl:hidden">{label}</span>
      {badge ? <CountBadge value={badge} className="max-xl:hidden" /> : null}
    </Link>
  );
}

/**
 * Desktop navigation: the wordmark (the one on desktop — the header carries
 * the page title, not a second logo), the Log button, then the six hubs and
 * Inbox, flat. Sub-pages live in each hub's SectionTabs, so the list fits a
 * 900 px laptop without scrolling; when it does scroll (large text), the
 * active row is kept clear of the edge fades by scroll-padding on the list
 * and scroll-margin on the row. Settings/Support stay in the account menu.
 * An icon rail from lg, the full 244 px column from xl. Memoised: its props
 * are the route table row and a badge string, so a page re-render never
 * reaches it.
 */
const Sidebar = memo(function Sidebar({ meta, inbox }: { meta: RouteMeta; inbox: string | number | null }) {
  const user = useAuth((s) => s.user);
  const homeNav = useNavLinkProps('/');
  const navRef = useRef<HTMLElement>(null);
  const edges = useScrollEdges(navRef, 'y');
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [meta.nav, meta.hub]);
  return (
    <aside className="vt-sidebar sticky top-0 hidden h-dvh w-18 shrink-0 flex-col border-r border-line bg-surface-1 lg:flex xl:w-sidebar">
      <div className="flex h-14 shrink-0 items-center justify-center px-3 xl:justify-start xl:px-5">
        <Link to="/" viewTransition aria-label="Vybe home" {...homeNav} className="pressable inline-flex h-11 items-center rounded-sm px-1">
          <BrandMark size={28} className="text-mark xl:hidden" />
          <Brand size="md" className="max-xl:hidden" />
        </Link>
      </div>
      <div className="px-3 pt-2 xl:px-4">
        <LogButton className="xl:justify-start" />
      </div>
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
});

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

/**
 * The shell's header: Instagram's slim title bar on every page, one element
 * for both breakpoints so the document has exactly one level-one heading.
 *
 *  - 48 px + the status bar on phones, 56 px from lg; a hairline below; the
 *    height never changes, so a title that arrives from the page is a text
 *    swap, not a reflow.
 *  - The title is `title` (route → page → "Vybe", resolved by the shell) or
 *    the page's `titleNode`. Centred on phones between two equal columns, so
 *    a back chevron on one side and actions on the other never push it off
 *    centre; leading on desktop.
 *  - Phone Home: the wordmark is the visual title (the h1 is read, not seen)
 *    with search, messages, notifications and the Log disc trailing. Every
 *    other phone page: back chevron when the route is not a root, the page's
 *    actions, the Log disc on roots and hub pages.
 *  - Desktop: the page's actions, then the search field and the bell. The
 *    account lives at the foot of the sidebar, once.
 *
 * Only this component subscribes to the element-valued chrome fields, so a
 * page re-render re-renders the header and nothing else in the shell.
 */
function AppHeader({
  meta,
  title,
  chromePath,
  chats,
  notifications,
  wide,
}: {
  meta: RouteMeta;
  title: string;
  /** The path whose published chrome counts; null while the shell shows a destination that has not rendered yet. */
  chromePath: string | null;
  chats: string | number | null;
  notifications: string | number | null;
  /** lg and up (the JS twin of the `lg:` classes), used to pick the action set. */
  wide: boolean;
}) {
  const titleNode = usePageChromeField(chromePath, (c) => c.titleNode);
  const subtitle = usePageChromeField(chromePath, (c) => c.subtitle);
  const back = usePageChromeField(chromePath, (c) => c.back);
  const desktopActions = usePageChromeField(chromePath, (c) => c.actions);
  const mobileActions = usePageChromeField(chromePath, (c) => c.mobileActions);
  // `mobileActions={null}` means "nothing in the phone bar"; only undefined falls back to the desktop set.
  const actions = wide ? desktopActions : mobileActions === undefined ? desktopActions : mobileActions;
  const logout = useAuth((s) => s.logout);
  const isHome = meta.pattern === '/';
  const showBack = wantsBack(meta, back);
  // Every header link records intent: the chunk warms on pointer-down and the
  // pending highlight lands before the location commits, like the tabs.
  const homeNav = useNavLinkProps('/');
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
    <header className="vt-header safe-top sticky top-0 z-40 border-b border-line bg-surface-1">
      <div className="grid h-12 grid-cols-[1fr_auto_1fr] items-center px-2 text-text-1 lg:flex lg:h-14 lg:px-gutter">
        {/* Leading edge: Back when the route has one; otherwise create (+) on Home, root and hub pages, and Search on Home.
            This is the Instagram 2026 / Vybe mobile arrangement: the trailing corner keeps at most two icons. */}
        <div className="flex min-w-0 items-center justify-start gap-1">
          {showBack ? (
            <IconButton label="Back" onClick={goBack} className="text-text-1">
              <ArrowLeft size={24} />
            </IconButton>
          ) : (
            <div className="flex items-center gap-1 lg:hidden">
              {isHome || meta.root || meta.hub ? <LogButton compact /> : null}
              {isHome ? (
                <IconButton to="/search" label="Search" className="text-text-1" linkProps={searchNav}>
                  <SearchIcon size={24} />
                </IconButton>
              ) : null}
            </div>
          )}
        </div>
        {/* On phone Home the wordmark IS the level-one heading (Brand reads "Vybe"); from lg the sidebar carries the brand
            and the heading is the route title. */}
        <div className={cx('min-w-0 px-2 text-center lg:flex-1 lg:text-left')}>
          <h1 className={cx('truncate text-text-1', subtitle ? 't-section' : 't-title', titleNode ? 'flex items-center justify-center lg:justify-start' : undefined, isHome && 'max-lg:flex max-lg:items-center max-lg:justify-center')}>
            {isHome ? (
              <>
                <Link to="/" viewTransition aria-label="Vybe home" {...homeNav} className="pressable inline-flex h-11 items-center rounded-sm px-2 lg:hidden">
                  <Brand size="sm" />
                </Link>
                <span className="max-lg:sr-only">{titleNode ?? title}</span>
              </>
            ) : (
              titleNode ?? title
            )}
          </h1>
          {subtitle ? <p className="t-meta truncate">{subtitle}</p> : null}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1">
          {actions}
          <div className="flex items-center gap-1 lg:hidden">
            {isHome ? (
              <>
                <IconButton to="/messages" label="Messages" badge={chats} className="text-text-1" linkProps={messagesNav}>
                  <Inbox size={24} />
                </IconButton>
                <IconButton to="/notifications" label="Notifications" badge={notifications} className="text-text-1" linkProps={notificationsNav}>
                  <Bell size={24} />
                </IconButton>
              </>
            ) : null}
            {meta.pattern === '/profile' ? <Menu label="More" items={profileMenu} /> : null}
          </div>
          <div className="hidden items-center gap-2 lg:flex">
            <SearchBox className="w-56 xl:w-72" />
            <IconButton to="/notifications" label="Notifications" badge={notifications} className="text-text-1" linkProps={notificationsNav}>
              <Bell size={24} />
            </IconButton>
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * The hub's section tabs: the only underline tabs in the app, stuck directly
 * under the header at its exact height (48 px plus the status bar on phones,
 * 56 px from lg — `html { scroll-padding-top }` uses the same numbers, so
 * anchors land clear of both). Memoised: its props are all primitives.
 */
const SectionTabs = memo(function SectionTabs({
  hub,
  pathname,
  chats,
  notifications,
  liveEnabled,
}: {
  hub: HubKey;
  pathname: string;
  chats: string | number | null;
  notifications: string | number | null;
  liveEnabled: boolean;
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
        'top-[calc(48px+env(safe-area-inset-top))] lg:top-14',
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
});

function BottomTab({ tab, active, dot }: { tab: (typeof TABS)[number]; active: boolean; dot: boolean }) {
  const { to, label, Icon } = tab;
  const navProps = useNavLinkProps(to);
  return (
    <li className="flex flex-1">
      <Link
        to={to}
        viewTransition
        aria-label={dot ? `${label}, new activity` : label}
        aria-current={active ? 'page' : undefined}
        {...navProps}
        className={cx(
          'pressable relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-sm',
          active ? 'text-text-1' : 'text-text-2',
        )}
      >
        <span className="relative">
          <Icon size={24} filled={active} strokeWidth={active ? 2.2 : 1.8} />
          {/* Instagram's badge on a tab: a red dot, never a number. */}
          {dot ? <span aria-hidden="true" className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface-1" /> : null}
        </span>
        {/* 11 px labels stay: the Vybe icon set is not self-evident (Meals, Gyms and Workouts read alike without them). */}
        <span className={cx('text-2xs leading-none', active ? 'font-semibold' : 'font-medium')}>{label}</span>
      </Link>
    </li>
  );
}

/** Phone tabs: 48 px plus the home indicator, opaque, a hairline above. Memoised: a route row and a boolean. */
const BottomNav = memo(function BottomNav({ meta, unread }: { meta: RouteMeta; unread: boolean }) {
  return (
    <nav aria-label="Primary" className="vt-nav safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-1 lg:hidden">
      <ul className="mx-auto flex h-12 max-w-lg items-stretch justify-around">
        {TABS.map((tab) => (
          <BottomTab key={tab.key} tab={tab} active={meta.tab === tab.key} dot={tab.key === 'home' && unread} />
        ))}
      </ul>
    </nav>
  );
});

/* ------------------------------------------------------------------ right rail */

function RailCard({ title, to, linkLabel, children }: { title: string; to?: string; linkLabel?: string; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="t-section text-text-1">{title}</h2>
        {to ? (
          <Link to={to} viewTransition className="text-xs font-semibold text-brand-text hover:underline">
            {linkLabel ?? 'See all'}
          </Link>
        ) : null}
      </div>
      {children}
    </Card>
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
                <Link to={`/u/${u._id}`} viewTransition className="pressable -mx-2 flex min-h-12 items-center gap-3 rounded-sm px-2 py-1.5">
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
                className="pressable flex min-h-11 items-center gap-2 rounded-sm px-2 text-sm font-medium text-text-2 hover:text-text-1"
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

/** One element for the route default, so the rail never re-renders because the shell did. */
const DEFAULT_RAIL = <DefaultRail />;

/**
 * The rail's content: the page's own when it published one, else the route's
 * default. Its own component because `rail` is an element (fresh on every
 * page render): only this subscribes to it, so the rest of the shell is not
 * re-rendered by a page that redraws.
 */
function RailSlot({ chromePath, routeDefault }: { chromePath: string | null; routeDefault: boolean }) {
  const rail = usePageChromeField(chromePath, (c) => c.rail);
  if (rail) return <>{rail}</>;
  if (rail === null) return null;
  return routeDefault ? DEFAULT_RAIL : null;
}

/**
 * Route-change announcer for screen readers, and focus to the page region so
 * the next Tab lands in the new content rather than back in the nav. Focus
 * moves only on a forward navigation: coming back (POP) restores the scroll
 * position, and moving focus then would pull the reading position away from
 * it. Skipped for a sheet opening or closing over its parent (the dialog
 * manages focus).
 */
function RouteAnnouncer({ pathname, title, sheet, navigationType }: { pathname: string; title: string; sheet: boolean; navigationType: NavigationType }) {
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
    // The page publishes its own title in a layout effect; read it a beat later so the live name is announced.
    const t = window.setTimeout(() => setMessage(titleRef.current), 80);
    if (navigationType !== 'POP') {
      const main = document.getElementById('main');
      if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
    }
    return () => window.clearTimeout(t);
  }, [pathname, sheet, navigationType]);
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
  const navigationType = useNavigationType();
  const meta = useMemo(() => routeMeta(pathname), [pathname]);
  const wide = useMediaQuery(SHEET_MEDIA);
  // A sheet sits over its parent only from lg; on phones the same route is an ordinary page.
  const sheet = wide && !!backgroundLocationOf(location);
  const user = useAuth((s) => s.user);
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
  const shellPath = waiting && pendingPath ? pendingPath : pathname;
  // Whose published chrome counts: the current page's, and nobody's while the
  // shell already shows a destination that has not rendered (its title comes
  // from the route table). The shell reads only primitives from the store;
  // the header and the rail slot read the element-valued fields themselves.
  const chromePath = waiting ? null : pathname;
  const pageTitle = usePageChromeField(chromePath, (c) => c.title);
  const hideSectionTabs = usePageChromeField(chromePath, (c) => c.hideSectionTabs) ?? false;
  const hideBottomNav = usePageChromeField(chromePath, (c) => c.hideBottomNav) ?? false;
  const wideContent = usePageChromeField(chromePath, (c) => c.wide) ?? false;
  const railState = usePageChromeField(chromePath, (c) => (c.rail === undefined ? undefined : c.rail === null ? 'none' : 'page'));

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

  // Route → page-published → "Vybe" (FALLBACK_META), on the same frame as the route.
  const title = pageTitle || shellMeta.title;
  useEffect(() => {
    document.title = shellPath === '/' ? 'Vybe' : `${title} · Vybe`;
  }, [title, shellPath]);

  const hub = shellMeta.hub && !shellMeta.hideTabs && !hideSectionTabs ? shellMeta.hub : null;
  const hasRail = railState === 'page' || (railState === undefined && !!shellMeta.rail);
  const feedWidth = hasRail && !wideContent;

  return (
    <div className="min-h-dvh bg-bg text-text-1 lg:flex">
      <SkipLink />
      <NavProgress />
      <RouteAnnouncer pathname={pathname} title={title} sheet={sheet} navigationType={navigationType} />
      <Sidebar meta={navMeta} inbox={homeBadge} />

      <div className="min-w-0 flex-1 overflow-x-clip">
        <AppHeader meta={shellMeta} title={title} chromePath={chromePath} chats={chats} notifications={notifications} wide={wide} />
        <OfflineBanner />
        {hub ? <SectionTabs hub={hub} pathname={shellPath} chats={chats} notifications={notifications} liveEnabled={liveEnabled} /> : null}

        {/* The shell owns width: content is min(90rem, 100% − 2 gutters), centred,
            so 320 px keeps a gutter and 1920 px fills honestly. Feed-width pages
            centre a 540 px column from tablets up; the rail joins at lg. */}
        <div className={cx('mx-auto flex w-full gap-8', feedWidth ? 'max-w-[min(62rem,100%_-_2*var(--gutter))] justify-center' : 'max-w-content')}>
          <main id="main" tabIndex={-1} className={cx('min-w-0 flex-1 pt-4 outline-none focus-visible:outline-none lg:pt-6', hideBottomNav ? 'pb-6' : 'pb-nav lg:pb-10', feedWidth && 'md:max-w-feed')}>
            <Suspense fallback={<RouteFallback />}>
              <RouteErrorBoundary>{waiting ? <PageSkeleton /> : (children ?? <Outlet />)}</RouteErrorBoundary>
            </Suspense>
          </main>
          {hasRail ? (
            <aside aria-label="Highlights" className="hidden w-72 shrink-0 pt-6 lg:block xl:w-80 2xl:w-96">
              <div className="sticky top-20 space-y-4">
                <RailSlot chromePath={chromePath} routeDefault={!!shellMeta.rail} />
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      {!hideBottomNav ? <BottomNav meta={navMeta} unread={homeTotal > 0} /> : null}
      <LogSheet />
    </div>
  );
}
