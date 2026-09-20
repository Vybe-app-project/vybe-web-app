import { useId, useState, type ReactNode } from 'react';
import { Badge, Button, Callout, EmptyState, Input, Switch, Textarea, cx, plural } from '../../components/ui';
import { ChevronDown, ChevronUp, Zap } from '../../components/icons';
import { TimeStamp } from './adminCards';
import {
  ALLOWLIST_MAX,
  NOTE_MAX,
  UNREGISTERED_NOTE,
  draftFromRow,
  isEmptyPatch,
  readDraft,
  type AdminFlagRow,
  type FlagDraft,
  type FlagGroup,
  type FlagListEntry,
  type FlagPatch,
  type FlagSaveError,
} from '../../lib/adminFlags';

/**
 * The grouped flags table of the staff console, prop-driven: no query, no
 * store, no router, so tests/admin-flags.render.test.mjs mounts it through
 * react-dom/server. AdminFlags.tsx owns the queries, the confirm dialog and
 * the optimistic switch; this file owns what a row looks like.
 */

/** One row's state as the page computes it. */
export type FlagRowState = {
  entry: FlagListEntry;
  /** GET /api/capabilities `features[name]` as a signed-out caller; null when the answer lacks the name. */
  live: boolean | null;
  /** A PUT for this flag is in flight. */
  pending: boolean;
  /** The last failed PUT for this flag, until the next attempt. */
  error: FlagSaveError | null;
  /** The API answered FLAG_NOT_FOUND for this name during this session. */
  unregistered: boolean;
};

export type FlagSection = FlagGroup & { rows: FlagRowState[] };

export type FlagsTableProps = {
  sections: FlagSection[];
  /** Name of the row whose editor is open. */
  expanded: string | null;
  onExpand: (name: string | null) => void;
  onToggle: (name: string, next: boolean) => void;
  onSave: (name: string, patch: FlagPatch) => void;
  /** Dim the body while a refetch is in flight. */
  fetching?: boolean;
  /** The capabilities query has answered, so "Off" is a fact and not a placeholder. */
  liveKnown?: boolean;
  /** How many rows are hidden by the search box, for the empty state. */
  hiddenBySearch?: number;
  onClearSearch?: () => void;
};

const COLUMNS = 6;

/* ------------------------------------------------------------ pieces */

function StateBadges({ state }: { state: FlagRowState }) {
  const { entry, unregistered } = state;
  const row = entry.row;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {entry.staysFalse ? (
        <Badge tone="warning" size="sm" title={entry.staysFalse.reason}>
          Stays off · {entry.staysFalse.decision}
        </Badge>
      ) : null}
      {!row || unregistered ? (
        <Badge tone="neutral" size="sm" title="A PUT to this name answers 404 FLAG_NOT_FOUND on this build.">
          {UNREGISTERED_NOTE}
        </Badge>
      ) : row.seeded ? (
        <Badge tone="info" size="sm" title="A featureflags document exists for this name.">
          Seeded
        </Badge>
      ) : (
        <Badge tone="neutral" size="sm" title="No document yet; the API reports the code default.">
          Default
        </Badge>
      )}
    </span>
  );
}

function LiveCell({ live, known }: { live: boolean | null; known: boolean }) {
  if (live === null) {
    return (
      <span className="text-xs text-text-3" aria-label={known ? 'Not reported by GET /api/capabilities' : 'Capabilities not loaded yet'}>
        —
      </span>
    );
  }
  return (
    <span className={cx('text-xs font-semibold', live ? 'text-brand-text' : 'text-text-3')}>
      {live ? 'On' : 'Off'}
      <span className="sr-only"> for a signed-out reader</span>
    </span>
  );
}

function RowError({ error }: { error: FlagSaveError | null }) {
  if (!error || error.field) return null;
  return (
    <p role="alert" className="mt-1.5 text-xs text-danger">
      {error.message}
    </p>
  );
}

/* ------------------------------------------------------------ editor */

