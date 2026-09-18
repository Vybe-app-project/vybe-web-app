import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LB_TO_KG = 0.45359237;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
class SmokeFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const check = (condition, code) => { if (!condition) throw new SmokeFailure(code); };
const near = (actual, expected) => typeof actual === 'number' && Math.abs(actual - expected) < 1e-8;

export function readConfig(env) {
  let origin;
  try { origin = new URL(env.ORIGIN); } catch { throw new SmokeFailure('INVALID_ORIGIN'); }
  check(!origin.username && !origin.password && !origin.search && !origin.hash
    && origin.pathname === '/', 'ORIGIN_MUST_BE_BARE');
  check(origin.protocol === 'https:' || (origin.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)), 'HTTPS_REQUIRED');
  check(typeof env.VYBE_EMAIL === 'string' && env.VYBE_EMAIL.trim(), 'EMAIL_REQUIRED');
  check(typeof env.VYBE_PASSWORD === 'string' && env.VYBE_PASSWORD.length > 0, 'PASSWORD_REQUIRED');
  check(typeof env.VYBE_PLAYWRIGHT === 'string' && path.isAbsolute(env.VYBE_PLAYWRIGHT), 'PLAYWRIGHT_PATH_REQUIRED');
  check(!env.VYBE_CHROMIUM_EXECUTABLE || path.isAbsolute(env.VYBE_CHROMIUM_EXECUTABLE), 'INVALID_CHROMIUM_PATH');
  check(!env.VYBE_HEADLESS || ['0', '1'].includes(env.VYBE_HEADLESS), 'INVALID_HEADLESS_FLAG');
  return {
    origin: origin.origin, email: env.VYBE_EMAIL.trim(), password: env.VYBE_PASSWORD,
    playwright: env.VYBE_PLAYWRIGHT, executablePath: env.VYBE_CHROMIUM_EXECUTABLE || undefined,
    headless: env.VYBE_HEADLESS === '1',
  };
}

export function createLedger(names) {
  const allowedNames = new Set(names);
  const rows = new Map();
  return {
    rows,
    record(workout, expectedName) {
      check(allowedNames.has(expectedName), 'UNOWNED_CREATE_NAME');
      check(workout && OBJECT_ID.test(workout._id) && workout.name === expectedName, 'INVALID_CREATE_IDENTITY');
      check(!rows.has(workout._id), 'CREATE_REUSED_RECORD_ID');
      rows.set(workout._id, expectedName);
      return workout;
    },
    requireOwned(id) { check(rows.has(id) && OBJECT_ID.test(id), 'UNOWNED_RECORD'); },
  };
}

