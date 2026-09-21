import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

/**
 * Story stickers: the eleven routes the web had never called, the four
 * sticker states a viewer can be in, and the two things the API is strict
 * about that a render cannot see — `results` being a privilege rather than
 * a tally, and "share results" being a write, not a read.
 *
 * The render half goes through react-dom/server against the real providers,
 * like tests/story-viewer.render.test.mjs: a throw here is a throw in the
 * browser. Its limits are the same — a zustand store renders from its
 * initial snapshot, so there is never a signed-in user and the author-only
 * branches are exercised by passing `mine` directly.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const stories = await import('../src/lib/stories.ts');
const { CountdownSticker, PollSticker, QuestionSticker, SliderSticker, StaticSticker, StickerLayer } = await import('../src/pages/stories/StickerLayer.tsx');
const { StickerComposer, emptyStickerDraft } = await import('../src/pages/stories/StickerComposer.tsx');

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui))));
}

const poll = (over = {}) => ({
  _id: 'stk-poll',
  id: 'stk-poll',
  kind: 'poll',
  x: 0.5,
  y: 0.72,
  text: 'Squat or deadlift?',
  options: [{ text: 'Squat' }, { text: 'Deadlift' }],
  showResults: true,
  ended: false,
  viewerResponse: null,
  ...over,
});

/* ------------------------------------------------------------------ the viewer's three states */

test('a poll reads unvoted, voted-quiet and voted-with-results, and never draws a zero bar', () => {
  const unvoted = mount(h(PollSticker, { sticker: poll(), onVote() {} }));
  assert.match(unvoted, /Squat or deadlift\?/);
  assert.match(unvoted, /aria-pressed="false"/);
  assert.doesNotMatch(unvoted, /%/, 'no tally before the viewer has answered');
  assert.doesNotMatch(unvoted, /\b0 votes\b/, 'a count of zero is a hole, not a fact');

  // The author left showResults off: the choice is ticked, the tally is not
  // the viewer's to see, and nothing invents a percentage.
  const quiet = mount(h(PollSticker, { sticker: poll({ showResults: false, viewerResponse: { kind: 'vote', option: 1 } }), onVote() {} }));
  assert.match(quiet, /aria-pressed="true"/);
  assert.doesNotMatch(quiet, /%/);

  const withResults = mount(
    h(PollSticker, {
      sticker: poll({ viewerResponse: { kind: 'vote', option: 1 }, results: { count: 4, optionCounts: [1, 3], percentages: [25, 75] } }),
      onVote() {},
    }),
  );
  assert.match(withResults, /25%/);
  assert.match(withResults, /75%/);
  assert.match(withResults, /4 votes/);
  assert.match(withResults, /width:75%/, 'the chosen option is filled to its share');
});

test('the slider commits a value and only shows an average when the API sent one', () => {
  const base = { _id: 's1', id: 's1', kind: 'slider', text: 'How hard was that?', emoji: '🔥', ended: false, viewerResponse: null };
  const fresh = mount(h(SliderSticker, { sticker: base, onSlide() {} }));
  assert.match(fresh, /type="range"/);
  assert.match(fresh, /aria-valuetext="50 out of 100"/);
  assert.doesNotMatch(fresh, /Average/);

  const answered = mount(
    h(SliderSticker, { sticker: { ...base, viewerResponse: { kind: 'slide', value: 80 }, results: { count: 3, average: 64 } }, onSlide() {} }),
  );
  assert.match(answered, /You: 80/);
  assert.match(answered, /Average 64/);
  assert.match(answered, /3 responses/);
});

test('a question takes an answer, counts to three and then closes rather than failing the send', () => {
  const base = { _id: 'q1', id: 'q1', kind: 'question', text: 'Ask me anything', ended: false, viewerResponse: null };
  const open = mount(h(QuestionSticker, { sticker: base, onAnswer() {} }));
  assert.match(open, /Ask me anything/);
  assert.match(open, /aria-label="Send answer"/);
  assert.match(open, /maxLength="280"|maxlength="280"/i);

  const once = mount(h(QuestionSticker, { sticker: { ...base, viewerResponse: { kind: 'answer', answered: 1 } }, onAnswer() {} }));
  assert.match(once, /Answer sent/);
  assert.match(once, /aria-label="Send answer"/, 'two more are allowed');

  // The API's limit is three; the box closes instead of offering a send that answers 400 ANSWER_LIMIT.
  const spent = mount(h(QuestionSticker, { sticker: { ...base, viewerResponse: { kind: 'answer', answered: 3 } }, onAnswer() {} }));
  assert.match(spent, /You’ve sent all three answers/);
  assert.doesNotMatch(spent, /aria-label="Send answer"/);
});

