import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { PublicUser } from '../lib/hooks';
import {
  Avatar,
  Brand,
  BrandMark,
  Button,
  ButtonLink,
  Chip,
  CountBadge,
  IconButton,
  Menu,
  Modal,
  SearchField,
  Skeleton,
  Tabs,
  cx,
  formatStat,
  useOnline,
  usePageChromeStore,
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
 * The API has no unread-count endpoint for notifications, so the first page
 * is counted. Invalidating `['notifications']` (what the page does when it
 * marks read) refreshes this too.
 */
export function useUnreadNotifications(enabled = true) {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const { data } = await api.get('/notifications', { params: { page: 1, limit: 20 } });
      const list: Array<{ isRead?: boolean; read?: boolean }> = data.notifications || [];
      const count = list.filter((n) => !(n.isRead ?? n.read ?? false)).length;
      return { count, more: !!data.hasNextPage && count === list.length && count > 0 };
    },
    refetchInterval: 60_000,
    enabled,
  });
}

const badgeText = (n?: number, more?: boolean): string | number | null => (!n ? null : more ? `${n}+` : n);

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
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-xs font-semibold text-warning-text">
      <WifiOff size={16} />
      You’re offline — showing what’s already loaded.
    </div>
  );
}

function SearchBox({ className }: { className?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');

  useEffect(() => {
    if (location.pathname !== '/search') setQ('');
  }, [location.pathname]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = q.trim();
    if (!value) return;
    navigate(`/search?q=${encodeURIComponent(value)}`, { viewTransition: true });
  };

  return (
    <form onSubmit={submit} role="search" className={className}>
      <SearchField
        label="Search"
        hideLabel
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people, workouts, meals…"
        className="h-10 min-h-10"
      />
    </form>
  );
}

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
          <BrandMark size={20} />
        </span>
      </button>
    );
  }
  return (
    <Button variant="primary" block onClick={() => setOpen(true)} icon={<BrandMark size={18} />} className={className}>
      <span className="hidden xl:inline">Log</span>
    </Button>
  );
}