// No list/search fallback: deletion is confined to IDs returned by this run's
// two named UI creations, rechecked against their unique names before DELETE.
export async function cleanupOwned(ledger, request) {
  const result = { deleted: 0, failed: 0 };
  for (const [id, name] of [...ledger.rows].reverse()) {
    try {
      ledger.requireOwned(id);
      const before = await request('GET', id);
      check(before.status === 200 && before.workout?._id === id && before.workout?.name === name, 'CLEANUP_IDENTITY_MISMATCH');
      check((await request('DELETE', id)).status === 200, 'CLEANUP_DELETE_FAILED');
      check((await request('GET', id)).status === 404, 'CLEANUP_NOT_REMOVED');
      result.deleted += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

async function browserRequest(page, origin, ledger, method, id, body) {
  ledger.requireOwned(id);
  check(['GET', 'PATCH', 'DELETE'].includes(method), 'UNSUPPORTED_REQUEST');
  check(new URL(page.url()).origin === origin, 'BROWSER_ORIGIN_CHANGED');
  return page.evaluate(async ({ method: verb, recordId, payload }) => {
    const token = localStorage.getItem('vybe.token');
    if (!token) throw new Error('Missing browser session');
    const response = await fetch(`/api/workouts/logs/${recordId}`, {
      method: verb,
      headers: { Authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const json = await response.json();
    const workout = json.workout;
    // No credentials, response error text, media URLs or other private rows
    // leave this page evaluation.
    return {
      status: response.status,
      ...(workout ? { workout: {
        _id: workout._id, name: workout.name, revision: workout.revision,
        setRecordsVersion: workout.setRecordsVersion, volumeKg: workout.volumeKg,
        notes: workout.notes, updatedAt: workout.updatedAt, exercises: workout.exercises,
      } } : {}),
    };
  }, { method, recordId: id, payload: body });
}

function responseFor(page, origin, method, pathname, name) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    if (url.origin !== origin || url.pathname !== pathname || response.request().method() !== method) return false;
    if (name === undefined) return true;
    try { return response.request().postDataJSON()?.name === name; } catch { return false; }
  });
}

async function submitLog(page, config, ledger, button, { name, id }) {
  const responsePromise = responseFor(page, config.origin, id ? 'PATCH' : 'POST',
    id ? `/api/workouts/logs/${id}` : '/api/workouts/logs', name);
  const [response] = await Promise.all([responsePromise, button.click()]);
  const body = await response.json();
  // Track a returned owned ID even if the HTTP status is unexpected, so an
  // assertion failure does not strand an otherwise identifiable creation.
  if (!id && body.workout) ledger.record(body.workout, name);
  check(response.status() === (id ? 200 : 201), 'UI_SAVE_RESPONSE_FAILED');
  if (!id) check(ledger.rows.has(body.workout?._id), 'CREATE_ID_MISSING');
  else check(body.workout?._id === id, 'EDIT_ID_CHANGED');
  check(body.workout?.setRecordsVersion === 1, 'SET_VERSION_MISSING');
  return body.workout;
}

async function readOwned(request, id) {
  const response = await request('GET', id);
  check(response.status === 200 && response.workout?._id === id, 'SERVER_GET_FAILED');
  return response.workout;
}

function cardFor(page, name) {
  return page.locator('.card').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

async function displayedVolume(page, name, volume, completed) {
  const card = cardFor(page, name);
  await card.waitFor({ state: 'visible' });
  check(await card.count() === 1, 'AMBIGUOUS_SESSION_CARD');
  await card.getByText(`${completed}/2 sets completed`, { exact: true }).waitFor();
  if (volume > 0) {
    const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(volume);
    await card.getByText(`${formatted} kg lifted`, { exact: true }).waitFor();
  } else {
    check(await card.getByText(/kg lifted/).count() === 0, 'UNCOMPLETED_VOLUME_DISPLAYED');
  }
}

export async function runLiveSmoke(config, report = console.log) {
  const runId = randomUUID();
  const name = `vybe-live-sets-${runId}`;
  const repeatName = `${name}-repeat`;
  const ledger = createLedger([name, repeatName]);
  const profileRoot = path.resolve('.live-workout-sets', runId);
  const previousTempDirectory = process.env.TMPDIR;
  const previousDebug = process.env.DEBUG;
  let browser, context, page;
  let stage = 'browser setup';
  let failure;
  let cleanup = { deleted: 0, failed: 0 };
  const request = (method, id, body) => browserRequest(page, config.origin, ledger, method, id, body);
  try {
    await mkdir(profileRoot, { recursive: true, mode: 0o700 });
    process.env.TMPDIR = profileRoot;
    // Playwright API debug logging can print fill arguments, including login
    // credentials. Disable it before importing Playwright.
    process.env.DEBUG = '';
    const { chromium } = await import(pathToFileURL(config.playwright).href);
    browser = await chromium.launch({
      headless: config.headless, executablePath: config.executablePath,
      env: { ...process.env, VYBE_EMAIL: '', VYBE_PASSWORD: '' },
    });
    context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US', viewport: { width: 1280, height: 900 } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['http:', 'https:'].includes(url.protocol) && url.origin !== config.origin
        ? route.abort('blockedbyclient') : route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(30_000);

    stage = 'UI login';
    const loginPage = await page.goto(`${config.origin}/login?next=%2Fworkouts%2Flogs`);
    check(loginPage?.ok(), 'LOGIN_PAGE_FAILED');
    await page.getByLabel('Email', { exact: true }).fill(config.email);
    await page.getByLabel('Password', { exact: true }).fill(config.password);
    const [login] = await Promise.all([
      responseFor(page, config.origin, 'POST', '/api/auth/login'),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    check(login.status() === 200, 'LOGIN_RESPONSE_FAILED');
    await page.waitForURL(`${config.origin}/workouts/logs`);
    await page.getByRole('heading', { name: 'Workout log', exact: true }).waitFor();
    report('PASS UI login');

    stage = 'create mixed-unit session';
    // The header action is first; an empty history may expose another action
    // with the same accessible name below it.
    await page.getByRole('button', { name: 'Log session', exact: true }).first().click();
    let dialog = page.getByRole('dialog', { name: 'Log a session', exact: true });
    await dialog.waitFor();
    await dialog.getByLabel('Session name', { exact: true }).fill(name);
    await dialog.getByLabel('Exercise 1 name', { exact: true }).fill('Smoke external-load check');
    await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).fill('5');
    await dialog.getByLabel('Exercise 1 set 1 weight', { exact: true }).fill('10');
    await dialog.getByRole('checkbox', { name: 'Exercise 1 set 1 completed', exact: true }).check();
    await dialog.getByRole('button', { name: 'Add set to exercise 1', exact: true }).click();
    await dialog.getByLabel('Exercise 1 set 2 reps', { exact: true }).fill('5');
    await dialog.getByLabel('Exercise 1 set 2 weight', { exact: true }).fill('20');
    await dialog.getByRole('combobox', { name: 'Exercise 1 set 2 unit', exact: true }).click();
    await page.getByRole('option', { name: 'lb', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Exercise 1 set 2 completed', exact: true }).check();
    const created = await submitLog(page, config, ledger,
      dialog.getByRole('button', { name: 'Log session', exact: true }), { name });
    await dialog.waitFor({ state: 'hidden' });
    let saved = await readOwned(request, created._id);
    const initialSets = saved.exercises?.[0]?.setRecords;
    check(saved.name === name && Number.isSafeInteger(saved.revision), 'INVALID_CREATED_LOG');
    check(initialSets?.length === 2 && initialSets[0].completed && initialSets[1].completed
      && initialSets[0].reps === 5 && initialSets[0].weight === 10 && initialSets[0].weightUnit === 'kg'
      && initialSets[1].reps === 5 && initialSets[1].weight === 20 && initialSets[1].weightUnit === 'lb', 'CREATED_SETS_MISMATCH');
    check(typeof saved.exercises[0].exerciseId === 'string'
      && initialSets.every(set => typeof set.id === 'string' && set.id.length > 0)
      && new Set(initialSets.map(set => set.id)).size === 2, 'CREATED_STABLE_IDS_MISSING');
    check(near(saved.volumeKg, 50 + 100 * LB_TO_KG), 'MIXED_VOLUME_MISMATCH');
    await displayedVolume(page, name, saved.volumeKg, 2);
    report('PASS create + server GET + mixed-unit displayed volume');

    stage = 'edit completion and reps';
    await cardFor(page, name).getByRole('button', { name: `Options for ${name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Edit session', exact: true });
    await dialog.waitFor();
    await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).fill('7');
    await dialog.getByRole('checkbox', { name: 'Exercise 1 set 2 completed', exact: true }).uncheck();
    await submitLog(page, config, ledger, dialog.getByRole('button', { name: 'Save changes', exact: true }),
      { name, id: saved._id });
    await dialog.waitFor({ state: 'hidden' });
    const edited = await readOwned(request, saved._id);
    const editedSets = edited.exercises?.[0]?.setRecords;
    check(edited.revision === saved.revision + 1 && near(edited.volumeKg, 70), 'EDIT_REVISION_OR_VOLUME_MISMATCH');
    check(editedSets?.length === 2 && editedSets[0].id === initialSets[0].id && editedSets[0].reps === 7
      && editedSets[0].completed && editedSets[1].id === initialSets[1].id && !editedSets[1].completed
      && edited.exercises[0].exerciseId === saved.exercises[0].exerciseId, 'EDIT_SET_HISTORY_MISMATCH');
    await displayedVolume(page, name, 70, 1);
    report('PASS edit + revision increment + completed-only displayed volume');

    stage = 'legacy PATCH protection';
    const legacy = await request('PATCH', saved._id, { notes: 'Live smoke legacy edit must be rejected' });
    check(legacy.status === 409, 'LEGACY_PATCH_NOT_REJECTED');
    const unchanged = await readOwned(request, saved._id);
    check(JSON.stringify(unchanged) === JSON.stringify(edited), 'LEGACY_PATCH_CHANGED_LOG');
    report('PASS legacy metadata PATCH rejected with 409; record unchanged');

    stage = 'repeat with fresh incomplete sets';
    await cardFor(page, name).getByRole('button', { name: `Options for ${name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: /^Log again/ }).click();
    dialog = page.getByRole('dialog', { name: 'Log a session', exact: true });
    await dialog.waitFor();
    await dialog.getByLabel('Session name', { exact: true }).fill(repeatName);
    check(!(await dialog.getByRole('checkbox', { name: 'Exercise 1 set 1 completed', exact: true }).isChecked())
      && !(await dialog.getByRole('checkbox', { name: 'Exercise 1 set 2 completed', exact: true }).isChecked()), 'REPEAT_PRECOMPLETED');
    await dialog.getByText('Session volume: 0 kg', { exact: true }).waitFor();
    const repeated = await submitLog(page, config, ledger,
      dialog.getByRole('button', { name: 'Log session', exact: true }), { name: repeatName });
    await dialog.waitFor({ state: 'hidden' });
    saved = await readOwned(request, repeated._id);
    const repeatedSets = saved.exercises?.[0]?.setRecords;
    check(typeof saved.exercises?.[0]?.exerciseId === 'string'
      && saved.exercises[0].exerciseId !== edited.exercises[0].exerciseId, 'REPEAT_EXERCISE_ID_REUSED');
    const oldSetIds = new Set(editedSets.map(set => set.id));
    check(repeatedSets?.length === 2 && repeatedSets.every((set, index) => !set.completed
      && typeof set.id === 'string' && set.id.length > 0 && !oldSetIds.has(set.id)
      && set.reps === editedSets[index].reps && set.weight === editedSets[index].weight
      && set.weightUnit === editedSets[index].weightUnit)
      && new Set(repeatedSets.map(set => set.id)).size === 2, 'REPEAT_SETS_MISMATCH');
    check(near(saved.volumeKg, 0), 'REPEAT_VOLUME_NOT_ZERO');
    await displayedVolume(page, repeatName, 0, 0);
    report('PASS repeat + fresh IDs + preserved values + zero completed volume');
  } catch (error) {
    // Playwright errors may include filled values or response bodies. Never
    // print arbitrary messages, stacks, request headers or page console output.
    failure = new SmokeFailure(error instanceof SmokeFailure ? error.code : 'CONTROL_OR_RESPONSE_FAILURE');
    report(`FAIL ${stage}: ${failure.code}`);
  } finally {
    if (ledger.rows.size) cleanup = await cleanupOwned(ledger, request);
    report(`CLEANUP deleted=${cleanup.deleted} failed=${cleanup.failed} recorded=${ledger.rows.size}`);
    try { await context?.close(); } catch { failure ??= new SmokeFailure('CONTEXT_CLOSE_FAILED'); }
    try { await browser?.close(); } catch { failure ??= new SmokeFailure('BROWSER_CLOSE_FAILED'); }
    if (previousTempDirectory === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTempDirectory;
    if (previousDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = previousDebug;
    try { await rm(profileRoot, { recursive: true, force: true }); } catch { failure ??= new SmokeFailure('PROFILE_CLEANUP_FAILED'); }
  }
  check(!failure, failure?.code ?? 'SMOKE_FAILED');
  check(cleanup.failed === 0 && cleanup.deleted === 2, 'CLEANUP_INCOMPLETE');
  report('PASS live workout-set smoke; both recorded rows deleted; browser closed without logout');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runLiveSmoke(readConfig(process.env));
  } catch (error) {
    console.error(`FAIL live workout-set smoke: ${error instanceof SmokeFailure ? error.code : 'UNEXPECTED_FAILURE'}`);
    process.exitCode = 1;
  }
}
