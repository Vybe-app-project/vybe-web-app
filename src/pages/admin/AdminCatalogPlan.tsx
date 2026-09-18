import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
  cx,
  humanize,
  useOnline,
  useToast,
  plural,
} from '../../components/ui';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Flame, Layers, Plus, Search, Trash, X } from '../../components/icons';
import { AdminPageHeader, Pager } from './AdminLayout';
import {
  CATALOG_LEVELS,
  catalogKeys,
  createCatalogPlan,
  getCatalogPlan,
  listCatalogWorkouts,
  updateCatalogPlan,
  type CatalogLevel,
  type CatalogPlan,
  type CatalogWorkout,
  type PlanBody,
  type PlanWorkoutRef,
} from './catalogApi';
import {
  CatalogThumb,
  CategoryBadge,
  CoverImageField,
  FactList,
  HashtagsField,
  LevelBadge,
  SaveErrorCallout,
  WholeNumberInput,
  fmtDateTime,
  fmtKcal,
  fmtMinutes,
  useUnsavedChangesWarning,
} from './catalogFields';
import {
  LIMITS,
  catalogErrorDetails,
  catalogReturnPath,
  entryMoveability,
  estimatedPlanCalories,
  isMissingRecordError,
  isObjectId,
  moveEntryWithinDay,
  nextDraftKey,
  orderedEntries,
  pageCount,
  parsePlanWeeks,
  planSession,
  planSessionBody,
  planWeeks,
  rangeLabel,
  reslotEntry,
  seedableRecord,
  validatePlanDraft,
  type CatalogErrorDetails,
  type EditorSession,
  type PlanDraft,
  type PlanEntryDraft,
} from './catalogRules';

