import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Link, Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';
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
import {
  Avatar,
  Brand,
  BrandMark,
  Button,
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
  useOnline,
  usePageChromeStore,
  useToast,
  useScrollEdges,
} from './ui';
import type { MenuItem } from './ui';
import {
  ArrowLeft,
  Award,
  Bell,
  BookOpen,
  Building,
  CalendarDays,
  Camera,
  ClipboardList,
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
export type HubKey = 'explore' | 'train' | 'fuel' | 'body' | 'gyms' | 'inbox';

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
  { pattern: '/friends', title: 'Friends', tab: 'you', nav: '/friends', parent: '/profile' },
  { pattern: '/settings', title: 'Settings', tab: 'you', nav: '/settings', parent: '/profile' },
  { pattern: '/support', title: 'Support', tab: 'you', nav: '/support', parent: '/settings' },
  { pattern: '/gyms', title: 'Gyms', tab: 'gyms', nav: '/gyms', root: true, hub: 'gyms' },
  { pattern: '/communities', title: 'Communities', tab: 'gyms', nav: '/communities', hub: 'gyms' },
  { pattern: '/workouts', title: 'Workouts', tab: 'workouts', nav: '/workouts', root: true, hub: 'train' },
  { pattern: '/workouts/logs', title: 'Workout log', tab: 'workouts', nav: '/workouts/logs', hub: 'train' },
  { pattern: '/challenges', title: 'Challenges', tab: 'workouts', nav: '/challenges', hub: 'train' },
  { pattern: '/achievements', title: 'Achievements', tab: 'workouts', nav: '/achievements', hub: 'train' },
  { pattern: '/workouts/:workoutId', title: 'Workout', tab: 'workouts', nav: '/workouts', parent: '/workouts' },
  { pattern: '/recaps', title: 'Recaps', tab: 'workouts', nav: '/recaps', hub: 'train' },
  { pattern: '/recaps/:id', title: 'Recap', tab: 'workouts', nav: '/recaps', parent: '/recaps' },
  { pattern: '/meals', title: 'Meals', tab: 'meals', nav: '/meals', root: true, hub: 'fuel' },
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
    { to: '/discover', label: 'Discover' },
    { to: '/search', label: 'Search' },
    { to: '/stories', label: 'Stories' },
    { to: '/live', label: 'Live' },
  ],
  train: [
    { to: '/workouts', label: 'Library' },
    { to: '/workouts/logs', label: 'Log' },
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
  gyms: [
    { to: '/gyms', label: 'Gyms' },
    { to: '/communities', label: 'Communities' },
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

type SidebarItem = { to: string; label: string; Icon: IconComponent; badge?: 'chats' | 'notifications' };
const SIDEBAR: Array<{ label?: string; items: SidebarItem[] }> = [
  {
    items: [
      { to: '/', label: 'Home', Icon: Home },
      { to: '/discover', label: 'Explore', Icon: Compass },
      { to: '/messages', label: 'Inbox', Icon: Inbox, badge: 'chats' },
      { to: '/notifications', label: 'Notifications', Icon: Bell, badge: 'notifications' },
    ],
  },
  {
    label: 'Train',
    items: [
      { to: '/workouts', label: 'Workouts', Icon: Dumbbell },
      { to: '/workouts/logs', label: 'Log', Icon: ClipboardList },
      { to: '/challenges', label: 'Challenges', Icon: Zap },
      { to: '/achievements', label: 'Achievements', Icon: Award },
      { to: '/recaps', label: 'Recaps', Icon: CalendarDays },
    ],
  },
  {
    label: 'Fuel',
    items: [
      { to: '/meals', label: 'Meals', Icon: Utensils },
      { to: '/meals/templates', label: 'Templates', Icon: BookOpen },
      { to: '/meals/plans', label: 'Weekly plans', Icon: CalendarDays },
      { to: '/health/water', label: 'Hydration', Icon: Droplet },
    ],
  },
  {
    label: 'Body',
    items: [
      { to: '/health', label: 'Health', Icon: Heart },
      { to: '/health/goals', label: 'Goals', Icon: Target },
      { to: '/health/photos', label: 'Progress photos', Icon: Camera },
    ],
  },
  {
    label: 'Community',
    items: [
      { to: '/friends', label: 'Friends', Icon: Users },
      { to: '/gyms', label: 'Gyms', Icon: Building },
      { to: '/communities', label: 'Communities', Icon: Globe },
      { to: '/live', label: 'Live', Icon: Radio },
      { to: '/stories', label: 'Stories', Icon: Sparkles },
    ],
  },
];

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
 * The create action. Compact (phone top bar) is a plus in the mint circle —
 * the brand mark it used to show sat where apps put the avatar and read as a
 * logo, not "add". The desktop button keeps its label.
 */
function LogButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  const setOpen = useLogSheet((s) => s.setOpen);
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
    <Modal open={open} onClose={() => setOpen(false)} title="Log" description="What did you just do?" size="sm">
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
        'relative flex h-10 items-center justify-center gap-3 rounded-sm px-3 text-sm font-semibold transition-colors dur-1 pointer-coarse:min-h-11 xl:justify-start',
        active ? 'bg-brand-soft text-brand-text' : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
      )}
    >
      <span className="relative shrink-0">
        <Icon size={22} />
        {badge ? <CountBadge value={badge} className="absolute -right-2.5 -top-1.5 xl:hidden" /> : null}
      </span>
      <span className="hidden min-w-0 flex-1 truncate xl:inline">{label}</span>
      {badge ? <CountBadge value={badge} className="hidden xl:inline-flex" /> : null}
    </Link>
  );
}

