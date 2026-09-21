import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Chip, Input, Modal, ScrollX, cx, formatStat, useToast } from '../../components/ui';
import {
  createFolder,
  createShareLink,
  fetchLinkStats,
  moveRoutineToFolder,
  programKeys,
  revokeShareLinks,
  type RoutineFolder,
  type ShareLink,
} from '../../lib/programs';
import type { SocialWorkout } from './model';

/**
 * Routine folders and share links — the two cheap halves of Wave G's routine
 * work (`int-vybe-backend/docs/api-contract.md`, "Routines").
 *
 * Folders are a filing cabinet, not a taxonomy: a routine is in one folder or
 * none, deleting a folder moves its routines back to Unfiled and deletes
 * nothing, and there is no cap. The chip row only exists once the member has
 * made a folder, so nobody is shown an organising system they never asked for.
 *
 * A share link is minted on request, shown once and stored hashed. The dialog
 * says what a link is and is not — it carries the routine, never the loads —
 * and Revoke all links is one press away, because a link you cannot take back
 * is not a link you can give out lightly.
 *
 * Both surfaces are hidden while their flag is off (`programs`,
 * `routineShareLinks`), the way the invite surfaces hide themselves.
 */

/** "All" first, then a folder per chip, then Unfiled when something is in it. */
export const ALL_FOLDERS = 'all';
export const UNFILED = 'unfiled';

export type FolderFilter = typeof ALL_FOLDERS | typeof UNFILED | string;

export type FolderChip = { key: FolderFilter; label: string; count?: number };

/** The chip row's model: pure, so what the member sees is what a test can read. */
export function folderChips(folders: readonly RoutineFolder[], unfiled: number, total?: number): FolderChip[] {
  if (!folders.length) return [];
  return [
    { key: ALL_FOLDERS, label: 'All', count: total },
    ...folders.map((folder) => ({ key: folder._id, label: folder.name, count: folder.count })),
    ...(unfiled > 0 ? [{ key: UNFILED, label: 'Unfiled', count: unfiled }] : []),
  ];
}

/** The routines a chip selects. `all` is everything; `unfiled` is everything with no folder. */
export function inFolder(workout: Pick<SocialWorkout, 'folder'>, filter: FolderFilter): boolean {
  if (filter === ALL_FOLDERS) return true;
  const folder = workout.folder ?? null;
  if (filter === UNFILED) return !folder;
  return folder === filter;
}

/** How many routines the chosen chip claims, for "Showing 3 of 8" under a filtered list. */
export function folderTotal(chips: readonly FolderChip[], filter: FolderFilter): number | undefined {
  return chips.find((chip) => chip.key === filter)?.count;
}

export function FolderChips({ chips, value, onChange, className }: { chips: readonly FolderChip[]; value: FolderFilter; onChange: (next: FolderFilter) => void; className?: string }) {
  if (!chips.length) return null;
  return (
    <ScrollX fade className={cx('-mx-1 px-1', className)}>
      <div role="group" aria-label="Folders" className="flex w-max gap-2 py-0.5">
        {chips.map((chip) => (
          <Chip key={chip.key} selected={value === chip.key} onClick={() => onChange(chip.key)}>
            {chip.label}
            {chip.count === undefined ? '' : ` ${formatStat(chip.count)}`}
          </Chip>
        ))}
      </div>
    </ScrollX>
  );
}

/* --------------------------------------------------------- move to folder */

/**
 * "Move to folder…" from a routine's row. One list, Unfiled at the top, and a
 * field to make a folder that does not exist yet — the two things a member
 * wants at this moment and nothing else.
 */
