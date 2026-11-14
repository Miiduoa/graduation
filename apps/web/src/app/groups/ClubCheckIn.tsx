'use client';
import { useEffect, useRef, useState } from 'react';
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
    [failures, setFailures] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const key = JSON.stringify(['club-check-in', uid, schoolId, groupId, eventId]);
  useEffect(() => {
    let current = true;
    if (myCode)
      void QRCode.toDataURL(myCode).then((url) => {
        if (current) setQr(url);
      });
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      const entries = Array.isArray(saved) ? saved.filter((s) => typeof s === 'string') : [];
      setQueue(entries);
      if (officer && navigator.onLine && entries.length) void send(entries);
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
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    let remaining = entries;
    let confirmedMessage = '';
    try {
      const failed: Record<string, string> = {};
      for (const checkInCode of entries) {
        let result;
        try {
          result = await callClubPortal(uid, schoolId, {
            action: 'checkIn',
            groupId,
            eventId,
            checkInCode,
          });
        } catch (err) {
          failed[checkInCode] = err instanceof Error ? err.message : '尚未送出，請重試';
          setFailures({ ...failed });
          continue;
        }
        confirmedMessage = result.message || '簽到已由伺服器確認';
        remaining = remaining.filter((entry) => entry !== checkInCode);
        save(remaining);
      }
      setFailures(failed);
      setMessage(
        Object.keys(failed).length ? '部分簽到未完成，請重試或刪除失敗紀錄' : confirmedMessage,
      );
      if (confirmedMessage) onConfirmed();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '尚未送出');
    } finally {
      sending.current = false;
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
          {queue.map(
            (entry, index) =>
              failures[entry] && (
                <div key={entry}>
                  <span>
                    第 {index + 1} 筆：{failures[entry]}
                  </span>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => save(queue.filter((value) => value !== entry))}
                  >
                    刪除第 {index + 1} 筆失敗簽到
                  </button>
                </div>
              ),
          )}
          <button className="btn" disabled={busy || !queue.length} onClick={() => void send(queue)}>
            重送待送出簽到
          </button>
          {queue.length > 0 && (
            <button
              className="btn"
              disabled={busy}
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
