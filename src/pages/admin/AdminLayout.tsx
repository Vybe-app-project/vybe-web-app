import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { plural } from '../../lib/format';
import {
  Avatar,
  Badge,
  BrandMark,
  Button,
  CountBadge,
  IconButton,
  Skeleton,
  ThemeControl,
  cx,
} from '../../components/ui';
import {
  Shield,
  Dashboard,
  Users,
  FileText,
  Flag,
  LifeBuoy,
  Award,
  Dumbbell,
  List,
  Server,
  LogOut,
  Menu,
  X,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Zap,
} from '../../components/icons';
import { TimeStamp } from './adminCards';
import '../../styles.admin.css';

type AdminIdentity = {
  _id?: string;
  fullName?: string;
  email?: string;
  role?: string;
  createdAt?: string;
};

const NAV: Array<{
  to: string;
  label: string;
  Icon: ComponentType<{ size?: number | string; className?: string }>;
  end?: boolean;
  /** Only super administrators can open it; hidden from other staff once the role is known. */
  superOnly?: boolean;
  /** Which queue counts to show beside the label (useQueueCounts). */
  badge?: 'reports';
}> = [
  { to: '/admin', label: 'Dashboard', Icon: Dashboard, end: true },
  { to: '/admin/users', label: 'Users', Icon: Users },
  { to: '/admin/posts', label: 'Posts', Icon: FileText },
  { to: '/admin/reports', label: 'Reports', Icon: Flag, badge: 'reports' },
  { to: '/admin/support', label: 'Support', Icon: LifeBuoy },
  { to: '/admin/trainers', label: 'Trainers', Icon: Award },
  { to: '/admin/catalog', label: 'Catalog', Icon: Dumbbell },
  { to: '/admin/admins', label: 'Admins', Icon: Shield },
  { to: '/admin/audit', label: 'Audit log', Icon: List, superOnly: true },
  { to: '/admin/system', label: 'System', Icon: Server },
  { to: '/admin/flags', label: 'Feature flags', Icon: Zap },
];

/* ------------------------------------------------------------ shared bits */

/**
 * Puts the console token layer (src/styles.admin.css) on <html> while an
 * admin surface is mounted, so portalled dialogs/menus/toasts theme with it.
 */
export function useAdminScope() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('admin-console');
    return () => root.classList.remove('admin-console');
  }, []);
}

