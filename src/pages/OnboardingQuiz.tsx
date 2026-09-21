import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useSetHomeGym } from '../lib/homeGym';
import {
  EXPERIENCE_LABELS,
  EXPERIENCE_LEVELS,
  GOAL_LABELS,
  QUIZ_DONE,
  QUIZ_STEPS,
  QUIZ_SUBTITLES,
  QUIZ_TITLES,
  SKIP,
  TRAINING_GOALS,
  WEEKLY_TARGET_OPTIONS,
  onboardingBody,
  quizLandingPath,
  suggestedPlanFor,
  type ExperienceLevel,
  type PremadePlan,
  type QuizAnswers,
  type QuizStepKey,
  type TrainingGoal,
} from '../lib/onboardingQuiz';
import { UnitsControl } from '../components/UnitsControl';
import { Button, Callout, Input, Modal, Spinner, cx } from './ui';
import { useDebounced } from '../lib/hooks';
import { Check, MapPin, Search } from './icons';

/**
 * The first-run quiz (WelcomeSheet opens it before its own content).
 *
 * Four questions, one tap each, every one skippable, and each answer goes to
 * a field the API really has — see src/lib/onboardingQuiz.ts for which route
 * takes which key and why the third question asks experience rather than
 * equipment. Nothing is written until the last screen, because
 * `POST /api/onboarding` refuses a first save with no goal.
 *
 * It ends on the Workouts hub with the programme the goal picked
 * (`?suggest=<planId>`), so the quiz changes the first screen rather than
 * only filling a profile.
 */

/** A tap target that is a whole answer: label, optional line, tick when chosen. */
function AnswerTile({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        'pressable flex min-h-14 w-full items-center gap-3 rounded-md border px-3.5 py-2.5 text-left transition-colors dur-1',
        selected ? 'border-brand bg-brand-soft text-brand-text' : 'border-line bg-surface-1 text-text-1 hover:bg-surface-2',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        {hint ? <span className="block text-xs text-text-2">{hint}</span> : null}
      </span>
      {selected ? <Check size={18} className="shrink-0" strokeWidth={2.4} /> : null}
    </button>
  );
}

type PlaceHit = { place_id?: string; placeId?: string; name?: string; vicinity?: string; formatted_address?: string };

