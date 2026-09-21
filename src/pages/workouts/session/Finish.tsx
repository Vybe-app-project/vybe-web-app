import { useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog, Menu, PageHeader, Section, useToast, type MenuItem } from '../../../components/ui';
import { Trash } from '../../../components/icons';
import type { LogExercise } from '../exerciseDraft';
import { LOGS_KEY } from '../sessions';
import { SessionForm, type LogSeed } from '../SessionForm';
import { TRAIN } from '../sheet';
import { SessionRecap } from './parts';
import { durationMinutes, payloadExercises, summarizeSession } from './math';
import { useSessionStore } from './store';
import type { WorkoutSession } from './types';

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

export default function Finish() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const session = useSessionStore((s) => s.session);
  const discard = useSessionStore((s) => s.discard);
  const [discarding, setDiscarding] = useState(false);
  // Saving clears the session and navigates in the same tick; this keeps the
  // "nothing open" redirect below from racing the navigation to the log.
  const leaving = useRef(false);

  // The form's prefill is computed once: re-deriving it on every keystroke
  // would reset what the member has typed into it.
  const seed = useMemo(() => (session ? logSeedFrom(session) : null), [session?.sessionId, session?.finishedAt]);
  const summary = useMemo(() => (session ? summarizeSession(session) : null), [session]);

  // Nothing open: a cold load of this URL, or a session that was discarded.
  if (!session || !seed || !summary) return leaving.current ? null : <Navigate to={TRAIN.hub} replace />;

  const menu: MenuItem[] = [
    { label: 'Discard session', icon: <Trash size={18} />, onSelect: () => setDiscarding(true), danger: true },
  ];

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
            discard();
            qc.invalidateQueries({ queryKey: LOGS_KEY });
            qc.invalidateQueries({ queryKey: ['workout-progress'] });
            qc.invalidateQueries({ queryKey: ['workouts'] });
            toast.success('Session logged');
            navigate(saved?._id ? TRAIN.session(saved._id) : TRAIN.history, { replace: true, viewTransition: true });
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
