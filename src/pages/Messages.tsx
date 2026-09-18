import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, differenceInMinutes, format, isSameDay, isThisYear, isToday, isYesterday } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../lib/auth';
import { uploadImage, type UploadedMedia } from '../lib/hooks';
import {
  ACCEPTED_TYPES,
  ACCEPTED_TYPES_LABEL,
  EMPTY_HISTORY,
  TYPING_TTL_MS,
  absorbEarlierPage,
  absorbNewestPage,
  applyReadReceipts,
  consentCopy,
  consentErrorUser,
  idOf,
  isConsentError,
  mergeThread,
  roomIdOfMessage,
  toThreadPage,
  typingExpired,
  typingLabel,
  typingStarted,
  typingStopped,
  type ReadReceiptPayload,
  type ThreadHistory,
  type ThreadPage as ThreadPageOf,
  type TypingState,
} from '../lib/chat';
import { linkifySegments } from '../lib/linkify';
import PeopleSearch, { PersonRow, personName as nameOf, rememberPerson, usePeopleSearch, type Person } from './PeopleSearch';
import {
  Avatar,
  AvatarStack,
  Button,
  Callout,
  Chip,
  ConfirmDialog,
  CountBadge,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Menu,
  Modal,
  PageHeader,
  SegmentedControl,
  Skeleton,
  SkeletonRow,
  Spinner,
  Textarea,
  buttonClass,
  cx,
  useIsCompact,
  useIsTouch,
  useMediaQuery,
  useOnline,
  usePageChrome,
  useToast,
} from './ui';
import type { MenuItem } from './ui';
import {
  ArrowDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit,
  ExternalLink,
  Image as ImageIcon,
  Inbox,
  LogOut,
  Search,
  Send,
  Trash,
  User as UserIcon,
  UserPlus,
  Users,
  Video as VideoIcon,
  X,
} from './icons';

/* ================================================================== types */

type ChatUser = Person;

type MessageMedia = { uri: string; type: string; width?: number; height?: number };

type SharedPost = {
  _id: string;
  content?: string;
  author?: ChatUser;
  medias?: { url?: string; key?: string; type?: string }[];
};

type ChatRoom = {
  _id: string;
  isGroup?: boolean;
  roomName?: string;
  roomAvatar?: string;
  participants?: ChatUser[];
  createdBy?: ChatUser | string;
  lastMessage?: {
    _id?: string;
    text?: string;
    createdAt?: string;
    sender?: ChatUser | string;
    media?: MessageMedia[];
  } | null;
  totalUnread?: number;
  updatedAt?: string;
  lastActivity?: string;
  displayInfo?: {
    name?: string;
    avatar?: string;
    username?: string;
    isGroup?: boolean;
    otherUser?: ChatUser;
  };
};

type ChatMessage = {
  _id: string;
  text?: string;
  createdAt?: string;
  sender?: ChatUser | string;
  receivers?: ChatUser[];
  chatRoom?: string | { _id: string };
  readers?: string[];
  media?: MessageMedia[];
  sharedPost?: SharedPost | string | null;
  isForwarded?: boolean;
  isGroup?: boolean;
  targetId?: string;
};

/** The newest page of a thread, oldest → newest, plus the cursor for older history. */
type ThreadPage = ThreadPageOf<ChatMessage>;

/** A message that has left the composer but not yet been confirmed by the API. */
type OutboxItem = {
  tempId: string;
  text: string;
  media: UploadedMedia[];
  createdAt: string;
  status: 'sending' | 'failed';
  error?: string;
  /** A consent refusal: retrying cannot help, only a friend request can. */
  final?: boolean;
};

type Attachment = {
  localId: string;
  file: File;
  previewUrl: string;
  kind: 'image' | 'video';
  status: 'uploading' | 'ready' | 'failed';
  uploaded?: UploadedMedia;
  error?: string;
};

/** What the thread pane is showing: a real room, or a DM that has no room yet. */
type ThreadTarget = { kind: 'room'; room: ChatRoom } | { kind: 'draft'; peer: ChatUser };

const DRAFT_ROOM_ID = 'new';
const MAX_ATTACHMENTS = 6;
const MAX_TEXT = 2000;
const GROUP_WINDOW_MINUTES = 5;
/** Messages per history page; older ones load as you scroll up. */
const PAGE_SIZE = 50;
const MAX_BYTES = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024 } as const;

/* ================================================================== helpers */

const userOf = (v: unknown): ChatUser | undefined => (v && typeof v === 'object' ? (v as ChatUser) : undefined);

const isGroupRoom = (room: ChatRoom): boolean => Boolean(room.isGroup || room.displayInfo?.isGroup);

const peerOf = (room: ChatRoom, meId?: string): ChatUser | undefined =>
  room.displayInfo?.otherUser || room.participants?.find((p) => p._id !== meId);

const roomTitle = (room: ChatRoom, meId?: string): string => {
  if (room.roomName) return room.roomName;
  if (room.displayInfo?.name) return room.displayInfo.name;
  if (!isGroupRoom(room)) return nameOf(peerOf(room, meId));
  const names = (room.participants || []).filter((p) => p._id !== meId).map((p) => nameOf(p)).filter(Boolean);
  return names.length ? names.join(', ') : 'Group chat';
};

const roomAvatarSrc = (room: ChatRoom, meId?: string): string =>
  room.roomAvatar || room.displayInfo?.avatar || (!isGroupRoom(room) ? peerOf(room, meId)?.avatar || '' : '');

const mediaLabel = (media?: MessageMedia[] | UploadedMedia[]): string => {
  if (!media?.length) return '';
  if (media.length > 1) return `${media.length} attachments`;
  return media[0].type === 'video' ? 'Video' : 'Photo';
};

const previewOf = (room: ChatRoom, meId?: string): string => {
  const lm = room.lastMessage;
  if (!lm) return 'No messages yet';
  const senderId = idOf(lm.sender);
  const sender = userOf(lm.sender);
  const prefix = senderId && senderId === meId ? 'You: ' : isGroupRoom(room) && sender ? `${sender.fullName?.split(' ')[0] || sender.username}: ` : '';
  if (lm.text) return `${prefix}${lm.text}`;
  const label = mediaLabel(lm.media);
  return label ? `${prefix}${label}` : 'No messages yet';
};

const parseDate = (iso?: string): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Room-list timestamp: time today, weekday this week, date otherwise. */
const listTime = (iso?: string): string => {
  const d = parseDate(iso);
  if (!d) return '';
  if (isToday(d)) return format(d, 'p');
  if (isYesterday(d)) return 'Yesterday';
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, 'EEE');
  return isThisYear(d) ? format(d, 'd MMM') : format(d, 'd MMM yyyy');
};

const clockTime = (iso?: string): string => {
  const d = parseDate(iso);
  return d ? format(d, 'p') : '';
};

const fullTime = (iso?: string): string => {
  const d = parseDate(iso);
  if (!d) return '';
  if (isToday(d)) return `Today at ${format(d, 'p')}`;
  if (isYesterday(d)) return `Yesterday at ${format(d, 'p')}`;
  return format(d, isThisYear(d) ? "EEE d MMM 'at' p" : "d MMM yyyy 'at' p");
};

const dayLabel = (d: Date): string => {
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, 'EEEE');
  return format(d, isThisYear(d) ? 'EEEE d MMMM' : 'd MMMM yyyy');
};

const isDirectRoomWith = (room: ChatRoom, userId: string, meId?: string): boolean => {
  if (isGroupRoom(room)) return false;
  if (room.displayInfo?.otherUser?._id === userId) return true;
  const others = (room.participants || []).filter((p) => p._id !== meId);
  return others.length === 1 && others[0]._id === userId;
};

let tempCounter = 0;
const tempId = () => `tmp-${Date.now()}-${++tempCounter}`;

/** The socket's typing payload (utils/socketServer.js forwardPresenceEvent). */
type TypingPayload = { chatRoomId?: string; isGroup?: boolean; senderId?: string; userId?: string; sender?: string; senderName?: string };

/* ================================================================== realtime */

type SocketHandlers = {
  onMessage: (m: ChatMessage) => void;
  onDeleted: (messageId: string) => void;
  onRoomUpdate: () => void;
  onRead: (payload: ReadReceiptPayload) => void;
  onTyping: (payload: TypingPayload, active: boolean) => void;
  onReconnect: () => void;
};

function useChatSocket(handlers: SocketHandlers) {
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    // The app-wide socket (lib/socket.ts) is shared with Live and the shell;
    // this page only adds its own listeners and removes exactly those on
    // unmount. Realtime is an enhancement: with no socket the page stays
    // fully usable over HTTP.
    const socket = getSocket();
    if (!socket) return;
    // If the socket is already up, the next 'connect' is a reconnect and the
    // room list must be refreshed for anything missed while it was down.
    let everConnected = socket.connected;
    setConnected(socket.connected);
    const onConnect = () => {
      setConnected(true);
      if (everConnected) ref.current.onReconnect();
      everConnected = true;
    };
    const onDown = () => setConnected(false);
    const onMessage = (payload: ChatMessage) => ref.current.onMessage(payload);
    const onDeleted = (payload: { messageId?: string }) => payload?.messageId && ref.current.onDeleted(String(payload.messageId));
    const onRooms = () => ref.current.onRoomUpdate();
    const onRead = (payload: ReadReceiptPayload) => ref.current.onRead(payload || {});
    const onTyping = (payload: TypingPayload) => ref.current.onTyping(payload || {}, true);
    const onStopTyping = (payload: TypingPayload) => ref.current.onTyping(payload || {}, false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDown);
    socket.on('connect_error', onDown);
    socket.on('message', onMessage);
    socket.on('newMessage', onMessage);
    socket.on('messageDeleted', onDeleted);
    socket.on('chatRoomUpdate', onRooms);
    socket.on('newGroupChat', onRooms);
    socket.on('messageRead', onRead);
    socket.on('typing', onTyping);
    socket.on('stop_typing', onStopTyping);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDown);
      socket.off('connect_error', onDown);
      socket.off('message', onMessage);
      socket.off('newMessage', onMessage);
      socket.off('messageDeleted', onDeleted);
      socket.off('chatRoomUpdate', onRooms);
      socket.off('newGroupChat', onRooms);
      socket.off('messageRead', onRead);
      socket.off('typing', onTyping);
      socket.off('stop_typing', onStopTyping);
    };
  }, []);

  return connected;
}

/** Tell the room I am typing (throttled) and when I stop. */
function emitTyping(roomId: string, isGroup: boolean, active: boolean) {
  const socket = getSocket();
  if (!socket?.connected) return;
  socket.emit(active ? 'typing' : 'stop_typing', { chatRoomId: roomId, isGroup });
}

/* ================================================================== pane height */

/**
 * The split view fills the viewport under the shell chrome. The chrome above
 * differs per breakpoint (mobile top bar + safe area, hub tabs, desktop bar)
 * so the top edge is measured; the bottom is the shell's main padding.
 */
function usePaneHeight(enabled: boolean, bottom: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      setTop(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY));
      setTop((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled]);

  const style = enabled && top !== null ? { height: `calc(100dvh - ${top}px - ${bottom})` } : undefined;
  return { ref, style };
}

/* ================================================================== long press */

function useLongPress(onLongPress: () => void, enabled: boolean, delay = 450) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  if (!enabled) return {};

  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse') return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        clear();
        onLongPress();
      }, delay);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!start.current) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: ReactMouseEvent) => {
      // Touch browsers fire contextmenu for long presses; we own that gesture.
      e.preventDefault();
    },
    onClickCapture: (e: ReactMouseEvent) => {
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}

