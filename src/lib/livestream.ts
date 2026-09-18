/**
 * Pure live-video helpers shared by the host and viewer rooms.
 *
 * Everything here mirrors the server's signalling contract in
 * vybe-backend/services/livestreamSocket.js and livestreamSessions.js, so a
 * payload the server would drop is dropped here first, and the peer state
 * machine can be unit tested without a DOM, a socket or an RTCPeerConnection.
 * Nothing in this file may touch `window`, `document` or `navigator`.
 */

export type LivestreamRole = 'host' | 'viewer';
export type SignalKind = 'offer' | 'answer' | 'candidate';

export type LivestreamIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

/** Body of `session` in PUT /livestreams/:id/start and POST /livestreams/:id/join. */
export type LivestreamSession = {
  token: string;
  role: LivestreamRole;
  expiresInSeconds: number;
  iceServers: LivestreamIceServer[];
  iceCredentialsExpireAt: string;
};

/** GET /livestreams/capabilities and the `capabilities` field of a stream detail. */
export type LivestreamCapabilities = {
  enabled: boolean;
  mediaMode: 'webrtc-mesh' | null;
  maxViewers: number;
  maxBroadcastSeconds: number;
  requiresCamera: boolean;
  requiresMicrophone: boolean;
  reason: string | null;
};

export type LivestreamSocketAck = {
  ok: boolean;
  message?: string;
  socketId?: string;
  role?: LivestreamRole;
  viewerCount?: number;
  maxViewers?: number;
};

export type SignalDescription = { type: 'offer' | 'answer'; sdp: string };

export type SignalCandidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string;
};

export type LivestreamSignal =
  | { streamId: string; fromSocketId: string; kind: 'offer' | 'answer'; description: SignalDescription }
  | { streamId: string; fromSocketId: string; kind: 'candidate'; candidate: SignalCandidate };

/* ------------------------------------------------------------------ limits (server mirrors) */

export const MAX_SDP_LENGTH = 200_000;
export const MAX_CANDIDATE_LENGTH = 4_096;
export const MAX_SDP_MID_LENGTH = 128;
export const MAX_USERNAME_FRAGMENT_LENGTH = 256;
/** livestreamSocket.js rejects the 181st signal in any rolling minute. */
export const MAX_SIGNALS_PER_MINUTE = 180;
/** livestreamSessions.js hard cap; a server may configure fewer. */
export const MAX_MESH_VIEWERS = 8;
export const ACK_TIMEOUT_MS = 10_000;
export const LEAVE_ACK_TIMEOUT_MS = 5_000;

/* ------------------------------------------------------------------ payload validation */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Same acceptance rule as the server's safeDescription. */
export function safeDescription(value: unknown): SignalDescription | null {
  if (!isRecord(value)) return null;
  const { type, sdp } = value;
  if (type !== 'offer' && type !== 'answer') return null;
  if (typeof sdp !== 'string' || sdp.length === 0 || sdp.length > MAX_SDP_LENGTH) return null;
  return { type, sdp };
}

/** Same acceptance and truncation rules as the server's safeCandidate. */
export function safeCandidate(value: unknown): SignalCandidate | null {
  if (!isRecord(value)) return null;
  const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = value;
  if (typeof candidate !== 'string' || candidate.length > MAX_CANDIDATE_LENGTH) return null;
  const clean: SignalCandidate = {
    candidate,
    sdpMid: typeof sdpMid === 'string' ? sdpMid.slice(0, MAX_SDP_MID_LENGTH) : null,
    sdpMLineIndex: Number.isInteger(sdpMLineIndex) ? (sdpMLineIndex as number) : null,
  };
  if (typeof usernameFragment === 'string') {
    clean.usernameFragment = usernameFragment.slice(0, MAX_USERNAME_FRAGMENT_LENGTH);
  }
  return clean;
}

/** The kinds a participant may legitimately receive. Hosts never get offers; viewers never get answers. */
export function receivableSignalKinds(role: LivestreamRole): SignalKind[] {
  return role === 'host' ? ['answer', 'candidate'] : ['offer', 'candidate'];
}

