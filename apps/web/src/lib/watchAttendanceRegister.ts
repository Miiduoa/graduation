import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { getAuth, getDb, isFirebaseConfigured } from './firebase';
import {
  assembleAttendanceRegister, type AttendanceRegister, type RegisterDocument, type RegisterStudent,
} from './attendanceRegister';

export type RegisterSyncState = 'connecting' | 'live' | 'paused' | 'offline' | 'error';
export type LiveAttendanceRegister = AttendanceRegister & {
  membersComplete: boolean;
  receiptsComplete: boolean;
};
export const MAX_LIVE_REGISTER_DOCUMENTS = 500;
type Stop = () => void;
type Options = {
  courseId: string;
  sessionId: string;
  onData: (register: LiveAttendanceRegister) => void;
  onState: (state: RegisterSyncState) => void;
};
type Metadata = { fromCache: boolean; hasPendingWrites: boolean };
const confirmed = (metadata: Metadata) => !metadata.fromCache && !metadata.hasPendingWrites;
const validId = (id: string) => !!id && id.length <= 256 && !/[\s/]/u.test(id) && id !== '.' && id !== '..';

/** 教師主動開啟時才訂閱單一場次；不逐人查詢，也不在背景保留名冊。 */
export function watchAttendanceRegister(options: Options): Stop {
  let disposed = false;
  let identityLost = false;
  let hidden = false;
  let generation = 0;
  let dataGeneration = 0;
  let permission: string | null = null;
  let stops: Stop[] = [];
  let dataStops: Stop[] = [];
  let stopAuth: Stop | undefined;
  let students: RegisterStudent[] | null = null;
  let receipts: RegisterDocument[] | null = null;
  let active: boolean | null = null;
  let membersComplete = false;
  let receiptsComplete = false;
  const auth = isFirebaseConfigured() ? getAuth() : null;
  const uid = auth?.currentUser?.uid;

  function clearData() {
    dataGeneration += 1;
    const previous = dataStops;
    dataStops = [];
    for (const stop of previous) stop();
    students = null;
    receipts = null;
    active = null;
    membersComplete = false;
    receiptsComplete = false;
  }
  function disconnect() {
    generation += 1;
    permission = null;
    const previous = stops;
    stops = [];
    for (const stop of previous) stop();
    clearData();
  }
  function fail() {
    if (disposed) return;
    disconnect();
    options.onState('error');
  }
  function emit() {
    if (disposed) return;
    if (!permission || students === null || receipts === null || active === null) {
      options.onState('connecting');
      return;
    }
    options.onData({
      rows: assembleAttendanceRegister(students, receipts, {
        courseId: options.courseId, sessionId: options.sessionId, complete: receiptsComplete,
      }),
      complete: membersComplete && receiptsComplete,
      membersComplete, receiptsComplete, active,
      checkedAt: new Date().toISOString(),
    });
    options.onState('live');
  }
  function connect() {
    disconnect();
    if (disposed) return;
    if (hidden || document.visibilityState === 'hidden') { options.onState('paused'); return; }
    if (navigator.onLine === false) { options.onState('offline'); return; }
    if (identityLost || !uid || auth?.currentUser?.uid !== uid || !validId(options.courseId) || !validId(options.sessionId)) {
      options.onState('error'); return;
    }
    options.onState('connecting');
    const version = generation;
    const current = () => !disposed && version === generation;
    const stillSignedIn = () => {
      if (!current()) return false;
      if (auth?.currentUser?.uid !== uid) { fail(); return false; }
      return true;
    };
    try {
      const db = getDb();
      const scope = ['groups', options.courseId] as const;
      const memberRef = doc(db, ...scope, 'members', uid);
      const sessionRef = doc(db, ...scope, 'attendanceSessions', options.sessionId);
      const enrollmentQuery = query(collection(db, ...scope, 'members'),
        where('status', '==', 'active'), limit(MAX_LIVE_REGISTER_DOCUMENTS + 1));
      // 不用 checkedInAt 排序，保留沒有掃碼時間的缺席與請假紀錄。
      const receiptsQuery = query(collection(db, ...scope, 'attendanceSessions', options.sessionId,
        'attendanceRecords'), limit(MAX_LIVE_REGISTER_DOCUMENTS + 1));
      function startData() {
        const dataVersion = dataGeneration;
        const allowed = () => stillSignedIn() && dataVersion === dataGeneration && permission !== null;
        const keep = (stop: Stop) => { if (allowed()) dataStops.push(stop); else stop(); };
        const failed = () => { if (allowed()) fail(); };
        keep(onSnapshot(sessionRef, { includeMetadataChanges: true }, (snapshot) => {
          if (!allowed()) return;
          if (!confirmed(snapshot.metadata)) { active = null; emit(); return; }
          const value = snapshot.exists() ? snapshot.data() : null;
          if (!value || value.schemaVersion !== 2 || value.groupId !== options.courseId ||
              value.sessionId !== options.sessionId || typeof value.active !== 'boolean') { fail(); return; }
          active = value.active;
          emit();
        }, failed));
        if (!allowed()) return;
        keep(onSnapshot(enrollmentQuery, { includeMetadataChanges: true }, (snapshot) => {
          if (!allowed()) return;
          if (!confirmed(snapshot.metadata)) { students = null; emit(); return; }
          membersComplete = snapshot.docs.length <= MAX_LIVE_REGISTER_DOCUMENTS;
          students = snapshot.docs.slice(0, MAX_LIVE_REGISTER_DOCUMENTS).flatMap((entry) => {
            const value = entry.data();
            if (value.status !== 'active' || (value.role !== 'member' && value.role !== 'student')) return [];
            return [{ uid: entry.id,
              displayName: typeof value.displayName === 'string' && value.displayName.trim()
                ? value.displayName : typeof value.userName === 'string' && value.userName.trim()
                  ? value.userName : '未提供姓名',
              studentId: typeof value.studentId === 'string' ? value.studentId : '',
            }];
          }).sort((a, b) => (a.studentId || a.displayName).localeCompare(b.studentId || b.displayName, 'zh-TW'));
          emit();
        }, failed));
        if (!allowed()) return;
        keep(onSnapshot(receiptsQuery, { includeMetadataChanges: true }, (snapshot) => {
          if (!allowed()) return;
          if (!confirmed(snapshot.metadata)) { receipts = null; emit(); return; }
          receiptsComplete = snapshot.docs.length <= MAX_LIVE_REGISTER_DOCUMENTS;
          receipts = snapshot.docs.slice(0, MAX_LIVE_REGISTER_DOCUMENTS)
            .map((entry) => ({ id: entry.id, data: entry.data() }));
          emit();
        }, failed));
      }
      const stop = onSnapshot(memberRef, { includeMetadataChanges: true }, (snapshot) => {
        if (!stillSignedIn()) return;
        if (!confirmed(snapshot.metadata)) {
          permission = null;
          clearData();
          options.onState('connecting');
          return;
        }
        const value = snapshot.exists() ? snapshot.data() : null;
        if (!value || value.status !== 'active' || (value.role !== 'owner' && value.role !== 'instructor')) {
          fail(); return;
        }
        if (permission === value.role) return;
        clearData();
        permission = value.role;
        options.onState('connecting');
        try { startData(); } catch { if (current()) fail(); }
      }, () => { if (current()) fail(); });
      if (current()) stops.push(stop); else stop();
    } catch { if (current()) fail(); }
  }
  const visibility = () => connect();
  const network = () => connect();
  const hide = () => { hidden = true; connect(); };
  const show = () => { hidden = false; connect(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('online', network);
  window.addEventListener('offline', network);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  try {
    if (auth) stopAuth = onAuthStateChanged(auth, (user) => {
      if (!disposed && user?.uid !== uid) { identityLost = true; fail(); }
    });
    connect();
  } catch { fail(); }
  return () => {
    if (disposed) return;
    disposed = true;
    disconnect();
    stopAuth?.();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('online', network);
    window.removeEventListener('offline', network);
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
  };
}