/* ================================================================== room avatar */

function RoomAvatar({ room, meId, size = 48, presence = false }: { room: ChatRoom; meId?: string; size?: number; presence?: boolean }) {
  const src = roomAvatarSrc(room, meId);
  const online = presence && !isGroupRoom(room) && peerOf(room, meId)?.isOnline === true;
  const avatar =
    src || !isGroupRoom(room) ? (
      <Avatar src={src} name={roomTitle(room, meId)} size={size} />
    ) : (
      <span className="inline-flex items-center justify-center rounded-full bg-surface-3 text-text-2" style={{ width: size, height: size }} role="img" aria-label={roomTitle(room, meId)}>
        <Users size={Math.round(size * 0.5)} />
      </span>
    );
  if (!online) return avatar;
  return (
    <span className="relative inline-flex shrink-0">
      {avatar}
      <span role="img" aria-label="Active now" title="Active now" className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface-1 bg-success" />
    </span>
  );
}

/* ================================================================== room list */

function RoomRow({ room, meId, active, compact, typing }: { room: ChatRoom; meId?: string; active: boolean; compact: boolean; typing: string }) {
  const unread = room.totalUnread || 0;
  const title = roomTitle(room, meId);
  const stamp = listTime(room.lastMessage?.createdAt || room.lastActivity || room.updatedAt);
  return (
    <li>
      <Link
        to={`/messages/${room._id}`}
        viewTransition
        aria-current={active ? 'page' : undefined}
        className={cx(
          'flex min-h-[4.5rem] items-center gap-3 rounded-md px-3 py-2.5 transition-colors dur-1',
          active ? 'bg-brand-soft' : 'hover:bg-surface-2 active:bg-surface-2',
          compact && 'px-2',
        )}
      >
        <RoomAvatar room={room} meId={meId} size={48} presence />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={cx('truncate text-base text-text-1', unread ? 'font-semibold' : 'font-medium')}>{title}</span>
            {stamp ? (
              <time dateTime={room.lastMessage?.createdAt || room.updatedAt} className={cx('tabular shrink-0 text-2xs', unread ? 'font-semibold text-brand-text' : 'text-text-3')}>
                {stamp}
              </time>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-3">
            {typing ? (
              <span className="truncate text-sm font-medium italic text-brand-text">{typing}…</span>
            ) : (
              <span className={cx('truncate text-sm', unread ? 'font-medium text-text-1' : 'text-text-2')}>{previewOf(room, meId)}</span>
            )}
            {unread ? <CountBadge value={unread} className="ring-0" /> : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

function RoomList({
  rooms,
  meId,
  activeId,
  compact,
  typing,
  onNewMessage,
  onOpenWith,
}: {
  rooms: ReturnType<typeof useRoomsQuery>;
  meId?: string;
  activeId: string | null;
  compact: boolean;
  typing: TypingState;
  onNewMessage: () => void;
  onOpenWith: (user: ChatUser) => void;
}) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  // The same typeahead query as every other people surface (debounced, aborted, cached).
  const people = usePeopleSearch(search);

  const list = useMemo(() => {
    const all = rooms.data || [];
    if (!q) return all;
    return all.filter((r) => {
      const peer = peerOf(r, meId);
      return roomTitle(r, meId).toLowerCase().includes(q) || (peer?.username || '').toLowerCase().includes(q);
    });
  }, [rooms.data, q, meId]);

  const peopleWithoutRooms = useMemo(() => {
    const all = rooms.data || [];
    return (people.data || []).filter((u) => u._id !== meId && !all.some((r) => isDirectRoomWith(r, u._id, meId)));
  }, [people.data, rooms.data, meId]);

  // The socket carries the sender's username; the row shows their name.
  const typingIn = (room: ChatRoom) =>
    typingLabel(
      (typing[room._id] || [])
        .filter((u) => u.id !== meId)
        .map((u) => ({ name: nameOf(room.participants?.find((p) => p._id === u.id), u.name) })),
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cx('shrink-0', compact ? 'pb-3' : 'border-b border-line p-3')}>
        <Input
          type="search"
          inputMode="search"
          autoComplete="off"
          label="Search conversations"
          hideLabel
          placeholder="Search people and chats"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leading={<Search size={18} />}
          className="[&::-webkit-search-cancel-button]:hidden"
          trailing={
            search ? (
              <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="inline-flex h-9 w-9 items-center justify-center rounded-xs text-text-2 hover:bg-surface-3 hover:text-text-1">
                <X size={16} />
              </button>
            ) : undefined
          }
        />
      </div>

      <nav aria-label="Conversations" className={cx('min-h-0 flex-1', compact ? '' : 'overflow-y-auto p-2')}>
        {rooms.isLoading ? (
          <ul className="space-y-1" aria-busy="true" aria-label="Loading conversations">
            {Array.from({ length: 7 }).map((_, i) => (
              <li key={i} className="px-2">
                <SkeletonRow className="min-h-[4.5rem]" />
              </li>
            ))}
          </ul>
        ) : rooms.isError ? (
          <ErrorState error={rooms.error} title="Couldn’t load your chats" onRetry={() => rooms.refetch()} />
        ) : list.length === 0 && !q ? (
          <EmptyState
            title="No conversations yet"
            message="Message a friend or start a group — training is better together."
            action={{ label: 'New message', onClick: onNewMessage, icon: <Edit size={18} /> }}
            secondaryAction={{ label: 'Find friends', to: '/friends' }}
          />
        ) : (
          <>
            {list.length ? (
              <ul className="space-y-0.5">
                {list.map((room) => (
                  <RoomRow key={room._id} room={room} meId={meId} active={room._id === activeId} compact={compact} typing={typingIn(room)} />
                ))}
              </ul>
            ) : null}

            {q.length >= 1 ? (
              <section aria-label="People" className={cx('mt-2', list.length > 0 && 'border-t border-line pt-3')}>
                <h2 className="type-label px-3 pb-1 text-text-3">People</h2>
                {people.isLoading ? (
                  <ul aria-busy="true">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <li key={i} className="px-3">
                        <SkeletonRow />
                      </li>
                    ))}
                  </ul>
                ) : people.isError ? (
                  <p className="px-3 py-2 text-sm text-text-2">
                    Couldn’t search people.{' '}
                    <button type="button" onClick={() => people.refetch()} className="font-semibold text-brand-text hover:underline">
                      Retry
                    </button>
                  </p>
                ) : peopleWithoutRooms.length ? (
                  <ul className="space-y-0.5">
                    {peopleWithoutRooms.map((u) => (
                      <PersonRow
                        key={u._id}
                        user={u}
                        onClick={() => onOpenWith(u)}
                        trailing={
                          u.canMessage === false ? (
                            <span className="shrink-0 text-xs font-medium text-text-3">Friends only</span>
                          ) : (
                            <span className="shrink-0 text-xs font-semibold text-brand-text">Message</span>
                          )
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-2 text-sm text-text-2">{list.length ? 'No one else matches.' : `No one on Vybe matches “${search.trim()}”.`}</p>
                )}
              </section>
            ) : null}
          </>
        )}
      </nav>
    </div>
  );
}

function useRoomsQuery() {
  return useQuery({
    queryKey: ['chatRooms'],
    queryFn: async () => {
      const { data } = await api.get('/messages/me/all/recent/rooms', { params: { status: 'active', limit: 50 } });
      return (data.chatRooms || []) as ChatRoom[];
    },
    refetchInterval: 60_000,
  });
}

/* ================================================================== new message picker */

type PickerMode = 'direct' | 'group';

function useFriendsList(enabled: boolean) {
  return useQuery({
    queryKey: ['friends', 'list'],
    enabled,
    // Reopening the picker must show a friend accepted a moment ago on
    // another page or device, not the 30 s-old copy.
    staleTime: 0,
    queryFn: async () => {
      const { data } = await api.get('/friends/list');
      return (data.friends || []) as ChatUser[];
    },
  });
}

function NewMessageModal({
  open,
  onClose,
  meId,
  onOpenWith,
}: {
  open: boolean;
  onClose: () => void;
  meId?: string;
  onOpenWith: (user: ChatUser) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState<PickerMode>('direct');
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<ChatUser[]>([]);

  useEffect(() => {
    if (!open) {
      setMode('direct');
      setName('');
      setSearch('');
      setPicked([]);
    }
  }, [open]);

  // Enabled only while open with staleTime 0: TanStack fetches once each time
  // the picker opens, so a friend accepted a moment ago is already listed.
  const friends = useFriendsList(open);

  const pickedIds = useMemo(() => new Set(picked.map((p) => p._id)), [picked]);
  const excludeIds = useMemo(() => new Set(meId ? [meId] : []), [meId]);

  const toggle = (u: ChatUser) => setPicked((prev) => (prev.some((p) => p._id === u._id) ? prev.filter((p) => p._id !== u._id) : [...prev, u]));

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/messages/create-group', {
        participants: picked.map((p) => p._id),
        roomName: name.trim(),
      });
      return data as { chatRoom?: { _id?: string } };
    },
    onSuccess: (data) => {
      toast.success('Group created');
      picked.forEach(rememberPerson);
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      onClose();
      if (data.chatRoom?._id) navigate(`/messages/${data.chatRoom._id}`, { viewTransition: true });
    },
    // The API names the member who does not accept messages from you.
    onError: (e) => toast.error(e, 'Could not create the group'),
  });

  const nameOk = name.trim().length >= 1 && name.trim().length <= 100;
  const valid = nameOk && picked.length >= 2;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New message"
      description={mode === 'direct' ? 'Pick someone to chat with.' : 'Pick at least two people and name the group.'}
      size="sm"
      footer={
        mode === 'group' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>
              Create group
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <SegmentedControl
          aria-label="Conversation type"
          fill
          tabs={[
            { key: 'direct', label: 'Direct message', icon: <UserIcon size={16} /> },
            { key: 'group', label: 'Group', icon: <Users size={16} /> },
          ]}
          active={mode}
          onChange={(k) => setMode(k as PickerMode)}
        />

        {mode === 'group' ? (
          <Input label="Group name" placeholder="Saturday long run crew" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} hint={`${picked.length} of 2+ people selected`} />
        ) : null}

        {mode === 'group' && picked.length ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Selected people">
            {picked.map((u) => (
              <Chip key={u._id} selected onRemove={() => toggle(u)} removeLabel={`Remove ${nameOf(u)}`}>
                {nameOf(u)}
              </Chip>
            ))}
          </div>
        ) : null}

        <PeopleSearch
          key={mode}
          query={search}
          onQueryChange={setSearch}
          mode={mode === 'group' ? 'multi' : 'single'}
          selectedIds={pickedIds}
          excludeIds={excludeIds}
          emptyList={friends.data}
          emptyHeading="Friends"
          emptyListLoading={friends.isLoading}
          emptyListError={friends.isError ? friends.error : undefined}
          onRetryEmptyList={() => friends.refetch()}
          emptyState={
            <EmptyState
              size="sm"
              title="No friends yet"
              message="Search anyone on Vybe above, or add friends so they show up here."
              action={{ label: 'Find friends', to: '/friends', variant: 'secondary' }}
            />
          }
          label="Search people"
          placeholder="Search by name or @username"
          autoFocus
          listClassName="max-h-[50dvh] md:max-h-80"
          onPick={(u) => (mode === 'group' ? toggle(u) : onOpenWith(u))}
        />
      </div>
    </Modal>
  );
}

