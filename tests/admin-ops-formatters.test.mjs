import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * Pure-logic tests for the System / Dashboard / Reports shaping in
 * src/lib/adminOps.ts and src/lib/adminReports.ts. Fixtures copy the API's
 * own test payloads (tests/v2-be-ops.admin-health.test.js,
 * tests/v2-be-ops.performance.test.js, tests/v2-be-client-policy.gate.test.js
 * in the backend) so a shape change there fails here.
 */
const ops = await import('../src/lib/adminOps.ts');
const reports = await import('../src/lib/adminReports.ts');

const NOW = Date.parse('2026-09-19T12:00:00.000Z');
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();

/* --------------------------------------------------- notification health */

test('jobCounts zero-fills the five states in the API order', () => {
  assert.deepEqual(
    ops.jobCounts(undefined).map((r) => [r.state, r.count]),
    [['queued', 0], ['processing', 0], ['retry', 0], ['completed', 0], ['dead', 0]],
  );
  const rows = ops.jobCounts({ jobs: { queued: 1, completed: 1, dead: 2 } });
  assert.deepEqual(rows.map((r) => r.count), [1, 0, 0, 1, 2]);
  assert.equal(ops.JOB_STATES.length, 5);
});

test('queueTone: danger with dead jobs, warning for stale queued work, success when idle, neutral without data', () => {
  assert.equal(ops.queueTone(undefined, NOW), 'neutral');
  assert.equal(ops.queueTone({}, NOW), 'neutral');
  assert.equal(ops.queueTone({ jobs: { queued: 1, processing: 0, retry: 0, completed: 1, dead: 2 } }, NOW), 'danger');
  assert.equal(ops.queueTone({ jobs: { queued: 3, retry: 0, completed: 0, dead: 0 }, oldestPendingAt: minutesAgo(11) }, NOW), 'warning');
  assert.equal(ops.queueTone({ jobs: { queued: 0, retry: 2, completed: 0, dead: 0 }, oldestPendingAt: minutesAgo(30) }, NOW), 'warning');
  assert.equal(ops.queueTone({ jobs: { queued: 3, completed: 0, dead: 0 }, oldestPendingAt: minutesAgo(2) }, NOW), 'success', 'fresh work is fine');
  assert.equal(ops.queueTone({ jobs: { queued: 0, processing: 0, retry: 0, completed: 12, dead: 0 } }, NOW), 'success');
  assert.equal(ops.queueTone({ jobs: { queued: 0, processing: 0, retry: 0, completed: 0, dead: 0 } }, NOW), 'success');
});

test('ageSeconds and pushSummary', () => {
  assert.equal(ops.ageSeconds(minutesAgo(5), NOW), 300);
  assert.equal(ops.ageSeconds(null, NOW), null);
  assert.equal(ops.ageSeconds('garbage', NOW), null);
  assert.equal(ops.ageSeconds(new Date(NOW + 60_000).toISOString(), NOW), 0, 'clock skew never reads negative');
  const summary = ops.pushSummary({
    push: [
      { type: 'meal_comment', outcome: 'delivered', code: 'OK', count: 5 },
      { type: 'follow', outcome: 'retryable', code: 'PUSH_RETRYABLE', count: 2 },
      { type: 'follow', outcome: 'invalid_token', code: 'PUSH_INVALID_TOKEN', count: 1 },
      { type: 'follow', outcome: 'failed', code: 'PUSH_FAILED', count: 1 },
      { type: 'like', outcome: 'suppressed', code: 'QUIET_HOURS', count: 3 },
    ],
  });
  assert.deepEqual(summary, { delivered: 5, failed: 4, other: 3, total: 12 });
  assert.deepEqual(ops.pushSummary(undefined), { delivered: 0, failed: 0, other: 0, total: 0 });
});

/* ------------------------------------------------------------ performance */

// tests/v2-be-ops.performance.test.js:42 pins exactly this key set.
const PERF = {
  'GET:/api/posts': { avgTime: 12, count: 100, maxTime: 90, minTime: 2, p50Time: 10, p95Time: 40, totalTime: 1200 },
  'POST:/api/posts/create': { avgTime: 250, count: 4, maxTime: 1200, minTime: 80, p50Time: 200, p95Time: 1200, totalTime: 1000 },
  'GET:(no route)': { avgTime: 0, count: 1, maxTime: 0, minTime: null, p50Time: null, p95Time: null, totalTime: 0 },
  broken: 'not an object',
};

