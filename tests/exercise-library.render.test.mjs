/**
 * The exercise library's surfaces render from props alone (renderToString
 * inside a MemoryRouter): a picker row draws the rendition the API sent — the
 * exact URL, its own width and height, `loading="lazy"` — and falls back to
 * the glyph tile when an exercise has no photos; the exercise page's fact list
 * carries a glyph, a label and only the values the record actually has; the
 * two frames are a labelled pair under Reduce Motion and one crossfading box
 * otherwise; the source's attribution prints as given and links to it.
 *
 * Nothing on any of them prints a zero: `popularity: 0` and an absent level
 * are holes, not facts. The pure helpers behind the meta line, the rendition
 * choice and the feature detection are pinned here too.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const lib = await import('../src/lib/exerciseLibrary.ts');
const picker = await import('../src/pages/workouts/ExercisePicker.tsx');
const page = await import('../src/pages/ExerciseDetail.tsx');

const render = (ui) => renderToString(h(MemoryRouter, null, ui));
const inList = (ui) => renderToString(h(MemoryRouter, null, h('ul', null, ui)));
const count = (html, needle) => html.split(needle).length - 1;
/** Visible text only: class names and pixel attributes are full of digits. */
const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, '’').replace(/\s+/g, ' ');
const MEDIA = 'https://api.vybeapp.fit/api/exercises/library/media/barbell-squat';

const squat = {
  slug: 'barbell-squat',
  name: 'Barbell Squat',
  muscleGroups: ['quads'],
  secondaryMuscleGroups: ['lower-back', 'glutes'],
  equipment: 'barbell',
  category: 'strength',
  level: 'beginner',
  media: [
    { frame: 0, width: 200, height: 133, mime: 'image/webp', url: `${MEDIA}/0-200.webp` },
    { frame: 0, width: 400, height: 267, mime: 'image/webp', url: `${MEDIA}/0-400.webp` },
    { frame: 0, width: 800, height: 533, mime: 'image/webp', url: `${MEDIA}/0-800.webp` },
    { frame: 1, width: 200, height: 133, mime: 'image/webp', url: `${MEDIA}/1-200.webp` },
    { frame: 1, width: 800, height: 533, mime: 'image/webp', url: `${MEDIA}/1-800.webp` },
  ],
  isCustom: false,
  popularity: 0,
};

const meta = {
  muscleGroups: [
    { key: 'quads', label: 'Quads' },
    { key: 'lower-back', label: 'Lower back' },
    { key: 'glutes', label: 'Glutes' },
  ],
  equipment: [
    { key: 'barbell', label: 'Barbell' },
    { key: 'ez-curl-bar', label: 'EZ curl bar' },
  ],
  categories: [{ key: 'strength', label: 'Strength' }],
  levels: [{ key: 'beginner', label: 'Beginner' }],
  attributions: [{ source: 'free-exercise-db', url: 'https://github.com/yuhonas/free-exercise-db', text: 'Exercise names, instructions and photos from Free Exercise DB, released into the public domain under the Unlicense.' }],
  total: 876,
};

/* ------------------------------------------------------------------ helpers */

test('thumbnailOf picks the rendition the API sent for that frame, never a built URL', () => {
  assert.equal(lib.thumbnailOf(squat, 200, 0).url, `${MEDIA}/0-200.webp`);
  assert.equal(lib.thumbnailOf(squat, 800, 1).url, `${MEDIA}/1-800.webp`);
  // Frame 1 has no 400 px copy: the next one up wins, so nothing is upscaled.
  assert.equal(lib.thumbnailOf(squat, 400, 1).url, `${MEDIA}/1-800.webp`);
  // Nothing above the ask: the largest below it, rather than no image at all.
  assert.equal(lib.thumbnailOf(squat, 2000, 0).url, `${MEDIA}/0-800.webp`);
  assert.equal(lib.thumbnailOf({ media: [] }), null);
  assert.equal(lib.thumbnailOf(undefined), null);
  assert.equal(lib.thumbnailOf(squat, 200, 7), null, 'a frame the exercise does not have is no image');
  assert.deepEqual(lib.framesOf(squat), [0, 1]);
  assert.deepEqual(lib.framesOf({ media: [] }), []);
});