/* ================================================================== group modals */

function MembersModal({
  open,
  onClose,
  room,
  meId,
  onAddPeople,
  onLeave,
}: {
  open: boolean;
  onClose: () => void;
  room: ChatRoom;
  meId?: string;
  onAddPeople: () => void;
  onLeave: () => void;
}) {
  const members = room.participants || [];
  const creatorId = idOf(room.createdBy);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={roomTitle(room, meId)}
      description={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
      size="sm"
      footer={
        <>
          <Button variant="danger" icon={<LogOut size={18} />} onClick={onLeave}>
            Leave group
          </Button>
          <Button variant="primary" icon={<UserPlus size={18} />} onClick={onAddPeople}>
            Add people
          </Button>
        </>
      }
    >
      {members.length ? (
        <ul className="-mx-1 space-y-0.5">
          {members.map((u) => (
            <li key={u._id}>
              <Link to={u._id === meId ? '/profile' : `/u/${u._id}`} viewTransition onClick={onClose} className="flex min-h-14 items-center gap-3 rounded-md px-3 py-2 transition-colors dur-1 hover:bg-surface-2">
                <Avatar src={u.avatar} name={nameOf(u)} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-text-1">
                    {nameOf(u)}
                    {u._id === meId ? <span className="ml-1.5 text-xs font-medium text-text-3">(you)</span> : null}
                    {creatorId && u._id === creatorId ? <span className="ml-1.5 text-xs font-medium text-text-3">· created the group</span> : null}
                  </span>
                  {u.username ? <span className="block truncate text-xs text-text-2">@{u.username}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-2">Member details aren’t available for this group.</p>
      )}
    </Modal>
  );
}

function RenameGroupModal({ open, onClose, room, meId }: { open: boolean; onClose: () => void; room: ChatRoom; meId?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(room.roomName || roomTitle(room, meId));
  useEffect(() => {
    if (open) setName(room.roomName || roomTitle(room, meId));
  }, [open, room.roomName, room, meId]);

  const rename = useMutation({
    mutationFn: async (roomName: string) => {
      const { data } = await api.patch(`/messages/rooms/${room._id}`, { roomName });
      return data as { chatRoom?: ChatRoom };
    },
    onMutate: async (roomName) => {
      // Optimistic: header and list row rename at once; the server copy replaces it.
      const previous = qc.getQueryData<ChatRoom[]>(['chatRooms']);
      qc.setQueryData<ChatRoom[]>(['chatRooms'], (rooms) => rooms?.map((r) => (r._id === room._id ? { ...r, roomName, displayInfo: { ...r.displayInfo, name: roomName } } : r)));
      return { previous };
    },
    onSuccess: (data) => {
      toast.success('Group renamed');
      if (data.chatRoom) {
        qc.setQueryData<ChatRoom[]>(['chatRooms'], (rooms) => rooms?.map((r) => (r._id === room._id ? { ...r, ...data.chatRoom, totalUnread: r.totalUnread, displayInfo: { ...r.displayInfo, name: data.chatRoom?.roomName, avatar: data.chatRoom?.roomAvatar } } : r)));
        qc.setQueryData(['chatRoom', room._id], data.chatRoom);
      }
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      onClose();
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(['chatRooms'], ctx.previous);
      toast.error(e, 'Could not rename the group');
    },
  });

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 100 && trimmed !== (room.roomName || '');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename group"
      description="Everyone in the group sees the new name."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="rename-group-form" disabled={!valid} loading={rename.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="rename-group-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) rename.mutate(trimmed);
        }}
      >
        <Input label="Group name" value={name} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} hint={`${trimmed.length}/100`} error={name.length > 0 && !trimmed ? 'Give the group a name.' : undefined} />
      </form>
    </Modal>
  );
}

function AddPeopleModal({ open, onClose, room, meId }: { open: boolean; onClose: () => void; room: ChatRoom; meId?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<ChatUser[]>([]);
  useEffect(() => {
    if (!open) {
      setSearch('');
      setPicked([]);
    }
  }, [open]);
  const friends = useFriendsList(open);
  const memberIds = useMemo(() => new Set([...(room.participants || []).map((p) => p._id), ...(meId ? [meId] : [])]), [room.participants, meId]);
  const pickedIds = useMemo(() => new Set(picked.map((p) => p._id)), [picked]);
  const toggle = (u: ChatUser) => setPicked((prev) => (prev.some((p) => p._id === u._id) ? prev.filter((p) => p._id !== u._id) : [...prev, u]));

  const add = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/messages/rooms/${room._id}/participants`, { participants: picked.map((p) => p._id) });
      return data as { chatRoom?: ChatRoom; added?: string[] };
    },
    onSuccess: (data) => {
      const n = data.added?.length || picked.length;
      toast.success(n === 1 ? `${nameOf(picked[0])} added to the group` : `${n} people added to the group`);
      if (data.chatRoom) {
        qc.setQueryData<ChatRoom[]>(['chatRooms'], (rooms) => rooms?.map((r) => (r._id === room._id ? { ...r, participants: data.chatRoom?.participants } : r)));
        qc.setQueryData(['chatRoom', room._id], data.chatRoom);
      }
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      onClose();
    },
    onError: (e) => toast.error(e, 'Could not add people'),
  });

  const room100 = (room.participants?.length || 0) + picked.length > 100;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add people"
      description={`${room.participants?.length ?? 0} in the group now.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!picked.length || room100} loading={add.isPending} onClick={() => add.mutate()}>
            {picked.length ? `Add ${picked.length}` : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {picked.length ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Selected people">
            {picked.map((u) => (
              <Chip key={u._id} selected onRemove={() => toggle(u)} removeLabel={`Remove ${nameOf(u)}`}>
                {nameOf(u)}
              </Chip>
            ))}
          </div>
        ) : null}
        {room100 ? <Callout tone="warning">Group chats hold at most 100 people.</Callout> : null}
        <PeopleSearch
          query={search}
          onQueryChange={setSearch}
          mode="multi"
          selectedIds={pickedIds}
          excludeIds={memberIds}
          emptyList={friends.data}
          emptyHeading="Friends not in the group"
          emptyListLoading={friends.isLoading}
          emptyListError={friends.isError ? friends.error : undefined}
          onRetryEmptyList={() => friends.refetch()}
          emptyState={<p className="px-3 py-6 text-center text-sm text-text-2">All your friends are already here. Search anyone on Vybe above.</p>}
          label="Search people to add"
          placeholder="Search by name or @username"
          autoFocus
          listClassName="max-h-[45dvh] md:max-h-72"
          onPick={toggle}
        />
      </div>
    </Modal>
  );
}

/* ================================================================== bubbles */

type GroupItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'group'; key: string; mine: boolean; sender?: ChatUser; senderId: string; messages: ChatMessage[] }
  | { kind: 'outbox'; key: string; item: OutboxItem };

function buildTimeline(messages: ChatMessage[], outbox: OutboxItem[], meId?: string): GroupItem[] {
  const items: GroupItem[] = [];
  let lastDate: Date | null = null;
  let current: Extract<GroupItem, { kind: 'group' }> | null = null;
  let lastAt: Date | null = null;

  for (const m of messages) {
    const at = parseDate(m.createdAt);
    if (at && (!lastDate || !isSameDay(at, lastDate))) {
      items.push({ kind: 'day', key: `day-${at.toDateString()}`, label: dayLabel(at) });
      lastDate = at;
      current = null;
    }
    const senderId = idOf(m.sender);
    const within = current && lastAt && at ? Math.abs(differenceInMinutes(at, lastAt)) < GROUP_WINDOW_MINUTES : false;
    if (current && current.senderId === senderId && within) {
      current.messages.push(m);
    } else {
      current = { kind: 'group', key: `g-${m._id}`, mine: !!meId && senderId === meId, sender: userOf(m.sender), senderId, messages: [m] };
      items.push(current);
    }
    lastAt = at ?? lastAt;
  }
  for (const o of outbox) {
    const at = parseDate(o.createdAt);
    if (at && (!lastDate || !isSameDay(at, lastDate))) {
      items.push({ kind: 'day', key: `day-${at.toDateString()}`, label: dayLabel(at) });
      lastDate = at;
    }
    items.push({ kind: 'outbox', key: o.tempId, item: o });
  }
  return items;
}

/** Message text with URLs as links; vybeapp.fit links stay in the app. */
function LinkedText({ text, className }: { text: string; className?: string }) {
  const segments = useMemo(() => linkifySegments(text, new Set(['vybeapp.fit', 'www.vybeapp.fit', window.location.hostname.toLowerCase()])), [text]);
  return (
    <p className={className}>
      {segments.map((s, i) =>
        s.kind === 'text' ? (
          <span key={i}>{s.text}</span>
        ) : s.internal ? (
          <Link key={i} to={s.internal} viewTransition className="font-medium text-brand-text underline decoration-brand/50 underline-offset-2 hover:decoration-brand" onClick={(e) => e.stopPropagation()}>
            {s.text}
          </Link>
        ) : (
          <a key={i} href={s.href} target="_blank" rel="noreferrer noopener" className="font-medium text-brand-text underline decoration-brand/50 underline-offset-2 hover:decoration-brand" onClick={(e) => e.stopPropagation()}>
            {s.text}
          </a>
        ),
      )}
    </p>
  );
}

