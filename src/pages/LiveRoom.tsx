import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSharedSocket } from '../lib/socket';
import {
  CandidateQueue,
  INITIAL_PEER_STATE,
  SignalBudget,
  canAcceptViewer,
  durationLabel,
  hasRelayServer,
  isForStream,
  joinLivestreamRoom,
  leaveLivestreamRoom,
  parseParticipantLeft,
  parseSession,
  parseSignal,
  parseStatus,
  parseViewerReady,
  presenceCount,
  reducePeerState,
  roomCapacity,
  sendCandidate,
  sendDescription,
  videoOrientation,
  type ConnectionState,
  type DescribedMediaError,
  type LivestreamCapabilities,
  type LivestreamSession,
  type LivestreamSignal,
  type SignalCandidate,
} from '../lib/livestream';
import {
  MediaCaptureError,
  captureHostMedia,
  createPeer,
  endLivestreamOnUnload,
  leaveLivestreamOnUnload,
  listCameras,
  liveVideoSupport,
  stopMedia,
  type CameraOption,
} from '../lib/liveMedia';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  PageHeader,
  Select,
  Skeleton,
  SkeletonRow,
  Spinner,
  cx,
  formatStat,
  useOnline,
  usePulse,
  useToast,
} from '../components/ui';
import {
  CalendarDays,
  Camera,
  Eye,
  Heart,
  Maximize,
  Mic,
  MicOff,
  Radio,
  Refresh,
  Send,
  Sparkles,
  Trash,
  Users,
  Video,
  VideoOff,
  Volume,
  VolumeOff,
  X,
} from '../components/icons';
import {
  ago,
  at,
  chatAllowed,
  commenterName,
  giftsAllowed,
  hostId,
  hostName,
  hostOf,
  likesOf,
  userIdOf,
  viewersOf,
  type Stream,
  type StreamComment,
} from './liveTypes';

/* ================================================================== shared pieces */

type StreamDetail = { stream: Stream; capabilities: LivestreamCapabilities | null };

function useStreamDetail(streamId: string, live: boolean) {
  return useQuery({
    queryKey: ['livestream', streamId],
    // While live the socket carries every change; this is only a safety net.
    refetchInterval: live ? 60_000 : false,
    queryFn: async (): Promise<StreamDetail> => {
      const { data } = await api.get(`/livestreams/${streamId}`);
      return { stream: data.stream as Stream, capabilities: (data.capabilities as LivestreamCapabilities | undefined) ?? null };
    },
  });
}

function LiveDot() {
  return (
    <span className="relative inline-flex h-2 w-2" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
    </span>
  );
}

const PILL = 'inline-flex h-7 items-center gap-1.5 rounded-xs bg-surface-1/85 px-2 text-2xs font-semibold text-text-1 backdrop-blur';

function LivePill() {
  return (
    <span className={cx(PILL, 'text-danger')}>
      <LiveDot />
      Live
    </span>
  );
}

function ViewerPill({ count }: { count: number }) {
  return (
    <span className={PILL} aria-live="polite" aria-atomic="true" aria-label={`${count} watching`}>
      <Eye size={13} className="text-text-2" />
      <span className="tabular">{formatStat(count)}</span>
    </span>
  );
}

function ConnectionPill({ ready, label }: { ready: boolean; label?: string }) {
  return (
    <span className={PILL} role="status">
      <span aria-hidden="true" className={cx('h-2 w-2 rounded-full', ready ? 'bg-success' : 'bg-warning')} />
      {label ?? (ready ? 'Connected' : 'Reconnecting')}
    </span>
  );
}

/**
 * Attach a MediaStream to a <video>, start playback and report the decoded
 * orientation so the stage can fit a phone's portrait camera and a laptop's
 * landscape webcam without cropping either.
 */
function useVideoStream(videoRef: RefObject<HTMLVideoElement | null>, stream: MediaStream | null) {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape' | null>(null);
  const [blocked, setBlocked] = useState(false);

  const play = useCallback(() => {
    const el = videoRef.current;
    if (!el || !el.srcObject) return;
    const attempt = el.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(() => setBlocked(false)).catch(() => setBlocked(true));
    }
  }, [videoRef]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    if (!stream) {
      setOrientation(null);
      setBlocked(false);
      return;
    }
    const onMeta = () => setOrientation(videoOrientation(el.videoWidth, el.videoHeight));
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('resize', onMeta);
    play();
    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('resize', onMeta);
      if (el.srcObject === stream) el.srcObject = null;
    };
  }, [videoRef, stream, play]);

  return { orientation, blocked, play };
}

/**
 * The video surface. Always the deep-water dark theme (the `dark` class scopes
 * the semantic tokens), full-bleed on phones, contained and rounded from `md`.
 */