function LogSheet() {
  const open = useLogSheet((s) => s.open);
  const setOpen = useLogSheet((s) => s.setOpen);
  const { pathname } = useLocation();
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
              onClick={() => setOpen(false)}
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

function AccountMenu({ align = 'end' }: { align?: 'start' | 'end' }) {
  const { user, logout } = useAuth();
  const items: MenuItem[] = [
    { label: 'Profile', icon: <User size={18} />, to: '/profile' },
    { label: 'Settings', icon: <Settings size={18} />, to: '/settings' },
    { label: 'Appearance', description: 'System, light or dark', icon: <Palette size={18} />, to: '/settings#appearance' },
    { label: 'Support', icon: <LifeBuoy size={18} />, to: '/support' },
    { label: 'Log out', icon: <LogOut size={18} />, onSelect: logout, danger: true, divider: true },
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
  return (
    <Link
      to={to}
      viewTransition
      aria-current={active ? 'page' : undefined}
      title={label}
      className={cx(
        'relative flex h-11 items-center justify-center gap-3 rounded-sm px-3 text-sm font-semibold transition-colors dur-1 xl:justify-start',
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

function Sidebar({ meta, chats, notifications }: { meta: RouteMeta; chats: string | number | null; notifications: string | number | null }) {
  const { user } = useAuth();
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
      <nav aria-label="Primary" className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-3 xl:px-4">
        {SIDEBAR.map((group, gi) => (
          <div key={group.label ?? gi} className={cx(gi > 0 && 'mt-4 border-t border-line pt-3 xl:border-0 xl:pt-1')}>
            {group.label ? <p className="type-label mb-1 hidden px-3 text-text-3 xl:block">{group.label}</p> : null}
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
        <ul className="space-y-0.5">
          <li>
            <SideLink item={{ to: '/settings', label: 'Settings', Icon: Settings }} active={meta.nav === '/settings'} badge={null} />
          </li>
          <li>
            <SideLink item={{ to: '/support', label: 'Support', Icon: LifeBuoy }} active={meta.nav === '/support'} badge={null} />
          </li>
        </ul>
        <div className="mt-3 flex items-center justify-center gap-3 xl:justify-start">
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
  return (
    <header className="vt-header sticky top-0 z-40 hidden h-14 items-center gap-4 border-b border-line bg-bg/85 px-6 backdrop-blur-xl lg:flex xl:px-8">
      <SearchBox className="w-full max-w-md" />
      <div className="ml-auto flex items-center gap-1">
        <IconButton to="/notifications" label="Notifications" badge={notifications}>
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
  back,
  actions,
  chats,
  notifications,
}: {
  meta: RouteMeta;
  title: string;
  back: boolean | string | undefined;
  actions: ReactNode;
  chats: string | number | null;
  notifications: string | number | null;
}) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const isHome = meta.pattern === '/';
  const showBack = typeof back === 'string' || back === true || (back === undefined && !meta.root && !meta.hub && !isHome);

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
    { label: 'Log out', icon: <LogOut size={18} />, onSelect: logout, danger: true, divider: true },
  ];

  return (
    <header className="vt-header safe-top sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-xl lg:hidden">
      <div className="flex h-12 items-center gap-1 px-2">
        {isHome ? (
          <Link to="/" viewTransition className="inline-flex h-11 items-center rounded-sm px-2" aria-label="Vybe home">
            <Brand size="sm" />
          </Link>
        ) : (
          <>
            {showBack ? (
              <IconButton label="Back" onClick={goBack}>
                <ArrowLeft size={22} />
              </IconButton>
            ) : null}
            <h1 className={cx('type-heading min-w-0 flex-1 truncate text-text-1', showBack ? 'text-md' : 'pl-2 text-xl')}>{title}</h1>
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center">
          {actions}
          {isHome ? (
            <>
              <IconButton to="/search" label="Search">
                <SearchIcon size={22} />
              </IconButton>
              <IconButton to="/messages" label="Messages" badge={chats}>
                <Inbox size={22} />
              </IconButton>
              <IconButton to="/notifications" label="Notifications" badge={notifications}>
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

function SectionTabs({ hub, pathname, chats, notifications }: { hub: HubKey; pathname: string; chats: string | number | null; notifications: string | number | null }) {
  const tabs = HUBS[hub].map((t) => ({
    key: t.to,
    label: t.label,
    to: t.to,
    badge:
      t.badge === 'chats' && chats ? <CountBadge value={chats} className="ring-0" /> : t.badge === 'notifications' && notifications ? <CountBadge value={notifications} className="ring-0" /> : undefined,
  }));
  const active = tabs.find((t) => t.key === pathname)?.key ?? tabs.find((t) => pathname.startsWith(`${t.key}/`))?.key ?? '';
  return (
    <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-30 border-b border-line bg-bg/90 backdrop-blur-xl lg:top-14">
      <div className="mx-auto max-w-[1200px] px-2 md:px-4 lg:px-6">
        <Tabs tabs={tabs} active={active} className="border-b-0" aria-label="Sections" />
      </div>
    </div>
  );
}

function BottomNav({ meta, homeBadge }: { meta: RouteMeta; homeBadge: string | number | null }) {
  return (
    <nav aria-label="Primary" className="vt-nav safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-1/95 backdrop-blur-xl lg:hidden">
      <ul className="mx-auto flex h-14 max-w-lg items-stretch justify-around px-1">
        {TABS.map(({ key, to, label, Icon }) => {
          const active = meta.tab === key;
          return (
            <li key={key} className="flex flex-1">
              <Link
                to={to}
                viewTransition
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-sm text-2xs font-semibold transition-colors dur-1',
                  active ? 'text-brand-text dark:text-brand' : 'text-text-2 hover:text-text-1',
                )}
              >
                <span className="relative">
                  <Icon size={24} />
                  {key === 'home' && homeBadge ? <CountBadge value={homeBadge} className="absolute -right-2.5 -top-1.5" /> : null}
                </span>
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
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

export function DefaultRail() {
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
          {[
            { to: '/challenges', label: 'Challenges', Icon: Zap },
            { to: '/live', label: 'Live', Icon: Radio },
            { to: '/stories', label: 'Stories', Icon: Sparkles },
            { to: '/communities', label: 'Communities', Icon: Globe },
            { to: '/achievements', label: 'Achievements', Icon: Award },
            { to: '/friends', label: 'Friends', Icon: Users },
          ].map(({ to, label, Icon }) => (
            <li key={to}>
              <Link to={to} viewTransition className="flex min-h-11 items-center gap-2 rounded-sm px-2 text-sm font-medium text-text-2 transition-colors dur-1 hover:bg-surface-2 hover:text-text-1">
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

export default function Layout({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const meta = useMemo(() => routeMeta(pathname), [pathname]);
  const storedChrome = usePageChromeStore((s) => s.chrome);
  const chrome = storedChrome && storedChrome.path === pathname ? storedChrome : null;
  const { user } = useAuth();

  const unreadChats = useUnreadChats(!!user);
  const unreadNotifs = useUnreadNotifications(!!user);
  const chats = badgeText(unreadChats.data);
  const notifications = badgeText(unreadNotifs.data?.count, unreadNotifs.data?.more);
  const homeTotal = (unreadChats.data ?? 0) + (unreadNotifs.data?.count ?? 0);
  const homeBadge = badgeText(homeTotal, unreadNotifs.data?.more);

  const title = chrome?.title || meta.title;
  useEffect(() => {
    document.title = pathname === '/' ? 'Vybe' : `${title} · Vybe`;
  }, [title, pathname]);

  const hub = meta.hub && !meta.hideTabs && !chrome?.hideSectionTabs ? meta.hub : null;
  const rail: ReactNode = chrome && 'rail' in chrome && chrome.rail !== undefined ? chrome.rail : meta.rail ? <DefaultRail /> : null;
  const feedWidth = !!rail && !chrome?.wide;

  return (
    <div className="min-h-dvh bg-bg text-text-1 lg:flex">
      <SkipLink />
      <Sidebar meta={meta} chats={chats} notifications={notifications} />

      <div className="min-w-0 flex-1 overflow-x-clip">
        {!chrome?.hideTopBar ? (
          <>
            <MobileTopBar meta={meta} title={title} back={chrome?.back} actions={chrome?.actions} chats={chats} notifications={notifications} />
            <DesktopTopBar notifications={notifications} />
          </>
        ) : null}
        <OfflineBanner />
        {hub ? <SectionTabs hub={hub} pathname={pathname} chats={chats} notifications={notifications} /> : null}

        <div className={cx('mx-auto flex w-full gap-8 px-4 md:px-6 lg:px-8', feedWidth ? 'max-w-[62rem] justify-center' : 'max-w-[1200px]')}>
          <main id="main" tabIndex={-1} className={cx('min-w-0 flex-1 pt-4 outline-none lg:pt-6', chrome?.hideBottomNav ? 'pb-6' : 'pb-nav lg:pb-10', feedWidth && 'lg:max-w-feed')}>
            {children ?? <Outlet />}
          </main>
          {rail ? (
            <aside aria-label="Highlights" className="hidden w-72 shrink-0 pt-6 lg:block xl:w-80">
              <div className="sticky top-20 space-y-4">{rail}</div>
            </aside>
          ) : null}
        </div>
      </div>

      {!chrome?.hideBottomNav ? <BottomNav meta={meta} homeBadge={homeBadge} /> : null}
      <LogSheet />
    </div>
  );
}