function MediaGrid({ media, mine, onOpen }: { media: MessageMedia[]; mine: boolean; onOpen?: (index: number) => void }) {
  return (
    <div className={cx('grid gap-1', media.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
      {media.map((att, i) => {
        const url = mediaUrl(att.uri);
        return att.type === 'video' ? (
          <video key={`${att.uri}-${i}`} src={url} controls preload="metadata" playsInline className="max-h-72 w-full rounded-md bg-surface-3 object-cover" onClick={(e) => e.stopPropagation()} />
        ) : (
          <button
            key={`${att.uri}-${i}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen?.(i);
            }}
            className="block w-full overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label={mine ? 'Open your photo' : 'Open photo'}
          >
            <img src={url} alt="" loading="lazy" className={cx('w-full bg-surface-3 object-cover', media.length > 1 ? 'aspect-square' : 'max-h-72')} />
          </button>
        );
      })}
    </div>
  );
}

/** Full-screen viewer for message photos and videos: arrows, Escape, save the original. */
function MediaLightbox({ items, index, onClose, onIndex }: { items: MessageMedia[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const item = items[index];
  const many = items.length > 1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && many) onIndex((index + 1) % items.length);
      else if (e.key === 'ArrowLeft' && many) onIndex((index - 1 + items.length) % items.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, many, onIndex]);
  if (!item) return null;
  const url = mediaUrl(item.uri);
  return (
    <Modal open onClose={onClose} title={many ? `${item.type === 'video' ? 'Video' : 'Photo'} ${index + 1} of ${items.length}` : item.type === 'video' ? 'Video' : 'Photo'} size="xl" presentation="dialog" bodyClassName="px-0 pb-0 sm:px-0">
      <div className="relative flex min-h-[40dvh] items-center justify-center bg-[#08111b]">
        {item.type === 'video' ? (
          <video src={url} controls autoPlay playsInline className="max-h-[75dvh] w-full object-contain" />
        ) : (
          <img src={url} alt="" className="max-h-[75dvh] w-full object-contain" />
        )}
        {many ? (
          <>
            <IconButton label="Previous" variant="secondary" className="absolute left-3 top-1/2 -translate-y-1/2 shadow-2" onClick={() => onIndex((index - 1 + items.length) % items.length)}>
              <ChevronLeft size={22} />
            </IconButton>
            <IconButton label="Next" variant="secondary" className="absolute right-3 top-1/2 -translate-y-1/2 shadow-2" onClick={() => onIndex((index + 1) % items.length)}>
              <ChevronRight size={22} />
            </IconButton>
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 sm:px-5">
        {many ? (
          <ol className="flex gap-1.5" aria-label="Attachments">
            {items.map((_, i) => (
              <li key={i}>
                <button type="button" aria-label={`Show attachment ${i + 1}`} aria-current={i === index ? 'true' : undefined} onClick={() => onIndex(i)} className={cx('block h-2 w-2 rounded-full transition-colors dur-1', i === index ? 'bg-brand' : 'bg-line-strong hover:bg-text-3')} />
              </li>
            ))}
          </ol>
        ) : (
          <span />
        )}
        <a href={url} target="_blank" rel="noreferrer noopener" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
          <ExternalLink size={16} />
          Open original
        </a>
      </div>
    </Modal>
  );
}

function SharedPostCard({ post }: { post: SharedPost }) {
  const thumb = post.medias?.[0];
  const src = thumb ? mediaUrl(thumb.url || thumb.key) : '';
  return (
    <Link to={`/p/${post._id}`} viewTransition className="mt-1 flex items-center gap-3 rounded-md border border-line bg-surface-1 p-2 pr-3 transition-colors dur-1 hover:bg-surface-2">
      {src ? <img src={src} alt="" className="h-14 w-14 shrink-0 rounded-xs object-cover" /> : <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xs bg-surface-3 text-text-3"><ImageIcon size={22} /></span>}
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-text-2">{post.author ? `Post by ${nameOf(post.author)}` : 'Shared post'}</span>
        <span className="line-clamp-2 text-sm text-text-1">{post.content || 'Open the post'}</span>
      </span>
    </Link>
  );
}

function Bubble({
  message,
  mine,
  first,
  last,
  fresh,
  onDelete,
  onOpenMedia,
}: {
  message: ChatMessage;
  mine: boolean;
  first: boolean;
  last: boolean;
  fresh: boolean;
  onDelete?: (id: string, mine: boolean) => void;
  onOpenMedia: (media: MessageMedia[], index: number) => void;
}) {
  const toast = useToast();
  const touch = useIsTouch();
  const [revealed, setRevealed] = useState(false);
  const [sheet, setSheet] = useState(false);
  const shared = message.sharedPost && typeof message.sharedPost === 'object' ? (message.sharedPost as SharedPost) : null;
  const hasText = !!message.text;

  const copyText = async () => {
    if (!message.text) return;
    try {
      await navigator.clipboard.writeText(message.text);
      toast.success('Copied');
    } catch {
      toast.error(null, 'Couldn’t copy — select the text instead');
    }
  };

  const menuItems: MenuItem[] = [
    ...(hasText ? [{ label: 'Copy text', icon: <Copy size={18} />, onSelect: () => void copyText() } as MenuItem] : []),
    ...(onDelete
      ? [
          {
            label: mine ? 'Delete' : 'Delete for me',
            description: mine ? 'Removes it for everyone' : 'Removes it from your conversation only',
            icon: <Trash size={18} />,
            onSelect: () => onDelete(message._id, mine),
            danger: true,
            divider: hasText,
          } as MenuItem,
        ]
      : []),
  ];

  const press = useLongPress(() => setSheet(true), touch && menuItems.length > 0);

  const radius = cx(
    'rounded-lg',
    mine ? (!first && 'rounded-tr-xs') : (!first && 'rounded-tl-xs'),
    mine ? (!last && 'rounded-br-xs') : (!last && 'rounded-bl-xs'),
  );

  return (
    <div className={cx('group/bubble flex w-full items-end gap-1.5', mine ? 'flex-row-reverse' : 'flex-row', fresh && 'anim-pop-in')}>
      <div className={cx('flex max-w-[min(32rem,82%)] flex-col', mine ? 'items-end' : 'items-start')}>
        <div
          {...press}
          onClick={() => setRevealed((v) => !v)}
          className={cx(
            'select-text px-3.5 py-2 text-base leading-6 text-text-1 [overflow-wrap:anywhere] whitespace-pre-wrap transition-colors dur-1',
            mine ? 'bg-brand-soft' : 'bg-surface-2',
            radius,
            (!!message.media?.length || !!shared) && 'w-64 max-w-full sm:w-80',
            touch && 'touch-manipulation',
          )}
        >
          {message.media?.length ? <MediaGrid media={message.media} mine={mine} onOpen={(i) => onOpenMedia(message.media || [], i)} /> : null}
          {message.text ? <LinkedText text={message.text} className={cx(!!message.media?.length && 'mt-2')} /> : null}
          {shared ? <SharedPostCard post={shared} /> : null}
        </div>
        <span
          className={cx(
            'tabular overflow-hidden text-2xs text-text-3 transition-[max-height,opacity,margin] dur-2 ease-out',
            revealed || last ? 'mt-1 max-h-5 opacity-100' : 'mt-0 max-h-0 opacity-0 group-hover/bubble:mt-1 group-hover/bubble:max-h-5 group-hover/bubble:opacity-100 group-focus-within/bubble:mt-1 group-focus-within/bubble:max-h-5 group-focus-within/bubble:opacity-100',
          )}
          aria-hidden={!revealed && !last}
        >
          <time dateTime={message.createdAt}>{last ? clockTime(message.createdAt) : fullTime(message.createdAt)}</time>
          {message.isForwarded ? ' · Forwarded' : ''}
        </span>
      </div>

      {menuItems.length && !touch ? (
        <Menu
          label="Message options"
          size={40}
          align={mine ? 'end' : 'start'}
          items={menuItems}
          className="mb-5 shrink-0 opacity-0 transition-opacity dur-1 group-hover/bubble:opacity-100 focus-within:opacity-100"
        />
      ) : null}

      {touch ? (
        <Modal open={sheet} onClose={() => setSheet(false)} title="Message" description={fullTime(message.createdAt)} size="sm" presentation="sheet">
          <ul className="-mx-1 space-y-0.5">
            {menuItems.map((it, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    setSheet(false);
                    it.onSelect?.();
                  }}
                  className={cx('flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-base font-medium transition-colors dur-1 hover:bg-surface-2', it.danger ? 'text-danger' : 'text-text-1')}
                >
                  <span className={it.danger ? 'text-danger' : 'text-text-2'}>{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    {it.label}
                    {it.description ? <span className="block text-xs font-normal text-text-3">{it.description}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </div>
  );
}

function OutboxBubble({ item, onRetry, onDiscard }: { item: OutboxItem; onRetry: () => void; onDiscard: () => void }) {
  return (
    <div className="flex w-full flex-row-reverse items-end gap-1.5 anim-pop-in">
      <div className="flex max-w-[min(32rem,82%)] flex-col items-end">
        <div className={cx('rounded-lg px-3.5 py-2 text-base leading-6 text-text-1 [overflow-wrap:anywhere] whitespace-pre-wrap', item.status === 'failed' ? 'bg-danger-soft' : 'bg-brand-soft opacity-80', item.media.length > 0 && 'w-64 max-w-full sm:w-80')}>
          {item.media.length ? <MediaGrid media={item.media.map((m) => ({ uri: m.url || m.key, type: m.type }))} mine /> : null}
          {item.text ? <p className={cx(item.media.length > 0 && 'mt-2')}>{item.text}</p> : null}
        </div>
        <span className="mt-1 flex items-center gap-2 text-2xs text-text-3">
          {item.status === 'sending' ? (
            <>
              <Spinner size={12} /> Sending…
            </>
          ) : (
            <>
              <span className="font-semibold text-danger">{item.final ? 'Not delivered' : item.error || 'Not sent'}</span>
              {!item.final ? (
                <button type="button" onClick={onRetry} className="min-h-6 font-semibold text-brand-text hover:underline">
                  Retry
                </button>
              ) : null}
              <button type="button" onClick={onDiscard} className="min-h-6 font-semibold text-text-2 hover:underline">
                Discard
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/** Three animated dots while the other side types. */
function TypingBubble({ users, isGroup }: { users: Array<{ id: string; name: string; avatar?: string }>; isGroup: boolean }) {
  const label = typingLabel(users);
  if (!label) return null;
  return (
    <li className="flex items-end gap-2 anim-pop-in" aria-live="polite">
      <span className="mb-5 shrink-0">
        <Avatar src={users[0]?.avatar} name={users[0]?.name} size={28} />
      </span>
      <div className="flex flex-col items-start gap-0.5">
        {isGroup ? <span className="px-1 text-xs font-semibold text-text-2">{users.map((u) => u.name.split(' ')[0]).join(', ')}</span> : null}
        <div className="inline-flex h-10 items-center gap-1 rounded-lg rounded-bl-xs bg-surface-2 px-3.5" role="img" aria-label={`${label}…`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="typing-dot h-2 w-2 rounded-full bg-text-3" style={{ animationDelay: `${i * 160}ms` }} />
          ))}
        </div>
      </div>
    </li>
  );
}

/**
 * Shown instead of the composer when the other person only accepts messages
 * from friends. Offers the one action that can change that.
 */
function ConsentCallout({ peer, onChanged }: { peer: ChatUser; onChanged: (status: string, canMessage?: boolean) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState(peer.friendStatus || 'none');
  const copy = consentCopy(nameOf(peer), status);

  const addFriend = useMutation({
    mutationFn: async () => {
      await api.post('/friends/send', { receiverId: peer._id });
    },
    onSuccess: () => {
      setStatus('requested');
      onChanged('requested');
      toast.success('Friend request sent');
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['user', peer._id] });
    },
    onError: (e) => toast.error(e, 'Could not send the friend request'),
  });
  const accept = useMutation({
    mutationFn: async () => {
      if (peer.friendRequestId) await api.post(`/friends/requests/${peer.friendRequestId}/accept`);
      else throw new Error('Open the request from your Friends page.');
    },
    onSuccess: () => {
      setStatus('friends');
      onChanged('friends', true);
      toast.success(`You and ${nameOf(peer).split(' ')[0]} are now friends`);
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['user', peer._id] });
    },
    onError: (e) => toast.error(e, 'Could not accept the request'),
  });

  return (
    <div className="shrink-0 border-t border-line bg-surface-1 p-3">
      <Callout
        tone="brand"
        title={copy.title}
        icon={<UserPlus size={20} className="text-brand-text" />}
        action={
          copy.cta === 'add' ? (
            <Button variant="primary" size="sm" icon={<UserPlus size={16} />} loading={addFriend.isPending} onClick={() => addFriend.mutate()}>
              Add friend
            </Button>
          ) : copy.cta === 'accept' ? (
            <Button variant="primary" size="sm" icon={<Check size={16} />} loading={accept.isPending} onClick={() => accept.mutate()}>
              Accept request
            </Button>
          ) : copy.cta === 'requested' ? (
            <Button variant="secondary" size="sm" disabled>
              Requested
            </Button>
          ) : null
        }
      >
        {copy.body}{' '}
        <Link to={`/u/${peer._id}`} viewTransition className="font-semibold text-brand-text hover:underline">
          View profile
        </Link>
      </Callout>
    </div>
  );
}

/* ================================================================== composer */

function Composer({
  disabled,
  offline,
  placeholder,
  onSend,
  onTyping,
  focusKey,
}: {
  disabled?: boolean;
  offline: boolean;
  placeholder: string;
  onSend: (text: string, media: UploadedMedia[]) => void;
  onTyping?: (active: boolean) => void;
  focusKey: string;
}) {
  const toast = useToast();
  const touch = useIsTouch();
  const compact = useIsCompact();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const typingRef = useRef(false);
  const idleTimer = useRef<number | null>(null);
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;

  const stopTyping = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (typingRef.current) {
      typingRef.current = false;
      onTypingRef.current?.(false);
    }
  }, []);

  const noteTyping = (value: string) => {
    if (!onTypingRef.current) return;
    if (!value.trim()) {
      stopTyping();
      return;
    }
    if (!typingRef.current) {
      typingRef.current = true;
      onTypingRef.current(true);
    }
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    // Two quiet seconds mean "stopped typing"; the server side expires it too.
    idleTimer.current = window.setTimeout(stopTyping, 2000);
  };

  // Focus the composer when a thread opens on desktop (phones would summon the keyboard).
  useEffect(() => {
    if (compact || touch) return;
    const t = window.setTimeout(() => wrapRef.current?.querySelector('textarea')?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(t);
  }, [focusKey, compact, touch]);

  useEffect(
    () => () => {
      attachmentsRef.current.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      stopTyping();
    },
    [stopTyping],
  );

  const update = (localId: string, patch: Partial<Attachment>) => setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)));

  const upload = async (a: Attachment) => {
    update(a.localId, { status: 'uploading', error: undefined });
    try {
      const uploaded = await uploadImage(a.file, 'posts');
      update(a.localId, { status: 'ready', uploaded });
    } catch (e) {
      update(a.localId, { status: 'failed', error: errMsg(e, 'Upload failed') });
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      toast.info(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    const next: Attachment[] = [];
    for (const file of Array.from(files).slice(0, room)) {
      const kind = ACCEPTED_TYPES[file.type];
      if (!kind) {
        toast.error(null, `${file.name}: use ${ACCEPTED_TYPES_LABEL}.`);
        continue;
      }
      if (file.size > MAX_BYTES[kind]) {
        toast.error(null, `${file.name} is too large (max ${kind === 'video' ? '50' : '10'} MB).`);
        continue;
      }
      next.push({ localId: tempId(), file, previewUrl: URL.createObjectURL(file), kind, status: 'uploading' });
    }
    if (!next.length) return;
    setAttachments((prev) => [...prev, ...next]);
    next.forEach((a) => void upload(a));
  };

  const remove = (localId: string) => {
    setAttachments((prev) => {
      const gone = prev.find((a) => a.localId === localId);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((a) => a.localId !== localId);
    });
  };

  const trimmed = text.trim();
  const uploading = attachments.some((a) => a.status === 'uploading');
  const failed = attachments.some((a) => a.status === 'failed');
  const ready = attachments.filter((a) => a.status === 'ready' && a.uploaded).map((a) => a.uploaded as UploadedMedia);
  const overLimit = text.length > MAX_TEXT;
  const canSend = !disabled && !offline && !uploading && !failed && !overLimit && (trimmed.length > 0 || ready.length > 0);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    stopTyping();
    onSend(trimmed, ready);
    setText('');
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setAttachments([]);
    wrapRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (touch) return; // phones: Enter inserts a newline, the button sends
    e.preventDefault();
    submit();
  };

  const remaining = MAX_TEXT - text.length;

  return (
    <form onSubmit={submit} className={cx('shrink-0 border-t border-line bg-surface-1 px-2 pt-2', compact ? 'safe-bottom pb-2' : 'pb-2')} aria-label="Write a message">
      {offline ? (
        <Callout tone="warning" className="mb-2 py-2.5">
          You’re offline — sending resumes when you reconnect.
        </Callout>
      ) : null}

      {attachments.length ? (
        <ul className="mb-2 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Attachments">
          {attachments.map((a) => (
            <li key={a.localId} className="relative shrink-0">
              <div className={cx('h-16 w-16 overflow-hidden rounded-md bg-surface-3', a.status === 'failed' && 'ring-2 ring-danger')}>
                {a.kind === 'video' ? (
                  <span className="inline-flex h-full w-full items-center justify-center text-text-2">
                    <VideoIcon size={22} />
                  </span>
                ) : (
                  <img src={a.previewUrl} alt="" className="h-full w-full object-cover" />
                )}
                {a.status === 'uploading' ? (
                  <span className="absolute inset-0 inline-flex items-center justify-center bg-scrim text-text-1" aria-label="Uploading">
                    <Spinner size={18} className="text-bg dark:text-text-1" />
                  </span>
                ) : null}
                {a.status === 'failed' ? (
                  <button type="button" onClick={() => void upload(a)} className="absolute inset-0 inline-flex items-center justify-center bg-scrim text-2xs font-semibold text-bg dark:text-text-1" title={a.error}>
                    Retry
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                aria-label={`Remove ${a.kind}`}
                onClick={() => remove(a.localId)}
                className="absolute -right-1.5 -top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-1 text-text-2 shadow-1 hover:text-text-1"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div ref={wrapRef} className="flex items-end gap-1">
        <input
          ref={fileRef}
          type="file"
          accept={Object.keys(ACCEPTED_TYPES).join(',')}
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <IconButton label="Add photo or video" size={44} onClick={() => fileRef.current?.click()} disabled={disabled || attachments.length >= MAX_ATTACHMENTS}>
          <ImageIcon size={22} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <Textarea
            label="Message"
            hideLabel
            rows={1}
            autoGrow
            maxRows={6}
            value={text}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              noteTyping(e.target.value);
            }}
            onBlur={stopTyping}
            onKeyDown={onKeyDown}
            aria-invalid={overLimit || undefined}
            enterKeyHint={touch ? 'enter' : 'send'}
            className="py-2.5"
            style={{ minHeight: touch ? 48 : 44 }}
          />
        </div>
        <IconButton
          type="submit"
          label="Send"
          size={44}
          variant="primary"
          disabled={!canSend}
          className="transition-transform dur-1 active:scale-95 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-3"
        >
          <Send size={20} />
        </IconButton>
      </div>
      {remaining < 200 ? (
        <p className={cx('tabular px-12 pt-1 text-2xs', overLimit ? 'font-semibold text-danger' : 'text-text-3')} role={overLimit ? 'alert' : undefined}>
          {overLimit ? `${Math.abs(remaining)} characters over the limit` : `${remaining} characters left`}
        </p>
      ) : null}
    </form>
  );
}

/* ================================================================== thread */

function Thread({
  target,
  meId,
  incoming,
  deletedIds,
  receipt,
  typing,
  connected,
  compact,
  onSent,
  onDeleted,
  onArchived,
  onLeft,
}: {
  target: ThreadTarget;
  meId?: string;
  incoming: ChatMessage[];
  deletedIds: Set<string>;
  receipt: { seq: number; payload: ReadReceiptPayload } | null;
  typing: TypingState;
  connected: boolean;
  compact: boolean;
  onSent: (message: ChatMessage, room?: ChatRoom) => void;
  onDeleted: (id: string) => void;
  onArchived: (room: ChatRoom) => void;
  onLeft: (room: ChatRoom) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const online = useOnline();
  const room = target.kind === 'room' ? target.room : null;
  const isGroup = room ? isGroupRoom(room) : false;
  const peer = target.kind === 'draft' ? target.peer : room ? peerOf(room, meId) : undefined;
  const title = room ? roomTitle(room, meId) : nameOf(peer);
  const threadKey = room ? room._id : `draft-${peer?._id}`;
  const conversationPath = room && (isGroup || !peer?._id) ? `/messages/conversation/${room._id}` : `/messages/conversation/${peer?._id}`;
  const conversationParams = room && (isGroup || !peer?._id) ? { isGroup: 'true' } : {};

  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; mine: boolean } | null>(null);
  const [members, setMembers] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [lightbox, setLightbox] = useState<{ items: MessageMedia[]; index: number } | null>(null);
  const [unseen, setUnseen] = useState(0);
  // Every message fetched for this thread so far (older pages plus each
  // newest page as it arrives) and the cursor to what lies before it.
  const [history, setHistory] = useState<ThreadHistory<ChatMessage>>(EMPTY_HISTORY);
  const [older, setOlder] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [consent, setConsent] = useState<{ blocked: boolean; friendStatus?: string }>(() => ({ blocked: peer?.canMessage === false, friendStatus: peer?.friendStatus }));

  // The draft header can mount from router state before GET /users/:id has
  // answered; the composer follows the consent flags once they arrive.
  useEffect(() => {
    if (peer?.canMessage === undefined && peer?.friendStatus === undefined) return;
    setConsent((c) => {
      const blocked = peer?.canMessage === undefined ? c.blocked : peer.canMessage === false;
      const friendStatus = peer?.friendStatus ?? c.friendStatus;
      return blocked === c.blocked && friendStatus === c.friendStatus ? c : { blocked, friendStatus };
    });
  }, [peer?.canMessage, peer?.friendStatus]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const atBottomRef = useRef(true);
  const firstPaintRef = useRef(true);
  const seenIdsRef = useRef<Set<string> | null>(null);
  const restoreRef = useRef<{ height: number; top: number; firstId: string } | null>(null);

  const thread = useQuery({
    queryKey: room ? ['thread', room._id] : ['thread', 'peer', peer?._id],
    queryFn: async () => {
      const { data } = await api.get(conversationPath, { params: { ...conversationParams, limit: PAGE_SIZE } });
      return toThreadPage<ChatMessage>(data);
    },
  });

  // The newest page is refetched after a send and on reconnect, and each time
  // its window slides forward. Folding every page into `history` means a
  // message that slid out of the window is still on screen (see absorbNewestPage).
  useEffect(() => {
    const page = thread.data;
    if (!page) return;
    setHistory((h) => absorbNewestPage(h, page));
  }, [thread.data]);

  // Older history, loaded on scroll-up with the compound (createdAt, id) cursor.
  const cursor = history.nextBefore;
  const cursorId = history.nextBeforeId;
  const hasMore = history.hasMore;
  const loadEarlier = useCallback(async () => {
    if (!cursor || older.loading) return;
    const el = scrollRef.current;
    const firstId = listRef.current?.querySelector<HTMLElement>('[data-message-id]')?.dataset.messageId || '';
    restoreRef.current = el ? { height: el.scrollHeight, top: el.scrollTop, firstId } : null;
    setOlder({ loading: true, error: null });
    try {
      const { data } = await api.get(conversationPath, {
        params: { ...conversationParams, limit: PAGE_SIZE, before: cursor, ...(cursorId ? { beforeId: cursorId } : {}) },
      });
      const page = toThreadPage<ChatMessage>(data);
      if (!page.messages.length) restoreRef.current = null;
      setHistory((h) => absorbEarlierPage(h, page));
      setOlder({ loading: false, error: null });
    } catch (e) {
      restoreRef.current = null;
      setOlder({ loading: false, error: errMsg(e, 'Could not load earlier messages') });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, cursorId, older.loading, conversationPath]);

  // Keep the reader's place when older messages are prepended above. A newest
  // page folding in meanwhile (someone wrote) changes the height too, so only
  // act once the first message on screen is a different one.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const saved = restoreRef.current;
    if (!el || !saved) return;
    const firstNow = listRef.current?.querySelector<HTMLElement>('[data-message-id]')?.dataset.messageId || '';
    if (firstNow === saved.firstId) return;
    restoreRef.current = null;
    el.scrollTop = saved.top + (el.scrollHeight - saved.height);
  });

  useEffect(() => {
    const sentinel = topRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !hasMore || !thread.isSuccess) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadEarlier();
      },
      { root, rootMargin: '200px 0px 0px 0px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, thread.isSuccess, loadEarlier]);

  // Live receipts for the history held in component state (the newest page is patched in the query cache).
  useEffect(() => {
    if (!receipt) return;
    setHistory((h) => {
      const next = applyReadReceipts(h.messages, receipt.payload);
      return next === h.messages ? h : { ...h, messages: next };
    });
  }, [receipt]);

  // Fetched history + realtime deliveries for this room, minus anything deleted, oldest first.
  const merged = useMemo(
    () => mergeThread({ earlier: history.messages, latest: thread.data?.messages, incoming, deletedIds, roomId: room?._id ?? null }),
    [history.messages, thread.data?.messages, incoming, deletedIds, room?._id],
  );

  const timeline = useMemo(() => buildTimeline(merged, outbox, meId), [merged, outbox, meId]);

  // Which ids arrived after first paint (they get a small entrance).
  const freshIds = useMemo(() => {
    const prev = seenIdsRef.current;
    const next = new Set(merged.map((m) => m._id));
    const fresh = new Set<string>();
    if (prev) for (const id of next) if (!prev.has(id)) fresh.add(id);
    seenIdsRef.current = next;
    return fresh;
  }, [merged]);

  const typingUsers = useMemo(() => {
    if (!room) return [] as Array<{ id: string; name: string; avatar?: string }>;
    return (typing[room._id] || [])
      .filter((u) => u.id !== meId)
      .map((u) => {
        const member = room.participants?.find((p) => p._id === u.id);
        return { ...u, name: nameOf(member, u.name), avatar: member?.avatar };
      });
  }, [typing, room, meId]);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setUnseen(0);
  }, []);

  const newestId = merged.length ? merged[merged.length - 1]._id : '';
  useLayoutEffect(() => {
    if (!thread.isSuccess) return;
    if (firstPaintRef.current) {
      firstPaintRef.current = false;
      scrollToBottom(false);
      return;
    }
    const lastMsg = merged[merged.length - 1];
    const lastMine = lastMsg ? idOf(lastMsg.sender) === meId : false;
    if (atBottomRef.current || lastMine || outbox.length) scrollToBottom(true);
    else if (freshIds.size) setUnseen((n) => n + freshIds.size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, outbox.length, thread.isSuccess, typingUsers.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = gap < 80;
    if (atBottomRef.current && unseen) setUnseen(0);
  };

  // Media loading and the autogrowing composer change the content height after
  // paint; stay pinned to the newest message while the reader is at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !thread.isSuccess) return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current && !restoreRef.current) el.scrollTo({ top: el.scrollHeight });
    });
    ro.observe(el);
    // The list itself, not the first child: a 1 px sentinel sits above it.
    if (listRef.current) ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [thread.isSuccess, merged.length > 0]);

  /* --- read receipts (mine) --- */
  const markRead = useMutation({
    mutationFn: async (messageIds: string[]) => {
      await api.put('/messages/read', { messageIds });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      qc.invalidateQueries({ queryKey: ['unreadChats'] });
    },
  });
  const unreadIds = useMemo(() => {
    if (!meId) return [] as string[];
    return merged.filter((m) => idOf(m.sender) !== meId && !(m.readers || []).map(String).includes(meId)).map((m) => m._id);
  }, [merged, meId]);
  const ackRef = useRef('');
  useEffect(() => {
    if (!unreadIds.length || document.visibilityState === 'hidden') return;
    const key = unreadIds.join(',');
    if (ackRef.current === key) return;
    ackRef.current = key;
    markRead.mutate(unreadIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadIds]);

  /* --- send --- */
  const send = useMutation({
    mutationFn: async (item: OutboxItem) => {
      const payload: Record<string, unknown> = room && (isGroup || !peer?._id) ? { chatRoomId: room._id } : { receiverIds: [peer?._id] };
      if (item.text) payload.text = item.text;
      if (item.media.length) payload.media = item.media.map((m) => ({ uri: m.key, type: m.type }));
      const { data } = await api.post('/messages/send', payload);
      return data as { message?: ChatMessage; chatRoom?: ChatRoom };
    },
    onSuccess: (data, item) => {
      setOutbox((prev) => prev.filter((o) => o.tempId !== item.tempId));
      if (data.message) onSent(data.message, data.chatRoom);
      if (!room && data.chatRoom?._id) {
        if (peer) rememberPerson(peer);
        qc.invalidateQueries({ queryKey: ['chatRooms'] });
        navigate(`/messages/${data.chatRoom._id}`, { replace: true, viewTransition: true });
        return;
      }
      void thread.refetch();
    },
    onError: (e, item) => {
      const final = isConsentError(e);
      if (final) {
        const who = consentErrorUser(e);
        setConsent({ blocked: true, friendStatus: peer?.friendStatus });
        toast.error(null, errMsg(e, `${nameOf(who || peer)} only accepts messages from friends`));
      }
      setOutbox((prev) => prev.map((o) => (o.tempId === item.tempId ? { ...o, status: 'failed', error: errMsg(e, 'Not sent'), final } : o)));
    },
  });

  const queue = (text: string, media: UploadedMedia[]) => {
    const item: OutboxItem = { tempId: tempId(), text, media, createdAt: new Date().toISOString(), status: 'sending' };
    setOutbox((prev) => [...prev, item]);
    atBottomRef.current = true;
    send.mutate(item);
  };
  const retry = (item: OutboxItem) => {
    setOutbox((prev) => prev.map((o) => (o.tempId === item.tempId ? { ...o, status: 'sending', error: undefined } : o)));
    send.mutate({ ...item, status: 'sending' });
  };

  /* --- delete --- */
  const remove = useMutation({
    mutationFn: async ({ id }: { id: string; mine: boolean }) => {
      await api.delete(`/messages/${id}`);
    },
    onSuccess: (_d, { id, mine }) => {
      onDeleted(id);
      setPendingDelete(null);
      toast.success(mine ? 'Message deleted' : 'Removed from your conversation');
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
    },
    onError: (e) => {
      toast.error(e, 'Could not delete the message');
      setPendingDelete(null);
    },
  });

  /* --- archive: handled by the page (see useArchiveRoom), which outlives this thread --- */
  const archive = () => {
    if (room) onArchived(room);
  };

  /* --- leave group: handled by the page (see useLeaveRoom), which outlives this thread --- */

  const menuItems: MenuItem[] = [
    ...(peer && !isGroup ? [{ label: 'View profile', icon: <UserIcon size={18} />, to: `/u/${peer._id}` } as MenuItem] : []),
    ...(isGroup
      ? [
          { label: 'Members', description: `${room?.participants?.length ?? 0} people`, icon: <Users size={18} />, onSelect: () => setMembers(true) } as MenuItem,
          { label: 'Add people', icon: <UserPlus size={18} />, onSelect: () => setAdding(true) } as MenuItem,
          { label: 'Rename group', icon: <Edit size={18} />, onSelect: () => setRenaming(true) } as MenuItem,
        ]
      : []),
    ...(room ? [{ label: 'Archive conversation', description: 'Hide it from your list', icon: <Inbox size={18} />, onSelect: archive, divider: true } as MenuItem] : []),
    ...(isGroup ? [{ label: 'Leave group', description: 'You stop receiving its messages', icon: <LogOut size={18} />, onSelect: () => setLeaving(true), danger: true } as MenuItem] : []),
  ];
  const roomMenu = menuItems.length ? <Menu label="Conversation options" items={menuItems} /> : null;

  // Read receipt on the newest own message.
  const lastOwn = useMemo(() => {
    for (let i = merged.length - 1; i >= 0; i--) if (idOf(merged[i].sender) === meId) return merged[i];
    return null;
  }, [merged, meId]);
  const readers = useMemo(() => {
    if (!lastOwn || !room) return [] as ChatUser[];
    const ids = new Set((lastOwn.readers || []).map(String).filter((id) => id !== meId));
    return (room.participants || []).filter((p) => ids.has(p._id));
  }, [lastOwn, room, meId]);

  const peerOnline = !isGroup && peer?.isOnline === true;
  const subtitle = isGroup ? `${room?.participants?.length ?? 0} members` : peerOnline ? 'Active now' : peer?.username ? `@${peer.username}` : 'Direct message';
  const lastTimelineOutboxTemp = outbox.length ? outbox[outbox.length - 1].tempId : null;
  const consentBlocked = target.kind === 'draft' && consent.blocked;
  const headerLink = room && isGroup ? undefined : peer ? `/u/${peer._id}` : undefined;
  const onTyping = room ? (active: boolean) => emitTyping(room._id, isGroup, active) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {compact ? (
        <ThreadChrome
          title={title}
          subtitle={target.kind === 'draft' ? 'New conversation' : subtitle}
          avatar={room ? <RoomAvatar room={room} meId={meId} size={32} presence /> : <Avatar src={peer?.avatar} name={nameOf(peer)} size={32} />}
          to={headerLink}
          onOpen={isGroup ? () => setMembers(true) : undefined}
          connected={connected}
          actions={roomMenu}
        />
      ) : null}

      {!compact ? (
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          {room ? <RoomAvatar room={room} meId={meId} size={40} presence /> : <Avatar src={peer?.avatar} name={nameOf(peer)} size={40} />}
          <div className="min-w-0 flex-1">
            {headerLink ? (
              <Link to={headerLink} viewTransition className="block truncate text-md font-semibold text-text-1 hover:underline">
                <h2 className="truncate">{title}</h2>
              </Link>
            ) : (
              <button type="button" onClick={() => setMembers(true)} className="block max-w-full truncate text-left text-md font-semibold text-text-1 hover:underline">
                <h2 className="truncate">{title}</h2>
              </button>
            )}
            <p className={cx('truncate text-xs', peerOnline ? 'text-success' : 'text-text-2')}>{target.kind === 'draft' ? 'New conversation' : subtitle}</p>
          </div>
          <span
            className="hidden items-center gap-1.5 text-2xs font-semibold text-text-3 sm:inline-flex"
            title={connected ? 'Messages arrive instantly' : 'Live updates paused — refreshing every minute'}
          >
            <span aria-hidden="true" className={cx('h-1.5 w-1.5 rounded-full', connected ? 'bg-success' : 'bg-text-3')} />
            {connected ? 'Live' : 'Polling'}
          </span>
          {roomMenu}
        </header>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain px-3 py-4 md:px-4" role="log" aria-live="polite" aria-relevant="additions" aria-label={`Conversation with ${title}`}>
          {thread.isLoading ? (
            <div className="space-y-3" aria-busy="true">
              {[0, 1, 0, 0, 1, 0].map((mine, i) => (
                <div key={i} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
                  <Skeleton className={cx('h-11 rounded-lg', i % 3 === 0 ? 'w-2/3' : 'w-2/5')} />
                </div>
              ))}
            </div>
          ) : thread.isError ? (
            <ErrorState error={thread.error} title="Couldn’t load this conversation" onRetry={() => thread.refetch()} />
          ) : merged.length === 0 && outbox.length === 0 && typingUsers.length === 0 ? (
            <EmptyState
              size="sm"
              title={
                consentBlocked
                  ? `You can’t message ${nameOf(peer).split(' ')[0]} yet`
                  : target.kind === 'draft'
                    ? `Say hi to ${nameOf(peer).split(' ')[0]}`
                    : isGroup
                      ? 'The group is quiet'
                      : `Say hi to ${title.split(' ')[0]}`
              }
              message={consentBlocked ? 'Once you are friends, the conversation opens right here.' : isGroup ? 'Kick things off — plan a session or share a win.' : 'Your messages are private between the two of you.'}
            />
          ) : (
            <>
              <div ref={topRef} aria-hidden="true" className="h-px" />
              {hasMore || older.loading || older.error ? (
                <div className="flex justify-center pb-3">
                  {older.loading ? (
                    <span className="inline-flex items-center gap-2 text-xs text-text-3" aria-live="polite">
                      <Spinner size={14} /> Loading earlier messages…
                    </span>
                  ) : older.error ? (
                    <Button size="sm" variant="secondary" onClick={() => void loadEarlier()}>
                      {older.error} · Try again
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void loadEarlier()}>
                      Load earlier messages
                    </Button>
                  )}
                </div>
              ) : merged.length >= PAGE_SIZE ? (
                <p className="pb-3 text-center text-2xs text-text-3">Beginning of the conversation</p>
              ) : null}
              <ol ref={listRef} className="space-y-3">
                {timeline.map((item) => {
                  if (item.kind === 'day') {
                    return (
                      <li key={item.key} className="flex justify-center py-1">
                        <span className="rounded-xs bg-surface-2 px-2 py-0.5 text-2xs font-semibold text-text-3">{item.label}</span>
                      </li>
                    );
                  }
                  if (item.kind === 'outbox') {
                    return (
                      <li key={item.key} aria-busy={item.item.status === 'sending'}>
                        <OutboxBubble item={item.item} onRetry={() => retry(item.item)} onDiscard={() => setOutbox((prev) => prev.filter((o) => o.tempId !== item.item.tempId))} />
                      </li>
                    );
                  }
                  const senderName = nameOf(item.sender, 'Member');
                  return (
                    <li key={item.key} data-message-id={item.messages[0]?._id} className={cx('flex gap-2', item.mine ? 'justify-end' : 'items-end justify-start')}>
                      {!item.mine ? (
                        <Link to={item.senderId ? `/u/${item.senderId}` : '/friends'} viewTransition aria-label={senderName} className="-m-2 mb-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                          <Avatar src={item.sender?.avatar} name={senderName} size={28} />
                        </Link>
                      ) : null}
                      <div className={cx('flex min-w-0 max-w-full flex-1 flex-col gap-0.5', item.mine ? 'items-end' : 'items-start')}>
                        {isGroup && !item.mine ? <span className="mb-0.5 px-1 text-xs font-semibold text-text-2">{senderName}</span> : null}
                        {item.messages.map((m, i) => (
                          <Bubble
                            key={m._id}
                            message={m}
                            mine={item.mine}
                            first={i === 0}
                            last={i === item.messages.length - 1}
                            fresh={freshIds.has(m._id)}
                            onDelete={(id, mine) => setPendingDelete({ id, mine })}
                            onOpenMedia={(items, index) => setLightbox({ items, index })}
                          />
                        ))}
                        {item.mine && lastOwn && item.messages[item.messages.length - 1]._id === lastOwn._id && !lastTimelineOutboxTemp ? (
                          <span className="mt-0.5 inline-flex items-center gap-1.5 pr-1 text-2xs text-text-3">
                            {readers.length ? (
                              <>
                                <AvatarStack users={readers.map((u) => ({ src: u.avatar, name: nameOf(u) }))} size={16} max={3} />
                                {isGroup ? `Seen by ${readers.length}` : 'Seen'}
                              </>
                            ) : (
                              <>
                                <Check size={12} /> Sent
                              </>
                            )}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
                {typingUsers.length ? <TypingBubble users={typingUsers} isGroup={isGroup} /> : null}
              </ol>
            </>
          )}
        </div>

        {unseen > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button size="sm" variant="primary" className="pointer-events-auto shadow-2 anim-toast-in" icon={<ArrowDown size={16} />} onClick={() => scrollToBottom(true)}>
              {unseen === 1 ? '1 new message' : `${unseen} new messages`}
            </Button>
          </div>
        ) : null}
      </div>

      {consentBlocked && peer ? (
        <ConsentCallout
          peer={{ ...peer, friendStatus: consent.friendStatus ?? peer.friendStatus }}
          onChanged={(status, canMessage) => setConsent({ blocked: !canMessage, friendStatus: status })}
        />
      ) : (
        <Composer offline={!online} placeholder={isGroup ? 'Message the group' : `Message ${nameOf(peer).split(' ')[0]}`} onSend={queue} onTyping={onTyping} focusKey={threadKey} />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete?.mine === false ? 'Delete for you?' : 'Delete message?'}
        description={pendingDelete?.mine === false ? 'Removes it from your conversation only. Others still see it.' : 'It disappears for everyone in the conversation.'}
        confirmLabel={pendingDelete?.mine === false ? 'Delete for me' : 'Delete'}
        destructive
        loading={remove.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />

      {room && isGroup ? (
        <>
          <MembersModal
            open={members}
            onClose={() => setMembers(false)}
            room={room}
            meId={meId}
            onAddPeople={() => {
              setMembers(false);
              setAdding(true);
            }}
            onLeave={() => {
              setMembers(false);
              setLeaving(true);
            }}
          />
          <RenameGroupModal open={renaming} onClose={() => setRenaming(false)} room={room} meId={meId} />
          <AddPeopleModal open={adding} onClose={() => setAdding(false)} room={room} meId={meId} />
          <ConfirmDialog
            open={leaving}
            title={`Leave ${title}?`}
            description="You’ll stop receiving its messages and lose access to the history. The others stay in the group."
            confirmLabel="Leave group"
            destructive
            onClose={() => setLeaving(false)}
            onConfirm={() => {
              setLeaving(false);
              onLeft(room);
            }}
          />
        </>
      ) : null}

      {lightbox ? <MediaLightbox items={lightbox.items} index={lightbox.index} onClose={() => setLightbox(null)} onIndex={(index) => setLightbox((l) => (l ? { ...l, index } : l))} /> : null}
    </div>
  );
}

/**
 * Phone thread view: the shell's top bar becomes the Instagram-style header
 * (avatar, name, @username / member count / Active now, live dot) with a back
 * chevron and the menu; the tab bar hides.
 */
function ThreadChrome({
  title,
  subtitle,
  avatar,
  to,
  onOpen,
  connected,
  actions,
}: {
  title: string;
  subtitle: string;
  avatar: ReactNode;
  to?: string;
  onOpen?: () => void;
  connected: boolean;
  actions: ReactNode;
}) {
  const body = (
    <>
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-md font-semibold leading-5 text-text-1">{title}</span>
        <span className="flex items-center gap-1.5 text-xs font-normal leading-4 text-text-2">
          <span aria-hidden="true" className={cx('h-1.5 w-1.5 shrink-0 rounded-full', connected ? 'bg-success' : 'bg-text-3')} title={connected ? 'Live' : 'Polling'} />
          <span className="truncate">{subtitle}</span>
        </span>
      </span>
    </>
  );
  const cls = 'flex min-w-0 flex-1 items-center gap-2.5 rounded-sm py-1 pr-2 text-left';
  const titleNode = to ? (
    <Link to={to} viewTransition className={cx(cls, 'hover:bg-surface-2')} aria-label={`${title} — view profile`}>
      {body}
    </Link>
  ) : onOpen ? (
    <button type="button" onClick={onOpen} className={cx(cls, 'hover:bg-surface-2')} aria-label={`${title} — members`}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  );
  usePageChrome({ title, titleNode, back: true, actions, hideBottomNav: true, hideSectionTabs: true });
  return null;
}

/* ================================================================== archive */

/**
 * Archive with Undo, owned by the page rather than the thread. Archiving
 * navigates back to the list, which unmounts the thread; callbacks passed to
 * `mutate()` never fire after an unmount, so the toast and Undo would be lost
 * (and a failure could never roll the optimistic removal back).
 */
function useArchiveRoom(meId: string | undefined, hidden: MutableRefObject<Set<string>>) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const setStatus = useMutation({
    mutationFn: async ({ roomId, status }: { roomId: string; status: 'active' | 'archived' }) => {
      await api.put(`/messages/rooms/${roomId}/status`, { status });
    },
  });
  const undo = useCallback(
    (room: ChatRoom) => {
      const roomId = room._id;
      setStatus.mutate(
        { roomId, status: 'active' },
        {
          onSuccess: () => {
            hidden.current.delete(roomId);
            // Put the row back before navigating so the thread renders at
            // once instead of flashing "not available" while the list refetches.
            qc.setQueryData<ChatRoom[]>(['chatRooms'], (rooms) => (rooms && !rooms.some((r) => r._id === roomId) ? [room, ...rooms] : rooms));
            qc.invalidateQueries({ queryKey: ['chatRooms'] });
            qc.invalidateQueries({ queryKey: ['unreadChats'] });
            navigate(`/messages/${roomId}`, { viewTransition: true });
          },
          onError: (e) => toast.error(e, 'Could not restore the conversation'),
        },
      );
    },
    [setStatus, qc, navigate, toast, hidden],
  );
  return useCallback(
    (room: ChatRoom) => {
      const roomId = room._id;
      // Optimistic: the row leaves the list immediately; a failure puts it back.
      const previous = qc.getQueryData<ChatRoom[]>(['chatRooms']);
      hidden.current.add(roomId);
      qc.setQueryData<ChatRoom[]>(['chatRooms'], (rooms) => rooms?.filter((r) => r._id !== roomId));
      navigate('/messages', { replace: true, viewTransition: true });
      setStatus.mutate(
        { roomId, status: 'archived' },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['chatRooms'] });
            qc.invalidateQueries({ queryKey: ['unreadChats'] });
            toast.info(`${roomTitle(room, meId)} archived`, { action: { label: 'Undo', onClick: () => undo(room) }, duration: 8000 });
          },
          onError: (e) => {
            hidden.current.delete(roomId);
            if (previous) qc.setQueryData(['chatRooms'], previous);
            toast.error(e, 'Could not archive the conversation');
            navigate(`/messages/${roomId}`, { replace: true, viewTransition: true });
          },
        },
      );
    },
    [qc, navigate, setStatus, toast, undo, meId, hidden],
  );
}

/**
 * Leave a group from the page as well: the list row goes at once and the
 * thread unmounts before the request completes, so nothing refetches a room
 * the member no longer belongs to (which showed up as 404s in the console).
 */
function useLeaveRoom(meId: string | undefined, hidden: MutableRefObject<Set<string>>) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const leave = useMutation({
    mutationFn: async (roomId: string) => {
      await api.post(`/messages/rooms/${roomId}/leave`);
    },
  });
  return useCallback(
    (room: ChatRoom) => {
      const roomId = room._id;
      const previous = qc.getQueryData<ChatRoom[]>(['chatRooms']);
      hidden.current.add(roomId);
      qc.setQueryData<ChatRoom[]>(['chatRooms'], (rooms) => rooms?.filter((r) => r._id !== roomId));
      navigate('/messages', { replace: true, viewTransition: true });
      leave.mutate(roomId, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ['chatRooms'] });
          qc.invalidateQueries({ queryKey: ['unreadChats'] });
          toast.success(`You left ${roomTitle(room, meId)}`);
        },
        onError: (e) => {
          hidden.current.delete(roomId);
          if (previous) qc.setQueryData(['chatRooms'], previous);
          toast.error(e, 'Could not leave the group');
          navigate(`/messages/${roomId}`, { replace: true, viewTransition: true });
        },
      });
    },
    [qc, navigate, leave, toast, meId, hidden],
  );
}

/* ================================================================== page */

export default function Messages() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { roomId } = useParams<{ roomId?: string }>();
  const [params] = useSearchParams();
  const me = useAuth((s) => s.user);
  const meId = me?._id;
  const compact = useIsCompact();
  const desktop = useMediaQuery('(min-width: 1024px)');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [live, setLive] = useState<ChatMessage[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [receipt, setReceipt] = useState<{ seq: number; payload: ReadReceiptPayload } | null>(null);
  const [typing, setTyping] = useState<TypingState>({});
  // Rooms the user just archived or left: never looked up again while the
  // route is still catching up, so no request goes out for a room they are
  // no longer in.
  const hiddenRooms = useRef(new Set<string>());

  const rooms = useRoomsQuery();

  // Typing bubbles fade on their own if a peer's stop event never arrives.
  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const t = window.setInterval(() => setTyping((s) => typingExpired(s)), Math.min(2000, TYPING_TTL_MS / 2));
    return () => window.clearInterval(t);
  }, [typing]);

  /* --- realtime --- */
  const connected = useChatSocket({
    onMessage: useCallback((m: ChatMessage) => {
      setLive((prev) => (prev.some((x) => x._id === m._id) ? prev : [...prev, m]));
      const from = idOf(m.sender);
      const roomKey = roomIdOfMessage(m);
      if (from && roomKey) setTyping((s) => typingStopped(s, { roomId: roomKey, userId: from }));
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      qc.invalidateQueries({ queryKey: ['unreadChats'] });
    }, [qc]),
    onDeleted: useCallback(
      (id: string) => {
        setDeletedIds((prev) => new Set(prev).add(id));
        qc.invalidateQueries({ queryKey: ['chatRooms'] });
      },
      [qc],
    ),
    onRoomUpdate: useCallback(() => {
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      qc.invalidateQueries({ queryKey: ['chatRoom'] });
    }, [qc]),
    onRead: useCallback(
      (payload: ReadReceiptPayload) => {
        // Patch every cached thread page and the realtime buffer in place:
        // "Sent" flips to "Seen" without a refetch.
        qc.setQueriesData<ThreadPage>({ queryKey: ['thread'] }, (page) => {
          if (!page) return page;
          const messages = applyReadReceipts(page.messages, payload);
          return messages === page.messages ? page : { ...page, messages };
        });
        setLive((prev) => applyReadReceipts(prev, payload));
        setReceipt((r) => ({ seq: (r?.seq ?? 0) + 1, payload }));
      },
      [qc],
    ),
    onTyping: useCallback((payload: TypingPayload, active: boolean) => {
      const userId = String(payload.senderId || payload.userId || payload.sender || '');
      const roomKey = String(payload.chatRoomId || '');
      if (!userId || !roomKey) return;
      setTyping((s) => (active ? typingStarted(s, { roomId: roomKey, userId, name: payload.senderName || 'Someone' }) : typingStopped(s, { roomId: roomKey, userId })));
    }, []),
    onReconnect: useCallback(() => {
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      qc.invalidateQueries({ queryKey: ['thread'] });
      qc.invalidateQueries({ queryKey: ['unreadChats'] });
    }, [qc]),
  });

  /* --- which thread --- */
  // Both /messages/new?to=<id> and the older /messages?to=<id> open a draft with that person.
  const toParam = params.get('to') || '';
  const isDraft = roomId === DRAFT_ROOM_ID || (!roomId && toParam.length > 0);
  const draftPeerId = isDraft ? toParam : '';
  // /messages/new with nobody picked yet used to render a dead "conversation
  // isn't available" thread; it now opens the people picker over the inbox.
  useEffect(() => {
    if (roomId === DRAFT_ROOM_ID && !toParam) {
      setPickerOpen(true);
      navigate('/messages', { replace: true, state: location.state });
    }
  }, [roomId, toParam, navigate, location.state]);
  const statePeer = (location.state as { peer?: ChatUser } | null)?.peer;

  const activeRoom = useMemo(() => (roomId && !isDraft ? (rooms.data || []).find((r) => r._id === roomId) || null : null), [rooms.data, roomId, isDraft]);

  // Deep links to rooms outside the first page of the list resolve individually.
  const hiding = Boolean(roomId && hiddenRooms.current.has(roomId));
  const lookupEnabled = Boolean(roomId && !isDraft && !rooms.isPending && !activeRoom && !hiding);
  // The draft header can render from router state, but the consent flags
  // (canMessage, friendStatus) always come from the profile endpoint.
  const draftEnabled = Boolean(draftPeerId);
  const roomLookup = useQuery({
    queryKey: ['chatRoom', roomId],
    enabled: lookupEnabled,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/messages/rooms/${roomId}`);
      return (data.chatRoom || null) as ChatRoom | null;
    },
  });

  const draftPeer = useQuery({
    queryKey: ['user', draftPeerId],
    enabled: draftEnabled,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/users/${draftPeerId}`);
      return (data.user || data) as ChatUser;
    },
  });

  // A draft with someone you already chat with jumps straight to that room.
  useEffect(() => {
    if (!isDraft || !draftPeerId || !rooms.data) return;
    const existing = rooms.data.find((r) => isDirectRoomWith(r, draftPeerId, meId));
    if (existing) navigate(`/messages/${existing._id}`, { replace: true, viewTransition: true });
  }, [isDraft, draftPeerId, rooms.data, meId, navigate]);

  const target: ThreadTarget | null = useMemo(() => {
    if (isDraft) {
      const fromState = statePeer?._id === draftPeerId ? statePeer : undefined;
      const peer = draftPeer.data ? { ...fromState, ...draftPeer.data } : fromState;
      return peer ? { kind: 'draft', peer } : null;
    }
    const room = activeRoom || roomLookup.data;
    return room ? { kind: 'room', room } : null;
  }, [isDraft, statePeer, draftPeerId, draftPeer.data, activeRoom, roomLookup.data]);

  const threadPending =
    Boolean(roomId || isDraft) && !target && (hiding || (!isDraft && rooms.isPending) || (lookupEnabled && roomLookup.isPending) || (draftEnabled && draftPeer.isPending));
  const threadMissing = Boolean(roomId || isDraft) && !target && !threadPending;

  const openWith = useCallback(
    (user: ChatUser) => {
      setPickerOpen(false);
      const existing = (rooms.data || []).find((r) => isDirectRoomWith(r, user._id, meId));
      if (existing) navigate(`/messages/${existing._id}`, { viewTransition: true });
      else navigate(`/messages/${DRAFT_ROOM_ID}?to=${encodeURIComponent(user._id)}`, { state: { peer: user }, viewTransition: true });
    },
    [rooms.data, meId, navigate],
  );

  const onSent = useCallback(
    (message: ChatMessage, room?: ChatRoom) => {
      setLive((prev) => (prev.some((x) => x._id === message._id) ? prev : [...prev, message]));
      // The first message from a draft creates the room. GET /messages/rooms/:id
      // only resolves groups, so the new DM is put into the list from the send
      // response (participants come populated) before the route moves there;
      // the refetch below then replaces it with the server's copy.
      if (room?._id) {
        qc.setQueryData<ChatRoom[]>(['chatRooms'], (rooms) => (rooms?.some((r) => r._id === room._id) ? rooms : [room, ...(rooms || [])]));
      }
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
    },
    [qc],
  );
  const onDeleted = useCallback((id: string) => setDeletedIds((prev) => new Set(prev).add(id)), []);
  const onArchived = useArchiveRoom(meId, hiddenRooms);
  const onLeft = useLeaveRoom(meId, hiddenRooms);

  /* --- layout --- */
  const showThread = Boolean(roomId) || isDraft;
  const showThreadOnly = compact && showThread;
  const showListOnly = compact && !showThread;
  const fixedHeight = !compact || showThreadOnly;
  const bottomPad = compact ? '24px' : desktop ? '40px' : 'calc(var(--nav-h) + env(safe-area-inset-bottom) + 16px)';
  const pane = usePaneHeight(fixedHeight, bottomPad);

  const newMessageButton = (
    <Button variant="primary" icon={<Edit size={18} />} onClick={() => setPickerOpen(true)}>
      New message
    </Button>
  );

  const threadPane = (
    <>
      {target ? (
        <Thread
          key={target.kind === 'room' ? target.room._id : `draft-${target.peer._id}`}
          target={target}
          meId={meId}
          incoming={live}
          deletedIds={deletedIds}
          receipt={receipt}
          typing={typing}
          connected={connected}
          compact={compact}
          onSent={onSent}
          onDeleted={onDeleted}
          onArchived={onArchived}
          onLeft={onLeft}
        />
      ) : threadPending ? (
        <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
          {compact ? <ThreadChrome title="Messages" subtitle="" avatar={<Skeleton className="h-8 w-8 rounded-full" />} connected={connected} actions={null} /> : null}
          {!compact ? (
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ) : null}
          <div className="flex-1 space-y-3 px-4 py-4">
            {[0, 1, 0, 1, 0].map((mine, i) => (
              <div key={i} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
                <Skeleton className={cx('h-11 rounded-lg', i % 2 ? 'w-1/2' : 'w-2/3')} />
              </div>
            ))}
          </div>
        </div>
      ) : threadMissing ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          {compact ? <ThreadChrome title="Messages" subtitle="" avatar={null} connected={connected} actions={null} /> : null}
          <EmptyState
            variant="error"
            title="This conversation isn’t available"
            message={isDraft ? 'We couldn’t find that person.' : 'It may have been archived, or the link is out of date.'}
            action={{ label: 'Back to messages', to: '/messages', variant: 'secondary' }}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            size="lg"
            title="Your messages"
            message="Pick a conversation on the left, or start a new one."
            action={{ label: 'New message', onClick: () => setPickerOpen(true), icon: <Edit size={18} /> }}
          />
        </div>
      )}
    </>
  );

  return (
    <>
      {!showThreadOnly ? (
        <PageHeader
          title="Messages"
          subtitle={rooms.data?.length ? `${rooms.data.length} ${rooms.data.length === 1 ? 'conversation' : 'conversations'}` : undefined}
          back={false}
          actions={newMessageButton}
          mobileActions={
            <IconButton label="New message" onClick={() => setPickerOpen(true)}>
              <Edit size={22} />
            </IconButton>
          }
          rail={null}
        />
      ) : null}

      {showListOnly ? (
        <RoomList rooms={rooms} meId={meId} activeId={null} compact typing={typing} onNewMessage={() => setPickerOpen(true)} onOpenWith={openWith} />
      ) : showThreadOnly ? (
        <div ref={pane.ref} style={pane.style} className="-mt-4 flex min-h-[20rem] flex-col">
          {threadPane}
        </div>
      ) : (
        <div ref={pane.ref} style={pane.style} className="flex min-h-[24rem] gap-4 lg:gap-6">
          <aside aria-label="Conversation list" className="card flex w-72 shrink-0 flex-col overflow-hidden lg:w-[22.5rem]">
            <RoomList rooms={rooms} meId={meId} activeId={roomId && !isDraft ? roomId : null} compact={false} typing={typing} onNewMessage={() => setPickerOpen(true)} onOpenWith={openWith} />
          </aside>
          <section aria-label="Conversation" className="card flex min-w-0 flex-1 flex-col overflow-hidden">
            {threadPane}
          </section>
        </div>
      )}

      <NewMessageModal open={pickerOpen} onClose={() => setPickerOpen(false)} meId={meId} onOpenWith={openWith} />
    </>
  );
}
