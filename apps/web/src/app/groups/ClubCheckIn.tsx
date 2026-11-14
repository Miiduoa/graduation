'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ClubScanner } from './ClubScanner';
import { callClubPortal } from './clubPortalService';
export function ClubCheckIn({
  uid,
  schoolId,
  groupId,
  eventId,
  myCode,
  suffix,
  officer,
  onConfirmed,
}: {
  uid: string;
  schoolId: string;
  groupId: string;
  eventId: string;
  myCode?: string;
  suffix?: string;
  officer: boolean;
  onConfirmed: () => void;
}) {
  const [qr, setQr] = useState(''),
    [expanded, setExpanded] = useState(false),
    [code, setCode] = useState(''),
    [queue, setQueue] = useState<string[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const key = JSON.stringify(['club-check-in', uid, schoolId, groupId, eventId]);
  useEffect(() => {
    let current = true;
    if (myCode)
      void QRCode.toDataURL(myCode).then((url) => {
        if (current) setQr(url);
      });
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(saved)) setQueue(saved.filter((s) => typeof s === 'string'));
    } catch {}
    return () => {
      current = false;
    };
  }, [key, myCode]);
  function save(next: string[]) {
    localStorage.setItem(key, JSON.stringify(next));
    setQueue(next);
  }
  async function send(entries: string[]) {
    if (busy) return;
    setBusy(true);
    let remaining = entries;
    let confirmedMessage = '';
    try {
      for (const checkInCode of entries) {
        const result = await callClubPortal(uid, schoolId, {
          action: 'checkIn',
          groupId,
          eventId,
          checkInCode,
        });
        confirmedMessage = result.message || '簽到已由伺服器確認';
        remaining = remaining.slice(1);
        save(remaining);
      }
      setMessage(confirmedMessage);
      onConfirmed();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '尚未送出');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const sync = () => {
      if (queue.length) void send(queue);
    };
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  });
  return (
    <div>
      {myCode && (
        <>
          <button className="btn" onClick={() => setExpanded(!expanded)}>
            我的簽到碼
          </button>
          {expanded && (
            <div>
              {qr && <img src={qr} width={256} height={256} alt="我的活動簽到 QR" />}
              <p style={{ fontSize: 34, fontFamily: 'monospace' }}>{suffix || '未提供學號'}</p>
            </div>
          )}
        </>
      )}
      {officer && (
        <details>
          <summary>開始簽到</summary>
          <ClubScanner
            onCode={(value) => {
              setCode(value);
            }}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const next = [...new Set([...queue, code.trim()])];
              try {
                save(next);
                setCode('');
                if (navigator.onLine) void send(next);
              } catch {
                setMessage('無法暫存，請確認瀏覽器儲存空間');
              }
            }}
          >
            <label>
              掃描器輸入 QR 或學號後四碼
              <input value={code} onChange={(e) => setCode(e.target.value)} required />
            </label>
            <button className="btn" disabled={busy}>
              確認簽到
            </button>
          </form>
          <p>{queue.length} 筆待送出</p>
          <button className="btn" disabled={busy || !queue.length} onClick={() => void send(queue)}>
            重送待送出簽到
          </button>
          {queue.length > 0 && (
            <button
              className="btn"
              onClick={() => {
                if (window.confirm('確定清除尚未送出的簽到？')) save([]);
              }}
            >
              清除待送出紀錄
            </button>
          )}
          <p role="status">{message}</p>
        </details>
      )}
    </div>
  );
}
