import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * Render-level tests for the prop-driven console cards in
 * src/pages/admin/adminCards.tsx. They mount through react-dom/server with
 * no QueryClient, router or toast provider, which is the point: a card that
 * grows a hook dependency fails here before it fails in the browser. Same
 * pattern as tests/story-viewer.render.test.mjs.
 */
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const cards = await import('../src/pages/admin/adminCards.tsx');

// React separates adjacent text expressions with <!-- -->; strip them before matching prose.
const prose = (html) => html.replace(/<!-- -->/g, '');

const NOW = Date.parse('2026-09-19T12:00:00.000Z');
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

const HEALTH = {
  success: true,
  jobs: { queued: 1, processing: 0, retry: 0, completed: 1, dead: 2 },
  oldestPendingAt: minutesAgo(3),
  lastCompletedAt: minutesAgo(1),
  lastWorkerActivityAt: minutesAgo(1),
  deadByErrorCode: [
    { code: 'PROCESSING_FAILED', count: 1, lastFailedAt: minutesAgo(5) },
    { code: 'PUSH_RETRYABLE', count: 1, lastFailedAt: minutesAgo(9) },
  ],
  kinds: ['direct_activity', 'follower_activity', 'push_delivery', 'suspension_expire'],
  push: [{ type: 'meal_comment', outcome: 'delivered', code: 'OK', count: 1 }],
};