test('a countdown offers Remind me only while it runs and the author allows it', () => {
  const soon = new Date(Date.now() + 3 * 3600_000).toISOString();
  const base = { _id: 'c1', id: 'c1', kind: 'countdown', text: 'Race day', endsAt: soon, remindable: true, ended: false, viewerResponse: null };
  const live = mount(h(CountdownSticker, { sticker: base, onRemind() {} }));
  assert.match(live, /Race day/);
  assert.match(live, /3 hours left/);
  assert.match(live, /Remind me/);

  const on = mount(h(CountdownSticker, { sticker: { ...base, viewerResponse: { kind: 'reminder', reminded: true } }, onRemind() {} }));
  assert.match(on, /Reminder on/);
  assert.match(on, /aria-pressed="true"/);

  const off = mount(h(CountdownSticker, { sticker: { ...base, remindable: false }, onRemind() {} }));
  assert.doesNotMatch(off, /Remind me/);

  const done = mount(h(CountdownSticker, { sticker: { ...base, ended: true, endsAt: new Date(Date.now() - 1000).toISOString() }, onRemind() {} }));
  assert.match(done, /Ended/);
  assert.doesNotMatch(done, /Remind me/);
});

test('the author never gets a vote control, only the way into their own results', () => {
  const mine = mount(
    h(StickerLayer, { stickers: [poll({ results: { count: 9, optionCounts: [4, 5], percentages: [44, 56] } })], mine: true, onAction() {}, onOpenResults() {} }),
  );
  assert.match(mine, /aria-label="See poll results"/);
  assert.match(mine, /9 votes/);
  assert.doesNotMatch(mine, /aria-pressed/, 'the author cannot respond to their own sticker (400 OWN_STICKER)');

  const theirs = mount(h(StickerLayer, { stickers: [poll()], mine: false, onAction() {}, onOpenResults() {} }));
  assert.match(theirs, /aria-pressed="false"/);
});

test('a sticker is placed at its normalised centre, and a positionless one stacks at the foot', () => {
  const placed = mount(h(StickerLayer, { stickers: [poll({ x: 0.25, y: 0.8 })], mine: false, onAction() {}, onOpenResults() {} }));
  assert.match(placed, /left:25%/);
  assert.match(placed, /top:80%/);

  const { x, y, ...noPosition } = poll();
  void x;
  void y;
  const stacked = mount(h(StickerLayer, { stickers: [noPosition], mine: false, onAction() {}, onOpenResults() {} }));
  assert.match(stacked, /inset-x-4 bottom-4/);
  assert.doesNotMatch(stacked, /left:/);
});

test('the quiet kinds render as labels and an empty list renders nothing at all', () => {
  assert.match(mount(h(StaticSticker, { sticker: { _id: 'm', id: 'm', kind: 'mention', user: { _id: 'u', username: 'maya' } } })), /@maya/);
  assert.match(mount(h(StaticSticker, { sticker: { _id: 'g', id: 'g', kind: 'gym', gymName: 'Iron Works' } })), /Iron Works/);
  // Nothing to draw: the layer renders no element at all (the toast portal
  // the provider always mounts is the only thing left).
  assert.doesNotMatch(mount(h(StickerLayer, { stickers: [], mine: false, onAction() {}, onOpenResults() {} })), /data-sticker-layer/);
});

/* ------------------------------------------------------------------ the composer */

test('the composer offers one sticker and refuses a draft with the server’s own words', () => {
  const html = mount(h(StickerComposer, { draft: null, onChange() {} }));
  for (const label of ['Poll', 'Slider', 'Question']) assert.ok(html.includes(label), `must offer ${label}`);
  assert.match(html, /role="radiogroup"/, 'one sticker, not a list you can keep adding to');

  const filled = mount(h(StickerComposer, { draft: { kind: 'poll', text: 'Which?', options: [{ text: 'A' }, { text: '' }] }, onChange() {} }));
  assert.match(filled, /Add at least two options\./);

  // Untouched fields are not mistakes yet.
  assert.doesNotMatch(mount(h(StickerComposer, { draft: emptyStickerDraft('poll'), onChange() {} })), /Ask something/);
});

