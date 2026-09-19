import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * Render-level checks for the Hidden words editor (a pure component, so it
 * renders the same under react-dom/server as in the browser). The sections
 * around it read the zustand session store, which renders from its initial,
 * signed-out snapshot here, so they are covered by the live browser run.
 */
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const { HiddenWordsEditor } = await import('../src/pages/SettingsPreferences.tsx');

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui))));
}

const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, '');

test('the editor is a labelled textarea with a live counter and a disabled Save while nothing changed', () => {
  const html = decode(mount(h(HiddenWordsEditor, { value: ['Weak sauce', '🤡'], onSave() {} })));
  assert.match(html, /<label[^>]*for="hidden-words"[^>]*>Your hidden words<\/label>/);
  assert.match(html, /<textarea[^>]*id="hidden-words"/);
  assert.match(html, /aria-describedby="hidden-words-hint"/, 'the hint is announced');
  assert.match(html, /One per line or separated by commas\. Up to 200 words, 40 characters each\./);
  assert.match(html, /Weak sauce\n🤡<\/textarea>/, 'saved words show one per line');
  assert.match(html, /aria-live="polite">2 of 200</);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled[^>]*>[\s\S]*?Save hidden words/);
  assert.doesNotMatch(html, /role="alert"/);
});

test('an over-long word is reported inline with the server message and Save stays disabled', () => {
  const html = decode(mount(h(HiddenWordsEditor, { value: ['a'.repeat(41)], onSave() {} })));
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="hidden-words-error"/);
  assert.match(html, /role="alert"[^>]*>[\s\S]*?Each hidden word must be 40 characters or fewer/);
  assert.match(html, /aria-live="polite">0 of 200</);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled/);
});

test('an empty list renders an empty editor; a server error is shown only for the text it came from', () => {
  const empty = decode(mount(h(HiddenWordsEditor, { value: [], onSave() {} })));
  assert.match(empty, /<textarea[^>]*id="hidden-words"[^>]*><\/textarea>/);
  assert.match(empty, /aria-live="polite">0 of 200</);
  // A stale server error does not attach to text the person has not submitted in this render.
  const withServer = decode(mount(h(HiddenWordsEditor, { value: ['ok'], onSave() {}, serverError: 'Hidden words are limited to 200 entries' })));
  assert.doesNotMatch(withServer, /role="alert"/);
});

test('saving state disables the button and shows it busy', () => {
  const html = decode(mount(h(HiddenWordsEditor, { value: ['ok'], onSave() {}, saving: true })));
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled/);
  assert.match(html, /aria-busy="true"|Spinner|animate-spin/, 'the design system marks a loading button');
});
