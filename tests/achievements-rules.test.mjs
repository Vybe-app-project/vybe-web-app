/**
 * Achievements under auto-award: the pure display rules (retired, earned,
 * flag, award state, units, summary) and the source pins that keep the page,
 * the card and the Profile shortcut on one list and one flag.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const lib = await import('../src/lib/achievements.ts');

const { seed } = await import('./achievements-seed.mjs');

/* ------------------------------------------------------------------ rules */

test('retired definitions stay hidden unless the member already earned them', () => {
  assert.equal(lib.isRetired({ isActive: false }), true);
  assert.equal(lib.isRetired({ isActive: true }), false);
  assert.equal(lib.isRetired({}), false);
  assert.equal(lib.isVisible({ isActive: false, isEarned: false }), false);
  assert.equal(lib.isVisible({ isActive: false }), false);
  assert.equal(lib.isVisible({ isActive: false, isEarned: true }), true);
  assert.equal(lib.isVisible({ isActive: true }), true);
  assert.equal(lib.isVisible({}), true);
});

test('Claim shows only where the server still runs the claim flow and the row says it can be claimed', () => {
  // Flag on (or capabilities not yet answered): never, even when the row says canClaim.
  assert.equal(lib.showClaim({ canClaim: true, isEarned: false }, false), false);
  assert.equal(lib.showClaim({ canClaim: true, isEarned: false }, true), true);
  assert.equal(lib.showClaim({ canClaim: true, isEarned: true }, true), false);
  assert.equal(lib.showClaim({ canClaim: false }, true), false);
  assert.equal(lib.showClaim({}, true), false);
});

test('award state: backfill reads Awarded with no date, every other earned row shows when', () => {
  assert.deepEqual(lib.awardState({ isEarned: true, awardedBy: 'backfill' }), { kind: 'awarded', label: 'Awarded', showDate: false });
  for (const awardedBy of ['auto', 'claim', undefined, null]) {
    assert.deepEqual(lib.awardState({ isEarned: true, awardedBy }), { kind: 'earned', label: 'Earned', showDate: true }, String(awardedBy));
  }
  assert.deepEqual(lib.awardState({ isEarned: false, awardedBy: null }), { kind: 'unearned' });
  assert.deepEqual(lib.awardState({}), { kind: 'unearned' });
});

test('a new award is an unacknowledged auto award and nothing else', () => {
  assert.equal(lib.isNewAward({ isEarned: true, awardedBy: 'auto', ackedAt: null }), true);
  assert.equal(lib.isNewAward({ isEarned: true, awardedBy: 'auto' }), true);
  assert.equal(lib.isNewAward({ isEarned: true, awardedBy: 'backfill', ackedAt: null }), false);
  assert.equal(lib.isNewAward({ isEarned: true, awardedBy: 'claim', ackedAt: null }), false);
  assert.equal(lib.isNewAward({ isEarned: true, awardedBy: 'auto', ackedAt: '2026-09-12T12:05:00.000Z' }), false);
  assert.equal(lib.isNewAward({ isEarned: false, awardedBy: null, ackedAt: null }), false);
});

test('criteria units mirror the API notification copy, and weeksKept carries an explainer', () => {
  assert.equal(lib.criteriaUnit('weeksKept', 1), 'week kept');
  assert.equal(lib.criteriaUnit('weeksKept', 4), 'weeks kept');
  assert.equal(lib.criteriaUnit('workouts', 1), 'session');
  assert.equal(lib.criteriaUnit('workouts', 10), 'sessions');
  assert.equal(lib.criteriaUnit('likes', 10), 'kudos received');
  assert.equal(lib.criteriaUnit('likes', 1), 'kudos received');
  assert.equal(lib.criteriaUnit('comments', 1), 'comment received');
  assert.equal(lib.criteriaUnit('comments', 5), 'comments received');
  assert.equal(lib.criteriaUnit('followers', 10), 'followers');
  assert.equal(lib.criteriaUnit('steps', 10000), 'steps');
  assert.equal(lib.criteriaUnit('posts', 1), 'post');
  // Unknown keys keep the humanised lowercase fallback.
  assert.equal(lib.criteriaUnit('calories', 1000), 'calories');
  assert.equal(lib.criteriaUnit('custom', 1), 'custom');
  assert.equal(lib.criteriaUnit('someOtherThing', 2), 'some other thing');
  assert.equal(lib.criteriaUnit(undefined, 2), '');
  assert.equal(lib.criteriaExplainer('weeksKept'), 'Weeks kept counts weeks in a row in which you met your Weekly Rhythm target.');
  assert.equal(lib.criteriaExplainer('workouts'), undefined);
  assert.equal(lib.criteriaExplainer(undefined), undefined);
});