/** Mirror of the server's rolePairAllowed: offers flow host→viewer, answers viewer→host, candidates across roles. */
export function rolePairAllowed(sender: LivestreamRole, target: LivestreamRole, kind: string): boolean {
  if (kind === 'offer') return sender === 'host' && target === 'viewer';
  if (kind === 'answer') return sender === 'viewer' && target === 'host';
  return kind === 'candidate' && sender !== target;
}

/**
 * Validate an inbound `livestream:signal` payload for `role` in `streamId`.
 * Returns null for anything malformed, for another stream, or for a kind this
 * role should never receive, so the rooms can ignore it without branching.
 */
export function parseSignal(payload: unknown, streamId: string, role: LivestreamRole): LivestreamSignal | null {
  if (!isRecord(payload)) return null;
  if (String(payload.streamId ?? '') !== String(streamId) || !streamId) return null;
  const fromSocketId = payload.fromSocketId;
  if (typeof fromSocketId !== 'string' || !fromSocketId) return null;
  const kind = payload.kind;
  if (kind !== 'offer' && kind !== 'answer' && kind !== 'candidate') return null;
  if (!receivableSignalKinds(role).includes(kind)) return null;
  if (kind === 'candidate') {
    const candidate = safeCandidate(payload.candidate);
    return candidate ? { streamId, fromSocketId, kind, candidate } : null;
  }
  const description = safeDescription(payload.description);
  if (!description || description.type !== kind) return null;
  return { streamId, fromSocketId, kind, description };
}

/* ------------------------------------------------------------------ presence, status and chat payloads */

/** `livestream:presence` → the room's distinct viewer count, or null when it is for another stream. */
export function presenceCount(payload: unknown, streamId: string): number | null {
  if (!isRecord(payload) || String(payload.streamId ?? '') !== streamId) return null;
  const count = Number(payload.viewerCount);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

export type LivestreamStatusEvent = {
  status: 'live' | 'ended' | 'cancelled';
  reason: 'maximum-duration' | null;
};

/** `livestream:status` → a typed transition, or null when malformed or for another stream. */
export function parseStatus(payload: unknown, streamId: string): LivestreamStatusEvent | null {
  if (!isRecord(payload) || String(payload.streamId ?? '') !== streamId) return null;
  const { status, reason } = payload;
  if (status !== 'live' && status !== 'ended' && status !== 'cancelled') return null;
  return { status, reason: reason === 'maximum-duration' ? 'maximum-duration' : null };
}

/** `livestream:viewer-ready` → the viewer socket the host must offer to. */
export function parseViewerReady(
  payload: unknown,
  streamId: string,
): { viewerSocketId: string; viewer: { _id: string; username?: string; fullName?: string; avatar?: string } | null } | null {
  if (!isRecord(payload) || String(payload.streamId ?? '') !== streamId) return null;
  const viewerSocketId = payload.viewerSocketId;
  if (typeof viewerSocketId !== 'string' || !viewerSocketId) return null;
  const raw = isRecord(payload.viewer) ? payload.viewer : null;
  const viewer = raw && typeof raw._id === 'string'
    ? {
      _id: raw._id,
      username: typeof raw.username === 'string' ? raw.username : undefined,
      fullName: typeof raw.fullName === 'string' ? raw.fullName : undefined,
      avatar: typeof raw.avatar === 'string' ? raw.avatar : undefined,
    }
    : null;
  return { viewerSocketId, viewer };
}

/** `livestream:participant-left` → which socket dropped, or null for another stream. */
export function parseParticipantLeft(payload: unknown, streamId: string): { socketId: string; role: LivestreamRole | null } | null {
  if (!isRecord(payload) || String(payload.streamId ?? '') !== streamId) return null;
  if (typeof payload.socketId !== 'string' || !payload.socketId) return null;
  const role = payload.role === 'host' || payload.role === 'viewer' ? payload.role : null;
  return { socketId: payload.socketId, role };
}

/** True when a room-scoped payload (comment, like, reaction, banned...) belongs to `streamId`. */
export function isForStream(payload: unknown, streamId: string): payload is Record<string, unknown> {
  return isRecord(payload) && String(payload.streamId ?? '') === streamId;
}

/* ------------------------------------------------------------------ ICE / peer configuration */

const ICE_PROTOCOLS = ['stun:', 'stuns:', 'turn:', 'turns:'];

function validIceUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const lower = value.trim().toLowerCase();
  return lower.length > 0 && !/[\s<>]/.test(value) && ICE_PROTOCOLS.some((p) => lower.startsWith(p));
}