test('perfRows keeps null min/p50/p95 as null, drops non-object entries, sorts by volume', () => {
  const rows = ops.perfRows(PERF);
  assert.deepEqual(rows.map((r) => r.key), ['GET:/api/posts', 'POST:/api/posts/create', 'GET:(no route)']);
  const noRoute = rows.find((r) => r.key === 'GET:(no route)');
  assert.equal(noRoute.minTime, null);
  assert.equal(noRoute.p50Time, null);
  assert.equal(noRoute.p95Time, null);
  assert.equal(noRoute.count, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['avgTime', 'count', 'key', 'maxTime', 'minTime', 'p50Time', 'p95Time', 'totalTime']);
  assert.deepEqual(ops.perfRows(undefined), []);
  assert.deepEqual(ops.perfRows({}), []);
});

test('rankByP95 sorts descending with nulls last and honours the bound', () => {
  const ranked = ops.rankByP95(ops.perfRows(PERF));
  assert.deepEqual(ranked.map((r) => r.key), ['POST:/api/posts/create', 'GET:/api/posts', 'GET:(no route)']);
  assert.deepEqual(ops.rankByP95(ops.perfRows(PERF), 1).map((r) => r.key), ['POST:/api/posts/create']);
  const rows = ops.perfRows(PERF);
  ops.rankByP95(rows);
  assert.equal(rows[0].key, 'GET:/api/posts', 'the input is not mutated');
});

test('perfTotals is null on empty and names the worst p95 without inventing an overall percentile', () => {
  assert.equal(ops.perfTotals([]), null);
  const totals = ops.perfTotals(ops.perfRows(PERF));
  assert.equal(totals.requests, 105);
  assert.equal(totals.endpoints, 3);
  assert.equal(totals.slowestKey, 'POST:/api/posts/create');
  assert.equal(totals.slowestMax, 1200);
  assert.equal(totals.worstP95Key, 'POST:/api/posts/create');
  assert.equal(totals.worstP95, 1200);
  assert.ok(!('p50' in totals) && !('p95' in totals), 'no overall p50/p95 exists in the payload');
  const nulls = ops.perfTotals(ops.perfRows({ 'GET:(no route)': PERF['GET:(no route)'] }));
  assert.equal(nulls.worstP95Key, null);
  assert.equal(nulls.worstP95, null);
});

/* --------------------------------------------------------- client adoption */

test('adoptionRows survives a prototype-named platform and keeps release order', () => {
  // tests/v2-be-client-policy.gate.test.js:301-304
  const adoption = {
    windowDays: 7,
    since: daysAgo(7),
    platforms: {
      ios: {
        users: 40,
        releases: [
          { version: '1.3.0', build: '57', release: '1.3.0+57', users: 36, share: 90 },
          { version: '1.2.9', build: '50', release: '1.2.9+50', users: 4, share: 10 },
        ],
      },
      constructor: { users: 1, releases: [{ version: '1.0.0', build: '1', release: '1.0.0+1', users: 1, share: 100 }] },
    },
    daily: [],
  };
  const rows = ops.adoptionRows(adoption);
  assert.deepEqual(
    rows.map((r) => [r.platform, r.release, r.users, r.share, r.platformUsers, r.first]),
    [
      ['constructor', '1.0.0+1', 1, 100, 1, true],
      ['ios', '1.3.0+57', 36, 90, 40, true],
      ['ios', '1.2.9+50', 4, 10, 40, false],
    ],
  );
  assert.deepEqual(ops.adoptionRows(undefined), []);
  assert.deepEqual(ops.adoptionRows({ platforms: {} }), []);
  assert.deepEqual(ops.adoptionRows({ platforms: { android: { users: 0, releases: [] } } }), []);
  const [unknown] = ops.adoptionRows({ platforms: { android: { users: 3, releases: [] } } });
  assert.equal(unknown.release, 'unknown');
  assert.equal(unknown.users, 3);
});

test('formatShare and shortSha', () => {
  assert.equal(ops.formatShare(90), '90%');
  assert.equal(ops.formatShare(12.5), '12.5%');
  assert.equal(ops.formatShare(100), '100%');
  assert.equal(ops.formatShare(33.333), '33.3%');
  assert.equal(ops.formatShare(NaN), '—');
  assert.equal(ops.shortSha(''), 'not set');
  assert.equal(ops.shortSha(undefined), 'not set');
  assert.equal(ops.shortSha('5228f21c0ffee'), '5228f21');
  assert.equal(ops.shortSha('  abc  '), 'abc');
});

