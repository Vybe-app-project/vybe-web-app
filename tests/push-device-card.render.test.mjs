import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/**
 * The "Notifications on this device" card in all five states. Presentational
 * — every value arrives as a prop — so react-dom/server renders exactly what
 * the browser does.
 */
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const { PUSH_DEVICE_COPY, PUSH_DEVICE_TITLE } = await import('../src/lib/pushDevice.ts');
const { PushDeviceCard } = await import('../src/pages/settings/PushDeviceCard.tsx');

const decode = (html) =>
  html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/<!-- -->/g, '');

const noop = () => {};
const card = (state, props = {}) =>
  decode(
    renderToString(
      h(MemoryRouter, null, h(ToastProvider, null, h(PushDeviceCard, { state, onEnable: noop, onDisable: noop, ...props }))),
    ),
  );

const buttons = (html) => [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
const label = (button) => button.replace(/<[^>]+>/g, '').trim();

test('the card is the #push-device region and always names itself', () => {
  for (const state of ['default', 'granted', 'denied', 'unsupported', 'needs-install']) {
    const html = card(state);
    assert.match(html, /<[a-z]+[^>]*id="push-device"[^>]*role="region"[^>]*aria-labelledby="push-device-title"/, state);
    assert.match(html, new RegExp(`<h2[^>]*id="push-device-title"[^>]*>${PUSH_DEVICE_TITLE}</h2>`), state);
  }
});

test('nothing has been decided: one blue button and one line saying what arrives', () => {
  const html = card('default');
  assert.match(html, new RegExp(PUSH_DEVICE_COPY.default.line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const rows = buttons(html);
  assert.equal(rows.length, 1, 'one action, nothing else to press');
  assert.equal(label(rows[0]), PUSH_DEVICE_COPY.default.action);
  // The one blue on the card (DESIGN.md: one primary per screen).
  assert.match(rows[0], /btn-primary/);
  assert.equal((html.match(/btn-primary/g) || []).length, 1);
});

test('on for this device: a quiet way off, no second blue', () => {
  const html = card('granted');
  assert.match(html, new RegExp(PUSH_DEVICE_COPY.granted.line));
  const rows = buttons(html);
  assert.equal(rows.length, 1);
  assert.equal(label(rows[0]), PUSH_DEVICE_COPY.granted.action);
  assert.match(rows[0], /btn-quiet/, 'turning notifications off is not what this card is for');
  assert.doesNotMatch(html, /btn-primary/);
});

test('blocked: the sentence names the browser, and there is no button to press', () => {
  const html = card('denied');
  assert.match(html, /Notifications are blocked for vybeapp\.fit in your browser settings\./);
  assert.equal(buttons(html).length, 0, 'the page cannot re-ask a denied permission');
});

test('unsupported: one honest line, no button', () => {
  const html = card('unsupported');
  assert.match(html, new RegExp(PUSH_DEVICE_COPY.unsupported.line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(buttons(html).length, 0);
});

test('iPhone in a tab: the Home Screen step, with how to take it', () => {
  const html = card('needs-install');
  assert.match(html, /Add Vybe to your Home Screen to get notifications on iPhone\./);
  assert.match(html, /tap the share button, choose Add to Home Screen/);
  assert.equal(buttons(html).length, 0, 'the browser has nothing to prompt for yet');
});

test('a request in flight disables the action rather than losing the press', () => {
  const html = card('default', { busy: true });
  assert.match(buttons(html)[0], /disabled/);
  assert.match(buttons(html)[0], /aria-busy="true"/);
});
