import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * Render-level regression tests for the story viewer. The source contracts in
 * feed-posts-stories.test.mjs cannot see a runtime crash, and one shipped: the
 * responses sheet read `q.data!` while its query was disabled, which unmounted
 * the whole app the moment any viewer opened. These render the real components
 * through react-dom/server against the real providers, so a throw here is a
 * throw in the browser.
 *
 * Limits of the server renderer: zustand stores render from their *initial*
 * snapshot (useSyncExternalStore's server branch), so there is never a signed-in
 * user here and the author-only header (responses button, delete) is covered by
 * the live browser run instead; and an open Modal portals into document.body,
 * so sheets are rendered closed, which is also the state that crashed.
 */
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const { ErrorBoundary, ErrorFallback } = await import('../src/components/ErrorBoundary.tsx');
const { StoryResponsesModal, StoryViewer } = await import('../src/pages/StoryTray.tsx');

const FRIEND = { _id: '6aacaf9ab935aa3df2ab4001', username: 'vybetester2', fullName: 'Vybe Test User 2' };

const story = (author, i, overrides = {}) => ({
  _id: `story-${author.username}-${i}`,
  author,
  type: 'text',
  duration: 5,
  createdAt: new Date(Date.now() - (4 - i) * 60_000).toISOString(),
  content: { text: `Story ${i}` },
  viewCount: i,
  ...overrides,
});

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui))));
}

test('the responses sheet renders closed and without data, the state every viewer mounts it in', () => {
  assert.doesNotThrow(() => mount(h(StoryResponsesModal, { storyId: null, open: false, onClose() {} })));
  assert.doesNotThrow(() => mount(h(StoryResponsesModal, { storyId: 'story-vybetester-1', open: false, onClose() {} })));
});

test("a friend's stories open in a dialog at the first unseen one, with reactions and a reply box", () => {
  const groups = [{ author: FRIEND, stories: [story(FRIEND, 1, { hasViewed: true }), story(FRIEND, 2), story(FRIEND, 3)] }];
  const html = mount(h(StoryViewer, { groups, startGroup: 0, onClose() {} }));
  assert.match(html, /role="dialog" aria-modal="true" aria-label="Stories from Vybe Test User 2"/);
  assert.match(html, /2\/3/, 'the first story was already seen');
  assert.match(html, /Story 2/);
  assert.match(html, /aria-label="Previous story"/);
  assert.match(html, /aria-label="Next story"/);
  assert.match(html, /aria-label="React to this story"/);
  assert.match(html, /placeholder="Reply to Vybe Test User 2…"/);
  assert.match(html, /enterkeyhint="send"/i);
  assert.doesNotMatch(html, /View story responses/, 'only the author sees responses');
});

test('an explicit start story wins over the first-unseen default, and a video story gets the sound control', () => {
  const groups = [
    {
      author: FRIEND,
      stories: [
        story(FRIEND, 1),
        story(FRIEND, 2, { type: 'image', content: { media: 'uploads/friend/photo.jpg' } }),
        story(FRIEND, 3, { type: 'video', duration: 2, content: { media: 'uploads/friend/clip.mp4' } }),
      ],
    },
  ];
  const html = mount(h(StoryViewer, { groups, startGroup: 0, startStory: 2, onClose() {} }));
  assert.match(html, /3\/3/);
  assert.match(html, /<video[^>]*muted=""/, 'clips start muted so autoplay is allowed');
  assert.match(html, /aria-label="Unmute"/);
});

test('the render-error fallback names the problem and offers a way out', () => {
  const error = new Error('boom');
  assert.deepEqual(ErrorBoundary.getDerivedStateFromError(error), { error });
  const html = mount(h(ErrorFallback, { error, onRetry() {} }));
  assert.match(html, /role="alert"/);
  assert.match(html, /Something went wrong/);
  assert.match(html, /Try again/);
  assert.match(html, /Back to Home/);
  assert.match(html, /href="\/"/);
});
