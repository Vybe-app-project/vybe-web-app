import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Avatar, Badge, IconButton, Skeleton, cx } from '../../components/ui';
import {
  Shield,
  Dashboard,
  Users,
  FileText,
  Flag,
  LifeBuoy,
  Award,
  List,
  Server,
  LogOut,
  Menu,
  X,
} from '../../components/icons';

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
}> = [
  { to: '/admin', label: 'Dashboard', Icon: Dashboard, end: true },
  { to: '/admin/users', label: 'Users', Icon: Users },
  { to: '/admin/posts', label: 'Posts', Icon: FileText },
  { to: '/admin/reports', label: 'Reports', Icon: Flag },
  { to: '/admin/support', label: 'Support', Icon: LifeBuoy },
  { to: '/admin/trainers', label: 'Trainers', Icon: Award },
  { to: '/admin/admins', label: 'Admins', Icon: Shield },
  { to: '/admin/audit', label: 'Audit Log', Icon: List },
  { to: '/admin/system', label: 'System', Icon: Server },
];

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

export default function AdminLayout() {
  const location = useLocation();
  const adminLogout = useAuth((s) => s.adminLogout);
  const storeAdmin = useAuth((s) => s.admin) as AdminIdentity | null;
  const { data, isLoading } = useCurrentAdmin();
  const [open, setOpen] = useState(false);

  const me: AdminIdentity = data ?? storeAdmin ?? {};
  const isSuper = me.role === 'SUPER_ADMIN';

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const sidebar = (
    <div className="flex h-full flex-col bg-[#080a11]">
      <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300">
          <Shield size={18} />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[13px] font-bold tracking-[0.18em] text-slate-100 uppercase">
            Vybe
          </p>
          <p className="font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">
            Staff console
          </p>
        </div>
        <IconButton
          label="Close navigation"
          className="ml-auto text-slate-400 lg:hidden"
          onClick={() => setOpen(false)}
        >
          <X size={18} />
        </IconButton>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end === true}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
                isActive
                  ? 'bg-amber-500/12 text-amber-200'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100',
              )
            }
          >
            <Icon size={17} />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-800 p-3">
        {isLoading && !me.email ? (
          <div className="space-y-2 px-1 py-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-lg bg-slate-900/60 px-2.5 py-2">
            <Avatar name={me.fullName || me.email || 'Admin'} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-slate-100">
                {me.fullName || 'Administrator'}
              </p>
              <p className="truncate text-[11px] text-slate-500">{me.email || '—'}</p>
            </div>
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <Badge tone={isSuper ? 'warning' : 'neutral'}>
            {me.role ? String(me.role).replace(/_/g, ' ') : 'STAFF'}
          </Badge>
          <button
            type="button"
            onClick={adminLogout}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#05070c] text-slate-200">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-800 lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-slate-800 shadow-2xl shadow-black/70">
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-800 bg-[#05070c]/95 px-4 py-3 backdrop-blur lg:hidden">
          <IconButton
            label="Open navigation"
            className="text-slate-300"
            onClick={() => setOpen(true)}
          >
            <Menu size={20} />
          </IconButton>
          <span className="font-mono text-xs font-bold tracking-[0.18em] text-slate-300 uppercase">
            Vybe Staff
          </span>
          <button
            type="button"
            onClick={adminLogout}
            aria-label="Sign out"
            className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut size={18} />
          </button>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