test('summary over the 13 seed rows counts visible rows, new awards, progress and the Rhythm run', () => {
  const rows = seed();
  assert.equal(rows.length, 13);
  assert.equal(new Set(rows.map((r) => r._id)).size, 13, 'every seed row has its own id');
  assert.ok(rows.every((r) => /^[0-9a-f]{24}$/.test(r._id)));
  assert.deepEqual(seed().map((r) => r._id), rows.map((r) => r._id), 'ids are stable across calls');
  const s = lib.summarize(rows);
  // 11 active rows plus the earned retired one; the unearned retired one is out.
  assert.equal(s.total, 12);
  assert.equal(s.earned, 4);
  assert.equal(s.points, 50 + 150 + 100 + 50);
  assert.equal(s.newAwards, 1);
  assert.equal(s.claimable, 1);
  assert.equal(s.pendingPoints, 125);
  assert.equal(s.inProgress, 6);
  assert.deepEqual(s.weeksKept, { progress: 1, required: 4 });
  assert.deepEqual(s.milestones, { earned: 0, total: 3 });
  assert.deepEqual(lib.summarize([]), {
    total: 0, earned: 0, claimable: 0, newAwards: 0, inProgress: 0, points: 0, pendingPoints: 0, weeksKept: null, milestones: { earned: 0, total: 0 },
  });
  assert.deepEqual(lib.summarize(undefined).total, 0);
  // A retired row the member never earned changes nothing.
  const without = lib.summarize(seed({ retiredEarned: false }));
  assert.equal(without.total, 11);
  assert.equal(without.earned, 3);
  assert.equal(without.points, 250);
  for (const value of Object.values(s)) assert.ok(!Number.isNaN(value), 'no NaN in the summary');
});

test('filter options offer only the categories and rarities the API returned, in display order', () => {
  assert.deepEqual(lib.filterOptionsFrom(seed()), {
    categories: ['workout', 'milestone', 'streak', 'social'],
    rarities: ['common', 'uncommon', 'rare', 'epic'],
  });
  assert.deepEqual(lib.filterOptionsFrom(seed({ retiredEarned: false })).categories, ['workout', 'milestone', 'social']);
  assert.deepEqual(lib.filterOptionsFrom([]), { categories: [], rarities: [] });
  assert.deepEqual(lib.filterOptionsFrom(null), { categories: [], rarities: [] });
  assert.deepEqual([...lib.CATEGORIES], ['workout', 'milestone', 'streak', 'nutrition', 'social', 'special', 'seasonal']);
  assert.deepEqual([...lib.RARITIES], ['common', 'uncommon', 'rare', 'epic', 'legendary']);
  assert.equal(lib.categoryOf({ category: 'bogus' }), 'special');
  assert.equal(lib.rarityOf({ rarity: 'bogus' }), 'common');
});

test('catalogue rows borrow every per-member field from the /user list', () => {
  const [own] = seed().slice(1, 2);
  const merged = lib.withMemberFields({ ...own, isEarned: undefined, awardedBy: undefined, ackedAt: undefined, canClaim: undefined }, own);
  assert.equal(merged.isEarned, true);
  assert.equal(merged.awardedBy, 'auto');
  assert.equal(merged.ackedAt, null);
  assert.equal(merged.progress, 12);
  assert.equal(merged.canClaim, false);
  const plain = { ...own, isEarned: undefined };
  assert.equal(lib.withMemberFields(plain, undefined), plain);
});

/* ------------------------------------------------------------- source pins */

