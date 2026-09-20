import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { apiErrorDetails, describeAdminError, parseApiError } from '../../lib/apiError';
import {
  featuresOf,
  groupEntries,
  isFormPatch,
  mapFlagError,
  mergeWithRegistry,
  normalizeFlagRow,
  normalizeFlagRows,
  publicFeatureState,
  readsInline,
  searchEntries,
  staysFalseDecision,
  summarizeFlags,
  type AdminFlagRow,
  type FlagPatch,
  type FlagSaveError,
} from '../../lib/adminFlags';
import {
  Badge,
  Callout,
  Card,
  ConfirmDialog,
  ErrorState,
  IconButton,
  SearchField,
  Skeleton,
  cx,
  plural,
  useToast,
} from '../../components/ui';
import { Refresh } from '../../components/icons';
import { AdminPageHeader } from './AdminLayout';
import { FlagsTable, type FlagRowState, type FlagSection } from './AdminFlagsTable';

/* --------------------------------------------------------------- types */

/** GET /api/capabilities (public): { capabilities, client, features }. */
type Capabilities = { features?: Record<string, unknown> };

type SaveVars = { name: string; patch: FlagPatch };
type SaveContext = { previous: AdminFlagRow[] | undefined };

const FLAGS_KEY = ['admin', 'flags'] as const;
/** Shared with AdminSystem: the same GET, so one invalidation refreshes both pages. */
const CAPABILITIES_KEY = ['system', 'capabilities'] as const;

const retryUnlessLimited = (count: number, err: unknown) => apiErrorDetails(err).status !== 429 && count < 2;

/* ---------------------------------------------------------------- page */

