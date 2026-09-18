import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Select,
  Skeleton,
  Tabs,
  cx,
  useToast,
} from '../../components/ui';
import { Dumbbell, Edit, Layers, Plus, Search, Trash, X } from '../../components/icons';
import { AdminPageHeader, Pager } from './AdminLayout';
import {
  catalogKeys,
  deleteCatalogPlan,
  deleteCatalogWorkout,
  getCatalogWorkout,
  listCatalogPlans,
  listCatalogWorkouts,
  type CatalogPlan,
  type CatalogWorkout,
} from './catalogApi';
import { CatalogThumb, CategoryBadge, LevelBadge, fmtDate, fmtKcal, fmtMinutes } from './catalogFields';
import {
  LIMITS,
  PAGE_SIZES,
  listStateParams,
  pageCount,
  parseListState,
  planEditorPath,
  plural,
  rangeLabel,
  workoutEditorPath,
  type CatalogListState,
  type CatalogTab,
} from './catalogRules';

/* ------------------------------------------------------------------ *
 * /admin/catalog — the premade workout and plan catalog.
 *
 * List state (tab, search, page, page size) lives in the URL so the editors
 * can send an admin straight back to where they were, and a reload keeps the
 * filter. Only the visible tab's list is fetched.
 * ------------------------------------------------------------------ */

const TABS = [
  { key: 'workouts', label: 'Workouts', icon: <Dumbbell size={16} /> },
  { key: 'plans', label: 'Plans', icon: <Layers size={16} /> },
];

