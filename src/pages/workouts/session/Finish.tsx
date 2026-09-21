import { useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ButtonLink, ConfirmDialog, Menu, PageHeader, Section, useToast, type MenuItem } from '../../../components/ui';
import { Trash } from '../../../components/icons';
import { useWorkoutLogIdempotency } from '../../../lib/capabilities';
import { isFeatureDisabled, markSession, programKeys, unmarkSession, type PlanNext, type SessionMarkResult } from '../../../lib/programs';
import type { LogExercise } from '../exerciseDraft';
import { fetchPlan } from '../model';
import { ROW_ACTION } from '../rows';
import { LOGS_KEY } from '../sessions';
import { SessionForm, type LogSeed } from '../SessionForm';
import { TRAIN } from '../sheet';
import { SessionRecap } from './parts';
import { durationMinutes, payloadExercises, summarizeSession } from './math';
import { useSessionStore } from './store';
import type { SessionProgram, SessionSummary, WorkoutSession } from './types';

/**
 * `/workouts/session/finish` — what happened, then what to save.
 *
 * The recap comes first because it is the reward: Time · Volume · Sets, then
 * one line per exercise with its best set. Under it the existing session form
 * arrives pre-filled from the session — name, type, the elapsed minutes, every
 * set with its `setRecords` — so the member adjusts what the runner could not
 * know (kcal, a note, a wrong name) and presses Log session once.
 *
 * The draft stays until the server has the log, so a reload here still resumes
 * and a failed save loses nothing. `clientRequestId` rides the POST when the
 * capability allows it, which is what makes a retry after a lost
 * acknowledgement return the log already created rather than a second one.
 *
 * A session started from a programme carries its plan slot
 * (`session.program`). Once the log exists the slot is marked done on
 * `POST /plans/:id/enrollment/sessions` — keyed the same way, and after the
 * log, never instead of it — and the recap says so in one line with an Undo
 * beside it. The mark is a bonus on top of a saved session: a refusal (the
 * `programs` flag off, a slot the plan no longer has) leaves the log exactly
 * where it would have been.
 */

/** The session as the form's prefill: the per-set exercises the wire takes, plus what the member can edit. */
export function logSeedFrom(session: WorkoutSession, now: number = Date.now()): LogSeed {
  return {
    name: session.name.trim() || 'Workout',
    type: session.type || 'strength',
    date: session.startedAt,
    duration: durationMinutes(session.startedAt, session.finishedAt, now),
    notes: session.notes,
    setRecordsVersion: 1,
    exercises: payloadExercises(session) as LogExercise[],
  };
}

/** "Counted toward Strength Builder · Week 2 · Day 3" — the whole programme story on the recap. */
export function countedLine(planTitle: string | null | undefined, slot: Pick<SessionProgram, 'week' | 'day'>): string {
  return `Counted toward ${planTitle || 'your plan'} · Week ${slot.week} · Day ${slot.day}`;
}

/** "Plan complete — Cardio Momentum is next", or just "Plan complete" when the API names nothing. */
export function planCompleteLine(next: PlanNext | undefined): string {
  return next?.title ? `Plan complete — ${next.title} is next` : 'Plan complete';
}

/** What the recap holds on to after the save: the session is gone by then, so its numbers travel here. */
type Counted = {
  summary: SessionSummary;
  logId: string | null;
  program: SessionProgram;
  completed: boolean;
  next: PlanNext;
};

