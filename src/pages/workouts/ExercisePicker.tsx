import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button, Chip, ErrorState, Modal, ScrollX, SearchField, Section, cx, formatStat } from '../../components/ui';
import { Info, Plus } from '../../components/icons';
import {
  EXERCISE_PAGE_SIZE,
  LIBRARY_UNAVAILABLE_COPY,
  exerciseKeys,
  exerciseMetaLine,
  fetchExerciseMeta,
  fetchRecentExercises,
  isLibraryUnavailable,
  labelsOf,
  metaIsEmpty,
  searchExercises,
  thumbnailOf,
  type ExerciseLabels,
  type ExerciseMedia,
  type ExerciseSummary,
  type RecentExercise,
} from '../../lib/exerciseLibrary';
import { CategoryTile, RowSkeleton } from './rows';

/**
 * "Choose from library": the exercise picker over a workout editor or a
 * session form. A sheet on phones, a dialog from `md`.
 *
 * Search is debounced 200 ms — the route allows 300 searches per 15 minutes
 * per member, and a keystroke is not a search. With nothing typed the sheet
 * reads as a place rather than a search box: the member's Recent lifts first,
 * then the catalogue in popularity order, paged by `hasNextPage`.
 *
 * Chips are fine in here (a picker is where a filter belongs; the Train hub
 * itself has none), and they come from `/meta` so "EZ curl bar" reads as the
 * data says rather than as a humanised key.
 *
 * The library is still being imported into production, so a 404 or an empty
 * `/meta` is not an error: it is one quiet line and a working "use what you
 * typed" row. A custom exercise is a first-class answer here — every row of
 * every editor still accepts a free-text name.
 *
 * Rows are pure props so they render under react-dom/server
 * (tests/exercise-library.render.test.mjs).
 */

export type ExercisePick = {
  /** The library slug — the stable `exerciseId` the records API keys on — or null for a custom exercise. */
  exerciseId: string | null;
  name: string;
  /** The rendition the API returned, so the editor row can draw the same thumbnail without a second read. */
  thumbnail?: ExerciseMedia | null;
  /** "Barbell · Quads · Beginner", already labelled. */
  meta?: string;
};

/** 72 px, the Train hub's row geometry: 48 px tile · name · meta · trailing control. */
const ROW = 'relative flex min-h-18 items-center gap-3 py-2';
const OVERLAY = 'absolute inset-0 z-[1] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus';

/** The 48 px frame-0 thumbnail at 200 px, or the glyph tile when the exercise has no photos. */
export function ExerciseThumb({ exercise, className }: { exercise: Pick<ExerciseSummary, 'media' | 'category'>; className?: string }) {
  const shot = thumbnailOf(exercise, 200, 0);
  if (!shot) return <CategoryTile category={exercise.category ?? undefined} className={className} />;
  return (
    <img
      src={shot.url}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      width={shot.width}
      height={shot.height}
      className={cx('h-12 w-12 shrink-0 rounded-md border border-line bg-surface-2 object-cover', className)}
    />
  );
}

/**
 * One result. The whole row chooses the exercise; the trailing "i" opens the
 * exercise page in a new tab, because the editor under this sheet is a route
 * and navigating away from it would take the half-typed session with it.
 */
export function ExerciseResultRow({
  exercise,
  labels,
  extra,
  infoTo,
}: {
  exercise: ExerciseSummary;
  labels?: ExerciseLabels;
  /** "Logged 4 times" and the like, appended to the meta line. */
  extra?: string | null;
  /** The exercise page; omitted for a custom id the library does not know. */
  infoTo?: string;
}) {
  const meta = [exerciseMetaLine(exercise, labels), extra].filter(Boolean).join(' · ');
  return (
    <>
      <ExerciseThumb exercise={exercise} />
      <div className="min-w-0 flex-1">
        <p className="t-name truncate text-text-1">{exercise.name}</p>
        {meta ? <p className="t-meta truncate">{meta}</p> : null}
      </div>
      {infoTo ? (
        <span className="relative z-[2] flex shrink-0 items-center">
          <Link
            to={infoTo}
            target="_blank"
            rel="noopener"
            aria-label={`About ${exercise.name}`}
            className="pressable -mr-2 inline-flex h-11 w-9 items-center justify-center rounded-sm text-text-3"
          >
            <Info size={18} aria-hidden="true" />
          </Link>
        </span>
      ) : null}
    </>
  );
}