/** The gym step: the same `GET /gyms/place-search` the Gyms page uses, `kind=gym`. */
function GymStep({
  chosen,
  onChoose,
}: {
  chosen: { osmId: string; name: string } | null;
  onChoose: (place: { osmId: string; name: string } | null) => void;
}) {
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term.trim(), 350);
  const ready = debounced.length >= 2;
  const places = useQuery({
    queryKey: ['quiz-places', debounced],
    enabled: ready,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get('/gyms/place-search', { params: { q: debounced, limit: 6, kind: 'gym' } });
      return (data.results || data.places || []) as PlaceHit[];
    },
  });

  const hits = (places.data ?? [])
    .map((p) => ({ osmId: String(p.place_id || p.placeId || ''), name: (p.name || '').trim(), where: p.vicinity || p.formatted_address || '' }))
    .filter((p) => p.osmId && p.name);

  return (
    <div className="space-y-3">
      <Input
        type="search"
        inputMode="search"
        autoComplete="off"
        label="Find your gym"
        hideLabel
        placeholder="Gym name or street"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        leading={<Search size={18} />}
        trailing={places.isFetching ? <Spinner size={16} className="mr-1 text-text-2" /> : undefined}
      />
      {chosen ? (
        <AnswerTile label={chosen.name} hint="Your home gym" selected onSelect={() => onChoose(null)} />
      ) : ready && !places.isFetching && hits.length === 0 ? (
        <p className="text-xs text-text-2">No gyms matched “{debounced}”. You can set this later from Settings.</p>
      ) : (
        <ul className="space-y-2">
          {hits.map((hit) => (
            <li key={hit.osmId}>
              <AnswerTile label={hit.name} hint={hit.where || undefined} selected={false} onSelect={() => onChoose({ osmId: hit.osmId, name: hit.name })} />
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line pt-3">
        <p className="type-label mb-1.5 text-text-2">Units</p>
        <UnitsControl size="sm" label="Units" />
        <p className="mt-1.5 text-xs text-text-3">Already set from your region. Change it here if it is wrong.</p>
      </div>
    </div>
  );
}

export default function OnboardingQuiz({ open, onDone }: { open: boolean; onDone: (landing: string | null) => void }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [gym, setGym] = useState<{ osmId: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setHomeGym = useSetHomeGym();

  useEffect(() => {
    if (!open) {
      setIndex(0);
      setAnswers({});
      setGym(null);
      setError(null);
    }
  }, [open]);

  // The premade programmes, so the last step can hand the hub a real plan id.
  // Loaded while the member is still answering, and a failure costs nothing:
  // the quiz then lands on the browse tab with no suggestion.
  const premade = useQuery({
    queryKey: ['premade-plans'],
    enabled: open,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get('/workouts/commom/workouts/plan/all/premade/fetch');
      return ((data?.workouts ?? []) as PremadePlan[]).filter((p) => p && typeof p._id === 'string');
    },
  });

  const step: QuizStepKey = QUIZ_STEPS[Math.min(index, QUIZ_STEPS.length - 1)];
  const last = index >= QUIZ_STEPS.length - 1;
  const suggestion = useMemo(() => suggestedPlanFor(answers.goal ?? null, premade.data), [answers.goal, premade.data]);

  const finish = useMutation({
    mutationFn: async () => {
      // One write for the profile: the first save must carry a goal, so a
      // run that skipped it writes nothing rather than earning a 400.
      const body = onboardingBody(answers);
      if (body) await api.post('/onboarding', body);
      if (gym) await setHomeGym.mutateAsync({ place: { osmId: gym.osmId, name: gym.name } });
    },
    onSuccess: () => onDone(quizLandingPath(suggestion?._id ?? null)),
    onError: (e) => setError(errMsg(e, 'Could not save your answers. You can set all of this from Settings.')),
  });

  const advance = () => {
    setError(null);
    if (last) finish.mutate();
    else setIndex((i) => i + 1);
  };

  /** One tap answers and moves on; the gym step has no single answer, so it uses the footer. */
  const answer = <K extends keyof QuizAnswers>(key: K, value: QuizAnswers[K]) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setError(null);
    setIndex((i) => Math.min(i + 1, QUIZ_STEPS.length - 1));
  };

  const skip = () => {
    setError(null);
    if (last) finish.mutate();
    else setIndex((i) => i + 1);
  };

  return (
    <Modal
      open={open}
      onClose={() => onDone(null)}
      title={QUIZ_TITLES[step]}
      description={QUIZ_SUBTITLES[step]}
      size="sm"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <Button variant="ghost" onClick={skip} disabled={finish.isPending}>
            {SKIP}
          </Button>
          <span className="tabular text-xs text-text-3" aria-hidden="true">
            {index + 1} of {QUIZ_STEPS.length}
          </span>
          {last ? (
            <Button variant="primary" onClick={advance} loading={finish.isPending}>
              {QUIZ_DONE}
            </Button>
          ) : (
            <span />
          )}
        </div>
      }
    >
      <QuizStepPanel
        step={step}
        answers={answers}
        error={error}
        gym={gym}
        suggestion={suggestion}
        onAnswer={answer}
        onChooseGym={setGym}
      />
    </Modal>
  );
}

/**
 * The body of one step. Split out of the sheet so it renders on its own --
 * the Modal draws nothing without a document, and these four screens are
 * the part worth testing.
 */
export function QuizStepPanel({
  step,
  answers,
  error,
  gym,
  suggestion,
  onAnswer,
  onChooseGym,
}: {
  step: QuizStepKey;
  answers: QuizAnswers;
  error?: string | null;
  gym: { osmId: string; name: string } | null;
  suggestion?: PremadePlan | null;
  onAnswer: <K extends keyof QuizAnswers>(key: K, value: QuizAnswers[K]) => void;
  onChooseGym: (place: { osmId: string; name: string } | null) => void;
}) {
  return (
    <div className="space-y-3">
      {error ? <Callout tone="danger">{error}</Callout> : null}

      {step === 'goal' ? (
        <ul className="space-y-2">
          {TRAINING_GOALS.map((goal: TrainingGoal) => (
            <li key={goal}>
              <AnswerTile label={GOAL_LABELS[goal]} selected={answers.goal === goal} onSelect={() => onAnswer('goal', goal)} />
            </li>
          ))}
        </ul>
      ) : null}

      {step === 'days' ? (
        <ul className="grid grid-cols-2 gap-2">
          {WEEKLY_TARGET_OPTIONS.map((days) => (
            <li key={days}>
              <AnswerTile label={`${days} days`} selected={answers.weeklyTargetDays === days} onSelect={() => onAnswer('weeklyTargetDays', days)} />
            </li>
          ))}
        </ul>
      ) : null}

      {step === 'experience' ? (
        <ul className="space-y-2">
          {EXPERIENCE_LEVELS.map((level: ExperienceLevel) => (
            <li key={level}>
              <AnswerTile label={EXPERIENCE_LABELS[level]} selected={answers.experience === level} onSelect={() => onAnswer('experience', level)} />
            </li>
          ))}
        </ul>
      ) : null}

      {step === 'gym' ? (
        <>
          <GymStep chosen={gym} onChoose={onChooseGym} />
          {suggestion ? (
            <p className="flex items-start gap-2 rounded-md bg-surface-2 p-3 text-xs text-text-2">
              <MapPin size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
              <span>
                We will open on <span className="font-semibold text-text-1">{suggestion.title}</span>.
              </span>
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