const LEVEL_OPTIONS = CATALOG_LEVELS.map((l) => ({ value: l, label: humanize(l) }));
const DAY_OPTIONS = Array.from({ length: LIMITS.day.max }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` }));
const weekOptions = (weeks: number) => Array.from({ length: weeks }, (_, i) => ({ value: String(i + 1), label: `Week ${i + 1}` }));
const FORM_ID = 'catalog-plan-form';
const ADD_WORKOUTS_ID = 'catalog-add-workouts';
const PICKER_LIMIT = 20;

type Session = EditorSession<CatalogPlan, PlanDraft>;

const toRef = (workout: CatalogWorkout): PlanWorkoutRef => ({
  _id: workout._id,
  title: workout.title,
  category: workout.category,
  level: workout.level,
  duration: workout.duration,
  caloriesBurned: workout.caloriesBurned,
  image: workout.image,
  isPremade: true,
});

/* -------------------------------------------------------------- picker */

function WorkoutPicker({
  open,
  weeks,
  initialWeek,
  entries,
  onAdd,
  onClose,
}: {
  open: boolean;
  weeks: number;
  initialWeek: number;
  entries: PlanEntryDraft[];
  onAdd: (workout: PlanWorkoutRef, week: number, day: number) => void;
  onClose: () => void;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [week, setWeek] = useState(initialWeek);
  const [day, setDay] = useState(1);
  const [lastAdded, setLastAdded] = useState('');

  useEffect(() => {
    if (open) setWeek(Math.min(Math.max(1, initialWeek), weeks));
  }, [open, initialWeek, weeks]);

  useEffect(() => {
    const trimmed = searchInput.trim().slice(0, LIMITS.search.max);
    if (trimmed === search) return;
    const t = setTimeout(() => {
      setSearch(trimmed);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const params = { search, page, limit: PICKER_LIMIT };
  const list = useQuery({
    queryKey: catalogKeys.workoutList(params),
    queryFn: () => listCatalogWorkouts(params),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = pageCount(total, PICKER_LIMIT);

  const countInPlan = (id: string) => entries.filter((entry) => entry.workout._id === id).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add workouts"
      description="Pick a slot, then add any premade workout. The picker stays open so you can fill several days in one go."
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_8rem]">
          <Input
            label="Search workouts"
            hideLabel
            role="searchbox"
            inputMode="search"
            autoComplete="off"
            leading={<Search size={18} />}
            placeholder="Search title, description or category"
            maxLength={LIMITS.search.max}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            trailing={
              searchInput ? (
                <IconButton label="Clear search" size={40} onClick={() => setSearchInput('')}>
                  <X size={18} />
                </IconButton>
              ) : undefined
            }
          />
          <Select label="Week" hideLabel aria-label="Add to week" options={weekOptions(weeks)} value={String(week)} onChange={(v) => setWeek(Number(v))} />
          <Select label="Day" hideLabel aria-label="Add to day" options={DAY_OPTIONS} value={String(day)} onChange={(v) => setDay(Number(v))} />
        </div>

        {list.isError ? (
          <ErrorState error={list.error} title="Could not load workouts" retry={() => void list.refetch()} />
        ) : list.isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading workouts">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-sm border border-line p-2">
                <Skeleton className="h-10 w-10 rounded-sm" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-9 w-16" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            size="sm"
            variant={search ? 'no-results' : 'first-run'}
            icon={search ? undefined : <Layers size={24} />}
            title={search ? 'No matching workouts' : 'No premade workouts yet'}
            message={search ? `Nothing matched “${search}”.` : 'Create premade workouts first; plans can only schedule those.'}
            action={search ? { label: 'Clear search', onClick: () => setSearchInput(''), variant: 'secondary' } : undefined}
          />
        ) : (
          <ul className={cx('divide-y divide-line rounded-md border border-line', list.isFetching && 'admin-fetching')} aria-label="Premade workouts">
            {rows.map((workout) => {
              const inPlan = countInPlan(workout._id);
              return (
                <li key={workout._id} className="flex items-center gap-3 px-3 py-2">
                  <CatalogThumb image={workout.image} kind="workout" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-1">{workout.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-2">
                      <CategoryBadge category={workout.category} />
                      <LevelBadge level={workout.level} />
                      <span className="tabular">{fmtMinutes(workout.duration)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular">{fmtKcal(workout.caloriesBurned)}</span>
                      {inPlan ? <Badge tone="brand" size="sm">In plan ×{inPlan}</Badge> : null}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus size={16} />}
                    aria-label={`Add ${workout.title} to week ${week}, day ${day}`}
                    onClick={() => {
                      onAdd(toRef(workout), week, day);
                      setLastAdded(`Added ${workout.title} to week ${week}, day ${day}`);
                    }}
                  >
                    Add
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {rows.length > 0 ? (
          <Pager
            page={page}
            totalPages={totalPages}
            canPrev={page > 1}
            canNext={page < totalPages}
            busy={list.isFetching}
            onPrev={() => setPage((n) => Math.max(1, n - 1))}
            onNext={() => setPage((n) => Math.min(totalPages, n + 1))}
            label={rangeLabel(page, PICKER_LIMIT, total, 'workouts')}
          />
        ) : null}
        <p className="sr-only" role="status">{lastAdded}</p>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------- schedule rows */

function EntryRow({
  entry,
  weeks,
  error,
  disabled,
  moveability,
  onSlot,
  onMove,
  onRemove,
}: {
  entry: PlanEntryDraft;
  weeks: number;
  error?: string;
  disabled: boolean;
  moveability: { up: boolean; down: boolean };
  onSlot: (slot: { week?: number; day?: number }) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const title = entry.workout.title;
  const overrun = entry.week > weeks;
  return (
    <li className={cx('flex flex-wrap items-center gap-3 px-3 py-2', error && 'bg-danger-soft/40')}>
      {overrun ? (
        <div className="w-32 shrink-0">
          <Select
            label={`Week for ${title}`}
            hideLabel
            options={weekOptions(weeks)}
            value={null}
            placeholder={`Week ${entry.week}`}
            disabled={disabled}
            onChange={(v) => onSlot({ week: Number(v) })}
          />
        </div>
      ) : null}
      <div className="w-28 shrink-0">
        <Select
          label={`Day for ${title}`}
          hideLabel
          options={DAY_OPTIONS}
          value={String(entry.day)}
          disabled={disabled}
          onChange={(v) => onSlot({ day: Number(v) })}
        />
      </div>
      <CatalogThumb image={entry.workout.image} kind="workout" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-1">{title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-2">
          <CategoryBadge category={entry.workout.category} />
          <LevelBadge level={entry.workout.level} />
          <span className="tabular">{fmtMinutes(entry.workout.duration)}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular">{fmtKcal(entry.workout.caloriesBurned)}</span>
        </p>
        {error ? <p role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Reorder or remove ${title}`}>
        <IconButton id={`entry-${entry.key}-up`} label={`Move ${title} earlier on day ${entry.day}`} size={40} disabled={disabled || !moveability.up} onClick={() => onMove(-1)}>
          <ArrowUp size={18} />
        </IconButton>
        <IconButton id={`entry-${entry.key}-down`} label={`Move ${title} later on day ${entry.day}`} size={40} disabled={disabled || !moveability.down} onClick={() => onMove(1)}>
          <ArrowDown size={18} />
        </IconButton>
        <IconButton label={`Remove ${title} from week ${entry.week}, day ${entry.day}`} size={40} variant="danger" disabled={disabled} onClick={onRemove}>
          <Trash size={18} />
        </IconButton>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ page */

function EditorSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true" aria-label="Loading plan">
      <div className="space-y-5">
        <Card>
          <Skeleton className="h-4 w-24" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-11 sm:col-span-2" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-24 sm:col-span-2" />
          </div>
        </Card>
        <Card>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-16" />
          <Skeleton className="mt-3 h-16" />
          <Skeleton className="mt-3 h-16" />
        </Card>
      </div>
      <div className="space-y-5">
        <Card>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 aspect-video w-full" />
        </Card>
        <Card>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-11" />
        </Card>
      </div>
    </div>
  );
}

export default function AdminCatalogPlan() {
  const { planId } = useParams();
  const isNew = !planId || planId === 'new';
  const id = isNew ? '' : (planId as string);
  const validId = isNew || isObjectId(id);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const backTo = catalogReturnPath(location.state, 'plans');

  // staleTime 0: every mount refetches, and the draft below is seeded only
  // once that fetch settles (see seedableRecord), never from the cached copy.
  const detail = useQuery({
    queryKey: catalogKeys.plan(id),
    queryFn: () => getCatalogPlan(id),
    enabled: !isNew && validId,
    staleTime: 0,
  });

  const [session, setSession] = useState<Session | null>(() => (isNew ? planSession('', null) : null));
  const current = session && session.id === id ? session : null;
  const draft = current?.draft ?? null;
  const baseline = current?.baseline ?? null;
  // The schedule is drawn with the last valid plan length, so a half-typed number does not collapse it.
  const [lastValidWeeks, setLastValidWeeks] = useState<number>(() => (session ? planWeeks(session.draft) : null) ?? LIMITS.durationWeeks.min);
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<CatalogErrorDetails | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [picker, setPicker] = useState<{ open: boolean; week: number }>({ open: false, week: 1 });

  // Seed from the record fetched for this mount. Until the admin types, a
  // fresher copy (an explicit reload, a refetch) may still replace the draft;
  // after that the draft is theirs and only Reload swaps it.
  const record = seedableRecord(detail);
  useEffect(() => {
    if (isNew || !record) return;
    if (current && (touched || current.baseline === record)) return;
    const next = planSession(id, record);
    setSession(next);
    setLastValidWeeks(planWeeks(next.draft) ?? LIMITS.durationWeeks.min);
    if (!current) {
      // A session for another id (or the first one) starts clean.
      setTouched(false);
      setAttempted(false);
      setServerError(null);
    }
  }, [isNew, id, record, current, touched]);

  useEffect(() => {
    if (!focusKey) return;
    // A focus target can vanish with the row it belonged to; the header button always exists.
    (document.getElementById(focusKey) ?? document.getElementById(ADD_WORKOUTS_ID))?.focus();
    setFocusKey(null);
  }, [focusKey, draft]);

  const validation = useMemo(() => (draft ? validatePlanDraft(draft) : null), [draft]);
  const body = useMemo<PlanBody>(() => (current ? planSessionBody(current) : {}), [current]);
  const dirty = isNew ? touched : Object.keys(body).length > 0;
  const weeks = (draft ? planWeeks(draft) : null) ?? lastValidWeeks;
  const ordered = useMemo(() => (draft ? orderedEntries(draft.entries) : []), [draft]);

  const save = useMutation({
    mutationFn: (payload: PlanBody) => (isNew ? createCatalogPlan(payload) : updateCatalogPlan(id, payload)),
    onSuccess: (plan) => {
      toast.success(isNew ? `Created “${plan.title}”` : `Saved “${plan.title}”`);
      qc.setQueryData(catalogKeys.plan(plan._id), plan);
      void qc.invalidateQueries({ queryKey: catalogKeys.plans });
      // Every workout's "scheduled in N plans" count moves with the schedule.
      void qc.invalidateQueries({ queryKey: catalogKeys.workouts });
      setTouched(false);
      navigate(backTo);
    },
    onError: (e) => {
      const details = catalogErrorDetails(e, isNew ? 'Could not create this plan.' : 'Could not save this plan.');
      setServerError(details);
      setAnnouncement(details.message);
    },
  });

  useUnsavedChangesWarning(dirty && !save.isPending);

  const change = (patch: Partial<PlanDraft>) => {
    setSession((s) => (s && s.id === id ? { ...s, draft: { ...s.draft, ...patch } } : s));
    if (patch.durationWeeks !== undefined) {
      const parsed = parsePlanWeeks(patch.durationWeeks);
      if (parsed !== null) setLastValidWeeks(parsed);
    }
    setTouched(true);
    // Field-level complaints from the last attempt are about values that are
    // now changing; a stale-record notice must stay until the admin reloads.
    setServerError((error) => (error && error.stale ? error : null));
  };

  const addEntry = (workout: PlanWorkoutRef, week: number, day: number) => {
    if (!draft) return;
    if (draft.entries.length >= LIMITS.planWorkouts.max) {
      toast.error(`A plan can schedule at most ${LIMITS.planWorkouts.max} workouts.`);
      return;
    }
    change({ entries: [...draft.entries, { key: nextDraftKey(), workout, week, day }] });
  };

  const removeEntry = (key: string) => {
    if (!draft) return;
    const entry = draft.entries.find((candidate) => candidate.key === key);
    const rest = draft.entries.filter((candidate) => candidate.key !== key);
    change({ entries: rest });
    if (entry) setAnnouncement(`Removed ${entry.workout.title} from week ${entry.week}, day ${entry.day}`);
    // Entries past the plan's end have no week section to hand focus back to.
    setFocusKey(entry && entry.week <= weeks ? `catalog-add-week-${entry.week}` : ADD_WORKOUTS_ID);
  };

  const moveEntry = (key: string, direction: -1 | 1) => {
    if (!draft) return;
    const next = moveEntryWithinDay(draft.entries, key, direction);
    if (next === draft.entries) return;
    change({ entries: next });
    const entry = next.find((candidate) => candidate.key === key);
    const after = entryMoveability(next, key);
    const still = direction === -1 ? after.up : after.down;
    setFocusKey(`entry-${key}-${still ? (direction === -1 ? 'up' : 'down') : direction === -1 ? 'down' : 'up'}`);
    if (entry) setAnnouncement(`${entry.workout.title} moved ${direction === -1 ? 'earlier' : 'later'} on week ${entry.week}, day ${entry.day}`);
  };

  const reload = async () => {
    const result = await detail.refetch();
    if (result.data) {
      const next = planSession(id, result.data);
      setSession(next);
      setLastValidWeeks(planWeeks(next.draft) ?? LIMITS.durationWeeks.min);
      setTouched(false);
      setServerError(null);
      setAttempted(false);
      setAnnouncement('Reloaded the saved version');
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !validation || save.isPending) return;
    setAttempted(true);
    if (!validation.ok) {
      const first = validation.fields.title
        ?? validation.fields.goal
        ?? validation.fields.durationWeeks
        ?? validation.fields.description
        ?? validation.fields.hashtags
        ?? validation.fields.workouts
        ?? Object.values(validation.entries)[0]
        ?? 'Check the highlighted fields';
      setAnnouncement(first);
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`#${FORM_ID} [aria-invalid="true"]`)?.focus();
      });
      return;
    }
    if (!isNew && Object.keys(body).length === 0) {
      toast.info('Nothing has changed.');
      return;
    }
    save.mutate(body);
  };

  const leave = () => {
    if (dirty && !save.isPending) setConfirmLeave(true);
    else navigate(backTo);
  };

  const fieldError = (field: keyof NonNullable<typeof validation>['fields']): string | undefined => (
    serverError?.fields[field] ?? (attempted ? validation?.fields[field] : undefined)
  );
  // Server messages about a plan workout arrive by 1-based position in the
  // saved list, which is `ordered`; invalidWorkoutIds name the workout instead.
  const entryError = (entry: PlanEntryDraft, position: number): string | undefined => {
    if (serverError?.invalidWorkoutIds.includes(entry.workout._id)) return 'This workout no longer exists in the catalog. Remove it to save.';
    const row = serverError?.rows[position + 1];
    if (row) return row.message;
    return attempted ? validation?.entries[entry.key] : undefined;
  };

  const title = isNew ? 'New plan' : baseline ? `Edit “${baseline.title}”` : 'Edit plan';
  const saving = save.isPending;
  const canSave = online && !saving && (isNew || dirty);
  const overrun = ordered.filter((entry) => entry.week > weeks);
  const estimate = draft ? estimatedPlanCalories(draft.entries) : 0;

  const actions = (
    <>
      <Button variant="ghost" onClick={leave} disabled={saving}>
        Cancel
      </Button>
      <Button type="submit" form={FORM_ID} variant="primary" icon={<Check size={18} />} loading={saving} disabled={!canSave}>
        {isNew ? 'Create plan' : 'Save changes'}
      </Button>
    </>
  );

  if (!isNew && (!validId || detail.isError)) {
    return (
      <div className="space-y-5">
        <AdminPageHeader title="Edit plan" />
        <Card>
          {!validId || isMissingRecordError(detail.error) ? (
            <EmptyState
              variant="error"
              title="Plan not found"
              message="It may have been deleted by another administrator, or the link is wrong."
              action={{ label: 'Back to catalog', to: backTo, icon: <ArrowLeft size={18} />, variant: 'secondary' }}
            />
          ) : (
            <ErrorState error={detail.error} title="Could not load this plan" retry={() => void detail.refetch()} />
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={title}
        subtitle={
          isNew
            ? 'A premade plan is published to every member the moment it is created.'
            : 'Changes publish immediately and are recorded in the audit log.'
        }
        actions={draft ? actions : undefined}
      />

      <div className="-mt-2">
        <ButtonLink
          to={backTo}
          variant="link"
          size="sm"
          icon={<ArrowLeft size={16} />}
          onClick={(e) => {
            // Same guard as Cancel: a plain click asks before discarding edits.
            if (dirty && !saving) {
              e.preventDefault();
              setConfirmLeave(true);
            }
          }}
        >
          Back to catalog
        </ButtonLink>
      </div>

      {!online ? (
        <Callout tone="warning" title="You’re offline">
          {draft
            ? 'Keep editing; saving becomes available again once the connection is back.'
            : 'The latest saved version loads once the connection is back.'}
        </Callout>
      ) : null}

      <SaveErrorCallout details={serverError} onReload={isNew ? undefined : () => void reload()} backTo={backTo} />

      {!draft || !validation ? (
        <EditorSkeleton />
      ) : (
        <form
          id={FORM_ID}
          noValidate
          onSubmit={onSubmit}
          aria-busy={saving || undefined}
          className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]"
        >
          <div className="min-w-0 space-y-5">
            <Card>
              <CardHeader title="Basics" subtitle="What members see on the plan card." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Title"
                  containerClassName="sm:col-span-2"
                  value={draft.title}
                  maxLength={LIMITS.title.max}
                  autoComplete="off"
                  disabled={saving}
                  error={fieldError('title')}
                  hint={`${LIMITS.title.min}–${LIMITS.title.max} characters, unique among premade plans.`}
                  onChange={(e) => change({ title: e.target.value })}
                />
                <Input
                  label="Goal"
                  containerClassName="sm:col-span-2"
                  value={draft.goal}
                  maxLength={LIMITS.goal.max}
                  autoComplete="off"
                  disabled={saving}
                  error={fieldError('goal')}
                  hint="One line on what the plan is for, e.g. “Build a sustainable training habit”."
                  onChange={(e) => change({ goal: e.target.value })}
                />
                <WholeNumberInput
                  label="Length"
                  unit="weeks"
                  value={draft.durationWeeks}
                  min={LIMITS.durationWeeks.min}
                  max={LIMITS.durationWeeks.max}
                  disabled={saving}
                  error={fieldError('durationWeeks')}
                  onChange={(v) => change({ durationWeeks: v })}
                />
                <Select
                  label="Level"
                  options={LEVEL_OPTIONS}
                  value={draft.level}
                  disabled={saving}
                  error={fieldError('level')}
                  onChange={(v) => change({ level: v as CatalogLevel })}
                />
                <Textarea
                  label="Description"
                  containerClassName="sm:col-span-2"
                  rows={3}
                  autoGrow
                  value={draft.description}
                  maxLength={LIMITS.description.max}
                  disabled={saving}
                  error={fieldError('description')}
                  hint={`${draft.description.length}/${LIMITS.description.max}`}
                  onChange={(e) => change({ description: e.target.value })}
                />
              </div>
            </Card>

            <Card>
              <CardHeader
                title={`Schedule (${plural(draft.entries.length, 'workout')})`}
                subtitle={`Up to ${LIMITS.planWorkouts.max} premade workouts across ${plural(weeks, 'week')}, seven days each.`}
                action={
                  <Button
                    id={ADD_WORKOUTS_ID}
                    size="sm"
                    variant="secondary"
                    icon={<Plus size={16} />}
                    disabled={saving || draft.entries.length >= LIMITS.planWorkouts.max}
                    onClick={() => setPicker({ open: true, week: 1 })}
                  >
                    Add workouts
                  </Button>
                }
              />
              {fieldError('workouts') ? (
                <p role="alert" className="mb-3 text-xs text-danger">{fieldError('workouts')}</p>
              ) : null}

              {overrun.length ? (
                <section className="mb-4 rounded-md border border-danger bg-danger-soft/40 p-3" aria-labelledby="catalog-overrun-heading">
                  <h4 id="catalog-overrun-heading" className="text-sm font-semibold text-danger">
                    Scheduled after the plan ends ({plural(weeks, 'week')})
                  </h4>
                  <p className="mt-0.5 text-xs text-text-2">Pick a week within the plan for each, or remove it.</p>
                  <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-surface-1">
                    {overrun.map((entry) => (
                      <EntryRow
                        key={entry.key}
                        entry={entry}
                        weeks={weeks}
                        error={entryError(entry, ordered.indexOf(entry))}
                        disabled={saving}
                        moveability={{ up: false, down: false }}
                        onSlot={(slot) => change({ entries: reslotEntry(draft.entries, entry.key, slot) })}
                        onMove={() => undefined}
                        onRemove={() => removeEntry(entry.key)}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              <div className="space-y-4">
                {Array.from({ length: weeks }, (_, i) => i + 1).map((week) => {
                  const inWeek = ordered.filter((entry) => entry.week === week);
                  return (
                    <section key={week} aria-labelledby={`catalog-week-${week}`} className="rounded-md border border-line">
                      <header className="flex items-center justify-between gap-3 bg-surface-2 px-3 py-2">
                        <div className="flex items-baseline gap-2">
                          <h4 id={`catalog-week-${week}`} className="text-sm font-semibold text-text-1">
                            Week {week}
                          </h4>
                          <span className="text-xs text-text-2">{inWeek.length ? plural(inWeek.length, 'workout') : 'No workouts yet'}</span>
                        </div>
                        <Button
                          id={`catalog-add-week-${week}`}
                          size="sm"
                          variant="ghost"
                          icon={<Plus size={16} />}
                          disabled={saving || draft.entries.length >= LIMITS.planWorkouts.max}
                          aria-label={`Add workouts to week ${week}`}
                          onClick={() => setPicker({ open: true, week })}
                        >
                          Add
                        </Button>
                      </header>
                      {inWeek.length ? (
                        <ul className="divide-y divide-line" aria-label={`Week ${week} workouts`}>
                          {inWeek.map((entry) => (
                            <EntryRow
                              key={entry.key}
                              entry={entry}
                              weeks={weeks}
                              error={entryError(entry, ordered.indexOf(entry))}
                              disabled={saving}
                              moveability={entryMoveability(draft.entries, entry.key)}
                              onSlot={(slot) => change({ entries: reslotEntry(draft.entries, entry.key, slot) })}
                              onMove={(direction) => moveEntry(entry.key, direction)}
                              onRemove={() => removeEntry(entry.key)}
                            />
                          ))}
                        </ul>
                      ) : (
                        <p className="px-3 py-3 text-center text-xs text-text-3">Nothing scheduled this week.</p>
                      )}
                    </section>
                  );
                })}
              </div>
            </Card>
          </div>

          <aside className="space-y-5">
            <Card>
              <CardHeader title="Summary" />
              <FactList
                facts={[
                  { label: 'Workouts scheduled', value: plural(draft.entries.length, 'workout') },
                  {
                    label: 'Estimated calories',
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <Flame size={14} className="text-accent" /> {fmtKcal(estimate)}
                      </span>
                    ),
                  },
                ]}
              />
              <p className="mt-2 text-xs text-text-3">The saved total is recomputed by the API from the scheduled workouts.</p>
            </Card>
            <Card>
              <CoverImageField value={draft.image} onChange={(image) => change({ image })} disabled={saving} error={fieldError('image')} />
            </Card>
            <Card>
              <HashtagsField tags={draft.hashtags} onChange={(hashtags) => change({ hashtags })} disabled={saving} error={fieldError('hashtags')} />
            </Card>
            {baseline ? (
              <Card>
                <CardHeader title="Details" />
                <FactList
                  facts={[
                    { label: 'Engagement', value: `${plural(baseline.likesCount, 'like')}, ${plural(baseline.commentsCount, 'comment')}` },
                    { label: 'Created', value: fmtDateTime(baseline.createdAt) },
                    { label: 'Last updated', value: fmtDateTime(baseline.updatedAt) },
                    { label: 'Plan ID', value: baseline._id, mono: true },
                  ]}
                />
              </Card>
            ) : null}
          </aside>
        </form>
      )}

      {draft ? (
        <WorkoutPicker
          open={picker.open}
          weeks={weeks}
          initialWeek={picker.week}
          entries={draft.entries}
          onAdd={addEntry}
          onClose={() => setPicker((p) => ({ ...p, open: false }))}
        />
      ) : null}

      <ConfirmDialog
        open={confirmLeave}
        title="Discard changes?"
        message="Your unsaved edits to this plan will be lost."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          setTouched(false);
          navigate(backTo);
        }}
      />

      <p className="sr-only" role="status">{announcement}</p>
    </div>
  );
}
