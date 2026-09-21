/**
 * P0 quick fixes (2026-09-21): shared challenge links open the challenge,
 * the report menu reaches every target the API resolves, and /r/<id|token>
 * has a page. Source pins, so a refactor cannot quietly undo them.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('a shared challenge link opens the challenge: the link mints ?open= and the page still reads the older ?challenge=', () => {
  const links = read('src/lib/shareLinks.ts');
  const challenges = read('src/pages/Challenges.tsx');
  assert.match(links, /case 'challenge':\s*return `\/challenges\?open=\$\{q\}`;/);
  assert.match(challenges, /searchParams\.get\('open'\) \?\? searchParams\.get\('challenge'\)/);
  assert.match(challenges, /prev\.delete\('challenge'\);/);
});

test('the web report enum is the API enum, and comments, messages, stories and events have a Report entry', () => {
  const report = read('src/pages/Report.tsx');
  for (const t of ['comment', 'message', 'story', 'story_response', 'event', 'session', 'gym_review', 'gym_community', 'livestream', 'livestream_message']) {
    assert.ok(report.includes(`'${t}'`), `REPORT_TARGET_TYPES carries ${t}`);
  }
  assert.match(read('src/pages/PostDetail.tsx'), /label: 'Report comment'[\s\S]*?targetType: 'comment'/);
  assert.match(read('src/pages/Messages.tsx'), /label: 'Report message'[\s\S]*?targetType: 'message'/);
  assert.match(read('src/pages/StoryTray.tsx'), /label="Report story"[\s\S]*?targetType: 'story'/);
  // The event row moved to src/pages/gyms/GymEventRow.tsx with RSVP and the .ics download (P7); the menu came with it.
  assert.match(read('src/pages/gyms/GymEventRow.tsx'), /label: 'Report event'[\s\S]*?targetType: 'event'/);
});

test('/r/<id|token> is routed, public and member-aware, and treats the flag-off 404 as a state', () => {
  const app = read('src/App.tsx');
  const page = read('src/pages/RoutineShare.tsx');
  assert.match(app, /<Route path="\/r\/:idOrToken" element=\{<RoutineGate \/>\} \/>/);
  assert.match(app, /function RoutineGate\(\)[\s\S]*?<RoutineShare member \/>[\s\S]*?return <RoutineShare \/>;/);
  assert.match(page, /api\.get<Preview>\(`\/public\/routines\/\$\{idOrToken\}`\)/);
  assert.match(page, /api\.post<[^>]*>\(`\/routines\/\$\{p\.id\}\/save`/);
  assert.match(page, /FEATURE_DISABLED/);
  assert.match(page, /SHARE_LINK_NOT_FOUND/);
  assert.doesNotMatch(page, /weight|kg|lb/i, 'the public preview never names a load');
});