export default function Finish() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const session = useSessionStore((s) => s.session);
  const discard = useSessionStore((s) => s.discard);
  const keyedLogs = useWorkoutLogIdempotency();
  const [discarding, setDiscarding] = useState(false);
  const [counted, setCounted] = useState<Counted | null>(null);
  // Saving clears the session and navigates in the same tick; this keeps the
  // "nothing open" redirect below from racing the navigation to the log.
  const leaving = useRef(false);

  const program = session?.program ?? counted?.program ?? null;
  // The plan's title, for the counted line. Read as soon as the recap opens —
  // usually already in the cache from the plan page — so the line has a name
  // rather than filling one in a beat after it appears.
  const plan = useQuery({ queryKey: ['workout-plan', program?.planId], queryFn: () => fetchPlan(program?.planId as string), enabled: Boolean(program?.planId), retry: false });

  // The form's prefill is computed once: re-deriving it on every keystroke
  // would reset what the member has typed into it.
  const seed = useMemo(() => (session ? logSeedFrom(session) : null), [session?.sessionId, session?.finishedAt]);
  const summary = useMemo(() => (session ? summarizeSession(session) : null), [session]);

  const undo = useMutation({
    mutationFn: async (done: Counted) => unmarkSession(done.program.planId, done.program),
    onSuccess: (_result, done) => {
      qc.invalidateQueries({ queryKey: programKeys.enrollment(done.program.planId) });
      qc.invalidateQueries({ queryKey: ['plans', 'enrollments'] });
      toast.success('Taken off the plan');
      navigate(done.logId ? TRAIN.session(done.logId) : TRAIN.history, { replace: true, viewTransition: true });
    },
    onError: (e) => toast.error(e, 'Could not undo that'),
  });

  if (counted) {
    const line = countedLine(plan.data?.title, counted.program);
    return (
      <div className="space-y-4 lg:max-w-form lg:space-y-section">
        <PageHeader title="Session" back={TRAIN.hub} hideSectionTabs />

        <Section title={counted.summary.name}>
          <div className="space-y-4">
            <SessionRecap summary={counted.summary} />
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-3">
              <p className="t-body text-text-1">{line}</p>
              <button type="button" className={`${ROW_ACTION} ml-auto`} disabled={undo.isPending} onClick={() => undo.mutate(counted)}>
                Undo
              </button>
            </div>
            {counted.completed ? <p className="t-body text-text-1">{planCompleteLine(counted.next)}</p> : null}
          </div>
        </Section>

        <div className="space-y-2">
          <ButtonLink to={counted.logId ? TRAIN.session(counted.logId) : TRAIN.history} variant="secondary" block>
            See the session
          </ButtonLink>
          <ButtonLink to={TRAIN.plan(counted.program.planId)} variant="quiet" block>
            Back to the plan
          </ButtonLink>
        </div>
      </div>
    );
  }

  // Nothing open: a cold load of this URL, or a session that was discarded.
  if (!session || !seed || !summary) return leaving.current ? null : <Navigate to={TRAIN.hub} replace />;

  const menu: MenuItem[] = [
    { label: 'Discard session', icon: <Trash size={18} />, onSelect: () => setDiscarding(true), danger: true },
  ];

  /**
   * The log exists; the slot it was trained for is marked done. The log id is
   * the direct reference; when the POST answered without one the receipt key
   * resolves it server-side, but only when the log actually travelled keyed.
   */
  const markProgramSession = async (slot: SessionProgram, logId: string | undefined, logKey: string): Promise<SessionMarkResult> =>
    markSession(slot.planId, {
      week: slot.week,
      day: slot.day,
      order: slot.order,
      source: 'log',
      ...(logId ? { workoutLogId: logId } : keyedLogs ? { workoutLogClientRequestId: logKey } : {}),
    });

  return (
    <div className="space-y-4 lg:max-w-form lg:space-y-section">
      <PageHeader title="Session" back={TRAIN.hub} hideSectionTabs actions={<Menu items={menu} label="Session options" />} />

      <Section title={summary.name}>
        <SessionRecap summary={summary} />
      </Section>

      <Section title="Save it">
        <SessionForm
          seed={seed}
          clientRequestId={session.clientRequestId}
          description="The runner filled this in. Adjust anything it could not know, then log it."
          cancelLabel="Back to the session"
          onCancel={() => navigate(TRAIN.liveSession(), { viewTransition: true })}
          onSaved={(saved) => {
            // The log exists on the server now, so the draft has nothing left to protect.
            leaving.current = true;
            const slot = session.program ?? null;
            const logKey = session.clientRequestId;
            discard();
            qc.invalidateQueries({ queryKey: LOGS_KEY });
            qc.invalidateQueries({ queryKey: ['workout-progress'] });
            qc.invalidateQueries({ queryKey: ['workouts'] });
            toast.success('Session logged', { key: 'session-saved' });
            if (!slot) {
              navigate(saved?._id ? TRAIN.session(saved._id) : TRAIN.history, { replace: true, viewTransition: true });
              return;
            }
            // The mark rides after the log and never blocks it: the recap holds
            // while it runs, and a refusal simply moves on to the saved session.
            void markProgramSession(slot, saved?._id, logKey)
              .then((result) => {
                qc.invalidateQueries({ queryKey: programKeys.enrollment(slot.planId) });
                qc.invalidateQueries({ queryKey: ['plans', 'enrollments'] });
                setCounted({ summary, logId: saved?._id ?? null, program: slot, completed: result.completed === true, next: result.next ?? null });
              })
              .catch((e) => {
                // The flag being off is a state, not a failure; anything else is said out loud.
                if (!isFeatureDisabled(e)) toast.error(e, 'The session is saved. It was not counted toward the plan.');
                navigate(saved?._id ? TRAIN.session(saved._id) : TRAIN.history, { replace: true, viewTransition: true });
              });
          }}
        />
      </Section>

      <ConfirmDialog
        open={discarding}
        title="Discard this session?"
        message="The sets you have logged here will be gone. Nothing is saved to your history."
        confirmLabel="Discard"
        destructive
        onCancel={() => setDiscarding(false)}
        onConfirm={() => {
          leaving.current = true;
          discard();
          setDiscarding(false);
          navigate(TRAIN.hub, { replace: true, viewTransition: true });
        }}
      />
    </div>
  );
}