/**
 * Turn the session's ICE list into what RTCPeerConnection accepts, dropping
 * anything malformed. TURN entries keep their ephemeral credentials; STUN
 * entries must not carry any.
 */
export function mapIceServers(input: unknown): LivestreamIceServer[] {
  if (!Array.isArray(input)) return [];
  const servers: LivestreamIceServer[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) continue;
    const rawUrls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    const urls = rawUrls.filter(validIceUrl).map((u) => u.trim());
    if (!urls.length) continue;
    const server: LivestreamIceServer = { urls };
    if (typeof entry.username === 'string' && typeof entry.credential === 'string' && entry.username && entry.credential) {
      server.username = entry.username;
      server.credential = entry.credential;
    }
    servers.push(server);
  }
  return servers;
}

/** The relay-only policy needs at least one TURN listener or ICE can never complete. */
export function hasRelayServer(servers: LivestreamIceServer[]): boolean {
  return servers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => /^turns?:/i.test(u)) && Boolean(s.username) && Boolean(s.credential);
  });
}

export type PeerConfiguration = {
  iceServers: LivestreamIceServer[];
  iceTransportPolicy: 'relay';
  bundlePolicy: 'max-bundle';
  rtcpMuxPolicy: 'require';
};

/**
 * Identical to the mobile client. Relay-only keeps broadcaster and viewer IP
 * addresses hidden from each other and removes direct-ICE variability on
 * carrier-grade and symmetric NATs; max-bundle puts audio and video on one
 * transport so each viewer costs the host a single relay allocation.
 */
export function peerConfiguration(iceServers: LivestreamIceServer[]): PeerConfiguration {
  return {
    iceServers,
    iceTransportPolicy: 'relay',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
}

/* ------------------------------------------------------------------ capture constraints */

/** Same request as the mobile app: front camera, portrait 720x1280, 30 fps. */
export const HOST_MEDIA_CONSTRAINTS = {
  audio: true,
  video: {
    facingMode: 'user',
    width: { ideal: 720 },
    height: { ideal: 1280 },
    frameRate: { ideal: 30, max: 30 },
  },
} as const;

/** Second attempt after OverconstrainedError: any front camera at any size. */
export const RELAXED_MEDIA_CONSTRAINTS = {
  audio: true,
  video: { facingMode: 'user' },
} as const;

/** Constraints for a specific camera chosen from enumerateDevices. */
export function deviceMediaConstraints(deviceId: string) {
  return {
    audio: true,
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 720 },
      height: { ideal: 1280 },
      frameRate: { ideal: 30, max: 30 },
    },
  };
}

/* ------------------------------------------------------------------ media errors */

export type MediaErrorCode = 'permission' | 'missing' | 'busy' | 'constraints' | 'insecure' | 'unsupported' | 'unknown';

export type DescribedMediaError = {
  code: MediaErrorCode;
  title: string;
  message: string;
  /** Whether asking again can succeed without leaving the page. */
  retryable: boolean;
};