/* ---------------------------------------------------------------- reports */

test('GUIDELINES carries the twelve rules and every report reason maps to exactly one', () => {
  assert.equal(reports.GUIDELINES.length, 12);
  assert.deepEqual(
    reports.GUIDELINES.map((r) => r.code),
    ['CG-01', 'CG-02', 'CG-03', 'CG-04', 'CG-05', 'CG-06', 'CG-07', 'CG-08', 'CG-09', 'CG-10', 'CG-11', 'CG-12'],
  );
  assert.equal(reports.REPORT_REASONS.length, 13);
  for (const reason of reports.REPORT_REASONS) {
    const hits = reports.GUIDELINES.filter((r) => r.reportReasons.includes(reason));
    assert.equal(hits.length, 1, `${reason} maps to ${hits.length} rules`);
  }
  assert.equal(reports.ruleForReason('other').code, 'CG-12');
  assert.equal(reports.ruleForReason('spam').code, 'CG-09');
  assert.equal(reports.ruleForReason('made_up').code, 'CG-12', 'unknown reasons fall back to the catch-all, as the API does');
  assert.equal(reports.ruleLabel(reports.ruleForReason('spam')), 'CG-09 · No spam or misleading content');
  assert.equal(reports.guidelineByCode('cg-03').code, 'CG-03');
  assert.equal(reports.guidelineByCode('CG-99'), null);
  assert.equal(reports.TARGET_TYPES.length, 10);
  assert.equal(reports.MODERATION_ACTIONS.length, 6);
  assert.ok(reports.MODERATION_ACTIONS.includes('mark_sensitive'));
  assert.deepEqual([...reports.APPEAL_FILTERS], ['open', 'upheld', 'reversed', 'any', 'none']);
});

test('appealState prefers appeal.status, then the appeal window', () => {
  assert.equal(reports.appealState({ appeal: { status: 'open' } }, NOW), 'open');
  assert.equal(reports.appealState({ appeal: { status: 'upheld' }, appealUntil: daysAgo(1) }, NOW), 'upheld');
  assert.equal(reports.appealState({ appeal: { status: 'reversed' } }, NOW), 'reversed');
  assert.equal(reports.appealState({ appealUntil: new Date(NOW + 86_400_000).toISOString() }, NOW), 'window_open');
  assert.equal(reports.appealState({ appealUntil: daysAgo(1) }, NOW), 'window_closed');
  assert.equal(reports.appealState({}, NOW), 'none');
  assert.equal(reports.appealState(undefined, NOW), 'none');
});

test('slaState thresholds: 24 h / 72 h for reports, 3 d / 7 d for appeals', () => {
  assert.deepEqual(reports.REPORT_SLA_HOURS, { due: 24, overdue: 72 });
  assert.deepEqual(reports.APPEAL_SLA_DAYS, { due: 3, overdue: 7 });
  assert.equal(reports.slaState(hoursAgo(3), NOW, 'report').state, 'fresh');
  assert.equal(reports.slaState(hoursAgo(24), NOW, 'report').state, 'due');
  assert.equal(reports.slaState(hoursAgo(71), NOW, 'report').state, 'due');
  assert.equal(reports.slaState(hoursAgo(72), NOW, 'report').state, 'overdue');
  assert.equal(reports.slaState(daysAgo(2), NOW, 'appeal').state, 'fresh');
  assert.equal(reports.slaState(daysAgo(3), NOW, 'appeal').state, 'due');
  assert.equal(reports.slaState(daysAgo(7), NOW, 'appeal').state, 'overdue');
  assert.deepEqual(reports.slaState(null, NOW, 'report'), { state: 'unknown', ageMs: null });
  assert.deepEqual(reports.slaState('nope', NOW, 'appeal'), { state: 'unknown', ageMs: null });
  assert.equal(reports.slaState(hoursAgo(3), NOW, 'report').ageMs, 3 * 3_600_000);
});

