'use client';
import { useEffect, useRef, useState } from 'react';
export function ClubScanner({ onCode }: { onCode: (code: string) => void }) {
  const [running, setRunning] = useState(false),
    [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null),
    callback = useRef(onCode);
  useEffect(() => {
    callback.current = onCode;
  }, [onCode]);
  useEffect(() => {
    if (!running) return;
    let cancelled = false,
      stream: MediaStream | undefined,
      frame = 0;
    function stop() {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      if (video.current) video.current.srcObject = null;
    }
    const hide = () => {
      if (document.hidden) {
        stop();
        setRunning(false);
      }
    };
    document.addEventListener('visibilitychange', hide);
    void (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        if (!video.current) {
          stop();
          return;
        }
        video.current.srcObject = media;
        await video.current.play();
        const { default: decode } = await import('jsqr');
        if (cancelled) return;
        const canvas = document.createElement('canvas'),
          context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('camera');
        let last = 0;
        const scan = (time: number) => {
          if (cancelled) return;
          const element = video.current;
          try {
            if (element && element.readyState >= 2 && element.videoWidth && time - last >= 150) {
              last = time;
              const scale = Math.min(1, 640 / element.videoWidth);
              canvas.width = Math.round(element.videoWidth * scale);
              canvas.height = Math.round(element.videoHeight * scale);
              context.drawImage(element, 0, 0, canvas.width, canvas.height);
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height),
                code = decode(pixels.data, pixels.width, pixels.height);
              if (code?.data.startsWith('nuni-club:')) {
                stop();
                setRunning(false);
                callback.current(code.data);
                return;
              }
            }
            frame = requestAnimationFrame(scan);
          } catch {
            stop();
            setRunning(false);
            setError('無法讀取相機，請改輸入後四碼。');
          }
        };
        frame = requestAnimationFrame(scan);
      } catch {
        if (!cancelled) {
          stop();
          setRunning(false);
          setError('無法開啟相機，請改輸入後四碼。');
        }
      }
    })();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [running]);
  return (
    <div>
      <button
        className="btn"
        onClick={() => {
          setError('');
          setRunning(!running);
        }}
      >
        {running ? '停止相機' : '相機掃描 QR'}
      </button>
      {running && (
        <video
          ref={video}
          playsInline
          muted
          style={{ maxWidth: '100%' }}
          aria-label="簽到掃描相機"
        />
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
