import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startAttendanceCamera } from './attendanceCamera';

let video: HTMLVideoElement;
let track: MediaStreamTrack;
let media: MediaStream;
const stopTrack = vi.fn();
const getUserMedia = vi.fn<() => Promise<MediaStream>>();
const decode = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
const options = () => ({
  groupId: 'course-a', sessionId: 'session-a', video,
  onReady: vi.fn(), onDetected: vi.fn(), onHint: vi.fn(), onError: vi.fn(), onPaused: vi.fn(),
});
const loader = async () => decode;
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
function tick(time = 200) {
  const first = frames.entries().next().value;
  if (!first) throw new Error('No scheduled camera frame');
  frames.delete(first[0]);
  first[1](time);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  frames.clear();
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    id += 1; frames.set(id, callback); return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => { frames.delete(frame); });
  video = document.createElement('video');
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 2 },
    videoWidth: { configurable: true, value: 1280 },
    videoHeight: { configurable: true, value: 720 },
  });
  vi.spyOn(video, 'play').mockResolvedValue(undefined);
  track = Object.assign(new EventTarget(), { stop: stopTrack }) as unknown as MediaStreamTrack;
  media = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  getUserMedia.mockResolvedValue(media);
  decode.mockReturnValue(null);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4), width, height,
    }),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('requests only video, releases it after a matching code, and does not emit twice', async () => {
  const callbacks = options();
  const stop = startAttendanceCamera(callbacks, loader);
  await flush();
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
  decode.mockReturnValue({ data: JSON.stringify({ groupId: 'course-a', sessionId: 'session-a', qrToken: 'secret' }) });
  tick();
  expect(callbacks.onDetected).toHaveBeenCalledExactlyOnceWith('secret');
  expect(stopTrack).toHaveBeenCalledTimes(1);
  expect(video.srcObject).toBeNull();
  expect(frames.size).toBe(0);
  stop();
  expect(stopTrack).toHaveBeenCalledTimes(1);
});
it('keeps scanning a wrong class or old session without emitting a token', async () => {
  const callbacks = options();
  const stop = startAttendanceCamera(callbacks, loader);
  await flush();
  decode.mockReturnValue({ data: JSON.stringify({ groupId: 'other', sessionId: 'session-a', qrToken: 'secret' }) });
  tick();
  expect(callbacks.onHint).toHaveBeenCalledWith(expect.stringContaining('另一堂課'));
  expect(callbacks.onDetected).not.toHaveBeenCalled();
  expect(stopTrack).not.toHaveBeenCalled();
  stop();
});
it('releases a permission response that arrives after cancellation', async () => {
  let resolve!: (stream: MediaStream) => void;
  getUserMedia.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const callbacks = options();
  const stop = startAttendanceCamera(callbacks, loader);
  await flush();
  stop();
  resolve(media);
  await flush();
  expect(stopTrack).toHaveBeenCalledTimes(1);
  expect(video.srcObject).toBeNull();
  expect(callbacks.onReady).not.toHaveBeenCalled();
});
it('cancels before decoder loading without asking for camera permission', async () => {
  const callbacks = options();
  const stop = startAttendanceCamera(callbacks, loader);
  stop();
  await flush();
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(callbacks.onError).not.toHaveBeenCalled();
});
it('stops on backgrounding and does not restart without another user gesture', async () => {
  const callbacks = options();
  startAttendanceCamera(callbacks, loader);
  await flush();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(stopTrack).toHaveBeenCalledTimes(1);
  expect(callbacks.onPaused).toHaveBeenCalledTimes(1);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(getUserMedia).toHaveBeenCalledTimes(1);
});
it('stops on page navigation and device disconnection', async () => {
  const callbacks = options();
  startAttendanceCamera(callbacks, loader);
  await flush();
  track.dispatchEvent(new Event('ended'));
  expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('相機已中斷'));
  window.dispatchEvent(new Event('pagehide'));
  expect(stopTrack).toHaveBeenCalledTimes(1);
});
it('limits decode resolution and frequency rather than processing every full-resolution frame', async () => {
  const stop = startAttendanceCamera(options(), loader);
  await flush();
  tick(0); tick(50); tick(100); tick(151);
  expect(decode).toHaveBeenCalledTimes(2);
  expect(decode.mock.calls[0].slice(1, 3)).toEqual([640, 360]);
  stop();
});
it('pauses after one minute and cancels further frames', async () => {
  const callbacks = options();
  startAttendanceCamera(callbacks, loader);
  await flush();
  vi.advanceTimersByTime(60_000);
  expect(stopTrack).toHaveBeenCalledTimes(1);
  expect(callbacks.onPaused).toHaveBeenCalledWith(expect.stringContaining('掃描已暫停'));
  expect(frames.size).toBe(0);
});
it('handles denied permission without exposing device diagnostics', async () => {
  getUserMedia.mockRejectedValueOnce({ name: 'NotAllowedError', message: 'sensitive device name' });
  const callbacks = options();
  startAttendanceCamera(callbacks, loader);
  await flush();
  expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('尚未允許相機權限'));
  expect(callbacks.onReady).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});
it('releases the camera if playing video or decoding fails', async () => {
  vi.mocked(video.play).mockRejectedValueOnce(new Error('camera failure'));
  const callbacks = options();
  startAttendanceCamera(callbacks, loader);
  await flush();
  expect(stopTrack).toHaveBeenCalledTimes(1);
  expect(callbacks.onError).toHaveBeenCalledTimes(1);
});
it('fails closed on insecure pages without requesting permission', async () => {
  vi.stubGlobal('isSecureContext', false);
  const callbacks = options();
  startAttendanceCamera(callbacks, loader);
  await flush();
  expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('HTTPS'));
  expect(getUserMedia).not.toHaveBeenCalled();
});