test('slaLabel puts due and overdue in the badge text, not only in its tone', () => {
  assert.equal(reports.slaLabel(reports.slaState(hoursAgo(3), NOW, 'report')), 'Waiting 3 h');
  assert.equal(reports.slaLabel(reports.slaState(hoursAgo(30), NOW, 'report')), 'Waiting 30 h · due');
  assert.equal(reports.slaLabel(reports.slaState(daysAgo(4), NOW, 'report')), 'Waiting 4 d · overdue');
  assert.equal(reports.slaLabel(reports.slaState(daysAgo(3), NOW, 'appeal')), 'Waiting 3 d · due');
  assert.equal(reports.slaLabel(reports.slaState(daysAgo(8), NOW, 'appeal')), 'Waiting 8 d · overdue');
  assert.equal(reports.slaLabel({ state: 'unknown', ageMs: null }), 'Age unknown');
});

test('ageLabel reads in minutes, hours, then days', () => {
  assert.equal(reports.ageLabel(null), 'Age unknown');
  assert.equal(reports.ageLabel(30_000), 'Waiting under a minute');
  assert.equal(reports.ageLabel(5 * 60_000), 'Waiting 5 min');
  assert.equal(reports.ageLabel(3 * 3_600_000), 'Waiting 3 h');
  assert.equal(reports.ageLabel(47 * 3_600_000), 'Waiting 47 h');
  assert.equal(reports.ageLabel(4 * 86_400_000), 'Waiting 4 d');
});

test('canDecideAppeal refuses the original actor unless SUPER_ADMIN and needs an open appeal', () => {
  const alice = { _id: 'a1', role: 'ADMIN' };
  const bob = { _id: 'b2', role: 'ADMIN' };
  const superAlice = { _id: 'a1', role: 'SUPER_ADMIN' };
  const open = { appeal: { status: 'open' }, reviewedBy: { _id: 'a1', fullName: 'Alice' }, statement: { issuedBy: 'a1' } };
  assert.deepEqual(reports.canDecideAppeal(open, alice), { ok: false, reason: 'You took the original action' });
  assert.deepEqual(reports.canDecideAppeal(open, superAlice), { ok: true, reason: null });
  assert.deepEqual(reports.canDecideAppeal(open, bob), { ok: true, reason: null });
  // statement.issuedBy is a bare id and counts when reviewedBy is absent.
  assert.deepEqual(reports.canDecideAppeal({ appeal: { status: 'open' }, statement: { issuedBy: 'b2' } }, bob), { ok: false, reason: 'You took the original action' });
  // reviewedBy may itself be a bare id.
  assert.deepEqual(reports.canDecideAppeal({ appeal: { status: 'open' }, reviewedBy: 'b2' }, bob), { ok: false, reason: 'You took the original action' });
  assert.deepEqual(reports.canDecideAppeal({ appeal: { status: 'upheld' } }, bob), { ok: false, reason: 'No open appeal' });
  assert.deepEqual(reports.canDecideAppeal({}, bob), { ok: false, reason: 'No open appeal' });
  assert.deepEqual(reports.canDecideAppeal(open, undefined), { ok: true, reason: null }, 'an unknown identity leaves the server to decide');
});

test('reversalOutcome follows statement.action as reverseEnforcement does, then the target for remove_content', () => {
  // A suspension lifts and the strike goes whatever was reported.
  for (const targetType of reports.TARGET_TYPES) {
    assert.equal(reports.reversalOutcome({ targetType, statement: { action: 'suspend_user' } }), 'account', targetType);
    assert.equal(reports.reversalOutcome({ targetType, statement: { action: 'mark_sensitive' } }), 'screen', targetType);
  }
  // remove_content comes back only where the API has a reverse handler.
  assert.deepEqual([...reports.RESTORABLE_TARGETS], ['post', 'livestream', 'gym_community']);
  for (const targetType of reports.RESTORABLE_TARGETS) {
    assert.equal(reports.reversalOutcome({ targetType, statement: { action: 'remove_content' } }), 'content', targetType);
  }
  for (const targetType of ['meal', 'workout', 'workout_plan', 'comment', 'livestream_message', 'gym_review']) {
    assert.equal(reports.reversalOutcome({ targetType, statement: { action: 'remove_content' } }), 'none', targetType);
  }
  // No statement, or an action that removed nothing: nothing comes back.
  assert.equal(reports.reversalOutcome({ targetType: 'post' }), 'none');
  assert.equal(reports.reversalOutcome({ targetType: 'post', statement: { action: 'no_action' } }), 'none');
  assert.equal(reports.reversalOutcome(undefined), 'none');
  // The copy the moderator reads names the consequence.
  assert.match(reports.reversalDescription({ targetType: 'meal', statement: { action: 'suspend_user' } }), /account is restored and the strike is removed/);
  assert.match(reports.reversalDescription({ targetType: 'post', statement: { action: 'mark_sensitive' } }), /sensitivity screen is cleared/);
  assert.match(reports.reversalDescription({ targetType: 'livestream', statement: { action: 'remove_content' } }), /comes back/);
  assert.match(reports.reversalDescription({ targetType: 'comment', statement: { action: 'remove_content' } }), /cannot|deleted outright/);
  assert.doesNotMatch(reports.reversalDescription({ targetType: 'comment', statement: { action: 'remove_content' } }), /strike/, 'only a suspension carries a strike');
  assert.deepEqual(Object.keys(reports.REVERSAL_COPY).sort(), ['account', 'content', 'none', 'screen']);
});

