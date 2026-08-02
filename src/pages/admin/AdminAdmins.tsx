import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, errMsg } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  useToast,
} from '../../components/ui';
import { Shield, Plus, Trash, Edit, Lock, Users, Eye } from '../../components/icons';

type Admin = {
  _id: string;
  fullName?: string;
  email?: string;
  role?: 'ADMIN' | 'SUPER_ADMIN';
  createdAt?: string;
  updatedAt?: string;
  lastLogin?: string;
};

const ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;

/** Mirrors the server's strongPassword validator so we fail before the request. */
function passwordProblems(pw: string): string[] {
  const problems: string[] = [];
  if (pw.length < 12 || pw.length > 128) problems.push('12–128 characters');
  if (!/[a-z]/.test(pw)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) problems.push('an uppercase letter');
  if (!/[0-9]/.test(pw)) problems.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) problems.push('a symbol');
  return problems;
}

export default function AdminAdmins() {
  const qc = useQueryClient();
  const toast = useToast();
  const { admin: currentAdmin, adminLogout } = useAuth();

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Admin | null>(null);
  const [deleting, setDeleting] = useState<Admin | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'ADMIN' });
  const [editForm, setEditForm] = useState({ fullName: '', email: '', role: 'ADMIN' });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });

  // GET /admins answers { success, data: { admins, count } }; older builds
  // returned a bare array or { admins }, so all three shapes are unwrapped.
  const list = useQuery<Admin[]>({
    queryKey: ['admin', 'admins'],
    queryFn: async () => {
      const { data } = await adminApi.get('/admins');
      const raw = Array.isArray(data)
        ? data
        : data?.data?.admins ?? data?.admins ?? [];
      return Array.isArray(raw) ? raw : [];
    },
  });

  const admins: Admin[] = list.data ?? [];

  // GET /admins/:id — full record for a single staff account.
  const detail = useQuery<Admin>({
    queryKey: ['admin', 'admins', viewingId],
    enabled: Boolean(viewingId),
    queryFn: async () => {
      const { data } = await adminApi.get(`/admins/${viewingId}`);
      return data?.data?.admin ?? data?.admin ?? data ?? {};
    },
  });

  const isSuperAdmin = (currentAdmin as Admin | null)?.role === 'SUPER_ADMIN';

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'admins'] });

  const add = useMutation({
    mutationFn: async () => {
      // The route uses a strict body allowlist (fullName, email, password,
      // role) and rejects anything else, so only those fields are sent.
      const { data } = await adminApi.post('/admins/add', {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Administrator created');
      setAddOpen(false);
      setForm({ fullName: '', email: '', password: '', role: 'ADMIN' });
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editing) return null;
      // PUT /:id requires at least one of fullName/email/role and rejects
      // unknown keys, so only changed fields are included.
      const body: Record<string, string> = {};
      if (editForm.fullName.trim() && editForm.fullName.trim() !== editing.fullName) {
        body.fullName = editForm.fullName.trim();
      }
      if (editForm.email.trim() && editForm.email.trim() !== editing.email) {
        body.email = editForm.email.trim();
      }
      if (editForm.role && editForm.role !== editing.role) body.role = editForm.role;
      if (Object.keys(body).length === 0) {
        throw new Error('Change at least one field before saving');
      }
      const { data } = await adminApi.put(`/admins/${editing._id}`, body);
      return data;
    },
    onSuccess: () => {
      toast.success('Administrator updated');
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => (await adminApi.delete(`/admins/${id}`)).data,
    onSuccess: () => {
      toast.success('Administrator removed');
      setDeleting(null);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const { data } = await adminApi.put('/admins/change-password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      return data;
    },
    onSuccess: () => {
      // A successful change bumps the account's session version, which
      // invalidates EVERY existing bearer token including the one that made
      // this request. Staying on the page would only produce 401s.
      toast.success('Password changed — sign in again');
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
      setTimeout(() => adminLogout(), 1200);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const pwIssues = pwForm.newPassword ? passwordProblems(pwForm.newPassword) : [];
  const pwMismatch = Boolean(pwForm.confirm) && pwForm.newPassword !== pwForm.confirm;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Administrators</h1>
          <p className="text-sm text-[var(--color-muted)] mt-1">
            Manage staff accounts and your own password.
          </p>
        </div>
        {isSuperAdmin && (
          <Button icon={<Plus />} onClick={() => setAddOpen(true)}>Add admin</Button>
        )}
      </div>

      {!isSuperAdmin && (
        <Card className="p-4 flex items-start gap-3">
          <Shield />
          <p className="text-sm text-[var(--color-muted)]">
            Listing and managing other administrators requires a{' '}
            <span className="text-[#e8e8ee]">SUPER_ADMIN</span> role. You can still
            change your own password below.
          </p>
        </Card>
      )}

      {isSuperAdmin && (
        <>
          {list.isError && (
            <ErrorState
              title="Could not load administrators"
              error={list.error}
              retry={() => { void list.refetch(); }}
            />
          )}

          {list.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}

          {!list.isLoading && !list.isError && admins.length === 0 && (
            <EmptyState
              icon={<Users />}
              title="No administrators"
              message="Add a staff account to get started."
            />
          )}

          {admins.length > 0 && (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-[var(--color-line)]">
                {admins.map((a) => {
                  const isSelf = a._id === (currentAdmin as Admin | null)?._id;
                  return (
                    <li key={a._id} className="p-4 flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">
                            {a.fullName || 'Unnamed'}
                          </span>
                          {a.role === 'SUPER_ADMIN' && <Badge tone="brand">Super admin</Badge>}
                          {isSelf && <Badge tone="neutral">You</Badge>}
                        </div>
                        <div className="text-sm text-[var(--color-muted)] truncate">
                          {a.email}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Eye />}
                          onClick={() => setViewingId(a._id)}
                        >
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Edit />}
                          onClick={() => {
                            setEditing(a);
                            setEditForm({
                              fullName: a.fullName ?? '',
                              email: a.email ?? '',
                              role: a.role ?? 'ADMIN',
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash />}
                          disabled={isSelf}
                          title={isSelf ? 'You cannot delete your own account' : undefined}
                          onClick={() => setDeleting(a)}
                        >
                          Delete
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}

      <Card className="p-4">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <Lock /> Change my password
        </h2>
        <p className="text-sm text-[var(--color-muted)] mb-4">
          Changing your password signs out every active session, including this one.
        </p>
        <form
          className="grid gap-3 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            changePassword.mutate();
          }}
        >
          <Input
            type="password"
            label="Current password"
            autoComplete="current-password"
            value={pwForm.currentPassword}
            onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
          />
          <Input
            type="password"
            label="New password"
            autoComplete="new-password"
            value={pwForm.newPassword}
            onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
            error={pwIssues.length > 0 ? `Must include ${pwIssues.join(', ')}` : undefined}
          />
          <Input
            type="password"
            label="Confirm new password"
            autoComplete="new-password"
            value={pwForm.confirm}
            onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
            error={pwMismatch ? 'Passwords do not match' : undefined}
          />
          <div>
            <Button
              type="submit"
              loading={changePassword.isPending}
              disabled={
                !pwForm.currentPassword
                || pwIssues.length > 0
                || pwMismatch
                || !pwForm.confirm
              }
            >
              Change password
            </Button>
          </div>
        </form>
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add administrator">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input
            label="Full name"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
          <Input
            type="email"
            label="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            type="password"
            label="Temporary password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            error={
              form.password && passwordProblems(form.password).length > 0
                ? `Must include ${passwordProblems(form.password).join(', ')}`
                : undefined
            }
          />
          <label className="text-sm">
            <span className="block mb-1 font-medium">Role</span>
            <select
              className="input-base"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" type="button" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={add.isPending}
              disabled={
                !form.fullName.trim()
                || !form.email.trim()
                || passwordProblems(form.password).length > 0
              }
            >
              Create
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.fullName || 'administrator'}`}
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate();
          }}
        >
          <Input
            label="Full name"
            value={editForm.fullName}
            onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
          />
          <Input
            type="email"
            label="Email"
            value={editForm.email}
            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
          />
          <label className="text-sm">
            <span className="block mb-1 font-medium">Role</span>
            <select
              className="input-base"
              value={editForm.role}
              onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" type="button" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={update.isPending}>Save changes</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove administrator"
        message={`${deleting?.email ?? 'This account'} will lose all administrative access immediately.`}
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting._id)}
      />

      <Modal
        open={Boolean(viewingId)}
        onClose={() => setViewingId(null)}
        title="Administrator details"
      >
        {detail.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : detail.isError ? (
          <ErrorState
            title="Could not load this administrator"
            error={detail.error}
            retry={() => { void detail.refetch(); }}
          />
        ) : (
          <dl className="grid gap-2 sm:grid-cols-2">
            {([
              ['Full name', detail.data?.fullName || '—'],
              ['Email', detail.data?.email || '—'],
              ['Role', detail.data?.role ? detail.data.role.replace(/_/g, ' ') : '—'],
              ['Admin ID', detail.data?._id || '—'],
              [
                'Created',
                detail.data?.createdAt
                  ? new Date(detail.data.createdAt).toLocaleString()
                  : '—',
              ],
              [
                'Last updated',
                detail.data?.updatedAt
                  ? new Date(detail.data.updatedAt).toLocaleString()
                  : '—',
              ],
            ] as Array<[string, string]>).map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2"
              >
                <dt className="text-[11px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                  {label}
                </dt>
                <dd className="mt-1 text-sm break-all text-[#e8e8ee]">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Modal>
    </div>
  );
}