test('a draft is validated against the API limits and serialised the way POST /story wants it', () => {
  assert.equal(stories.stickerDraftError(null), null);
  assert.equal(stories.stickerDraftError({ kind: 'poll', text: '', options: [{ text: 'a' }, { text: 'b' }] }), 'Ask something.');
  assert.equal(stories.stickerDraftError({ kind: 'poll', text: 'q', options: [{ text: 'a' }, { text: '' }] }), 'Add at least two options.');
  assert.equal(stories.stickerDraftError({ kind: 'poll', text: 'q', options: [{ text: 'a' }, { text: 'b'.repeat(41) }] }), 'Keep each option to 40 characters.');
  assert.equal(stories.stickerDraftError({ kind: 'slider', text: 'x'.repeat(81) }), 'Keep the label to 80 characters.');
  assert.equal(stories.stickerDraftError({ kind: 'question', text: 'x'.repeat(121) }), 'Keep the prompt to 120 characters.');
  assert.equal(stories.stickerDraftError({ kind: 'question', text: 'ok' }), null);

  // Blank options are dropped, not sent as empty strings the validator rejects.
  assert.deepEqual(stories.stickerDraftBody({ kind: 'poll', text: '  Which?  ', options: [{ text: ' A ' }, { text: '' }, { text: 'B' }], showResults: false }), {
    kind: 'poll',
    text: 'Which?',
    options: [{ text: 'A' }, { text: 'B' }],
    showResults: false,
  });
  assert.deepEqual(stories.stickerDraftBody({ kind: 'slider', text: 'Hard?', emoji: ' 🔥 ' }), { kind: 'slider', text: 'Hard?', emoji: '🔥', showResults: false });
  // An empty emoji is omitted rather than sent as '' (the validator rejects it).
  assert.deepEqual(stories.stickerDraftBody({ kind: 'slider', text: 'Hard?', emoji: '   ' }), { kind: 'slider', text: 'Hard?', showResults: false });

  assert.deepEqual(stories.STICKER_LIMITS.pollOptionsMax, 4);
  assert.deepEqual(stories.STICKER_LIMITS.interactivePerStory, 1);
});

/* ------------------------------------------------------------------ reading a sticker */

test('the sticker readers branch on what the API actually sent, never on a default', () => {
  assert.equal(stories.optionShare(undefined, 0), 0);
  assert.equal(stories.optionShare({ count: 4, percentages: [25, 75] }, 1), 75);
  // No `percentages` (an older payload): recomputed from the counts rather than drawn empty.
  assert.equal(stories.optionShare({ count: 4, optionCounts: [1, 3] }, 1), 75);
  assert.equal(stories.optionShare({ count: 0, optionCounts: [0, 0] }, 0), 0);

  assert.equal(stories.votedOption(poll()), null);
  assert.equal(stories.votedOption(poll({ viewerResponse: { kind: 'vote', option: 0 } })), 0, 'option 0 is a vote, not a falsy miss');
  assert.equal(stories.slidValue({ kind: 'slider', viewerResponse: { kind: 'slide', value: 0 } }), 0);
  assert.equal(stories.answeredCount({ kind: 'question', viewerResponse: { kind: 'answer', answered: 2 } }), 2);
  assert.equal(stories.reminderSet({ kind: 'countdown', viewerResponse: { kind: 'reminder', reminded: true } }), true);

  // The zero rule: no count line until there is a count.
  assert.equal(stories.responseCountLabel('poll', { count: 0 }), null);
  assert.equal(stories.responseCountLabel('poll', undefined), null);
  assert.equal(stories.responseCountLabel('poll', { count: 1 }), '1 vote');
  assert.equal(stories.responseCountLabel('question', { count: 5 }), '5 answers');

  assert.deepEqual(stories.stickerPosition({ x: 0.25, y: 0.5 }), { left: '25%', top: '50%' });
  assert.equal(stories.stickerPosition({}), null);
  assert.equal(stories.stickerPosition({ x: 0.5 }), null, 'half a position is no position');

  assert.equal(stories.isInteractiveSticker('poll'), true);
  assert.equal(stories.isInteractiveSticker('mention'), false);
});

test('a sticker refusal shows the server’s sentence, and the final ones are known', () => {
  const refusal = { response: { status: 400, data: { success: false, code: 'OWN_STICKER', message: "You can't respond to your own sticker" } } };
  assert.equal(stories.stickerErrorCopy(refusal), "You can't respond to your own sticker");
  assert.equal(stories.isStickerClosed(refusal), true);
  assert.equal(stories.isStickerClosed({ response: { status: 400, data: { code: 'OPTION_INVALID' } } }), false, 'a bad option is worth another tap');
  // A 404 the deployment answers because it has no sticker routes at all.
  assert.equal(stories.isFeatureDisabled({ response: { status: 404, data: { code: 'FEATURE_DISABLED' } } }), true);
  assert.equal(stories.isFeatureDisabled({ response: { status: 404, data: { message: 'Story not found' } } }), false);
  for (const code of ['OWN_STICKER', 'STORY_ENDED', 'ANSWER_LIMIT', 'OPTION_INVALID', 'VALUE_INVALID', 'REMINDER_OFF', 'SHARE_UNSUPPORTED']) {
    assert.ok(stories.STICKER_REFUSALS[code], `${code} must have copy`);
  }
});

