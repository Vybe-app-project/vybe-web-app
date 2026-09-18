import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const lib = await import('../src/lib/livestream.ts');
const {
  CandidateQueue,
  INITIAL_PEER_STATE,
  MAX_CANDIDATE_LENGTH,
  MAX_SDP_LENGTH,
  SignalBudget,
  canAcceptViewer,
  checkLiveVideoSupport,
  describeMediaError,
  durationLabel,
  emitWithAck,
  hasRelayServer,
  iceCredentialsFresh,
  isForStream,
  joinLivestreamRoom,
  leaveLivestreamRoom,
  mapIceServers,
  normalizeAck,
  parseParticipantLeft,
  parseSession,
  parseSignal,
  parseStatus,
  parseViewerReady,
  peerConfiguration,
  presenceCount,
  receivableSignalKinds,
  reducePeerState,
  rolePairAllowed,
  roomCapacity,
  safeCandidate,
  safeDescription,
  sendCandidate,
  sendDescription,
  sessionExpiresAt,
  videoOrientation,
} = lib;

/* ------------------------------------------------------------------ payload validation */

test('safeDescription mirrors the server: offer/answer with a bounded SDP string', () => {
  assert.deepEqual(safeDescription({ type: 'offer', sdp: 'v=0' }), { type: 'offer', sdp: 'v=0' });
  assert.deepEqual(safeDescription({ type: 'answer', sdp: 'v=0', extra: 1 }), { type: 'answer', sdp: 'v=0' });
  assert.equal(safeDescription({ type: 'pranswer', sdp: 'v=0' }), null);
  assert.equal(safeDescription({ type: 'offer', sdp: '' }), null);
  assert.equal(safeDescription({ type: 'offer', sdp: 42 }), null);
  assert.equal(safeDescription({ type: 'offer', sdp: 'x'.repeat(MAX_SDP_LENGTH + 1) }), null);
  assert.equal(safeDescription(null), null);
  assert.equal(safeDescription('offer'), null);
  assert.equal(safeDescription([]), null);
});

test('safeCandidate mirrors the server: truncates sdpMid/usernameFragment, normalises the rest', () => {
  const clean = safeCandidate({
    candidate: 'candidate:1 1 udp 1 relay',
    sdpMid: 'a'.repeat(200),
    sdpMLineIndex: 0,
    usernameFragment: 'u'.repeat(300),
    foo: 'bar',
  });
  assert.equal(clean.candidate, 'candidate:1 1 udp 1 relay');
  assert.equal(clean.sdpMid.length, 128);
  assert.equal(clean.sdpMLineIndex, 0);
  assert.equal(clean.usernameFragment.length, 256);
  assert.equal('foo' in clean, false);

  assert.deepEqual(safeCandidate({ candidate: '' }), { candidate: '', sdpMid: null, sdpMLineIndex: null });
  assert.deepEqual(safeCandidate({ candidate: 'c', sdpMid: 5, sdpMLineIndex: '0' }), { candidate: 'c', sdpMid: null, sdpMLineIndex: null });
  assert.equal(safeCandidate({ candidate: 'c'.repeat(MAX_CANDIDATE_LENGTH + 1) }), null);
  assert.equal(safeCandidate({ sdpMid: '0' }), null);
  assert.equal(safeCandidate(undefined), null);
  assert.equal('usernameFragment' in safeCandidate({ candidate: 'c' }), false);
});

test('role pairing matches the server: offers host→viewer, answers viewer→host, candidates cross roles', () => {
  assert.equal(rolePairAllowed('host', 'viewer', 'offer'), true);
  assert.equal(rolePairAllowed('viewer', 'host', 'offer'), false);
  assert.equal(rolePairAllowed('viewer', 'host', 'answer'), true);
  assert.equal(rolePairAllowed('host', 'viewer', 'answer'), false);
  assert.equal(rolePairAllowed('host', 'viewer', 'candidate'), true);
  assert.equal(rolePairAllowed('viewer', 'host', 'candidate'), true);
  assert.equal(rolePairAllowed('viewer', 'viewer', 'candidate'), false);
  assert.equal(rolePairAllowed('host', 'viewer', 'bogus'), false);
  assert.deepEqual(receivableSignalKinds('host'), ['answer', 'candidate']);
  assert.deepEqual(receivableSignalKinds('viewer'), ['offer', 'candidate']);
});

