/**
 * P8a comments: replies threaded one level, idempotent likes, and the post
 * author's held queue. Every literal path resolves to a mounted route, the
 * pure thread helpers hold, and a threaded comment renders indented under
 * its parent with the right expander.
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
const snapshot = JSON.parse(read('contracts/backend-routes.json'));
const lib = await import('../src/lib/comments.ts');

/** Visible text only: class names and pixel attributes are full of digits. */
const textOf = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#x2019;/g, '’')
    .replace(/&#xB7;|&middot;/g, '·')
    .replace(/\s+/g, ' ');

const segmentsOf = (webPath) => `/api${webPath}`.replace(/\$\{[^}]*\}/g, ':x').split('/').filter(Boolean);
const isMounted = (method, webPath) => {
  const want = segmentsOf(webPath);
  return snapshot.routes.some((route) => {
    if (route.method !== method) return false;
    const have = route.path.split('/').filter(Boolean);
    return have.length === want.length && have.every((segment, i) => segment.startsWith(':') || segment === want[i]);
  });
};

/* ------------------------------------------------------------------ paths */

test('every comment path the client sends is a mounted route', () => {
  const src = read('src/lib/comments.ts');
  const literals = [...src.matchAll(/api\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*['`]([^'`]+)['`]/g)].map((m) => [
    m[1].toUpperCase(),
    m[2],
  ]);
  const expected = [
    ['GET', '/posts/post/${postId}/comments/all/fetch/filter'],
    ['GET', '/posts/comments/${commentId}/replies'],
    ['POST', '/posts/comment'],
    ['PUT', '/posts/comments/${commentId}/like'],
    ['DELETE', '/posts/comments/${commentId}/like'],
    ['POST', '/posts/comments/${commentId}/approve'],
    ['POST', '/posts/comments/${commentId}/hide'],
    ['DELETE', '/posts/comments/${commentId}/hide'],
  ];
  for (const [method, webPath] of expected) {
    assert.ok(literals.some(([m, p]) => m === method && p === webPath), `lib/comments.ts must call ${method} ${webPath}`);
    assert.ok(isMounted(method, webPath), `${method} /api${webPath} is not in contracts/backend-routes.json`);
  }
  for (const [method, webPath] of literals) {
    assert.ok(isMounted(method, webPath), `${method} /api${webPath} is not a mounted route`);
  }
  // The legacy toggle is gone: `PUT`/`DELETE .../like` state the end state,
  // so a double tap cannot land on "unliked".
  assert.doesNotMatch(src, /api\.[a-z]+[^\n]*\/posts\/comment\/like/);
  assert.doesNotMatch(read('src/pages/PostDetail.tsx'), /\/posts\/comment\/like/);
  assert.match(src, /api\.put<CommentLikeResult>\(`\/posts\/comments\/\$\{commentId\}\/like`\)/);
  assert.match(src, /api\.delete<CommentLikeResult>\(`\/posts\/comments\/\$\{commentId\}\/like`\)/);
  // Held rows come off the same list read, with `held: 1`.
  assert.match(src, /params: \{ page: 1, limit: 20, held: 1 \}/);
  // A 403 means "not your queue", never an error card.
  assert.match(src, /if \(status === 403 \|\| status === 404\) return \[\];/);
  // Reply is the same create call with `parentId`.
  assert.match(src, /\.\.\.\(parentId \? \{ parentId \} : \{\}\),/);
  // Neither approve nor hide is flag-gated: `hiddenDetails` is about a post's
  // own details, not its author's comment moderation.
  assert.doesNotMatch(src, /useFeature|isFeatureDisabled|capabilities/, 'comment moderation is not behind a flag');
});

/* ------------------------------------------------------------------ thread helpers */

const comment = (over) => ({ _id: 'c1', text: 'Nice work', createdAt: '2026-09-24T10:00:00.000Z', replyCount: 0, ...over });
const reply = (id, over) => ({ _id: id, text: `reply ${id}`, createdAt: '2026-09-24T11:00:00.000Z', parentId: 'c1', ...over });

test('"View N more replies" counts what is missing, not what is there', () => {
  assert.equal(lib.moreRepliesLabel(comment({ replies: [], replyCount: 0 })), null);
  assert.equal(lib.moreRepliesLabel(comment({ replies: [reply('r1'), reply('r2')], replyCount: 2 })), null, 'the preview is the whole thread');
  assert.equal(lib.moreRepliesLabel(comment({ replies: [reply('r1'), reply('r2')], replyCount: 3 })), 'View 1 more reply');
  assert.equal(lib.moreRepliesLabel(comment({ replies: [reply('r1'), reply('r2')], replyCount: 7 })), 'View 5 more replies');
  // A row with no `replyCount` says nothing rather than guessing from the preview.
  assert.equal(lib.moreRepliesLabel(comment({ replies: [reply('r1')] })), null);
  assert.equal(lib.REPLY_PREVIEW_LIMIT, 2);
});

