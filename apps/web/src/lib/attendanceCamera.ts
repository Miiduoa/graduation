import { attendanceCameraError, parseAttendanceQr, type AttendanceQrScope } from './attendanceQr';

type Decoder = (data: Uint8ClampedArray, width: number, height: number,
  options: { inversionAttempts: 'dontInvert' }) => { data: string } | null;
type CameraOptions = AttendanceQrScope & {
  video: HTMLVideoElement;
  onReady: () => void;
  onDetected: (token: string) => void;
  onHint: (message: string) => void;
  onError: (message: string) => void;
  onPaused: (message: string) => void;
};
const loadDecoder = async (): Promise<Decoder> => (await import('jsqr')).default;

/** 影像只在裝置內解碼；取消、離頁或辨識完成時立即釋放相機。 */
export function startAttendanceCamera(options: CameraOptions, decoderLoader = loadDecoder): () => void {
  let stopped = false;
  let stream: MediaStream | null = null;
  let frame: number | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let track: MediaStreamTrack | undefined;
  let lastRead = -Infinity;
  const release = (media: MediaStream) => media.getTracks().forEach((item) => item.stop());
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timeout);
    if (frame !== null) window.cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', hide);
    track?.removeEventListener('ended', ended);
    if (stream) release(stream);
    options.video.srcObject = null;
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  };
  const pause = (message: string) => {
    if (stopped) return;
    stop();
    options.onPaused(message);
  };
  const hide = () => pause('相機已關閉。回到課堂後，請再按一次「開啟相機掃碼」。');
  const visibility = () => { if (document.visibilityState === 'hidden') hide(); };
  const ended = () => {
    if (stopped) return;
    stop();
    options.onError('相機已中斷，請重新開啟或改用下方簽到碼。');
  };
  const timeout = window.setTimeout(() => pause('掃描已暫停。請靠近 QR Code 後重新開啟相機，或輸入簽到碼。'), 60_000);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', hide);

  async function start() {
    // 先交還控制權，讓呼叫端取得取消函式；不支援相機時也能安全重試。
    await Promise.resolve();
    if (stopped) return;
    try {
      if (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
        stop();
        options.onError('此瀏覽器無法開啟相機，請使用 HTTPS 網址的一般瀏覽器，或輸入簽到碼。');
        return;
      }
      if (document.visibilityState === 'hidden') { hide(); return; }
      const decode = await decoderLoader();
      if (stopped) return;
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 },
          height: { ideal: 720 }, frameRate: { ideal: 15, max: 24 } },
      });
      // 使用者可能在權限視窗尚未回應前，就關閉掃描或切換帳號。
      if (stopped) { release(acquired); return; }
      stream = acquired;
      track = stream.getVideoTracks()[0];
      track?.addEventListener('ended', ended);
      options.video.srcObject = stream;
      await options.video.play();
      if (stopped) return;
      canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas unavailable');
      const drawing = context;
      options.onReady();
      function scan(now: number) {
        if (stopped || !canvas) return;
        try {
          const video = options.video;
          if (now - lastRead >= 150 && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
            lastRead = now;
            const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            drawing.drawImage(video, 0, 0, canvas.width, canvas.height);
            const pixels = drawing.getImageData(0, 0, canvas.width, canvas.height);
            const found = decode(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' });
            if (found) {
              const result = parseAttendanceQr(found.data, options);
              if (result.ok) {
                stop();
                options.onDetected(result.token);
                return;
              }
              options.onHint(result.message);
            }
          }
          frame = window.requestAnimationFrame(scan);
        } catch (problem) {
          if (!stopped) { stop(); options.onError(attendanceCameraError(problem)); }
        }
      }
      frame = window.requestAnimationFrame(scan);
    } catch (problem) {
      if (!stopped) { stop(); options.onError(attendanceCameraError(problem)); }
    }
  }
  void start();
  return stop;
}
