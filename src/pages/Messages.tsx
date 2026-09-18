import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, differenceInMinutes, format, isSameDay, isThisYear, isToday, isYesterday } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../lib/auth';
import { uploadImage, useDebounced, type UploadedMedia } from '../lib/hooks';
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
  SearchField,
  SegmentedControl,
  Skeleton,
  SkeletonRow,
  Spinner,
  Textarea,
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
  Copy,
  Edit,
  Image as ImageIcon,
  Inbox,
  Search,
  Send,
  Trash,
  User as UserIcon,
  Users,
  Video as VideoIcon,
  X,
} from './icons';

/* ================================================================== types */

type ChatUser = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
};

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

/** A message that has left the composer but not yet been confirmed by the API. */
type OutboxItem = {
  tempId: string;
  text: string;
  media: UploadedMedia[];
  createdAt: string;
  status: 'sending' | 'failed';
  error?: string;
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
const ACCEPTED_TYPES: Record<string, 'image' | 'video'> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/heic': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
};
const MAX_BYTES = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024 } as const;

/* ================================================================== helpers */

const idOf = (v: unknown): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const o = v as { _id?: string };
  return o._id ? String(o._id) : '';
};

const userOf = (v: unknown): ChatUser | undefined => (v && typeof v === 'object' ? (v as ChatUser) : undefined);

const nameOf = (u?: ChatUser | null, fallback = 'Vybe user'): string => u?.fullName?.trim() || u?.username || fallback;

const isGroupRoom = (room: ChatRoom): boolean => Boolean(room.isGroup || room.displayInfo?.isGroup);

const peerOf = (room: ChatRoom, meId?: string): ChatUser | undefined =>
  room.displayInfo?.otherUser || room.participants?.find((p) => p._id !== meId);

const roomTitle = (room: ChatRoom, meId?: string): string => {
  if (room.displayInfo?.name) return room.displayInfo.name;
  if (room.roomName) return room.roomName;
  if (!isGroupRoom(room)) return nameOf(peerOf(room, meId));
  const names = (room.participants || []).filter((p) => p._id !== meId).map((p) => nameOf(p)).filter(Boolean);
  return names.length ? names.join(', ') : 'Group chat';
};

const roomAvatarSrc = (room: ChatRoom, meId?: string): string =>
  room.displayInfo?.avatar || room.roomAvatar || (!isGroupRoom(room) ? peerOf(room, meId)?.avatar || '' : '');

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

const roomIdOfMessage = (m: ChatMessage): string => idOf(m.chatRoom) || m.targetId || '';

const isDirectRoomWith = (room: ChatRoom, userId: string, meId?: string): boolean => {
  if (isGroupRoom(room)) return false;
  if (room.displayInfo?.otherUser?._id === userId) return true;
  const others = (room.participants || []).filter((p) => p._id !== meId);
  return others.length === 1 && others[0]._id === userId;
};

let tempCounter = 0;
const tempId = () => `tmp-${Date.now()}-${++tempCounter}`;

/* ================================================================== realtime */

type SocketHandlers = {
  onMessage: (m: ChatMessage) => void;
  onDeleted: (messageId: string) => void;
  onRoomUpdate: () => void;
  onReconnect: () => void;
};

function useChatSocket(handlers: SocketHandlers) {
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    // The app-wide socket (lib/socket.ts) is shared with Live; this page only
    // adds its own listeners and removes exactly those on unmount. Realtime is
    // an enhancement: with no socket the page stays fully usable over HTTP.
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

    socket.on('connect', onConnect);
    socket.on('disconnect', onDown);
    socket.on('connect_error', onDown);
    socket.on('message', onMessage);
    socket.on('newMessage', onMessage);
    socket.on('messageDeleted', onDeleted);
    socket.on('chatRoomUpdate', onRooms);
    socket.on('newGroupChat', onRooms);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDown);
      socket.off('connect_error', onDown);
      socket.off('message', onMessage);
      socket.off('newMessage', onMessage);
      socket.off('messageDeleted', onDeleted);
      socket.off('chatRoomUpdate', onRooms);
      socket.off('newGroupChat', onRooms);
    };
  }, []);

  return connected;
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