/** The one page-title treatment in the console; also sets the tab title. */
export function AdminPageHeader({
  title,
  subtitle,
  actions,
  meta,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Small trailing fact, e.g. a total count badge. */
  meta?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Vybe staff`;
  }, [title]);
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="type-heading text-xl text-text-1">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-prose text-sm text-text-2">{subtitle}</p> : null}
      </div>
      {actions || meta ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {meta}
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/** Paginator footer shared by every list page. */
export function Pager({
  page,
  totalPages,
  canPrev,
  canNext,
  onPrev,
  onNext,
  label,
  busy = false,
  className,
}: {
  page: number;
  totalPages?: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  label: ReactNode;
  busy?: boolean;
  className?: string;
}) {
  return (
    <nav
      aria-label="Pagination"
      className={cx('flex flex-wrap items-center justify-between gap-3', className)}
    >
      <p className="tabular text-xs text-text-2">{label}</p>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          icon={<ChevronLeft size={16} />}
          disabled={!canPrev || busy}
          onClick={onPrev}
        >
          Previous
        </Button>
        <span className="tabular min-w-14 px-1 text-center text-xs font-semibold text-text-2">
          {totalPages ? `${page} / ${totalPages}` : `Page ${page}`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          iconRight={<ChevronRight size={16} />}
          disabled={!canNext || busy}
          onClick={onNext}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

/**
 * A timestamp with its zone and the ISO form as a tooltip, so two staff in
 * different zones read the same record identically (see lib/format.ts).
 */
export function Stamp({
  iso,
  seconds = false,
  dateOnly = false,
  className,
}: {
  iso?: string | number | Date | null;
  seconds?: boolean;
  dateOnly?: boolean;
  className?: string;
}) {
  // The implementation lives in adminCards.tsx so the prop-driven cards can
  // render under node --test without this file's stylesheet import.
  return <TimeStamp iso={iso} seconds={seconds} dateOnly={dateOnly} className={className} />;
}

/** GET /admins/me -> { success, data: { admin } } */
export function useCurrentAdmin() {
  return useQuery<AdminIdentity>({
    queryKey: ['admin', 'me'],
    queryFn: async () => {
      const { data } = await adminApi.get('/admins/me');
      return data?.data?.admin ?? data?.admin ?? data ?? {};
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Sidebar queue counts. There is no count route; the cheapest truthful
 * source is the list total with one row each: GET /admin/reports
 * ?status=pending&limit=1 and ?appeal=open&limit=1 (each is a find, a
 * countDocuments and one locateTarget for the single row). Polled every
 * minute while the tab is visible, never retried, silent on failure: the
 * sidebar is not the place for a toast. Reports mutations invalidate
 * ['admin', 'queue'] so a decision updates the badge at once.
 */
export function useQueueCounts(enabled = true) {
  return useQuery<{ pending: number; appeals: number }>({
    queryKey: ['admin', 'queue'],
    queryFn: async () => {
      const [pending, appeals] = await Promise.all([
        adminApi.get('/admin/reports', { params: { status: 'pending', limit: 1 } }),
        adminApi.get('/admin/reports', { params: { appeal: 'open', limit: 1 } }),
      ]);
      return { pending: Number(pending.data?.total) || 0, appeals: Number(appeals.data?.total) || 0 };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
    enabled,
  });
}

/* ------------------------------------------------------------------ shell */

export default function AdminLayout() {
  useAdminScope();
  const location = useLocation();
  const adminLogout = useAuth((s) => s.adminLogout);
  const storeAdmin = useAuth((s) => s.admin) as AdminIdentity | null;
  const { data, isLoading } = useCurrentAdmin();
  const queue = useQueueCounts();
  const [open, setOpen] = useState(false);

  const me: AdminIdentity = data ?? storeAdmin ?? {};
  const isSuper = me.role === 'SUPER_ADMIN';
  const roleLabel = me.role ? String(me.role).replace(/_/g, ' ').toLowerCase() : 'staff';
  // Super-admin-only sections are hidden from other staff once the role is
  // known; while it loads everything stays visible so a super admin never
  // sees entries appear late.
  const visibleNav = NAV.filter((item) => !item.superOnly || !me.role || isSuper);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const sidebar = (
    <div className="flex h-full flex-col bg-surface-1">
      <div className="flex items-center gap-3 border-b border-line px-4 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-brand-soft text-brand">
          <BrandMark size={22} />
        </div>
        <div className="min-w-0">
          <p className="type-heading text-md leading-tight text-text-1">Vybe</p>
          <p className="admin-signature">Staff console</p>
        </div>
        <IconButton
          label="Close navigation"
          size={40}
          className="ml-auto lg:hidden"
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </IconButton>
      </div>

      <nav aria-label="Console sections" className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {visibleNav.map(({ to, label, Icon, end, badge }) => {
          const pending = badge === 'reports' ? queue.data?.pending ?? 0 : 0;
          const appeals = badge === 'reports' ? queue.data?.appeals ?? 0 : 0;
          const counted = [
            pending > 0 ? plural(pending, 'pending report') : null,
            appeals > 0 ? plural(appeals, 'open appeal') : null,
          ].filter(Boolean);
          return (
            <NavLink key={to} to={to} end={end === true} className="admin-nav-link">
              <Icon size={18} className="shrink-0" />
              <span className="truncate">{label}</span>
              {counted.length > 0 ? (
                <span className="ml-auto flex shrink-0 items-center gap-1" aria-hidden="true">
                  {pending > 0 ? <span title="Pending reports"><CountBadge value={pending} /></span> : null}
                  {appeals > 0 ? (
                    <span title="Open appeals" className="[&>span]:bg-warning">
                      <CountBadge value={appeals} />
                    </span>
                  ) : null}
                </span>
              ) : null}
              {counted.length > 0 ? <span className="sr-only">{counted.join(', ')}</span> : null}
            </NavLink>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-line p-3">
        {isLoading && !me.email ? (
          <div className="space-y-2 px-1 py-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-sm bg-surface-2 px-2.5 py-2">
            <Avatar name={me.fullName || me.email || 'Admin'} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text-1">
                {me.fullName || 'Administrator'}
              </p>
              <p className="truncate text-xs text-text-2">{me.email || 'Signed in'}</p>
            </div>
            <Badge tone={isSuper ? 'warning' : 'neutral'} size="sm" className="capitalize">
              {roleLabel}
            </Badge>
          </div>
        )}

        <ThemeControl label="Console appearance" iconOnly />

        <div className="flex items-center justify-between gap-2">
          <a
            href="/"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-sm px-2 text-xs font-semibold text-text-2 hover:bg-surface-2 hover:text-text-1"
          >
            <ExternalLink size={14} /> Member app
          </a>
          <Button size="sm" variant="ghost" icon={<LogOut size={16} />} onClick={adminLogout}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-bg text-text-1">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Console navigation">
          <div
            className="anim-fade-in absolute inset-0 bg-scrim"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="anim-fade-in absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line shadow-3">
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface-1 px-3 lg:hidden">
          <IconButton label="Open navigation" onClick={() => setOpen(true)}>
            <Menu size={22} />
          </IconButton>
          <span className="inline-flex items-center gap-2">
            <BrandMark size={20} className="text-brand" />
            <span className="type-heading text-md text-text-1">Vybe</span>
            <span className="admin-signature">Staff</span>
          </span>
          <IconButton label="Sign out" className="ml-auto" onClick={adminLogout}>
            <LogOut size={20} />
          </IconButton>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