export function FlagEditor({
  row,
  error,
  pending = false,
  onSave,
  onCancel,
  staysFalseNote,
}: {
  row: AdminFlagRow;
  error: FlagSaveError | null;
  pending?: boolean;
  onSave: (patch: FlagPatch) => void;
  onCancel: () => void;
  staysFalseNote?: ReactNode;
}) {
  const [draft, setDraft] = useState<FlagDraft>(() => draftFromRow(row));
  const read = readDraft(row, draft);
  const baseId = useId();
  // The API's field error wins over the local check for the same field until the draft changes.
  const serverField = error?.field ?? null;
  const fieldError = (field: 'percentage' | 'allowlist' | 'note') =>
    read.errors[field] ?? (serverField === field ? error?.message ?? null : null);
  const canSave = !pending && read.values !== null && !isEmptyPatch(read.patch);

  const set = (field: keyof FlagDraft) => (value: string) => setDraft((d) => ({ ...d, [field]: value }));

  return (
    <form
      className="grid gap-4 md:grid-cols-2"
      aria-label={`Edit ${row.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave(read.patch);
      }}
    >
      <div className="space-y-4">
        <Input
          id={`${baseId}-percentage`}
          label="Percentage"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          value={draft.percentage}
          onChange={(e) => set('percentage')(e.target.value)}
          error={fieldError('percentage')}
          hint="Members outside the allowlist see the flag when their stable bucket is below this. Signed-out readers see it only at 100."
          trailing={<span className="text-xs text-text-3">%</span>}
          className="max-w-32"
          disabled={pending}
        />
        <Textarea
          id={`${baseId}-note`}
          label="Note"
          rows={3}
          value={draft.note}
          onChange={(e) => set('note')(e.target.value)}
          error={fieldError('note')}
          hint={`Why it is set this way. ${read.noteLength.toLocaleString()} of ${NOTE_MAX}.`}
          maxLength={NOTE_MAX}
          disabled={pending}
        />
      </div>
      <div className="space-y-4">
        <Textarea
          id={`${baseId}-allowlist`}
          label="Allowlist"
          rows={6}
          value={draft.allowlist}
          onChange={(e) => set('allowlist')(e.target.value)}
          error={fieldError('allowlist')}
          hint={`One user id per line or comma separated; 24-character hex ids. ${plural(read.allowlistCount, 'id')} of ${ALLOWLIST_MAX}.`}
          spellCheck={false}
          className="admin-code"
          disabled={pending}
        />
        {row.enabled && read.values && read.values.percentage === 0 && read.values.allowlist.length === 0 ? (
          <Callout tone="warning" title="Enabled, but reaching nobody">
            At 0 % with an empty allowlist no member sees this flag. Add ids or raise the percentage.
          </Callout>
        ) : null}
        {staysFalseNote}
      </div>
      {error && !error.field ? (
        <div className="md:col-span-2">
          <Callout tone="danger">{error.message}</Callout>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <Button type="submit" size="sm" loading={pending} disabled={!canSave}>
          Save changes
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <span className="text-xs text-text-3">
          {isEmptyPatch(read.patch) && read.values ? 'Nothing changed yet.' : 'Only the changed fields are sent; the API writes an audit-log row.'}
        </span>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- rows */

function FlagRow({
  state,
  expanded,
  liveKnown,
  onExpand,
  onToggle,
  onSave,
}: {
  state: FlagRowState;
  expanded: boolean;
  liveKnown: boolean;
  onExpand: (name: string | null) => void;
  onToggle: (name: string, next: boolean) => void;
  onSave: (name: string, patch: FlagPatch) => void;
}) {
  const { entry, live, pending, error, unregistered } = state;
  const row = entry.row;
  const editable = !!row && !unregistered;
  const editorId = `flag-editor-${entry.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <>
      <tr data-flag={entry.name} data-testid="admin-flag-row" className={cx(!editable && 'opacity-70')}>
        <td className="max-w-[26rem] align-top">
          <p className="admin-code font-semibold text-text-1">{entry.name}</p>
          <p className="mt-0.5 text-xs text-text-2">{entry.note}</p>
          {row?.note && entry.known ? (
            <p className="mt-0.5 text-xs text-text-3" title="The note stored on the flag">
              Note: {row.note}
            </p>
          ) : null}
          <StateBadges state={state} />
        </td>
        <td className="align-top">
          {editable && row ? (
            <div className="flex items-center gap-2">
              <Switch
                checked={row.enabled}
                disabled={pending}
                label={`Enable ${entry.name}`}
                onChange={(next) => onToggle(entry.name, next)}
              />
              <span className={cx('text-xs font-semibold', row.enabled ? 'text-brand-text' : 'text-text-3')} aria-hidden="true">
                {row.enabled ? 'On' : 'Off'}
              </span>
            </div>
          ) : (
            <span className="text-xs text-text-3">No controls</span>
          )}
          <RowError error={error} />
        </td>
        <td className="num align-top">
          {row ? (
            <>
              <span className="tabular text-text-1">{row.percentage}%</span>
              <p className="tabular mt-0.5 text-xs text-text-2">{plural(row.allowlist.length, 'id')} allowlisted</p>
            </>
          ) : (
            <span className="text-text-3">—</span>
          )}
        </td>
        <td className="align-top">
          <LiveCell live={live} known={liveKnown} />
        </td>
        <td className="align-top">
          {row ? (
            <>
              <p className="admin-code text-text-1">{row.updatedBy ?? '—'}</p>
              <p className="mt-0.5 text-xs text-text-2">
                <TimeStamp iso={row.updatedAt} />
              </p>
            </>
          ) : (
            <span className="text-text-3">—</span>
          )}
        </td>
        <td className="align-top">
          {editable ? (
            <Button
              size="sm"
              variant={expanded ? 'secondary' : 'ghost'}
              iconRight={expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              aria-expanded={expanded}
              aria-controls={editorId}
              onClick={() => onExpand(expanded ? null : entry.name)}
            >
              {expanded ? 'Close' : 'Edit'}
              <span className="sr-only"> {entry.name}</span>
            </Button>
          ) : null}
        </td>
      </tr>
      {expanded && editable && row ? (
        <tr id={editorId} data-testid="admin-flag-editor">
          <td colSpan={COLUMNS} className="bg-surface-2/60">
            <FlagEditor
              // A saved row carries a new updatedAt, so the editor reseeds from the API's answer.
              key={`${row.name}:${row.updatedAt ?? ''}:${row.percentage}:${row.allowlist.length}:${row.note}`}
              row={row}
              error={error}
              pending={pending}
              onSave={(patch) => onSave(entry.name, patch)}
              onCancel={() => onExpand(null)}
              staysFalseNote={
                entry.staysFalse ? (
                  <Callout tone="warning" title={`Stays off by decision ${entry.staysFalse.decision}`}>
                    {entry.staysFalse.reason}
                  </Callout>
                ) : null
              }
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------- table */

export function FlagsTable({
  sections,
  expanded,
  onExpand,
  onToggle,
  onSave,
  fetching = false,
  liveKnown = false,
  hiddenBySearch = 0,
  onClearSearch,
}: FlagsTableProps) {
  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  if (total === 0) {
    return (
      <EmptyState
        variant="no-results"
        icon={<Zap size={24} />}
        title={hiddenBySearch > 0 ? 'No flags match' : 'No flags'}
        message={
          hiddenBySearch > 0
            ? `${plural(hiddenBySearch, 'flag is', 'flags are')} hidden by the search.`
            : 'The API returned no flags and the web registry is empty.'
        }
        action={hiddenBySearch > 0 && onClearSearch ? <Button size="sm" variant="secondary" onClick={onClearSearch}>Clear search</Button> : undefined}
        size="sm"
      />
    );
  }
  return (
    <div className="admin-table-wrap">
      <table className="admin-table min-w-[960px]" data-testid="admin-flags-table">
        <thead>
          <tr>
            <th scope="col">Flag</th>
            <th scope="col">State</th>
            <th scope="col" className="num">Rollout</th>
            <th scope="col">
              Public read
              <span className="sr-only"> from GET /api/capabilities as a signed-out reader</span>
            </th>
            <th scope="col">Updated</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {sections.map((section) => (
          <tbody key={section.key} className={cx(fetching && 'admin-fetching')} data-group={section.key}>
            <tr className="bg-surface-2">
              <th scope="colgroup" colSpan={COLUMNS} className="px-4 py-2 text-left">
                <span className="type-label text-text-2">{section.title}</span>
                <span className="ml-2 text-xs font-normal text-text-3">{section.description}</span>
                <span className="sr-only">, {plural(section.rows.length, 'flag')}</span>
              </th>
            </tr>
            {section.rows.map((state) => (
              <FlagRow
                key={state.entry.name}
                state={state}
                expanded={expanded === state.entry.name}
                liveKnown={liveKnown}
                onExpand={onExpand}
                onToggle={onToggle}
                onSave={onSave}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
