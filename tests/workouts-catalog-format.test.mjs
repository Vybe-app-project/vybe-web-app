import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const duration = await import('../src/lib/duration.ts');
const challenge = await import('../src/lib/challengeFormat.ts');
const routes = await import('../src/lib/notificationRoutes.ts');
const toasts = await import('../src/lib/toastPlacement.ts');
const trainer = await import('../src/lib/trainerApplication.ts');

test('exercise durations are seconds: 180 reads as 3 min, never "180 min"', () => {
  assert.equal(duration.formatSeconds(180), '3 min');
  assert.equal(duration.formatSeconds(90), '1 min 30 s');
  assert.equal(duration.formatSeconds(45), '45 s');
  assert.equal(duration.formatSeconds(3600), '1 h');
  assert.equal(duration.formatSeconds(0), '');
  assert.equal(duration.formatSeconds(undefined), '');
  assert.deepEqual(duration.secondsParts(120), [['2', 'min']]);
  assert.deepEqual(duration.secondsParts(75), [['1', 'min'], ['15', 's']]);
});

test('challenge time copy is readable for a ten-year window and a 31-day one', () => {
  const now = new Date('2026-09-18T12:00:00Z');
  const tenYears = { startDate: '2026-09-17T12:00:00Z', endDate: '2036-09-17T12:00:00Z' };
  assert.equal(challenge.formatChallengeWindow(tenYears.startDate, tenYears.endDate), 'Sep 17, 2026 – Sep 17, 2036');
  assert.equal(challenge.timeBadgeFor(tenYears, now).label, 'Ongoing');
  assert.equal(challenge.daysRemaining(tenYears.endDate, now), 3652);
  assert.match(challenge.remainingLabel(tenYears.endDate, now), /^10 years remaining$/);

  // Midday stamps so local rendering is the same date in every timezone.
  const month = { startDate: '2026-09-18T12:00:00Z', endDate: '2026-10-19T12:00:00Z' };
  assert.equal(challenge.formatChallengeWindow(month.startDate, month.endDate), 'Sep 18 – Oct 19, 2026');
  assert.equal(challenge.windowDays(month.startDate, month.endDate), 31);
  assert.equal(challenge.remainingLabel(month.endDate, now), '4 weeks remaining');
  assert.equal(challenge.timeBadgeFor(month, now).label, '4 weeks left');

  assert.equal(challenge.remainingLabel('2026-09-19T06:00:00Z', now), 'Ends today');
  assert.deepEqual(challenge.timeBadgeFor({ endDate: '2026-09-20T12:00:00Z' }, now).label, '2 days left');
  assert.equal(challenge.timeBadgeFor({ endDate: '2026-09-01T00:00:00Z' }, now).label, 'Ended');
  assert.equal(challenge.timeBadgeFor({ isActive: false, endDate: '2036-01-01' }, now).label, 'Closed');
  assert.equal(challenge.formatChallengeWindow(null, null), 'Open-ended');
});

test('a custom goal unit uses its label or disappears', () => {
  assert.equal(challenge.unitLabel('workouts'), 'workouts');
  assert.equal(challenge.unitLabel('custom', 'pull-ups'), 'pull-ups');
  assert.equal(challenge.unitLabel('custom'), '');
  assert.equal(challenge.unitLabel('custom', '  '), '');
  assert.equal(challenge.withUnit('40 / 100', challenge.unitLabel('custom')), '40 / 100');
  assert.equal(challenge.withUnit('40 / 100', challenge.unitLabel('custom', 'pull-ups')), '40 / 100 pull-ups');
});

test('goal units singularise for exactly one; custom labels print as written', () => {
  assert.equal(challenge.pluralUnit('workouts', 1), 'workout');
  assert.equal(challenge.pluralUnit('workouts', 2), 'workouts');
  assert.equal(challenge.pluralUnit('workouts', 0), 'workouts');
  assert.equal(challenge.pluralUnit('minutes', 1), 'minute');
  assert.equal(challenge.pluralUnit('calories', 1), 'calorie');
  assert.equal(challenge.pluralUnit('pull-ups', 1), 'pull-ups');
  assert.equal(challenge.pluralUnit('', 1), '');
});

