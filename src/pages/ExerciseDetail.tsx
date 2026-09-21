import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errMsg } from '../lib/api';
import { RouteSheet } from '../components/RouteSheet';
import { Button, ErrorState, Section, Skeleton, Textarea, cx, formatStat, humanize, prefersReducedMotion, useReducedMotion, useToast } from '../components/ui';
import { Activity, ArrowUp, BarChart, Dumbbell, Layers, Target } from '../components/icons';
import type { IconComponent } from '../components/icons';
import { useUnits } from '../lib/units';
import {
  RECORD_TYPES,
  RECORD_TYPE_TITLES,
  formatRecordValue,
  sessionLine,
  shortDate,
  type ProgressHistory,
} from '../lib/progress';
import {
  deleteExerciseNote,
  exerciseFacts,
  exerciseKeys,
  fetchExercise,
  fetchExerciseHistory,
  fetchExerciseRecords,
  isLibraryUnavailable,
  putExerciseNote,
  thumbnailOf,
  type Exercise,
} from '../lib/exerciseLibrary';
import { TRAIN, useSheetClose, useSheetNav } from './workouts/sheet';

/**
 * /exercises/:slug — one movement from the shared library: its two frames,
 * what it works, how to do it, and the member's own past with it.
 *
 * A sheet over the page that opened it on `lg+`, an ordinary page on phones
 * and on a cold load, so the URL is always a complete screen (RouteSheet owns
 * the title in both presentations).
 *
 * `slug` IS the `exerciseId` the records API keys on, so Records and History
 * work for any id the member has logged — including a custom one the library
 * has never heard of. That is why a 404 from the library read is not an error
 * here: the page keeps the member's own history and drops the reference half.
 *
 * Nothing on this page is blue. Starting a session from one exercise has no
 * route to carry it, so the page offers no primary action rather than a
 * button that would have to invent one.
 */

/* ------------------------------------------------------------------ frames */

const FACT_GLYPH: Record<string, IconComponent> = {
  equipment: Dumbbell,
  primary: Target,
  secondary: Layers,
  level: BarChart,
  force: ArrowUp,
  mechanic: Activity,
};

/** Each frame reserves its box from the width/height the API sent, so the page never reflows as photos land. */
function Frame({ url, width, height, label, className, style }: { url: string; width: number; height: number; label?: string; className?: string; style?: React.CSSProperties }) {
  return (
    <img
      src={url}
      alt={label ?? ''}
      aria-hidden={label ? undefined : 'true'}
      loading="lazy"
      decoding="async"
      width={width}
      height={height}
      className={cx('h-full w-full object-cover', className)}
      style={style}
    />
  );
}

/**
 * Frame 0 (the start) and frame 1 (the end) at 800 px. With motion allowed
 * they crossfade in one box, which is how the movement reads; under Reduce
 * Motion — the OS preference or the account flag — they sit side by side as a
 * labelled pair and nothing moves. An exercise with no photos draws nothing:
 * a missing datum is omitted, never a grey placeholder.
 */
export function ExerciseFrames({ exercise, reduce = false }: { exercise: Pick<Exercise, 'media' | 'name'>; reduce?: boolean }) {
  const start = thumbnailOf(exercise, 800, 0);
  const end = thumbnailOf(exercise, 800, 1);
  const pair = Boolean(start && end);
  const [showEnd, setShowEnd] = useState(false);

  useEffect(() => {
    if (reduce || !pair) return;
    const id = window.setInterval(() => setShowEnd((v) => !v), 1600);
    return () => window.clearInterval(id);
  }, [reduce, pair]);

  if (!start) return null;
  const box = 'relative overflow-hidden rounded-md border border-line bg-surface-2';
  const ratio = { aspectRatio: `${start.width} / ${start.height}` };

  if (!pair || reduce) {
    return (
      <div className={pair ? 'grid grid-cols-2 gap-2' : undefined}>
        <figure className={box} style={ratio}>
          <Frame {...start} label={`${exercise.name}, start position`} />
        </figure>
        {pair && end ? (
          <figure className={box} style={{ aspectRatio: `${end.width} / ${end.height}` }}>
            <Frame {...end} label={`${exercise.name}, end position`} />
          </figure>
        ) : null}
      </div>
    );
  }

  return (
    <figure className={box} style={ratio} aria-label={`${exercise.name}, start and end position`} role="img">
      <Frame {...start} className={cx('absolute inset-0 transition-opacity dur-3', showEnd ? 'opacity-0' : 'opacity-100')} />
      <Frame {...(end as NonNullable<typeof end>)} className={cx('absolute inset-0 transition-opacity dur-3', showEnd ? 'opacity-100' : 'opacity-0')} />
    </figure>
  );
}

