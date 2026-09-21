import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('the feed pages by cursor, never renders a post twice, and shows the stories tray', () => {
  const feed = read('src/pages/Feed.tsx');
  // P8a: the paging token's parameter name depends on the mode — `?before=`
  // for Following (keyset), `?cursor=` for For you (a ranked window token) —
  // so one wrapper decides, over feedLogic's keyset helper.
  assert.match(feed, /feedModeParams\(mode, pageParam, FEED_PAGE_SIZE\)/, 'later pages must use the mode’s own paging token');
  assert.match(feed, /queryKey: \['feed', mode\]/, "['feed'] stays the key prefix so every existing invalidation reaches both modes");
  assert.match(read('src/lib/feedControls.ts'), /return mode === 'latest' \? base : \{ \.\.\.base, mode \};/, 'Following sends no mode param at all');
  assert.match(feed, /getNextPageParam: \(last, all\) => nextFeedPageParam\(last, all\.length\)/);
  assert.match(feed, /dedupeById\(data\?\.pages\.flatMap/, 'a shifted page must not duplicate a card or its React key');
  assert.match(feed, /<StoryTray variant="home" label=\{gymName \? `At \$\{gymName\}` : undefined\} \/>/, 'Home shows the stories tray, labelled by the viewer’s gym, above the composer');
  // Video posting through the presigned flow, with a browser-captured poster.
  assert.match(feed, /ACCEPTED_VIDEO_TYPES\.includes\(contentType\)/);
  assert.match(feed, /captureVideoPoster\(file\)/);
  assert.match(feed, /uploadPresigned\(poster, 'image\/jpeg', 'media'\)/);
  assert.match(feed, /label="Add a video"/);
});

test('post cards follow their post, open a lightbox, clamp long text and link URLs', () => {
  const card = read('src/pages/PostCard.tsx');
  // Counters resync from props when the post query refetches.
  assert.match(card, /useEffect\(\(\) => \{\s*setLikes\(likeTotal\(post\)\);\s*setLiked\(likedByMe\(post\)\);\s*setBookmarked\(!!post\.isBookmarked\);\s*setCommentCount\(commentTotal\(post\)\);/);
  assert.match(card, /onDeleted\?\.\(\);/);
  // Photos 5+ are reachable: "+N" is a button and the detail page shows every tile.
  assert.match(card, /export function MediaLightbox/);
  assert.match(card, /aria-label=\{`Show all \$\{count\} attachments`\}/);
  assert.match(card, /const shown = expanded \? medias : medias\.slice\(0, GRID_PREVIEW\);/);
  assert.match(card, /aria-label=\{`Open photo \$\{i \+ 1\} of \$\{count\}`\}/);
  assert.match(card, /useFocusTrap\(open, panelRef\)/);
  // Long posts clamp on the feed; URLs become safe links.
  assert.match(card, /clamped && 'line-clamp-6'/);
  assert.match(card, /\{expanded \? 'See less' : 'See more'\}/);
  assert.match(card, /rel="noopener noreferrer nofollow"/);
  assert.match(card, /tokenizeContent\(body\)/);
  // Save has a destination; the identity link reads as a name and a handle.
  assert.match(card, /label: 'View saved', onClick: \(\) => navigate\('\/profile\?tab=saved'\)/);
  assert.match(card, /`\$\{name\}, @\$\{author\.username\}`/);
  assert.match(card, /enterKeyHint="send"/);
  // Video shows a frame before play on Safari.
  assert.match(card, /#t=0\.1/);
  assert.match(card, /preload="metadata"/);
});

test('the detail page handles bad ids, the comments anchor, deletion and count sync', () => {
  const detail = read('src/pages/PostDetail.tsx');
  assert.match(detail, /return status === 400 \|\| status === 404;/, '400 (malformed id) must be terminal like 404');
  assert.match(detail, /retry: \(count, err\) => !isGone\(err\) && count < 2/);
  assert.match(detail, /const COMMENTS_ANCHOR = 'comments';/);
  assert.match(detail, /<Card id=\{COMMENTS_ANCHOR\}/);
  assert.match(detail, /location\.hash !== `#\$\{COMMENTS_ANCHOR\}`/);
  assert.match(detail, /navigate\('\/', \{ replace: true \}\);/, 'deleting from the detail page leaves it');
  assert.match(detail, /const post = !postQuery\.isError \? postQuery\.data : undefined;/, 'no stale card under the gone state');
  assert.match(detail, /qc\.setQueryData<Post>\(\['post', postId\]/, 'the cached post keeps its comment list in step');
  // P8a: the list read moved behind lib/comments (one place for the literal
  // path, `held=1`, the replies route and the idempotent like), and it is the
  // threaded contract now — each row carries `replies` and `replyCount`.
  assert.match(detail, /fetchComments\(postId, \{ page: pageParam as number, limit: 20, sort \}\)/);
  assert.match(
    read('src/lib/comments.ts'),
    /api\.get<CommentsPage>\(`\/posts\/post\/\$\{postId\}\/comments\/all\/fetch\/filter`, \{\s*params: \{ page, limit, sort \},/,
  );
  assert.match(detail, /expandMedia/);
  assert.match(detail, /enterKeyHint="send"/);
  assert.match(detail, /<h2 className="type-heading text-lg text-text-1">Comments<\/h2>/, 'the live suite finds the Comments heading');
  assert.match(detail, /This post isn’t available/);
});

test('shared post links open signed out with a public preview and a sign-in CTA', () => {
  const app = read('src/App.tsx');
  const publicRoute = app.indexOf('<Route path="/p/:postId" element={<PostGate />} />');
  const guardedTree = app.indexOf('element={<RequireAuth>');
  assert.ok(publicRoute > 0, '/p/:postId must be routed through PostGate');
  assert.ok(publicRoute < guardedTree, '/p/:postId must be declared outside RequireAuth');
  assert.doesNotMatch(app, /path="p\/:postId"/, 'the old guarded post route must be gone');
  assert.match(app, /import\('\.\/pages\/PublicPost'\)/);
  assert.match(app, /if \(user\) \{\s*return \(\s*<Layout>\s*<PostDetail \/>\s*<\/Layout>/s);

  const page = read('src/pages/PublicPost.tsx');
  assert.match(page, /api\.get\(`\/public\/posts\/\$\{postId\}`\)/);
  assert.match(page, /state=\{from\}/, 'login must bounce back to the post');
  assert.match(page, /<PostMediaGrid post=\{post\} className="mt-3" expanded onOpen=\{setLightbox\} \/>/);
  assert.match(page, /Join Vybe/);

  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of ['GET /api/public/posts/:postId', 'GET /api/public/posts/:postId/preview', 'GET /api/posts/bookmarks', 'GET /api/story/:storyId/responses']) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

test('saved posts have a home on the own profile only', () => {
  const tabs = read('src/pages/ProfileTabs.tsx');
  assert.match(tabs, /\{ key: 'saved', label: 'Saved', icon: <Bookmark size=\{18\} \/>, ownOnly: true \}/);
  assert.match(tabs, /export const PUBLIC_PROFILE_TABS = PROFILE_TABS\.filter\(\(t\) => !t\.ownOnly\);/);
  assert.match(tabs, /queryKey: \['bookmarks'\]/, 'PostCard invalidates ["bookmarks"]; the list must read that key');
  assert.match(tabs, /api\.get\('\/posts\/bookmarks'\)/);
  assert.match(tabs, /Nothing saved yet/);

  const profile = read('src/pages/Profile.tsx');
  assert.match(profile, /\{tab === 'saved' && <ProfileSaved \/>\}/);
  assert.match(profile, /<HighlightsRow userId=\{me\._id\} isOwn author=\{me\} \/>/);

  const other = read('src/pages/UserProfile.tsx');
  assert.match(other, /PUBLIC_PROFILE_TABS\.map/);
  assert.match(other, /tabParam !== 'saved'/);
  assert.match(other, /<HighlightsRow userId=\{user\._id\} author=\{user\} \/>/);
});

test('stories play in posting order from the first unseen one, with a trapped, video-aware viewer', () => {
  const tray = read('src/pages/StoryTray.tsx');
  assert.match(tray, /useState\(\(\) => startStory \?\? firstUnseenIndex\(groups\[startGroup\]\?\.stories \|\| \[\], me\?\._id\)\)/);
  assert.match(tray, /useFocusTrap\(true, panelRef\);/, 'the viewer must trap focus');
  assert.match(tray, /useLockBody\(true\);/);
  assert.match(tray, /onEnded=\{next\}/, 'video stories advance when the clip ends');
  assert.match(tray, /story\.type === 'video'\) return;/, 'the timer must not run over a video');
  assert.match(tray, /muted=\{muted\}/, 'autoplay needs muted video');
  // Author-only responses sheet behind the eye count.
  assert.match(tray, /aria-label="View story responses"/);
  assert.match(tray, /api\.get\(`\/story\/\$\{storyId\}\/responses`\)/);
  assert.match(tray, /\{ value: 'viewers', label: 'Viewers'/);
  // Tray polish: one own bubble, own stories never "new", full names everywhere.
  assert.match(tray, /splitOwnGroup\(groups, me\?\._id\)/);
  assert.match(tray, /aria-label="Add to your story"/);
  assert.match(tray, /caption=\{authorName\(g\.author\)\}/);
  assert.match(tray, /label=\{`\$\{unseen \? 'New stories' : 'Stories'\} from \$\{authorName\(g\.author\)\}`\}/, 'the live suite keys on "New stories from"');
  assert.match(tray, /aria-label="React to this story"/);
  // Text-story looks and clip-length durations.
  assert.match(tray, /STORY_BACKGROUNDS\.map/);
  assert.match(tray, /content\.font = font;/);
  assert.match(tray, /readVideoDuration\(file\)/);
  // Highlights are playable and live on profiles.
  assert.match(tray, /export function HighlightsRow/);
  assert.match(tray, /aria-label=\{`Open highlight \$\{h\.title\}/);
  assert.match(tray, /\/story\/highlights\/\$\{h\._id\}\/detail/);

  const page = read('src/pages/Stories.tsx');
  assert.match(page, /isStoryExpired\(s\)/, 'the Archive holds expired stories, as its copy says');
  assert.match(page, /aria-label=\{`Open story from/);
  assert.match(page, /\{ value: 'archive', label: 'Archive' \}/);
  assert.match(page, /\{ value: 'highlights', label: 'Highlights' \}/);
  assert.match(page, /params\.get\('new'\) === '1'/);
  assert.match(page, /onClick=\{\(\) => void openHighlight\(h\)\}/, 'highlight covers must open the viewer');
});

test('small fixes: duplicate reports, phone input size, preload hints, shared focus-trap hooks', () => {
  const report = read('src/pages/Report.tsx');
  assert.match(report, /status === 409/);
  assert.match(report, /already reported this/);

  const css = read('src/styles.css');
  assert.match(css, /@media \(max-width: 767px\) \{\s*\.input-base \{ font-size: 16px; \}\s*\}/);

  const vite = read('vite.config.ts');
  // Hints on, polyfill off (Instagram rebuild, Q0): without hints a hub's chunk graph loaded one depth per round trip.
  assert.match(vite, /modulePreload: \{ polyfill: false \}/);

  const ui = read('src/components/ui.tsx');
  assert.match(ui, /export function useFocusTrap\(/);
  assert.match(ui, /export function useLockBody\(/);

  const hooks = read('src/lib/hooks.ts');
  assert.match(hooks, /export async function uploadPresigned\(/);
  assert.match(hooks, /export const ACCEPTED_VIDEO_TYPES = \['video\/mp4', 'video\/quicktime'\];/);
});

test('the labels the live suites key on are still present', () => {
  const sources = ['src/pages/Feed.tsx', 'src/pages/PostCard.tsx', 'src/pages/PostDetail.tsx', 'src/pages/StoryTray.tsx', 'src/pages/Stories.tsx']
    .map(read)
    .join('\n');
  for (const label of [
    'Share a session, a win or a meal…',
    'What do you want to share?',
    'Send comment',
    'More options for ${name}’s post',
    'Report post',
    'New story',
    'React to this story',
    'Open story from',
    'New stories',
    'Remove from saved',
  ]) {
    assert.ok(sources.includes(label), `label "${label}" must survive`);
  }
});

test('the responses sheet never reads a disabled query, and render errors get a fallback instead of a blank page', () => {
  const tray = read('src/pages/StoryTray.tsx');
  // A disabled TanStack query is pending with no data and is not "loading";
  // reading it unconditionally unmounted the whole app when a viewer opened.
  assert.doesNotMatch(tray, /q\.data!/);
  assert.match(tray, /const data = q\.data \?\? EMPTY_RESPONSES;/);
  assert.match(tray, /placeholderData: keepPreviousData,/);
  assert.match(tray, /\{q\.isPending \? \(/);
  // The "Add to your story" badge sits on the avatar corner and no longer
  // intercepts a tap on the centre of the bubble itself.
  assert.match(tray, /aria-label="Add to your story"\n\s+className="absolute right-0\.5 top-\[47px\] grid h-6 w-6/);
  assert.doesNotMatch(tray, /before:-inset-2/);

  const card = read('src/pages/PostCard.tsx');
  assert.match(card, /onClick=\{\(\) => onOpen\(GRID_PREVIEW\)\}/, 'the +N tile opens the lightbox on the first hidden photo');

  const boundary = read('src/components/ErrorBoundary.tsx');
  assert.match(boundary, /static getDerivedStateFromError\(error: Error\): State/);
  assert.match(boundary, /export function RouteErrorBoundary/);
  // Gym First (P2): AppRoutes holds the <Routes> (and the sheet overlay) inside the same boundary.
  assert.match(read('src/App.tsx'), /<RouteErrorBoundary>\n\s+<AppRoutes \/>/, 'every routed screen renders inside a boundary');
  assert.match(read('src/App.tsx'), /function AppRoutes\(\)[\s\S]*?<Routes location=/);
  assert.match(read('src/components/Layout.tsx'), /<RouteErrorBoundary>\{waiting \? <PageSkeleton \/> : \(children \?\? <Outlet \/>\)\}<\/RouteErrorBoundary>/, 'the shell survives a broken page');
});

test('card counts prefer the server totals over the capped preview arrays', async () => {
  const { commentTotal, likeTotal } = await import('../src/lib/feedLogic.ts');
  assert.equal(commentTotal({ comments: new Array(2).fill({}), totalComments: 57 }), 57);
  assert.equal(commentTotal({ comments: new Array(20).fill({}), commentCount: 31 }), 31);
  assert.equal(commentTotal({ comments: new Array(3).fill({}) }), 3);
  assert.equal(commentTotal({}), 0);
  assert.equal(likeTotal({ likes: ['a', 'b'], likeCount: 9 }), 9);
  assert.equal(likeTotal({ likes: ['a', 'b'] }), 2);
  assert.match(read('src/pages/PostCard.tsx'), /import \{ commentTotal, likeTotal, tokenizeContent \} from '\.\.\/lib\/feedLogic';/);
  assert.doesNotMatch(read('src/pages/PostCard.tsx'), /post\.comments\?\.length \?\? post\.commentCount/);
});

test('Home is Instagram-shaped: the compact gym header, a rail that is never empty, hairline posts (Q2)', () => {
  const feed = read('src/pages/Feed.tsx');
  // The gym is one row at the top of <main>, from the shell's one read; no band, no gym tabs, no hashtag strip on the phone feed.
  // `member` comes straight off the shell's one home-gym read; Feed keeps no membership logic of its own.
  assert.match(feed, /<GymHeader variant="compact" gym=\{home\.gym\} member=\{home\.member\} loading=\{home\.loading\}/);
  assert.doesNotMatch(feed, /membershipOf/, 'membership is the shell hook’s answer, not recomputed here');
  assert.match(feed, /const home = useHomeGym\(\);/);
  assert.doesNotMatch(feed, /band=\{\{|GymTabs|TrendingHashtags|gym-band-tab|useViewerGym/);
  // Pull to refresh never animates height: a 0 px wrapper and a disc on translateY.
  assert.match(feed, /className="pointer-events-none relative z-30 h-0"/);
  assert.match(feed, /transform: `translate\(-50%, \$\{active \? pull - 44 : -56\}px\)`/);
  assert.doesNotMatch(feed, /transition-\[height\]|style=\{\{ height: pull \}\}/);
  // Items below the first screen skip layout until they near the viewport.
  assert.match(feed, /className=\{i >= 3 \? 'cv-auto' : undefined\}/);
  assert.match(feed, /<PostCardSkeleton key=\{i\} media=\{i !== 1\} \/>/);

  const card = read('src/pages/PostCard.tsx');
  // Hairline rows by default; the detail page alone asks for the card.
  assert.match(card, /surface = 'item',/);
  assert.match(card, /className=\{cx\('feed-rule relative pb-3', className\)\}/);
  // header → media → icon row → caption; text only: header → text → icon row.
  assert.match(card, /const textOnly = !hasMedia && !hasSummary;/);
  assert.match(card, /\{textOnly \? \(\s*<>\s*\{caption\}\s*\{actions\}\s*<\/>\s*\) : \(\s*<>\s*\{media\}\s*\{summaries\}\s*\{actions\}\s*\{caption\}\s*<\/>\s*\)\}/);
  assert.match(card, /lead=\{textOnly \? undefined : usernameLead\}/, 'a text post never repeats the name its header just gave');
  assert.match(card, /<Avatar src=\{author\?\.avatar\} name=\{name\} size=\{36\} seed=\{authorId\} \/>/);
  assert.match(card, /<span className="t-name truncate text-text-1">\{username\}<\/span>/);
  // A single photo always reserves its box; media bleeds to the viewport below md.
  assert.match(card, /count === 1 && !ratio && 'aspect-square'/);
  assert.match(card, /bleed \? '-mx-gutter rounded-none md:mx-0' : 'rounded-md'/);
  // The skeleton is the item geometry and takes `surface` for the detail page.
  assert.match(card, /export function PostCardSkeleton\(\{ media = true, surface = 'item', className \}/);
  assert.match(card, /<Skeleton className="-mx-gutter aspect-square rounded-none md:mx-0" \/>/);
  // Captions re-measure when their box changes (content-visibility: auto items have no layout until they near the viewport).
  assert.match(card, /const observer = new ResizeObserver\(measure\);/);
  // The viewer's gym comes from the shell's one query; no card fetches it again.
  assert.match(card, /export function useViewerGym\(\): ViewerGym \| null \{\s*return viewerGymOf\(useHomeGym\(\)\);/);
  assert.doesNotMatch(card, /queryKey: \['community', communityId\]/);

  const tray = read('src/pages/StoryTray.tsx');
  // On Home the rail never returns null: skeleton bubbles while loading, the own "+" bubble when there is nothing else.
  assert.doesNotMatch(tray, /if \(variant === 'home'\) \{\s*if \(tray\.isLoading/);
  assert.match(tray, /tray\.isLoading\s*\? Array\.from\(\{ length: home \? 5 : 6 \}\)\.map\(\(_, i\) => <BubbleSkeleton key=\{i\} \/>\)/);
  assert.match(tray, /<Skeleton className="h-17 w-17 rounded-full" \/>/, 'the skeleton bubble is the 68 px disc');
  assert.doesNotMatch(tray, /type-heading text-lg/, 'no heading over the rail');
});