test('NotificationJobsCard renders the five states, the dead badge, every list, and no ids', () => {
  const html = renderToString(h(cards.NotificationJobsCard, { health: HEALTH, now: NOW }));
  for (const label of ['Queued', 'Processing', 'Retry', 'Completed', 'Dead']) assert.match(html, new RegExp(label));
  assert.match(html, /2 dead jobs/);
  assert.match(html, /PROCESSING_FAILED/);
  assert.match(html, /PUSH_RETRYABLE/);
  assert.match(html, /direct_activity/);
  assert.match(html, /suspension_expire/);
  assert.match(html, /meal_comment/);
  assert.match(html, /Delivered/);
  assert.match(html, /GET \/api\/admin\/notifications\/health/);
  assert.match(html, /Oldest queued/);
  assert.match(html, /Last completed/);
  assert.match(html, /Last worker activity/);
  assert.match(html, /<th scope="col">Type<\/th>/);
  assert.match(html, /<time [^>]*dateTime="/, 'timestamps carry their ISO form');
});

test('NotificationJobsCard: empty, loading, forbidden and error states render without throwing', () => {
  const empty = renderToString(h(cards.NotificationJobsCard, { health: { jobs: {}, kinds: [], push: [] }, now: NOW }));
  assert.match(empty, /No jobs recorded/);
  assert.match(empty, /No pushes since the API started/);
  assert.match(empty, /No dead jobs/);
  assert.match(empty, /Healthy/);
  assert.doesNotThrow(() => renderToString(h(cards.NotificationJobsCard, {})));
  assert.doesNotThrow(() => renderToString(h(cards.NotificationJobsCard, { health: undefined, loading: true })));
  const forbidden = renderToString(h(cards.NotificationJobsCard, { forbidden: true }));
  assert.match(forbidden, /Staff access required/);
  const failed = renderToString(h(cards.NotificationJobsCard, { error: 'The API did not answer (request 3f9a1c2e)' }));
  assert.match(failed, /Could not read notification health/);
  assert.match(failed, /request 3f9a1c2e/);
  const backlog = renderToString(h(cards.NotificationJobsCard, { health: { jobs: { queued: 4 }, oldestPendingAt: minutesAgo(30) }, now: NOW }));
  assert.match(backlog, /Backlog/);
});

test('NotificationJobsCard bounds the push ledger to ten rows with an expandable toggle', () => {
  const push = Array.from({ length: 12 }, (_, i) => ({ type: `type_${i}`, outcome: 'delivered', code: 'OK', count: 12 - i }));
  const collapsed = renderToString(h(cards.NotificationJobsCard, { health: { ...HEALTH, push }, onTogglePush() {}, now: NOW }));
  assert.match(collapsed, /type_9/);
  assert.doesNotMatch(collapsed, /type_10/);
  assert.match(collapsed, /aria-expanded="false"/);
  assert.match(collapsed, /Show all 12 rows/);
  const expanded = renderToString(h(cards.NotificationJobsCard, { health: { ...HEALTH, push }, onTogglePush() {}, showAllPush: true, now: NOW }));
  assert.match(expanded, /type_11/);
  assert.match(expanded, /aria-expanded="true"/);
});

test('ClientAdoptionTable renders platform, release and share rows, and the truthful empty state', () => {
  const adoption = {
    windowDays: 7,
    platforms: {
      ios: { users: 40, releases: [{ version: '1.3.0', build: '57', release: '1.3.0+57', users: 36, share: 90 }, { version: '1.2.9', build: '50', release: '1.2.9+50', users: 4, share: 10 }] },
      android: { users: 8, releases: [{ version: '1.3.0', build: '57', release: '1.3.0+57', users: 8, share: 100 }] },
      constructor: { users: 1, releases: [{ version: '1.0.0', build: '1', release: '1.0.0+1', users: 1, share: 100 }] },
    },
  };
  const html = renderToString(h(cards.ClientAdoptionTable, { adoption }));
  assert.match(html, /<th scope="col">Platform<\/th>/);
  assert.match(html, /iOS/);
  assert.match(html, /Android/);
  assert.match(html, /constructor/);
  assert.match(html, /1\.3\.0\+57/);
  assert.match(html, /1\.2\.9\+50/);
  assert.match(html, /90%/);
  assert.match(html, /10%/);
  assert.match(html, /40 users/);
  assert.match(html, /role="progressbar"/);
  const empty = renderToString(h(cards.ClientAdoptionTable, { adoption: { platforms: {} } }));
  assert.match(empty, /No client reports yet/);
  assert.match(empty, /X-Vybe-Client/);
  assert.match(renderToString(h(cards.ClientAdoptionTable, {})), /No client reports yet/);
});

test('StatementBlock cites the rule and the action; AppealBlock shows the status and the member message', () => {
  const statement = renderToString(
    h(cards.StatementBlock, {
      statement: { action: 'remove_content', ruleCode: 'CG-09', ruleTitle: 'No spam or misleading content', note: 'Repeated affiliate links.', issuedAt: minutesAgo(60), issuedBy: '64f0c0ffee1234567890abcd', detectedBy: 'user_report' },
    }),
  );
  assert.match(statement, /Statement of reasons/);
  assert.match(statement, /CG-09 · No spam or misleading content/);
  assert.match(statement, /Content removed/);
  assert.match(statement, /Repeated affiliate links\./);
  assert.match(statement, /detected by user report/);
  assert.doesNotMatch(statement, /64f0c0ffee1234567890abcd/, 'the bare issuer id is never printed');
  // A code without a title is looked up in the local table.
  assert.match(renderToString(h(cards.StatementBlock, { statement: { action: 'no_action', ruleCode: 'CG-12' } })), /CG-12 · Keep Vybe safe for everyone/);
  assert.equal(renderToString(h(cards.StatementBlock, {})), '');

  const open = renderToString(
    h(cards.AppealBlock, { appeal: { message: 'The links were to my own free programme.', status: 'open', openedAt: minutesAgo(90) }, now: NOW }),
  );
  assert.match(open, /data-appeal="open"/);
  assert.match(open, />Open</);
  assert.match(open, /The links were to my own free programme\./);
  assert.match(open, /Opened/);

  const reversed = renderToString(
    h(cards.AppealBlock, {
      appeal: { message: 'x', status: 'reversed', openedAt: minutesAgo(90), decidedAt: minutesAgo(10), decidedBy: { _id: 'b2', fullName: 'Bo Admin', email: 'bo@example.com' }, note: 'Own programme, no spam.', restored: true },
      now: NOW,
    }),
  );
  assert.match(reversed, />Reversed</);
  assert.match(reversed, /Content restored/);
  assert.match(prose(reversed), /Decided by Bo Admin/);
  assert.match(reversed, /Own programme, no spam\./);
  assert.match(
    renderToString(h(cards.AppealBlock, { appeal: { status: 'reversed', restored: true }, targetType: 'user', now: NOW })),
    /Account restored/,
  );
  // The badge follows the statement action, not the target type: a
  // suspension on a post report restores the account, a sensitivity screen
  // is cleared, and a removed post comes back.
  assert.match(
    renderToString(h(cards.AppealBlock, { appeal: { status: 'reversed', restored: true }, targetType: 'post', action: 'suspend_user', now: NOW })),
    /Account restored/,
  );
  assert.match(
    renderToString(h(cards.AppealBlock, { appeal: { status: 'reversed', restored: true }, targetType: 'post', action: 'mark_sensitive', now: NOW })),
    /Screen cleared/,
  );
  assert.match(
    renderToString(h(cards.AppealBlock, { appeal: { status: 'reversed', restored: true }, targetType: 'post', action: 'remove_content', now: NOW })),
    /Content restored/,
  );
  assert.match(
    renderToString(h(cards.AppealBlock, { appeal: { status: 'reversed', restored: false }, now: NOW })),
    /Could not be restored/,
  );
  assert.match(
    renderToString(h(cards.AppealBlock, { appealUntil: new Date(NOW + 86_400_000).toISOString(), now: NOW })),
    /Appeal window closes/,
  );
  assert.match(renderToString(h(cards.AppealBlock, { appealUntil: minutesAgo(1), now: NOW })), /Appeal window closed/);
  assert.equal(renderToString(h(cards.AppealBlock, {})), '');
});

test('ApiBuildCard prints the short sha with the full one as a tooltip, or "not set"', () => {
  const set = renderToString(h(cards.ApiBuildCard, { version: { sha: '5228f21c0ffeec0ffee', builtAt: '2026-09-19T10:00:00Z', node: 'v24.19.0' } }));
  assert.match(set, /title="5228f21c0ffeec0ffee"/);
  assert.match(set, />5228f21</);
  assert.match(set, /Built <time/);
  assert.match(set, /Node v24\.19\.0/);
  assert.match(set, /GET \/api\/version/);
  const unset = renderToString(h(cards.ApiBuildCard, { version: { sha: '', builtAt: '', node: 'v24.19.0' } }));
  assert.match(unset, /not set/);
  assert.match(unset, /Build time not set/);
  assert.doesNotThrow(() => renderToString(h(cards.ApiBuildCard, {})));
  assert.match(renderToString(h(cards.ApiBuildCard, { loading: true })), /aria-hidden|animate|skeleton/i);
  assert.match(renderToString(h(cards.ApiBuildCard, { error: 'Could not read the API version (request abcdef12)' })), /request abcdef12/);
});

test('TimeStamp renders the ISO form on the element and a dash for nothing', () => {
  assert.match(renderToString(h(cards.TimeStamp, { iso: '2026-09-19T10:00:00Z' })), /dateTime="2026-09-19T10:00:00\.000Z"/);
  assert.match(renderToString(h(cards.TimeStamp, { iso: null })), />—</);
  assert.match(renderToString(h(cards.TimeStamp, { iso: 'garbage' })), />—</);
});
