import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api, errMsg } from '../../lib/api';
import { formatSeconds } from '../../lib/duration';
import { STARTER_SEED_KEY, firstWeekStrings, pickStarterTemplate, starterLogSeed } from '../../lib/firstWeek';
import { displayWeight, useUnits, weightUnit } from '../../lib/units';
import { Badge, Button, ConfirmDialog, ErrorState, Menu, Skeleton, SkeletonText, cx, formatStat, humanize, useToast, type MenuItem } from '../../components/ui';
import { Activity, Clock, Copy, Dumbbell, Edit, Flame, ShareUp, Trash } from '../../components/icons';
import { RouteSheet } from '../../components/RouteSheet';
import { MetaList } from './cards';
import { fetchPremade, fetchWorkout, type SocialWorkout } from './model';
import { LOGS_KEY, dayLabel, fetchLog, parseLogDate, sessionVolume, type WorkoutLog } from './sessions';
import { SessionForm, type LogSeed } from './SessionForm';
import { TRAIN, useSheetClose, useSheetNav } from './sheet';

/**
 * /workouts/history/:logId — one logged session as a sheet over History (a
 * page on phones). `new` is the session form, seeded from `?from=<workoutId>`
 * (a library workout), `?repeat=<logId>` (log the same session again, dated
 * now) or `?starter=1` (the first-week starter). Any other id shows the
 * session with its sets and turns into the revision-aware editor on Edit.
 */

const seedFromWorkout = (w: SocialWorkout): LogSeed => ({
  name: w.title,
  type: w.category,
  duration: w.duration,
  caloriesBurned: w.caloriesBurned,
  exercises: (w.exercises ?? []).map((e) => ({ name: e.name, sets: e.sets, reps: e.reps, weight: e.weight, duration: e.duration, notes: e.notes })),
});

/** Same content, dated now. Set-aware exercises keep their sets and ids (unique within a log is all the API asks). */
const seedFromLog = (log: WorkoutLog): LogSeed => ({
  name: log.name,
  type: log.type,
  duration: log.duration,
  caloriesBurned: log.caloriesBurned,
  notes: log.notes,
  exercises: log.exercises,
  setRecordsVersion: log.setRecordsVersion,
});

const plural = (n: number, one: string, many = `${one}s`) => `${formatStat(n)} ${n === 1 ? one : many}`;