test('exerciseMetaLine: equipment, the primary muscle and level, labelled by /meta, only what the row carries', () => {
  const labels = lib.labelsOf(meta);
  assert.equal(lib.exerciseMetaLine(squat, labels), 'Barbell · Quads · Beginner');
  assert.equal(lib.exerciseMetaLine({ equipment: 'ez-curl-bar', muscleGroups: [], level: null }, labels), 'EZ curl bar', 'the API label wins over humanising the key');
  assert.equal(lib.exerciseMetaLine({ equipment: null, muscleGroups: ['lats'], level: null }), 'Lats', 'no meta yet: the key is humanised');
  assert.equal(lib.exerciseMetaLine({ equipment: null, muscleGroups: [], level: null }), '');
  assert.equal(lib.exerciseMetaLine(null), '');
});

test('the library is feature-detected on a 404/501 or an empty meta, never on an error state', () => {
  assert.equal(lib.isLibraryUnavailable({ response: { status: 404 } }), true);
  assert.equal(lib.isLibraryUnavailable({ response: { status: 501 } }), true);
  assert.equal(lib.isLibraryUnavailable({ response: { status: 500 } }), false);
  assert.equal(lib.isLibraryUnavailable({ response: { status: 429 } }), false, 'a rate limit is not a missing feature');
  assert.equal(lib.isLibraryUnavailable(null), false);
  assert.equal(lib.metaIsEmpty(meta), false);
  assert.equal(lib.metaIsEmpty({ muscleGroups: [], equipment: [], categories: [], levels: [], attributions: [], total: 0 }), true);
  assert.equal(lib.metaIsEmpty(undefined), false, 'nothing read yet is not "not available"');
  assert.match(lib.LIBRARY_UNAVAILABLE_COPY, /still loading onto Vybe/);
});

test('exerciseFacts: only rows with a value, the source words when it has them', () => {
  const labels = lib.labelsOf(meta);
  const facts = lib.exerciseFacts({ ...squat, primaryMuscles: ['quadriceps'], force: 'push', mechanic: 'compound' }, labels);
  assert.deepEqual(
    facts.map((f) => f.label),
    ['Equipment', 'Primary', 'Secondary', 'Level', 'Force', 'Mechanic'],
  );
  assert.equal(facts[0].value, 'Barbell');
  assert.equal(facts[1].value, 'Quadriceps', "the source's own label wins when it sent one");
  assert.equal(facts[2].value, 'Lower back, Glutes');
  const bare = lib.exerciseFacts({ ...squat, equipment: null, level: null, muscleGroups: [], secondaryMuscleGroups: [] }, labels);
  assert.deepEqual(
    bare.map((f) => f.label),
    [],
    'nothing known: no rows at all, never a row reading "—"',
  );
  assert.deepEqual(lib.exerciseFacts(null), []);
});

/* -------------------------------------------------------------- picker rows */

test('a picker row: the API rendition at 200 px, lazy, its own box, the name and "Barbell · Quads · Beginner"', () => {
  const html = inList(h('li', null, h(picker.ExerciseResultRow, { exercise: squat, labels: lib.labelsOf(meta), infoTo: '/exercises/barbell-squat' })));
  assert.match(html, new RegExp(`src="${MEDIA}/0-200\\.webp"`), 'the exact URL the API returned');
  assert.equal(count(html, 'loading="lazy"'), 1);
  assert.match(html, /width="200"/);
  assert.match(html, /height="133"/);
  assert.match(html, /class="[^"]*h-12 w-12/, 'the 48 px thumbnail');
  assert.match(html, /class="t-name[^"]*">Barbell Squat</);
  assert.match(html, /class="t-meta[^"]*">Barbell · Quads · Beginner</);
  assert.match(html, /aria-label="About Barbell Squat"[^>]*href="\/exercises\/barbell-squat"/);
  assert.ok(html.includes('target="_blank"'), 'the info affordance leaves the half-typed session alone');
  assert.ok(!/\b0\b/.test(textOf(html)), `popularity 0 must not print: ${textOf(html)}`);
  assert.ok(!html.includes('NaN'));
});

test('a picker row with no photos falls back to the glyph tile and reserves the same 48 px', () => {
  const html = inList(h('li', null, h(picker.ExerciseResultRow, { exercise: { ...squat, media: [] } })));
  assert.ok(!html.includes('<img'), 'no image element at all, never a broken src');
  assert.match(html, /aria-hidden="true"[^>]*class="[^"]*h-12 w-12/);
  assert.match(html, /class="t-name[^"]*">Barbell Squat</);
  assert.ok(!/\b0\b/.test(textOf(html)));
});

