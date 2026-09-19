import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * Render-level checks for the 426 screen and the app-wide notices, through
 * react-dom/server against the real providers (pattern of
 * tests/story-viewer.render.test.mjs): a throw here is a throw in the browser,
 * and the source pins in client-policy.test.mjs cannot see one.
 *
 * The screen reads the latch through useSyncExternalStore with the same
 * snapshot on both sides, so unlike a plain zustand hook it renders the
 * latched notice under the server renderer; the state is set before the
 * render and cleared in `finally` so no other test inherits it.
 */
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const { UpdateRequiredScreen } = await import('../src/components/UpdateRequiredScreen.tsx');
const { ApiNotices } = await import('../src/components/ApiNotices.tsx');
const { useClientPolicy } = await import('../src/lib/clientPolicy.ts');

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui))));
}

// The providers alone: the toast viewport is always in the tree, so "renders
// nothing" means "adds nothing to this".
const EMPTY_SHELL = mount(null);

test('with nothing latched the 426 screen renders nothing at all', () => {
  assert.equal(useClientPolicy.getState().updateRequired, null);
  assert.equal(mount(h(UpdateRequiredScreen)), EMPTY_SHELL);
});

test('a latched 426 renders the labelled dialog with the server message and one reload button', () => {
  useClientPolicy.getState().noteUpdateRequired({
    success: false,
    code: 'CLIENT_UPDATE_REQUIRED',
    message: 'Why: sets now sync live.',
    platform: 'web',
    minVersion: '1.1.0',
    latestVersion: null,
    storeUrl: null,
  });
  try {
    const html = mount(h(UpdateRequiredScreen));
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-labelledby="update-required-title"/);
    assert.match(html, /aria-describedby="update-required-body"/);
    assert.match(html, /id="update-required-title"[^>]*>Reload Vybe</);
    assert.match(html, /Why: sets now sync live\./);
    assert.match(html, /A newer version of Vybe is ready\. Reloading picks it up and keeps you signed in\./);
    assert.match(html, /<button type="button"[^>]*>/);
    assert.equal((html.match(/<button/g) || []).length, 1, 'one action, no dismiss');
    assert.match(html, />Reload Vybe<\/span>/);
    assert.doesNotMatch(html, /This version of Vybe is out of date/, 'the server message replaces the default copy');
  } finally {
    useClientPolicy.getState().clear();
  }
  assert.equal(mount(h(UpdateRequiredScreen)), EMPTY_SHELL, 'clearing the latch removes the screen');
});

test('a 426 without a message falls back to the default copy', () => {
  useClientPolicy.getState().noteUpdateRequired({ code: 'CLIENT_UPDATE_REQUIRED' });
  try {
    const html = mount(h(UpdateRequiredScreen));
    assert.match(html, /This version of Vybe is out of date\. Update to keep logging and messaging\. Your workouts are saved\./);
  } finally {
    useClientPolicy.getState().clear();
  }
});

test('the notices component renders nothing and needs only the toast provider', () => {
  assert.equal(mount(h(ApiNotices)), EMPTY_SHELL);
});
