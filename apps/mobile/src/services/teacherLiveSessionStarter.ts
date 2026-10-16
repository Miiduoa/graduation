type TeacherSessionScope = {
  uid: string;
  schoolId: string;
  groupId: string;
  role: string | null | undefined;
};

type ActiveScope = { uid: string | null; schoolId: string | null };

type StartResponse = {
  success?: unknown;
  active?: unknown;
  sessionId?: unknown;
  qrToken?: unknown;
  qrExpiresAt?: unknown;
};

export type TeacherSessionStartResult =
  | { status: 'started'; sessionId: string; groupId: string }
  | { status: 'denied' | 'busy' | 'stale' | 'unconfirmed' | 'closed' };

/** Persist one retry key per active account/course until the server acknowledges it. */
export function createTeacherLiveSessionStarter(ports: {
  send: (input: { groupId: string; requestId: string; qrExpiryMinutes: number }) => Promise<unknown>;
  newRequestId: () => string;
  currentScope: () => ActiveScope;
  now?: () => number;
}) {
  const retryKeys = new Map<string, string>();
  const pending = new Set<string>();
  let alive = true;

  const validId = (value: string): boolean =>
    value.length > 0 && value.length <= 128 && value.trim() === value &&
    !/[\/\u0000-\u001f\u007f]/u.test(value) && value !== '.' && value !== '..' &&
    !/^__.*__$/u.test(value);
  const stillCurrent = (scope: TeacherSessionScope) => {
    const current = ports.currentScope();
    return alive && current.uid === scope.uid && current.schoolId === scope.schoolId;
  };

  async function start(scope: TeacherSessionScope): Promise<TeacherSessionStartResult> {
    if (!alive || !['owner', 'instructor'].includes(scope.role || '') ||
        !validId(scope.uid) || !validId(scope.schoolId) || !validId(scope.groupId) ||
        !stillCurrent(scope)) return { status: 'denied' };

    const key = JSON.stringify([scope.uid, scope.schoolId, scope.groupId]);
    if (pending.has(key)) return { status: 'busy' };
    pending.add(key);

    try {
      let requestId = retryKeys.get(key);
      if (!requestId) {
        requestId = ports.newRequestId();
        if (!validId(requestId)) return { status: 'unconfirmed' };
        retryKeys.set(key, requestId);
      }
      const response = (await ports.send({
        groupId: scope.groupId,
        requestId,
        qrExpiryMinutes: 10,
      })) as StartResponse | null;

      if (!stillCurrent(scope)) return { status: 'stale' };
      if (!response || response.success !== true) return { status: 'unconfirmed' };
      if (response.active === false) {
        retryKeys.delete(key);
        return { status: 'closed' };
      }

      const expiry = typeof response.qrExpiresAt === 'string'
        ? Date.parse(response.qrExpiresAt) : NaN;
      const sessionId = response.sessionId;
      if (response.active !== true || typeof sessionId !== 'string' || !validId(sessionId) ||
          typeof response.qrToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(response.qrToken) ||
          !Number.isFinite(expiry) || expiry <= (ports.now ?? Date.now)()) {
        return { status: 'unconfirmed' };
      }
      retryKeys.delete(key);
      return { status: 'started', sessionId, groupId: scope.groupId };
    } catch {
      return stillCurrent(scope) ? { status: 'unconfirmed' } : { status: 'stale' };
    } finally {
      pending.delete(key);
    }
  }

  return {
    start,
    dispose: () => {
      alive = false;
      retryKeys.clear();
      pending.clear();
    },
  };
}