test('parseSignal accepts only well-formed signals for this stream and this role', () => {
  const offer = { streamId: 's1', fromSocketId: 'h', kind: 'offer', description: { type: 'offer', sdp: 'v=0' } };
  assert.deepEqual(parseSignal(offer, 's1', 'viewer'), offer);
  // A host never receives an offer.
  assert.equal(parseSignal(offer, 's1', 'host'), null);
  // Another stream's traffic is ignored.
  assert.equal(parseSignal(offer, 's2', 'viewer'), null);
  // kind and description type must agree.
  assert.equal(parseSignal({ ...offer, kind: 'answer' }, 's1', 'host'), null);
  const answer = { streamId: 's1', fromSocketId: 'v', kind: 'answer', description: { type: 'answer', sdp: 'v=0' } };
  assert.deepEqual(parseSignal(answer, 's1', 'host'), answer);
  const candidate = { streamId: 's1', fromSocketId: 'v', kind: 'candidate', candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 } };
  assert.deepEqual(parseSignal(candidate, 's1', 'host'), candidate);
  assert.deepEqual(parseSignal(candidate, 's1', 'viewer'), candidate);
  assert.equal(parseSignal({ ...candidate, candidate: { sdpMid: '0' } }, 's1', 'host'), null);
  assert.equal(parseSignal({ ...candidate, fromSocketId: '' }, 's1', 'host'), null);
  assert.equal(parseSignal({ ...candidate, kind: 'renegotiate' }, 's1', 'host'), null);
  assert.equal(parseSignal(null, 's1', 'host'), null);
  assert.equal(parseSignal(offer, '', 'viewer'), null);
});

test('presence, status, viewer-ready and participant-left payloads are scoped to the stream', () => {
  assert.equal(presenceCount({ streamId: 's1', viewerCount: 3 }, 's1'), 3);
  assert.equal(presenceCount({ streamId: 's1', viewerCount: '2.7' }, 's1'), 2);
  assert.equal(presenceCount({ streamId: 's1', viewerCount: -4 }, 's1'), 0);
  assert.equal(presenceCount({ streamId: 's1' }, 's1'), 0);
  assert.equal(presenceCount({ streamId: 's2', viewerCount: 3 }, 's1'), null);

  assert.deepEqual(parseStatus({ streamId: 's1', status: 'ended', reason: 'maximum-duration' }, 's1'), { status: 'ended', reason: 'maximum-duration' });
  assert.deepEqual(parseStatus({ streamId: 's1', status: 'cancelled' }, 's1'), { status: 'cancelled', reason: null });
  assert.deepEqual(parseStatus({ streamId: 's1', status: 'live', reason: 'anything' }, 's1'), { status: 'live', reason: null });
  assert.equal(parseStatus({ streamId: 's1', status: 'paused' }, 's1'), null);
  assert.equal(parseStatus({ streamId: 's2', status: 'ended' }, 's1'), null);

  assert.deepEqual(
    parseViewerReady({ streamId: 's1', viewerSocketId: 'v1', viewer: { _id: 'u1', fullName: 'Ada', avatar: 'a.png', username: 'ada' } }, 's1'),
    { viewerSocketId: 'v1', viewer: { _id: 'u1', username: 'ada', fullName: 'Ada', avatar: 'a.png' } },
  );
  // The host-join replay omits username and avatar; that is still a valid viewer.
  assert.deepEqual(
    parseViewerReady({ streamId: 's1', viewerSocketId: 'v1', viewer: { _id: 'u1', fullName: 'Ada' } }, 's1'),
    { viewerSocketId: 'v1', viewer: { _id: 'u1', username: undefined, fullName: 'Ada', avatar: undefined } },
  );
  assert.deepEqual(parseViewerReady({ streamId: 's1', viewerSocketId: 'v1' }, 's1'), { viewerSocketId: 'v1', viewer: null });
  assert.equal(parseViewerReady({ streamId: 's1' }, 's1'), null);
  assert.equal(parseViewerReady({ streamId: 's2', viewerSocketId: 'v1' }, 's1'), null);

  assert.deepEqual(parseParticipantLeft({ streamId: 's1', socketId: 'v1', role: 'viewer' }, 's1'), { socketId: 'v1', role: 'viewer' });
  assert.deepEqual(parseParticipantLeft({ streamId: 's1', socketId: 'v1', role: 'admin' }, 's1'), { socketId: 'v1', role: null });
  assert.equal(parseParticipantLeft({ streamId: 's1' }, 's1'), null);

  assert.equal(isForStream({ streamId: 's1', comment: {} }, 's1'), true);
  assert.equal(isForStream({ streamId: 's2' }, 's1'), false);
  assert.equal(isForStream('s1', 's1'), false);
});

