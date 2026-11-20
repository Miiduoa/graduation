import { NuniError, nuniId, nuniRecord, type NuniRole, type NuniTransport } from './nuni';

export type NuniClassroomSession = {
  id: string;
  title: string;
  state: 'open' | 'closed';
  checkedInByMe: boolean;
  checkInCount?: number;
  shortCode?: string;
  unitId?: string | null;
  makeupRequestState?: string;
};

export type NuniClassroomPerson = {
  platformAccountId: string;
  displayName: string;
  punctuality?: string;
  makeupRequestState?: string;
};

export type NuniClassroomRoster = {
  present: NuniClassroomPerson[];
  absent: NuniClassroomPerson[];
  late: NuniClassroomPerson[];
};

export type NuniWorkspaceMember = {
  platformAccountId: string;
  displayName: string;
  memberRole: NuniRole;
};

function invalid(): never {
  throw new NuniError(502, 'INVALID_RESPONSE');
}

function text(value: unknown, limit = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) return invalid();
  return value;
}

function optionalText(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : text(value);
}

function displayName(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > 300) return invalid();
  return value.trim() ? value : fallback;
}

function rows<T>(value: unknown, parse: (row: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 5000) return invalid();
  return value.map(parse);
}

function sessionId(value: unknown): string {
  const id = text(value, 40);
  if (!/^cws_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
    return invalid();
  return id;
}

function parseSession(value: unknown, workspaceId: string): NuniClassroomSession {
  const row = nuniRecord(value);
  if (row.workspaceId !== undefined && row.workspaceId !== workspaceId) return invalid();
  if (row.state !== 'open' && row.state !== 'closed') return invalid();
  if (row.checkedInByMe !== undefined && typeof row.checkedInByMe !== 'boolean') return invalid();
  if (
    row.checkInCount !== undefined &&
    (!Number.isSafeInteger(row.checkInCount) || Number(row.checkInCount) < 0)
  )
    return invalid();
  return {
    id: sessionId(row.id),
    title: text(row.title),
    state: row.state,
    checkedInByMe: row.checkedInByMe === true,
    checkInCount: row.checkInCount as number | undefined,
    shortCode: optionalText(row.shortCode),
    unitId:
      row.unitId === undefined ? undefined : row.unitId === null ? null : nuniId(row.unitId, 'cwu'),
    makeupRequestState: optionalText(row.makeupRequestState),
  };
}

function parsePerson(value: unknown): NuniClassroomPerson {
  const row = nuniRecord(value);
  return {
    platformAccountId: nuniId(row.platformAccountId, 'pa'),
    displayName: displayName(row.displayName, '同學'),
    punctuality: optionalText(row.punctuality),
    makeupRequestState: optionalText(row.makeupRequestState),
  };
}

function parseMember(value: unknown): NuniWorkspaceMember {
  const row = nuniRecord(value);
  const role = row.memberRole ?? row.role;
  if (role !== 'owner-teacher' && role !== 'co-teacher' && role !== 'student') return invalid();
  return {
    platformAccountId: nuniId(row.platformAccountId, 'pa'),
    displayName: displayName(row.displayName, '成員'),
    memberRole: role,
  };
}

/** Uses the existing classroom resources with the caller's authenticated transport. */
export function createNuniClassroom(transport: NuniTransport) {
  const workspacePath = (id: string) => `class-workspaces/${nuniId(id, 'cw')}`;
  const sessionPath = (id: string, classroomId: string) =>
    `${workspacePath(id)}/classroom-sessions/${sessionId(classroomId)}`;

  return {
    async sessions(id: string): Promise<NuniClassroomSession[]> {
      const body = nuniRecord(await transport(`${workspacePath(id)}/classroom-sessions`));
      const sessions = rows(body.sessions, (row) => parseSession(row, id));
      if (new Set(sessions.map((row) => row.id)).size !== sessions.length) return invalid();
      return sessions;
    },
    async roster(id: string, classroomId: string): Promise<NuniClassroomRoster> {
      const body = nuniRecord(await transport(`${sessionPath(id, classroomId)}/roster`));
      if (body.sessionId !== undefined && body.sessionId !== classroomId) return invalid();
      if (body.workspaceId !== undefined && body.workspaceId !== id) return invalid();
      return {
        present: rows(body.present, parsePerson),
        absent: rows(body.absent, parsePerson),
        late: rows(body.late, parsePerson),
      };
    },
    async members(id: string): Promise<NuniWorkspaceMember[]> {
      const body = nuniRecord(await transport(`${workspacePath(id)}/members`));
      return rows(body.members, parseMember);
    },
    async checkIn(id: string, classroomId: string, code?: string): Promise<void> {
      const path = `${sessionPath(id, classroomId)}/check-in`;
      const trimmed = code?.trim();
      if (trimmed && trimmed.length > 40) throw new NuniError(422, 'INVALID_INPUT');
      // This endpoint has no shared receipt contract. Read sessions again to confirm state.
      await transport(path, trimmed ? { code: trimmed } : {});
    },
  };
}