/** Map a getUserMedia rejection to copy the host can act on. */
export function describeMediaError(error: unknown): DescribedMediaError {
  const name = isRecord(error) && typeof error.name === 'string' ? error.name : '';
  const detail = isRecord(error) && typeof error.message === 'string' ? error.message : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        code: 'permission',
        title: 'Camera and microphone are blocked',
        message: 'Allow camera and microphone access for this site in your browser settings, then try again.',
        retryable: true,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        code: 'missing',
        title: 'No camera or microphone found',
        message: 'Connect a camera and a microphone, make sure they are not disabled, then try again.',
        retryable: true,
      };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        code: 'busy',
        title: 'Your camera is in use',
        message: 'Another app or browser tab may be using it. Close that, then try again.',
        retryable: true,
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        code: 'constraints',
        title: 'Camera does not support the requested quality',
        message: 'Vybe will try again with the camera’s own resolution.',
        retryable: true,
      };
    case 'SecurityError':
      return {
        code: 'insecure',
        title: 'Live video needs a secure connection',
        message: 'Open Vybe over https to use your camera.',
        retryable: false,
      };
    case 'TypeError':
      return {
        code: 'unsupported',
        title: 'This browser cannot capture video',
        message: 'Use a current version of Safari, Chrome, Edge or Firefox.',
        retryable: false,
      };
    default:
      return {
        code: 'unknown',
        title: 'Could not start your camera',
        message: detail || 'Try again in a moment.',
        retryable: true,
      };
  }
}

export type LiveVideoSupport = { ok: true } | { ok: false; reason: string };

/** Feature detection with the environment injected so it stays testable. */
export function checkLiveVideoSupport(env: { secureContext: boolean; hasUserMedia: boolean; hasPeerConnection: boolean }): LiveVideoSupport {
  if (!env.secureContext) return { ok: false, reason: 'Live video needs a secure (https) connection.' };
  if (!env.hasUserMedia) return { ok: false, reason: 'This browser cannot access a camera or microphone.' };
  if (!env.hasPeerConnection) return { ok: false, reason: 'This browser does not support WebRTC video.' };
  return { ok: true };
}

/* ------------------------------------------------------------------ peer state machine */

export type PeerPhase = 'idle' | 'connecting' | 'live' | 'ended' | 'failed';

export type PeerState = {
  phase: PeerPhase;
  /** True while waiting for the other side to come back (host dropped, ICE disconnected). */
  reconnecting: boolean;
  reason: string | null;
};

export type ConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

export type PeerEvent =
  | { type: 'negotiate' }
  | { type: 'track' }
  | { type: 'connection'; state: ConnectionState }
  | { type: 'peer-left' }
  | { type: 'end'; reason?: string }
  | { type: 'fail'; reason?: string }
  | { type: 'reset' };

export const INITIAL_PEER_STATE: PeerState = { phase: 'idle', reconnecting: false, reason: null };

/**
 * idle → connecting → live, with `ended` terminal and `failed` recoverable by
 * a fresh negotiation. Returns the same object when nothing changes so React
 * state updates can bail out.
 */
export function reducePeerState(state: PeerState, event: PeerEvent): PeerState {
  if (event.type === 'reset') return state === INITIAL_PEER_STATE ? state : INITIAL_PEER_STATE;
  if (event.type === 'end') {
    if (state.phase === 'ended' && state.reason === (event.reason ?? null)) return state;
    return { phase: 'ended', reconnecting: false, reason: event.reason ?? null };
  }
  if (state.phase === 'ended') return state;

  switch (event.type) {
    case 'negotiate':
      if (state.phase === 'connecting' && !state.reason) return state;
      return { phase: 'connecting', reconnecting: state.phase === 'live' || state.reconnecting, reason: null };
    case 'track':
      if (state.phase === 'live') return state;
      return { phase: 'live', reconnecting: false, reason: null };
    case 'fail':
      if (state.phase === 'failed' && state.reason === (event.reason ?? null)) return state;
      return { phase: 'failed', reconnecting: false, reason: event.reason ?? null };
    case 'peer-left':
      if (state.phase === 'idle') return state;
      if (state.phase === 'connecting' && state.reconnecting) return state;
      return { phase: 'connecting', reconnecting: true, reason: null };
    case 'connection':
      switch (event.state) {
        case 'connected':
          if (state.phase === 'live') return state;
          return { phase: 'live', reconnecting: false, reason: null };
        case 'disconnected':
          if (state.phase === 'connecting' && state.reconnecting) return state;
          if (state.phase === 'live' || state.phase === 'connecting') {
            return { phase: 'connecting', reconnecting: true, reason: null };
          }
          return state;
        case 'failed':
          if (state.phase === 'failed') return state;
          return { phase: 'failed', reconnecting: false, reason: 'The video connection failed.' };
        case 'new':
        case 'connecting':
          if (state.phase === 'idle') return { phase: 'connecting', reconnecting: false, reason: null };
          return state;
        case 'closed':
        default:
          return state;
      }
    default:
      return state;
  }
}