export function MoveToFolderDialog({ workout, folders, onClose }: { workout: SocialWorkout | null; folders: readonly RoutineFolder[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const open = Boolean(workout);

  useEffect(() => {
    if (!open) setName('');
  }, [open]);

  const after = () => {
    qc.invalidateQueries({ queryKey: programKeys.folders });
    qc.invalidateQueries({ queryKey: ['workouts'] });
  };

  const move = useMutation({
    mutationFn: async (folderId: string | null) => {
      if (!workout) return;
      await moveRoutineToFolder(workout._id, folderId);
    },
    onSuccess: (_result, folderId) => {
      after();
      const folder = folders.find((f) => f._id === folderId);
      toast.success(folder ? `Moved to ${folder.name}` : 'Moved to Unfiled');
      onClose();
    },
    onError: (e) => toast.error(e, 'Could not move this workout'),
  });

  const make = useMutation({
    mutationFn: async () => {
      const folder = await createFolder(name.trim());
      if (folder && workout) await moveRoutineToFolder(workout._id, folder._id);
      return folder;
    },
    onSuccess: (folder) => {
      after();
      toast.success(folder ? `Moved to ${folder.name}` : 'Folder created');
      onClose();
    },
    onError: (e) => toast.error(e, 'Could not create that folder'),
  });

  const busy = move.isPending || make.isPending;
  const current = workout?.folder ?? null;

  return (
    <Modal open={open} onClose={onClose} title="Move to folder" description={workout ? `Where “${workout.title}” is filed. The workout itself does not change.` : undefined} size="sm">
      <div className="space-y-4">
        <ul className="divide-y divide-line">
          <li>
            <button type="button" disabled={busy} className="pressable flex min-h-12 w-full items-center justify-between gap-3 rounded-sm px-1 text-left" onClick={() => move.mutate(null)}>
              <span className="t-body text-text-1">Unfiled</span>
              {current === null ? <span className="t-meta">Here now</span> : null}
            </button>
          </li>
          {folders.map((folder) => (
            <li key={folder._id}>
              <button type="button" disabled={busy} className="pressable flex min-h-12 w-full items-center justify-between gap-3 rounded-sm px-1 text-left" onClick={() => move.mutate(folder._id)}>
                <span className="t-body min-w-0 truncate text-text-1">{folder.name}</span>
                {current === folder._id ? <span className="t-meta shrink-0">Here now</span> : <span className="t-meta tabular shrink-0">{formatStat(folder.count)}</span>}
              </button>
            </li>
          ))}
        </ul>

        <form
          className="flex items-end gap-2 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) make.mutate();
          }}
        >
          <Input label="New folder" containerClassName="flex-1" placeholder="e.g. Push days" maxLength={60} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="secondary" loading={make.isPending} disabled={!name.trim() || busy}>
            Create
          </Button>
        </form>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- the link */

const expiryLine = (expiresAt: string | null): string | null => {
  if (!expiresAt) return null;
  const when = new Date(expiresAt);
  return Number.isNaN(when.getTime()) ? null : `The link stops working on ${when.toLocaleDateString()}.`;
};

/**
 * "Share link" from a routine's menu. A link is minted only when the member
 * asks for one — the server keeps at most twenty live at a time — and the
 * token is shown once, so the URL sits in a field with Copy beside it rather
 * than being fetched again later.
 */
export function ShareLinkDialog({ workout, onClose }: { workout: SocialWorkout | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [link, setLink] = useState<ShareLink | null>(null);
  const open = Boolean(workout);
  const routineId = workout?._id ?? '';

  useEffect(() => {
    if (!open) setLink(null);
  }, [open]);

  const stats = useQuery({ queryKey: programKeys.links(routineId), queryFn: () => fetchLinkStats(routineId), enabled: open && Boolean(routineId), retry: false });

  const mint = useMutation({
    mutationFn: () => createShareLink(routineId),
    onSuccess: (created) => {
      setLink(created);
      qc.invalidateQueries({ queryKey: programKeys.links(routineId) });
    },
    onError: (e) => toast.error(e, 'Could not create a link'),
  });

  const revoke = useMutation({
    mutationFn: () => revokeShareLinks(routineId),
    onSuccess: (revoked) => {
      setLink(null);
      qc.invalidateQueries({ queryKey: programKeys.links(routineId) });
      toast.success(revoked === 1 ? '1 link revoked' : `${formatStat(revoked)} links revoked`);
    },
    onError: (e) => toast.error(e, 'Could not revoke the links'),
  });

  const copy = async () => {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success('Link copied');
    } catch {
      toast.error(null, 'Could not copy the link');
    }
  };

  const active = link?.activeLinks ?? stats.data?.activeLinks ?? 0;
  const expires = expiryLine(link?.expiresAt ?? stats.data?.expiresAt ?? null);

  return (
    <Modal open={open} onClose={onClose} title="Share link" description={workout ? `Anyone with the link can see “${workout.title}” and save a copy.` : undefined} size="sm">
      <div className="space-y-4">
        {link?.url ? (
          <div className="space-y-2">
            <Input label="Link" hint="Shown once. Copy it now." readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            <Button variant="primary" block onClick={() => void copy()}>
              Copy link
            </Button>
          </div>
        ) : (
          <Button variant="primary" block loading={mint.isPending} onClick={() => mint.mutate()}>
            {active > 0 ? 'Create another link' : 'Create a link'}
          </Button>
        )}

        <p className="t-meta">Weights aren’t included.</p>
        {expires ? <p className="t-meta">{expires}</p> : null}
        {active > 0 ? <p className="t-meta">{active === 1 ? '1 link is live.' : `${formatStat(active)} links are live.`}</p> : null}

        {active > 0 ? (
          <Button variant="quiet" block loading={revoke.isPending} onClick={() => revoke.mutate()}>
            Revoke all links
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}