function NewSession() {
  const [params] = useSearchParams();
  const fromId = params.get('from');
  const repeatId = params.get('repeat');
  const starter = params.get('starter') === '1';
  const close = useSheetClose(TRAIN.history);

  const from = useQuery({ queryKey: ['workout', fromId], queryFn: () => fetchWorkout(fromId!), enabled: Boolean(fromId), retry: false });
  const repeat = useQuery({ queryKey: ['workout-log', repeatId], queryFn: () => fetchLog(repeatId!), enabled: Boolean(repeatId), retry: false });
  // The starter comes from the premade catalogue, or the built-in four-move fallback when the catalogue lacks it.
  const premade = useQuery({ queryKey: ['workouts', 'premade'], queryFn: fetchPremade, enabled: starter, retry: false });

  const waiting = (fromId && from.isPending) || (repeatId && repeat.isPending) || (starter && premade.isPending);
  if (waiting) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Preparing your session">
        <Skeleton className="h-11 w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  let seed: { key: string; value: LogSeed } | null = null;
  let description = 'What you did, when, and how much you moved.';
  if (starter) {
    seed = { key: STARTER_SEED_KEY, value: starterLogSeed(premade.isSuccess ? pickStarterTemplate(premade.data) : null) };
    description = firstWeekStrings.starter.logDescription;
  } else if (fromId && from.data) {
    seed = { key: from.data._id, value: seedFromWorkout(from.data) };
    description = `Based on ${from.data.title}. Adjust what you actually did.`;
  } else if (repeatId && repeat.data) {
    seed = { key: `repeat:${repeat.data._id}`, value: seedFromLog(repeat.data) };
    description = `Same as ${repeat.data.name || 'your last session'}, dated now. Adjust what changed.`;
  }
  const seedFailed = (fromId && from.isError) || (repeatId && repeat.isError);

  return (
    <>
      {seedFailed ? <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-text-2">Could not load that session to copy from, so this one starts empty.</p> : null}
      <SessionForm
        key={seed?.key ?? 'blank'}
        seed={seed?.value}
        description={description}
        onCancel={close}
        onSaved={() => {
          close();
        }}
      />
    </>
  );
}

function ExerciseFacts({ ex, unit, system }: { ex: WorkoutLog['exercises'][number]; unit: 'kg' | 'lb'; system: 'metric' | 'imperial' }) {
  if (Array.isArray(ex.setRecords) && ex.setRecords.length) {
    return (
      <ol className="mt-1 flex flex-wrap gap-1.5" aria-label={`${ex.name} sets`}>
        {ex.setRecords.map((s, i) => (
          <li key={s.id} className={cx('type-stat rounded-xs px-2 py-0.5 text-xs', s.completed ? 'bg-surface-1 text-text-1' : 'bg-surface-2 text-text-3 line-through')} title={s.completed ? `Set ${i + 1}` : `Set ${i + 1}, not completed`}>
            {s.weight > 0 ? `${formatStat(s.weight)} ${s.weightUnit} × ` : ''}
            {formatStat(s.reps)}
          </li>
        ))}
      </ol>
    );
  }
  const facts = [
    ex.sets ? `${formatStat(ex.sets)} × ${formatStat(ex.reps ?? 0)}` : ex.reps ? `${formatStat(ex.reps)} reps` : null,
    ex.weight ? `${formatStat(displayWeight(ex.weight, system))} ${unit}` : null,
    ex.duration ? formatSeconds(ex.duration) : null,
    ex.distance ? `${formatStat(ex.distance)} km` : null,
  ].filter(Boolean) as string[];
  if (!facts.length) return null;
  return (
    <span className="type-stat shrink-0 text-sm text-text-2">
      {facts.map((f, j) => (
        <span key={f} className={cx(j > 0 && 'ml-2.5')}>
          {f}
        </span>
      ))}
    </span>
  );
}

function SessionBody({ log, onEdit, onRepeat, onDelete }: { log: WorkoutLog; onEdit: () => void; onRepeat: () => void; onDelete: () => void }) {
  const system = useUnits((s) => s.system);
  const unit = weightUnit(system);
  const d = parseLogDate(log.date);
  const volume = sessionVolume(log);
  const exercises = log.exercises ?? [];
  const menu: MenuItem[] = [
    { label: 'Edit', icon: <Edit size={18} />, onSelect: onEdit },
    { label: 'Log again', description: 'Same session, dated now', icon: <Copy size={18} />, onSelect: onRepeat },
    // Where the runner sends a member after it saves. The web composer cannot
    // attach a workout yet (POST /posts/create takes content and media only),
    // so this opens it with the log named in `?share=` — the seam a composer
    // that can read a workout picks up without this link changing.
    { label: 'Share to feed', description: 'Opens the composer', icon: <ShareUp size={18} />, to: `/?compose=1&share=${log._id}` },
    { label: 'Delete', icon: <Trash size={18} />, danger: true, divider: true, onSelect: onDelete },
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-2">
            {d ? (
              <time dateTime={d.toISOString()} className="tabular">
                {dayLabel(d)} · {format(d, 'HH:mm')}
              </time>
            ) : (
              <span>Unknown time</span>
            )}
            {log.type ? <Badge size="sm">{humanize(log.type)}</Badge> : null}
          </p>
          <MetaList
            className="mt-2"
            items={[
              !!log.duration && { icon: <Clock size={14} />, label: `${formatStat(log.duration)} min` },
              !!log.caloriesBurned && { icon: <Flame size={14} />, label: `${formatStat(log.caloriesBurned)} kcal` },
              volume > 0 && { icon: <Dumbbell size={14} />, label: `${formatStat(displayWeight(volume, system), { compact: volume >= 10_000 })} ${unit} lifted` },
              { icon: <Activity size={14} />, label: plural(exercises.length, 'exercise') },
            ]}
          />
        </div>
        <Menu items={menu} label={`Options for ${log.name || 'workout'}`} className="-mr-2 -mt-1.5 shrink-0" />
      </div>

      {exercises.length > 0 ? (
        <ol className="divide-y divide-line rounded-md bg-surface-2">
          {exercises.map((ex, i) => (
            <li key={ex.exerciseId ?? `${log._id}-${i}`} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 font-medium text-text-1">{ex.name}</span>
              <ExerciseFacts ex={ex} unit={unit} system={system} />
              {ex.notes ? <p className="basis-full text-xs text-text-2">{ex.notes}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {log.notes ? <p className="prose-measure text-sm text-text-2">{log.notes}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <Button variant="quiet" icon={<Copy size={18} />} onClick={onRepeat}>
          Log again
        </Button>
        <Button variant="secondary" icon={<Edit size={18} />} onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

function ExistingSession({ logId }: { logId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { open } = useSheetNav();
  const [params] = useSearchParams();
  // ?edit=1 lands straight in the editor (History's Edit action).
  const [editing, setEditing] = useState(params.get('edit') === '1');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const log = useQuery({ queryKey: ['workout-log', logId], queryFn: () => fetchLog(logId) });

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/workouts/logs/${logId}`);
    },
    onSuccess: () => {
      toast.success('Session deleted');
      qc.removeQueries({ queryKey: ['workout-log', logId] });
      qc.invalidateQueries({ queryKey: LOGS_KEY });
      qc.invalidateQueries({ queryKey: ['workout-progress'] });
      navigate(TRAIN.history, { replace: true, viewTransition: true });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete session')),
  });

  if (log.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading session">
        <SkeletonText lines={2} />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (log.isError || !log.data) {
    return <ErrorState error={log.error} title="Session not found" message="It may have been deleted." onRetry={() => log.refetch()} />;
  }
  const data = log.data;
  return (
    <>
      {editing ? (
        <SessionForm
          key={`${data._id}:${data.revision ?? 0}`}
          editing={data}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            if (saved) qc.setQueryData(['workout-log', logId], saved);
            setEditing(false);
          }}
        />
      ) : (
        <SessionBody log={data} onEdit={() => setEditing(true)} onRepeat={() => open(TRAIN.newSession({ repeat: data._id }))} onDelete={() => setConfirmDelete(true)} />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete session?"
        message={`${data.name || 'This session'} will be removed from your history and your weekly totals.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

export default function SessionDetail() {
  const { logId = '' } = useParams();
  const close = useSheetClose(TRAIN.history);
  const isNew = logId === 'new';
  const existing = useQuery({ queryKey: ['workout-log', logId], queryFn: () => fetchLog(logId), enabled: !isNew && Boolean(logId) });
  const title = isNew ? 'Log a session' : existing.data?.name || 'Session';
  return (
    <RouteSheet title={title} onClose={close}>
      {isNew ? <NewSession /> : <ExistingSession logId={logId} />}
    </RouteSheet>
  );
}
