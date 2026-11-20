import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { getAuth, getDb, isFirebaseConfigured } from './firebase';
import { assembleAttendanceRegister } from './attendanceRegister';
import { startAttendanceFeed, type AttendanceFeedSource } from './attendanceLiveFeed';
import type { AttendanceSession } from './courseAttendance';

export type AttendanceLiveState = 'connecting' | 'live' | 'paused' | 'offline' | 'error';
type SessionInfo = Omit<AttendanceSession, 'ownRecord' | 'ownStatus'>;
type OwnReceipt = Pick<AttendanceSession, 'ownRecord' | 'ownStatus'>;
export type AttendanceLiveOptions = {
  courseId: string;
  uid: string;
  canReadRoster: boolean;
  onSessions: (sessions: AttendanceSession[]) => void;
  onState: (state: AttendanceLiveState) => void;
};
function timestamp(value: unknown): string | null {
  try {
    const parsed = value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function'
      ? value.toDate() : typeof value === 'string' ? new Date(value) : value instanceof Date ? value : null;
    return parsed instanceof Date && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  } catch { return null; }
}

/** 只監聽最近 50 場與登入者自己的收據；沒有輪詢、全班逐人讀取或離線成功。 */
export function watchAttendanceLive(options: AttendanceLiveOptions): () => void {
  let disposed = false;
  let pageHidden = false;
  let connection = 0;
  let stopFeed: (() => void) | null = null;
  function disconnect() {
    connection += 1;
    stopFeed?.();
    stopFeed = null;
  }
  function connect() {
    disconnect();
    if (disposed) return;
    if (pageHidden || document.visibilityState === 'hidden') { options.onState('paused'); return; }
    if (navigator.onLine === false) { options.onState('offline'); return; }
    if (!isFirebaseConfigured() || getAuth()?.currentUser?.uid !== options.uid) {
      options.onState('error'); return;
    }
    const version = connection;
    const current = () => !disposed && version === connection;
    try {
      const db = getDb();
      const source: AttendanceFeedSource<SessionInfo, OwnReceipt> = {
        sessions: (next, error) => onSnapshot(query(
          collection(db, 'groups', options.courseId, 'attendanceSessions'),
          where('schemaVersion', '==', 2), orderBy('startedAt', 'desc'), limit(50),
        ), { includeMetadataChanges: true }, (snapshot) => {
          if (!current()) return;
          if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) { next(null); return; }
          const sessions: SessionInfo[] = [];
          for (const entry of snapshot.docs) {
            const data = entry.data();
            const startedAt = timestamp(data.startedAt);
            const endedAt = timestamp(data.endedAt);
            const qrExpiresAt = timestamp(data.qrExpiresAt);
            if (data.schemaVersion !== 2 || data.groupId !== options.courseId || data.sessionId !== entry.id ||
                typeof data.active !== 'boolean' || typeof data.teacherId !== 'string' || !data.teacherId ||
                typeof data.attendeeCount !== 'number' || !Number.isSafeInteger(data.attendeeCount) || data.attendeeCount < 0 ||
                !startedAt || (data.active && !qrExpiresAt)) { error(); return; }
            sessions.push({ id: entry.id, teacherId: data.teacherId, active: data.active,
              startedAt, endedAt, qrExpiresAt, attendeeCount: data.attendeeCount });
          }
          next(sessions);
        }, () => { if (current()) error(); }),
        receipt: (sessionId, next, error) => onSnapshot(doc(db, 'groups', options.courseId,
          'attendanceSessions', sessionId, 'attendanceRecords', options.uid),
        { includeMetadataChanges: true }, (snapshot) => {
          if (!current()) return;
          if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) { next(null); return; }
          const [row] = assembleAttendanceRegister(
            [{ uid: options.uid, displayName: '', studentId: '' }],
            snapshot.exists() ? [{ id: snapshot.id, data: snapshot.data() }] : [],
            { courseId: options.courseId, sessionId, complete: true },
          );
          if (row.status === 'unavailable') { error(); return; }
          next({ ownStatus: row.status === 'unconfirmed' ? null : row.status,
            ownRecord: row.status === 'present' || row.status === 'late' ? {
              uid: row.uid, displayName: '', studentId: '', checkedInAt: row.checkedInAt,
              status: row.status, source: row.source, correctedAt: row.correctedAt,
            } : null });
        }, () => { if (current()) error(); }),
      };
      const stop = startAttendanceFeed({ source, includeReceipts: !options.canReadRoster,
        onState: (state) => { if (current()) options.onState(state); },
        onChange: (rows) => { if (current()) options.onSessions(rows.map(({ session, receipt }) => ({
          ...session, ownRecord: receipt?.ownRecord ?? null, ownStatus: receipt?.ownStatus ?? null,
        }))); },
      });
      if (current()) stopFeed = stop;
      else stop();
    } catch { if (current()) options.onState('error'); }
  }
  const visibility = () => connect();
  const network = () => connect();
  const hide = () => { pageHidden = true; connect(); };
  const show = () => { pageHidden = false; connect(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('online', network);
  window.addEventListener('offline', network);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  connect();
  return () => {
    if (disposed) return;
    disposed = true;
    disconnect();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('online', network);
    window.removeEventListener('offline', network);
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
  };
}
