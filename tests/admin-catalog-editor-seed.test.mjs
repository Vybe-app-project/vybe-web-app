import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/query-core';

/**
 * The catalog editors seed their form once from the detail query. TanStack
 * hands back a cached copy of a stale or invalidated record immediately and
 * refreshes it in the background, so "data is defined" is not "data is
 * current": a draft seeded from the cached copy and diffed against the
 * refreshed record would send another admin's change back as a revert.
 * These tests drive @tanstack/query-core (the engine under react-query) with
 * the app's own defaults from src/main.tsx and pin the rule the editors use.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadRules() {
  const source = fs.readFileSync(path.join(root, 'src/pages/admin/catalogRules.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const rules = await loadRules();

// src/main.tsx defaults, minus retries (nothing here fails).
const appDefaults = { retry: false, staleTime: 30_000, refetchOnWindowFocus: false };

const workoutV = (n) => ({
  _id: '64b000000000000000000001',
  title: `Foundations v${n}`,
  description: null,
  category: 'strength',
  level: 'beginner',
  duration: 30,
  caloriesBurned: 200,
  hashtags: [],
  image: null,
  exercises: [{ _id: 'e1', name: 'Squat', sets: 3, reps: 12, duration: null, rest: 45, notes: null, caloriesBurned: null }],
  isPremade: true,
  isPublic: true,
  createdBy: null,
  adminId: null,
  likesCount: 0,
  commentsCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: `2026-09-0${n}T00:00:00.000Z`,
});

/** What useQuery sees on its first render (optimistic result) and after the mount fetch settles. */
function mountDetailQuery(client, options) {
  const defaulted = client.defaultQueryOptions(options);
  defaulted._optimisticResults = 'optimistic';
  const observer = new QueryObserver(client, defaulted);
  const firstRender = observer.getOptimisticResult(defaulted);
  const settled = new Promise((resolve) => {
    const check = (result) => {
      if (result.fetchStatus === 'idle') {
        unsubscribe();
        resolve(result);
      }
    };
    const unsubscribe = observer.subscribe(check);
    check(observer.getCurrentResult());
  });
  return { firstRender, settled };
}

test('seedableRecord accepts only a settled successful fetch', () => {
  const record = { workout: workoutV(1), usedByPlans: 0 };
  assert.equal(rules.seedableRecord({ data: undefined, status: 'pending', fetchStatus: 'fetching' }), null);
  assert.equal(rules.seedableRecord({ data: record, status: 'success', fetchStatus: 'fetching' }), null, 'a cached copy under refetch is not current');
  assert.equal(rules.seedableRecord({ data: record, status: 'success', fetchStatus: 'paused' }), null, 'offline: the refetch has not happened');
  assert.equal(rules.seedableRecord({ data: undefined, status: 'error', fetchStatus: 'idle' }), null);
  assert.equal(rules.seedableRecord({ data: record, status: 'success', fetchStatus: 'idle' }), record);
});

test('a revisit within gcTime serves the invalidated copy first; the gate waits for the refetch', async () => {
  const client = new QueryClient({ defaultOptions: { queries: appDefaults } });
  // catalogKeys.workout(id) from catalogApi.ts, spelled out because that module pulls in the axios client.
  const queryKey = ['admin', 'catalog', 'workouts', 'item', '64b000000000000000000001'];
  let version = 1;
  const queryFn = async () => ({ workout: workoutV(version), usedByPlans: 0 });
  const detailOptions = { queryKey, queryFn, staleTime: 0 };

  // First visit: nothing cached, the editor waits for the fetch like before.
  const first = mountDetailQuery(client, detailOptions);
  assert.equal(first.firstRender.status, 'pending');
  assert.equal(rules.seedableRecord(first.firstRender), null);
  const firstSettled = await first.settled;
  assert.equal(rules.seedableRecord(firstSettled).workout.title, 'Foundations v1');

  // Another admin changes the record; our own console invalidates the prefix
  // (deleting a workout, saving a plan) exactly like the list page does.
  version = 2;
  await client.invalidateQueries({ queryKey: ['admin', 'catalog', 'workouts'], refetchType: 'none' });

  const second = mountDetailQuery(client, detailOptions);
  assert.equal(second.firstRender.status, 'success');
  assert.equal(second.firstRender.fetchStatus, 'fetching');
  assert.equal(second.firstRender.data.workout.title, 'Foundations v1', 'TanStack serves the stale copy on the first render');
  assert.equal(rules.seedableRecord(second.firstRender), null, 'the old "data is defined" rule would have seeded v1 here');
  const secondSettled = await second.settled;
  assert.equal(rules.seedableRecord(secondSettled).workout.title, 'Foundations v2');

  // Third visit seconds later: the entry is fresh by the app default (30 s),
  // so only staleTime 0 on the detail query forces the refetch the gate waits for.
  version = 3;
  const cachedByDefault = mountDetailQuery(client, { queryKey, queryFn });
  assert.equal(cachedByDefault.firstRender.fetchStatus, 'idle');
  assert.equal(rules.seedableRecord(cachedByDefault.firstRender).workout.title, 'Foundations v2', 'without staleTime 0 the gate alone cannot tell a fresh cache from the server');
  await cachedByDefault.settled;
  const refetched = mountDetailQuery(client, detailOptions);
  assert.equal(refetched.firstRender.fetchStatus, 'fetching');
  assert.equal(rules.seedableRecord(refetched.firstRender), null);
  assert.equal(rules.seedableRecord(await refetched.settled).workout.title, 'Foundations v3');
});

test('a draft is diffed against the record it was seeded from, never a later copy', () => {
  const v1 = workoutV(1);
  const v2 = workoutV(2);
  const session = rules.workoutSession(v1._id, v1);
  assert.equal(session.id, v1._id);
  assert.equal(session.baseline, v1);
  assert.deepEqual(rules.workoutSessionBody(session), {}, 'an untouched draft is not a change');
  // The bug: the same draft diffed against the refreshed record reverts the other admin's title.
  assert.deepEqual(rules.buildWorkoutBody(session.draft, v2), { title: 'Foundations v1' });

  session.draft.caloriesBurned = '250';
  assert.deepEqual(rules.workoutSessionBody(session), { caloriesBurned: 250 }, 'only the admin\'s own edit goes on the wire');

  const blank = rules.workoutSession('', null);
  assert.equal(blank.baseline, null);
  assert.equal(rules.workoutSessionBody(blank).title, '');

  const planV1 = {
    _id: '64b000000000000000000101',
    title: 'Starter plan',
    description: null,
    goal: 'Build a habit',
    durationWeeks: 4,
    level: 'beginner',
    hashtags: [],
    image: null,
    workouts: [{ _id: 'p1', day: 1, week: 1, order: 1, workout: { _id: v1._id, title: v1.title, category: 'strength', level: 'beginner', duration: 30, caloriesBurned: 200, image: null, isPremade: true } }],
    totalCaloriesBurned: 200,
    isPremade: true,
    isPublic: true,
    createdBy: null,
    adminId: null,
    likesCount: 0,
    commentsCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  // The workout was deleted from the catalog and the plan lost the entry.
  const planV2 = { ...planV1, workouts: [], totalCaloriesBurned: 0 };
  const planSession = rules.planSession(planV1._id, planV1);
  assert.deepEqual(rules.planSessionBody(planSession), {});
  assert.deepEqual(rules.buildPlanBody(planSession.draft, planV2).workouts, [{ workout: v1._id, day: 1, week: 1, order: 1 }], 'diffing against v2 would re-add the deleted workout');
});
