import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg, mediaUrl, ORIGIN_BASE, tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  Spinner,
  Textarea,
  useToast,
} from './ui';
import { MessageCircle, Search, Trash, X } from './icons';

/* ------------------------------------------------------------------ types */

type ChatUser = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
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
    media?: { uri: string; type: string }[];
  } | null;
  totalUnread?: number;
  updatedAt?: string;
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
  media?: { uri: string; type: string }[];
  isGroup?: boolean;
  targetId?: string;
};

const idOf = (v: unknown): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const o = v as { _id?: string };
  return o._id ? String(o._id) : '';
};

const roomTitle = (room: ChatRoom): string =>
  room.displayInfo?.name ||
  room.roomName ||
  room.participants?.map((p) => p.fullName || p.username).filter(Boolean).join(', ') ||
  'Conversation';

const roomAvatar = (room: ChatRoom): string =>
  room.displayInfo?.avatar || room.roomAvatar || '';

const previewOf = (room: ChatRoom): string => {
  const lm = room.lastMessage;
  if (!lm) return 'No messages yet';
  if (lm.text) return lm.text;
  if (lm.media?.length) return `${lm.media.length} attachment(s)`;
  return 'No messages yet';
};

const when = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return '';
  }
};

/* --------------------------------------------------------------- realtime */

function useChatSocket(onMessage: (m: ChatMessage) => void, onRoomUpdate: () => void) {
  const [connected, setConnected] = useState(false);
  const msgRef = useRef(onMessage);
  const roomRef = useRef(onRoomUpdate);
  msgRef.current = onMessage;
  roomRef.current = onRoomUpdate;

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) return;
    let socket: Socket | null = null;
    try {
      socket = io(ORIGIN_BASE || '/', {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        timeout: 8000,
      });
    } catch {
      // Realtime is an enhancement: the page stays fully usable over HTTP.
      return;
    }
    const handleMessage = (payload: ChatMessage) => msgRef.current(payload);
    const handleRooms = () => roomRef.current();

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('error', () => setConnected(false));
    socket.on('message', handleMessage);
    socket.on('newMessage', handleMessage);
    socket.on('chatRoomUpdate', handleRooms);
    socket.on('newGroupChat', handleRooms);

    return () => {
      socket?.off('message', handleMessage);
      socket?.off('newMessage', handleMessage);
      socket?.off('chatRoomUpdate', handleRooms);
      socket?.off('newGroupChat', handleRooms);
      socket?.disconnect();
    };
  }, []);

  return connected;
}

/* ------------------------------------------------------------ new group UI */

function NewGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<ChatUser[]>([]);

  useEffect(() => {
    if (!open) {
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

  const visible = useMemo(() => {
    const list = friends.data || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) =>
      `${u.fullName || ''} ${u.username || ''}`.toLowerCase().includes(q),
    );
  }, [friends.data, search]);

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/messages/create-group', {
        participants: picked.map((p) => p._id),
        roomName: name.trim(),
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Group created');
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not create the group')),
  });

  const toggle = (u: ChatUser) =>
    setPicked((prev) =>
      prev.some((p) => p._id === u._id)
        ? prev.filter((p) => p._id !== u._id)
        : [...prev, u],
    );

  const valid = name.trim().length >= 1 && name.trim().length <= 100 && picked.length >= 2;

  return (
    <Modal open={open} onClose={onClose} title="New group chat">
      <div className="space-y-4">
        <Input
          placeholder="Group name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          placeholder="Search friends"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="text-xs text-[var(--color-muted)]">
          Pick at least 2 people ({picked.length} selected).
        </p>
        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {friends.isLoading &&
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          {friends.isError && (
            <ErrorState message={errMsg(friends.error)} onRetry={() => friends.refetch()} />
          )}
          {friends.isSuccess && visible.length === 0 && (
            <EmptyState title="No friends found" description="Add friends to start a group." />
          )}
          {visible.map((u) => {
            const on = picked.some((p) => p._id === u._id);
            return (
              <button
                key={u._id}
                type="button"
                onClick={() => toggle(u)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                  on ? 'bg-[var(--color-surface-2)]' : 'hover:bg-[var(--color-surface-2)]'
                }`}
              >
                <Avatar src={mediaUrl(u.avatar)} name={u.fullName || u.username} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {u.fullName || u.username}
                  </span>
                  <span className="block truncate text-xs text-[var(--color-muted)]">
                    @{u.username}
                  </span>
                </span>
                {on && <Badge>Selected</Badge>}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner size={16} /> : 'Create group'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- thread */

function Thread({
  room,
  incoming,
  onSent,
}: {
  room: ChatRoom;
  incoming: ChatMessage[];
  onSent: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const [text, setText] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const isGroup = Boolean(room.isGroup || room.displayInfo?.isGroup);
  const peer = room.displayInfo?.otherUser
    || room.participants?.find((p) => p._id !== me?._id);

  const thread = useQuery({
    queryKey: ['thread', room._id, isGroup, peer?._id],
    queryFn: async () => {
      if (isGroup) {
        const { data } = await api.get(`/messages/conversation/${room._id}`, {
          params: { isGroup: 'true' },
        });
        return (data.messages || []) as ChatMessage[];
      }
      if (peer?._id) {
        const { data } = await api.get(`/messages/conversation/${peer._id}`);
        return (data.messages || []) as ChatMessage[];
      }
      const { data } = await api.get(`/messages/rooms/${room._id}`);
      return (data.messages || []) as ChatMessage[];
    },
  });

  // Merge socket deliveries addressed to this room with the fetched history.
  const merged = useMemo(() => {
    const base = thread.data || [];
    const seen = new Set(base.map((m) => m._id));
    const extra = incoming.filter((m) => {
      if (seen.has(m._id)) return false;
      const rid = idOf(m.chatRoom) || m.targetId || '';
      return rid === room._id;
    });
    return [...base, ...extra];
  }, [thread.data, incoming, room._id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [merged.length, room._id]);

  const markRead = useMutation({
    mutationFn: async (messageIds: string[]) => {
      await api.put('/messages/read', { messageIds });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      qc.invalidateQueries({ queryKey: ['unreadChats'] });
    },
  });

  // Acknowledge anything addressed to this viewer that is still unread.
  const unreadIds = useMemo(() => {
    if (!me?._id) return [];
    return merged
      .filter(
        (m) =>
          idOf(m.sender) !== me._id &&
          !(m.readers || []).map(String).includes(me._id),
      )
      .map((m) => m._id)
      .filter(Boolean);
  }, [merged, me?._id]);

  const ackRef = useRef<string>('');
  useEffect(() => {
    if (!unreadIds.length) return;
    const key = unreadIds.join(',');
    if (ackRef.current === key) return;
    ackRef.current = key;
    markRead.mutate(unreadIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadIds]);

  const send = useMutation({
    mutationFn: async (body: string) => {
      const payload = isGroup || !peer?._id
        ? { chatRoomId: room._id, text: body }
        : { receiverIds: [peer._id], text: body };
      const { data } = await api.post('/messages/send', payload);
      return data;
    },
    onSuccess: () => {
      setText('');
      thread.refetch();
      onSent();
    },
    onError: (e) => toast.error(errMsg(e, 'Message could not be sent')),
  });

  const remove = useMutation({
    mutationFn: async (messageId: string) => {
      await api.delete(`/messages/${messageId}`);
    },
    onSuccess: () => {
      toast.success('Message deleted');
      setPendingDelete(null);
      thread.refetch();
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not delete the message'));
      setPendingDelete(null);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || body.length > 2000 || send.isPending) return;
    send.mutate(body);
  };

  return (
    <section className="card flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <Avatar src={mediaUrl(roomAvatar(room))} name={roomTitle(room)} size={40} />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{roomTitle(room)}</h2>
          <p className="truncate text-xs text-[var(--color-muted)]">
            {isGroup
              ? `${room.participants?.length ?? 0} members`
              : peer?.username
                ? `@${peer.username}`
                : 'Direct message'}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {thread.isLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className={`h-12 ${i % 2 ? 'w-1/2' : 'w-2/3'}`} />
          ))}
        {thread.isError && (
          <ErrorState message={errMsg(thread.error)} onRetry={() => thread.refetch()} />
        )}
        {thread.isSuccess && merged.length === 0 && (
          <EmptyState
            icon={<MessageCircle />}
            title="No messages yet"
            description="Say hello to start the conversation."
          />
        )}
        {merged.map((m) => {
          const mine = idOf(m.sender) === me?._id;
          const sender = typeof m.sender === 'object' ? (m.sender as ChatUser) : undefined;
          return (
            <div key={m._id} className={`flex gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
              {!mine && (
                <Avatar
                  src={mediaUrl(sender?.avatar)}
                  name={sender?.fullName || sender?.username}
                  size={30}
                />
              )}
              <div className={`max-w-[75%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                {isGroup && !mine && (
                  <span className="mb-1 text-[11px] text-[var(--color-muted)]">
                    {sender?.fullName || sender?.username || 'Member'}
                  </span>
                )}
                <div
                  className={`rounded-2xl px-3 py-2 text-sm ${
                    mine
                      ? 'bg-[var(--color-brand)] text-[#08080d]'
                      : 'bg-[var(--color-surface-2)] text-[#f4f4f6]'
                  }`}
                >
                  {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                  {m.media?.map((att, i) =>
                    att.type === 'video' ? (
                      <video
                        key={i}
                        src={mediaUrl(att.uri)}
                        controls
                        className="mt-2 max-h-64 rounded-lg"
                      />
                    ) : (
                      <img
                        key={i}
                        src={mediaUrl(att.uri)}
                        alt="attachment"
                        className="mt-2 max-h-64 rounded-lg object-cover"
                      />
                    ),
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[11px] text-[var(--color-muted)]">
                    {when(m.createdAt)}
                  </span>
                  {mine && (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(m._id)}
                      className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={submit}
        className="flex items-end gap-2 border-t border-[var(--color-line)] px-4 py-3"
      >
        <Textarea
          rows={1}
          value={text}
          maxLength={2000}
          placeholder="Write a message…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(e as unknown as React.FormEvent);
            }
          }}
        />
        <Button type="submit" disabled={!text.trim() || send.isPending}>
          {send.isPending ? <Spinner size={16} /> : 'Send'}
        </Button>
      </form>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete message"
        description="This message will be removed from the conversation."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </section>
  );
}

/* ------------------------------------------------------------------- page */

export default function Messages() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [live, setLive] = useState<ChatMessage[]>([]);

  const rooms = useQuery({
    queryKey: ['chatRooms'],
    queryFn: async () => {
      const { data } = await api.get('/messages/me/all/recent/rooms', {
        params: { status: 'active', limit: 50 },
      });
      return (data.chatRooms || []) as ChatRoom[];
    },
    refetchInterval: 60000,
  });

  const unread = useQuery({
    queryKey: ['unreadChats'],
    queryFn: async () => {
      const { data } = await api.get('/messages/me/all/chats/rooms/unread/count');
      return Number(data.totalUnreadChats || 0);
    },
    refetchInterval: 60000,
  });

  const handleSocketMessage = useCallback(
    (m: ChatMessage) => {
      setLive((prev) => (prev.some((x) => x._id === m._id) ? prev : [...prev, m]));
      qc.invalidateQueries({ queryKey: ['chatRooms'] });
      qc.invalidateQueries({ queryKey: ['unreadChats'] });
    },
    [qc],
  );
  const handleRoomUpdate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['chatRooms'] });
  }, [qc]);

  const connected = useChatSocket(handleSocketMessage, handleRoomUpdate);

  const list = useMemo(() => {
    const all = rooms.data || [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => roomTitle(r).toLowerCase().includes(q));
  }, [rooms.data, search]);

  useEffect(() => {
    if (!activeId && list.length) setActiveId(list[0]._id);
  }, [list, activeId]);

  const active = useMemo(
    () => (rooms.data || []).find((r) => r._id === activeId) || null,
    [rooms.data, activeId],
  );

  return (
    <div className="mx-auto flex h-[calc(100vh-5rem)] w-full max-w-6xl gap-4 px-4 py-4">
      <aside className="card flex w-full max-w-sm flex-col md:w-80">
        <div className="space-y-3 border-b border-[var(--color-line)] p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Messages</h1>
            <div className="flex items-center gap-2">
              {unread.data ? <Badge>{unread.data} unread</Badge> : null}
              <span
                title={connected ? 'Realtime connected' : 'Realtime unavailable'}
                className={`inline-block h-2 w-2 rounded-full ${
                  connected ? 'bg-emerald-400' : 'bg-[var(--color-line)]'
                }`}
              />
            </div>
          </div>
          <Input
            placeholder="Search conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button className="w-full" variant="ghost" onClick={() => setGroupOpen(true)}>
            New group
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {rooms.isLoading &&
            Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="mb-2 h-16 w-full" />
            ))}
          {rooms.isError && (
            <ErrorState message={errMsg(rooms.error)} onRetry={() => rooms.refetch()} />
          )}
          {rooms.isSuccess && list.length === 0 && (
            <EmptyState
              icon={<MessageCircle />}
              title="No conversations"
              description="Start chatting with friends or create a group."
            />
          )}
          {list.map((room) => (
            <button
              key={room._id}
              type="button"
              onClick={() => setActiveId(room._id)}
              className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                room._id === activeId
                  ? 'bg-[var(--color-surface-2)]'
                  : 'hover:bg-[var(--color-surface-2)]'
              }`}
            >
              <Avatar src={mediaUrl(roomAvatar(room))} name={roomTitle(room)} size={42} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{roomTitle(room)}</span>
                  <span className="shrink-0 text-[11px] text-[var(--color-muted)]">
                    {when(room.lastMessage?.createdAt || room.updatedAt)}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-[var(--color-muted)]">
                    {previewOf(room)}
                  </span>
                  {room.totalUnread ? <Badge>{room.totalUnread}</Badge> : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      {active ? (
        <Thread
          key={active._id}
          room={active}
          incoming={live}
          onSent={() => {
            qc.invalidateQueries({ queryKey: ['chatRooms'] });
          }}
        />
      ) : (
        <section className="card hidden flex-1 items-center justify-center md:flex">
          <EmptyState
            icon={<MessageCircle />}
            title="Select a conversation"
            description="Choose a chat on the left to read and reply."
          />
        </section>
      )}

      <NewGroupModal open={groupOpen} onClose={() => setGroupOpen(false)} />
    </div>
  );
}