export default function AdminFlags() {
  const qc = useQueryClient();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingNames, setPendingNames] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, FlagSaveError>>({});
  const [unregistered, setUnregistered] = useState<ReadonlySet<string>>(() => new Set());
  const [confirm, setConfirm] = useState<{ name: string; decision: string; reason: string } | null>(null);
  // Read by the mutation callbacks, which may settle after the row's editor closed or moved.
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  // GET /api/admin/flags -> { flags: [...] } for every registered name.
  const flags = useQuery<AdminFlagRow[]>({
    queryKey: FLAGS_KEY,
    queryFn: async () => normalizeFlagRows((await adminApi.get('/admin/flags')).data),
    retry: retryUnlessLimited,
    staleTime: 15_000,
  });

  // The public read of the same flags. The API clears its capabilities cache
  // on every PUT, so re-reading this after a save shows the live effect for a
  // signed-out reader (on only at 100 %). Read through the admin client so the
  // request carries the console's origin and base like everything else here;
  // the member hook in lib/capabilities.ts evaluates for a member, not for the console.
  const caps = useQuery<Capabilities>({
    queryKey: CAPABILITIES_KEY,
    queryFn: async () => (await adminApi.get('/capabilities')).data ?? {},
    staleTime: 60_000,
  });

  // A fresh GET is the API's word on what is registered: a name it returns
  // drops the FLAG_NOT_FOUND lock, so a row is not left without controls once
  // the build that registers it is deployed. dataUpdatedAt is in the deps
  // because structural sharing keeps the same `data` for an identical answer.
  useEffect(() => {
    const returned = flags.data;
    if (!returned) return;
    setUnregistered((prev) => {
      if (prev.size === 0) return prev;
      const names = new Set(returned.map((r) => r.name));
      const next = new Set([...prev].filter((name) => !names.has(name)));
      return next.size === prev.size ? prev : next;
    });
  }, [flags.data, flags.dataUpdatedAt]);

  const markPending = (name: string, on: boolean) =>
    setPendingNames((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  const save = useMutation<AdminFlagRow | null, unknown, SaveVars, SaveContext>({
    // PUT /api/admin/flags/:name with only the changed fields; the answer is the row.
    mutationFn: async ({ name, patch }) => normalizeFlagRow((await adminApi.put(`/admin/flags/${encodeURIComponent(name)}`, patch)).data),
    onMutate: async ({ name, patch }) => {
      await qc.cancelQueries({ queryKey: FLAGS_KEY });
      const previous = qc.getQueryData<AdminFlagRow[]>(FLAGS_KEY);
      // The switch flips at once; a percentage, allowlist or note waits for the API's row.
      if (previous && typeof patch.enabled === 'boolean') {
        qc.setQueryData<AdminFlagRow[]>(FLAGS_KEY, previous.map((r) => (r.name === name ? { ...r, enabled: patch.enabled as boolean } : r)));
      }
      markPending(name, true);
      setErrors((prev) => {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
      return { previous };
    },
    onError: (e, { name }, context) => {
      if (context?.previous) qc.setQueryData(FLAGS_KEY, context.previous);
      const mapped = mapFlagError(parseApiError(e), name);
      setErrors((prev) => ({ ...prev, [name]: mapped }));
      if (mapped.kind === 'not-found') setUnregistered((prev) => new Set(prev).add(name));
      // A field error the open editor shows reads inline there; everything else (row-level,
      // `enabled`, or a field error with the editor closed) reads beside the row and toasts.
      if (!readsInline(mapped, expandedRef.current === name)) toast.error(describeAdminError(e, mapped.message));
    },
    onSuccess: (row, { name, patch }) => {
      if (row) {
        qc.setQueryData<AdminFlagRow[]>(FLAGS_KEY, (prev) => (prev ? prev.map((r) => (r.name === name ? row : r)) : [row]));
        setUnregistered((prev) => {
          if (!prev.has(name)) return prev;
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }
      // Only a form save closes the editor. A switch toggle while the editor is open leaves the draft alone.
      if (isFormPatch(patch)) setExpanded((current) => (current === name ? null : current));
      toast.success(`${name} saved`);
    },
    onSettled: (_row, _err, { name }) => {
      markPending(name, false);
      void qc.invalidateQueries({ queryKey: FLAGS_KEY });
      void qc.invalidateQueries({ queryKey: CAPABILITIES_KEY });
    },
  });

  const onToggle = (name: string, next: boolean) => {
    const decision = staysFalseDecision(name);
    if (next && decision) {
      setConfirm({ name, ...decision });
      return;
    }
    save.mutate({ name, patch: { enabled: next } });
  };

  const onSave = (name: string, patch: FlagPatch) => {
    if (Object.keys(patch).length === 0) return;
    save.mutate({ name, patch });
  };

  const rows = flags.data ?? [];
  const summary = useMemo(() => summarizeFlags(rows), [rows]);
  const entries = useMemo(() => mergeWithRegistry(rows), [rows]);
  const visible = useMemo(() => searchEntries(entries, query), [entries, query]);
  const features = useMemo(() => featuresOf(caps.data), [caps.data]);

  const sections: FlagSection[] = useMemo(
    () =>
      groupEntries(visible).map((group) => ({
        key: group.key,
        title: group.title,
        description: group.description,
        rows: group.entries.map<FlagRowState>((entry) => ({
          entry,
          live: publicFeatureState(features, entry.name),
          pending: pendingNames.has(entry.name),
          error: errors[entry.name] ?? null,
          unregistered: unregistered.has(entry.name),
        })),
      })),
    [visible, features, pendingNames, errors, unregistered],
  );

  const status = apiErrorDetails(flags.error).status;
  const routeMissing = flags.isError && status === 404;
  const refreshing = flags.isFetching || caps.isFetching;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Feature flags"
        subtitle="Every flag the API registers, with its rollout. A change writes an audit-log row and clears the API's capabilities cache, so the public read updates at once. Signed-out readers see a flag only when it is enabled at 100 %."
        meta={
          flags.data ? (
            <Badge tone={summary.on > 0 ? 'brand' : 'neutral'}>
              <span className="tabular">{summary.on} of {summary.total}</span> on
            </Badge>
          ) : null
        }
        actions={
          <IconButton
            label="Refresh flags"
            variant="secondary"
            // Stays focusable while fetching (a disabled button drops keyboard focus); the click is a no-op meanwhile.
            aria-busy={refreshing || undefined}
            className={cx(refreshing && 'cursor-progress')}
            onClick={() => {
              if (refreshing) return;
              void flags.refetch();
              void caps.refetch();
            }}
          >
            <Refresh size={18} className={cx(refreshing && 'animate-spin')} />
          </IconButton>
        }
      />

      {flags.data && summary.missing > 0 ? (
        <Callout tone="info" title={`${plural(summary.missing, 'registry flag is', 'registry flags are')} not on this API build`}>
          They are listed without controls. A PUT to one would answer 404 FLAG_NOT_FOUND until the API that registers them is deployed.
        </Callout>
      ) : null}

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-md font-semibold text-text-1">Flags</h2>
            <p className="mt-0.5 text-xs text-text-2">
              <span className="admin-code">GET /api/admin/flags</span>
              {flags.data ? (
                <>
                  {' · '}
                  <span className="tabular">{plural(summary.total, 'flag')}</span>, <span className="tabular">{summary.seeded}</span> seeded
                  {summary.unknown > 0 ? <>, <span className="tabular">{summary.unknown}</span> not in the web registry</> : null}
                </>
              ) : null}
            </p>
          </div>
          <SearchField
            label="Search flags"
            hideLabel
            placeholder="Search by name, group, note or decision"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            containerClassName="w-full sm:w-80"
          />
        </div>

        {flags.isLoading ? (
          <div className="space-y-3 p-4" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : flags.isError ? (
          <ErrorState
            error={flags.error}
            retry={() => void flags.refetch()}
            title={routeMissing ? 'This API build has no flags route' : 'Could not load flags'}
            message={
              routeMissing
                ? 'GET /api/admin/flags answered 404. The route lands with the Wave G integration; until then flags are changed on the host.'
                : describeAdminError(flags.error, 'The API did not answer.')
            }
            className="py-8"
          />
        ) : (
          <FlagsTable
            sections={sections}
            expanded={expanded}
            onExpand={setExpanded}
            onToggle={onToggle}
            onSave={onSave}
            fetching={flags.isFetching}
            liveKnown={caps.isSuccess}
            hiddenBySearch={entries.length - visible.length}
            onClearSearch={() => setQuery('')}
          />
        )}
      </Card>

      {caps.isError ? (
        <p className="text-xs text-text-2">
          Public read unavailable: {describeAdminError(caps.error, 'GET /api/capabilities did not answer.')}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `Enable ${confirm.name}?` : 'Enable this flag?'}
        message={
          confirm
            ? `${confirm.name} stays off by decision ${confirm.decision}. ${confirm.reason} Enabling it changes production for everyone the rollout reaches and writes an audit-log row.`
            : undefined
        }
        confirmLabel="Enable anyway"
        destructive
        loading={confirm ? pendingNames.has(confirm.name) : false}
        onConfirm={() => {
          if (!confirm) return;
          const { name } = confirm;
          setConfirm(null);
          save.mutate({ name, patch: { enabled: true } });
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