test('a custom exercise the library does not know carries no page link, and the typed name is always an answer', () => {
  const stub = { slug: 'my-cable-thing', name: 'My cable thing', muscleGroups: [], secondaryMuscleGroups: [], equipment: null, category: null, level: null, media: [], isCustom: true, popularity: 0 };
  const row = inList(h('li', null, h(picker.ExerciseResultRow, { exercise: stub })));
  assert.ok(!row.includes('/exercises/'), 'no exercise page for an id the library has never heard of');

  const custom = render(h(picker.CustomExerciseRow, { query: 'front squat', onChoose: () => {} }));
  assert.ok(custom.includes('Use “front squat” as a custom exercise'), 'curly quotes around the words they typed');
  assert.match(custom, /aria-label="Use front squat as a custom exercise"/);
  assert.match(custom, /data-picker-row/, 'the arrow keys walk it like any other row');
  assert.match(custom, /min-h-18/, 'the same 72 px row geometry, so the list never shifts');
});

/* ----------------------------------------------------------- exercise page */

test('the fact list: a glyph, a label and a value per row; rows without a value are absent', () => {
  const html = render(h(page.ExerciseFactList, { exercise: { ...squat, force: 'push', mechanic: 'compound' } }));
  for (const label of ['Equipment', 'Primary', 'Secondary', 'Level', 'Force', 'Mechanic']) assert.ok(html.includes(`>${label}<`), label);
  assert.ok(html.includes('Barbell') && html.includes('Quads') && html.includes('Push') && html.includes('Compound'));
  assert.equal(count(html, '<dt'), 6);
  assert.equal(count(html, '<svg'), 6, 'one decorative glyph per row');
  assert.ok(!/\b0\b/.test(textOf(html)));

  const bare = render(h(page.ExerciseFactList, { exercise: { ...squat, equipment: null, level: null, muscleGroups: [], secondaryMuscleGroups: [] } }));
  assert.equal(bare, '', 'nothing known: the whole list is omitted, not an empty shell');
});

test('the two frames: a labelled pair under Reduce Motion, one crossfading box otherwise, nothing at all without photos', () => {
  const still = render(h(page.ExerciseFrames, { exercise: squat, reduce: true }));
  assert.equal(count(still, '<img'), 2);
  assert.match(still, new RegExp(`src="${MEDIA}/0-800\\.webp"`));
  assert.match(still, new RegExp(`src="${MEDIA}/1-800\\.webp"`));
  assert.ok(still.includes('alt="Barbell Squat, start position"') && still.includes('alt="Barbell Squat, end position"'));
  assert.ok(!still.includes('transition-opacity'), 'reduced motion means no transition to collapse');
  assert.match(still, /aspect-ratio:800 \/ 533/, 'each frame reserves the box the API measured');

  const fade = render(h(page.ExerciseFrames, { exercise: squat, reduce: false }));
  assert.equal(count(fade, '<img'), 2);
  assert.equal(count(fade, 'transition-opacity dur-3'), 2, 'one motion source, and dur-3 is 1 ms under reduced motion');
  assert.match(fade, /role="img"[^>]*aria-label="Barbell Squat, start and end position"|aria-label="Barbell Squat, start and end position"[^>]*role="img"/);

  const one = render(h(page.ExerciseFrames, { exercise: { ...squat, media: squat.media.filter((m) => m.frame === 0) } }));
  assert.equal(count(one, '<img'), 1);
  assert.ok(!one.includes('grid-cols-2'), 'one frame is not a pair');
  assert.equal(render(h(page.ExerciseFrames, { exercise: { ...squat, media: [] } })), '', 'no photos, no placeholder');
});

test('the attribution prints the sentence the API generated and links to the source', () => {
  const html = render(h(page.ExerciseAttributionLine, { attribution: meta.attributions[0].text, url: meta.attributions[0].url }));
  assert.ok(html.includes(meta.attributions[0].text));
  assert.match(html, /href="https:\/\/github\.com\/yuhonas\/free-exercise-db"/);
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.match(html, /class="t-meta"/);
  assert.ok(render(h(page.ExerciseAttributionLine, { attribution: meta.attributions[0].text })).includes(meta.attributions[0].text), 'no source URL still credits the source');
  assert.equal(render(h(page.ExerciseAttributionLine, { attribution: null })), '');
});