const LIMIT_OPTIONS = PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} rows` }));

type DeleteTarget = { kind: 'workout'; item: CatalogWorkout } | { kind: 'plan'; item: CatalogPlan };

/* --------------------------------------------------------------- tables */

function WorkoutsTable({ rows, busy, onDelete }: { rows: CatalogWorkout[]; busy: boolean; onDelete: (w: CatalogWorkout) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="admin-table min-w-[880px]">
        <caption className="sr-only">Premade workouts</caption>
        <thead>
          <tr>
            <th scope="col">Workout</th>
            <th scope="col">Category</th>
            <th scope="col">Level</th>
            <th scope="col" className="num">Exercises</th>
            <th scope="col" className="num">Duration</th>
            <th scope="col" className="num">Calories</th>
            <th scope="col">Created</th>
            <th scope="col" className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody className={cx(busy && 'admin-fetching')}>
          {rows.map((w) => (
            <tr key={w._id}>
              <td>
                <div className="flex min-w-0 items-center gap-3">
                  <CatalogThumb image={w.image} kind="workout" />
                  <div className="min-w-0">
                    <Link
                      to={workoutEditorPath(w._id)}
                      className="block max-w-[26rem] truncate font-semibold text-text-1 hover:underline hover:underline-offset-3"
                    >
                      {w.title}
                    </Link>
                    {w.description ? (
                      <p className="max-w-[26rem] truncate text-xs text-text-2">{w.description}</p>
                    ) : null}
                  </div>
                </div>
              </td>
              <td><CategoryBadge category={w.category} /></td>
              <td><LevelBadge level={w.level} /></td>
              <td className="num">{w.exercises?.length ?? 0}</td>
              <td className="num whitespace-nowrap text-text-2">{fmtMinutes(w.duration)}</td>
              <td className="num whitespace-nowrap text-text-2">{fmtKcal(w.caloriesBurned)}</td>
              <td className="tabular whitespace-nowrap text-text-2">{fmtDate(w.createdAt)}</td>
              <td className="text-right">
                <div className="inline-flex items-center gap-1">
                  <ButtonLink to={workoutEditorPath(w._id)} size="sm" variant="ghost" icon={<Edit size={16} />} aria-label={`Edit ${w.title}`}>
                    Edit
                  </ButtonLink>
                  <Button size="sm" variant="danger" icon={<Trash size={16} />} aria-label={`Delete ${w.title}`} onClick={() => onDelete(w)}>
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlansTable({ rows, busy, onDelete }: { rows: CatalogPlan[]; busy: boolean; onDelete: (p: CatalogPlan) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="admin-table min-w-[820px]">
        <caption className="sr-only">Premade workout plans</caption>
        <thead>
          <tr>
            <th scope="col">Plan</th>
            <th scope="col">Level</th>
            <th scope="col" className="num">Length</th>
            <th scope="col" className="num">Workouts</th>
            <th scope="col" className="num">Calories</th>
            <th scope="col">Created</th>
            <th scope="col" className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody className={cx(busy && 'admin-fetching')}>
          {rows.map((p) => (
            <tr key={p._id}>
              <td>
                <div className="flex min-w-0 items-center gap-3">
                  <CatalogThumb image={p.image} kind="plan" />
                  <div className="min-w-0">
                    <Link
                      to={planEditorPath(p._id)}
                      className="block max-w-[26rem] truncate font-semibold text-text-1 hover:underline hover:underline-offset-3"
                    >
                      {p.title}
                    </Link>
                    {p.goal ? <p className="max-w-[26rem] truncate text-xs text-text-2">{p.goal}</p> : null}
                  </div>
                </div>
              </td>
              <td><LevelBadge level={p.level} /></td>
              <td className="num whitespace-nowrap text-text-2">{plural(p.durationWeeks, 'week')}</td>
              <td className="num">{p.workouts?.length ?? 0}</td>
              <td className="num whitespace-nowrap text-text-2">{fmtKcal(p.totalCaloriesBurned)}</td>
              <td className="tabular whitespace-nowrap text-text-2">{fmtDate(p.createdAt)}</td>
              <td className="text-right">
                <div className="inline-flex items-center gap-1">
                  <ButtonLink to={planEditorPath(p._id)} size="sm" variant="ghost" icon={<Edit size={16} />} aria-label={`Edit ${p.title}`}>
                    Edit
                  </ButtonLink>
                  <Button size="sm" variant="danger" icon={<Trash size={16} />} aria-label={`Delete ${p.title}`} onClick={() => onDelete(p)}>
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- deletion */

function DeleteCatalogDialog({ target, onClose, onDeleted }: { target: DeleteTarget | null; onClose: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const workoutId = target?.kind === 'workout' ? target.item._id : null;

  // The detail route reports how many plans (premade or member-owned)
  // schedule this workout, so the admin knows what the cascade will touch.
  // Keyed outside the workouts prefix: invalidating the list after the
  // delete must not refetch this and 404 on the record that just went away.
  const usage = useQuery({
    queryKey: catalogKeys.workoutUsage(workoutId ?? ''),
    queryFn: () => getCatalogWorkout(workoutId as string),
    enabled: Boolean(workoutId),
    staleTime: 0,
  });

  const remove = useMutation({
    mutationFn: async (t: DeleteTarget) => (t.kind === 'workout'
      ? deleteCatalogWorkout(t.item._id)
      : deleteCatalogPlan(t.item._id).then(() => ({ detachedFromPlans: 0 }))),
    onSuccess: (result, t) => {
      const detached = t.kind === 'workout' && result.detachedFromPlans > 0
        ? ` and removed it from ${plural(result.detachedFromPlans, 'plan')}`
        : '';
      toast.success(`Deleted “${t.item.title}”${detached}`);
      qc.removeQueries({ queryKey: catalogKeys.workoutUsage(t.item._id) });
      void qc.invalidateQueries({ queryKey: catalogKeys.workouts });
      // Deleting a workout rewrites the plans that scheduled it.
      void qc.invalidateQueries({ queryKey: catalogKeys.plans });
      onDeleted();
    },
    onError: (e) => toast.error(e, 'Could not delete this item.'),
  });

  const usedBy = usage.data?.usedByPlans ?? 0;
  const title = target?.item.title ?? '';

  return (
    <ConfirmDialog
      open={Boolean(target)}
      destructive
      title={target?.kind === 'plan' ? 'Delete premade plan' : 'Delete premade workout'}
      confirmLabel="Delete permanently"
      loading={remove.isPending}
      onCancel={() => {
        if (!remove.isPending) onClose();
      }}
      onConfirm={() => {
        if (target) remove.mutate(target);
      }}
      message={
        target ? (
          <span className="block space-y-2">
            <span className="block">
              <strong className="text-text-1">“{title}”</strong> disappears from the app for every member immediately and its cover image is released.
            </span>
            {target.kind === 'workout' ? (
              <span className="block" role="status">
                {usage.isLoading
                  ? 'Checking which plans schedule it…'
                  : usage.isError
                    ? 'Could not check which plans schedule it; deleting still removes it from all of them.'
                    : usedBy > 0
                      ? `${plural(usedBy, 'plan schedules it', 'plans schedule it')} (premade or members’ own). Deleting removes it from each one and adjusts their calorie totals.`
                      : 'No plan schedules this workout.'}
              </span>
            ) : (
              <span className="block">The workouts it scheduled stay in the catalog.</span>
            )}
            <span className="block">This is recorded in the audit log.</span>
          </span>
        ) : undefined
      }
    />
  );
}

/* ---------------------------------------------------------------- page */

export default function AdminCatalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = parseListState(searchParams);
  const { tab, search, page, limit } = state;
  const [searchInput, setSearchInput] = useState(search);
  const [target, setTarget] = useState<DeleteTarget | null>(null);

  const update = (next: Partial<CatalogListState>, replace = false) => {
    setSearchParams(listStateParams({ ...state, ...next }), { replace });
  };

  // Debounced: the API is asked once the admin pauses, never per keystroke.
  useEffect(() => {
    const trimmed = searchInput.trim().slice(0, LIMITS.search.max);
    if (trimmed === search) return;
    const t = setTimeout(() => update({ search: trimmed, page: 1 }, true), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search]);

  const params = { search, page, limit };
  const workouts = useQuery({
    queryKey: catalogKeys.workoutList(params),
    queryFn: () => listCatalogWorkouts(params),
    enabled: tab === 'workouts',
    placeholderData: keepPreviousData,
  });
  const plans = useQuery({
    queryKey: catalogKeys.planList(params),
    queryFn: () => listCatalogPlans(params),
    enabled: tab === 'plans',
    placeholderData: keepPreviousData,
  });
  const query = tab === 'workouts' ? workouts : plans;
  const total = query.data?.total ?? 0;
  const rowCount = query.data?.items.length ?? 0;
  const totalPages = pageCount(total, limit);
  const noun = tab === 'workouts' ? 'workout' : 'plan';
  const newPath = tab === 'workouts' ? workoutEditorPath('new') : planEditorPath('new');

  // A page past the end (after deletions, or a hand-edited URL) snaps back.
  useEffect(() => {
    if (query.data && page > totalPages) update({ page: totalPages }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, page, totalPages]);

  const clearSearch = () => {
    setSearchInput('');
    update({ search: '', page: 1 }, true);
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Catalog"
        subtitle="The official premade workouts and plans every member sees in the app. Changes publish immediately."
        meta={
          query.data ? (
            <Badge tone="neutral"><span className="tabular">{total.toLocaleString()}</span> {total === 1 ? noun : `${noun}s`}</Badge>
          ) : null
        }
        actions={
          <ButtonLink to={newPath} variant="primary" icon={<Plus size={18} />}>
            {tab === 'workouts' ? 'New workout' : 'New plan'}
          </ButtonLink>
        }
      />

      <Tabs
        aria-label="Catalog section"
        tabs={TABS}
        active={tab}
        onChange={(key) => update({ tab: key as CatalogTab, page: 1 })}
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Input
              label={`Search ${noun}s`}
              hideLabel
              role="searchbox"
              inputMode="search"
              autoComplete="off"
              leading={<Search size={18} />}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={tab === 'workouts' ? 'Search title, description or category' : 'Search title, description or goal'}
              maxLength={LIMITS.search.max}
              trailing={
                searchInput ? (
                  <IconButton label="Clear search" size={40} onClick={clearSearch}>
                    <X size={18} />
                  </IconButton>
                ) : undefined
              }
            />
          </div>
          <div className="w-36">
            <Select
              label="Rows per page"
              hideLabel
              options={LIMIT_OPTIONS}
              value={String(limit)}
              onChange={(v) => update({ limit: Number(v), page: 1 }, true)}
            />
          </div>
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        {query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} title={`Could not load ${noun}s`} />
        ) : query.isLoading || !query.data ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label={`Loading ${noun}s`}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-sm" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        ) : rowCount === 0 ? (
          search ? (
            <EmptyState
              variant="no-results"
              title={`No matching ${noun}s`}
              message={`Nothing matched “${search}”. Search looks at titles, descriptions and ${tab === 'workouts' ? 'categories' : 'goals'}.`}
              action={{ label: 'Clear search', onClick: clearSearch, variant: 'secondary' }}
            />
          ) : tab === 'workouts' ? (
            <EmptyState
              icon={<Dumbbell size={26} />}
              title="No premade workouts yet"
              message="Premade workouts are the official sessions in the app’s workout library, authored by staff rather than members. The first one you save appears there right away."
              action={{ label: 'New workout', to: workoutEditorPath('new'), icon: <Plus size={18} /> }}
            />
          ) : (
            <EmptyState
              icon={<Layers size={26} />}
              title="No premade plans yet"
              message="Premade plans string premade workouts into a week-by-week schedule members can follow. Build the workouts first, then arrange them into a plan."
              action={{ label: 'New plan', to: planEditorPath('new'), icon: <Plus size={18} /> }}
              secondaryAction={{ label: 'Go to workouts', onClick: () => update({ tab: 'workouts', page: 1 }), variant: 'ghost' }}
            />
          )
        ) : tab === 'workouts' ? (
          <WorkoutsTable rows={workouts.data?.items ?? []} busy={workouts.isFetching} onDelete={(item) => setTarget({ kind: 'workout', item })} />
        ) : (
          <PlansTable rows={plans.data?.items ?? []} busy={plans.isFetching} onDelete={(item) => setTarget({ kind: 'plan', item })} />
        )}

        {rowCount > 0 ? (
          <Pager
            className="border-t border-line px-4 py-3"
            page={page}
            totalPages={totalPages}
            canPrev={page > 1}
            canNext={page < totalPages}
            busy={query.isFetching}
            onPrev={() => update({ page: Math.max(1, page - 1) })}
            onNext={() => update({ page: Math.min(totalPages, page + 1) })}
            label={rangeLabel(page, limit, total, `${noun}s`)}
          />
        ) : null}
      </Card>

      <DeleteCatalogDialog
        target={target}
        onClose={() => setTarget(null)}
        onDeleted={() => {
          setTarget(null);
          // Removing the last row of a later page would otherwise leave an empty page on screen.
          if (rowCount === 1 && page > 1) update({ page: page - 1 }, true);
        }}
      />

      <p className="sr-only" role="status">
        {query.isFetching ? `Loading ${noun}s` : `${plural(rowCount, noun)} shown`}
      </p>
    </div>
  );
}