/* ------------------------------------------------------------------ ICE and peer configuration */

test('mapIceServers keeps valid stun/turn listeners with their credentials and drops junk', () => {
  const servers = mapIceServers([
    { urls: ['stun:stun.example:3478'] },
    { urls: ['turn:relay.example:3478?transport=udp', 'turn:relay.example:3478?transport=tcp'], username: '1700000000:u1', credential: 'abc' },
    { urls: 'turns:relay.example:5349', username: 'x', credential: 'y' },
    { urls: ['http://not-ice.example'] },
    { urls: 'turn:bad host' },
    { urls: 'turn:relay.example:3478', username: 'only-username' },
    'garbage',
    null,
  ]);
  assert.deepEqual(servers, [
    { urls: ['stun:stun.example:3478'] },
    { urls: ['turn:relay.example:3478?transport=udp', 'turn:relay.example:3478?transport=tcp'], username: '1700000000:u1', credential: 'abc' },
    { urls: ['turns:relay.example:5349'], username: 'x', credential: 'y' },
    // Half a credential pair is treated as no credential at all.
    { urls: ['turn:relay.example:3478'] },
  ]);
  assert.deepEqual(mapIceServers(undefined), []);
  assert.deepEqual(mapIceServers({ urls: 'turn:x' }), []);
});

test('hasRelayServer requires an authenticated TURN listener, which the relay-only policy depends on', () => {
  assert.equal(hasRelayServer([{ urls: ['stun:stun.example:3478'] }]), false);
  assert.equal(hasRelayServer([{ urls: ['turn:relay.example:3478'] }]), false);
  assert.equal(hasRelayServer([{ urls: ['turn:relay.example:3478'], username: 'u', credential: 'c' }]), true);
  assert.equal(hasRelayServer([{ urls: 'turns:relay.example:5349', username: 'u', credential: 'c' }]), true);
  assert.equal(hasRelayServer([]), false);
});

test('peerConfiguration matches the mobile client: relay-only, max-bundle, rtcp-mux', () => {
  const ice = [{ urls: ['turn:relay.example:3478'], username: 'u', credential: 'c' }];
  assert.deepEqual(peerConfiguration(ice), {
    iceServers: ice,
    iceTransportPolicy: 'relay',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  });
});

test('parseSession validates the start/join envelope and normalises ICE servers', () => {
  const session = parseSession({
    token: 'jwt',
    role: 'host',
    expiresInSeconds: 7200,
    iceServers: [{ urls: 'turn:relay.example:3478', username: 'u', credential: 'c' }],
    iceCredentialsExpireAt: '2026-09-17T12:00:00.000Z',
  });
  assert.deepEqual(session, {
    token: 'jwt',
    role: 'host',
    expiresInSeconds: 7200,
    iceServers: [{ urls: ['turn:relay.example:3478'], username: 'u', credential: 'c' }],
    iceCredentialsExpireAt: '2026-09-17T12:00:00.000Z',
  });
  assert.equal(parseSession({ token: '', role: 'host' }), null);
  assert.equal(parseSession({ token: 'jwt', role: 'moderator' }), null);
  assert.equal(parseSession(undefined), null);
  assert.equal(parseSession({ token: 'jwt', role: 'viewer', expiresInSeconds: 'soon' }).expiresInSeconds, 0);
});

test('session expiry helpers use the receipt time and the TURN credential timestamp', () => {
  assert.equal(sessionExpiresAt({ expiresInSeconds: 60 }, 1_000), 61_000);
  assert.equal(sessionExpiresAt({ expiresInSeconds: -5 }, 1_000), 1_000);
  const at = Date.parse('2026-09-17T12:00:00.000Z');
  assert.equal(iceCredentialsFresh({ iceCredentialsExpireAt: '2026-09-17T12:00:00.000Z' }, at - 1), true);
  assert.equal(iceCredentialsFresh({ iceCredentialsExpireAt: '2026-09-17T12:00:00.000Z' }, at), false);
  assert.equal(iceCredentialsFresh({ iceCredentialsExpireAt: 'never' }, at), false);
});

/* ------------------------------------------------------------------ media errors and support */

