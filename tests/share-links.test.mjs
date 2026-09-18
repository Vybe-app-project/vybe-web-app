import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);
const { shareDestination, appDeepLink } = await import('../src/lib/shareLinks.ts');

test('meal share tokens reach the shared endpoint while legacy meal IDs keep their detail route', () => {
  for (const token of ['ab'.repeat(32), 'CD'.repeat(32)]) {
    assert.equal(shareDestination('meal', token), `/meals/shared/${token}`);
    assert.equal(appDeepLink('meal', token), `vybe://open?type=meal&id=${token}`);
  }
  assert.equal(shareDestination('meal', '507f1f77bcf86cd799439011'), '/meals/507f1f77bcf86cd799439011');
});

test('other handoff types retain their destinations after adding token-aware meal sharing', () => {
  const destinations = {
    post: '/p/fixture', profile: '/u/fixture', workout: '/workouts/fixture',
    gym: '/gyms?gym=fixture', 'meal-template': '/meals/templates?shared=fixture',
    'meal-plan': '/meals/plans?shared=fixture',
  };
  for (const [type, destination] of Object.entries(destinations)) {
    assert.equal(shareDestination(type, 'fixture'), destination);
  }
});

test('malformed share targets cannot bypass the handoff destination rules', () => {
  for (const id of ['', null, '../private', 'https://example.invalid', 'a?next=/admin', 'a'.repeat(129)]) {
    assert.equal(shareDestination('meal', id), null);
  }
  assert.equal(shareDestination('unknown', 'fixture'), null);
});