/* ------------------------------------------------------------------ mesh rules */

/** The host offers to a new viewer only while the mesh has room; the server enforces the same cap. */
export function canAcceptViewer(activePeers: number, maxViewers: number, alreadyKnown: boolean): boolean {
  if (alreadyKnown) return true;
  const cap = Math.max(0, Math.min(Number(maxViewers) || 0, MAX_MESH_VIEWERS));
  return activePeers < cap;
}

/** Effective room capacity: the stream's own setting bounded by the server's configured maximum. */
export function roomCapacity(streamMaxViewers: unknown, serverMaxViewers: unknown): number {
  const server = Math.min(Math.max(Number(serverMaxViewers) || 0, 0), MAX_MESH_VIEWERS);
  const stream = Number(streamMaxViewers);
  if (!server) return 0;
  if (!Number.isFinite(stream) || stream <= 0) return server;
  return Math.min(Math.floor(stream), server);
}

/**
 * Rolling-minute budget matching the server's signal rate limit, so a busy
 * host defers a burst of ICE candidates instead of being told to reconnect.
 */
export class SignalBudget {
  private readonly sent: number[] = [];

  constructor(private readonly limit = MAX_SIGNALS_PER_MINUTE, private readonly windowMs = 60_000) {}

  private prune(now: number) {
    while (this.sent.length && now - this.sent[0] >= this.windowMs) this.sent.shift();
  }

  /** Reserve one send at `now`; false when the window is exhausted. */
  take(now = Date.now()): boolean {
    this.prune(now);
    if (this.sent.length >= this.limit) return false;
    this.sent.push(now);
    return true;
  }

  /** Milliseconds until `take()` can succeed again; 0 when it can now. */
  waitMs(now = Date.now()): number {
    this.prune(now);
    if (this.sent.length < this.limit) return 0;
    return Math.max(0, this.windowMs - (now - this.sent[0]));
  }
}

/** Trickle-ICE candidates that arrive before the remote description, keyed by peer. */
export class CandidateQueue {
  private readonly pending = new Map<string, SignalCandidate[]>();

  push(socketId: string, candidate: SignalCandidate): void {
    const list = this.pending.get(socketId) ?? [];
    list.push(candidate);
    this.pending.set(socketId, list);
  }

  /** Remove and return everything queued for `socketId`, oldest first. */
  drain(socketId: string): SignalCandidate[] {
    const list = this.pending.get(socketId) ?? [];
    this.pending.delete(socketId);
    return list;
  }

  has(socketId: string): boolean {
    return (this.pending.get(socketId)?.length ?? 0) > 0;
  }

  delete(socketId: string): void {
    this.pending.delete(socketId);
  }

  clear(): void {
    this.pending.clear();
  }
}

/* ------------------------------------------------------------------ sessions */

/** Absolute expiry of the scoped media token, from when the response was received. */
export function sessionExpiresAt(session: Pick<LivestreamSession, 'expiresInSeconds'>, receivedAtMs: number): number {
  const ttl = Number(session.expiresInSeconds);
  return receivedAtMs + (Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 : 0);
}

/** TURN credentials are HMAC-timestamped; a peer created after this instant cannot allocate. */
export function iceCredentialsFresh(session: Pick<LivestreamSession, 'iceCredentialsExpireAt'>, nowMs: number): boolean {
  const at = Date.parse(session.iceCredentialsExpireAt);
  return Number.isFinite(at) ? at > nowMs : false;
}

