'use client';

import { useEffect, useRef, useState } from 'react';
import { startAttendanceCamera } from '@/lib/attendanceCamera';
import { Button } from './ui/Button';
import styles from './attendance-qr-scanner.module.css';

type Props = {
  groupId: string;
  sessionId: string;
  disabled?: boolean;
  onToken: (token: string) => void;
};

export function AttendanceQrScanner(props: Props) {
  // 切換課程、場次或送出簽到時，不沿用上一個相機工作階段。
  return <CameraCapture key={`${props.groupId}:${props.sessionId}:${!!props.disabled}`} {...props} />;
}

function CameraCapture({ groupId, sessionId, disabled, onToken }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stopCamera = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'scanning' | 'detected' | 'paused' | 'error'>('idle');
  const [message, setMessage] = useState('不必手動輸入長碼；對準老師的 QR Code 即可帶入。');
  const running = phase === 'starting' || phase === 'scanning';
  useEffect(() => () => { stopCamera.current?.(); }, []);

  function start() {
    if (disabled || !video.current || stopCamera.current) return;
    setPhase('starting');
    setMessage('正在開啟相機，請允許此網站使用相機。');
    stopCamera.current = startAttendanceCamera({
      groupId, sessionId, video: video.current,
      onReady: () => { setPhase('scanning'); setMessage('請把本次點名的 QR Code 完整放進畫面。'); },
      onHint: (hint) => setMessage(hint),
      onDetected: (token) => {
        stopCamera.current = null;
        setPhase('detected');
        setMessage('已讀取這堂課的簽到碼。請按「確認簽到」，等待系統確認。');
        onToken(token);
      },
      onError: (error) => { stopCamera.current = null; setPhase('error'); setMessage(error); },
      onPaused: (hint) => { stopCamera.current = null; setPhase('paused'); setMessage(hint); },
    });
  }
  function cancel() {
    stopCamera.current?.();
    stopCamera.current = null;
    setPhase('paused');
    setMessage('相機已關閉，可以重新掃描或直接輸入下方簽到碼。');
  }
  return (
    <div className={styles.scanner} aria-label="掃描課堂簽到碼">
      <div className={styles.heading}>
        <div><strong>用相機掃碼</strong><p>僅辨識這堂課、這次點名的 QR Code。</p></div>
        {running ? (
          <Button type="button" variant="outline" onClick={cancel}>關閉相機</Button>
        ) : (
          <Button type="button" variant="outline" disabled={disabled} onClick={start}>開啟相機掃碼</Button>
        )}
      </div>
      <video ref={video} muted playsInline hidden={!running}
        className={styles.preview} aria-label="課堂 QR Code 相機預覽" />
      <p className={phase === 'error' ? styles.error : styles.status}
        role={phase === 'error' ? 'alert' : 'status'}>{message}</p>
      <small className={styles.privacy}>影像只在裝置內辨識，不會上傳或保存；掃碼本身不會登記出席。</small>
    </div>
  );
}