/**
 * Desktop navigation. Twenty destinations do not fit a 900 px laptop, so the
 * list scrolls — with a painted scrollbar, an edge fade wherever more items
 * hide, 40 px rows, no per-group rules, and Settings/Support in the account
 * menu rather than a footer that ate another 100 px. The active item is
 * scrolled into view on every route change so the current section is never
 * below the fold.
 */
function Sidebar({ meta, chats, notifications, liveEnabled }: { meta: RouteMeta; chats: string | number | null; notifications: string | number | null; liveEnabled: boolean }) {
  const { user } = useAuth();
  const navRef = useRef<HTMLElement>(null);
  const edges = useScrollEdges(navRef, 'y');
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [meta.nav]);
  const groups = useMemo(
    () => SIDEBAR.map((g) => ({ ...g, items: liveEnabled ? g.items : g.items.filter((i) => i.to !== LIVE_PATH) })),
    [liveEnabled],
  );
  return (
    <aside className="vt-sidebar sticky top-0 hidden h-dvh w-[4.5rem] shrink-0 flex-col border-r border-line bg-surface-1 lg:flex xl:w-60">
      <div className="flex h-16 shrink-0 items-center justify-center px-3 xl:justify-start xl:px-5">
        <Link to="/" viewTransition aria-label="Vybe home" className="inline-flex h-11 items-center rounded-sm px-1">
          <BrandMark size={28} className="text-brand xl:hidden" />
          <Brand size="md" className="hidden xl:inline-flex" />
        </Link>
      </div>
      <div className="px-3 xl:px-4">
        <LogButton className="xl:justify-start" />
      </div>
      <nav
        ref={navRef}
        aria-label="Primary"
        data-scroll-start={edges.start || undefined}
        data-scroll-end={edges.end || undefined}
        className={cx('scroll-visible mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-3 xl:px-4', fadeClass(edges, 'y'))}
      >
        {groups.map((group, gi) => (
          <div key={group.label ?? gi} className={cx(gi > 0 && 'mt-3')}>
            {group.label ? <p className="type-label mb-0.5 hidden px-3 text-text-3 xl:block">{group.label}</p> : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <SideLink
                    item={item}
                    active={meta.nav === item.to}
                    badge={item.badge === 'chats' ? chats : item.badge === 'notifications' ? notifications : null}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-line p-3 xl:p-4">
        <div className="flex items-center justify-center gap-3 xl:justify-start">
          <AccountMenu align="start" />
          <div className="hidden min-w-0 flex-1 xl:block">
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
    <header className="vt-header sticky top-0 z-40 hidden h-14 items-center gap-4 border-b border-line bg-bg/85 px-6 backdrop-blur-xl lg:flex xl:px-8">
      <SearchBox className="w-full max-w-md" />
      <div className="ml-auto flex items-center gap-1">
        <IconButton to="/notifications" label="Notifications" badge={notifications} linkProps={notificationsNav}>
          <Bell size={22} />
        </IconButton>
        <AccountMenu />
      </div>
    </header>
  );
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
  const navigate = useNavigate();
  const { logout } = useAuth();
  const isHome = meta.pattern === '/';
  const showBack = typeof back === 'string' || back === true || (back === undefined && !meta.root && !meta.hub && !isHome);
  // The Home top bar's icons are primary entry points too: same preload-on-intent
  // and pending-destination feedback as the tabs.
  const searchNav = useNavLinkProps('/search');
  const messagesNav = useNavLinkProps('/messages');
  const notificationsNav = useNavLinkProps('/notifications');

  const goBack = () => {
    if (typeof back === 'string') return navigate(back, { viewTransition: true });
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(meta.parent ?? '/', { replace: true, viewTransition: true });
  };

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
    <header className="vt-header safe-top sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-xl lg:hidden">
      <div className="flex h-12 items-center gap-1 px-2">
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
              <IconButton label="Back" onClick={goBack}>
                <ArrowLeft size={22} />
              </IconButton>
            ) : null}
            <h1 className={cx('type-heading flex min-w-0 flex-1 items-center text-text-1', showBack ? 'text-md' : 'pl-2 text-xl', !titleNode && 'truncate')}>{titleNode ?? title}</h1>
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center">
          {actions}
          {isHome ? (
            <>
              <IconButton to="/search" label="Search" linkProps={searchNav}>
                <SearchIcon size={22} />
              </IconButton>
              <IconButton to="/messages" label="Messages" badge={chats} linkProps={messagesNav}>
                <Inbox size={22} />
              </IconButton>
              <IconButton to="/notifications" label="Notifications" badge={notifications} linkProps={notificationsNav}>
                <Bell size={22} />
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
    <nav aria-label="Sections" className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-30 border-b border-line bg-bg/90 backdrop-blur-xl lg:top-14">
      <div className="mx-auto max-w-[1200px] px-2 md:px-4 lg:px-6">
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
          'relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-sm text-2xs font-semibold transition-colors dur-1',
          active ? 'text-brand-text dark:text-brand' : 'text-text-2 hover:text-text-1',
        )}
      >
        <span className="relative">
          <Icon size={24} />
          {key === 'home' && badge ? <CountBadge value={badge} className="absolute -right-2.5 -top-1.5" /> : null}
        </span>
        <span>{label}</span>
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

/* ================================================================== shell */

/** Chunks worth having before the user asks: the five tab roots. */
const TAB_ROOT_PATHS = TABS.map((t) => t.to);

export default function Layout({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const meta = useMemo(() => routeMeta(pathname), [pathname]);
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

  return (
    <div className="min-h-dvh bg-bg text-text-1 lg:flex">
      <SkipLink />
      <NavProgress />
      <Sidebar meta={navMeta} chats={chats} notifications={notifications} liveEnabled={liveEnabled} />

      <div className="min-w-0 flex-1 overflow-x-clip">
        {!shellChrome?.hideTopBar ? (
          <>
            <MobileTopBar meta={shellMeta} title={title} titleNode={shellChrome?.titleNode} back={shellChrome?.back} actions={shellChrome?.actions} chats={chats} notifications={notifications} />
            <DesktopTopBar notifications={notifications} />
          </>
        ) : null}
        <OfflineBanner />
        {hub ? <SectionTabs hub={hub} pathname={shellPath} chats={chats} notifications={notifications} liveEnabled={liveEnabled} /> : null}

        {/* Feed-width pages centre a 600 px column from tablets up (a 720 px
            4:5 photo was 900 px tall); the rail joins at lg. */}
        <div className={cx('mx-auto flex w-full gap-8 px-4 md:px-6 lg:px-8', feedWidth ? 'max-w-[62rem] justify-center' : 'max-w-[1200px]')}>
          <main id="main" tabIndex={-1} className={cx('min-w-0 flex-1 pt-4 outline-none lg:pt-6', shellChrome?.hideBottomNav ? 'pb-6' : 'pb-nav lg:pb-10', feedWidth && 'md:max-w-feed')}>
            <Suspense fallback={<RouteFallback />}>
              <RouteErrorBoundary>{waiting ? <PageSkeleton /> : (children ?? <Outlet />)}</RouteErrorBoundary>
            </Suspense>
          </main>
          {rail ? (
            <aside aria-label="Highlights" className="hidden w-72 shrink-0 pt-6 lg:block xl:w-80">
              <div className="sticky top-20 space-y-4">{rail}</div>
            </aside>
          ) : null}
        </div>
      </div>

      {!shellChrome?.hideBottomNav ? <BottomNav meta={navMeta} homeBadge={homeBadge} /> : null}
      <LogSheet />
    </div>
  );
}
