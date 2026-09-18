import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, errMsg } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Menu,
  Modal,
  Select,
  Skeleton,
  cx,
  useIsCompact,
  useToast,
} from '../../components/ui';
import { Shield, Plus, Trash, Edit, Lock, Users, Eye } from '../../components/icons';
import { AdminPageHeader, Stamp, useCurrentAdmin } from './AdminLayout';

type Admin = {
  _id: string;
  fullName?: string;
  email?: string;
  role?: 'ADMIN' | 'SUPER_ADMIN';
  createdAt?: string;
  updatedAt?: string;
  lastLogin?: string;
};

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Admin', description: 'Moderation, support and content tools.' },
  { value: 'SUPER_ADMIN', label: 'Super admin', description: 'Everything, plus staff accounts and the audit log.' },
];

const roleLabel = (r?: string) => (r === 'SUPER_ADMIN' ? 'Super admin' : r === 'ADMIN' ? 'Admin' : r ? r.replace(/_/g, ' ') : '—');

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
  const compact = useIsCompact();

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
      const raw = Array.isArray(data) ? data : data?.data?.admins ?? data?.admins ?? [];
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

  // The role comes from GET /admins/me (unwrapped by useCurrentAdmin), with
  // the sign-in payload as the fallback while that request is in flight.
  const identity = useCurrentAdmin();
  const me = ((identity.data && identity.data._id ? identity.data : null) ?? currentAdmin) as Admin | null;
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';

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
      toast.success('Password changed. Sign in again to continue.');
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
      setTimeout(() => adminLogout(), 1200);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const pwIssues = pwForm.newPassword ? passwordProblems(pwForm.newPassword) : [];
  const pwMismatch = Boolean(pwForm.confirm) && pwForm.newPassword !== pwForm.confirm;
  const editUnchanged =
    !!editing &&
    editForm.fullName.trim() === (editing.fullName ?? '') &&
    editForm.email.trim() === (editing.email ?? '') &&
    editForm.role === (editing.role ?? 'ADMIN');

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Administrators"
        subtitle="Staff accounts and your own password."
        actions={
          isSuperAdmin ? (
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setAddOpen(true)}>
              Add admin
            </Button>
          ) : undefined
        }
      />

      {!isSuperAdmin ? (
        <Callout tone="info" icon={<Shield size={20} className="text-text-2" />} title="Super admin only">
          Listing and managing other administrators needs the super admin role. You can still change
          your own password below.
        </Callout>
      ) : null}

      {isSuperAdmin ? (
        <Card padded={false} className="overflow-hidden">
          {list.isError ? (
            <ErrorState
              title="Could not load administrators"
              error={list.error}
              retry={() => { void list.refetch(); }}
            />
          ) : list.isLoading ? (
            <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading administrators">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          ) : admins.length === 0 ? (
            <EmptyState
              icon={<Users size={24} />}
              title="No administrators yet"
              message="Add a staff account so someone besides you can run the console."
              action={{ label: 'Add admin', onClick: () => setAddOpen(true), icon: <Plus size={18} /> }}
            />
          ) : (
            <ul className="divide-y divide-line">
              {admins.map((a) => {
                const isSelf = a._id === me?._id;
                const name = a.fullName || 'Unnamed';
                const startEdit = () => {
                  setEditing(a);
                  setEditForm({
                    fullName: a.fullName ?? '',
                    email: a.email ?? '',
                    role: a.role ?? 'ADMIN',
                  });
                };
                return (
                  // Three inline buttons squeezed the text to ~20 px on a phone
                  // ("V." / "a.."). The text block is the one flexible track;
                  // under md the actions collapse into an overflow menu.
                  <li key={a._id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={a.fullName || a.email} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate font-semibold text-text-1">{name}</span>
                        <Badge tone={a.role === 'SUPER_ADMIN' ? 'warning' : 'neutral'} size="sm">
                          {roleLabel(a.role)}
                        </Badge>
                        {isSelf ? <Badge tone="info" size="sm">You</Badge> : null}
                      </div>
                      <div className="truncate text-xs text-text-2">{a.email}</div>
                    </div>
                    {compact ? (
                      <Menu
                        label={`Actions for ${name}`}
                        items={[
                          { key: 'view', label: 'View', icon: <Eye size={16} />, onSelect: () => setViewingId(a._id) },
                          { key: 'edit', label: 'Edit', icon: <Edit size={16} />, onSelect: startEdit },
                          {
                            key: 'remove',
                            label: 'Remove',
                            icon: <Trash size={16} />,
                            danger: true,
                            disabled: isSelf,
                            description: isSelf ? 'You cannot remove your own account' : undefined,
                            onSelect: () => setDeleting(a),
                          },
                        ]}
                      />
                    ) : (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" icon={<Eye size={16} />} onClick={() => setViewingId(a._id)} aria-label={`View ${name}`}>
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Edit size={16} />}
                        aria-label={`Edit ${name}`}
                        onClick={startEdit}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<Trash size={16} />}
                        disabled={isSelf}
                        title={isSelf ? 'You cannot remove your own account' : undefined}
                        aria-label={`Remove ${name}`}
                        onClick={() => setDeleting(a)}
                      >
                        Remove
                      </Button>
                    </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={<span className="inline-flex items-center gap-2"><Lock size={18} className="text-text-2" /> Change my password</span>}
          subtitle="Changing your password signs out every active session, including this one."
        />
        <form
          className="grid gap-4 sm:max-w-md"
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
            hint="At least 12 characters with upper and lower case, a number and a symbol."
            error={pwIssues.length > 0 ? `Still needs ${pwIssues.join(', ')}.` : undefined}
          />
          <Input
            type="password"
            label="Confirm new password"
            autoComplete="new-password"
            value={pwForm.confirm}
            onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
            error={pwMismatch ? 'Passwords do not match.' : undefined}
          />
          <div>
            <Button
              type="submit"
              variant="primary"
              loading={changePassword.isPending}
              disabled={!pwForm.currentPassword || pwIssues.length > 0 || pwMismatch || !pwForm.confirm}
            >
              Change password
            </Button>
          </div>
        </form>
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add administrator"
        description="They sign in with this temporary password and should change it on first use."
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="admin-add-form"
              variant="primary"
              loading={add.isPending}
              disabled={!form.fullName.trim() || !form.email.trim() || passwordProblems(form.password).length > 0}
            >
              Create account
            </Button>
          </>
        }
      >
        <form
          id="admin-add-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input
            label="Full name"
            autoComplete="off"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
          <Input
            type="email"
            label="Email"
            autoComplete="off"
            inputMode="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            type="password"
            label="Temporary password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            hint="At least 12 characters with upper and lower case, a number and a symbol."
            error={
              form.password && passwordProblems(form.password).length > 0
                ? `Still needs ${passwordProblems(form.password).join(', ')}.`
                : undefined
            }
          />
          <Select
            label="Role"
            options={ROLE_OPTIONS}
            value={form.role}
            onChange={(role) => setForm({ ...form, role })}
          />
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.fullName || 'administrator'}`}
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="admin-edit-form" variant="primary" loading={update.isPending} disabled={editUnchanged}>
              Save changes
            </Button>
          </>
        }
      >
        <form
          id="admin-edit-form"
          className="grid gap-4"
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
            inputMode="email"
            value={editForm.email}
            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
          />
          <Select
            label="Role"
            options={ROLE_OPTIONS}
            value={editForm.role}
            onChange={(role) => setEditForm({ ...editForm, role })}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove administrator"
        message={
          <>
            <strong className="text-text-1">{deleting?.email ?? 'This account'}</strong> loses all
            console access immediately. This is recorded in the audit log.
          </>
        }
        confirmLabel="Remove access"
        destructive
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting._id)}
      />

      <Modal open={Boolean(viewingId)} onClose={() => setViewingId(null)} title="Administrator details">
        {detail.isLoading ? (
          <div className="grid gap-2 sm:grid-cols-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : detail.isError ? (
          <ErrorState
            title="Could not load this administrator"
            error={detail.error}
            retry={() => { void detail.refetch(); }}
          />
        ) : (
          <dl className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['Full name', detail.data?.fullName || '—', false],
                ['Email', detail.data?.email || '—', false],
                ['Role', roleLabel(detail.data?.role), false],
                ['Admin ID', detail.data?._id || '—', true],
                ['Created', <Stamp iso={detail.data?.createdAt} />, false],
                ['Last updated', <Stamp iso={detail.data?.updatedAt} />, false],
              ] as Array<[string, ReactNode, boolean]>
            ).map(([label, value, mono]) => (
              <div key={label} className="admin-kv">
                <dt>{label}</dt>
                <dd className={cx(mono && 'admin-code')}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Modal>
    </div>
  );
}
