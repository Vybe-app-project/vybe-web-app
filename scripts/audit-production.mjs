import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = spawnSync(
  process.execPath,
  [process.env.npm_execpath, 'audit', '--omit=dev', '--json'],
  { cwd: root, encoding: 'utf8' },
);

assert.ok(audit.stdout, audit.stderr || 'npm audit returned no JSON');
const report = JSON.parse(audit.stdout);
const vulnerabilities = Object.values(report.vulnerabilities || {});

if (vulnerabilities.length === 0) {
  console.log('Production dependency audit: zero findings.');
  process.exit(0);
}

// GHSA-qwww-vcr4-c8h2 affects React Router's RSC/server-action request mode.
// This repository is a Vite-generated browser-only SPA: it has no React Server
// Components, server router, action handlers, or SSR entrypoint. Keep this
// narrow exception fail-closed so any different or additional advisory fails.
const allowedSource = 1124282;
const allowedPackages = new Set(['react-router', 'react-router-dom']);
for (const finding of vulnerabilities) {
  assert.ok(allowedPackages.has(finding.name), `unapproved vulnerable package: ${finding.name}`);
  const sources = (finding.via || [])
    .filter((item) => typeof item === 'object')
    .map((item) => item.source);
  if (finding.name === 'react-router') assert.deepEqual(sources, [allowedSource]);
}

const source = fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .filter((entry) => /\.(?:ts|tsx)$/.test(entry))
  .map((entry) => fs.readFileSync(path.join(root, 'src', entry), 'utf8'))
  .join('\n');
for (const forbidden of [
  /react-server/,
  /createStaticHandler/,
  /createRequestHandler/,
  /ServerRouter/,
  /RSCRouter/,
]) {
  assert.doesNotMatch(source, forbidden, 'RSC audit exception is not valid for this source tree');
}

console.log(
  'Production dependency audit: only GHSA-qwww-vcr4-c8h2 is reported; '
  + 'its RSC/server-action execution path is absent from this browser-only Vite app.',
);
