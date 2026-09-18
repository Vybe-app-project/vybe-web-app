import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupWorkoutFixture, localWorkoutDatabase, validateBackendSnapshot } from './workout-e2e-fixture.mjs';

test('database configuration never inherits an operator connection string or name', () => {
  const fixture = localWorkoutDatabase({
    MONGODB_URI: 'mongodb://example.invalid/production',
    VYBE_TEST_DB: 'production',
    VYBE_E2E_MONGO_PORT: '28039',
    VYBE_E2E_REPLICA_SET: 'isolated_fixture',
  });
  assert.match(fixture.database, /^vybe_workout_e2e_[a-f0-9]{32}$/);
  assert.equal(fixture.uri, `mongodb://127.0.0.1:28039/${fixture.database}?replicaSet=isolated_fixture`);
  assert.notEqual(localWorkoutDatabase({}).database, localWorkoutDatabase({}).database);
  assert.match(localWorkoutDatabase({}).uri, /^mongodb:\/\/127\.0\.0\.1:27018\/vybe_workout_e2e_/);
});

test('invalid ports and replica names fail closed', () => {
  for (const port of ['0', '80', '65536', '-1', '27018@elsewhere', '', '1234.5']) {
    assert.throws(() => localWorkoutDatabase({ VYBE_E2E_MONGO_PORT: port }), /test port/);
  }
  for (const replica of ['', 'rs0&authSource=admin', 'rs0/other', 'rs0?key=value']) {
    assert.throws(() => localWorkoutDatabase({ VYBE_E2E_REPLICA_SET: replica }), /replica-set name/);
  }
});

test('cleanup attempts every resource and still fails explicitly', async () => {
  const closed = [];
  const failure = new Error('browser close failed');
  await assert.rejects(cleanupWorkoutFixture([
    async () => { closed.push('browser'); throw failure; },
    async () => { closed.push('server'); },
    async () => { closed.push('database'); },
    async () => { closed.push('profile'); },
  ]), (error) => error instanceof AggregateError && error.errors.includes(failure));
  assert.deepEqual(closed, ['browser', 'server', 'database', 'profile']);
});

test('backend pinning rejects mismatched commits, dirty tracked and untracked source', () => {
  const snapshot = { directory: '/fixture/backend', root: '/fixture/backend', name: 'vybe-backend', commit: 'a'.repeat(40), status: '' };
  assert.deepEqual(validateBackendSnapshot(snapshot, snapshot.commit), { directory: snapshot.directory, commit: snapshot.commit });
  assert.throws(() => validateBackendSnapshot(snapshot, '0'.repeat(40)), /does not match/);
  assert.throws(() => validateBackendSnapshot({ ...snapshot, commit: 'invalid' }), /does not match/);
  assert.throws(() => validateBackendSnapshot({ ...snapshot, root: '/elsewhere' }), /repository root/);
  assert.throws(() => validateBackendSnapshot({ ...snapshot, name: 'another-project' }), /not the Vybe backend/);
  for (const status of [' M package.json', '?? untracked.js']) {
    assert.throws(() => validateBackendSnapshot({ ...snapshot, status }), /clean pinned commit/);
  }
});
