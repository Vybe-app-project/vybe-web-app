import { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { errMsg } from '../../lib/api';
import { useUnits } from '../../lib/units';
import {
  FORMAT_LABELS,
  IMPORT_ACCEPT,
  IMPORT_FORMATS_COPY,
  IMPORT_MAX_BYTES,
  commitWorkoutImport,
  csvBlobOf,
  noteIfMissing,
  plural,
  previewWorkoutImport,
  type ImportMapping,
  type ImportPreview,
  type ImportResult,
  type ImportUnmatchedRow,
  type ImportWeightUnit,
} from '../../lib/portability';
import { shortDate } from '../../lib/progress';
import {
  Button,
  ButtonLink,
  Card,
  CardHeader,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Textarea,
  cx,
  formatStat,
  useToast,
} from '../ui';
import { Check, Upload } from '../icons';
import { ExercisePicker } from './ExercisePicker';

/**
 * /workouts/import — bring your history from Strong or Hevy.
 *
 * Three steps in one page, phone first: pick the file (or paste its text),
 * read the preview, import.
 *
 * The preview is `POST /api/me/import/workouts?dryRun=1`: the same parse and
 * the same library match as the commit, with nothing written. It answers what
 * the file holds (sessions, sets, distinct exercise names), how many sessions
 * this member has already imported (the commit replays those), how many hold
 * nothing storable, and the two exercise lists — `matched[]` with the library
 * row each name lands on, `unmatched[]` with the `custom-…` id the commit
 * would use and up to five candidates.
 *
 * The mapping is kept here and sent with the commit rather than re-previewed
 * on every pick: a preview is a full upload of the file, and nothing on the
 * card depends on the mapping except the rows this page already knows how to
 * redraw. `mapping` is read ahead of the matcher on the commit, so a pick also
 * overrides a match the member disagrees with.
 *
 * The unit is a commit option too. `unitDetected` reports what the FILE names
 * (Hevy's header, Strong's older Weight Unit column); null means nothing in
 * the file said, which is every newer Strong export — that is the cue to ask
 * before writing, so the toggle appears exactly then.
 *
 * A 404 NOT_FOUND (a deployment without the route) is not an error state: the
 * page says one line and lib/portability takes the entry points away.
 */

type Source = { blob: Blob; name: string; size: number; kind: 'file' | 'text' };

const COPY = {
  title: 'Import workouts',
  subtitle: 'Bring your history from another app.',
  pickTitle: 'Choose your export',
  pickCta: 'Choose a file',
  pasteLabel: 'Or paste the file’s text',
  pasteHint: 'Open the export in a text editor and paste the whole thing, header row included.',
  pasteCta: 'Use this text',
  previewTitle: 'What we found',
  mappingTitle: 'Exercises',
  mappingHint: 'Matched to the Vybe library where we could. Change anything that looks wrong.',
  choose: 'Choose',
  keepCustom: 'Keep as custom',
  custom: 'Custom exercise',
  importCta: 'Import',
  importing: 'Importing…',
  startOver: 'Choose a different file',
  doneTitle: 'Your history is in',
  viewHistory: 'View history',
  unitLabel: 'Weights in this file',
  unitHint: 'This export does not say, so pick the unit the other app used.',
  missing: 'Importing is not available on this server yet.',
  tooLarge: 'That file is larger than 5 MB. Export a shorter date range and try again.',
  empty: 'That file had nothing in it.',
  notesLine: 'Notes come across with the sessions and the exercises that carry them.',
} as const;

/* ------------------------------------------------------------------ pieces */

/** The counts the preview reports, each as its own sentence. */
export function previewFacts(preview: ImportPreview): string[] {
  const out = [`${plural(preview.workouts, 'session')} · ${plural(preview.sets, 'set')} · ${plural(preview.exercises, 'exercise')}`];
  if (preview.dateRange) out.push(`${shortDate(preview.dateRange.from)} to ${shortDate(preview.dateRange.to)}`);
  return out;
}

/**
 * What the commit will pass over, one hairline row per reason. The route
 * reports counts, not lines: `alreadyImported` are sessions whose key already
 * has a receipt for this member (a re-upload, or a longer export of the same
 * history) and `invalid` are sessions with nothing storable. Neither is named
 * per line by the API, so neither is invented here.
 */
export function skippedRows(preview: ImportPreview): Array<{ key: string; count: number; reason: string }> {
  const rows: Array<{ key: string; count: number; reason: string }> = [];
  if (preview.alreadyImported > 0) {
    rows.push({ key: 'already', count: preview.alreadyImported, reason: 'already on Vybe from an earlier import — these are left as they are' });
  }
  if (preview.invalid > 0) {
    rows.push({ key: 'invalid', count: preview.invalid, reason: 'hold no sets, time or distance we can store' });
  }
  return rows;
}

/** How many sessions the commit would actually write. */
export const newSessions = (preview: ImportPreview): number =>
  Math.max(0, preview.workouts - preview.alreadyImported - preview.invalid);

export type MappingRow = {
  /** The name exactly as the file wrote it — the key the API matches on. */
  name: string;
  sets: number;
  /** What it lands on: a library name, the member's pick, or null for a custom exercise. */
  target: string | null;
  resolved: boolean;
  suggestions: ImportUnmatchedRow['suggestions'];
};

/** One row per source name: `matched[]` first as the API sorts them, then `unmatched[]`. */
export function mappingRows(preview: ImportPreview | undefined, picks: Record<string, string>): MappingRow[] {
  if (!preview) return [];
  const matched: MappingRow[] = preview.matched.map((row) => ({
    name: row.name,
    sets: row.count,
    target: row.exerciseName,
    resolved: true,
    suggestions: [],
  }));
  const unmatched: MappingRow[] = preview.unmatched.map((row) => ({
    name: row.name,
    sets: row.count,
    target: picks[row.name] ?? null,
    resolved: picks[row.name] !== undefined,
    suggestions: row.suggestions,
  }));
  return [...matched, ...unmatched];
}

function MappingTable({
  rows,
  onChoose,
  onKeepCustom,
}: {
  rows: ReadonlyArray<MappingRow>;
  onChoose?: (name: string) => void;
  onKeepCustom?: (name: string) => void;
}) {
  return (
    <ul className="divide-y divide-line" data-testid="import-mapping">
      {rows.map((row) => (
        <li key={row.name} className="flex items-center gap-3 py-2.5 text-sm">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-text-1">{row.name}</p>
            <p className="t-meta truncate">
              {row.target ? row.target : COPY.custom}
              {` · ${plural(row.sets, 'set')}`}
            </p>
          </div>
          {!row.resolved && (onChoose || onKeepCustom) ? (
            <div className="flex shrink-0 items-center gap-1">
              {onChoose ? (
                <Button variant="link" size="sm" onClick={() => onChoose(row.name)}>
                  {COPY.choose}
                </Button>
              ) : null}
              {onKeepCustom ? (
                <Button variant="link" size="sm" onClick={() => onKeepCustom(row.name)}>
                  {COPY.keepCustom}
                </Button>
              ) : null}
            </div>
          ) : (
            <Check size={16} className="shrink-0 text-text-3" aria-hidden="true" />
          )}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------- page */

export default function ImportWorkouts() {
  const toast = useToast();
  const system = useUnits((s) => s.system);
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [text, setText] = useState('');
  const [unit, setUnit] = useState<ImportWeightUnit>(system === 'imperial' ? 'lbs' : 'kg');
  /** name as written in the file → the id the commit should file it under. */
  const [mapping, setMapping] = useState<ImportMapping>({});
  /** The same picks, by their display name, so the table can show what was chosen. */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [choosing, setChoosing] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const preview = useMutation({
    mutationFn: (next: Source) => previewWorkoutImport(next.blob, next.name),
    onError: (e) => {
      if (noteIfMissing('import', e)) setMissing(true);
    },
  });

  const commit = useMutation({
    mutationFn: (next: Source) => commitWorkoutImport(next.blob, next.name, { unit, mapping }),
    onSuccess: (data) => setResult(data),
    onError: (e) => {
      if (noteIfMissing('import', e)) setMissing(true);
      else toast.error(errMsg(e, 'Could not import that file.'));
    },
  });

  const start = (next: Source) => {
    if (next.size > IMPORT_MAX_BYTES) {
      toast.error(COPY.tooLarge);
      return;
    }
    if (next.size === 0) {
      toast.error(COPY.empty);
      return;
    }
    setResult(null);
    setMapping({});
    setPicked({});
    setSource(next);
    preview.mutate(next);
  };

  const pickFile = (file?: File | null) => {
    if (!file) return;
    start({ blob: file, name: file.name || 'workouts.csv', size: file.size, kind: 'file' });
  };

  const usePasted = () => {
    const body = text.trim();
    if (!body) return;
    const blob = csvBlobOf(body);
    start({ blob, name: 'pasted.csv', size: blob.size, kind: 'text' });
  };

  const reset = () => {
    setSource(null);
    setText('');
    setResult(null);
    setMapping({});
    setPicked({});
    preview.reset();
    commit.reset();
    if (fileRef.current) fileRef.current.value = '';
  };

  const data = preview.data;
  const rows = useMemo(() => mappingRows(data, picked), [data, picked]);
  const unresolved = rows.filter((row) => !row.resolved).length;
  const askUnit = !!data && data.unitDetected === null;
  const previewError = preview.isError && !missing ? preview.error : null;

  function keepCustom(name: string) {
    const row = data?.unmatched.find((entry) => entry.name === name);
    if (!row) return;
    setMapping((prev) => ({ ...prev, [name]: row.exerciseId }));
    setPicked((prev) => ({ ...prev, [name]: COPY.custom }));
  }

  if (missing) {
    return (
      <div className="space-y-section">
        <PageHeader title={COPY.title} back="/workouts/history" />
        <Card>
          <p className="t-body text-text-2">{COPY.missing}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-section">
      <PageHeader title={COPY.title} subtitle={COPY.subtitle} back="/workouts/history" />

      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        aria-label={COPY.pickCta}
        onChange={(e) => pickFile(e.currentTarget.files?.[0])}
      />

      {result ? (
        /* -------------------------------------------------------- step (c) done */
        <Card data-testid="import-done">
          <CardHeader title={COPY.doneTitle} subtitle={`${plural(result.imported, 'session')} added from ${FORMAT_LABELS[result.format] ?? result.format}`} />
          <ul className="t-meta space-y-1">
            {result.skipped > 0 ? <li>{`${plural(result.skipped, 'session')} were already here and were left alone.`}</li> : null}
            {result.invalid > 0 ? <li>{`${plural(result.invalid, 'session')} held nothing we could store.`}</li> : null}
            {result.unmatchedExercises.length ? (
              <li>{`Kept as custom exercises: ${result.unmatchedExercises.slice(0, 6).join(', ')}${result.unmatchedExercises.length > 6 ? '…' : ''}`}</li>
            ) : null}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink to="/workouts/history" variant="primary">
              {COPY.viewHistory}
            </ButtonLink>
            <Button variant="ghost" onClick={reset}>
              {COPY.startOver}
            </Button>
          </div>
        </Card>
      ) : !source ? (
        /* -------------------------------------------------------- step (a) pick */
        <>
          <Card data-testid="import-pick">
            <CardHeader title={COPY.pickTitle} subtitle={IMPORT_FORMATS_COPY} />
            <Button variant="primary" icon={<Upload size={18} />} onClick={() => fileRef.current?.click()}>
              {COPY.pickCta}
            </Button>
          </Card>
          <Card>
            <Textarea
              label={COPY.pasteLabel}
              hint={COPY.pasteHint}
              rows={5}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
            />
            <Button variant="secondary" className="mt-3" disabled={!text.trim()} onClick={usePasted}>
              {COPY.pasteCta}
            </Button>
          </Card>
        </>
      ) : (
        /* ----------------------------------------------------- step (b) preview */
        <>
          <Card data-testid="import-preview">
            <CardHeader
              title={COPY.previewTitle}
              subtitle={data ? `${FORMAT_LABELS[data.format] ?? data.format} · ${source.kind === 'file' ? source.name : COPY.pasteCta}` : source.name}
              action={
                <Button variant="link" size="sm" onClick={reset}>
                  {COPY.startOver}
                </Button>
              }
            />
            {preview.isPending ? (
              <div className="space-y-2" aria-hidden="true">
                <Skeleton className="h-5 w-56 rounded-xs" />
                <Skeleton className="h-4 w-40 rounded-xs" />
              </div>
            ) : previewError ? (
              <p className="t-body text-danger-text" role="status">
                {errMsg(previewError, 'Could not read that file.')}
              </p>
            ) : data ? (
              <div className="space-y-3">
                {previewFacts(data).map((line, i) => (
                  <p key={line} className={cx(i === 0 ? 't-body text-text-1' : 't-meta')}>
                    {line}
                  </p>
                ))}
                {data.notes.workouts + data.notes.exercises > 0 ? <p className="t-meta">{COPY.notesLine}</p> : null}
                {skippedRows(data).length ? (
                  <ul className="divide-y divide-line border-t border-line pt-1" data-testid="import-skipped">
                    {skippedRows(data).map((row) => (
                      <li key={row.key} className="py-2 text-sm text-text-2">
                        <span className="font-semibold text-text-1">{formatStat(row.count)}</span>
                        {` ${row.count === 1 ? 'session' : 'sessions'} ${row.reason}.`}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {askUnit ? (
                  <div className="space-y-1.5 border-t border-line pt-3">
                    <p className="t-body text-text-1">{COPY.unitLabel}</p>
                    <p className="t-meta">{COPY.unitHint}</p>
                    <SegmentedControl
                      aria-label={COPY.unitLabel}
                      size="sm"
                      className="max-w-[12rem]"
                      tabs={[
                        { key: 'kg', label: 'kg' },
                        { key: 'lbs', label: 'lb' },
                      ]}
                      value={unit}
                      onChange={(k) => setUnit(k as ImportWeightUnit)}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>

          {rows.length ? (
            <Card>
              <CardHeader
                title={COPY.mappingTitle}
                subtitle={unresolved ? `${plural(unresolved, 'name')} to check` : COPY.mappingHint}
              />
              <MappingTable rows={rows} onChoose={setChoosing} onKeepCustom={keepCustom} />
            </Card>
          ) : null}

          {data ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" loading={commit.isPending} disabled={commit.isPending} onClick={() => commit.mutate(source)}>
                {commit.isPending ? COPY.importing : `${COPY.importCta} ${plural(newSessions(data), 'session')}`}
              </Button>
              <p className="t-meta">{`${plural(data.workouts, 'session')} in the file.`}</p>
            </div>
          ) : null}
        </>
      )}

      <ExercisePicker
        open={!!choosing}
        initialQuery={choosing ?? ''}
        onClose={() => setChoosing(null)}
        onSelect={(pick) => {
          const name = choosing;
          setChoosing(null);
          if (!name) return;
          const row = data?.unmatched.find((entry) => entry.name === name);
          // A typed-in name is not a library id; keep the exercise custom under
          // the id the API already computed for it rather than guessing one.
          const id = pick.exerciseId ?? row?.exerciseId;
          if (!id) return;
          setMapping((prev) => ({ ...prev, [name]: id }));
          setPicked((prev) => ({ ...prev, [name]: pick.exerciseId ? pick.name : COPY.custom }));
        }}
      />
    </div>
  );
}