test('the server\'s nameless-sender fallback never reads "you follow liked your workout"', () => {
  const fallback = { type: 'workout_like', sender: { _id: 'u1' }, message: 'Someone you follow liked your workout.', data: { workoutId: 'w1' } };
  assert.equal(routes.notificationSentence(fallback), 'liked your workout.');
  assert.equal(routes.notificationSentence({ ...fallback, sender: null }), 'liked your workout.');
});

test('workout notifications open the workout and never read "Alex Someone liked"', () => {
  const sender = { _id: 'u1', fullName: 'Vybe Test User' };
  const like = { type: 'workout_like', sender, message: 'Vybe Test User liked your workout.', data: { workoutId: 'w1', senderId: 'u1' } };
  assert.equal(routes.notificationHref(like), '/workouts/w1');
  assert.equal(routes.notificationSentence(like), 'liked your workout.');
  const comment = { type: 'workout_comment', sender, message: 'Someone commented on your workout.', data: { workoutId: 'w1' } };
  assert.equal(routes.notificationHref(comment), '/workouts/w1#comments');
  assert.equal(routes.notificationSentence(comment), 'commented on your workout.');
  assert.equal(routes.notificationHref({ type: 'workout_plan_like', data: { workoutPlanId: 'p1' } }), '/workouts/plans/p1');
  assert.equal(routes.notificationHref({ type: 'new_workout', sender, data: { workoutId: 'w2', senderId: 'u1' } }), '/workouts/w2');
  assert.equal(routes.notificationHref({ type: 'post_like', data: { postId: 'p9' } }), '/p/p9');
  assert.equal(routes.notificationHref({ type: 'follow', sender }), '/u/u1');
  assert.equal(routes.notificationHref({ type: 'system' }), null);
  assert.equal(routes.notificationSentence({ type: 'follow', sender }), 'started following you');
});

test('toasts move to the top of a phone screen while a sheet is open and never stack by key', () => {
  assert.match(toasts.toastViewportClass(true, true), /\btop-0\b/);
  assert.doesNotMatch(toasts.toastViewportClass(true, true), /\bbottom-0\b/);
  assert.match(toasts.toastViewportClass(true, false), /\bbottom-0\b.*\bpb-nav\b/);
  assert.match(toasts.toastViewportClass(false, true), /\bbottom-0\b/);
  const list = [{ id: 1, key: 'validation' }, { id: 2 }];
  const next = toasts.upsertToast(list, { id: 3, key: 'validation' });
  assert.deepEqual(next.map((t) => t.id), [2, 3]);
  const full = toasts.upsertToast([{ id: 1 }, { id: 2 }, { id: 3 }], { id: 4 });
  assert.deepEqual(full.map((t) => t.id), [2, 3, 4]);
});

test('the coach application mirrors the API rules', () => {
  assert.equal(trainer.TRAINER_FIELDS.length, 18);
  assert.deepEqual(trainer.TRAINER_FIELDS.map((f) => f.value), [
    'soccer', 'basketball', 'tennis', 'swimming', 'running', 'cycling', 'volleyball', 'baseball',
    'american_football', 'golf', 'boxing', 'martial_arts', 'weightlifting', 'yoga', 'pilates',
    'crossfit', 'general_fitness', 'other',
  ]);
  const ok = trainer.validateTrainerApplication({
    fields: ['yoga'],
    experienceSummary: 'x'.repeat(40),
    credentialUrls: ['https://example.com/cert'],
  });
  assert.deepEqual(ok, {});
  const bad = trainer.validateTrainerApplication({
    fields: [],
    experienceSummary: 'short',
    credentialUrls: ['http://insecure.example', 'a', 'b', 'c', 'd', 'e'],
  });
  assert.ok(bad.fields && bad.experienceSummary && bad.credentialUrls);
  assert.deepEqual(trainer.parseCredentialUrls('https://a.com, https://b.com\nhttps://a.com'), ['https://a.com', 'https://b.com']);
});