/** Validate the `session` envelope of a start/join response. */
export function parseSession(value: unknown): LivestreamSession | null {
  if (!isRecord(value)) return null;
  const { token, role, expiresInSeconds, iceServers, iceCredentialsExpireAt } = value;
  if (typeof token !== 'string' || !token.trim()) return null;
  if (role !== 'host' && role !== 'viewer') return null;
  const ttl = Number(expiresInSeconds);
  return {
    token,
    role,
    expiresInSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : 0,
    iceServers: mapIceServers(iceServers),
    iceCredentialsExpireAt: typeof iceCredentialsExpireAt === 'string' ? iceCredentialsExpireAt : '',
  };
}

/* ------------------------------------------------------------------ socket acks */

export type AckEmitter = {
  emit: (event: string, payload: Record<string, unknown>, ack: (response: unknown) => void) => unknown;
};

export function normalizeAck(response: unknown): LivestreamSocketAck {
  if (!isRecord(response)) return { ok: false };
  const ack: LivestreamSocketAck = { ok: response.ok === true };
  if (typeof response.message === 'string') ack.message = response.message;
  if (typeof response.socketId === 'string') ack.socketId = response.socketId;
  if (response.role === 'host' || response.role === 'viewer') ack.role = response.role;
  if (Number.isFinite(Number(response.viewerCount))) ack.viewerCount = Math.max(0, Math.floor(Number(response.viewerCount)));
  if (Number.isFinite(Number(response.maxViewers))) ack.maxViewers = Math.max(0, Math.floor(Number(response.maxViewers)));
  return ack;
}

/**
 * Emit with an acknowledgement, resolving only on `{ ok: true }`. A missing
 * ack rejects after `timeoutMs` so a dead socket never hangs the room.
 */
export function emitWithAck(
  socket: AckEmitter,
  event: string,
  payload: Record<string, unknown>,
  timeoutMs = ACK_TIMEOUT_MS,
): Promise<LivestreamSocketAck> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('The live connection timed out.'));
    }, timeoutMs);
    socket.emit(event, payload, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ack = normalizeAck(response);
      if (!ack.ok) {
        reject(new Error(ack.message || 'The live connection failed.'));
        return;
      }
      resolve(ack);
    });
  });
}

export const joinLivestreamRoom = (socket: AckEmitter, streamId: string, sessionToken: string) =>
  emitWithAck(socket, 'livestream:join', { streamId, sessionToken });

export const leaveLivestreamRoom = (socket: AckEmitter, streamId: string) =>
  emitWithAck(socket, 'livestream:leave', { streamId }, LEAVE_ACK_TIMEOUT_MS);

/** Send an offer or answer; anything the server would reject is refused locally. */
export function sendDescription(
  socket: AckEmitter,
  streamId: string,
  targetSocketId: string,
  description: { type?: string | null; sdp?: string | null } | null | undefined,
): Promise<LivestreamSocketAck> {
  const clean = safeDescription(description);
  if (!clean) return Promise.reject(new Error('The live video description is invalid.'));
  return emitWithAck(socket, 'livestream:signal', {
    streamId,
    targetSocketId,
    kind: clean.type,
    description: clean,
  });
}

export function sendCandidate(
  socket: AckEmitter,
  streamId: string,
  targetSocketId: string,
  candidate: unknown,
): Promise<LivestreamSocketAck> {
  const clean = safeCandidate(candidate);
  if (!clean) return Promise.reject(new Error('The live video candidate is invalid.'));
  return emitWithAck(socket, 'livestream:signal', {
    streamId,
    targetSocketId,
    kind: 'candidate',
    candidate: clean,
  });
}

/* ------------------------------------------------------------------ copy helpers */

/** "2 hours" / "90 minutes", as the mobile setup screen words the server's cap. */
export function durationLabel(seconds: number): string {
  const minutes = Math.max(0, Math.floor(Number(seconds) / 60));
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** Camera orientation from the decoded frame size, for a stage that fits either. */
export function videoOrientation(width: number, height: number): 'portrait' | 'landscape' | null {
  if (!(width > 0) || !(height > 0)) return null;
  return height > width ? 'portrait' : 'landscape';
}