function ResultList({
  items,
  labels,
  onChoose,
  label,
  extraOf,
}: {
  items: ReadonlyArray<ExerciseSummary | RecentExercise>;
  labels?: ExerciseLabels;
  onChoose: (exercise: ExerciseSummary) => void;
  label?: string;
  extraOf?: (exercise: ExerciseSummary | RecentExercise) => string | null;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-line">
      {items.map((exercise) => (
        <li key={`${exercise.slug}-${exercise.name}`} className={cx(ROW, 'pressable rounded-sm')}>
          <button type="button" data-picker-row="" aria-label={`Choose ${exercise.name}`} className={OVERLAY} onClick={() => onChoose(exercise)} />
          <ExerciseResultRow exercise={exercise} labels={labels} extra={extraOf?.(exercise)} infoTo={exercise.isCustom ? undefined : `/exercises/${exercise.slug}`} />
        </li>
      ))}
    </ul>
  );
}

/** "Use “front squat” as a custom exercise" — the row that keeps a free-text name a first-class answer. */
export function CustomExerciseRow({ query, onChoose }: { query: string; onChoose: () => void }) {
  return (
    <ul className="divide-y divide-line">
      <li className={cx(ROW, 'pressable rounded-sm')}>
        <button type="button" data-picker-row="" className={OVERLAY} onClick={onChoose} aria-label={`Use ${query} as a custom exercise`} />
        <CategoryTile icon={<Plus size={22} />} />
        <div className="min-w-0 flex-1">
          <p className="t-name truncate text-text-1">{`Use “${query}” as a custom exercise`}</p>
          <p className="t-meta">It is logged under the name you typed and keeps its own records.</p>
        </div>
      </li>
    </ul>
  );
}

function ChipRow({ label, chips, value, onChange }: { label: string; chips: ReadonlyArray<{ key: string; label: string }>; value: string | null; onChange: (next: string | null) => void }) {
  if (!chips.length) return null;
  return (
    <ScrollX role="group" aria-label={label} className="flex gap-2 pb-1">
      {chips.map((chip) => (
        <Chip key={chip.key} className="shrink-0" selected={value === chip.key} onClick={() => onChange(value === chip.key ? null : chip.key)}>
          {chip.label}
        </Chip>
      ))}
    </ScrollX>
  );
}

