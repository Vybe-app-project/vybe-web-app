import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export function localWorkoutDatabase(environment = process.env) {
  const rawPort = environment.VYBE_E2E_MONGO_PORT ?? '27018';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('VYBE_E2E_MONGO_PORT must name an unprivileged loopback test port.');
  }
  const replicaSet = environment.VYBE_E2E_REPLICA_SET ?? 'rs0';
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(replicaSet)) {
    throw new Error('VYBE_E2E_REPLICA_SET must be a plain replica-set name.');
  }
  const database = `vybe_workout_e2e_${randomUUID().replaceAll('-', '')}`;
  return {
    database,
    uri: `mongodb://127.0.0.1:${port}/${database}?replicaSet=${replicaSet}`,
  };
}

const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

function backendSnapshot(directory) {
  const resolved = realpathSync(directory);
  return {
    directory: resolved,
    root: realpathSync(git(resolved, 'rev-parse', '--show-toplevel')),
    name: JSON.parse(readFileSync(path.join(resolved, 'package.json'), 'utf8')).name,
    commit: git(resolved, 'rev-parse', 'HEAD'),
    status: git(resolved, 'status', '--porcelain', '--untracked-files=normal', '--', '.', ':(exclude)node_modules'),
  };
}

export function validateBackendSnapshot(snapshot, expectedCommit) {
  if (snapshot.root !== snapshot.directory) {
    throw new Error('VYBE_TEST_BACKEND must point at an isolated repository root.');
  }
  if (snapshot.name !== 'vybe-backend') throw new Error('The selected fixture is not the Vybe backend.');
  if (!/^[a-f0-9]{40}$/.test(snapshot.commit)
      || (expectedCommit !== undefined && expectedCommit !== snapshot.commit)) {
    throw new Error('The backend does not match VYBE_TEST_BACKEND_COMMIT.');
  }
  if (snapshot.status) throw new Error('The backend fixture must remain at its clean pinned commit.');
  return { directory: snapshot.directory, commit: snapshot.commit };
}

export function pinBackendSource(directory, expectedCommit) {
  return validateBackendSnapshot(backendSnapshot(directory), expectedCommit);
}

export function assertBackendUnchanged({ directory, commit }) {
  validateBackendSnapshot(backendSnapshot(directory), commit);
}

export async function cleanupWorkoutFixture(steps) {
  const errors = [];
  for (const step of steps) {
    try { await step(); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Workout E2E fixture cleanup failed.');
}
