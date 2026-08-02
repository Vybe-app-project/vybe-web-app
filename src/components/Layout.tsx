import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Avatar, cx } from './ui';
import {
  Bell,
  Compass,
  Dumbbell,
  Heart,
  Home,
  LogOut,
  MessageCircle,
  Plus,
  Search as SearchIcon,
  Settings,
  User,
  Utensils,
} from './icons';

type NavItem = {
  to: string;
  label: string;
  Icon: (p: { size?: number | string; className?: string }) => ReactNode;
  end?: boolean;
};

const NAV: NavItem[] = [
  { to: '/', label: 'Feed', Icon: Home, end: true },
  { to: '/discover', label: 'Discover', Icon: Compass },
  { to: '/workouts', label: 'Workouts', Icon: Dumbbell },
  { to: '/meals', label: 'Meals', Icon: Utensils },
  { to: '/health', label: 'Health', Icon: Heart },
  { to: '/messages', label: 'Messages', Icon: MessageCircle },
  { to: '/notifications', label: 'Notifications', Icon: Bell },
  { to: '/profile', label: 'Profile', Icon: User },
];

/** Mobile bottom bar shows the 5 most-used destinations. */
const MOBILE_NAV = NAV.filter((n) =>
  ['/', '/discover', '/workouts', '/messages', '/profile'].includes(n.to),
);

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-brand-2)] bg-clip-text',
        'text-transparent font-extrabold tracking-tight',
        className,
      )}
    >
      Vybe
    </span>
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
    navigate(`/search?q=${encodeURIComponent(value)}`);
  };

  return (
    <form onSubmit={submit} role="search" className={cx('relative', className)}>
      <SearchIcon
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
      />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people, workouts, meals…"
        aria-label="Search"
        className="input-base pl-9"
      />
    </form>
  );
}

function AvatarMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const itemCls =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-[#e8e8ee] transition-colors hover:bg-[var(--color-surface-2)]';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full outline-none ring-[var(--color-brand)] focus-visible:ring-2"
      >
        <Avatar src={user?.profilePicture} name={user?.fullName || user?.username} size="sm" />
      </button>

      {open ? (
        <div
          role="menu"
          className="card absolute right-0 top-[calc(100%+8px)] z-50 w-52 p-1.5 shadow-2xl shadow-black/60"
        >
          {user ? (
            <div className="border-b border-[var(--color-line)] px-3 py-2">
              <p className="truncate text-sm font-bold text-white">
                {user.fullName || user.username}
              </p>
              <p className="truncate text-xs text-[var(--color-muted)]">@{user.username}</p>
            </div>
          ) : null}
          <div className="pt-1.5">
            <button type="button" role="menuitem" className={itemCls} onClick={() => go('/profile')}>
              <User size={16} /> Profile
            </button>
            <button type="button" role="menuitem" className={itemCls} onClick={() => go('/settings')}>
              <Settings size={16} /> Settings
            </button>
            <button
              type="button"
              role="menuitem"
              className={cx(itemCls, 'text-red-300 hover:bg-red-500/10')}
              onClick={() => {
                setOpen(false);
                logout();
              }}
            >
              <LogOut size={16} /> Log out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function sidebarLinkCls({ isActive }: { isActive: boolean }) {
  return cx(
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
    isActive
      ? 'bg-[var(--color-brand)]/15 text-[var(--color-brand)]'
      : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-white',
  );
}

export default function Layout() {
  const navigate = useNavigate();

  return (
    <div className="min-h-full">
      {/* Top bar */}
      <header className="safe-top sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-ink)]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <NavLink to="/" className="shrink-0 text-xl lg:w-52">
            <Wordmark />
          </NavLink>

          <SearchBox className="mx-auto w-full max-w-md" />

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Create post"
              onClick={() => navigate('/create')}
              className="btn btn-primary hidden sm:inline-flex"
            >
              <Plus size={16} />
              Create
            </button>
            <AvatarMenu />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4">
        {/* Desktop sidebar */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-52 shrink-0 flex-col gap-1 overflow-y-auto py-4 lg:flex">
          <nav className="flex flex-col gap-1">
            {NAV.map(({ to, label, Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={sidebarLinkCls}>
                <Icon size={20} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto pt-4">
            <NavLink to="/settings" className={sidebarLinkCls}>
              <Settings size={20} />
              <span>Settings</span>
            </NavLink>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 pb-28 pt-4 lg:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-line)] bg-[var(--color-ink)]/95 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-2">
          {MOBILE_NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                cx(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors',
                  isActive ? 'text-[var(--color-brand)]' : 'text-[var(--color-muted)]',
                )
              }
            >
              <Icon size={22} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