export function ExercisePicker({
  open,
  initialQuery = '',
  onClose,
  onSelect,
}: {
  open: boolean;
  /** Seeded from the name the member has already typed on the row. */
  initialQuery?: string;
  onClose: () => void;
  onSelect: (pick: ExercisePick) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(initialQuery);
  const [q, setQ] = useState(initialQuery.trim());
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);

  // Opening starts from the row's own name with no filters; the sheet stays
  // mounted so it can animate out, so this is what resets it.
  useEffect(() => {
    if (!open) return;
    setText(initialQuery);
    setQ(initialQuery.trim());
    setMuscle(null);
    setEquipment(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 200 ms: the search route allows 300 requests per 15 minutes per member.
  useEffect(() => {
    const id = window.setTimeout(() => setQ(text.trim()), 200);
    return () => window.clearTimeout(id);
  }, [text]);

  // `retry: false` on all three: a 404 here is the feature detection, not a flake.
  const meta = useQuery({ queryKey: exerciseKeys.meta(), queryFn: fetchExerciseMeta, enabled: open, retry: false, staleTime: 60 * 60_000 });
  const filtering = Boolean(q || muscle || equipment);
  const recent = useQuery({ queryKey: exerciseKeys.recent(), queryFn: fetchRecentExercises, enabled: open && !filtering, retry: false, staleTime: 60_000 });
  const results = useInfiniteQuery({
    queryKey: exerciseKeys.search({ q, muscle: muscle ?? undefined, equipment: equipment ?? undefined }),
    queryFn: ({ pageParam }) => searchExercises({ q, muscle: muscle ?? undefined, equipment: equipment ?? undefined, page: pageParam as number, limit: EXERCISE_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNextPage ? last.page + 1 : undefined),
    enabled: open,
    retry: false,
    staleTime: 60_000,
  });

  const labels = useMemo(() => labelsOf(meta.data), [meta.data]);
  const items = useMemo(() => results.data?.pages.flatMap((p) => p.exercises) ?? [], [results.data]);
  const total = results.data?.pages[0]?.total;
  const recentItems = recent.data ?? [];

  /** The import has not landed on this deployment: a quiet line, never an error state. */
  const unavailable = isLibraryUnavailable(meta.error) || isLibraryUnavailable(results.error) || metaIsEmpty(meta.data);
  const listError = results.isError && !isLibraryUnavailable(results.error) ? results.error : null;
  const resolved = !results.isPending && !results.isFetching;
  const noMatch = resolved && !listError && items.length === 0;

  const choose = (exercise: ExerciseSummary) => {
    onSelect({ exerciseId: exercise.slug, name: exercise.name, thumbnail: thumbnailOf(exercise, 200, 0), meta: exerciseMetaLine(exercise, labels) });
    onClose();
  };
  const chooseCustom = () => {
    onSelect({ exerciseId: null, name: text.trim() || initialQuery.trim() });
    onClose();
  };

  /**
   * Roving focus without a widget: the rows are ordinary buttons, so Enter
   * and Space already select. Arrow keys walk them, and ArrowUp from the
   * first row goes back to the field; Enter in the field takes the first row.
   */
  const rowButtons = (): HTMLElement[] => Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('[data-picker-row]') ?? []);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    const rows = rowButtons();
    if (!rows.length) return;
    const inField = document.activeElement === searchRef.current;
    if (e.key === 'Enter') {
      if (!inField) return;
      e.preventDefault();
      rows[0].click();
      return;
    }
    const at = rows.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    if (e.key === 'ArrowDown') rows[at < 0 ? 0 : Math.min(rows.length - 1, at + 1)].focus();
    else if (at <= 0) searchRef.current?.focus();
    else rows[at - 1].focus();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose an exercise"
      description="Search the library, or keep the name you typed."
      size="md"
      initialFocusRef={searchRef}
    >
      <div ref={bodyRef} className="space-y-4" onKeyDown={onKeyDown}>
        <SearchField
          ref={searchRef}
          label="Search exercises"
          hideLabel
          placeholder={meta.data?.total ? `Search ${formatStat(meta.data.total)} exercises` : 'Search exercises'}
          maxLength={100}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {unavailable ? <p className="t-body text-text-2">{LIBRARY_UNAVAILABLE_COPY}</p> : null}

        {!unavailable && meta.data ? (
          <div className="space-y-2">
            <ChipRow label="Muscle" chips={meta.data.muscleGroups} value={muscle} onChange={setMuscle} />
            <ChipRow label="Equipment" chips={meta.data.equipment} value={equipment} onChange={setEquipment} />
          </div>
        ) : null}

        {!filtering && recentItems.length ? (
          <Section title="Recent">
            <ResultList items={recentItems} labels={labels} onChoose={choose} label="Recently logged" />
          </Section>
        ) : null}

        <Section title={filtering ? 'Results' : 'All exercises'} action={total ? <span className="t-meta tabular">{formatStat(total)}</span> : null}>
          {results.isPending ? (
            <RowSkeleton rows={6} />
          ) : listError ? (
            <ErrorState error={listError} title="Could not load the exercise library" onRetry={() => results.refetch()} />
          ) : items.length ? (
            <>
              <ResultList items={items} labels={labels} onChoose={choose} label={filtering ? 'Search results' : 'Exercise library'} />
              {results.hasNextPage ? (
                <div className="flex flex-col items-center gap-2 pt-3">
                  {total ? (
                    <p className="t-meta">
                      Showing {formatStat(items.length)} of {formatStat(total)}
                    </p>
                  ) : null}
                  <Button variant="secondary" loading={results.isFetchingNextPage} onClick={() => results.fetchNextPage()}>
                    Load more
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </Section>

        {/* The typed name is always an answer: when nothing matched it is the only row, so the sheet never dead-ends. */}
        {noMatch && (text.trim() || initialQuery.trim()) ? <CustomExerciseRow query={text.trim() || initialQuery.trim()} onChoose={chooseCustom} /> : null}
        {noMatch && !text.trim() && !initialQuery.trim() ? (
          <p className="t-body text-text-2">Nothing here yet. Type a name and it is logged as your own exercise.</p>
        ) : null}
      </div>
    </Modal>
  );
}

export default ExercisePicker;