function RoomAvatar({ room, meId, size = 48 }: { room: ChatRoom; meId?: string; size?: number }) {
  const src = roomAvatarSrc(room, meId);
  if (src || !isGroupRoom(room)) return <Avatar src={src} name={roomTitle(room, meId)} size={size} />;
  return (
    <span className="inline-flex items-center justify-center rounded-full bg-surface-3 text-text-2" style={{ width: size, height: size }} role="img" aria-label={roomTitle(room, meId)}>
      <Users size={Math.round(size * 0.5)} />
    </span>
  );
}

/* ================================================================== room list */

function RoomRow({ room, meId, active, compact }: { room: ChatRoom; meId?: string; active: boolean; compact: boolean }) {
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
        <RoomAvatar room={room} meId={meId} size={48} />
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
            <span className={cx('truncate text-sm', unread ? 'font-medium text-text-1' : 'text-text-2')}>{previewOf(room, meId)}</span>
            {unread ? <CountBadge value={unread} className="ring-0" /> : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

function PersonRow({ user, onClick, trailing, selected }: { user: ChatUser; onClick: () => void; trailing?: ReactNode; selected?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        role={selected === undefined ? undefined : 'checkbox'}
        aria-checked={selected === undefined ? undefined : selected}
        className={cx(
          'flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors dur-1',
          selected ? 'bg-brand-soft' : 'hover:bg-surface-2 active:bg-surface-2',
        )}
      >
        <Avatar src={user.avatar} name={nameOf(user)} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-text-1">{nameOf(user)}</span>
          {user.username ? <span className="block truncate text-xs text-text-2">@{user.username}</span> : null}
        </span>
        {trailing}
      </button>
    </li>
  );
}

function RoomList({
  rooms,
  meId,
  activeId,
  compact,
  onNewMessage,
  onOpenWith,
}: {
  rooms: ReturnType<typeof useRoomsQuery>;
  meId?: string;
  activeId: string | null;
  compact: boolean;
  onNewMessage: () => void;
  onOpenWith: (user: ChatUser) => void;
}) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const debounced = useDebounced(search.trim(), 300);

  const people = useQuery({
    queryKey: ['userSearch', debounced],
    enabled: debounced.length >= 2,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get('/users/all/search', { params: { q: debounced } });
      return (data.users || []) as ChatUser[];
    },
  });

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
                  <RoomRow key={room._id} room={room} meId={meId} active={room._id === activeId} compact={compact} />
                ))}
              </ul>
            ) : q.length < 2 ? (
              <EmptyState variant="no-results" size="sm" title={`No chats match “${search.trim()}”`} message="Keep typing to search everyone on Vybe." />
            ) : null}

            {q.length >= 2 ? (
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
                      <PersonRow key={u._id} user={u} onClick={() => onOpenWith(u)} trailing={<span className="text-xs font-semibold text-brand-text">Message</span>} />
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
  const debounced = useDebounced(search.trim(), 300);

  useEffect(() => {
    if (!open) {
      setMode('direct');
      setName('');
      setSearch('');
      setPicked([]);
    }
  }, [open]);

  const friends = useQuery({
    queryKey: ['friends', 'list'],
    enabled: open,
    queryFn: async () => {
      const { data } = await api.get('/friends/list');
      return (data.friends || []) as ChatUser[];
    },
  });

  const found = useQuery({
    queryKey: ['userSearch', debounced],
    enabled: open && debounced.length >= 2,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get('/users/all/search', { params: { q: debounced } });
      return (data.users || []) as ChatUser[];
    },
  });

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = (friends.data || []).filter((u) => u._id !== meId);
    const matchesQ = (u: ChatUser) => !q || `${u.fullName || ''} ${u.username || ''}`.toLowerCase().includes(q);
    const seen = new Set<string>();
    const out: ChatUser[] = [];
    for (const u of base.filter(matchesQ)) {
      seen.add(u._id);
      out.push(u);
    }
    for (const u of found.data || []) {
      if (u._id !== meId && !seen.has(u._id)) {
        seen.add(u._id);
        out.push(u);
      }
    }
    return out;
  }, [friends.data, found.data, search, meId]);

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
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      onClose();
      if (data.chatRoom?._id) navigate(`/messages/${data.chatRoom._id}`, { viewTransition: true });
    },
    onError: (e) => toast.error(e, 'Could not create the group'),
  });

  const nameOk = name.trim().length >= 1 && name.trim().length <= 100;
  const valid = nameOk && picked.length >= 2;
  const searching = search.trim().length >= 2;
  const loading = friends.isLoading || (searching && found.isLoading && candidates.length === 0);

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

        <SearchField label="Search people" hideLabel placeholder="Search by name or @username" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />

        {mode === 'group' && picked.length ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Selected people">
            {picked.map((u) => (
              <Chip key={u._id} selected onRemove={() => toggle(u)} removeLabel={`Remove ${nameOf(u)}`}>
                {nameOf(u)}
              </Chip>
            ))}
          </div>
        ) : null}

        <div className="-mx-1 max-h-[50dvh] min-h-40 overflow-y-auto md:max-h-80">
          {loading ? (
            <ul aria-busy="true" aria-label="Loading people">
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="px-3">
                  <SkeletonRow />
                </li>
              ))}
            </ul>
          ) : friends.isError && !searching ? (
            <ErrorState error={friends.error} title="Couldn’t load your friends" onRetry={() => friends.refetch()} />
          ) : candidates.length === 0 ? (
            searching ? (
              found.isError ? (
                <ErrorState error={found.error} title="Search failed" onRetry={() => found.refetch()} />
              ) : (
                <EmptyState variant="no-results" size="sm" title={`No one matches “${search.trim()}”`} message="Check the spelling or try a username." />
              )
            ) : (
              <EmptyState
                size="sm"
                title="No friends yet"
                message="Search anyone on Vybe above, or add friends so they show up here."
                action={{ label: 'Find friends', to: '/friends', variant: 'secondary' }}
              />
            )
          ) : (
            <>
              {!searching ? <h3 className="type-label px-3 pb-1 text-text-3">Friends</h3> : null}
              <ul className="space-y-0.5">
                {candidates.map((u) => {
                  const on = picked.some((p) => p._id === u._id);
                  return mode === 'direct' ? (
                    <PersonRow key={u._id} user={u} onClick={() => onOpenWith(u)} trailing={<span className="text-xs font-semibold text-brand-text">Message</span>} />
                  ) : (
                    <PersonRow
                      key={u._id}
                      user={u}
                      selected={on}
                      onClick={() => toggle(u)}
                      trailing={
                        <span
                          aria-hidden="true"
                          className={cx(
                            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors dur-1',
                            on ? 'border-brand bg-brand text-on-brand' : 'border-control bg-surface-2 text-transparent',
                          )}
                        >
                          <Check size={14} strokeWidth={2.8} />
                        </span>
                      }
                    />
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== members */

function MembersModal({ open, onClose, room, meId }: { open: boolean; onClose: () => void; room: ChatRoom; meId?: string }) {
  const members = room.participants || [];
  return (
    <Modal open={open} onClose={onClose} title={roomTitle(room, meId)} description={`${members.length} ${members.length === 1 ? 'member' : 'members'}`} size="sm">
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

function MediaGrid({ media, mine }: { media: MessageMedia[]; mine: boolean }) {
  return (
    <div className={cx('grid gap-1', media.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
      {media.map((att, i) => {
        const url = mediaUrl(att.uri);
        return att.type === 'video' ? (
          <video key={`${att.uri}-${i}`} src={url} controls preload="metadata" playsInline className="max-h-72 w-full rounded-md bg-surface-3 object-cover" />
        ) : (
          <a key={`${att.uri}-${i}`} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md" aria-label={mine ? 'Open your photo' : 'Open photo'}>
            <img src={url} alt="" loading="lazy" className={cx('w-full bg-surface-3 object-cover', media.length > 1 ? 'aspect-square' : 'max-h-72')} />
          </a>
        );
      })}
    </div>
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
}: {
  message: ChatMessage;
  mine: boolean;
  first: boolean;
  last: boolean;
  fresh: boolean;
  onDelete?: (id: string) => void;
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
    ...(mine && onDelete ? [{ label: 'Delete', icon: <Trash size={18} />, onSelect: () => onDelete(message._id), danger: true, divider: hasText } as MenuItem] : []),
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
          {message.media?.length ? <MediaGrid media={message.media} mine={mine} /> : null}
          {message.text ? <p className={cx(!!message.media?.length && 'mt-2')}>{message.text}</p> : null}
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
                  {it.label}
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
              <span className="font-semibold text-danger">{item.error || 'Not sent'}</span>
              <button type="button" onClick={onRetry} className="min-h-6 font-semibold text-brand-text hover:underline">
                Retry
              </button>
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

/* ================================================================== composer */

function Composer({
  disabled,
  offline,
  placeholder,
  onSend,
  focusKey,
}: {
  disabled?: boolean;
  offline: boolean;
  placeholder: string;
  onSend: (text: string, media: UploadedMedia[]) => void;
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

  // Focus the composer when a thread opens on desktop (phones would summon the keyboard).
  useEffect(() => {
    if (compact || touch) return;
    const t = window.setTimeout(() => wrapRef.current?.querySelector('textarea')?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(t);
  }, [focusKey, compact, touch]);

  useEffect(() => () => attachmentsRef.current.forEach((a) => URL.revokeObjectURL(a.previewUrl)), []);

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
        toast.error(null, `${file.name}: use JPG, PNG, WebP, HEIC, MP4 or MOV.`);
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
            onChange={(e) => setText(e.target.value)}
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
  connected,
  compact,
  onSent,
  onDeleted,
  onArchived,
}: {
  target: ThreadTarget;
  meId?: string;
  incoming: ChatMessage[];
  deletedIds: Set<string>;
  connected: boolean;
  compact: boolean;
  onSent: (message: ChatMessage, room?: ChatRoom) => void;
  onDeleted: (id: string) => void;
  onArchived: () => void;
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

  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [members, setMembers] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const firstPaintRef = useRef(true);
  const seenIdsRef = useRef<Set<string> | null>(null);

  const thread = useQuery({
    queryKey: room ? ['thread', room._id] : ['thread', 'peer', peer?._id],
    queryFn: async () => {
      if (room && (isGroup || !peer?._id)) {
        const { data } = await api.get(`/messages/conversation/${room._id}`, { params: { isGroup: 'true' } });
        return (data.messages || []) as ChatMessage[];
      }
      const { data } = await api.get(`/messages/conversation/${peer?._id}`);
      return (data.messages || []) as ChatMessage[];
    },
  });

  // Fetched history + realtime deliveries for this room, minus anything deleted.
  const merged = useMemo(() => {
    const base = (thread.data || []).filter((m) => !deletedIds.has(m._id));
    if (!room) return base;
    const seen = new Set(base.map((m) => m._id));
    const extra = incoming.filter((m) => !seen.has(m._id) && !deletedIds.has(m._id) && roomIdOfMessage(m) === room._id);
    return extra.length ? [...base, ...extra] : base;
  }, [thread.data, incoming, deletedIds, room]);

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

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setUnseen(0);
  }, []);

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
  }, [merged.length, outbox.length, thread.isSuccess]);

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
      if (atBottomRef.current) el.scrollTo({ top: el.scrollHeight });
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [thread.isSuccess]);

  /* --- read receipts --- */
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
        qc.invalidateQueries({ queryKey: ['chatRooms'] });
        navigate(`/messages/${data.chatRoom._id}`, { replace: true, viewTransition: true });
        return;
      }
      void thread.refetch();
    },
    onError: (e, item) => {
      setOutbox((prev) => prev.map((o) => (o.tempId === item.tempId ? { ...o, status: 'failed', error: errMsg(e, 'Not sent') } : o)));
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
    mutationFn: async (messageId: string) => {
      await api.delete(`/messages/${messageId}`);
    },
    onSuccess: (_d, messageId) => {
      onDeleted(messageId);
      setPendingDelete(null);
      toast.success('Message deleted');
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
    },
    onError: (e) => {
      toast.error(e, 'Could not delete the message');
      setPendingDelete(null);
    },
  });

  /* --- archive --- */
  const setStatus = useMutation({
    mutationFn: async ({ roomId, status }: { roomId: string; status: 'active' | 'archived' }) => {
      await api.put(`/messages/rooms/${roomId}/status`, { status });
    },
  });
  const archive = () => {
    if (!room) return;
    const roomId = room._id;
    setStatus.mutate(
      { roomId, status: 'archived' },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ['chatRooms'] });
          qc.invalidateQueries({ queryKey: ['unreadChats'] });
          onArchived();
          toast.info('Conversation archived', {
            action: {
              label: 'Undo',
              onClick: () =>
                setStatus.mutate(
                  { roomId, status: 'active' },
                  {
                    onSuccess: () => {
                      qc.invalidateQueries({ queryKey: ['chatRooms'] });
                      navigate(`/messages/${roomId}`, { viewTransition: true });
                    },
                    onError: (e) => toast.error(e, 'Could not restore the conversation'),
                  },
                ),
            },
            duration: 8000,
          });
        },
        onError: (e) => toast.error(e, 'Could not archive the conversation'),
      },
    );
  };

  const menuItems: MenuItem[] = [
    ...(peer && !isGroup ? [{ label: 'View profile', icon: <UserIcon size={18} />, to: `/u/${peer._id}` } as MenuItem] : []),
    ...(isGroup ? [{ label: 'Members', description: `${room?.participants?.length ?? 0} people`, icon: <Users size={18} />, onSelect: () => setMembers(true) } as MenuItem] : []),
    ...(room ? [{ label: 'Archive conversation', description: 'Hide it from your list', icon: <Inbox size={18} />, onSelect: archive, divider: true } as MenuItem] : []),
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

  const subtitle = isGroup ? `${room?.participants?.length ?? 0} members` : peer?.username ? `@${peer.username}` : 'Direct message';
  const lastTimelineOutboxTemp = outbox.length ? outbox[outbox.length - 1].tempId : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {compact ? <ThreadChrome title={title} actions={roomMenu} /> : null}

      {!compact ? (
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          {room ? <RoomAvatar room={room} meId={meId} size={40} /> : <Avatar src={peer?.avatar} name={nameOf(peer)} size={40} />}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-md font-semibold text-text-1">{title}</h2>
            <p className="truncate text-xs text-text-2">{target.kind === 'draft' ? 'New conversation' : subtitle}</p>
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
          ) : merged.length === 0 && outbox.length === 0 ? (
            <EmptyState
              size="sm"
              title={target.kind === 'draft' ? `Say hi to ${nameOf(peer).split(' ')[0]}` : isGroup ? 'The group is quiet' : `Say hi to ${title.split(' ')[0]}`}
              message={isGroup ? 'Kick things off — plan a session or share a win.' : 'Your messages are private between the two of you.'}
            />
          ) : (
            <ol className="space-y-3">
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
                  <li key={item.key} className={cx('flex gap-2', item.mine ? 'justify-end' : 'items-end justify-start')}>
                    {!item.mine ? (
                      <Link to={item.senderId ? `/u/${item.senderId}` : '/friends'} viewTransition aria-label={senderName} className="relative mb-5 shrink-0 rounded-full before:absolute before:-inset-2 before:content-['']">
                        <Avatar src={item.sender?.avatar} name={senderName} size={28} />
                      </Link>
                    ) : null}
                    <div className={cx('flex min-w-0 max-w-full flex-1 flex-col gap-0.5', item.mine ? 'items-end' : 'items-start')}>
                      {isGroup && !item.mine ? <span className="mb-0.5 px-1 text-xs font-semibold text-text-2">{senderName}</span> : null}
                      {item.messages.map((m, i) => (
                        <Bubble key={m._id} message={m} mine={item.mine} first={i === 0} last={i === item.messages.length - 1} fresh={freshIds.has(m._id)} onDelete={item.mine ? (id) => setPendingDelete(id) : undefined} />
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
            </ol>
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

      <Composer offline={!online} placeholder={isGroup ? 'Message the group' : `Message ${nameOf(peer).split(' ')[0]}`} onSend={queue} focusKey={threadKey} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete message?"
        description="It disappears for everyone in the conversation."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />

      {room && isGroup ? <MembersModal open={members} onClose={() => setMembers(false)} room={room} meId={meId} /> : null}
    </div>
  );
}

/** Phone thread view: the shell's top bar shows the room title, back chevron and menu; the tab bar hides. */
function ThreadChrome({ title, actions }: { title: string; actions: ReactNode }) {
  usePageChrome({ title, back: true, actions, hideBottomNav: true, hideSectionTabs: true });
  return null;
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

  const rooms = useRoomsQuery();

  /* --- realtime --- */
  const connected = useChatSocket({
    onMessage: useCallback(
      (m: ChatMessage) => {
        setLive((prev) => (prev.some((x) => x._id === m._id) ? prev : [...prev, m]));
        qc.invalidateQueries({ queryKey: ['chatRooms'] });
        qc.invalidateQueries({ queryKey: ['unreadChats'] });
      },
      [qc],
    ),
    onDeleted: useCallback(
      (id: string) => {
        setDeletedIds((prev) => new Set(prev).add(id));
        qc.invalidateQueries({ queryKey: ['chatRooms'] });
      },
      [qc],
    ),
    onRoomUpdate: useCallback(() => qc.invalidateQueries({ queryKey: ['chatRooms'] }), [qc]),
    onReconnect: useCallback(() => {
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      qc.invalidateQueries({ queryKey: ['thread'] });
      qc.invalidateQueries({ queryKey: ['unreadChats'] });
    }, [qc]),
  });

  /* --- which thread --- */
  const isDraft = roomId === DRAFT_ROOM_ID;
  const draftPeerId = isDraft ? params.get('to') || '' : '';
  // `/messages?to=<id>` with no room is the same intent as `/messages/new?to=<id>`;
  // without this it landed on the empty inbox ("Pick a conversation on the left").
  const bareRecipient = !roomId ? params.get('to') || '' : '';
  useEffect(() => {
    if (!bareRecipient) return;
    navigate(`/messages/${DRAFT_ROOM_ID}?to=${encodeURIComponent(bareRecipient)}`, {
      replace: true,
      state: location.state,
      viewTransition: true,
    });
  }, [bareRecipient, navigate, location.state]);
  const statePeer = (location.state as { peer?: ChatUser } | null)?.peer;

  const activeRoom = useMemo(() => (roomId && !isDraft ? (rooms.data || []).find((r) => r._id === roomId) || null : null), [rooms.data, roomId, isDraft]);

  // Deep links to rooms outside the first page of the list resolve individually.
  const lookupEnabled = Boolean(roomId && !isDraft && !rooms.isPending && !activeRoom);
  const draftEnabled = Boolean(draftPeerId) && statePeer?._id !== draftPeerId;
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
      const peer = statePeer?._id === draftPeerId ? statePeer : draftPeer.data;
      return peer ? { kind: 'draft', peer } : null;
    }
    const room = activeRoom || roomLookup.data;
    return room ? { kind: 'room', room } : null;
  }, [isDraft, statePeer, draftPeerId, draftPeer.data, activeRoom, roomLookup.data]);

  const threadPending =
    Boolean(roomId) && !target && ((!isDraft && rooms.isPending) || (lookupEnabled && roomLookup.isPending) || (draftEnabled && draftPeer.isPending));
  const threadMissing = Boolean(roomId) && !target && !threadPending;

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
    (message: ChatMessage) => {
      setLive((prev) => (prev.some((x) => x._id === message._id) ? prev : [...prev, message]));
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
    },
    [qc],
  );
  const onDeleted = useCallback((id: string) => setDeletedIds((prev) => new Set(prev).add(id)), []);
  const onArchived = useCallback(() => navigate('/messages', { replace: true, viewTransition: true }), [navigate]);

  /* --- layout --- */
  const showThreadOnly = compact && Boolean(roomId);
  const showListOnly = compact && !roomId;
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
          connected={connected}
          compact={compact}
          onSent={onSent}
          onDeleted={onDeleted}
          onArchived={onArchived}
        />
      ) : threadPending ? (
        <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
          {compact ? <ThreadChrome title="Messages" actions={null} /> : null}
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
          {compact ? <ThreadChrome title="Messages" actions={null} /> : null}
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
        <RoomList rooms={rooms} meId={meId} activeId={null} compact onNewMessage={() => setPickerOpen(true)} onOpenWith={openWith} />
      ) : showThreadOnly ? (
        <div ref={pane.ref} style={pane.style} className="-mt-4 flex min-h-[20rem] flex-col">
          {threadPane}
        </div>
      ) : (
        <div ref={pane.ref} style={pane.style} className="flex min-h-[24rem] gap-4 lg:gap-6">
          <aside aria-label="Conversation list" className="card flex w-72 shrink-0 flex-col overflow-hidden lg:w-[22.5rem]">
            <RoomList rooms={rooms} meId={meId} activeId={roomId && !isDraft ? roomId : null} compact={false} onNewMessage={() => setPickerOpen(true)} onOpenWith={openWith} />
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
