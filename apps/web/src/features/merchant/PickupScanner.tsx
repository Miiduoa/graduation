'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';

const validToken = (value: string) => /^[A-Za-z0-9_-]{32,512}$/.test(value);

/** Scanning only fills the credential; the merchant still confirms physical handover. */
export function PickupScanner({
  disabled,
  onToken,
}: {
  disabled: boolean;
  onToken: (token: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const callback = useRef(onToken);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);
  const release = useCallback(() => {
    generation.current++;
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);
  const stop = useCallback(() => {
    release();
    setRunning(false);
  }, [release]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) stop();
    };
    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', hide);
    return () => {
      release();
      setRunning(false);
      window.removeEventListener('pagehide', stop);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [disabled, release, stop]);
  const accept = (value: string, run: number) => {
    if (run !== generation.current) return;
    if (!validToken(value)) {
      setMessage('這不是取餐憑證，請掃描顧客訂單中的取餐 QR Code。');
      return;
    }
    stop();
    callback.current(value);
    setMessage('已讀取憑證。請核對餐點，再確認交付。');
  };
  const start = async () => {
    if (disabled) return;
    release();
    const run = generation.current;
    setMessage('');
    setRunning(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (run !== generation.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const element = video.current;
      if (!element) {
        stop();
        return;
      }
      element.srcObject = media;
      await element.play();
      const { default: decode } = await import('jsqr');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas unavailable');
      const scan = () => {
        if (run !== generation.current) return;
        try {
          if (element.videoWidth && element.videoHeight) {
            const scale = Math.min(1, 960 / Math.max(element.videoWidth, element.videoHeight));
            canvas.width = Math.max(1, Math.round(element.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(element.videoHeight * scale));
            context.drawImage(element, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = decode(pixels.data, pixels.width, pixels.height);
            if (code) accept(code.data, run);
          }
          if (run === generation.current) timer.current = setTimeout(scan, 250);
        } catch {
          if (run !== generation.current) return;
          stop();
          setMessage('相機讀取中斷，請重試，或選擇取餐碼圖片。');
        }
      };
      scan();
    } catch {
      if (run !== generation.current) return;
      stop();
      setMessage('無法開啟相機。請允許相機權限，或選擇取餐碼圖片。也可以使用掃碼器輸入憑證。');
    }
  };
  const readImage = async (file?: File) => {
    if (!file || disabled) return;
    stop();
    const run = generation.current;
    setMessage('正在讀取取餐碼…');
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    ) {
      setMessage('請選擇 8 MB 以內的 PNG、JPEG 或 WebP 圖片。');
      return;
    }
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      if (run !== generation.current) return;
      if (bitmap.width * bitmap.height > 16_000_000) throw new Error('Image too large');
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const { default: decode } = await import('jsqr');
      if (run !== generation.current) return;
      const code = decode(pixels.data, pixels.width, pixels.height);
      if (code) accept(code.data, run);
      else setMessage('圖片中找不到取餐碼，請選擇清楚、完整的 QR Code。');
    } catch {
      if (run === generation.current) setMessage('無法讀取這張圖片，請換一張清楚的取餐碼圖片。');
    } finally {
      bitmap?.close();
    }
  };
  return (
    <div>
      <Button disabled={disabled} onClick={() => void start()}>
        掃描取餐 QR Code
      </Button>
      {running && !disabled && (
        <div>
          <video
            ref={video}
            muted
            playsInline
            aria-label="取餐碼掃描相機"
            style={{ width: '100%', maxWidth: 400 }}
          />
          <Button onClick={stop}>關閉相機</Button>
        </div>
      )}
      <label style={{ display: 'block', marginTop: 12 }}>
        選擇取餐碼圖片
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void readImage(file);
          }}
        />
      </label>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