test('the page gates Claim on the capabilities answer and the auto-award flag', () => {
  const page = read('src/pages/Achievements.tsx');
  assert.match(page, /featureEnabled\(capabilities\.data\?\.features, 'achievementAutoAward'\)/);
  assert.match(page, /const claimAllowed = capabilities\.isSuccess && !autoAward;/);
  assert.match(page, /claimAllowed && claimableCount > 0 && tab === 'mine'/);
  assert.match(page, /claimAllowed=\{claimAllowed\}/);
  // The Claim-all loop only ever sees rows the Claim rule admits.
  assert.match(page, /summary\.filter\(\(a\) => showClaim\(a, claimAllowed\)\)/);
  // New awards are acknowledged through the ack route; a 404 is not an error.
  assert.match(page, /api\.post\(`\/achievements\/\$\{id\}\/ack`\)/);
  assert.match(page, /isNotFound\(r\.reason\)/);
  assert.match(page, /Awards arrive on their own the moment your record crosses the line\./);
  assert.match(page, /'Criteria met\. Your award arrives on its own\.'/);
  assert.match(page, /'Criteria met\. Claim it to bank the reward\.'/);
  // Coins are granted by Claim alone, and the completion rate is not honest copy.
  assert.match(page, /const showCoins = !autoAward && coins > 0;/);
  assert.doesNotMatch(page, /% of Vybe/);
  assert.doesNotMatch(page, /completionRate/);
  assert.match(page, /'Log workouts and posts and awards arrive as you go\.'/);
  assert.doesNotMatch(page, /streak/i);
  // What the tiles do not know they show as a dash, never as a zero: a failed
  // summary list, and a capabilities query that got no answer (loading is a skeleton).
  assert.match(page, /const summaryUnknown = summaryQuery\.isError;/);
  assert.match(page, /const flagUnknown = !capabilities\.isSuccess && !capabilities\.isLoading;/);
  assert.match(page, /const awardsLabel = flagUnknown \? 'Awards' : autoAward \? 'New awards' : 'Ready to claim';/);
  assert.equal((page.match(/value="—"/g) ?? []).length, 5, 'four summary tiles and the awards slot fall back to a dash');
  assert.match(page, /hint="Could not check server settings"/);
  assert.match(page, /summaryUnknown && tab === 'mine' && !active\.isError/);
  assert.match(page, /summaryUnknown && tab !== 'mine'/);
  assert.equal((page.match(/Your progress could not be loaded/g) ?? []).length, 2, 'the summary failure is said once per tab');
  // A failed ack is said out loud (a 404 stays silent), and Got it announces its success.
  assert.match(page, /if \(failed\) throw failed\.reason;/);
  assert.match(page, /toast\.error\(withReason\('Could not mark those awards as seen\.', e\)\)/);
  assert.match(page, /const reason = errMsg\(error, 'Try again\.'\);/);
  assert.match(page, /if \(announce\) toast\.success\('Marked as seen'\);/);
  assert.match(page, /ack\.mutate\(\{ ids: \[a\._id\], announce: false \}\)/);
  // Controls that remove themselves hand focus on first: Got it to the selected
  // view tab, Claim to the card's details target or the dialog's Close.
  assert.match(page, /focusViews\(\);\s*ack\.mutate\(\{ ids: newRows\.map/);
  assert.match(page, /<div id=\{VIEWS_ID\}>\s*<Tabs/);
  assert.match(page, /detail && detail\._id === achievement\._id \? DETAIL_CLOSE_ID : detailsButtonId\(achievement\._id\)/);
  assert.match(page, /<Button id=\{DETAIL_CLOSE_ID\} variant="secondary" onClick=\{onClose\}>/);
  // The card carries the rule and the labels that must not change.
  const card = read('src/pages/AchievementCard.tsx');
  assert.match(card, /showClaim\(achievement, claimAllowed\)/);
  assert.match(card, /aria-label="Earned"/);
  assert.match(card, /aria-label=\{`\$\{achievement\.title\}: details`\}/);
  assert.match(card, /label=\{`\$\{achievement\.title\} progress`\}/);
  assert.match(card, /id=\{detailsButtonId\(achievement\._id\)\}/);
  assert.match(card, /streak: 'Consistency'/);
  // "streak" survives only as the category key; no new copy uses the word.
  assert.doesNotMatch(card.replace(/streak: /g, '').replace(/'streak'/g, ''), /streak/i);
  assert.doesNotMatch(card, /from 'zustand'|@tanstack\/react-query|\.\.\/lib\/auth/);
  assert.doesNotMatch(read('src/lib/achievements.ts'), /^import /m);
});

test('the Profile shortcut and the page read one list under one key', () => {
  const profile = read('src/pages/Profile.tsx');
  const page = read('src/pages/Achievements.tsx');
  const hook = read('src/lib/useMyAchievements.ts');
  assert.match(profile, /import \{ useMyAchievements \} from '\.\.\/lib\/useMyAchievements';/);
  assert.match(page, /import \{ useMyAchievements \} from '\.\.\/lib\/useMyAchievements';/);
  assert.match(profile, /useMyAchievements\(summarize\)/);
  assert.match(profile, /useFeature\('achievementAutoAward'\)/);
  assert.doesNotMatch(profile, /'\/achievements\/user'/);
  assert.doesNotMatch(page, /queryKey: \['achievements', 'user', 'summary'\]/);
  assert.match(hook, /queryKey: \['achievements', 'user', 'summary'\]/);
  assert.match(hook, /'\/achievements\/user'/);
  assert.match(hook, /staleTime: 5 \* 60_000/);
  // The flag is read through featureEnabled's unknown-name default, never added to the pinned defaults.
  const capabilities = read('src/lib/capabilities.ts');
  const defaults = capabilities.slice(capabilities.indexOf('FEATURE_DEFAULTS'), capabilities.indexOf('});', capabilities.indexOf('FEATURE_DEFAULTS')));
  assert.doesNotMatch(defaults, /achievementAutoAward/);
});
