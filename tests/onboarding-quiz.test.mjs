import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

register('./ts-loader.mjs', import.meta.url);

/**
 * P9: the first-run quiz. Every value it can write is one the API has, so
 * the unit tests are mostly "this vocabulary is the server's", and the
 * render checks the four screens a new member actually taps through.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

async function loadModule(relative) {
  const source = read(relative);
  assert.doesNotMatch(source, /^\s*import\s/m, `${relative} must stay import-free so tests can load it directly`);
  const { outputText } = ts.transpileModule(source, {
    fileName: path.basename(relative),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`);
}

const quiz = await loadModule('src/lib/onboardingQuiz.ts');

test('the answers are the server’s own enums, not a vocabulary of our own', () => {
  // models/UserProfile.js TRAINING_GOALS and EXPERIENCE_LEVELS, verbatim.
  assert.deepEqual([...quiz.TRAINING_GOALS], [
    'get-stronger', 'build-muscle', 'move-more', 'build-a-habit', 'train-with-friends', 'improve-endurance', 'feel-better',
  ]);
  assert.deepEqual([...quiz.EXPERIENCE_LEVELS], ['new', 'returning', 'regular', 'experienced']);
  assert.deepEqual([...quiz.WEEKLY_TARGET_OPTIONS], [2, 3, 4, 5, 6]);
  assert.equal(quiz.WEEKLY_TARGET_MIN, 2);
  assert.equal(quiz.WEEKLY_TARGET_MAX, 6);
  // Every value has a label, and no label is invented for a value that is not real.
  for (const goal of quiz.TRAINING_GOALS) assert.equal(typeof quiz.GOAL_LABELS[goal], 'string');
  for (const level of quiz.EXPERIENCE_LEVELS) assert.equal(typeof quiz.EXPERIENCE_LABELS[level], 'string');
  assert.equal(Object.keys(quiz.GOAL_LABELS).length, quiz.TRAINING_GOALS.length);
  assert.deepEqual([...quiz.QUIZ_STEPS], ['goal', 'days', 'experience', 'gym']);
});

test('the body carries only real fields, and a run with no goal writes nothing at all', () => {
  assert.deepEqual(quiz.onboardingBody({ goal: 'get-stronger' }), { trainingGoals: ['get-stronger'] });
  assert.deepEqual(quiz.onboardingBody({ goal: 'build-muscle', weeklyTargetDays: 4, experience: 'regular' }), {
    trainingGoals: ['build-muscle'],
    weeklyTargetDays: 4,
    experienceLevel: 'regular',
  });
  // POST /api/onboarding refuses a first save without a goal, so a skipped
  // goal means no request rather than a 400.
  assert.equal(quiz.onboardingBody({ weeklyTargetDays: 4, experience: 'new' }), null);
  assert.equal(quiz.onboardingBody({}), null);
  assert.equal(quiz.onboardingBody(null), null);
  assert.equal(quiz.onboardingBody({ goal: 'not-a-goal' }), null);
  // Out-of-range or nonsense answers are dropped, never clamped into a lie.
  assert.deepEqual(quiz.onboardingBody({ goal: 'move-more', weeklyTargetDays: 7 }), { trainingGoals: ['move-more'] });
  assert.deepEqual(quiz.onboardingBody({ goal: 'move-more', weeklyTargetDays: 1 }), { trainingGoals: ['move-more'] });
  assert.deepEqual(quiz.onboardingBody({ goal: 'move-more', weeklyTargetDays: 3.5 }), { trainingGoals: ['move-more'] });
  assert.deepEqual(quiz.onboardingBody({ goal: 'move-more', experience: 'expert' }), { trainingGoals: ['move-more'] });
});

test('the goal picks a programme from the words plans already carry, and never invents an id', () => {
  const plans = [
    { _id: 'p1', title: 'Four-Week Fitness Foundation', description: 'Build the habit with three balanced sessions a week.', level: 'beginner' },
    { _id: 'p2', title: 'Strength Builder', goal: 'strength', description: 'Alternating upper and lower sessions.', level: 'intermediate' },
    { _id: 'p3', title: 'Cardio Momentum', description: 'Low-impact to HIIT over five weeks.', level: 'beginner' },
    { _id: 'p4', title: 'Mobility Reset', description: 'A full-body mobility flow for recovery days.', level: 'beginner' },
  ];
  assert.equal(quiz.suggestedPlanFor('get-stronger', plans)._id, 'p2');
  assert.equal(quiz.suggestedPlanFor('build-a-habit', plans)._id, 'p1');
  assert.equal(quiz.suggestedPlanFor('improve-endurance', plans)._id, 'p3');
  assert.equal(quiz.suggestedPlanFor('feel-better', plans)._id, 'p4');
  // No keyword hit: the first beginner plan, then the first plan at all.
  assert.equal(quiz.suggestedPlanFor('train-with-friends', plans)._id, 'p1');
  assert.equal(quiz.suggestedPlanFor(null, [{ _id: 'only', title: 'Whatever', level: 'advanced' }])._id, 'only');
  // Nothing to suggest is nothing, never a guess.
  assert.equal(quiz.suggestedPlanFor('get-stronger', []), null);
  assert.equal(quiz.suggestedPlanFor('get-stronger', null), null);
  assert.equal(quiz.suggestedPlanFor('get-stronger', [{ title: 'No id' }]), null);
});

test('the landing is the browse tab, with the plan id when there is one', () => {
  assert.equal(quiz.SUGGEST_PARAM, 'suggest');
  assert.equal(quiz.quizLandingPath('abc123'), '/workouts?tab=browse&suggest=abc123');
  assert.equal(quiz.quizLandingPath(null), '/workouts?tab=browse', 'no suggestion is still a real destination');
  assert.equal(quiz.quizLandingPath('a b/c'), '/workouts?tab=browse&suggest=a%20b%2Fc');
});

test('the quiz writes through the routes that take these fields, and only at the end', () => {
  const page = read('src/pages/OnboardingQuiz.tsx');
  assert.match(page, /api\.post\('\/onboarding', body\)/);
  assert.match(page, /if \(body\) await api\.post\('\/onboarding', body\);/, 'no goal, no profile write');
  assert.match(page, /setHomeGym\.mutateAsync\(\{ place: \{ osmId: gym\.osmId, name: gym\.name \} \}\)/);
  assert.match(page, /api\.get\('\/gyms\/place-search', \{ params: \{ q: debounced, limit: 6, kind: 'gym' \} \}\)/);
  assert.match(page, /api\.get\('\/workouts\/commom\/workouts\/plan\/all\/premade\/fetch'\)/);
  assert.match(page, /onDone\(quizLandingPath\(suggestion\?\._id \?\? null\)\)/);
  // No made-up fields: there is no user-level equipment or training-location
  // key on this API, so nothing sends one (the module header says why).
  assert.doesNotMatch(page, /equipment:|'equipment'|trainingLocation/);
  assert.doesNotMatch(read('src/lib/onboardingQuiz.ts'), /equipment:|'equipment'|trainingLocation/);
  assert.match(read('src/lib/homeGym.ts'), /api\.put\('\/users\/settings', patch\)/);

  // WelcomeSheet runs it first on a fresh sign-up and only then its own content.
  const sheet = read('src/pages/WelcomeSheet.tsx');
  assert.match(sheet, /import OnboardingQuiz from '\.\/OnboardingQuiz'/);
  assert.match(sheet, /if \(viaMarker && !viaParam && !quizDone\.current\) setQuizOpen\(true\);/);
  assert.match(sheet, /if \(quizOpen\) return <OnboardingQuiz open onDone=\{finishQuiz\} \/>;/);
  assert.match(sheet, /openedOn\.current = landing\.split\('\?'\)\[0\];/, 'the sheet survives the navigation it just made');
  // App.tsx is untouched: the quiz is mounted from the sheet, not a new sibling.
  assert.doesNotMatch(read('src/App.tsx'), /OnboardingQuiz/);

  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'POST /api/onboarding',
    'PUT /api/users/settings',
    'GET /api/gyms/place-search',
    'GET /api/workouts/commom/workouts/plan/all/premade/fetch',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

/* ------------------------------------------------------------------ render */

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const { QuizStepPanel } = await import('../src/pages/OnboardingQuiz.tsx');

