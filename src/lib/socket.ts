import { io, type Socket } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { ORIGIN_BASE, tokenStore } from './api';

/**
 * One authenticated Socket.IO connection for the whole app.
 *
 * The server keys presence, chat delivery and live-video rooms by socket, and
 * `updateUserOnlineStatus` flips the user offline when their last socket
 * drops. Two pages each holding their own connection therefore double the
 * handshake cost and make online status flicker on navigation. Messages and
 * Live share this instance; each page adds and removes only its own
 * listeners and never disconnects the socket itself.
 *
 * Authentication mirrors utils/socketServer.js: the bearer token travels in
 * the handshake `auth.token`. It is read lazily on every (re)connection so a
 * token refreshed elsewhere is picked up without rebuilding the socket.
 */

type SocketStatus = {
  connected: boolean;
  /** The server refused the handshake token; automatic retries stop until `getSocket()` is asked again. */
  unauthorized: boolean;
};

export const useSocketStatus = create<SocketStatus>(() => ({ connected: false, unauthorized: false }));

let shared: Socket | null = null;

function socketUrl(): string {
  // Same-origin in production (Caddy proxies /socket.io); VITE_API_BASE points
  // dev builds at another origin, in which case ORIGIN_BASE is that origin.
  return ORIGIN_BASE || window.location.origin;
}

function attachStatus(socket: Socket) {
  socket.on('connect', () => useSocketStatus.setState({ connected: true, unauthorized: false }));
  socket.on('disconnect', () => useSocketStatus.setState({ connected: false }));
  socket.on('connect_error', (error) => {
    const code = (error as { data?: { code?: string } } | undefined)?.data?.code;
    useSocketStatus.setState({ connected: false, unauthorized: code === 'UNAUTHORIZED' });
  });
}

/**
 * The shared socket, created on first use. Returns null when there is no
 * session to authenticate with; callers treat realtime as an enhancement and
 * stay usable over HTTP.
 */
export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  if (!tokenStore.get()) return null;
  if (!shared) {
    try {
      shared = io(socketUrl(), {
        auth: (cb) => cb({ token: tokenStore.get() ?? '' }),
        transports: ['websocket', 'polling'],
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10_000,
        timeout: 10_000,
      });
    } catch {
      return null;
    }
    attachStatus(shared);
  } else if (!shared.active) {
    // A middleware rejection (expired or revoked token) stops Socket.IO's own
    // retries; asking again re-reads the token store and reconnects.
    shared.connect();
  }
  return shared;
}

/** Tear the connection down. Called on sign-out so the socket never outlives the session it authenticated with. */
export function disposeSocket(): void {
  if (!shared) return;
  shared.removeAllListeners();
  shared.disconnect();
  shared = null;
  useSocketStatus.setState({ connected: false, unauthorized: false });
}

/** The shared socket plus its live connection state, for components. */
export function useSharedSocket(): { socket: Socket | null; connected: boolean; unauthorized: boolean } {
  const connected = useSocketStatus((s) => s.connected);
  const unauthorized = useSocketStatus((s) => s.unauthorized);
  const [socket, setSocket] = useState<Socket | null>(() => getSocket());

  useEffect(() => {
    const current = getSocket();
    if (current !== socket) setSocket(current);
    if (current) useSocketStatus.setState({ connected: current.connected });
  }, [socket]);

  return { socket, connected, unauthorized };
}