function VideoStage({
  videoRef,
  hasVideo,
  orientation,
  mirrored,
  muted,
  label,
  children,
  placeholder,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  hasVideo: boolean;
  orientation: 'portrait' | 'landscape' | null;
  mirrored?: boolean;
  muted: boolean;
  label: string;
  children?: ReactNode;
  placeholder?: ReactNode;
}) {
  const portrait = orientation === 'portrait';
  return (
    <div className="-mx-4 md:mx-0">
      <div
        className={cx(
          'dark relative w-full overflow-hidden bg-bg text-text-1 md:rounded-lg md:border md:border-line',
          portrait ? 'aspect-[9/16] max-h-[75dvh] md:mx-auto md:max-w-[calc(75dvh*9/16)]' : 'aspect-video max-h-[75dvh]',
        )}
      >
        <video
          ref={videoRef}
          autoPlay
          muted={muted}
          playsInline
          aria-label={label}
          className={cx('h-full w-full object-contain', mirrored && '-scale-x-100', !hasVideo && 'hidden')}
        />
        {!hasVideo ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">{placeholder}</div> : null}
        {children}
      </div>
    </div>
  );
}

/* ================================================================== chat */

type ChatPayload = { streamId?: string; comment?: StreamComment };

function useLiveChat({
  streamId,
  stream,
  socket,
  connected,
  myId,
}: {
  streamId: string;
  stream: Stream | null;
  socket: Socket | null;
  connected: boolean;
  myId: string;
}) {
  const toast = useToast();
  const isLive = stream?.status === 'live';
  const [comments, setComments] = useState<StreamComment[]>([]);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [reaction, setReaction] = useState<{ id: number; from: string } | null>(null);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heart = usePulse();

  useEffect(() => {
    if (!stream) return;
    setLikeCount(likesOf(stream));
    setLiked(Boolean(stream.isLiked));
  }, [stream]);

  const history = useQuery({
    queryKey: ['livestream', streamId, 'comments'],
    enabled: Boolean(stream) && stream?.status !== 'cancelled',
    // The socket delivers new messages; polling only covers a dropped socket.
    refetchInterval: isLive && !connected ? 10_000 : false,
    queryFn: async () => {
      const { data } = await api.get(`/livestreams/${streamId}/comments`, { params: { page: 1, limit: 50 } });
      return (data.comments || []) as StreamComment[];
    },
  });

  const append = useCallback((comment: StreamComment | undefined) => {
    if (!comment?._id) return;
    setComments((current) => (current.some((c) => c._id === comment._id) ? current : [...current, comment].slice(-200)));
  }, []);

  useEffect(() => {
    if (!history.data) return;
    setComments((current) => {
      const seen = new Set(current.map((c) => c._id));
      const merged = [...current];
      for (const c of history.data) if (!seen.has(c._id)) merged.push(c);
      merged.sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
      return merged.slice(-200);
    });
  }, [history.data]);

  useEffect(() => {
    if (!socket) return;
    const onComment = (payload: ChatPayload) => {
      if (isForStream(payload, streamId)) append(payload.comment);
    };
    const onRemoved = (payload: unknown) => {
      if (!isForStream(payload, streamId)) return;
      const id = String(payload.commentId ?? '');
      if (id) setComments((current) => current.filter((c) => c._id !== id));
    };
    const onLike = (payload: unknown) => {
      if (!isForStream(payload, streamId)) return;
      setLikeCount(Number(payload.likeCount) || 0);
      if (String(payload.userId ?? '') === myId) setLiked(Boolean(payload.liked));
    };
    const onReaction = (payload: unknown) => {
      if (!isForStream(payload, streamId)) return;
      const user = payload.user as { fullName?: string; username?: string } | undefined;
      setReaction({ id: Date.now(), from: user?.fullName?.trim() || user?.username || 'Someone' });
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
      reactionTimer.current = setTimeout(() => setReaction(null), 1600);
    };
    socket.on('livestream:comment', onComment);
    socket.on('livestream:comment-removed', onRemoved);
    socket.on('livestream:like', onLike);
    socket.on('livestream:reaction', onReaction);
    return () => {
      socket.off('livestream:comment', onComment);
      socket.off('livestream:comment-removed', onRemoved);
      socket.off('livestream:like', onLike);
      socket.off('livestream:reaction', onReaction);
    };
  }, [socket, streamId, myId, append]);

  useEffect(() => () => {
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
  }, []);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const { data } = await api.post(`/livestreams/${streamId}/comments`, { text });
      return data.comment as StreamComment | undefined;
    },
    onSuccess: (comment) => append(comment),
    onError: (e) => toast.error(errMsg(e, 'Could not send your message')),
  });

  const remove = useMutation({
    mutationFn: async (commentId: string) => {
      await api.delete(`/livestreams/${streamId}/comments/${commentId}`);
      return commentId;
    },
    onSuccess: (commentId) => setComments((current) => current.filter((c) => c._id !== commentId)),
    onError: (e) => toast.error(errMsg(e, 'Could not remove that message')),
  });

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/livestreams/${streamId}/like`);
      return { liked: Boolean(data.liked), likeCount: Number(data.likeCount) || 0 };
    },
    onMutate: () => heart.pulse(),
    onSuccess: (result) => {
      setLiked(result.liked);
      setLikeCount(result.likeCount);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not react to the stream')),
  });

  const cheer = useMutation({
    mutationFn: async () => {
      await api.post(`/livestreams/${streamId}/gift`, { giftType: 'heart' });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not send your cheer')),
  });

  return { comments, history, send, remove, like, cheer, likeCount, liked, reaction, heartClass: heart.className };
}

function ChatPanel({
  stream,
  chat,
  myId,
  canModerate,
  className,
}: {
  stream: Stream;
  chat: ReturnType<typeof useLiveChat>;
  myId: string;
  canModerate: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const isLive = stream.status === 'live';
  const { comments, history, send, remove } = chat;

  // Follow the newest message unless the reader has scrolled up to re-read.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [comments.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft('');
    send.mutate(text, { onError: () => setDraft(text) });
  };

  return (
    <Card padded={false} className={cx('flex flex-col', className)} aria-label="Live chat">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="type-heading text-md text-text-1">Live chat</h2>
        <span className="tabular text-xs text-text-2">{formatStat(comments.length)}</span>
      </div>
      <ul ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 py-3" aria-live="polite" aria-relevant="additions">
        {history.isLoading && comments.length === 0 ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i}>
                <SkeletonRow className="py-0" />
              </li>
            ))}
          </>
        ) : null}
        {history.isError && comments.length === 0 ? (
          <li>
            <ErrorState error={history.error} onRetry={() => history.refetch()} className="py-6" />
          </li>
        ) : null}
        {history.isSuccess && comments.length === 0 ? (
          <li className="rounded-md bg-surface-2 px-3 py-4 text-center text-sm text-text-2">
            {isLive ? 'No messages yet. Say hi to the room.' : stream.status === 'scheduled' ? 'Chat opens when the stream goes live.' : 'Nobody chatted during this stream.'}
          </li>
        ) : null}
        {comments.map((c) => {
          const mine = userIdOf(c.user) === myId;
          return (
            <li key={c._id} className="group flex gap-2">
              <Avatar src={c.user?.avatar} name={commenterName(c)} size="xs" />
              <div className="min-w-0 flex-1">
                <p className="text-xs">
                  <span className="font-semibold text-text-1">{commenterName(c)}</span>{' '}
                  <span className="text-text-3">{ago(c.createdAt)}</span>
                </p>
                <p className="break-words text-sm text-text-1">{c.text}</p>
              </div>
              {isLive && (mine || canModerate) ? (
                <IconButton
                  label={mine ? 'Remove your message' : `Remove message from ${commenterName(c)}`}
                  size={40}
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(c._id)}
                  className="shrink-0 text-text-3"
                >
                  <Trash size={16} />
                </IconButton>
              ) : null}
            </li>
          );
        })}
      </ul>
      {isLive ? (
        chatAllowed(stream) ? (
          <form
            className="flex items-end gap-2 border-t border-line px-3 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input
              label="Message"
              hideLabel
              placeholder="Message the room"
              maxLength={300}
              value={draft}
              autoComplete="off"
              onChange={(e) => setDraft(e.target.value)}
              containerClassName="flex-1"
            />
            <IconButton type="submit" label="Send message" variant="primary" disabled={!draft.trim() || send.isPending}>
              <Send size={20} />
            </IconButton>
          </form>
        ) : (
          <p className="border-t border-line px-4 py-3 text-center text-xs text-text-2">The host has turned chat off for this stream.</p>
        )
      ) : null}
    </Card>
  );
}

function ReactionBurst({ reaction }: { reaction: { id: number; from: string } | null }) {
  if (!reaction) return null;
  return (
    <div key={reaction.id} className="anim-toast-in pointer-events-none absolute bottom-16 right-4 flex items-center gap-1.5 rounded-xs bg-surface-1/85 px-2 py-1 text-2xs font-semibold text-text-1 backdrop-blur" role="status">
      <Heart size={16} filled className="text-danger" />
      {reaction.from}
    </div>
  );
}

/* ================================================================== host */

type HostPhase = 'setup' | 'starting' | 'live' | 'ending' | 'ended';

type ViewerPeer = { socketId: string; name: string; avatar?: string; state: ConnectionState };

/** How long a hidden tab may keep a paused camera before the broadcast ends for its viewers. */
const BACKGROUND_GRACE_MS = 45_000;
const MAX_SESSION_REFRESHES = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function useHostBroadcast({
  streamId,
  resumeLive,
  capabilities,
  streamCapacity,
}: {
  streamId: string;
  /** The stream is already live (host reloaded): rejoin instead of starting. */
  resumeLive: boolean;
  capabilities: LivestreamCapabilities | null;
  streamCapacity: number | undefined;
}) {
  const { socket, connected } = useSharedSocket();
  const qc = useQueryClient();
  const toast = useToast();
  const [phase, setPhase] = useState<HostPhase>('setup');
  const [media, setMedia] = useState<MediaStream | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [mediaError, setMediaError] = useState<DescribedMediaError | null>(null);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [cameraId, setCameraId] = useState<string>('');
  const [session, setSession] = useState<LivestreamSession | null>(null);
  const [roomJoined, setRoomJoined] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [maxViewers, setMaxViewers] = useState(() => roomCapacity(streamCapacity, capabilities?.maxViewers));
  const [viewers, setViewers] = useState<ViewerPeer[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [endedStream, setEndedStream] = useState<Stream | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);

  const peers = useRef(new Map<string, RTCPeerConnection>());
  const pending = useRef(new CandidateQueue());
  const budget = useRef(new SignalBudget());
  const mediaRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<LivestreamSession | null>(null);
  const phaseRef = useRef<HostPhase>('setup');
  const maxViewersRef = useRef(maxViewers);
  const endingRef = useRef(false);
  const refreshesRef = useRef(0);
  const backgroundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mediaRef.current = media;
    sessionRef.current = session;
    phaseRef.current = phase;
    maxViewersRef.current = maxViewers;
  }, [media, session, phase, maxViewers]);

  useEffect(() => {
    setMaxViewers(roomCapacity(streamCapacity, capabilities?.maxViewers));
  }, [streamCapacity, capabilities?.maxViewers]);

  const closePeer = useCallback((socketId: string) => {
    peers.current.get(socketId)?.close();
    peers.current.delete(socketId);
    pending.current.delete(socketId);
    setViewers((current) => current.filter((v) => v.socketId !== socketId));
  }, []);

  const closeEveryPeer = useCallback(() => {
    peers.current.forEach((peer) => peer.close());
    peers.current.clear();
    pending.current.clear();
    setViewers([]);
  }, []);

  const releaseMedia = useCallback(() => {
    stopMedia(mediaRef.current);
    mediaRef.current = null;
    setMedia(null);
  }, []);

  /** Send within the server's rate limit; a burst of ICE candidates waits instead of tripping "reconnect". */
  const guardedSend = useCallback(async (send: () => Promise<unknown>) => {
    const wait = budget.current.waitMs();
    if (wait > 0) await sleep(wait);
    budget.current.take();
    await send();
  }, []);

  const capture = useCallback(async (deviceId?: string) => {
    setCapturing(true);
    setMediaError(null);
    try {
      const next = await captureHostMedia(deviceId || undefined);
      const previous = mediaRef.current;
      // Mid-broadcast camera switch: swap the tracks every viewer is receiving.
      if (previous && peers.current.size) {
        const video = next.getVideoTracks()[0];
        const audio = next.getAudioTracks()[0];
        await Promise.all(
          [...peers.current.values()].flatMap((peer) =>
            peer.getSenders().map((sender) => {
              if (sender.track?.kind === 'video' && video) return sender.replaceTrack(video);
              if (sender.track?.kind === 'audio' && audio) return sender.replaceTrack(audio);
              return Promise.resolve();
            }),
          ),
        );
      }
      next.getAudioTracks().forEach((t) => { t.enabled = !muted; });
      next.getVideoTracks().forEach((t) => { t.enabled = !cameraOff; });
      stopMedia(previous);
      mediaRef.current = next;
      setMedia(next);
      const found = await listCameras();
      setCameras(found);
      const activeId = next.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeId) setCameraId(activeId);
    } catch (e) {
      const described = e instanceof MediaCaptureError ? e.described : null;
      setMediaError(described ?? { code: 'unknown', title: 'Could not start your camera', message: errMsg(e, 'Try again in a moment.'), retryable: true });
    } finally {
      setCapturing(false);
    }
  }, [muted, cameraOff]);

  const endBroadcast = useCallback(async (reason: string | null = null) => {
    if (endingRef.current) return;
    endingRef.current = true;
    setPhase('ending');
    setEndedReason(reason);
    try {
      const { data } = await api.put(`/livestreams/${streamId}/end`);
      setEndedStream((data?.stream as Stream | undefined) ?? null);
    } catch (e) {
      // A 409 means the server already closed it (duration cap): not an error for the host.
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status !== 409) toast.error(errMsg(e, 'Could not close the stream on the server. It will expire on its own.'));
    }
    if (socket?.connected) await leaveLivestreamRoom(socket, streamId).catch(() => undefined);
    closeEveryPeer();
    releaseMedia();
    setSession(null);
    setRoomJoined(false);
    setPhase('ended');
    endingRef.current = false;
    qc.invalidateQueries({ queryKey: ['livestreams'] });
    qc.invalidateQueries({ queryKey: ['livestream', streamId] });
  }, [streamId, socket, closeEveryPeer, releaseMedia, qc, toast]);

  const start = useCallback(async () => {
    if (!capabilities?.enabled) {
      setError(capabilities?.reason || 'Live video is not configured on this server.');
      return;
    }
    if (!mediaRef.current) {
      setError('Enable your camera and microphone first.');
      return;
    }
    if (!socket?.connected) {
      setError('Vybe is reconnecting. Wait for the live connection and try again.');
      return;
    }
    setPhase('starting');
    setError(null);
    try {
      const { data } = resumeLive
        ? await api.post(`/livestreams/${streamId}/join`)
        : await api.put(`/livestreams/${streamId}/start`);
      const parsed = parseSession(data?.session);
      if (!parsed || parsed.role !== 'host') throw new Error('The server did not return a broadcaster session.');
      if (!hasRelayServer(parsed.iceServers)) throw new Error('The video relay is not available right now. Try again in a moment.');
      refreshesRef.current = 0;
      setSession(parsed);
      setPhase('live');
      qc.invalidateQueries({ queryKey: ['livestreams'] });
      qc.setQueryData<StreamDetail | undefined>(['livestream', streamId], (old) => (old && data?.stream ? { ...old, stream: data.stream as Stream } : old));
    } catch (e) {
      setError(errMsg(e, 'The live broadcast could not start.'));
      setPhase('setup');
    }
  }, [capabilities, socket, resumeLive, streamId, qc]);

  const createOfferForViewer = useCallback(async (viewerSocketId: string, viewer: { name: string; avatar?: string }) => {
    const activeSession = sessionRef.current;
    const local = mediaRef.current;
    if (!socket || !activeSession || !local || phaseRef.current !== 'live') return;
    if (!canAcceptViewer(peers.current.size, maxViewersRef.current, peers.current.has(viewerSocketId))) return;
    closePeer(viewerSocketId);
    const peer = createPeer(activeSession.iceServers);
    peers.current.set(viewerSocketId, peer);
    setViewers((current) => [...current.filter((v) => v.socketId !== viewerSocketId), { socketId: viewerSocketId, name: viewer.name, avatar: viewer.avatar, state: 'new' }]);
    local.getTracks().forEach((track) => peer.addTrack(track, local));
    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON();
      void guardedSend(() => sendCandidate(socket, streamId, viewerSocketId, candidate)).catch(() => undefined);
    };
    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      setViewers((current) => current.map((v) => (v.socketId === viewerSocketId ? { ...v, state } : v)));
      // The viewer re-joins on failure and gets a fresh offer; keep no dead peers around.
      if (state === 'failed' || state === 'closed') closePeer(viewerSocketId);
    };
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!peer.localDescription) throw new Error('Could not create live video offer.');
      await guardedSend(() => sendDescription(socket, streamId, viewerSocketId, peer.localDescription));
    } catch {
      closePeer(viewerSocketId);
    }
  }, [socket, streamId, closePeer, guardedSend]);

  const handleSignal = useCallback(async (signal: LivestreamSignal) => {
    const peer = peers.current.get(signal.fromSocketId);
    if (!peer) return;
    if (signal.kind === 'answer') {
      await peer.setRemoteDescription(signal.description);
      for (const candidate of pending.current.drain(signal.fromSocketId)) {
        await peer.addIceCandidate(candidate as RTCIceCandidateInit).catch(() => undefined);
      }
      return;
    }
    if (signal.kind === 'candidate') {
      if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate as RTCIceCandidateInit).catch(() => undefined);
      else pending.current.push(signal.fromSocketId, signal.candidate as SignalCandidate);
    }
  }, []);

  // Room events while live.
  useEffect(() => {
    if (!socket || phase !== 'live') return;
    const onViewerReady = (payload: unknown) => {
      const ready = parseViewerReady(payload, streamId);
      if (!ready) return;
      const name = ready.viewer?.fullName?.trim() || ready.viewer?.username || 'Viewer';
      void createOfferForViewer(ready.viewerSocketId, { name, avatar: ready.viewer?.avatar });
    };
    const onSignal = (payload: unknown) => {
      const signal = parseSignal(payload, streamId, 'host');
      if (signal) void handleSignal(signal).catch(() => closePeer(signal.fromSocketId));
    };
    const onLeft = (payload: unknown) => {
      const left = parseParticipantLeft(payload, streamId);
      if (left) closePeer(left.socketId);
    };
    const onPresence = (payload: unknown) => {
      const count = presenceCount(payload, streamId);
      if (count !== null) setViewerCount(count);
    };
    const onStatus = (payload: unknown) => {
      const status = parseStatus(payload, streamId);
      if (!status || status.status === 'live') return;
      void endBroadcast(status.reason === 'maximum-duration' ? 'This live session reached the server’s maximum duration.' : 'The stream was closed on the server.');
    };
    socket.on('livestream:viewer-ready', onViewerReady);
    socket.on('livestream:signal', onSignal);
    socket.on('livestream:participant-left', onLeft);
    socket.on('livestream:presence', onPresence);
    socket.on('livestream:status', onStatus);
    return () => {
      socket.off('livestream:viewer-ready', onViewerReady);
      socket.off('livestream:signal', onSignal);
      socket.off('livestream:participant-left', onLeft);
      socket.off('livestream:presence', onPresence);
      socket.off('livestream:status', onStatus);
    };
  }, [socket, phase, streamId, createOfferForViewer, handleSignal, closePeer, endBroadcast]);

  // Join (and after every reconnect, re-join) the room as the host. The
  // server replays 'viewer-ready' for everyone already waiting, which
  // re-offers to viewers who lost us.
  useEffect(() => {
    if (!socket || !connected || !session || phase !== 'live') {
      setRoomJoined(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ack = await joinLivestreamRoom(socket, streamId, session.token);
        if (cancelled) return;
        setViewerCount(ack.viewerCount ?? 0);
        if (ack.maxViewers) setMaxViewers(roomCapacity(ack.maxViewers, capabilities?.maxViewers ?? ack.maxViewers));
        setRoomJoined(true);
        setError(null);
      } catch (joinError) {
        if (cancelled) return;
        // The scoped token can be stale after a server restart or a session
        // version bump; a fresh join envelope carries a new one.
        if (refreshesRef.current < MAX_SESSION_REFRESHES) {
          refreshesRef.current += 1;
          try {
            const { data } = await api.post(`/livestreams/${streamId}/join`);
            const parsed = parseSession(data?.session);
            if (cancelled) return;
            if (parsed) setSession(parsed);
            else setError('The broadcaster session could not be refreshed.');
          } catch (refreshError) {
            if (!cancelled) setError(errMsg(refreshError, 'The live connection could not be restored.'));
          }
        } else {
          setError(errMsg(joinError, 'The live connection failed.'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [socket, connected, session, phase, streamId, capabilities?.maxViewers]);

  // A camera or microphone that stops (unplugged, permission revoked, OS
  // suspended it) ends the broadcast rather than leaving viewers on a freeze.
  useEffect(() => {
    if (!media) return;
    const onEnded = () => {
      if (phaseRef.current === 'live') void endBroadcast('Your camera or microphone stopped, so the broadcast ended.');
      else releaseMedia();
    };
    const tracks = media.getTracks();
    tracks.forEach((t) => t.addEventListener('ended', onEnded));
    return () => tracks.forEach((t) => t.removeEventListener('ended', onEnded));
  }, [media, endBroadcast, releaseMedia]);

  // Hidden tab: desktop cameras keep flowing and the broadcast continues;
  // phones pause capture, and after a grace period a paused camera ends it.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (phaseRef.current !== 'live') return;
        if (backgroundTimer.current) clearTimeout(backgroundTimer.current);
        backgroundTimer.current = setTimeout(() => {
          backgroundTimer.current = null;
          const videoTracks = mediaRef.current?.getVideoTracks() ?? [];
          const paused = !videoTracks.length || videoTracks.some((t) => t.muted || t.readyState === 'ended');
          if (paused && phaseRef.current === 'live') {
            void endBroadcast('Your camera paused while this tab was in the background, so the broadcast ended.');
          }
        }, BACKGROUND_GRACE_MS);
      } else {
        if (backgroundTimer.current) {
          clearTimeout(backgroundTimer.current);
          backgroundTimer.current = null;
        }
        if (phaseRef.current === 'live') setNotice('Still live. Your broadcast kept running while this tab was in the background.');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (backgroundTimer.current) clearTimeout(backgroundTimer.current);
    };
  }, [endBroadcast]);

  // Closing the tab: warn first, then end cleanly on the way out.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (phaseRef.current !== 'live') return;
      event.preventDefault();
      // Older engines still require returnValue to be set for the prompt.
      event.returnValue = '';
    };
    const onPageHide = () => {
      if (phaseRef.current !== 'live') return;
      endLivestreamOnUnload(streamId);
      socket?.emit('livestream:leave', { streamId });
      stopMedia(mediaRef.current);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [streamId, socket]);

  // Leaving the page (route change) ends an abandoned broadcast, as the
  // mobile screen does on unmount.
  useEffect(() => () => {
    if (phaseRef.current === 'live' && !endingRef.current) {
      void api.put(`/livestreams/${streamId}/end`).catch(() => undefined);
      if (socket?.connected) void leaveLivestreamRoom(socket, streamId).catch(() => undefined);
    }
    peers.current.forEach((peer) => peer.close());
    peers.current.clear();
    pending.current.clear();
    stopMedia(mediaRef.current);
  }, [streamId, socket]);

  const toggleMute = () => {
    const next = !muted;
    mediaRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
  };

  const toggleCamera = () => {
    const next = !cameraOff;
    mediaRef.current?.getVideoTracks().forEach((t) => { t.enabled = !next; });
    setCameraOff(next);
  };

  return {
    socketConnected: connected,
    phase,
    media,
    capturing,
    mediaError,
    cameras,
    cameraId,
    session,
    roomJoined,
    viewerCount,
    maxViewers,
    viewers,
    muted,
    cameraOff,
    error,
    notice,
    endedStream,
    endedReason,
    capture,
    start,
    endBroadcast,
    toggleMute,
    toggleCamera,
    dismissNotice: () => setNotice(null),
    releaseMedia,
  };
}

function HostRoom({ stream, capabilities, refetch }: { stream: Stream; capabilities: LivestreamCapabilities | null; refetch: () => unknown }) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const myId = userIdOf(me);
  const online = useOnline();
  const { socket, connected } = useSharedSocket();
  const support = liveVideoSupport();
  const alreadyLive = stream.status === 'live';
  const host = useHostBroadcast({
    streamId: stream._id,
    resumeLive: alreadyLive,
    capabilities,
    streamCapacity: stream.settings?.maxViewers,
  });
  const chat = useLiveChat({ streamId: stream._id, stream: host.phase === 'live' ? { ...stream, status: 'live' } : stream, socket, connected, myId });
  const videoRef = useRef<HTMLVideoElement>(null);
  const { orientation } = useVideoStream(videoRef, host.media);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const closed = stream.status === 'ended' || stream.status === 'cancelled';
  const capacityCopy = capabilities?.enabled
    ? `This room supports up to ${host.maxViewers} simultaneous ${host.maxViewers === 1 ? 'viewer' : 'viewers'} and ends automatically after ${durationLabel(capabilities.maxBroadcastSeconds)}.`
    : null;

  if (host.phase === 'ended') {
    const summary = host.endedStream ?? stream;
    return (
      <div className="space-y-6">
        <PageHeader title={stream.title} subtitle="Broadcast ended" back="/live" hideSectionTabs />
        <Card className="space-y-5">
          <EmptyState
            icon={<Radio size={26} />}
            title="Broadcast ended"
            message={host.endedReason ?? 'Thanks for going live. Your viewers have been disconnected.'}
            size="sm"
          />
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-surface-2 p-3">
              <dt className="type-label text-text-2">Peak viewers</dt>
              <dd className="type-stat mt-1 text-2xl text-text-1">{formatStat(summary.peakViewers ?? 0)}</dd>
            </div>
            <div className="rounded-md bg-surface-2 p-3">
              <dt className="type-label text-text-2">Total views</dt>
              <dd className="type-stat mt-1 text-2xl text-text-1">{formatStat(summary.totalViews ?? 0)}</dd>
            </div>
            <div className="rounded-md bg-surface-2 p-3">
              <dt className="type-label text-text-2">Duration</dt>
              <dd className="type-stat mt-1 text-2xl text-text-1">{durationLabel(summary.duration ?? 0)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink to="/live" variant="primary">
              Back to Live
            </ButtonLink>
            <Button variant="secondary" onClick={() => refetch()}>
              View stream page
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (closed) {
    return (
      <div className="space-y-6">
        <PageHeader title={stream.title} subtitle={stream.status === 'cancelled' ? 'Cancelled' : `Ended ${ago(stream.endedAt)}`} back="/live" hideSectionTabs />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card>
            <EmptyState
              icon={<Radio size={26} />}
              title={stream.status === 'cancelled' ? 'This stream was cancelled' : 'This broadcast has ended'}
              message={stream.status === 'cancelled' ? 'It was removed from the schedule.' : `Peak audience ${formatStat(stream.peakViewers ?? 0)} · ${formatStat(stream.totalViews ?? 0)} total views.`}
              action={{ label: 'Back to Live', to: '/live' }}
            />
          </Card>
          <ChatPanel stream={stream} chat={chat} myId={myId} canModerate className="max-h-[70dvh]" />
        </div>
      </div>
    );
  }

  const isLive = host.phase === 'live' || host.phase === 'ending';
  const canGoLive = Boolean(host.media) && connected && online && Boolean(capabilities?.enabled) && support.ok && host.phase === 'setup';
  const startLabel = host.phase === 'starting' ? 'Starting securely…' : !connected ? 'Reconnecting…' : alreadyLive ? 'Resume broadcast' : 'Go live';

  return (
    <div className="space-y-6">
      <PageHeader
        title={stream.title}
        subtitle={isLive ? 'You are live' : alreadyLive ? 'Your broadcast is live on the server. Reconnect your camera to continue.' : 'Set up your camera, then go live.'}
        back="/live"
        hideSectionTabs
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="min-w-0 space-y-4" aria-label="Broadcast">
          <VideoStage
            videoRef={videoRef}
            hasVideo={Boolean(host.media) && !host.cameraOff}
            orientation={orientation}
            mirrored
            muted
            label="Your camera preview"
            placeholder={
              host.media && host.cameraOff ? (
                <>
                  <VideoOff size={40} className="text-text-2" />
                  <p className="text-sm font-semibold">Camera off</p>
                </>
              ) : (
                <>
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand-text">
                    <Camera size={28} />
                  </span>
                  <p className="max-w-sm text-sm text-text-2">
                    Your camera and microphone activate only when you enable them here. Video is always routed through Vybe’s authenticated relay.
                  </p>
                  <Button
                    variant="primary"
                    loading={host.capturing}
                    disabled={!support.ok}
                    onClick={() => void host.capture()}
                    icon={<Video size={18} />}
                  >
                    Enable camera and microphone
                  </Button>
                </>
              )
            }
          >
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center gap-2">
              {isLive ? <LivePill /> : <span className={PILL}>Preview</span>}
              {isLive ? <ViewerPill count={host.viewerCount} /> : null}
              {isLive ? (
                <span className="ml-auto">
                  <ConnectionPill ready={host.roomJoined && connected} />
                </span>
              ) : null}
            </div>
            {host.media ? (
              <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 bg-gradient-to-t from-bg/80 to-transparent px-3 pb-3 pt-8">
                <IconButton label={host.muted ? 'Unmute microphone' : 'Mute microphone'} variant="secondary" aria-pressed={host.muted} onClick={host.toggleMute}>
                  {host.muted ? <MicOff size={20} /> : <Mic size={20} />}
                </IconButton>
                <IconButton label={host.cameraOff ? 'Turn camera on' : 'Turn camera off'} variant="secondary" aria-pressed={host.cameraOff} onClick={host.toggleCamera}>
                  {host.cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
                </IconButton>
                {host.cameras.length > 1 ? (
                  <IconButton
                    label="Switch camera"
                    variant="secondary"
                    disabled={host.capturing || host.cameraOff}
                    onClick={() => {
                      const index = host.cameras.findIndex((c) => c.deviceId === host.cameraId);
                      const next = host.cameras[(index + 1) % host.cameras.length];
                      if (next) void host.capture(next.deviceId);
                    }}
                  >
                    <Refresh size={20} />
                  </IconButton>
                ) : null}
                {isLive ? (
                  <Button variant="danger" size="sm" loading={host.phase === 'ending'} onClick={() => setConfirmEnd(true)} icon={<X size={16} />}>
                    End stream
                  </Button>
                ) : null}
              </div>
            ) : null}
            <ReactionBurst reaction={chat.reaction} />
          </VideoStage>

          {!support.ok ? <Callout tone="warning" title="Live video is not available in this browser">{support.reason}</Callout> : null}
          {!online ? <Callout tone="warning" title="You’re offline">Your broadcast cannot reach viewers until the connection is back.</Callout> : null}
          {host.mediaError ? (
            <Callout
              tone="danger"
              title={host.mediaError.title}
              action={
                host.mediaError.retryable ? (
                  <Button variant="secondary" size="sm" loading={host.capturing} onClick={() => void host.capture()}>
                    Try again
                  </Button>
                ) : undefined
              }
            >
              {host.mediaError.message}
            </Callout>
          ) : null}
          {host.error ? <Callout tone="danger">{host.error}</Callout> : null}
          {host.notice ? (
            <Callout tone="info" action={<Button variant="ghost" size="sm" onClick={host.dismissNotice}>Dismiss</Button>}>
              {host.notice}
            </Callout>
          ) : null}
          {capabilities && !capabilities.enabled ? (
            <Callout tone="warning" title="Live video is switched off on this server">{capabilities.reason || 'The relay is configured by the server owner.'}</Callout>
          ) : null}

          {!isLive ? (
            <Card className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="type-heading text-lg text-text-1">{alreadyLive ? 'Reconnect to your broadcast' : 'Ready to go live?'}</h2>
                  {capacityCopy ? <p className="mt-1 text-sm text-text-2">{capacityCopy}</p> : null}
                  <p className="mt-1 text-sm text-text-2">Leaving this page ends the broadcast for everyone.</p>
                </div>
                {cameras(host)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" size="lg" disabled={!canGoLive} loading={host.phase === 'starting'} onClick={() => void host.start()} icon={<Radio size={18} />}>
                  {startLabel}
                </Button>
                {!host.media ? <span className="text-xs text-text-3">Enable your camera to continue.</span> : null}
                {host.media && !connected ? (
                  <span className="inline-flex items-center gap-2 text-xs text-text-3">
                    <Spinner size={14} />
                    Waiting for the live connection…
                  </span>
                ) : null}
              </div>
            </Card>
          ) : (
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="type-heading text-lg text-text-1">Your audience</h2>
                  <p className="text-sm text-text-2">
                    <span className="tabular font-semibold text-text-1">{host.viewerCount}</span> watching · room capacity {host.maxViewers}
                    {capabilities?.enabled ? ` · ends automatically after ${durationLabel(capabilities.maxBroadcastSeconds)}` : ''}
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 text-xs text-text-2">
                  <Heart size={14} filled={chat.liked} className={cx(chat.liked ? 'text-danger' : 'text-text-3', chat.heartClass)} />
                  <span className="tabular">{formatStat(chat.likeCount)}</span> likes
                </span>
              </div>
              {host.viewers.length ? (
                <ul className="flex flex-wrap gap-2" aria-label="Connected viewers">
                  {host.viewers.map((v) => (
                    <li key={v.socketId} className="inline-flex h-9 items-center gap-2 rounded-xs border border-line bg-surface-2 pl-1 pr-2.5 text-xs font-semibold text-text-1">
                      <Avatar src={v.avatar} name={v.name} size="xs" />
                      <span className="max-w-32 truncate">{v.name}</span>
                      <span
                        aria-label={v.state === 'connected' ? 'Connected' : v.state === 'failed' ? 'Connection failed' : 'Connecting'}
                        role="img"
                        className={cx('h-2 w-2 rounded-full', v.state === 'connected' ? 'bg-success' : v.state === 'failed' ? 'bg-danger' : 'bg-warning')}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-3">Nobody has joined yet. Share the stream from the Live tab.</p>
              )}
            </Card>
          )}

          {stream.description ? <p className="prose-measure whitespace-pre-wrap text-base text-text-1">{stream.description}</p> : null}
        </section>

        <ChatPanel stream={isLive ? { ...stream, status: 'live' } : stream} chat={chat} myId={myId} canModerate className="max-h-[70dvh] lg:sticky lg:top-20 lg:h-[calc(100dvh-8rem)]" />
      </div>

      <ConfirmDialog
        open={confirmEnd}
        title="End the broadcast?"
        description="This immediately ends the session for every viewer."
        confirmLabel="End stream"
        destructive
        loading={host.phase === 'ending'}
        onClose={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          void host.endBroadcast().then(() => navigate('/live/' + stream._id, { replace: true }));
        }}
      />
    </div>
  );
}

function cameras(host: ReturnType<typeof useHostBroadcast>) {
  if (!host.media || host.cameras.length < 2) return null;
  return (
    <Select
      label="Camera"
      hideLabel
      aria-label="Camera"
      containerClassName="w-full sm:w-56"
      value={host.cameraId}
      disabled={host.capturing}
      options={host.cameras.map((c) => ({ value: c.deviceId, label: c.label }))}
      onChange={(deviceId) => void host.capture(deviceId)}
    />
  );
}

/* ================================================================== viewer */

type ViewerPhase = 'idle' | 'joining' | 'connecting' | 'watching' | 'ended' | 'error';

const RETRY_DELAYS_MS = [1500, 3000, 6000, 10_000];

function useViewerSession({ streamId, stream }: { streamId: string; stream: Stream | null }) {
  const { socket, connected } = useSharedSocket();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<ViewerPhase>('idle');
  const [session, setSession] = useState<LivestreamSession | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [peerState, dispatch] = useReducer(reducePeerState, INITIAL_PEER_STATE);
  const [joinAttempt, setJoinAttempt] = useState(0);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const hostSocketRef = useRef<string | null>(null);
  const pending = useRef(new CandidateQueue());
  const budget = useRef(new SignalBudget());
  const sessionRef = useRef<LivestreamSession | null>(null);
  const phaseRef = useRef<ViewerPhase>('idle');
  const joinedRef = useRef(false);
  const leavingRef = useRef(false);
  const refreshesRef = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);

  useEffect(() => {
    sessionRef.current = session;
    phaseRef.current = phase;
  }, [session, phase]);

  useEffect(() => {
    if (stream) setViewerCount(viewersOf(stream));
  }, [stream]);

  const closePeer = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    hostSocketRef.current = null;
    pending.current.clear();
    setRemote(null);
  }, []);

  const guardedSend = useCallback(async (send: () => Promise<unknown>) => {
    const wait = budget.current.waitMs();
    if (wait > 0) await sleep(wait);
    budget.current.take();
    await send();
  }, []);

  /** REST join: registers the viewer and returns the scoped media session. */
  const join = useCallback(async () => {
    setPhase('joining');
    setError(null);
    try {
      const { data } = await api.post(`/livestreams/${streamId}/join`);
      const parsed = parseSession(data?.session);
      if (!parsed) throw new Error('The server did not return a viewer session.');
      if (!hasRelayServer(parsed.iceServers)) throw new Error('The video relay is not available right now.');
      joinedRef.current = true;
      refreshesRef.current = 0;
      if (data?.stream) {
        qc.setQueryData<StreamDetail | undefined>(['livestream', streamId], (old) => (old ? { ...old, stream: data.stream as Stream } : old));
      }
      setSession(parsed);
      setPhase('connecting');
      dispatch({ type: 'negotiate' });
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const message = errMsg(e, 'This live session is unavailable.');
      if (status === 409 && /not live|maximum duration/i.test(message)) {
        setEndedReason(null);
        setPhase('ended');
        dispatch({ type: 'end' });
        qc.invalidateQueries({ queryKey: ['livestream', streamId] });
        return;
      }
      setError(message);
      setPhase('error');
    }
  }, [streamId, qc]);

  const leave = useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    try {
      if (joinedRef.current) {
        if (socket?.connected) await leaveLivestreamRoom(socket, streamId).catch(() => undefined);
        await api.post(`/livestreams/${streamId}/leave`).catch(() => undefined);
      }
    } finally {
      joinedRef.current = false;
      closePeer();
      leavingRef.current = false;
    }
  }, [socket, streamId, closePeer]);

  const answerOffer = useCallback(async (fromSocketId: string, description: { type: 'offer'; sdp: string }) => {
    const activeSession = sessionRef.current;
    if (!socket || !activeSession) return;
    // Candidates can race ahead of the offer; keep the ones for this host.
    const early = pending.current.drain(fromSocketId);
    closePeer();
    early.forEach((c) => pending.current.push(fromSocketId, c));
    const peer = createPeer(activeSession.iceServers);
    peerRef.current = peer;
    hostSocketRef.current = fromSocketId;
    dispatch({ type: 'negotiate' });
    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON();
      void guardedSend(() => sendCandidate(socket, streamId, fromSocketId, candidate)).catch(() => undefined);
    };
    peer.ontrack = (event) => {
      const received = event.streams?.[0];
      if (received) {
        setRemote(received);
      } else if (event.track) {
        const assembled = new MediaStream();
        assembled.addTrack(event.track);
        setRemote(assembled);
      }
      dispatch({ type: 'track' });
      setPhase('watching');
    };
    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      dispatch({ type: 'connection', state });
      if (state === 'connected') {
        retriesRef.current = 0;
        setPhase('watching');
      } else if (state === 'failed') {
        // Re-join the room so the host receives 'viewer-ready' and re-offers.
        setPhase('connecting');
        const delay = RETRY_DELAYS_MS[Math.min(retriesRef.current, RETRY_DELAYS_MS.length - 1)];
        retriesRef.current += 1;
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => setJoinAttempt((n) => n + 1), delay);
      } else if (state === 'disconnected') {
        setPhase('connecting');
      }
    };
    await peer.setRemoteDescription(description);
    for (const candidate of pending.current.drain(fromSocketId)) {
      await peer.addIceCandidate(candidate as RTCIceCandidateInit).catch(() => undefined);
    }
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    if (!peer.localDescription) throw new Error('Could not answer the live video connection.');
    await guardedSend(() => sendDescription(socket, streamId, fromSocketId, peer.localDescription));
  }, [socket, streamId, closePeer, guardedSend]);

  const handleSignal = useCallback(async (signal: LivestreamSignal) => {
    if (signal.kind === 'offer') {
      await answerOffer(signal.fromSocketId, signal.description as { type: 'offer'; sdp: string });
      return;
    }
    if (signal.kind === 'candidate') {
      const peer = peerRef.current;
      if (peer && hostSocketRef.current === signal.fromSocketId && peer.remoteDescription) {
        await peer.addIceCandidate(signal.candidate as RTCIceCandidateInit).catch(() => undefined);
      } else {
        pending.current.push(signal.fromSocketId, signal.candidate as SignalCandidate);
      }
    }
  }, [answerOffer]);

  useEffect(() => {
    if (!socket) return;
    const onSignal = (payload: unknown) => {
      const signal = parseSignal(payload, streamId, 'viewer');
      if (signal) void handleSignal(signal).catch(() => dispatch({ type: 'fail', reason: 'The video connection could not be set up.' }));
    };
    const onPresence = (payload: unknown) => {
      const count = presenceCount(payload, streamId);
      if (count !== null) setViewerCount(count);
    };
    const onStatus = (payload: unknown) => {
      const status = parseStatus(payload, streamId);
      if (!status || status.status === 'live') return;
      closePeer();
      joinedRef.current = false;
      setEndedReason(status.reason === 'maximum-duration' ? 'This live session reached the server’s maximum duration.' : null);
      setPhase('ended');
      dispatch({ type: 'end' });
      qc.invalidateQueries({ queryKey: ['livestream', streamId] });
      qc.invalidateQueries({ queryKey: ['livestreams'] });
    };
    const onHostDisconnected = (payload: unknown) => {
      if (!isForStream(payload, streamId)) return;
      closePeer();
      dispatch({ type: 'peer-left' });
      if (phaseRef.current === 'watching') setPhase('connecting');
    };
    const onBanned = (payload: unknown) => {
      if (!isForStream(payload, streamId)) return;
      joinedRef.current = false;
      closePeer();
      setEndedReason('A room moderator removed you from this live session.');
      setPhase('ended');
      dispatch({ type: 'end', reason: 'banned' });
    };
    socket.on('livestream:signal', onSignal);
    socket.on('livestream:presence', onPresence);
    socket.on('livestream:status', onStatus);
    socket.on('livestream:host-disconnected', onHostDisconnected);
    socket.on('livestream:banned', onBanned);
    return () => {
      socket.off('livestream:signal', onSignal);
      socket.off('livestream:presence', onPresence);
      socket.off('livestream:status', onStatus);
      socket.off('livestream:host-disconnected', onHostDisconnected);
      socket.off('livestream:banned', onBanned);
    };
  }, [socket, streamId, handleSignal, closePeer, qc]);

  // Join the room whenever we have a session and a live socket: first time,
  // after every reconnect, and after a failed peer asks for a fresh offer.
  useEffect(() => {
    if (!socket || !connected || !session) return;
    if (phaseRef.current === 'ended' || phaseRef.current === 'error') return;
    let cancelled = false;
    (async () => {
      try {
        const ack = await joinLivestreamRoom(socket, streamId, session.token);
        if (cancelled) return;
        setViewerCount(ack.viewerCount ?? 0);
        setError(null);
      } catch (joinError) {
        if (cancelled) return;
        const message = errMsg(joinError, 'The live connection failed.');
        if (/full/i.test(message)) {
          setError(message);
          setPhase('error');
          return;
        }
        if (refreshesRef.current < MAX_SESSION_REFRESHES) {
          refreshesRef.current += 1;
          try {
            const { data } = await api.post(`/livestreams/${streamId}/join`);
            const parsed = parseSession(data?.session);
            if (cancelled) return;
            if (parsed) setSession(parsed);
            else throw new Error('The viewer session could not be refreshed.');
          } catch (refreshError) {
            if (cancelled) return;
            const status = (refreshError as { response?: { status?: number } })?.response?.status;
            if (status === 409) {
              setPhase('ended');
              dispatch({ type: 'end' });
            } else {
              setError(errMsg(refreshError, 'This live session is unavailable.'));
              setPhase('error');
            }
          }
        } else {
          setError(message);
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [socket, connected, session, streamId, joinAttempt]);

  // Closing the tab: tell the server we are gone so the seat frees up.
  useEffect(() => {
    const onPageHide = () => {
      if (!joinedRef.current) return;
      socket?.emit('livestream:leave', { streamId });
      leaveLivestreamOnUnload(streamId);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [socket, streamId]);

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (joinedRef.current && !leavingRef.current) {
      void api.post(`/livestreams/${streamId}/leave`).catch(() => undefined);
      if (socket?.connected) void leaveLivestreamRoom(socket, streamId).catch(() => undefined);
    }
    peerRef.current?.close();
    peerRef.current = null;
  }, [socket, streamId]);

  const retry = useCallback(() => {
    retriesRef.current = 0;
    refreshesRef.current = 0;
    closePeer();
    dispatch({ type: 'reset' });
    void join();
  }, [closePeer, join]);

  return { socketConnected: connected, phase, peerState, remote, viewerCount, error, endedReason, join, leave, retry };
}

function ViewerRoom({ stream, refetch }: { stream: Stream; refetch: () => unknown }) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const myId = userIdOf(me);
  const online = useOnline();
  const { socket, connected } = useSharedSocket();
  const support = liveVideoSupport();
  const viewer = useViewerSession({ streamId: stream._id, stream });
  const chat = useLiveChat({ streamId: stream._id, stream, socket, connected, myId });
  const videoRef = useRef<HTMLVideoElement>(null);
  const { orientation, blocked, play } = useVideoStream(videoRef, viewer.remote);
  const [muted, setMuted] = useState(true);
  const host = hostOf(stream);
  const isLive = stream.status === 'live' && viewer.phase !== 'ended';

  // Join once the stream is confirmed live; a stream that starts while the
  // page is open joins as soon as the detail refresh reports it.
  useEffect(() => {
    if (stream.status === 'live' && viewer.phase === 'idle' && support.ok) void viewer.join();
    // viewer.join is stable per streamId; phase gates the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.status, viewer.phase, support.ok]);

  const leaveRoom = () => {
    void viewer.leave().finally(() => navigate('/live', { viewTransition: true }));
  };

  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
    if (!next) play();
  };

  const fullscreen = () => {
    const el = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!el) return;
    if (typeof el.requestFullscreen === 'function') void el.requestFullscreen().catch(() => undefined);
    else el.webkitEnterFullscreen?.();
  };

  const header = (
    <PageHeader
      title={stream.title}
      subtitle={`Hosted by ${hostName(stream)}`}
      back="/live"
      hideSectionTabs
    />
  );

  if (stream.status === 'scheduled') {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <EmptyState
            icon={<CalendarDays size={26} />}
            title={`Starts ${at(stream.scheduledAt) || 'soon'}`}
            message="This session has not started yet. Come back when the host goes live."
            action={{ label: 'Check again', onClick: () => void refetch(), icon: <Refresh size={18} /> }}
            secondaryAction={{ label: 'Back to Live', to: '/live' }}
          />
        </Card>
        {stream.description ? <p className="prose-measure whitespace-pre-wrap text-base text-text-1">{stream.description}</p> : null}
      </div>
    );
  }

  if (stream.status === 'cancelled' || stream.status === 'ended' || viewer.phase === 'ended') {
    const cancelled = stream.status === 'cancelled';
    return (
      <div className="space-y-6">
        {header}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card>
            <EmptyState
              icon={<Radio size={26} />}
              title={cancelled ? 'This stream was cancelled' : 'Live session ended'}
              message={viewer.endedReason ?? (cancelled ? 'It was removed from the schedule.' : 'Thanks for watching. Replays are not available for live sessions.')}
              action={{ label: 'Back to Live', to: '/live' }}
              secondaryAction={host?._id ? { label: `More from ${hostName(stream)}`, to: `/u/${host._id}` } : undefined}
            />
          </Card>
          <ChatPanel stream={{ ...stream, status: cancelled ? 'cancelled' : 'ended' }} chat={chat} myId={myId} canModerate={false} className="max-h-[70dvh]" />
        </div>
      </div>
    );
  }

  const connecting = viewer.phase === 'joining' || viewer.phase === 'connecting' || (viewer.phase === 'watching' && !viewer.remote);
  const failed = viewer.phase === 'error' || viewer.peerState.phase === 'failed';
  const statusCopy = viewer.peerState.reconnecting
    ? 'Broadcaster is reconnecting…'
    : viewer.phase === 'joining'
      ? 'Joining the room…'
      : !connected
        ? 'Waiting for the live connection…'
        : 'Connecting secure video…';

  return (
    <div className="space-y-6">
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="min-w-0 space-y-4" aria-label="Live video">
          <VideoStage
            videoRef={videoRef}
            hasVideo={Boolean(viewer.remote)}
            orientation={orientation}
            muted={muted}
            label={`Live video from ${hostName(stream)}`}
            placeholder={
              failed ? (
                <>
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-soft text-danger">
                    <VideoOff size={26} />
                  </span>
                  <p className="text-md font-semibold">Couldn’t connect to the video</p>
                  <p className="max-w-sm text-sm text-text-2">{viewer.error ?? viewer.peerState.reason ?? 'The relay did not answer. Try again in a moment.'}</p>
                  <Button variant="primary" onClick={viewer.retry} icon={<Refresh size={18} />}>
                    Try again
                  </Button>
                </>
              ) : !support.ok ? (
                <>
                  <VideoOff size={40} className="text-text-2" />
                  <p className="max-w-sm text-sm text-text-2">{support.reason}</p>
                </>
              ) : (
                <>
                  <Spinner size={28} className="text-brand" />
                  <p className="text-sm font-semibold" role="status">
                    {statusCopy}
                  </p>
                </>
              )
            }
          >
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center gap-2">
              <LivePill />
              <ViewerPill count={viewer.viewerCount} />
              {viewer.remote ? (
                <span className="ml-auto">
                  <ConnectionPill ready={viewer.peerState.phase === 'live' && connected} />
                </span>
              ) : null}
            </div>
            {viewer.remote && (muted || blocked) ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Button variant="primary" size="lg" onClick={toggleMuted} icon={<Volume size={20} />} className="shadow-2">
                  {blocked ? 'Tap to play' : 'Tap to unmute'}
                </Button>
              </div>
            ) : null}
            {viewer.remote ? (
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-bg/80 to-transparent px-3 pb-3 pt-8">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{stream.title}</p>
                  <p className="truncate text-xs text-text-2">{hostName(stream)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <IconButton label={muted ? 'Unmute' : 'Mute'} variant="secondary" aria-pressed={!muted} onClick={toggleMuted}>
                    {muted ? <VolumeOff size={20} /> : <Volume size={20} />}
                  </IconButton>
                  <IconButton label="Full screen" variant="secondary" onClick={fullscreen}>
                    <Maximize size={20} />
                  </IconButton>
                </div>
              </div>
            ) : null}
            <ReactionBurst reaction={chat.reaction} />
          </VideoStage>

          {!online ? <Callout tone="warning" title="You’re offline">The video will resume when your connection is back.</Callout> : null}
          {!connected && isLive && online && !failed ? <Callout tone="info">Reconnecting to the live server…</Callout> : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            {host?._id ? (
              <Link to={`/u/${host._id}`} viewTransition className="flex min-w-0 items-center gap-2.5 rounded-sm">
                <Avatar src={host.avatar} name={hostName(stream)} size="md" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-text-1">{hostName(stream)}</span>
                  <span className="block truncate text-xs text-text-2">{stream.settings?.maxViewers ? `${stream.settings.maxViewers}-viewer room` : 'Live now'}</span>
                </span>
              </Link>
            ) : (
              <div className="flex items-center gap-2.5">
                <Avatar name={hostName(stream)} size="md" />
                <span className="text-sm font-semibold text-text-1">{hostName(stream)}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={chat.liked ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={chat.liked}
                disabled={chat.like.isPending}
                onClick={() => chat.like.mutate()}
                icon={<Heart size={18} filled={chat.liked} className={chat.heartClass} />}
              >
                <span className="tabular">{formatStat(chat.likeCount)}</span>
              </Button>
              {giftsAllowed(stream) ? (
                <Button variant="secondary" size="sm" disabled={chat.cheer.isPending} onClick={() => chat.cheer.mutate()} icon={<Sparkles size={18} />}>
                  Cheer
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={leaveRoom} icon={<X size={16} />}>
                Leave
              </Button>
            </div>
          </div>

          {stream.description ? <p className="prose-measure whitespace-pre-wrap text-base text-text-1">{stream.description}</p> : null}
          {stream.tags?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {stream.tags.map((t) => (
                <Badge key={t} tone="brand">
                  #{t}
                </Badge>
              ))}
            </div>
          ) : null}
          {connecting && !failed ? <p className="sr-only" role="status">{statusCopy}</p> : null}
        </section>

        <ChatPanel stream={stream} chat={chat} myId={myId} canModerate={false} className="max-h-[70dvh] lg:sticky lg:top-20 lg:h-[calc(100dvh-8rem)]" />
      </div>
    </div>
  );
}

/* ================================================================== room */

function RoomSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading stream">
      <PageHeader title="Live" back="/live" hideSectionTabs />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <div className="-mx-4 md:mx-0">
            <Skeleton className="aspect-video w-full rounded-none md:rounded-lg" />
          </div>
          <SkeletonRow />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}

/**
 * /live/:streamId — the broadcaster sees their own control room, everyone
 * else the viewer experience. Rendered only when the server reports a live
 * relay; the disabled explanation lives in the list page.
 */
export default function LiveRoom({ streamId }: { streamId: string }) {
  const me = useAuth((s) => s.user);
  const myId = userIdOf(me);
  const [liveHint, setLiveHint] = useState(false);
  const detail = useStreamDetail(streamId, liveHint);
  const stream = detail.data?.stream;

  useEffect(() => {
    setLiveHint(stream?.status === 'live');
  }, [stream?.status]);

  if (detail.isLoading) return <RoomSkeleton />;

  if (detail.isError || !stream) {
    const status = (detail.error as { response?: { status?: number } } | undefined)?.response?.status;
    return (
      <div className="space-y-6">
        <PageHeader title="Live" back="/live" hideSectionTabs />
        <ErrorState
          error={detail.error}
          title={status === 404 ? 'This stream is unavailable' : 'This stream could not be loaded'}
          message={status === 404 ? 'It may have been removed, or you may not have access to it.' : undefined}
          onRetry={() => detail.refetch()}
          action={
            status === 404 ? (
              <ButtonLink to="/live" variant="primary">
                Back to Live
              </ButtonLink>
            ) : undefined
          }
        />
      </div>
    );
  }

  const isHost = Boolean(myId) && hostId(stream) === myId;
  return isHost ? (
    <HostRoom stream={stream} capabilities={detail.data?.capabilities ?? null} refetch={() => detail.refetch()} />
  ) : (
    <ViewerRoom stream={stream} refetch={() => detail.refetch()} />
  );
}