test('describeMediaError maps browser error names to actionable copy', () => {
  assert.equal(describeMediaError({ name: 'NotAllowedError' }).code, 'permission');
  assert.equal(describeMediaError({ name: 'PermissionDeniedError' }).code, 'permission');
  assert.equal(describeMediaError({ name: 'NotFoundError' }).code, 'missing');
  assert.equal(describeMediaError({ name: 'DevicesNotFoundError' }).code, 'missing');
  assert.equal(describeMediaError({ name: 'NotReadableError' }).code, 'busy');
  assert.equal(describeMediaError({ name: 'OverconstrainedError' }).code, 'constraints');
  assert.equal(describeMediaError({ name: 'SecurityError' }).retryable, false);
  assert.equal(describeMediaError({ name: 'TypeError' }).code, 'unsupported');
  const unknown = describeMediaError(new Error('boom'));
  assert.equal(unknown.code, 'unknown');
  assert.equal(unknown.message, 'boom');
  assert.equal(describeMediaError('weird').code, 'unknown');
  for (const code of ['permission', 'missing', 'busy']) {
    const described = describeMediaError({ name: { permission: 'NotAllowedError', missing: 'NotFoundError', busy: 'NotReadableError' }[code] });
    assert.ok(described.title.length > 0 && described.message.length > 0);
    assert.equal(described.retryable, true);
  }
});

test('checkLiveVideoSupport fails closed on insecure contexts and missing APIs', () => {
  assert.deepEqual(checkLiveVideoSupport({ secureContext: true, hasUserMedia: true, hasPeerConnection: true }), { ok: true });
  assert.equal(checkLiveVideoSupport({ secureContext: false, hasUserMedia: true, hasPeerConnection: true }).ok, false);
  assert.equal(checkLiveVideoSupport({ secureContext: true, hasUserMedia: false, hasPeerConnection: true }).ok, false);
  assert.equal(checkLiveVideoSupport({ secureContext: true, hasUserMedia: true, hasPeerConnection: false }).ok, false);
});

/* ------------------------------------------------------------------ peer state machine */

test('peer state walks idle → connecting → live and ends terminally', () => {
  let state = INITIAL_PEER_STATE;
  state = reducePeerState(state, { type: 'negotiate' });
  assert.deepEqual(state, { phase: 'connecting', reconnecting: false, reason: null });
  state = reducePeerState(state, { type: 'connection', state: 'connecting' });
  assert.equal(state.phase, 'connecting');
  state = reducePeerState(state, { type: 'track' });
  assert.deepEqual(state, { phase: 'live', reconnecting: false, reason: null });
  const same = reducePeerState(state, { type: 'connection', state: 'connected' });
  assert.equal(same, state, 'no-op transitions return the same object');
  state = reducePeerState(state, { type: 'end', reason: 'maximum-duration' });
  assert.deepEqual(state, { phase: 'ended', reconnecting: false, reason: 'maximum-duration' });
  assert.equal(reducePeerState(state, { type: 'negotiate' }), state, 'ended is terminal');
  assert.equal(reducePeerState(state, { type: 'track' }), state);
  assert.equal(reducePeerState(state, { type: 'connection', state: 'connected' }), state);
  assert.equal(reducePeerState(state, { type: 'reset' }), INITIAL_PEER_STATE);
});

test('peer state marks reconnection when the link drops or the other side leaves, and recovers', () => {
  const live = { phase: 'live', reconnecting: false, reason: null };
  const dropped = reducePeerState(live, { type: 'connection', state: 'disconnected' });
  assert.deepEqual(dropped, { phase: 'connecting', reconnecting: true, reason: null });
  assert.equal(reducePeerState(dropped, { type: 'connection', state: 'disconnected' }), dropped);
  const left = reducePeerState(live, { type: 'peer-left' });
  assert.deepEqual(left, { phase: 'connecting', reconnecting: true, reason: null });
  assert.equal(reducePeerState(left, { type: 'peer-left' }), left);
  assert.equal(reducePeerState(INITIAL_PEER_STATE, { type: 'peer-left' }), INITIAL_PEER_STATE);
  // A fresh offer after a drop keeps the reconnecting flag until media flows again.
  const renegotiated = reducePeerState(left, { type: 'negotiate' });
  assert.deepEqual(renegotiated, { phase: 'connecting', reconnecting: true, reason: null });
  assert.deepEqual(reducePeerState(renegotiated, { type: 'track' }), live);
  // Renegotiating from live (host re-offers) is a reconnect too.
  assert.deepEqual(reducePeerState(live, { type: 'negotiate' }), { phase: 'connecting', reconnecting: true, reason: null });
});