const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, '');

function step(props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return decode(
    renderToString(
      h(
        QueryClientProvider,
        { client },
        h(MemoryRouter, null, h(ToastProvider, null, h(QuizStepPanel, { gym: null, answers: {}, onAnswer() {}, onChooseGym() {}, ...props }))),
      ),
    ),
  );
}

test('each step is a list of single-tap answers, and the chosen one is pressed', () => {
  const goal = step({ step: 'goal' });
  for (const label of Object.values(quiz.GOAL_LABELS)) assert.ok(goal.includes(label), `the goal step offers ${label}`);
  assert.equal((goal.match(/aria-pressed="false"/g) || []).length, quiz.TRAINING_GOALS.length, 'nothing is preselected');

  const chosen = step({ step: 'goal', answers: { goal: 'get-stronger' } });
  assert.match(chosen, /aria-pressed="true"[^>]*>[\s\S]{0,400}?Get stronger/);
  assert.equal((chosen.match(/aria-pressed="true"/g) || []).length, 1, 'one answer, not several');

  const days = step({ step: 'days', answers: { weeklyTargetDays: 4 } });
  for (const n of quiz.WEEKLY_TARGET_OPTIONS) assert.ok(days.includes(`${n} days`), `the days step offers ${n}`);
  assert.doesNotMatch(days, />1 days</, 'the server’s range starts at two');
  assert.doesNotMatch(days, />7 days</, 'and stops at six');

  const experience = step({ step: 'experience' });
  for (const label of Object.values(quiz.EXPERIENCE_LABELS)) assert.ok(experience.includes(label), `the experience step offers ${label}`);
});

test('the gym step searches places, offers units, and names the programme it will open on', () => {
  const gym = step({ step: 'gym', suggestion: { _id: 'p2', title: 'Strength Builder' } });
  assert.match(gym, /placeholder="Gym name or street"/);
  assert.match(gym, /aria-label="Units"/, 'units are shown as resolved, not asked as a question');
  assert.match(gym, /We will open on <[^>]*>Strength Builder/);
  const chosen = step({ step: 'gym', gym: { osmId: 'osm-node-1', name: 'Iron Works' } });
  assert.match(chosen, /Iron Works/);
  assert.match(chosen, /Your home gym/);
  // No suggestion, no sentence about one.
  assert.doesNotMatch(step({ step: 'gym' }), /We will open on/);
});

test('an error on the last screen is said in the panel, not swallowed', () => {
  const html = step({ step: 'gym', error: 'Could not save your answers. You can set all of this from Settings.' });
  assert.match(html, /Could not save your answers/);
});