/* ------------------------------------------------------------------ contracts */

test('every sticker and highlight path is literal and pinned against the backend snapshot', () => {
  const src = read('src/lib/stories.ts');
  for (const literal of [
    '`/story/${storyId}/stickers/${stickerId}/vote`',
    '`/story/${storyId}/stickers/${stickerId}/slide`',
    '`/story/${storyId}/stickers/${stickerId}/answer`',
    '`/story/${storyId}/stickers/${stickerId}/reminder`',
    '`/story/${storyId}/stickers/${stickerId}/respond`',
    '`/story/${storyId}/stickers/${stickerId}/results`',
    '`/story/${storyId}/stickers/${stickerId}/share-results`',
    '`/story/highlights/${userId}`',
    "'/story/highlights'",
    '`/story/highlights/${highlightId}/add-story`',
    '`/story/highlights/${highlightId}/stories/${storyId}`',
  ]) {
    assert.ok(src.includes(literal), `src/lib/stories.ts must call ${literal}`);
  }

  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'POST /api/story/:storyId/stickers/:stickerId/vote',
    'POST /api/story/:storyId/stickers/:stickerId/slide',
    'POST /api/story/:storyId/stickers/:stickerId/answer',
    'POST /api/story/:storyId/stickers/:stickerId/reminder',
    'DELETE /api/story/:storyId/stickers/:stickerId/reminder',
    'DELETE /api/story/:storyId/stickers/:stickerId/respond',
    'GET /api/story/:storyId/stickers/:stickerId/results',
    'POST /api/story/:storyId/stickers/:stickerId/share-results',
    'POST /api/story/highlights/:highlightId/add-story',
    'DELETE /api/story/highlights/:highlightId/stories/:storyId',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

test('the viewer wires the sticker layer above the paging zones and holds the clock while it is used', () => {
  const tray = read('src/pages/StoryTray.tsx');
  assert.match(tray, /<StickerLayer/);
  assert.match(tray, /stickers\?: StorySticker\[\];/, 'the Story type must carry what the API has always sent');
  // The layer renders after the prev/next buttons, so a tap on a poll is a vote.
  assert.ok(tray.indexOf('aria-label="Next story"') < tray.indexOf('<StickerLayer'), 'the sticker layer must sit above the paging zones');
  assert.match(tray, /stickerActive \|\| Boolean\(deleteTarget\)/, 'a focused sticker field pauses the story');
  assert.match(tray, /viewerResponse: data\.viewerResponse \?\? null/, 'the patch takes the server’s footprint, never a guess');
  assert.match(tray, /\.\.\.\(data\.results \? \{ results: data\.results \} : \{\}\)/, 'results are only patched in when the API sent them');
  assert.match(tray, /data\.delivered === 'dm' \? `Answer sent to /, 'the DM bridge is reported honestly');

  // The composer sends one sticker, placed in the lower third.
  assert.match(tray, /stickerDraftBody\(sticker\), \.\.\.DEFAULT_STICKER_PLACEMENT/);
  assert.match(read('src/pages/stories/StickerLayer.tsx'), /DEFAULT_STICKER_PLACEMENT = \{ x: 0\.5, y: 0\.72 \}/);

  // Highlight membership from the viewer, and the copy that says where a story goes.
  assert.match(tray, /label: 'Add to highlight'/);
  assert.match(tray, /label: 'Remove from highlight'/);
  assert.match(tray, /It goes back to your archive/);
  assert.match(tray, /label: 'Delete story'/, 'delete moved into the same menu');
  assert.match(tray, /highlightId \|\| story\?\.highlights\?\.\[0\]/);
});

test('a sticker pill is theme-invariant, and the viewer keeps exactly one filled blue', () => {
  const layer = read('src/pages/stories/StickerLayer.tsx');
  // The viewer forces `.dark`; --surface-1 would come out charcoal, so the
  // card is pinned to the --navy-* primitives :root defines and .dark does not override.
  assert.match(layer, /background: 'var\(--navy-50\)'/);
  assert.match(layer, /color: 'var\(--navy-800\)'/);
  // Comments are stripped first: the file explains the rule in prose.
  const code = layer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /btn-primary/, 'a sticker is never a second filled blue');
  assert.doesNotMatch(code, /variant="primary"/, 'and never a primary Button either');
  assert.doesNotMatch(code, /#[0-9a-fA-F]{6}/, 'no raw hex in components (docs/DESIGN.md)');
  assert.match(layer, /var\(--brand\)/, 'the active answer is the one blue');
});
