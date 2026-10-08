export type TeacherScope = { uid: string; groupId: string };
export type TeacherPhase = 'idle' | 'starting' | 'active' | 'expired' | 'unavailable' | 'ending' | 'closed' | 'uncertain';
export type TeacherState = {
  phase: TeacherPhase; sessionId: string; token: string; expiresAt: string;
  count: number | null; error: string;
};
export type TeacherPorts = {
  start: (groupId: string) => Promise<unknown>;
  end: (groupId: string, sessionId: string) => Promise<unknown>;
  read: (groupId: string, sessionId: string) => Promise<unknown>;
  now: () => number;
};
const empty = (): TeacherState => ({ phase: 'idle', sessionId: '', token: '', expiresAt: '', count: null, error: '' });
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const pathId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 &&
  v.trim() === v && Array.from(v).every((char) => char !== '/' && char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) && v !== '.' && v !== '..' && !/^__.*__$/u.test(v);
const canonicalDate = (v: unknown): v is string => typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;

/** One owner/course scope per instance. Tokens live only in memory; dispose on account change. */
export function createTeacherAttendance(scope: TeacherScope, ports: TeacherPorts) {
  let state = empty();
  let generation = 0;
  let alive = true;
  const listeners = new Set<(state: TeacherState) => void>();
  const publish = (next: TeacherState) => {
    if (!alive) return;
    state = next;
    for (const notify of listeners) notify({ ...state });
  };
  const valid = (id: number) => alive && generation === id;
  const start = async () => {
    if (!alive || !['idle', 'closed'].includes(state.phase)) return;
    if (!pathId(scope.uid) || !pathId(scope.groupId)) {
      publish({ ...state, error: '請先登入並從 Campus One 課程教室開啟點名。' }); return;
    }
    const id = ++generation;
    publish({ ...empty(), phase: 'starting' });
    try {
      const result = object(await ports.start(scope.groupId));
      if (!valid(id)) return;
      if (!result || result.success !== true || result.groupId !== scope.groupId ||
          !pathId(result.sessionId) || typeof result.qrToken !== 'string' ||
          !/^[A-Za-z0-9_-]{32}$/.test(result.qrToken) || !canonicalDate(result.qrExpiresAt)) {
        throw new Error('Invalid session acknowledgement');
      }
      const expired = Date.parse(result.qrExpiresAt) <= ports.now();
      publish({ phase: expired ? 'expired' : 'active', sessionId: result.sessionId,
        token: expired ? '' : result.qrToken, expiresAt: result.qrExpiresAt, count: 0, error: '' });
    } catch {
      if (valid(id)) publish({ ...empty(), phase: 'uncertain',
        error: '未收到開啟點名的確認，點名可能已建立。請先查最近點名；不要連按建立。' });
    }
  };
  const inspect = async (sessionId = state.sessionId) => {
    if (!alive || ['starting', 'ending'].includes(state.phase) || !pathId(sessionId)) return;
    const id = ++generation;
    const before = state;
    // Never show the previous session's QR while switching to another session.
    if (sessionId !== state.sessionId) publish({ ...empty(), phase: 'unavailable', sessionId });
    try {
      const data = object(await ports.read(scope.groupId, sessionId));
      if (!valid(id)) return;
      if (!data || data.groupId !== scope.groupId || data.sessionId !== sessionId ||
          data.teacherId !== scope.uid || typeof data.active !== 'boolean' ||
          !Number.isSafeInteger(data.attendeeCount) || (data.attendeeCount as number) < 0) {
        throw new Error('Invalid session status');
      }
      if (!data.active) { publish({ ...empty(), phase: 'closed', sessionId, count: data.attendeeCount as number }); return; }
      const canKeep = before.sessionId === sessionId && !!before.token &&
        Date.parse(before.expiresAt) > ports.now();
      publish({ phase: canKeep ? 'active' : 'unavailable', sessionId,
        token: canKeep ? before.token : '', expiresAt: canKeep ? before.expiresAt : '',
        count: data.attendeeCount as number, error: canKeep ? '' : '本機沒有這次點名的 QR。請結束後重開；不會從群組文件還原明文。' });
    } catch {
      if (valid(id)) publish({ ...state, phase: 'unavailable', token: '',
        error: '無法核對這次點名的狀態或權限，已停止顯示 QR。' });
    }
  };
  const end = async () => {
    if (!alive || !state.sessionId || ['starting', 'ending', 'closed'].includes(state.phase)) return;
    const sessionId = state.sessionId;
    const id = ++generation;
    publish({ ...state, phase: 'ending', token: '', error: '' });
    try {
      const data = object(await ports.end(scope.groupId, sessionId));
      if (!valid(id)) return;
      if (!data || data.success !== true || data.groupId !== scope.groupId ||
          data.sessionId !== sessionId || data.active !== false || !canonicalDate(data.endedAt)) {
        throw new Error('Invalid close acknowledgement');
      }
      publish({ ...state, phase: 'closed', token: '', error: '' });
    } catch {
      if (valid(id)) publish({ ...state, phase: 'unavailable', token: '', error: '未確認點名已結束。請重試結束或重新核對狀態。' });
    }
  };
  return {
    start, inspect, end,
    getState: () => ({ ...state }),
    subscribe: (notify: (state: TeacherState) => void) => { listeners.add(notify); notify({ ...state }); return () => { listeners.delete(notify); }; },
    tick: () => {
      if (alive && state.token && Date.parse(state.expiresAt) <= ports.now()) {
        publish({ ...state, phase: 'expired', token: '', error: 'QR 已過期。請結束這次點名後重新開啟。' });
      }
    },
    dispose: () => { alive = false; generation++; state = empty(); listeners.clear(); },
  };
}