test('peer state records failure and lets a new negotiation retry it', () => {
  const connecting = reducePeerState(INITIAL_PEER_STATE, { type: 'negotiate' });
  const failed = reducePeerState(connecting, { type: 'connection', state: 'failed' });
  assert.equal(failed.phase, 'failed');
  assert.ok(failed.reason);
  assert.equal(reducePeerState(failed, { type: 'connection', state: 'failed' }), failed);
  const explicit = reducePeerState(connecting, { type: 'fail', reason: 'No relay' });
  assert.deepEqual(explicit, { phase: 'failed', reconnecting: false, reason: 'No relay' });
  assert.deepEqual(reducePeerState(explicit, { type: 'negotiate' }), { phase: 'connecting', reconnecting: false, reason: null });
  // 'closed' is driven by us and never changes state on its own.
  assert.equal(reducePeerState(connecting, { type: 'connection', state: 'closed' }), connecting);
  // A stray disconnected before any negotiation is ignored.
  assert.equal(reducePeerState(INITIAL_PEER_STATE, { type: 'connection', state: 'disconnected' }), INITIAL_PEER_STATE);
  assert.deepEqual(reducePeerState(INITIAL_PEER_STATE, { type: 'connection', state: 'new' }), connecting);
});

/* ------------------------------------------------------------------ mesh rules */

test('mesh capacity is bounded by the server maximum and known peers are always re-offered', () => {
  assert.equal(canAcceptViewer(0, 4, false), true);
  assert.equal(canAcceptViewer(3, 4, false), true);
  assert.equal(canAcceptViewer(4, 4, false), false);
  assert.equal(canAcceptViewer(4, 4, true), true);
  assert.equal(canAcceptViewer(8, 50, false), false, 'never above the hard cap of 8');
  assert.equal(canAcceptViewer(0, 0, false), false);
  assert.equal(canAcceptViewer(0, undefined, false), false);

  assert.equal(roomCapacity(4, 8), 4);
  assert.equal(roomCapacity(12, 8), 8);
  assert.equal(roomCapacity(undefined, 6), 6);
  assert.equal(roomCapacity(3, 0), 0);
  assert.equal(roomCapacity('2', 8), 2);
  assert.equal(roomCapacity(5, 99), 5, 'the stream setting still applies under an oversized server value');
  assert.equal(roomCapacity(20, 99), 8, 'both inputs are bounded by the hard cap');
});

test('SignalBudget enforces 180 sends per rolling minute', () => {
  const budget = new SignalBudget();
  let now = 100_000;
  for (let i = 0; i < 180; i++) assert.equal(budget.take(now + i), true);
  assert.equal(budget.take(now + 180), false);
  assert.equal(budget.waitMs(now + 180), 60_000 - 180);
  now += 60_000;
  assert.equal(budget.waitMs(now), 0);
  assert.equal(budget.take(now), true);
  const small = new SignalBudget(2, 1000);
  assert.equal(small.take(0), true);
  assert.equal(small.take(0), true);
  assert.equal(small.take(999), false);
  assert.equal(small.take(1000), true);
});

test('CandidateQueue buffers trickle candidates per peer until drained', () => {
  const queue = new CandidateQueue();
  const c1 = { candidate: 'a', sdpMid: '0', sdpMLineIndex: 0 };
  const c2 = { candidate: 'b', sdpMid: '0', sdpMLineIndex: 0 };
  assert.equal(queue.has('p1'), false);
  queue.push('p1', c1);
  queue.push('p1', c2);
  queue.push('p2', c1);
  assert.equal(queue.has('p1'), true);
  assert.deepEqual(queue.drain('p1'), [c1, c2]);
  assert.equal(queue.has('p1'), false);
  assert.deepEqual(queue.drain('p1'), []);
  queue.delete('p2');
  assert.equal(queue.has('p2'), false);
  queue.push('p3', c1);
  queue.clear();
  assert.equal(queue.has('p3'), false);
});

/* ------------------------------------------------------------------ socket acks */

function fakeSocket(respond) {
  const calls = [];
  return {
    calls,
    emit(event, payload, ack) {
      calls.push({ event, payload });
      respond(event, payload, ack);
    },
  };
}

