import { API_BASE, tokenStore } from './api';
import {
  HOST_MEDIA_CONSTRAINTS,
  RELAXED_MEDIA_CONSTRAINTS,
  checkLiveVideoSupport,
  deviceMediaConstraints,
  describeMediaError,
  peerConfiguration,
  type DescribedMediaError,
  type LivestreamIceServer,
  type LiveVideoSupport,
} from './livestream';

/**
 * The browser-bound half of live video: camera capture, peer construction and
 * the one request that must survive a page unload. Everything decision-like
 * lives in ./livestream so it can be unit tested; this file only touches the
 * DOM APIs.
 */

export function liveVideoSupport(): LiveVideoSupport {
  return checkLiveVideoSupport({
    secureContext: typeof window !== 'undefined' && window.isSecureContext === true,
    hasUserMedia: typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
    hasPeerConnection: typeof RTCPeerConnection === 'function',
  });
}

export class MediaCaptureError extends Error {
  readonly described: DescribedMediaError;

  constructor(cause: unknown) {
    const described = describeMediaError(cause);
    super(described.message);
    this.name = 'MediaCaptureError';
    this.described = described;
  }
}

/**
 * Capture camera and microphone with the mobile client's constraints. Desktop
 * webcams often cannot satisfy a portrait 720x1280 request and answer with
 * OverconstrainedError, so that one case retries at the camera's own size
 * rather than failing the broadcast.
 */
export async function captureHostMedia(deviceId?: string): Promise<MediaStream> {
  const first = deviceId ? deviceMediaConstraints(deviceId) : HOST_MEDIA_CONSTRAINTS;
  try {
    return await navigator.mediaDevices.getUserMedia(first as MediaStreamConstraints);
  } catch (error) {
    const described = describeMediaError(error);
    if (described.code !== 'constraints') throw new MediaCaptureError(error);
    try {
      const relaxed = deviceId
        ? { audio: true, video: { deviceId: { exact: deviceId } } }
        : RELAXED_MEDIA_CONSTRAINTS;
      return await navigator.mediaDevices.getUserMedia(relaxed as MediaStreamConstraints);
    } catch (retryError) {
      throw new MediaCaptureError(retryError);
    }
  }
}

/** Disable before stopping so the last frame is not sent to peers as a freeze. */
export function stopMedia(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    track.enabled = false;
    track.stop();
  });
}

export type CameraOption = { deviceId: string; label: string };

/** Cameras the host may switch to. Labels are only available after a permission grant. */
export async function listCameras(): Promise<CameraOption[]> {
  if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.enumerateDevices !== 'function') return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput' && d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}

export function createPeer(iceServers: LivestreamIceServer[]): RTCPeerConnection {
  return new RTCPeerConnection(peerConfiguration(iceServers) as RTCConfiguration);
}

/**
 * End a broadcast as the page goes away. Axios requests are aborted by
 * navigation; fetch with `keepalive` completes afterwards and carries the
 * bearer token explicitly. Best-effort: the server's expiry monitor is the
 * backstop if this never lands.
 */
export function endLivestreamOnUnload(streamId: string): void {
  const token = tokenStore.get();
  if (!token || !streamId) return;
  try {
    void fetch(`${API_BASE.replace(/\/$/, '')}/livestreams/${encodeURIComponent(streamId)}/end`, {
      method: 'PUT',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, 'X-Platform': 'web' },
    }).catch(() => undefined);
  } catch {
    // Nothing else to do during unload.
  }
}

/** Mark the viewer as gone as the page goes away; same reasoning as endLivestreamOnUnload. */
export function leaveLivestreamOnUnload(streamId: string): void {
  const token = tokenStore.get();
  if (!token || !streamId) return;
  try {
    void fetch(`${API_BASE.replace(/\/$/, '')}/livestreams/${encodeURIComponent(streamId)}/leave`, {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, 'X-Platform': 'web' },
    }).catch(() => undefined);
  } catch {
    // Nothing else to do during unload.
  }
}