/* ------------------------------------------------------------------- facts */

/** Equipment · Primary · Secondary · Level · Force · Mechanic, only the rows the record carries. */
export function ExerciseFactList({ exercise }: { exercise: Exercise }) {
  const facts = exerciseFacts(exercise);
  if (!facts.length) return null;
  return (
    <dl className="divide-y divide-line">
      {facts.map((fact) => {
        const Glyph = FACT_GLYPH[fact.key] ?? Activity;
        return (
          <div key={fact.key} className="flex min-h-12 items-center gap-3 py-2">
            <span aria-hidden="true" className="shrink-0 text-text-3">
              <Glyph size={18} />
            </span>
            <dt className="t-meta w-24 shrink-0">{fact.label}</dt>
            <dd className="t-body min-w-0 flex-1 text-text-1">{fact.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/* -------------------------------------------------------------- my note */

function MyNote({ slug, note }: { slug: string; note: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note ?? '');

  useEffect(() => {
    setText(note ?? '');
    setEditing(false);
  }, [note]);

  const patchCache = (next: string | null) =>
    qc.setQueryData<Exercise>(exerciseKeys.detail(slug), (old) =>
      old ? { ...old, myNote: next ? { exerciseId: slug, note: next, updatedAt: new Date().toISOString() } : null } : old,
    );

  const save = useMutation({
    mutationFn: () => putExerciseNote(slug, text),
    onSuccess: (saved) => {
      patchCache(saved.note);
      setEditing(false);
      toast.success('Note saved');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save your note')),
  });

  const clear = useMutation({
    mutationFn: () => deleteExerciseNote(slug),
    onSuccess: () => {
      patchCache(null);
      setText('');
      setEditing(false);
      toast.success('Note cleared');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not clear your note')),
  });

  const busy = save.isPending || clear.isPending;

  return (
    <Section
      title="My note"
      action={
        editing ? null : (
          <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>
            {note ? 'Edit' : 'Add a note'}
          </Button>
        )
      }
    >
      {editing ? (
        <div className="space-y-3">
          <Textarea
            label="Your note"
            hideLabel
            rows={2}
            autoGrow
            maxRows={6}
            maxLength={500}
            placeholder="Cues, a setting, what your knees think of it."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {note ? (
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => clear.mutate()}>
                Clear
              </Button>
            ) : null}
            <Button
              variant="quiet"
              size="sm"
              disabled={busy}
              onClick={() => {
                setText(note ?? '');
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="secondary" size="sm" loading={save.isPending} disabled={!text.trim()} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        </div>
      ) : note ? (
        <p className="t-body text-text-1">{note}</p>
      ) : (
        <p className="t-body text-text-2">Pin one thing you want to remember the next time this comes round.</p>
      )}
    </Section>
  );
}

/* ----------------------------------------------------------------- skeleton */

function PageBodySkeleton() {
  return (
    <div className="space-y-section" aria-busy="true" aria-label="Loading exercise">
      <Skeleton className="w-full rounded-md" style={{ aspectRatio: '3 / 2' }} />
      <div className="divide-y divide-line">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex min-h-12 items-center gap-3 py-2">
            <Skeleton className="h-[18px] w-[18px] rounded-xs" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3.5 flex-1" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 w-full" />
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- page */

const HISTORY_PAGE = 100;

export default function ExerciseDetail() {
  const { slug = '' } = useParams();
  const system = useUnits((s) => s.system);
  const close = useSheetClose(TRAIN.hub);
  const { state: sheetState } = useSheetNav();
  // The OS media query, plus the account's own Reduce Motion flag.
  const reduce = useReducedMotion() || prefersReducedMotion();

  const exercise = useQuery({ queryKey: exerciseKeys.detail(slug), queryFn: () => fetchExercise(slug), enabled: !!slug, retry: false, staleTime: 60 * 60_000 });
  // Records and history key on the raw id, so they answer for a custom exercise too.
  const records = useQuery({ queryKey: exerciseKeys.records(slug), queryFn: () => fetchExerciseRecords(slug), enabled: !!slug, retry: false, staleTime: 60_000 });
  const history = useInfiniteQuery({
    queryKey: exerciseKeys.history(slug),
    queryFn: ({ pageParam }) => fetchExerciseHistory(slug, pageParam as number, HISTORY_PAGE),
    initialPageParam: 1,
    getNextPageParam: (last: ProgressHistory) => (last.hasNextPage ? last.page + 1 : undefined),
    enabled: !!slug,
    retry: false,
    staleTime: 60_000,
  });

  /** A 404 means the library does not know this id (a custom exercise, or an old one): keep the member's own half. */
  const libraryMiss = isLibraryUnavailable(exercise.error);
  const data = exercise.data ?? null;
  const name = data?.name || (libraryMiss ? humanize(slug) : '');
  const sessions = history.data?.pages.flatMap((p) => p.sessions) ?? [];
  const total = history.data?.pages[0]?.total ?? 0;
  const recordRows = RECORD_TYPES.map((type) => ({ type, record: records.data?.[type] ?? null })).filter((row) => row.record);
  const attribution = data?.attribution ?? null;
  const sourceUrl = data?.source?.url ?? null;

  return (
    <RouteSheet title={name || 'Exercise'} backTo={TRAIN.hub} onClose={close} size="lg">
      {exercise.isPending && !libraryMiss ? (
        <PageBodySkeleton />
      ) : exercise.isError && !libraryMiss ? (
        <ErrorState error={exercise.error} title="Could not load this exercise" onRetry={() => exercise.refetch()} />
      ) : (
        <div className="space-y-section">
          {data ? <ExerciseFrames exercise={data} reduce={reduce} /> : null}

          {libraryMiss ? (
            <p className="t-body text-text-2">This one is not in the Vybe library — it is yours. Your sets and records for it are below.</p>
          ) : null}

          {data ? <ExerciseFactList exercise={data} /> : null}

          {data?.instructions?.length ? (
            <Section title="How to do it">
              <ol className="list-decimal space-y-2 pl-5">
                {data.instructions.map((step, i) => (
                  <li key={i} className="t-body text-text-1">
                    {step}
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}

          {/* Records exist only once there is a past to beat, so this section is absent rather than empty. */}
          {recordRows.length ? (
            <Section title="Records">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {recordRows.map(({ type, record }) => (
                  <div key={type} className="rounded-md bg-surface-2 p-3">
                    <dt className="t-meta">{RECORD_TYPE_TITLES[type]}</dt>
                    <dd className="type-stat mt-1 text-lg text-text-1">{formatRecordValue(type, record!.value, system)}</dd>
                    <dd className="t-meta">{`${shortDate(record!.date)}${record!.reps ? ` · ${record!.reps} reps` : ''}`}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          ) : null}

          <Section title="History" action={total ? <span className="t-meta tabular">{formatStat(total)}</span> : null}>
            {history.isPending ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading your history">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-1.5 py-2">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                ))}
              </div>
            ) : history.isError ? (
              <ErrorState error={history.error} title="Could not load your history" onRetry={() => history.refetch()} />
            ) : sessions.length === 0 ? (
              <p className="t-body text-text-2">You haven’t logged this one yet.</p>
            ) : (
              <>
                <ol className="divide-y divide-line">
                  {sessions.map((row) => {
                    const line = sessionLine(row, system);
                    return (
                      <li key={`${row.workoutId}-${row.date}`} className="pressable relative rounded-sm py-2">
                        <Link
                          to={TRAIN.session(row.workoutId)}
                          state={sheetState}
                          viewTransition
                          aria-label={`Open ${row.name} from ${shortDate(row.date)}`}
                          className="absolute inset-0 z-[1] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                        />
                        <p className="t-body text-text-1">
                          {line.text}
                          {line.approximate ? <span className="t-meta ml-2">approximate</span> : null}
                        </p>
                        <p className="t-meta">{`${shortDate(row.date)} · ${row.name}`}</p>
                      </li>
                    );
                  })}
                </ol>
                {history.hasNextPage ? (
                  <div className="flex justify-center pt-3">
                    <Button variant="secondary" loading={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>
                      Load more
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </Section>

          {/* The note route takes any logged id, but only the library read tells us the current one. */}
          {data ? <MyNote slug={slug} note={data.myNote?.note ?? null} /> : null}

          {attribution ? (
            <p className="t-meta">
              {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-text-1">
                  {attribution}
                </a>
              ) : (
                attribution
              )}
            </p>
          ) : null}
        </div>
      )}
    </RouteSheet>
  );
}