test('normalizeAck coerces the server ack shape and never trusts extra fields', () => {
  assert.deepEqual(normalizeAck({ ok: true, socketId: 's', role: 'host', viewerCount: '3', maxViewers: 4.9, secret: 'x' }), {
    ok: true,
    socketId: 's',
    role: 'host',
    viewerCount: 3,
    maxViewers: 4,
  });
  assert.deepEqual(normalizeAck({ ok: 'true' }), { ok: false });
  assert.deepEqual(normalizeAck({ ok: false, message: 'This live room is full.' }), { ok: false, message: 'This live room is full.' });
  assert.deepEqual(normalizeAck(null), { ok: false });
  assert.deepEqual(normalizeAck({ ok: true, role: 'admin' }), { ok: true });
});

test('emitWithAck resolves on ok, rejects with the server message otherwise, and times out', async () => {
  const good = fakeSocket((_e, _p, ack) => ack({ ok: true, viewerCount: 2, maxViewers: 4 }));
  const ack = await joinLivestreamRoom(good, 's1', 'tok');
  assert.deepEqual(ack, { ok: true, viewerCount: 2, maxViewers: 4 });
  assert.deepEqual(good.calls, [{ event: 'livestream:join', payload: { streamId: 's1', sessionToken: 'tok' } }]);

  const full = fakeSocket((_e, _p, ack) => ack({ ok: false, message: 'This live room is full.' }));
  await assert.rejects(joinLivestreamRoom(full, 's1', 'tok'), /This live room is full\./);

  const silent = fakeSocket(() => {});
  await assert.rejects(emitWithAck(silent, 'livestream:leave', { streamId: 's1' }, 10), /timed out/);

  const late = fakeSocket((_e, _p, ack) => setTimeout(() => ack({ ok: true }), 30));
  await assert.rejects(emitWithAck(late, 'x', {}, 5), /timed out/);
  await new Promise((r) => setTimeout(r, 40));

  const malformed = fakeSocket((_e, _p, ack) => ack('yes'));
  await assert.rejects(emitWithAck(malformed, 'x', {}), /failed/);

  const leave = fakeSocket((_e, _p, ack) => ack({ ok: true }));
  await leaveLivestreamRoom(leave, 's1');
  assert.deepEqual(leave.calls[0], { event: 'livestream:leave', payload: { streamId: 's1' } });
});

test('sendDescription and sendCandidate refuse locally what the server would reject', async () => {
  const socket = fakeSocket((_e, _p, ack) => ack({ ok: true }));
  await sendDescription(socket, 's1', 'v1', { type: 'offer', sdp: 'v=0' });
  assert.deepEqual(socket.calls[0], {
    event: 'livestream:signal',
    payload: { streamId: 's1', targetSocketId: 'v1', kind: 'offer', description: { type: 'offer', sdp: 'v=0' } },
  });
  await assert.rejects(sendDescription(socket, 's1', 'v1', { type: 'rollback', sdp: 'v=0' }), /invalid/);
  await assert.rejects(sendDescription(socket, 's1', 'v1', null), /invalid/);

  await sendCandidate(socket, 's1', 'v1', { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'f', junk: true });
  assert.deepEqual(socket.calls[1].payload, {
    streamId: 's1',
    targetSocketId: 'v1',
    kind: 'candidate',
    candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'f' },
  });
  await assert.rejects(sendCandidate(socket, 's1', 'v1', { sdpMid: '0' }), /invalid/);
  assert.equal(socket.calls.length, 2, 'rejected payloads never reach the socket');
});

/* ------------------------------------------------------------------ copy helpers */

test('durationLabel words the server cap like the mobile setup screen', () => {
  assert.equal(durationLabel(7200), '2 hours');
  assert.equal(durationLabel(3600), '1 hour');
  assert.equal(durationLabel(5400), '90 minutes');
  assert.equal(durationLabel(300), '5 minutes');
  assert.equal(durationLabel(60), '1 minute');
  assert.equal(durationLabel(0), '0 minutes');
});

test('videoOrientation reads the decoded frame size', () => {
  assert.equal(videoOrientation(720, 1280), 'portrait');
  assert.equal(videoOrientation(1280, 720), 'landscape');
  assert.equal(videoOrientation(640, 640), 'landscape');
  assert.equal(videoOrientation(0, 0), null);
  assert.equal(videoOrientation(NaN, 10), null);
});