test('moderationBody sends only the keys the action takes', () => {
  assert.deepEqual(reports.moderationBody({ action: 'mark_reviewed', note: '', rule: 'CG-09', durationDays: '30' }), { action: 'mark_reviewed' }, 'no rule, no duration, no empty note');
  assert.deepEqual(reports.moderationBody({ action: 'dismiss', note: '  fine  ', rule: 'CG-09' }), { action: 'dismiss', note: 'fine', rule: 'CG-09' }, 'dismiss cites a rule');
  assert.deepEqual(reports.moderationBody({ action: 'remove_content', note: 'Spam links', rule: 'CG-09', durationDays: '7' }), { action: 'remove_content', note: 'Spam links', rule: 'CG-09' }, 'durationDays is suspend_user only');
  assert.deepEqual(reports.moderationBody({ action: 'mark_sensitive', note: 'Graphic', rule: 'CG-04', durationDays: 7 }), { action: 'mark_sensitive', note: 'Graphic', rule: 'CG-04' });
  assert.deepEqual(reports.moderationBody({ action: 'suspend_user', note: 'Repeated harassment', rule: 'CG-01', durationDays: ' 14 ' }), { action: 'suspend_user', note: 'Repeated harassment', rule: 'CG-01', durationDays: 14 });
  assert.deepEqual(reports.moderationBody({ action: 'suspend_user', note: 'Repeated harassment', rule: 'CG-01', durationDays: '' }), { action: 'suspend_user', note: 'Repeated harassment', rule: 'CG-01' }, 'empty means indefinite');
  assert.deepEqual(reports.moderationBody({ action: 'restore_user', note: 'Appeal by email', rule: 'CG-01', durationDays: '3' }), { action: 'restore_user', note: 'Appeal by email' });
  assert.deepEqual(reports.moderationBody({ action: 'suspend_user', note: 'ok', rule: '', durationDays: null }), { action: 'suspend_user', note: 'ok' }, 'a blank rule is omitted, not sent as ""');
  assert.equal(reports.moderationBody({ action: 'remove_content', note: 'x'.repeat(1200) }).note.length, 1000);
  for (const action of reports.MODERATION_ACTIONS) {
    const keys = Object.keys(reports.moderationBody({ action, note: 'Long enough', rule: 'CG-12', durationDays: '5' }));
    for (const key of keys) assert.ok(['action', 'note', 'rule', 'durationDays'].includes(key), `${action} sent ${key}`);
    assert.equal(keys.includes('durationDays'), action === 'suspend_user', action);
    assert.equal(keys.includes('rule'), reports.RULE_CITING_ACTIONS.includes(action), action);
  }
});

test('noteError and durationError mirror the API limits', () => {
  assert.equal(reports.noteError('', false), null);
  assert.equal(reports.noteError('  ok  ', true), 'A short reason (at least 5 characters) is required for this action.');
  assert.equal(reports.noteError('long enough', true), null);
  assert.equal(reports.noteError('x'.repeat(1001), false), 'Notes must be 1,000 characters or fewer.');
  assert.equal(reports.durationError(''), null);
  assert.equal(reports.durationError('30'), null);
  assert.equal(reports.durationError('365'), null);
  assert.match(reports.durationError('0'), /1 to 365/);
  assert.match(reports.durationError('366'), /1 to 365/);
  assert.match(reports.durationError('1.5'), /whole number/);
  assert.match(reports.durationError('abc'), /whole number/);
});