test('the expanded thread is the preview plus the pages, de-duplicated', () => {
  const parent = comment({ replies: [reply('r1'), reply('r2')], replyCount: 4 });
  const pages = [
    { comments: [reply('r1'), reply('r2'), reply('r3')], total: 4, page: 1, hasNextPage: true },
    { comments: [reply('r4')], total: 4, page: 2, hasNextPage: false },
  ];
  assert.deepEqual(lib.threadReplies(parent, pages).map((r) => r._id), ['r1', 'r2', 'r3', 'r4']);
  assert.deepEqual(lib.threadReplies(parent, undefined).map((r) => r._id), ['r1', 'r2']);
  assert.deepEqual(lib.threadReplies(comment({}), undefined), []);
});

test('a reply lands under its parent and moves the parent count with it', () => {
  const list = [comment({ replies: [reply('r1')], replyCount: 1 }), comment({ _id: 'c2' })];
  const next = lib.withReply(list, 'c1', reply('r2'));
  assert.deepEqual(next[0].replies.map((r) => r._id), ['r1', 'r2']);
  assert.equal(next[0].replyCount, 2);
  assert.equal(next[1].replyCount, 0, 'no other thread moves');
  // Idempotent: the same reply arriving twice does not double the count.
  assert.equal(lib.withReply(next, 'c1', reply('r2'))[0].replyCount, 2);
  // An unknown parent changes nothing.
  assert.deepEqual(lib.withReply(list, 'nope', reply('r9')), list);
});

test('a deleted row leaves, whether it is a comment or one of its replies', () => {
  const list = [comment({ replies: [reply('r1'), reply('r2')], replyCount: 2 }), comment({ _id: 'c2' })];
  assert.deepEqual(lib.withoutComment(list, 'c2').map((c) => c._id), ['c1']);
  const pruned = lib.withoutComment(list, 'r1');
  assert.deepEqual(pruned[0].replies.map((r) => r._id), ['r2']);
  assert.equal(pruned[0].replyCount, 1);
  assert.equal(lib.withoutComment(list, 'r1').length, 2, 'removing a reply keeps its parent');
});

test('the like state reads from either shape, and a reply is never replied to', () => {
  assert.equal(lib.likedByViewer(comment({ isLiked: true }), 'me'), true);
  assert.equal(lib.likedByViewer(comment({ isLiked: false, likes: ['me'] }), 'me'), false, 'the server flag wins');
  assert.equal(lib.likedByViewer(comment({ likes: ['me', 'u2'] }), 'me'), true);
  assert.equal(lib.likedByViewer(comment({ likes: ['u2'] }), 'me'), false);
  assert.equal(lib.likedByViewer(comment({ likes: ['me'] }), undefined), false);
  assert.equal(lib.likeCountOf(comment({ likeCount: 9, likes: ['a', 'b'] })), 9, 'the server total beats the capped array');
  assert.equal(lib.likeCountOf(comment({ likes: ['a', 'b'] })), 2);
  assert.equal(lib.likeCountOf(comment({})), 0);
  assert.equal(lib.isReply(reply('r1')), true);
  assert.equal(lib.isReply(comment({})), false);
  assert.equal(lib.COMMENT_MAX_LENGTH, 1000);
});

test('a held row says why, in words its author can act on', () => {
  assert.equal(lib.heldReasonLabel(comment({ status: 'held', heldBy: 'approval' })), 'Waiting on you');
  assert.equal(lib.heldReasonLabel(comment({ status: 'held', heldBy: 'hidden_words' })), 'Matched a hidden word');
  assert.equal(lib.heldReasonLabel(comment({ status: 'held', heldBy: 'restrict' })), 'From someone you restricted');
  assert.equal(lib.heldReasonLabel(comment({ status: 'held', heldBy: 'filter' })), 'Held by the filter');
  assert.equal(lib.heldReasonLabel(comment({ status: 'held' })), 'Waiting on you', 'an unnamed hold still reads');
});

/* ------------------------------------------------------------------ the page */

test('the detail page threads replies one level and offers Reply on a root only', () => {
  const detail = read('src/pages/PostDetail.tsx');
  // One composer, the parent carried in the variables so the cache patch
  // still knows the thread after `replyTo` is cleared.
  assert.match(detail, /const \[replyTo, setReplyTo\] = useState<\{ commentId: string; name: string \} \| null>\(null\);/);
  assert.match(detail, /mutationFn: \(\{ text: value, parentId \}: \{ text: string; parentId: string \| null \}\) =>/);
  assert.match(detail, /addComment\.mutate\(\{ text: value, parentId: replyTo\?\.commentId \?\? null \}\)/);
  assert.match(detail, /withReply\(comments, parent, created\)/);
  // A reply has no Reply of its own (400 REPLY_DEPTH), and a held row has none either.
  assert.match(detail, /\{depth === 0 && onReply && !held \? \(/);
  assert.match(detail, /depth=\{1\}/);
  assert.match(detail, /aria-label=\{`Replies to \$\{name\}`\}/);
  assert.match(detail, /border-l border-line pl-3/, 'replies are indented behind a hairline');
  // Who the reply is going to, and a way out.
  assert.match(detail, /Replying to <span className="font-semibold text-text-1">\{replyTo\.name\}<\/span>/);
  // The author's queue and the hide action.
  assert.match(detail, /<HeldComments postId=\{postId\} isPostAuthor=\{isPostAuthor\} \/>/);
  assert.match(detail, /label: hidden \? 'Unhide comment' : 'Hide comment',/);
  assert.match(detail, /if \(!isPostAuthor \|\| held\.isPending \|\| !rows\.length\) return null;/, 'nothing waiting is nothing to say');
  // The report and delete menu the page already had is still there.
  assert.match(detail, /label: 'Report comment'/);
  assert.match(detail, /label: 'Delete comment'/);
  // Optimistic like with the one flourish the design allows.
  assert.match(detail, /if \(next\) heart\.pulse\(\);/);
  assert.match(detail, /setLikeCount\(\(n\) => Math\.max\(0, n \+ \(next \? 1 : -1\)\)\);/);
});

test('a threaded comment renders indented under its parent, with the expander', async () => {
  const { createElement: h } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { ToastProvider } = await import('../src/components/ui.tsx');
  const { CommentRow } = await import('../src/pages/PostDetail.tsx');

  const mount = (ui) =>
    renderToString(
      h(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        h(MemoryRouter, null, h(ToastProvider, null, h('ul', null, ui))),
      ),
    );
  const author = (id, name) => ({ _id: id, username: name.toLowerCase().replace(/\W+/g, ''), fullName: name });
  const root = {
    _id: 'c1',
    text: 'Strong week.',
    createdAt: '2026-09-24T10:00:00.000Z',
    user: author('u1', 'Maya Kim'),
    likeCount: 3,
    isLiked: false,
    replyCount: 5,
    replies: [
      { _id: 'r1', text: 'Thanks!', createdAt: '2026-09-24T11:00:00.000Z', parentId: 'c1', user: author('u2', 'Alex Stone'), likeCount: 0 },
      { _id: 'r2', text: 'Same', createdAt: '2026-09-24T11:05:00.000Z', parentId: 'c1', user: author('u3', 'Rio Vance'), likeCount: 1 },
    ],
  };

  const html = mount(
    h(CommentRow, { comment: root, postId: 'p1', postAuthorId: 'u9', isPostAuthor: false, onReply: () => {}, onReport: () => {}, onReportComment: () => {}, onRemoved: () => {} }),
  );
  const text = textOf(html);
  // The parent, then its two replies, indented behind a hairline.
  assert.match(text, /Maya Kim/);
  assert.match(text, /Strong week\./);
  assert.match(html, /aria-label="Replies to Maya Kim"/);
  assert.match(html, /border-l border-line pl-3/);
  assert.ok(text.indexOf('Strong week.') < text.indexOf('Thanks!'), 'a reply sits under its parent');
  // Collapsed past the two the list already sent.
  assert.match(text, /View 3 more replies/);
  // Reply on the root, and on no reply.
  assert.equal((html.match(/aria-label="Reply to /g) || []).length, 1);
  assert.match(html, /aria-label="Reply to Maya Kim"/);
  // A like with a count, and an unliked heart that does not print a zero.
  assert.match(html, /aria-label="Like comment \(3\)"/);
  assert.match(html, /aria-label="Like comment \(0\)"/);
  assert.ok(!/>\s*0\s*</.test(html.split('Thanks!')[1] ?? ''), 'a zero like count is omitted, not printed');
  assert.ok(!text.includes('NaN') && !text.includes('undefined'));

  // A held row says why and offers no Reply.
  const held = mount(
    h(CommentRow, { comment: { ...root, replies: [], replyCount: 0, status: 'held', heldBy: 'hidden_words' }, postId: 'p1', isPostAuthor: true, onReply: () => {}, onReport: () => {}, onReportComment: () => {}, onRemoved: () => {} }),
  );
  assert.match(textOf(held), /Matched a hidden word/);
  assert.doesNotMatch(held, /aria-label="Reply to /);

  // A hidden row is marked for the author who hid it.
  const hidden = mount(
    h(CommentRow, { comment: { ...root, replies: [], replyCount: 0, hiddenByAuthor: true }, postId: 'p1', isPostAuthor: true, onReply: () => {}, onReport: () => {}, onReportComment: () => {}, onRemoved: () => {} }),
  );
  assert.match(textOf(hidden), /Hidden/);
});

test('the comment shape carries the thread fields the API sends', () => {
  const hooks = read('src/lib/hooks.ts');
  for (const field of ['parentId?: string | null;', 'likeCount?: number;', 'isLiked?: boolean;', 'replyCount?: number;', 'replies?: PostComment[];', "status?: 'visible' | 'held' | 'hidden';", 'hiddenByAuthor?: boolean;']) {
    assert.ok(hooks.includes(field), `PostComment must carry ${field}`);
  }
});
